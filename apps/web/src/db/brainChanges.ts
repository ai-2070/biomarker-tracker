// Brain's changes, written to the open profile in one transaction, with an exact record for Undo.
// The same pure function as the server (applyChanges) decides what changes, on the data as it is now.
import { applyChanges, type BrainData, type ChangeRequest } from "@bt/shared/core/brainChanges";
import type { BiomarkerDef, Profile } from "@bt/shared/core/types";
import { db, getProfile, LOADED_PROFILE_KEY, newId, type ProfileWriteIdentity, setProfile } from "./db";

type TableName = "measurements" | "protocols" | "experiments" | "plans" | "meals";
const TABLES: readonly TableName[] = ["measurements", "protocols", "experiments", "plans", "meals"];

/** One changed row: what it was before (none = added) and after (none = deleted). */
export type UndoEntry = { table: TableName; key: string; before?: unknown; after?: unknown } | { table: "profile"; before: Profile; after: Profile };

export type BrainWrite =
  | { ok: true; done: string[]; saveOpenCard: boolean; undo: UndoEntry[] }
  | { ok: false; error: string /** Another profile is open: this answer isn't about it. */; otherProfile?: boolean };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function applyBrainChanges(
  request: ChangeRequest,
  context: { userText: string; today: string; identity: ProfileWriteIdentity; defs: ReadonlyMap<string, BiomarkerDef> },
  database = db,
): Promise<BrainWrite> {
  return database.transaction("rw", [database.settings, ...TABLES.map((t) => database[t])], async () => {
    const loaded = (await database.settings.get(LOADED_PROFILE_KEY))?.value;
    const id = typeof loaded === "string" ? loaded : null;
    const profile = await getProfile(database);
    if (id !== context.identity.id || (id === null && profile.name !== context.identity.name))
      return { ok: false, error: "Another profile is open now, so nothing was changed.", otherProfile: true };
    const before: BrainData = {
      measurements: await database.measurements.toArray(),
      protocols: await database.protocols.toArray(),
      experiments: await database.experiments.toArray(),
      plans: await database.plans.toArray(),
      meals: await database.meals.toArray(),
      profile,
    };
    const r = applyChanges(before, request, { userText: context.userText, today: context.today, defs: context.defs, newId });
    if (!r.ok) return { ok: false, error: r.error };
    const undo: UndoEntry[] = [];
    let order = before.measurements.reduce((max, m) => Math.max(max, m.savedOrder ?? 0), 0);
    for (const table of TABLES) {
      const old = new Map<string, { id: string }>(before[table].map((row) => [row.id, row]));
      const next = new Map<string, { id: string }>(r.data[table].map((row) => [row.id, row]));
      for (const [key, row] of next) {
        const was = old.get(key);
        if (was && same(was, row)) continue;
        const written = table === "measurements" && !was ? { ...row, savedOrder: ++order } : row;
        await (database[table] as unknown as { put: (r: unknown) => Promise<unknown> }).put(written);
        undo.push({ table, key, ...(was ? { before: was } : {}), after: written });
      }
      for (const [key, was] of old) {
        if (next.has(key)) continue;
        await database[table].delete(key);
        undo.push({ table, key, before: was });
      }
    }
    if (!same(profile, r.data.profile)) {
      await setProfile(r.data.profile, database);
      undo.push({ table: "profile", before: profile, after: r.data.profile });
    }
    return { ok: true, done: r.done, saveOpenCard: r.saveOpenCard, undo };
  });
}

/**
 * Puts back what a Brain change replaced. Rows edited again since (on a page, or by a later change) are left as
 * they are and counted, so Undo never overwrites newer work.
 */
export async function undoBrainChanges(undo: readonly UndoEntry[], database = db): Promise<{ restored: number; kept: number }> {
  return database.transaction("rw", [database.settings, ...TABLES.map((t) => database[t])], async () => {
    let restored = 0;
    let kept = 0;
    for (const e of [...undo].reverse()) {
      if (e.table === "profile") {
        const now = await getProfile(database);
        if (!same(now, e.after)) {
          kept++;
          continue;
        }
        await setProfile(e.before, database);
        restored++;
        continue;
      }
      const table = database[e.table] as unknown as {
        get: (k: string) => Promise<unknown>;
        put: (r: unknown) => Promise<unknown>;
        delete: (k: string) => Promise<void>;
      };
      if (!same(await table.get(e.key), e.after)) {
        kept++;
        continue;
      }
      if (e.before === undefined) await table.delete(e.key);
      else await table.put(e.before);
      restored++;
    }
    return { restored, kept };
  });
}
