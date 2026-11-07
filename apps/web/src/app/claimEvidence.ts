import {
  CLAIM_CATEGORIES,
  type ClaimCategory,
  type ClaimCheck,
  type ClaimDepth,
  type ClaimRequest,
  type ClaimUpdate,
  claimRunKey,
  publicClaimTopic,
  publicInterventionId,
  validateClaimAssessment,
  validateClaimResearch,
} from "@bt/shared/core/claimEvidence";
import { countNewClaimStudies } from "@bt/shared/research/claimUpdates";
import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { db, LOADED_PROFILE_KEY, type TrackerDB } from "../db/db";
import { localServer } from "./api";

export const CLAIM_EVIDENCE_KEY = "claimEvidence";

export interface ClaimRecordUpdate {
  request: ClaimRequest;
  forCheckedAt: string;
  attemptedAt: string;
  result?: ClaimUpdate;
  error?: string;
}
interface CustomClaimTopic extends ClaimRequest {
  category?: ClaimCategory;
}
export interface ClaimEvidenceCache {
  version: 1;
  checks: ClaimCheck[];
  customTopics: CustomClaimTopic[];
  updates: ClaimRecordUpdate[];
  /** Failed attempts keep their audit without replacing a successful assessment. */
  attempts?: ClaimCheck[];
  /** Completed results archived in full when a rerun replaces them. */
  history?: ClaimCheck[];
}
interface Identity {
  loaded: string | null;
  browser: string;
  epoch: number;
}
export interface ClaimEvidenceSnapshot {
  cache: ClaimEvidenceCache;
  identity: Identity;
  damaged: boolean;
  error?: string;
}
const empty = (): ClaimEvidenceCache => ({ version: 1, checks: [], customTopics: [], updates: [] });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max;
function timestamp(value: unknown, now: Date): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === (value.length === 20 ? `${value.slice(0, -1)}.000Z` : value) && Date.parse(value) <= now.getTime() + 300_000;
}
const requestIsValid = (value: unknown): value is ClaimRequest =>
  object(value) && publicInterventionId(value.nutrientId) && text(value.claim, 180) && text(value.topic, 100);
export const sameClaim = (a: ClaimRequest, b: ClaimRequest): boolean => a.nutrientId === b.nutrientId && a.claim === b.claim && a.topic === b.topic;

/** Reject malformed, future-dated or unsupported cache records rather than inventing a result. */
export function validClaimCheck(value: unknown, now = new Date()): value is ClaimCheck {
  if (
    !object(value) ||
    !requestIsValid(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !timestamp(value.checkedAt, now) ||
    !text(value.model, 200) ||
    !Array.isArray(value.citations)
  )
    return false;
  try {
    const assessment = validateClaimAssessment(
      { verdict: value.verdict, grade: value.grade, summary: value.summary, limitations: value.limitations, citations: value.citations },
      value.citations,
    );
    if (value.version === 2) {
      if (!object(value.research)) return false;
      validateClaimResearch(value.research as unknown as NonNullable<ClaimCheck["research"]>, assessment);
    }
    return true;
  } catch {
    return false;
  }
}
function validUpdate(value: unknown, now: Date): value is ClaimRecordUpdate {
  if (!object(value) || !requestIsValid(value.request) || !timestamp(value.forCheckedAt, now) || !timestamp(value.attemptedAt, now)) return false;
  if (value.error !== undefined && !text(value.error, 1000)) return false;
  if (value.result === undefined) return true;
  const result = value.result;
  return (
    object(result) &&
    Number.isSafeInteger(result.count) &&
    Number(result.count) >= 0 &&
    timestamp(result.checkedAt, now) &&
    result.since === value.forCheckedAt &&
    text(result.query, 4000)
  );
}
function parseCache(value: unknown, now: Date): { cache: ClaimEvidenceCache; damaged: boolean } {
  if (value === undefined) return { cache: empty(), damaged: false };
  if (!object(value) || value.version !== 1 || !Array.isArray(value.checks) || !Array.isArray(value.customTopics) || !Array.isArray(value.updates))
    return { cache: empty(), damaged: true };
  const checks: ClaimCheck[] = [];
  const customTopics: CustomClaimTopic[] = [];
  const updates: ClaimRecordUpdate[] = [];
  const attempts: ClaimCheck[] = [];
  const history: ClaimCheck[] = [];
  let damaged = value.checks.length > 100 || value.customTopics.length > 30 || value.updates.length > 100;
  for (const check of value.checks.slice(0, 100)) {
    if (!validClaimCheck(check, now) || checks.some((c) => sameClaim(c, check))) {
      damaged = true;
      continue;
    }
    checks.push(check);
  }
  for (const topic of value.customTopics.slice(0, 30)) {
    if (!requestIsValid(topic) || topic.claim !== topic.topic || !publicClaimTopic(topic.topic) || customTopics.some((c) => sameClaim(c, topic))) {
      damaged = true;
      continue;
    }
    const category = (topic as CustomClaimTopic).category;
    if (category !== undefined && !CLAIM_CATEGORIES.includes(category)) {
      damaged = true;
      customTopics.push({ nutrientId: topic.nutrientId, claim: topic.claim, topic: topic.topic });
    } else customTopics.push(topic);
  }
  for (const update of value.updates.slice(0, 100)) {
    if (
      !validUpdate(update, now) ||
      !checks.some((c) => sameClaim(c, update.request) && c.checkedAt === update.forCheckedAt) ||
      updates.some((u) => sameClaim(u.request, update.request))
    ) {
      damaged = true;
      continue;
    }
    updates.push(update);
  }
  if (value.attempts !== undefined) {
    if (!Array.isArray(value.attempts)) damaged = true;
    else
      for (const attempt of value.attempts.slice(0, 100)) {
        if (!validClaimCheck(attempt, now) || attempt.research?.status !== "search_failed" || attempts.some((c) => sameClaim(c, attempt))) {
          damaged = true;
          continue;
        }
        attempts.push(attempt);
      }
  }
  if (value.history !== undefined) {
    if (!Array.isArray(value.history)) damaged = true;
    else {
      const seen = new Set(checks.map(claimRunKey));
      for (const entry of value.history) {
        if (!validClaimCheck(entry, now) || entry.research?.status === "search_failed") {
          damaged = true;
          continue;
        }
        const key = claimRunKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        history.push(entry);
      }
    }
  }
  return {
    cache: {
      version: 1,
      checks,
      customTopics,
      updates,
      ...(value.attempts !== undefined ? { attempts } : {}),
      ...(value.history !== undefined ? { history } : {}),
    },
    damaged,
  };
}

// A replacement can have the same name and folder ID. Observe local replacement writes too;
// this epoch is in memory only and never becomes part of a backup or model request.
const guards = new WeakMap<TrackerDB, { epoch: number; active: Set<AbortController> }>();
function guard(database: TrackerDB) {
  const previous = guards.get(database);
  if (previous) return previous;
  const state = { epoch: 0, active: new Set<AbortController>() };
  const changed = () => {
    state.epoch++;
    for (const controller of state.active) controller.abort();
  };
  const identityKey = (key: unknown) => key === "profile" || key === LOADED_PROFILE_KEY;
  database.settings.hook("creating", (_key, row) => {
    if (identityKey(row.key)) changed();
  });
  database.settings.hook("updating", (_changes, key) => {
    if (identityKey(key)) changed();
  });
  database.settings.hook("deleting", (key) => {
    if (identityKey(key) || key === CLAIM_EVIDENCE_KEY) changed();
  });
  guards.set(database, state);
  return state;
}
async function identity(database: TrackerDB): Promise<Identity> {
  const [loaded, profile] = await Promise.all([database.settings.get(LOADED_PROFILE_KEY), database.settings.get("profile")]);
  const id = typeof loaded?.value === "string" ? loaded.value : null;
  return { loaded: id, browser: id === null ? JSON.stringify(profile?.value ?? {}) : "", epoch: guard(database).epoch };
}
function sameIdentity(a: Identity, b: Identity) {
  return a.loaded === b.loaded && a.browser === b.browser && a.epoch === b.epoch;
}
export async function readClaimEvidence(database = db, now = new Date()): Promise<ClaimEvidenceSnapshot> {
  guard(database);
  return database.transaction("r", database.settings, async () => ({
    ...parseCache((await database.settings.get(CLAIM_EVIDENCE_KEY))?.value, now),
    identity: await identity(database),
  }));
}
export function useClaimEvidence(): ClaimEvidenceSnapshot | undefined {
  return useLiveQuery(async () => {
    try {
      return await readClaimEvidence();
    } catch {
      return {
        cache: empty(),
        identity: { loaded: null, browser: "", epoch: -1 },
        damaged: false,
        error: "Local evidence could not be read. Reload this page to try again.",
      };
    }
  }, []);
}
interface Options {
  database?: TrackerDB;
  signal?: AbortSignal;
  expectedIdentity?: Identity;
  now?: Date;
}
async function writeIfCurrent(
  owner: Identity,
  signal: AbortSignal,
  database: TrackerDB,
  now: Date,
  change: (cache: ClaimEvidenceCache) => void,
): Promise<void> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    await database.transaction("rw", database.settings, async () => {
      const transaction = Dexie.currentTransaction!;
      onAbort = () => {
        if (transaction.active) transaction.abort();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      signal.throwIfAborted();
      if (!sameIdentity(owner, await identity(database))) throw new Error("The profile changed. Open this page again before checking evidence.");
      const { cache } = parseCache((await database.settings.get(CLAIM_EVIDENCE_KEY))?.value, now);
      change(cache);
      signal.throwIfAborted();
      await database.settings.put({ key: CLAIM_EVIDENCE_KEY, value: cache });
      signal.throwIfAborted();
    });
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
async function withOwner<T>(options: Options, work: (owner: Identity, signal: AbortSignal, database: TrackerDB) => Promise<T>): Promise<T> {
  const database = options.database ?? db;
  const state = guard(database);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  state.active.add(controller);
  try {
    controller.signal.throwIfAborted();
    const owner = await database.transaction("r", database.settings, () => identity(database));
    if (options.expectedIdentity && !sameIdentity(owner, options.expectedIdentity))
      throw new Error("The profile changed. Open this page again before checking evidence.");
    controller.signal.throwIfAborted();
    return await work(owner, controller.signal, database);
  } finally {
    options.signal?.removeEventListener("abort", abort);
    state.active.delete(controller);
  }
}

/** Explicit action only. Sends just the public claim, not Brain's conversation or a profile. */
export async function checkClaimEvidence(
  request: ClaimRequest,
  options: Options & { custom?: boolean; category?: ClaimCategory; depth?: ClaimDepth } = {},
): Promise<ClaimCheck> {
  if (!requestIsValid(request)) throw new Error("This research topic is not valid.");
  if (options.category !== undefined && !CLAIM_CATEGORIES.includes(options.category)) throw new Error("Choose Health, Longevity or Appearance.");
  const publicRequest = { nutrientId: request.nutrientId, claim: request.claim, topic: request.topic };
  return withOwner(options, async (owner, signal, database) => {
    if (options.custom) {
      if (request.claim !== request.topic || publicClaimTopic(request.topic) !== request.topic)
        throw new Error("Use a short public topic, without personal details, such as sleep.");
      await writeIfCurrent(owner, signal, database, options.now ?? new Date(), (cache) => {
        const previous = cache.customTopics.find((c) => sameClaim(c, request));
        if (previous) {
          if (options.category !== undefined) previous.category = options.category;
        } else {
          if (cache.customTopics.length >= 30) throw new Error("You can keep up to 30 custom topics.");
          cache.customTopics.push(options.category === undefined ? publicRequest : { ...publicRequest, category: options.category });
        }
      });
    }
    // The server checks the answer as well; it is validated again here before anything is saved.
    const result: unknown = await localServer.claimEvidence.check.mutate({ ...publicRequest, ...(options.depth ? { depth: options.depth } : {}) }, { signal });
    const now = options.now ?? new Date();
    if (!validClaimCheck(result, now) || !sameClaim(result, request))
      throw new Error("Brain returned an incomplete evidence check. Your previous check has been kept; try again.");
    await writeIfCurrent(owner, signal, database, now, (cache) => {
      if (result.research?.status === "search_failed") {
        cache.attempts = [...(cache.attempts ?? []).filter((c) => !sameClaim(c, request)), result];
        return;
      }
      const previous = cache.checks.find((c) => sameClaim(c, request));
      const archive = (entry: ClaimCheck) => {
        const key = claimRunKey(entry);
        if (!cache.history?.some((item) => claimRunKey(item) === key)) cache.history = [...(cache.history ?? []), entry];
      };
      if (previous && claimRunKey(previous) === claimRunKey(result)) return;
      if (previous && Date.parse(previous.checkedAt) > Date.parse(result.checkedAt)) {
        archive(result);
        return;
      }
      if (previous) archive(previous);
      cache.checks = [...cache.checks.filter((c) => !sameClaim(c, request)), result];
      if (cache.attempts) cache.attempts = cache.attempts.filter((c) => !sameClaim(c, request) || Date.parse(c.checkedAt) > Date.parse(result.checkedAt));
      cache.updates = cache.updates.filter((u) => !sameClaim(u.request, request));
    });
    return result;
  });
}

// One queue for metadata calls across all mounted claim rows, including a fast page reopen.
let updateQueue: Promise<unknown> = Promise.resolve();
export function refreshClaimUpdates(request: ClaimRequest, options: Options = {}): Promise<void> {
  const publicRequest = { nutrientId: request.nutrientId, claim: request.claim, topic: request.topic };
  const work = updateQueue
    .catch(() => {})
    .then(() =>
      withOwner(options, async (owner, signal, database) => {
        const now = options.now ?? new Date();
        let since: string | undefined;
        await writeIfCurrent(owner, signal, database, now, (cache) => {
          const check = cache.checks.find((c) => sameClaim(c, request));
          if (!check) return;
          const previous = cache.updates.find((u) => sameClaim(u.request, request) && u.forCheckedAt === check.checkedAt);
          if (previous && previous.attemptedAt.slice(0, 10) === now.toISOString().slice(0, 10)) return;
          since = check.checkedAt;
          cache.updates = [
            ...cache.updates.filter((u) => !sameClaim(u.request, request)),
            { request: publicRequest, forCheckedAt: since, attemptedAt: now.toISOString() },
          ];
        });
        if (!since) return;
        let result: ClaimUpdate | undefined;
        let error: string | undefined;
        try {
          result = await countNewClaimStudies(publicRequest, since, { signal, now });
        } catch (e) {
          signal.throwIfAborted();
          error = e instanceof Error ? e.message.trim().slice(0, 1000) || "New-record check unavailable." : "New-record check unavailable.";
        }
        await writeIfCurrent(owner, signal, database, now, (cache) => {
          const update = cache.updates.find((u) => sameClaim(u.request, request) && u.forCheckedAt === since);
          if (!update || !cache.checks.some((c) => sameClaim(c, request) && c.checkedAt === since)) return;
          if (result) update.result = result;
          if (error) update.error = error;
        });
      }),
    );
  updateQueue = work;
  return work;
}
