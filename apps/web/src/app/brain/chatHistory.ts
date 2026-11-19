/**
 * Past Brain conversations, kept in the open profile's settings, so they are saved in its folder (and its backups) like the rest of the
 * profile and never sent anywhere. Older lists kept in the browser's own storage are moved in the first time.
 * Only the words are kept: questions and answers with the studies an answer cited. Pictures, attached files and the
 * cards for results, habits, protocols and meals are not, because they hold files and need the person's check before saving.
 */
import { db } from "../../db/db";
import type { Turn } from "./store";

export interface SavedStep {
  tool: string;
  server?: string;
  input: string;
}

export type SavedTurn =
  | { role: "user"; content: string; files: string[] }
  | { role: "assistant"; content: string; model: string; studyIds: string[]; steps: SavedStep[]; truncated: boolean; note?: string };

export interface SavedChat {
  id: string;
  title: string;
  /** Milliseconds since 1970 of the last change. */
  updated: number;
  turns: SavedTurn[];
}

export const MAX_CHATS = 40;
/** Keeps the profile folder small: the oldest conversations go first (the server accepts up to 4 million characters). */
export const MAX_CHARS = 3_000_000;
export const SETTINGS_KEY = "brainChats";
const MAX_TITLE = 70;
const MAX_STEP_INPUT = 300;

export function chatTitle(turns: readonly SavedTurn[]): string {
  const first = turns.find((t) => t.role === "user");
  const text = (first?.content ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Conversation";
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text;
}

/** The part of a live conversation worth keeping. Nothing that is still streaming, failed or waiting on a check. */
export function toSaved(turns: readonly Turn[]): SavedTurn[] {
  const out: SavedTurn[] = [];
  for (const t of turns) {
    if (t.role === "user") out.push({ role: "user", content: t.content, files: t.files });
    else if (t.role === "assistant")
      out.push({
        role: "assistant",
        content: t.content,
        model: t.model,
        studyIds: t.studyIds,
        steps: t.steps.map((s) => ({ tool: s.tool, ...(s.server ? { server: s.server } : {}), input: s.input.slice(0, MAX_STEP_INPUT) })),
        truncated: t.truncated,
        ...(t.note ? { note: t.note } : {}),
      });
  }
  return out;
}

/** Back into turns the window can show. The question's sent text is the typed question (files are not re-sent). */
export function fromSaved(turns: readonly SavedTurn[], newId: () => string): Turn[] {
  return turns.map((t): Turn => {
    if (t.role === "user") return { id: newId(), role: "user", content: t.content, sent: t.content, files: t.files };
    return {
      id: newId(),
      role: "assistant",
      content: t.content,
      model: t.model,
      steps: t.steps.map((s) => ({ tool: s.tool, ...(s.server ? { server: s.server } : {}), input: s.input })),
      studyIds: t.studyIds,
      truncated: t.truncated,
      failedServers: [],
      ...(t.note ? { note: t.note } : {}),
    };
  });
}

function validTurn(x: unknown): x is SavedTurn {
  if (!x || typeof x !== "object") return false;
  const t = x as Record<string, unknown>;
  if (t.role === "user") return typeof t.content === "string" && Array.isArray(t.files) && t.files.every((f) => typeof f === "string");
  if (t.role === "assistant")
    return (
      typeof t.content === "string" &&
      typeof t.model === "string" &&
      Array.isArray(t.studyIds) &&
      t.studyIds.every((s) => typeof s === "string") &&
      Array.isArray(t.steps) &&
      t.steps.every((s) => !!s && typeof s === "object" && typeof (s as SavedStep).tool === "string" && typeof (s as SavedStep).input === "string") &&
      typeof t.truncated === "boolean"
    );
  return false;
}

/** Stored text back into chats, dropping anything that does not look right (a damaged or edited entry never breaks the window). */
export function parseChats(raw: string | null): SavedChat[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const chats: SavedChat[] = [];
  for (const c of data) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.updated !== "number" || !Array.isArray(r.turns)) continue;
    const turns = r.turns.filter(validTurn);
    if (turns.length > 0) chats.push({ id: r.id, title: r.title, updated: r.updated, turns });
  }
  return chats.sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
}

/** Adds or replaces one conversation, newest first, keeping at most MAX_CHATS. */
export function upsertChat(chats: readonly SavedChat[], chat: SavedChat): SavedChat[] {
  return [chat, ...chats.filter((c) => c.id !== chat.id)].sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
}

/** At most MAX_CHATS conversations that together stay under MAX_CHARS, newest kept. */
export function fitChats(chats: readonly SavedChat[]): SavedChat[] {
  let list = chats.slice(0, MAX_CHATS);
  while (list.length > 1 && JSON.stringify(list).length > MAX_CHARS) list = list.slice(0, -1);
  return list;
}

let cache: SavedChat[] = [];
/** Nothing is written to the profile before its saved list was read, or a new conversation would replace the old ones. */
let loaded = false;
const listeners = new Set<() => void>();

export function loadChats(): SavedChat[] {
  return cache;
}

async function persist(list: SavedChat[]): Promise<void> {
  try {
    if (list.length === 0) await db.settings.delete(SETTINGS_KEY);
    else await db.settings.put({ key: SETTINGS_KEY, value: list });
  } catch {
    // The list stays on screen; the next change tries again.
  }
}

function store(chats: SavedChat[]): void {
  cache = fitChats(chats);
  for (const l of listeners) l();
  if (loaded) void persist(cache);
}

/**
 * Reads the open profile's list (once, when the window starts), adds a list the browser kept before profile folders held it
 * (`legacyProfile`, then forgets that copy), and keeps anything saved while it was loading.
 */
export async function loadHistory(legacyProfile: string | null): Promise<void> {
  let stored: SavedChat[] = [];
  try {
    stored = parseChats(JSON.stringify((await db.settings.get(SETTINGS_KEY))?.value ?? []));
  } catch {
    stored = [];
  }
  let legacy: SavedChat[] = [];
  const key = `bt:brain-chats:${legacyProfile ?? "browser"}`;
  try {
    legacy = parseChats(localStorage.getItem(key));
  } catch {
    legacy = [];
  }
  const byId = new Map<string, SavedChat>();
  for (const c of [...legacy, ...stored, ...cache]) {
    const old = byId.get(c.id);
    if (!old || c.updated >= old.updated) byId.set(c.id, c);
  }
  const merged = [...byId.values()].sort((a, b) => b.updated - a.updated);
  cache = fitChats(merged);
  loaded = true;
  for (const l of listeners) l();
  if (legacy.length > 0 || merged.length !== stored.length) await persist(cache);
  if (legacy.length > 0) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to forget.
    }
  }
}

/** Empties the in-memory list (a different profile is being opened). */
export function resetHistory(): void {
  cache = [];
  loaded = false;
  for (const l of listeners) l();
}

export function saveChat(chat: SavedChat): void {
  store(upsertChat(cache, chat));
}

export function deleteChat(id: string): void {
  store(cache.filter((c) => c.id !== id));
}

export function clearChats(): void {
  store([]);
}

export function onChatsChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
