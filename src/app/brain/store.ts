import { useSyncExternalStore } from "react";
import { parseLabText, type ParsedReport } from "../../core/importers/labText";
import { assistantProfile } from "../../core/profile";
import type { Measurement } from "../../core/types";
import { db, getProfile } from "../../db/db";
import { api } from "../api";
import { BLOOD_MARKERS } from "../knowledge";
import { isImage, isPdf, monthFirst, readReportFile } from "../components/LabReview";
import { isTextFile, questionWithFiles, redactName } from "./logic";
import { parseHealthScreenshot } from "../../core/importers/screenshot";
import { todayIso } from "../../core/dates";

// Brain's state lives outside React, so the conversation stays while you move between pages (not across reloads).

export interface Step {
  tool: string;
  server?: string;
  input: string;
}

export type Turn =
  | { id: string; role: "user"; content: string; /** what went to the model, with file text */ sent: string; files: string[] }
  | { id: string; role: "assistant"; content: string; model: string; steps: Step[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; note?: string }
  | { id: string; role: "error"; content: string }
  | { id: string; role: "stopped" }
  | {
      id: string;
      role: "review";
      fileName: string;
      file?: File;
      ocr: boolean;
      report: ParsedReport;
      state: "open" | "saved" | "dismissed";
      /** "body": values from a health app screenshot. */
      kind?: "lab" | "body";
      saved?: Measurement[];
      skipped?: number;
      date?: string;
      kept?: string;
      keepError?: string;
    };

/** A document attached to the next question (lab reports become a review card instead). */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  status: "reading" | "ready" | "error";
  stage?: string;
  fraction?: number;
  text?: string;
  error?: string;
}

export interface BrainState {
  open: boolean;
  draft: string;
  turns: Turn[];
  busy: boolean;
  attachments: Attachment[];
  /** Bumped to move focus into the question box. */
  focusTick: number;
  /** A question to send as soon as Brain knows a model is ready (from "Summarize with Brain" buttons). */
  pending?: string;
}

type Reply =
  | { ok: true; text: string; steps: Step[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; note?: string }
  | { ok: false; error: string };

let state: BrainState = { open: false, draft: "", turns: [], busy: false, attachments: [], focusTick: 0 };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let nextId = 0;
const newId = () => `b${++nextId}`;

function set(patch: Partial<BrainState> | ((s: BrainState) => Partial<BrainState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const l of listeners) l();
}

export function useBrain(): BrainState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function openBrain(opts: { draft?: string } = {}): void {
  set((s) => ({ open: true, ...(opts.draft ? { draft: opts.draft } : {}), focusTick: s.focusTick + 1 }));
}
export const closeBrain = () => set({ open: false });

/** Opens Brain and sends the question once a model is ready (otherwise it waits in the question box). */
export function askBrain(question: string): void {
  set((s) => ({ open: true, pending: question, focusTick: s.focusTick + 1 }));
}

/** Called by the window once it knows whether a model is ready. */
export function takePending(ready: boolean, model: string): void {
  const q = state.pending;
  if (!q) return;
  set({ pending: undefined });
  if (ready && !state.busy) void send(model, q);
  else set({ draft: q });
}
export const toggleBrain = () => (state.open ? closeBrain() : openBrain());
export const setDraft = (draft: string) => set({ draft });
export const removeAttachment = (id: string) => set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }));
export const updateTurn = (id: string, patch: Partial<Extract<Turn, { role: "review" }>>) =>
  set((s) => ({ turns: s.turns.map((t) => (t.id === id && t.role === "review" ? { ...t, ...patch } : t)) }));

export function newConversation(): void {
  controller?.abort();
  set((s) => ({ turns: [], busy: false, attachments: [], draft: "", focusTick: s.focusTick + 1 }));
}

const MAX_TEXT_FILE = 5_000_000;

/**
 * Reads files on this device. A lab report (results found in it) becomes a review card in the conversation;
 * anything else is attached as text to the next question.
 */
export async function addFiles(files: File[]): Promise<void> {
  for (const file of files) {
    const id = newId();
    const usable = isPdf(file) || isImage(file) || isTextFile(file.name, file.type);
    set((s) => ({
      attachments: [
        ...s.attachments,
        usable
          ? { id, name: file.name, size: file.size, status: "reading" }
          : { id, name: file.name, size: file.size, status: "error", error: "Brain reads PDFs, photos and text files." },
      ],
    }));
    if (!usable) continue;
    const progress = (fraction: number, stage: string) =>
      set((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, fraction, stage } : a)) }));
    try {
      let text: string;
      let ocr = false;
      if (isTextFile(file.name, file.type)) {
        if (file.size > MAX_TEXT_FILE) throw new Error("This file is too big (over 5 MB).");
        text = await file.text();
      } else {
        const r = await readReportFile(file, progress);
        text = r.text;
        ocr = r.ocr;
      }
      const report = parseLabText(text, BLOOD_MARKERS, { monthFirst });
      if (report.rows.length > 0) {
        // Lab results: checked by the person in a review card, never sent as text.
        set((s) => ({
          attachments: s.attachments.filter((a) => a.id !== id),
          turns: [...s.turns, { id: newId(), role: "review", fileName: file.name, file, ocr, report, state: "open" }],
        }));
        continue;
      }
      // A health app screenshot (heart rate, HRV, sleep…): body measurements, checked the same way.
      if (isImage(file)) {
        const shot = parseHealthScreenshot(text, todayIso());
        if (shot.rows.length > 0) {
          set((s) => ({
            attachments: s.attachments.filter((a) => a.id !== id),
            turns: [...s.turns, { id: newId(), role: "review", fileName: file.name, file, ocr: true, report: shot, state: "open", kind: "body" }],
          }));
          continue;
        }
      }
      if (!text.trim()) throw new Error("No text was found in this file.");
      set((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, status: "ready", text, stage: undefined, fraction: undefined } : a)) }));
    } catch (e) {
      const error = e instanceof Error ? e.message : "This file couldn't be read.";
      set((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, status: "error", error } : a)) }));
    }
  }
}

/** What the assistant may read: the open profile. Birth month only becomes an age on the local server. */
async function snapshot() {
  const [measurements, protocols, experiments, profile] = await Promise.all([db.measurements.toArray(), db.protocols.toArray(), db.experiments.toArray(), getProfile()]);
  // The name and private notes never leave this page.
  return { measurements, protocols, experiments, profile: assistantProfile(profile), name: profile.name };
}

/** Sends the draft (or `text`) with any attached documents. `model` labels the answer. */
export async function send(model: string, text?: string): Promise<void> {
  const question = (text ?? state.draft).trim();
  const docs = state.attachments.filter((a) => a.status === "ready");
  if ((!question && docs.length === 0) || state.busy || state.attachments.some((a) => a.status === "reading")) return;
  const snap = await snapshot();
  const sent = questionWithFiles(
    question,
    docs.map((d) => ({ name: d.name, text: redactName(d.text ?? "", snap.name) })),
  );
  const user: Turn = { id: newId(), role: "user", content: question, sent, files: docs.map((d) => d.name) };
  set((s) => ({ turns: [...s.turns, user], busy: true, ...(text === undefined ? { draft: "" } : {}), attachments: s.attachments.filter((a) => a.status !== "ready") }));

  controller = new AbortController();
  const mine = controller;
  try {
    const messages = state.turns.flatMap((t) =>
      t.role === "user" ? [{ role: "user", content: t.sent }] : t.role === "assistant" ? [{ role: "assistant", content: t.content }] : [],
    );
    const { name: _n, ...data } = snap;
    const r = await api<Reply>("POST", "/api/assistant", { messages, snapshot: data }, mine.signal);
    if (mine.signal.aborted) return;
    set((s) => ({
      turns: [
        ...s.turns,
        r.ok
          ? { id: newId(), role: "assistant", content: r.text, model, steps: r.steps, studyIds: r.studyIds, truncated: r.truncated, failedServers: r.failedServers, ...(r.note ? { note: r.note } : {}) }
          : { id: newId(), role: "error", content: r.error },
      ],
    }));
  } catch (e) {
    if (mine.signal.aborted) return;
    set((s) => ({ turns: [...s.turns, { id: newId(), role: "error", content: e instanceof Error ? e.message : "Something went wrong." }] }));
  } finally {
    if (controller === mine) {
      controller = null;
      set({ busy: false });
    }
  }
}

/** Stops waiting for the answer. (An agent program may still finish its run in the background.) */
export function stop(): void {
  if (!controller) return;
  controller.abort();
  controller = null;
  set((s) => ({ busy: false, turns: [...s.turns, { id: newId(), role: "stopped" }] }));
}
