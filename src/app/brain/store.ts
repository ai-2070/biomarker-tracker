import { useSyncExternalStore } from "react";
import { parseLabText, type ParsedReport } from "../../core/importers/labText";
import { assistantProfile } from "../../core/profile";
import type { Measurement } from "../../core/types";
import { db, getProfile } from "../../db/db";
import { EXPIRATION_KEY } from "../hooks";
import { api } from "../api";
import { BIOMARKER_MAP, BLOOD_MARKERS } from "../knowledge";
import { isImage, isPdf, monthFirst, readReportFile } from "../components/LabReview";
import { isTextFile, questionWithFiles, redactName } from "./logic";
import { shrinkPhoto } from "./photo";
import { parseHealthScreenshot } from "../../core/importers/screenshot";
import { todayIso } from "../../core/dates";
import { parseHabitProposal, type HabitProposal } from "../../core/habitProposal";
import { planFromProposal, type Plan } from "../../core/plans";
import { validateMeal, type Meal } from "../../core/meals";
import { flagLatest, groupByBiomarker, isCritical } from "../../core/trends";

// Brain's state lives outside React, so the conversation stays while you move between pages (not across reloads).

export interface Step {
  tool: string;
  server?: string;
  input: string;
}

export type Turn =
  | { id: string; role: "user"; content: string; /** what went to the model, with file text */ sent: string; files: string[]; /** photos sent with it (not kept) */ photos?: number }
  | { id: string; role: "assistant"; content: string; model: string; steps: Step[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; note?: string }
  | { id: string; role: "error"; content: string }
  | { id: string; role: "stopped" }
  /** A habit Brain suggested: a card the person edits and confirms (nothing is saved before). */
  | { id: string; role: "habit"; proposal: HabitProposal; state: "open" | "saved" | "dismissed" }
  /** A protocol Brain wrote down from the person's text: a card they check and create. */
  | { id: string; role: "protocol"; plan: Plan; state: "open" | "saved" | "dismissed" }
  /** A meal Brain wrote down from a recipe: a card with the app's totals that the person saves. */
  | { id: string; role: "meal"; meal: Meal; state: "open" | "saved" | "dismissed" }
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
  /** A picture: it can be sent itself to the model, if the person turns this on. */
  photo?: File;
  sendPhoto?: boolean;
}

export type BrainScope = "personal" | "research";

export interface BrainState {
  open: boolean;
  scope: BrainScope;
  draft: string;
  turns: Turn[];
  busy: boolean;
  attachments: Attachment[];
  /** Bumped to move focus into the question box. */
  focusTick: number;
  /** A question waiting for the window's model-readiness check. */
  pending?: string;
}

type Reply =
  | { ok: true; text: string; steps: Step[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; note?: string }
  | { ok: false; error: string };

type Thread = Pick<BrainState, "draft" | "turns" | "busy" | "attachments" | "pending"> & { researchContext?: string };
const emptyThread = (): Thread => ({ draft: "", turns: [], busy: false, attachments: [] });
const threads: Record<BrainScope, Thread> = { personal: emptyThread(), research: emptyThread() };
const epochs: Record<BrainScope, number> = { personal: 0, research: 0 };
let state: BrainState = { open: false, scope: "personal", ...threads.personal, focusTick: 0 };
const listeners = new Set<() => void>();
interface Request {
  controller: AbortController;
  scope: BrainScope;
  epoch: number;
  submitted: boolean;
}
let request: Request | null = null;
let nextId = 0;
const newId = () => `b${++nextId}`;
const notify = () => { for (const l of listeners) l(); };

function set(patch: Partial<BrainState> | ((s: BrainState) => Partial<BrainState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  threads[state.scope] = { ...threads[state.scope], draft: state.draft, turns: state.turns, busy: state.busy, attachments: state.attachments, pending: state.pending };
  notify();
}

/** File reads may finish in the parked personal thread, never in the visible research thread. */
function setThread(scope: BrainScope, patch: (thread: Thread) => Partial<Thread>) {
  const next = { ...threads[scope], ...patch(threads[scope]) };
  threads[scope] = next;
  if (state.scope === scope) {
    state = { ...state, ...next };
    notify();
  }
}

function cancelRequest() {
  const mine = request;
  if (!mine) return;
  mine.controller.abort();
  request = null;
  setThread(mine.scope, (s) => ({
    busy: false,
    ...(mine.submitted ? { turns: [...s.turns, { id: newId(), role: "stopped" as const }] } : {}),
  }));
}

function changeScope(scope: BrainScope) {
  if (state.scope === scope) return;
  cancelRequest();
  state = { ...state, scope, ...threads[scope] };
  notify();
}

function isCurrent(mine: Request): boolean {
  return request === mine && !mine.controller.signal.aborted && state.scope === mine.scope && epochs[mine.scope] === mine.epoch;
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
  // Prefilled questions elsewhere in the app refer to the person's data; the pill has no draft.
  if (opts.draft !== undefined) changeScope("personal");
  set((s) => ({ open: true, ...(opts.draft ? { draft: opts.draft } : {}), focusTick: s.focusTick + 1 }));
}
export const closeBrain = () => set({ open: false });

/** Opens Brain and sends the question once a model is ready (otherwise it waits in the question box). */
export function askBrain(question: string): void {
  changeScope("personal");
  set((s) => ({ open: true, pending: question, focusTick: s.focusTick + 1 }));
}

/** A public evidence question, isolated from the person's chat, draft and files. */
export function askResearchBrain(question: string): void {
  if (!question.trim()) return;
  changeScope("research");
  cancelRequest();
  threads.research.researchContext = question.trim();
  set((s) => ({ open: true, draft: question, pending: question, focusTick: s.focusTick + 1 }));
}

export function backToMyChat(): void {
  changeScope("personal");
  set((s) => ({ open: true, focusTick: s.focusTick + 1 }));
}

/** Called by the window once it knows whether a model is ready. */
export function takePending(ready: boolean, model: string): void {
  const q = state.pending;
  if (!q) return;
  set({ pending: undefined });
  if (ready && !state.busy && !state.attachments.some((a) => a.status === "reading")) {
    // Keep an unanswered question editable if preparing/sending is blocked by a file read.
    if (state.scope === "research") set({ draft: q });
    void send(model, q);
  } else set({ draft: q });
}
export const toggleBrain = () => (state.open ? closeBrain() : openBrain());
export const setDraft = (draft: string) => set({ draft, pending: undefined });
export const removeAttachment = (id: string) => setThread("personal", (s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }));
export const setSendPhoto = (id: string, on: boolean) => setThread("personal", (s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, sendPhoto: on } : a)) }));
export const updateTurn = (id: string, patch: Partial<Extract<Turn, { role: "review" }>>) =>
  setThread("personal", (s) => ({ turns: s.turns.map((t) => (t.id === id && t.role === "review" ? { ...t, ...patch } : t)) }));
export const setHabitState = (id: string, state: "saved" | "dismissed") =>
  setThread("personal", (s) => ({ turns: s.turns.map((t) => (t.id === id && (t.role === "habit" || t.role === "protocol" || t.role === "meal") ? { ...t, state } : t)) }));

/**
 * Habit cards from Brain's propose_habit calls, checked again here (the same rules as the server) and
 * never while a result is critical: then the person should contact a doctor first.
 */
export function habitTurns(steps: readonly Step[], measurements: readonly Measurement[], today: string): Turn[] {
  const critical = [...groupByBiomarker(measurements)].some(([id, ms]) => {
    const def = BIOMARKER_MAP.get(id);
    return !!def && isCritical(flagLatest(def, ms));
  });
  if (critical) return [];
  const seen = new Set<string>();
  return steps.flatMap((st): Turn[] => {
    if (!st.server && st.tool === "propose_protocol") {
      try {
        // Real ids: the protocol is saved in the profile, unlike chat turns.
        const r = planFromProposal(JSON.parse(st.input), () => crypto.randomUUID(), new Date().toISOString());
        return r.ok ? [{ id: newId(), role: "protocol", plan: r.plan, state: "open" }] : [];
      } catch {
        return [];
      }
    }
    if (!st.server && st.tool === "propose_meal") {
      try {
        const m = JSON.parse(st.input) as { name?: unknown; items?: unknown; note?: unknown };
        const note = typeof m.note === "string" && m.note.trim() ? { note: m.note.trim() } : {};
        const meal = { id: crypto.randomUUID(), name: String(m.name ?? "").trim(), items: m.items as Meal["items"], ...note, createdAt: new Date().toISOString() };
        return validateMeal(meal).length === 0 ? [{ id: newId(), role: "meal", meal, state: "open" }] : [];
      } catch {
        return [];
      }
    }
    if (st.server || st.tool !== "propose_habit") return [];
    let input: unknown;
    try {
      input = JSON.parse(st.input);
    } catch {
      return [];
    }
    const r = parseHabitProposal(input, BIOMARKER_MAP, today);
    if (!r.ok || seen.has(r.proposal.label.toLowerCase())) return [];
    seen.add(r.proposal.label.toLowerCase());
    return [{ id: newId(), role: "habit" as const, proposal: r.proposal, state: "open" as const }];
  });
}

export function newConversation(): void {
  cancelRequest();
  epochs[state.scope]++;
  threads[state.scope] = emptyThread();
  set((s) => ({ ...threads[s.scope], pending: undefined, focusTick: s.focusTick + 1 }));
}

const MAX_TEXT_FILE = 5_000_000;

/**
 * Reads files on this device. A lab report (results found in it) becomes a review card in the conversation;
 * anything else is attached as text to the next question.
 */
export async function addFiles(files: File[]): Promise<void> {
  if (state.scope !== "personal") return;
  const epoch = epochs.personal;
  for (const file of files) {
    if (epochs.personal !== epoch) return;
    const id = newId();
    const usable = isPdf(file) || isImage(file) || isTextFile(file.name, file.type);
    setThread("personal", (s) => ({
      attachments: [
        ...s.attachments,
        usable
          ? { id, name: file.name, size: file.size, status: "reading" }
          : { id, name: file.name, size: file.size, status: "error", error: "Brain reads PDFs, photos and text files." },
      ],
    }));
    if (!usable) continue;
    const update = (patch: (s: Thread) => Partial<Thread>) => {
      if (epochs.personal === epoch && threads.personal.attachments.some((a) => a.id === id)) setThread("personal", patch);
    };
    const progress = (fraction: number, stage: string) =>
      update((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, fraction, stage } : a)) }));
    try {
      let text: string;
      let ocr = false;
      if (isTextFile(file.name, file.type)) {
        if (file.size > MAX_TEXT_FILE) throw new Error("This file is too big (over 5 MB).");
        text = await file.text();
      } else {
        // A photo without text (a body photo) is fine here: it can be sent itself.
        const r = await readReportFile(file, progress, true);
        text = r.text;
        ocr = r.ocr;
      }
      if (epochs.personal !== epoch || !threads.personal.attachments.some((a) => a.id === id)) continue;
      const report = parseLabText(text, BLOOD_MARKERS, { monthFirst });
      if (report.rows.length > 0) {
        // Lab results: checked by the person in a review card, never sent as text.
        update((s) => ({
          attachments: s.attachments.filter((a) => a.id !== id),
          turns: [...s.turns, { id: newId(), role: "review", fileName: file.name, file, ocr, report, state: "open" }],
        }));
        continue;
      }
      // A health app screenshot (heart rate, HRV, sleep…): body measurements, checked the same way.
      if (isImage(file)) {
        const shot = parseHealthScreenshot(text, todayIso());
        if (shot.rows.length > 0) {
          update((s) => ({
            attachments: s.attachments.filter((a) => a.id !== id),
            turns: [...s.turns, { id: newId(), role: "review", fileName: file.name, file, ocr: true, report: shot, state: "open", kind: "body" }],
          }));
          continue;
        }
      }
      // Any other picture: its text (if any) can go with the question, or the photo itself if the person chooses.
      if (!text.trim() && !isImage(file)) throw new Error("No text was found in this file.");
      update((s) => ({
        attachments: s.attachments.map((a) => (a.id === id ? { ...a, status: "ready", text, stage: undefined, fraction: undefined, ...(isImage(file) ? { photo: file, sendPhoto: false } : {}) } : a)),
      }));
    } catch (e) {
      const error = e instanceof Error ? e.message : "This file couldn't be read.";
      update((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, status: "error", error } : a)) }));
    }
  }
}

/** What the assistant may read: the open profile. Birth month only becomes an age on the local server. */
async function snapshot() {
  const [measurements, protocols, experiments, plans, meals, profile, expiration] = await Promise.all([db.measurements.toArray(), db.protocols.toArray(), db.experiments.toArray(), db.plans.toArray(), db.meals.toArray(), getProfile(), db.settings.get(EXPIRATION_KEY)]);
  // The name and private notes never leave this page. The expiration date only when it's turned on.
  return { measurements, protocols, experiments, plans, meals, profile: assistantProfile(profile), name: profile.name, expirationDate: expiration?.value === true };
}

/** Sends only this thread's question and, in personal mode, its profile and attachments. */
export async function send(model: string, text?: string): Promise<void> {
  const scope = state.scope;
  const question = (text ?? state.draft).trim();
  const consumeDraft = text === undefined || state.draft.trim() === question;
  const ready = scope === "personal" ? state.attachments.filter((a) => a.status === "ready" && (a.sendPhoto || (a.text ?? "").trim())) : [];
  if ((!question && ready.length === 0) || state.busy || (scope === "personal" && state.attachments.some((a) => a.status === "reading"))) return;
  // Claim the request before any await: Stop/scope changes also cancel snapshot and photo preparation.
  const mine: Request = { controller: new AbortController(), scope, epoch: epochs[scope], submitted: false };
  request = mine;
  const priorTurns = state.turns;
  set({ busy: true, pending: undefined });
  try {
    const snap = scope === "personal" ? await snapshot() : undefined;
    if (!isCurrent(mine)) return;
    const photos = ready.filter((a) => a.sendPhoto && a.photo);
    const images = await Promise.all(photos.map((p) => shrinkPhoto(p.photo!)));
    if (!isCurrent(mine)) return;
    let sent: string;
    if (scope === "research") {
      // Only the public claim supplied to this thread accompanies a follow-up, never chat history.
      const context = threads.research.researchContext;
      sent = context && context !== question
        ? `Public research topic:\n${context}\n\nLatest question:\n${question}`
        : question;
      if (!context) threads.research.researchContext = question;
    } else {
      sent = questionWithFiles(
        question || (photos.length ? "Please look at the attached photo." : ""),
        ready.filter((a) => !a.sendPhoto).map((d) => ({ name: d.name, text: redactName(d.text ?? "", snap?.name) })),
      );
    }
    const user: Turn = { id: newId(), role: "user", content: question, sent, files: ready.map((d) => d.name), ...(photos.length ? { photos: photos.length } : {}) };
    mine.submitted = true;
    set((s) => ({
      turns: [...s.turns, user],
      ...(consumeDraft && s.draft.trim() === question ? { draft: "" } : {}),
      attachments: s.attachments.filter((a) => !ready.some((r) => r.id === a.id)),
    }));
    let body: object;
    if (scope === "research") {
      body = { scope: "research", messages: [{ role: "user", content: sent }] };
    } else {
      const messages: { role: string; content: string; images?: typeof images }[] = [...priorTurns, user].flatMap((t) =>
        t.role === "user"
          ? [{ role: "user", content: t.photos && t.id !== user.id ? `${t.sent}

[A photo was sent with this question; it isn't sent again.]` : t.sent }]
          : t.role === "assistant"
            ? [{ role: "assistant", content: t.content }]
            : [],
      );
      if (images.length) messages[messages.length - 1] = { ...messages[messages.length - 1]!, images };
      const { name: _n, ...data } = snap!;
      body = { messages, snapshot: data };
    }
    const r = await api<Reply>("POST", "/api/assistant", body, mine.controller.signal);
    if (!isCurrent(mine)) return;
    set((s) => ({
      turns: [
        ...s.turns,
        ...(r.ok
          ? [
              { id: newId(), role: "assistant" as const, content: r.text, model, steps: r.steps, studyIds: r.studyIds, truncated: r.truncated, failedServers: r.failedServers, ...(r.note ? { note: r.note } : {}) },
              ...(snap ? habitTurns(r.steps, snap.measurements, todayIso()) : []),
            ]
          : [{ id: newId(), role: "error" as const, content: r.error }]),
      ],
    }));
  } catch (e) {
    if (!isCurrent(mine)) return;
    set((s) => ({ turns: [...s.turns, { id: newId(), role: "error", content: e instanceof Error ? e.message : "Something went wrong." }] }));
  } finally {
    if (request === mine) {
      request = null;
      set({ busy: false });
    }
  }
}

/** Cancels preparation or the active request; disconnecting also stops server-side model work. */
export function stop(): void {
  cancelRequest();
}
