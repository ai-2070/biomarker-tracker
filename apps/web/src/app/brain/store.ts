import { useSyncExternalStore } from "react";
import { parseLabText, type ParsedReport } from "@bt/shared/core/importers/labText";
import { assistantProfile } from "@bt/shared/core/profile";
import type { BiomarkerDef, Measurement, Profile } from "@bt/shared/core/types";
import { db, fillPersonalDetails, getProfile, LOADED_PROFILE_KEY } from "../../db/db";
import { EXPIRATION_KEY, MORTALITY_ACTIVITY_KEY } from "../hooks";
import type { LiveAnswer } from "./stream";
import { BIOMARKER_MAP, BLOOD_MARKERS } from "../knowledge";
import { isImage, isPdf, monthFirst } from "../components/LabReview";
import { isTextFile, questionWithFiles, redactName } from "./logic";
import { shrinkPhoto, type PreparedPhoto } from "./photo";
import { criticalResults, parseResultProposal, proposalKind } from "@bt/shared/core/importers/resultProposal";
import { MAX_PHOTOS } from "@bt/shared/core/aiProviders";
import { todayIso } from "@bt/shared/core/dates";
import { parseHabitProposal, type HabitProposal } from "@bt/shared/core/habitProposal";
import { planFromProposal, type Plan } from "@bt/shared/core/plans";
import { validateMeal, type Meal } from "@bt/shared/core/meals";
import { flagLatest, groupByBiomarker, isCritical } from "@bt/shared/core/trends";
import { proposalIntent, proposalIssue, type AssistantProposalContext, type ProposalIntent } from "@bt/shared/core/assistantProposal";
import { profileDetailsIn, type ProfileDetailChange } from "@bt/shared/core/profileCompletion";
import { safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import { measurementsIn } from "@bt/shared/core/measurementCompletion";

// Brain's state lives outside React, so the conversation stays while you move between pages (not across reloads).

export interface Step {
  tool: string;
  server?: string;
  input: string;
  validated?: boolean;
  output?: unknown;
  success?: boolean;
}

export type Turn =
  | {
      id: string;
      role: "user";
      content: string;
      /** what went to the model, with file text */
      sent: string;
      files: string[];
      /** photos sent with it */
      photos?: number;
      /** The pictures were the previous question's, sent again (`picturesToResend`). */
      photosAgain?: boolean;
      /** The pictures themselves, the files they came from and the model they went to: sent again with a follow-up while their card is open. */
      pictures?: { images: PreparedPhoto[]; files: File[]; model: string };
    }
  | { id: string; role: "assistant"; content: string; model: string; steps: Step[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; note?: string }
  /** The answer while it streams: replaced by the final turn (or an error) when the reply arrives. */
  | ({ id: string; role: "live"; model: string } & LiveAnswer)
  | { id: string; role: "error"; content: string }
  | { id: string; role: "stopped" }
  /** Actual persisted additions, never a model's claim that a save happened. */
  | { id: string; role: "profile"; changes: ProfileDetailChange[]; measurements: Measurement[] }
  /** A habit Brain suggested: a card the person edits and confirms (nothing is saved before). */
  | { id: string; role: "habit"; proposal: HabitProposal; state: "open" | "saved" | "dismissed" }
  /** A protocol Brain wrote down from the person's text: a card they check and create. */
  | { id: string; role: "protocol"; plan: Plan; intent: ProposalIntent; state: "open" | "saved" | "dismissed" }
  /** A meal Brain wrote down from a recipe: a card with the app's totals that the person saves. */
  | { id: string; role: "meal"; meal: Meal; intent: ProposalIntent; state: "open" | "saved" | "dismissed" }
  | {
      id: string;
      role: "review";
      fileName: string;
      /** The report's files, kept in the profile folder after saving. */
      files: File[];
      /** Read by Brain from photos or scanned pages (propose_results), not from a PDF's or pasted text. */
      fromPicture: boolean;
      report: ParsedReport;
      state: "open" | "saved" | "dismissed";
      /** "body": body measurements (a health app screen, a scale, a blood pressure monitor). */
      kind?: "lab" | "body";
      saved?: Measurement[];
      skipped?: number;
      date?: string;
      kept?: string;
      keepError?: string;
    };

/** A document attached to the next question (PDFs with lab results become a review card instead). */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  status: "reading" | "ready" | "error";
  stage?: string;
  fraction?: number;
  text?: string;
  error?: string;
  /** A photo, or a scanned PDF's pages: sent to Brain as pictures with the question, never turned into text here. */
  images?: PreparedPhoto[];
  /** "pdf": the pictures are a scanned PDF's pages. */
  pictureOf?: "photo" | "pdf";
  /** The original file, kept in the profile folder if results read from it are saved. */
  file?: File;
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
  | { ok: true; text: string; model?: string; steps: Step[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; note?: string }
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
    // A half-written answer isn't kept: it was never checked.
    ...(mine.submitted ? { turns: [...s.turns.filter((t) => t.role !== "live"), { id: newId(), role: "stopped" as const }] } : {}),
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

/** What the Import page asks when it hands Brain a photo or a scanned report. */
export const READ_REPORT_QUESTION = "Read the results in this report and show them to me to check.";

/**
 * A photo or scanned PDF from the Import page: opens Brain with it attached and asks Brain to read the results,
 * which come back as a review card. `pages`: a scanned PDF's pages as the Import page already prepared them.
 * Without a ready model the question waits in the question box.
 */
export async function readWithBrain(file: File, pages?: PreparedPhoto[]): Promise<void> {
  changeScope("personal");
  set((s) => ({ open: true, focusTick: s.focusTick + 1 }));
  // A scanned PDF's pages, already drawn by the Import page, are attached as they are rather than drawn again.
  if (pages?.length) {
    if (!threads.personal.attachments.some((a) => a.file === file)) {
      setThread("personal", (s) => ({ attachments: [...s.attachments, { id: newId(), name: file.name, size: file.size, status: "ready", images: pages, pictureOf: "pdf", file }] }));
    }
  } else await addFiles([file]);
  if (threads.personal.attachments.some((a) => a.file === file && a.status === "ready")) askBrain(READ_REPORT_QUESTION);
}

/** Lab results pasted as text (three rows or more) become a review card, like a dropped report. */
export function addPastedLabText(text: string): boolean {
  if (state.scope !== "personal") return false;
  if (parseLabText(text, BLOOD_MARKERS, { monthFirst }).rows.length < 3) return false;
  void addFiles([new File([text], "Pasted lab results.txt", { type: "text/plain" })]);
  return true;
}
export const updateTurn = (id: string, patch: Partial<Extract<Turn, { role: "review" }>>) =>
  setThread("personal", (s) => ({ turns: s.turns.map((t) => (t.id === id && t.role === "review" ? { ...t, ...patch } : t)) }));
export const setHabitState = (id: string, state: "saved" | "dismissed") =>
  setThread("personal", (s) => ({ turns: s.turns.map((t) => (t.id === id && (t.role === "habit" || t.role === "protocol" || t.role === "meal") ? { ...t, state } : t)) }));

/**
 * Habit cards from Brain's propose_habit calls, checked again here (the same rules as the server) and
 * never while a result is critical: then the person should contact a doctor first.
 */
export function habitTurns(steps: readonly Step[], measurements: readonly Measurement[], today: string, context: Omit<AssistantProposalContext, "critical">): Turn[] {
  const critical = [...groupByBiomarker(measurements)].some(([id, ms]) => {
    const def = BIOMARKER_MAP.get(id);
    return !!def && isCritical(flagLatest(def, ms));
  });
  if (critical) return [];
  const seen = new Set<string>();
  return steps.flatMap((st): Turn[] => {
    if (st.server !== undefined || st.validated !== true || st.success !== true || !st.output || typeof st.output !== "object") return [];
    const kind = st.tool === "propose_protocol" ? "protocol" : st.tool === "propose_meal" ? "meal" : st.tool === "propose_habit" ? "habit" : undefined;
    if (!kind) return [];
    const output = st.output as { intent?: unknown; plan?: unknown; meal?: unknown; shownToPerson?: unknown };
    const intent = proposalIntent(output);
    if (!intent) return [];
    const proposal = kind === "protocol" ? output.plan : kind === "meal" ? output.meal : output.shownToPerson;
    if (!proposal || typeof proposal !== "object") return [];
    const fields = proposal as Record<string, unknown>;
    const input = { ...fields, intent, ...(kind === "habit" ? { watchMarkers: fields.markerIds } : {}) };
    if (proposalIssue(kind, input, { ...context, critical })) return [];
    try {
      if (kind === "protocol") {
        const r = planFromProposal(input, () => crypto.randomUUID(), new Date().toISOString());
        return r.ok ? [{ id: newId(), role: "protocol", plan: r.plan, intent, state: "open" }] : [];
      }
      if (kind === "meal") {
        const meal = output.meal as Meal;
        return validateMeal(meal).length === 0 ? [{ id: newId(), role: "meal", meal: { ...meal, id: crypto.randomUUID() }, intent, state: "open" }] : [];
      }
    } catch {
      return [];
    }
    const r = parseHabitProposal(input, BIOMARKER_MAP, today);
    if (!r.ok || seen.has(r.proposal.label.toLowerCase())) return [];
    seen.add(r.proposal.label.toLowerCase());
    return [{ id: newId(), role: "habit" as const, proposal: r.proposal, state: "open" as const }];
  });
}

/** Report files already kept (or being kept) per profile, so several cards from the same pictures keep each file once. */
const keptFiles = new WeakMap<File, Map<string, Promise<string>>>();

/**
 * Keeps a review card's report files in the profile folder after its results are saved. A file another card
 * already kept (several cards from one answer, or a follow-up's card) isn't kept again; a failed one can be retried.
 */
export async function keepReportFiles(
  profileId: string,
  files: readonly File[],
  note: string,
  upload: (profileId: string, file: File, note: string) => Promise<{ originalName: string }>,
): Promise<{ kept: string[]; errors: string[] }> {
  const kept: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    let byProfile = keptFiles.get(file);
    if (!byProfile) keptFiles.set(file, (byProfile = new Map()));
    let pending = byProfile.get(profileId);
    if (!pending) {
      pending = upload(profileId, file, note).then((f) => f.originalName);
      byProfile.set(profileId, pending);
    }
    try {
      kept.push(await pending);
    } catch (e) {
      if (byProfile.get(profileId) === pending) byProfile.delete(profileId);
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }
  return { kept: [...new Set(kept)], errors };
}

/**
 * Review cards from Brain's propose_results calls: results it read from the pictures sent with the question,
 * checked again here. Nothing is saved until the person checks each value and presses Save.
 */
export function resultTurns(steps: readonly Step[], files: File[], today: string): Turn[] {
  const fileName = files.length === 1 ? files[0]!.name : files.length > 1 ? `${files.length} pictures` : "your pictures";
  return steps.flatMap((st): Turn[] => {
    if (st.server !== undefined || st.tool !== "propose_results" || st.validated !== true || st.success !== true || !st.output || typeof st.output !== "object") return [];
    const r = parseResultProposal((st.output as { shownToPerson?: unknown }).shownToPerson, BIOMARKER_MAP, today);
    if (!r.ok) return [];
    return [{ id: newId(), role: "review", fileName, files, fromPicture: true, report: r.report, state: "open", kind: proposalKind(r.report, BIOMARKER_MAP) }];
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
 * Prepares files on this device. A PDF with lab results in its text becomes a review card in the conversation.
 * Photos and scanned PDFs are attached as pictures for Brain to read; other files are attached as text.
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
      if (isTextFile(file.name, file.type)) {
        if (file.size > MAX_TEXT_FILE) throw new Error("This file is too big (over 5 MB).");
        text = await file.text();
      } else if (isImage(file)) {
        // Sent to Brain as it is (shrunk, location data removed): never read as text on this device.
        const image = await shrinkPhoto(file);
        update((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, status: "ready", images: [image], pictureOf: "photo", file } : a)) }));
        continue;
      } else {
        const { readPdf } = await import("../pdf");
        const pdf = await readPdf(file, progress);
        if (pdf.kind === "pages") {
          update((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, status: "ready", stage: undefined, fraction: undefined, images: pdf.pages, pictureOf: "pdf", file } : a)) }));
          continue;
        }
        text = pdf.text;
      }
      if (epochs.personal !== epoch || !threads.personal.attachments.some((a) => a.id === id)) continue;
      const report = parseLabText(text, BLOOD_MARKERS, { monthFirst });
      if (report.rows.length > 0) {
        // Lab results: checked by the person in a review card, never sent as text.
        update((s) => ({
          attachments: s.attachments.filter((a) => a.id !== id),
          turns: [...s.turns, { id: newId(), role: "review", fileName: file.name, files: [file], fromPicture: false, report, state: "open" }],
        }));
        continue;
      }
      if (!text.trim()) throw new Error("No text was found in this file.");
      update((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, status: "ready", text, stage: undefined, fraction: undefined } : a)) }));
    } catch (e) {
      if (epochs.personal !== epoch) return;
      const error = e instanceof Error ? e.message : "This file couldn't be read.";
      update((s) => ({ attachments: s.attachments.map((a) => (a.id === id ? { ...a, status: "error", error } : a)) }));
    }
  }
}

/** What the assistant may read: the open profile. Birth month only becomes an age on the local server. */
async function snapshot() {
  return db.transaction("r", [db.measurements, db.protocols, db.experiments, db.plans, db.meals, db.settings], async () => {
    const [measurements, protocols, experiments, plans, meals, profile, expiration, loaded, activity] = await Promise.all([db.measurements.toArray(), db.protocols.toArray(), db.experiments.toArray(), db.plans.toArray(), db.meals.toArray(), getProfile(), db.settings.get(EXPIRATION_KEY), db.settings.get(LOADED_PROFILE_KEY), db.settings.get(MORTALITY_ACTIVITY_KEY)]);
    const identity = { id: typeof loaded?.value === "string" ? loaded.value : null, name: profile.name };
    // Identity and name stay local. The server turns birth month into an age before a tool returns it.
    return { measurements, protocols, experiments, plans, meals, profile: assistantProfile(profile), name: profile.name, identity, expirationDate: expiration?.value === true, mortalityActivityIsLeisure: activity?.value === true };
  });
}

/**
 * The previous question's pictures, to send again with a follow-up ("you missed HbA1c"): only when the previous
 * question had them, to the same model, while a review card read from them is still open. Each follow-up that
 * sends them again keeps them, so a second correction works too; closing or saving the card ends it.
 */
export function picturesToResend(turns: readonly Turn[], model: string): { images: PreparedPhoto[]; files: File[] } | undefined {
  const question = turns.findLast((t) => t.role === "user");
  if (question?.role !== "user" || !question.pictures || question.pictures.model !== model) return undefined;
  const { images, files } = question.pictures;
  const open = turns.some((t) => t.role === "review" && t.fromPicture && t.state === "open" && t.files.some((f) => files.includes(f)));
  return open ? { images, files } : undefined;
}

/** Sends only this thread's question and, in personal mode, its profile and attachments. */
export async function send(model: string, text?: string): Promise<void> {
  const scope = state.scope;
  const question = (text ?? state.draft).trim();
  const questionDate = todayIso();
  const consumeDraft = text === undefined || state.draft.trim() === question;
  const ready = scope === "personal" ? state.attachments.filter((a) => a.status === "ready" && (a.images?.length || (a.text ?? "").trim())) : [];
  if ((!question && ready.length === 0) || state.busy || (scope === "personal" && state.attachments.some((a) => a.status === "reading"))) return;
  const pictures = ready.filter((a) => a.images?.length);
  const attached = pictures.flatMap((a) => a.images!);
  if (attached.length > MAX_PHOTOS) {
    set((s) => ({ turns: [...s.turns, { id: newId(), role: "error", content: `Send up to ${MAX_PHOTOS} photos or pages at a time. Remove some and try again; your attachments are still here.` }] }));
    return;
  }
  // A follow-up about an open card read from pictures sends those pictures again, so Brain can look again.
  const again = scope === "personal" && attached.length === 0 && question ? picturesToResend(state.turns, model) : undefined;
  const images = again?.images ?? attached;
  const pictureFiles = again?.files ?? pictures.flatMap((a) => (a.file ? [a.file] : []));
  // Claim the request before any await: Stop/scope changes also cancel snapshot preparation.
  const mine: Request = { controller: new AbortController(), scope, epoch: epochs[scope], submitted: false };
  request = mine;
  const priorTurns = state.turns;
  set({ busy: true, pending: undefined });
  try {
    const snap = scope === "personal" ? await snapshot() : undefined;
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
        question || (images.length === 1 ? "Please look at the attached picture." : images.length ? "Please look at the attached pictures." : ""),
        ready.filter((a) => !a.images?.length).map((d) => ({ name: redactName(d.name, snap?.name), text: redactName(d.text ?? "", snap?.name) })),
      );
    }
    const user: Turn = {
      id: newId(), role: "user", content: question, sent, files: ready.map((d) => d.name),
      ...(images.length ? { photos: images.length, pictures: { images, files: pictureFiles, model } } : {}),
      ...(again ? { photosAgain: true } : {}),
    };
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
      const priorPhotoNote = "\n\n[A photo was sent with this question; it isn't sent again.]";
      const messages: { role: string; content: string; images?: typeof images }[] = [...priorTurns, user].flatMap((t) =>
        t.role === "user"
          ? [{ role: "user", content: t.photos && t.id !== user.id && t.sent.length + priorPhotoNote.length <= 20_000 ? t.sent + priorPhotoNote : t.sent }]
          : t.role === "assistant"
            ? [{ role: "assistant", content: t.content }]
            : [],
      );
      if (images.length) messages[messages.length - 1] = { ...messages[messages.length - 1]!, images };
      const { name: _n, identity: _identity, ...data } = snap!;
      body = { messages, snapshot: data, ...(question ? { userText: question } : {}) };
    }
    // The answer streams into a live turn; the verified reply replaces it below.
    const liveId = newId();
    set((s) => ({ turns: [...s.turns, { id: liveId, role: "live", model, text: "", steps: [], studyIds: [] }] }));
    const dropLive = () => setThread(scope, (s) => ({ turns: s.turns.filter((t) => t.id !== liveId) }));
    let r: Reply;
    try {
      // Loaded with the first question: the AI SDK's stream reader isn't needed before that.
      const { streamAssistant } = await import("./stream");
      r = await streamAssistant<Reply>(body, mine.controller.signal, (live) => {
        if (isCurrent(mine)) setThread(scope, (s) => ({ turns: s.turns.map((t) => (t.id === liveId ? { ...t, ...live } : t)) }));
      });
    } catch (e) {
      if (isCurrent(mine)) dropLive();
      throw e;
    }
    if (!isCurrent(mine)) return;
    const profileTurns: Turn[] = [];
    let effectiveProfile: Profile | undefined = snap?.profile;
    let effectiveMeasurements = snap?.measurements ?? [];
    let profileSaveError: string | undefined;
    if (r.ok && snap) {
      const detected = profileDetailsIn(question, questionDate);
      const inputs: unknown[] = detected.details.length ? [detected] : [];
      for (const step of r.steps) {
        if (step.server !== undefined || step.tool !== "save_profile_details" || step.validated !== true) continue;
        try { inputs.push(JSON.parse(step.input)); } catch { /* Invalid tool payloads cannot update a profile. */ }
      }
      // With pictures, typed readings ("my HbA1c is 5.6%") go on the picture's card, dated by the report, not saved as today's.
      const readingDefs: ReadonlyMap<string, BiomarkerDef> = images.length ? new Map() : BIOMARKER_MAP;
      if (inputs.length || measurementsIn(question, questionDate, readingDefs).length) {
        try {
          const result = await fillPersonalDetails(inputs, question, questionDate, snap.identity, readingDefs, mine.controller.signal);
          if (!isCurrent(mine)) return;
          // Another profile was opened while Brain answered: this answer isn't about the open one.
          if (!result.sameProfile) return dropLive();
          effectiveProfile = result.profile;
          effectiveMeasurements = [...effectiveMeasurements, ...result.measurementsAdded];
          if (result.added.length || result.measurementsAdded.length) profileTurns.push({ id: newId(), role: "profile", changes: result.added, measurements: result.measurementsAdded });
        } catch {
          if (!isCurrent(mine)) return;
          profileSaveError = "Your details couldn't be saved. You can add profile details in Settings and measurements in Add data.";
        }
      }
    }
    // Results read from pictures go first: a critical one's urgent banner comes before Brain's commentary,
    // and no habit is suggested next to it.
    const results = r.ok && snap && images.length ? resultTurns(r.steps, pictureFiles, questionDate) : [];
    const pictureCritical = results.some((t) => t.role === "review" && criticalResults(t.report, BIOMARKER_MAP).length > 0);
    set((s) => ({
      turns: [
        ...s.turns.filter((t) => t.id !== liveId),
        ...(r.ok
          ? [
              ...results,
              { id: newId(), role: "assistant" as const, content: r.text, model: r.model ?? model, steps: r.steps, studyIds: r.studyIds, truncated: r.truncated, failedServers: r.failedServers, ...((r.note || profileSaveError) ? { note: [r.note, profileSaveError].filter(Boolean).join(" ") } : {}) },
              ...profileTurns,
              ...(snap && !pictureCritical ? habitTurns(r.steps, effectiveMeasurements, questionDate, { requestText: sent, safety: safetyNotes(safetyLabels(snap.protocols, effectiveProfile)).map((n) => n.id) }) : []),
            ]
          : [{ id: newId(), role: "error" as const, content: r.error }]),
      ],
    }));
  } catch (e) {
    if (!isCurrent(mine)) return;
    set((s) => ({ turns: [...s.turns.filter((t) => t.role !== "live"), { id: newId(), role: "error", content: e instanceof Error ? e.message : "Something went wrong." }] }));
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
