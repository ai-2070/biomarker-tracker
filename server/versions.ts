// Versions: before a skill, agent or team changes (or is deleted), the version it had is kept, with who
// changed it. One JSON file per version in <versions folder>/<id>/. Kept apart from the item itself, so
// a deleted item's versions stay and it can be brought back.
// (Low level, no store imports: store.ts uses it for agents and teams, skills.ts for skills.)
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ensureDir, listFiles, readJSON, uid, writeJSON } from './util.ts';
import { isEffort } from '../shared/effort.ts';

/** Who made a change: you (the page, the API), the Brain, or an agent (its own MEMORY.md). */
export type Actor = 'you' | 'brain' | 'agent';

export interface Version<T = unknown> {
  id: string;
  /** when it was replaced (or deleted) */
  at: number;
  /** who replaced it */
  by: Actor;
  /** this is the last version of an item that was deleted */
  deleted?: boolean;
  /** what was done to it, when that isn't an ordinary edit (e.g. "restored the version from …") */
  note?: string;
  item: T;
}

// Keep this many versions per item.
export const VERSIONS_KEPT = 50;
// Edits on the page by the same one this close together are one change: the version from before the
// first is kept. (A run of withActor, e.g. one answer of the Brain, is one change of its own instead.)
export const COALESCE_MS = 3 * 60_000;

// ---------- who is changing things ----------
// kept: the version this change kept in each version folder (folder -> version id)
const actor = new AsyncLocalStorage<{ by: Actor; note?: string; force?: boolean; kept: Map<string, string> }>();
/** Run fn as one change by `by` (e.g. one answer of the Brain): each item it changes gets one version,
 *  however soon after the last one. force: always keep a version (a restore). */
export function withActor<T>(by: Actor, fn: () => T, { note, force = false }: { note?: string; force?: boolean } = {}): T {
  return actor.run({ by, note, force, kept: new Map() }, fn);
}
export const currentActor = (): Actor => actor.getStore()?.by || 'you';

// ---------- comparing ----------
// The same JSON whatever the key order, without the fields that don't count as a change.
export function canonical(value: unknown, ignore: readonly string[] = []): string {
  const walk = (v: unknown, top: boolean): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, false));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        if (top && ignore.includes(k)) continue;
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = walk(x, false);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value, true));
}

/** The top-level fields that differ between a and b. */
export function changedFields(a: unknown, b: unknown, ignore: readonly string[] = []): string[] {
  const ra = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  const rb = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((k) => !ignore.includes(k) && canonical(ra[k]) !== canonical(rb[k])).sort();
}

// ---------- reading and writing ----------
// When a version was made: never the same as or before the one made just before it (two in the same
// millisecond would otherwise sort by their random ids, and an older one could hide a deletion).
let lastStamp = 0;
// (a time in the future, from data made elsewhere, is never followed: it would push every later version
// into the future too)
const FUTURE_SLACK_MS = 60_000;
// how far ahead of the clock a version made here can be (see stamp)
const STAMP_SLACK_MS = 1000;
const stamp = (after = 0) => (lastStamp = Math.max(Date.now(), lastStamp + 1, after < Date.now() + FUTURE_SLACK_MS ? after + 1 : 0));
/** A version's files kept next to it (a deleted skill's extra files): <dir>/files-<version id>. */
export const versionFilesDir = (dir: string, id: string): string => path.join(dir, `files-${id}`);

/** Every version in dir, newest first. */
export function listVersions<T>(dir: string): Version<T>[] {
  return listFiles(dir, (n) => n.endsWith('.json'))
    .map((n) => readJSON<Version<T>>(path.join(dir, n)))
    .filter((v): v is Version<T> => Boolean(v && v.id && v.item))
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}

export function getVersion<T>(dir: string, id: string): Version<T> | null {
  if (!/^[\w-]+$/.test(String(id))) return null;
  return readJSON<Version<T>>(path.join(dir, `${id}.json`));
}

/** Keep `before` (what an item was until now) in dir, unless it's the same as `after` or part of the
 *  same change as the last version (the same withActor run, or else edits close together). Returns the
 *  version kept, or null. extra: kept with a deleted one besides the item (a skill's extra files).
 *  prune: false leaves old versions for the caller to prune (one it is still reading from, a restore). */
export function keepVersion<T>(dir: string, before: T, after: T | null, { ignore = [], deleted = false, extra, prune = true }: { ignore?: readonly string[]; deleted?: boolean; extra?: Partial<T>; prune?: boolean } = {}): Version<T> | null {
  if (!before) return null;
  if (!deleted && after && canonical(before, ignore) === canonical(after, ignore)) return null;
  const ctx = actor.getStore();
  const by = ctx?.by || 'you';
  const last = listVersions<T>(dir)[0];
  // (a few ms ahead is fine: stamp() moves versions made in the same millisecond on by one each)
  const age = last ? Date.now() - last.at : Infinity;
  const mine = ctx?.kept.get(path.resolve(dir));
  // deleted by the same change that edited it: that change's version (from before it) becomes the
  // deleted one, so one change stays one version
  if (deleted && mine && last && last.id === mine && !last.deleted) {
    const v: Version<T> = { ...last, deleted: true, item: { ...last.item, ...extra } };
    writeJSON(path.join(dir, `${v.id}.json`), v);
    return v;
  }
  if (!deleted && !ctx?.force && (ctx ? mine !== undefined : last && !last.deleted && last.by === by && age > -STAMP_SLACK_MS && age < COALESCE_MS)) return null;
  const v: Version<T> = { id: uid('v'), at: stamp(last?.at), by, ...(deleted ? { deleted: true } : {}), ...(ctx?.note ? { note: ctx.note } : {}), item: { ...before, ...extra } };
  writeJSON(path.join(ensureDir(dir), `${v.id}.json`), v);
  ctx?.kept.set(path.resolve(dir), v.id);
  if (prune) pruneVersions(dir);
  return v;
}

/** Keep only the newest VERSIONS_KEPT versions in dir (and the files kept with each). */
export function pruneVersions(dir: string) {
  for (const old of listVersions(dir).slice(VERSIONS_KEPT)) {
    fs.rmSync(path.join(dir, `${old.id}.json`), { force: true });
    fs.rmSync(versionFilesDir(dir, old.id), { recursive: true, force: true });
  }
}

/** A version read from somewhere else (a project folder, a backup), checked field by field, or null.
 *  vid: the id it was saved under (whatever the version claims); check: the item, cleaned, or null. */
export function checkVersion<T>(raw: unknown, vid: string, check: (item: Record<string, unknown>) => T | null): Version<T> | null {
  if (!/^[\w-]+$/.test(vid) || !raw || typeof raw !== 'object') return null;
  const v = raw as Partial<Version<unknown>>;
  // (a time in the future would make every later edit look like part of the same change, and be dropped)
  if (typeof v.at !== 'number' || !Number.isFinite(v.at) || v.at < 0 || v.at > Date.now() + FUTURE_SLACK_MS || !v.item || typeof v.item !== 'object' || Array.isArray(v.item)) return null;
  const item = check(v.item as Record<string, unknown>);
  if (!item) return null;
  return {
    id: vid,
    at: v.at,
    by: v.by === 'brain' || v.by === 'agent' ? v.by : 'you',
    ...(v.deleted === true ? { deleted: true } : {}),
    ...(typeof v.note === 'string' ? { note: v.note.slice(0, 300) } : {}),
    item,
  };
}

// ---------- agents and teams from elsewhere ----------
// A version made elsewhere (a backup, a project folder) has whatever someone put in it: each known field
// keeps its value only when it has the right type (else it's left out), and one without a name isn't one.
type Fields = Record<string, unknown>;
const isStr = (x: unknown): x is string => typeof x === 'string';
const strList = (x: unknown): string[] | undefined => (Array.isArray(x) && x.every(isStr) ? x : undefined);
function keepTyped(item: Fields, spec: Record<string, (x: unknown) => unknown>): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(item)) {
    if (!(k in spec)) {
      // anything else: plain JSON values only
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'object' && v)) out[k] = v;
      continue;
    }
    const ok = spec[k](v);
    if (ok !== undefined) out[k] = ok;
  }
  return out;
}
const str = (x: unknown) => (isStr(x) ? x : undefined);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const bool = (x: unknown) => (typeof x === 'boolean' ? x : undefined);
const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Fields) : undefined);

/** An agent version made elsewhere, cleaned (see above), as the agent `id`'s; null without a name. */
export function cleanAgentVersion(item: Fields, id: string): Fields | null {
  const out = keepTyped(item, {
    ...Object.fromEntries(['name', 'emoji', 'color', 'specialty', 'description', 'systemPrompt', 'engine', 'model', 'provider', 'claudeAuth', 'hermesProfile', 'openclawAgent', 'autonomy', 'workspace', 'lastModel'].map((k) => [k, str])),
    ...Object.fromEntries(['toolGroups', 'mcpServers', 'alwaysAllow', 'skills'].map((k) => [k, strList])),
    temperature: (x) => (x === '' ? '' : num(x)),
    effort: (x) => (x === '' || isEffort(x) ? x : undefined),
    pinned: bool,
    knowledge: (x) => {
      const k = obj(x);
      return k && strList(k.folders) ? { ...k, folders: k.folders } : undefined;
    },
    source: obj,
  });
  return isStr(out.name) ? { ...out, id } : null;
}

/** A team version made elsewhere, cleaned (see above), as the team `id`'s; null without a name. */
export function cleanTeamVersion(item: Fields, id: string): Fields | null {
  const out = keepTyped(item, {
    ...Object.fromEntries(['name', 'description', 'color', 'createdBy'].map((k) => [k, str])),
    ...Object.fromEntries(['members', 'skills', 'files'].map((k) => [k, strList])),
    lead: (x) => (x === null || isStr(x) ? x : undefined),
    enabled: bool,
    rot: num,
    angle: num,
    lastScheduledAt: num,
    pos: obj,
    access: (x) => {
      const a = obj(x);
      return a ? { toolGroups: strList(a.toolGroups) ?? [], mcpServers: strList(a.mcpServers) ?? [] } : undefined;
    },
    steps: (x) => (Array.isArray(x) ? x.filter((s): s is Fields => !!obj(s) && isStr((s as Fields).type)) : undefined),
    schedule: (x) => {
      const s = obj(x);
      if (!s || !isStr(s.type)) return undefined;
      return keepTyped(s, { type: str, time: str, input: str, minutes: num, days: (d) => (Array.isArray(d) && d.every((n) => typeof n === 'number') ? d : undefined) });
    },
  });
  return isStr(out.name) ? { ...out, id } : null;
}

/** Items with versions whose newest version says they were deleted (and that aren't back): newest first. */
export function deletedIn<T>(root: string, stillThere: (id: string) => boolean): { id: string; version: Version<T> }[] {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  return ids
    .filter((id) => !stillThere(id))
    .map((id) => ({ id, version: listVersions<T>(path.join(root, id))[0] }))
    .filter((x): x is { id: string; version: Version<T> } => Boolean(x.version?.deleted))
    .sort((a, b) => b.version.at - a.version.at);
}
