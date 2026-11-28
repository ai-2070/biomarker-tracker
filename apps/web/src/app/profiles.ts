// Profiles in the page. With the local server, each profile is a folder on this computer and this
// browser holds a working copy of the open one: every change is saved to the folder shortly after.
// Without the server (a static copy of the app) there is one profile, kept in this browser.

import type { ProfileData, ProfileSummary, StoredFile } from "@bt/shared/api/types";
import { createBackup, parseBackup } from "@bt/shared/core/backup";
import { checkInsError } from "@bt/shared/core/checkIns";
import { todayIso } from "@bt/shared/core/dates";
import { demoProfile } from "@bt/shared/core/demo";
import { validateMeal } from "@bt/shared/core/meals";
import { validatePlan } from "@bt/shared/core/plans";
import type { Profile } from "@bt/shared/core/types";
import { profilesInFolder, zipStore } from "@bt/shared/core/zipStore";
import { liveQuery } from "dexie";
import { createContext, useContext, useSyncExternalStore } from "react";
import { db, deleteEverything, getProfile, importBackup, LOADED_PROFILE_KEY, setOnboarded } from "../db/db";
import { localServer } from "./api";

export type { ProfileSummary, StoredFile };

/** Settings that belong to this browser, not to a person. */
const BROWSER_KEYS = new Set(["profile", "onboarded", "ai", LOADED_PROFILE_KEY]);

export interface ProfilesState {
  /** "folders": the local server keeps profiles. "browser": one profile in this browser. */
  mode: "folders" | "browser";
  profiles: ProfileSummary[];
  active: ProfileSummary | null;
  refresh: () => Promise<void>;
}

export const ProfilesContext = createContext<ProfilesState>({ mode: "browser", profiles: [], active: null, refresh: async () => {} });
export const useProfiles = () => useContext(ProfilesContext);

export const listProfiles = () => localServer.profiles.list.query();

export async function loadedProfileId(): Promise<string | null> {
  const v = (await db.settings.get(LOADED_PROFILE_KEY))?.value;
  return typeof v === "string" ? v : null;
}

/** Everything in this browser, as saved to a profile folder. */
export async function browserData(expectedId?: string): Promise<ProfileData> {
  return db.transaction("r", [db.measurements, db.protocols, db.experiments, db.plans, db.meals, db.checkins, db.settings], async () => {
    if (expectedId !== undefined && (await loadedProfileId()) !== expectedId)
      throw new Error("Another profile owns this browser's working copy. Reload before editing.");
    const [measurements, protocols, experiments, plans, meals, checkins, person, settings] = await Promise.all([
      db.measurements.toArray(),
      db.protocols.toArray(),
      db.experiments.toArray(),
      db.plans.toArray(),
      db.meals.toArray(),
      db.checkins.toArray(),
      getProfile(),
      db.settings.toArray(),
    ]);
    return {
      person,
      measurements,
      protocols,
      experiments,
      plans,
      meals,
      checkins,
      settings: Object.fromEntries(settings.filter((s) => !BROWSER_KEYS.has(s.key)).map((s) => [s.key, s.value])),
    };
  });
}

/** One editable folder-backed working copy per origin, including profile switches in other tabs. */
let workingCopyLock: Promise<void> | undefined;
export function claimWorkingCopy(): Promise<void> {
  if (workingCopyLock) return workingCopyLock;
  if (!navigator.locks) return Promise.reject(new Error("Folder profiles need a browser with Web Locks support. Use a current browser on localhost."));
  // The app's ES2023 browser baseline predates Promise.withResolvers.
  const promise = new Promise<void>((resolve, reject) => {
    void navigator.locks
      .request("biomarker-tracker-working-copy", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error("This app is already open in another tab. Close that tab, then reload this one to edit profiles."));
          return;
        }
        resolve();
        // The browser releases this lock when the page closes or reloads.
        await new Promise<void>(() => {});
      })
      .catch(reject);
  });
  workingCopyLock = promise;
  return promise;
}

/** Include every person-owned table and setting, not just blood results, in migration decisions. */
export async function hasBrowserData(): Promise<boolean> {
  const d = await browserData();
  return (
    d.measurements.length + d.protocols.length + d.experiments.length + d.plans.length + d.meals.length + d.checkins.length > 0 ||
    Object.values(d.person).some((v) => v !== undefined && v !== "") ||
    Object.keys(d.settings).length > 0
  );
}

/** Replaces this browser's copy with a profile from its folder. */
export async function loadIntoBrowser(id: string): Promise<void> {
  const d = await localServer.profiles.data.query({ id });
  const checked = parseBackup(
    createBackup({ profile: d.person, measurements: d.measurements, protocols: d.protocols, experiments: d.experiments }, new Date()),
  );
  if (!checked.ok) throw new Error(checked.error);
  for (const [label, rows, validate] of [
    ["protocols", d.plans ?? [], validatePlan],
    ["meals", d.meals ?? [], validateMeal],
  ] as const) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length || rows.some((row) => validate(row).length > 0)) {
      throw new Error(`The profile's ${label} list is damaged or contains duplicate IDs.`);
    }
  }
  const checkinsProblem = checkInsError(d.checkins ?? []);
  if (checkinsProblem) throw new Error(checkinsProblem);
  await flushSaving();
  const previous = syncing?.id;
  stopSaving();
  try {
    await db.transaction("rw", [db.measurements, db.protocols, db.experiments, db.plans, db.meals, db.checkins, db.settings], async () => {
      await Promise.all([db.measurements.clear(), db.protocols.clear(), db.experiments.clear(), db.plans.clear(), db.meals.clear(), db.checkins.clear()]);
      const keep = (await db.settings.toArray()).filter((s) => s.key === "ai");
      await db.settings.clear();
      await db.measurements.bulkPut(d.measurements);
      await db.protocols.bulkPut(d.protocols);
      await db.experiments.bulkPut(d.experiments);
      await db.plans.bulkPut(d.plans ?? []);
      await db.meals.bulkPut(d.meals ?? []);
      await db.checkins.bulkPut(d.checkins ?? []);
      await db.settings.bulkPut([
        ...keep,
        ...Object.entries(d.settings).map(([key, value]) => ({ key, value })),
        { key: "profile", value: d.person },
        { key: "onboarded", value: true },
        { key: LOADED_PROFILE_KEY, value: id },
      ]);
    });
  } catch (error) {
    if (previous) startSaving(previous);
    throw error;
  }
}

export async function markLoaded(id: string): Promise<void> {
  await db.settings.put({ key: LOADED_PROFILE_KEY, value: id });
  await db.settings.put({ key: "onboarded", value: true });
}

// ---- Saving to the folder ---------------------------------------------------------------------

export type SaveStatus = "saved" | "saving" | "error";
let status: SaveStatus = "saved";
const listeners = new Set<() => void>();
const setStatus = (s: SaveStatus) => {
  status = s;
  for (const l of listeners) l();
};
/** Whether the latest changes are in the profile folder yet. */
export const useSaveStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );

interface Saver {
  id: string;
  timer?: ReturnType<typeof setTimeout>;
  dirty: boolean;
  inFlight?: Promise<void>;
  unsubscribe: () => void;
  /** Each part as the folder last acknowledged it; unknown (send everything) at first and after a failure. */
  saved?: Record<string, string>;
}

/** Each part of the working copy as text, to tell which parts changed since the last save. */
export function profileParts(data: ProfileData): Record<string, string> {
  return Object.fromEntries(Object.entries(data).map(([part, value]) => [part, JSON.stringify(value)]));
}

/** The parts that differ from what the folder has. */
export function changedParts(now: Record<string, string>, saved: Record<string, string>): string[] {
  return Object.keys(now).filter((part) => now[part] !== saved[part]);
}
let syncing: Saver | null = null;

/** Single-flight writes; a flush drains changes made while an earlier write is pending. */
async function push(): Promise<void> {
  const s = syncing;
  if (!s) return;
  if (s.inFlight) return s.inFlight;
  s.inFlight = (async () => {
    while (syncing === s && s.dirty) {
      s.dirty = false;
      setStatus("saving");
      const data = await browserData(s.id);
      const now = profileParts(data);
      if (!s.saved) {
        // The first save after loading, or after a failure: the whole working copy (reconciliation).
        await localServer.profiles.save.mutate({ id: s.id, data });
      } else {
        // Otherwise only what changed: years of daily device readings aren't re-sent for one new result.
        const changed = changedParts(now, s.saved);
        if (changed.length)
          await localServer.profiles.saveParts.mutate({ id: s.id, parts: Object.fromEntries(changed.map((part) => [part, data[part as keyof ProfileData]])) });
      }
      s.saved = now;
    }
    if (syncing === s) setStatus("saved");
  })()
    .catch((error: unknown) => {
      if (syncing === s) {
        s.dirty = true;
        // The folder may have part of a save, or none: the next attempt sends everything.
        s.saved = undefined;
        setStatus("error");
        clearTimeout(s.timer);
        s.timer = setTimeout(() => void push().catch(() => {}), 5000);
      }
      throw error;
    })
    .finally(() => {
      s.inFlight = undefined;
    });
  return s.inFlight;
}

/** Always reconcile the retained local copy on startup, including edits pending at last reload. */
export function startSaving(id: string): () => void {
  stopSaving();
  const s: Saver = { id, dirty: true, unsubscribe: () => {} };
  syncing = s;
  const sub = liveQuery(() => browserData(id)).subscribe({
    next: () => {
      if (syncing !== s) return;
      s.dirty = true;
      setStatus("saving");
      clearTimeout(s.timer);
      s.timer = setTimeout(() => void push().catch(() => {}), 500);
    },
    error: () => {
      if (syncing === s) {
        stopSaving();
        setStatus("error");
      }
    },
  });
  s.unsubscribe = () => sub.unsubscribe();
  return () => {
    if (syncing === s) stopSaving();
  };
}

function stopSaving(): void {
  if (!syncing) return;
  clearTimeout(syncing.timer);
  syncing.unsubscribe();
  syncing = null;
}

/** Saves anything not yet in the folder, now. */
export async function flushSaving(): Promise<void> {
  if (syncing) {
    clearTimeout(syncing.timer);
    // Capture edits even if Dexie's live-query notification has not run yet.
    syncing.dirty = true;
    await push();
  }
}

// ---- Switching --------------------------------------------------------------------------------

/** Opens another profile: saves this one, loads the other, and starts the page fresh. */
export async function switchProfile(id: string, to = "#/"): Promise<void> {
  await flushSaving();
  await localServer.profiles.setActive.mutate({ id });
  await loadIntoBrowser(id);
  startSaving(id);
  location.hash = to;
  location.reload();
}

/** Deletion also removes the recovery copy, so it cannot migrate into another person's profile. */
export async function deleteProfileFolder(id: string): Promise<{ active: string | null }> {
  const open = (await loadedProfileId()) === id;
  if (open) await flushSaving();
  const result = await localServer.profiles.remove.mutate({ id });
  if (open) {
    stopSaving();
    await deleteEverything();
  }
  return result;
}

/** Creates a profile folder. With `fromBrowser`, the data already in this browser goes into it. */
export async function createProfile(person: Profile, opts: { fromBrowser?: boolean } = {}): Promise<ProfileSummary> {
  await flushSaving();
  const data = opts.fromBrowser ? { ...(await browserData()), person } : { person };
  const { profile } = await localServer.profiles.create.mutate(data);
  if (opts.fromBrowser) {
    await flushSaving();
    const previous = syncing?.id;
    stopSaving();
    try {
      await db.transaction("rw", db.settings, async () => {
        await db.settings.put({ key: "profile", value: person });
        await markLoaded(profile.id);
      });
    } catch (error) {
      if (previous) startSaving(previous);
      throw error;
    }
  } else await loadIntoBrowser(profile.id);
  startSaving(profile.id);
  return profile;
}

async function restoreZip(zip: Blob): Promise<ProfileSummary> {
  const res = await fetch("/api/profiles/restore", { method: "POST", headers: { "x-bt": "1", "content-type": "application/zip" }, body: zip });
  const body = (await res.json().catch(() => ({}))) as { profile?: ProfileSummary; error?: string };
  if (!res.ok || !body.profile) throw new Error(body.error ?? "The profile couldn't be loaded.");
  return body.profile;
}

async function openLoaded(id: string, to: string): Promise<void> {
  await loadIntoBrowser(id);
  startSaving(id);
  location.hash = to;
  location.reload();
}

/**
 * Creates a profile filled with made-up example data (packages/shared/src/core/demo.ts) and opens it.
 * In a browser-only copy of the app it replaces what is in this browser, so only offer it there when it's empty.
 */
export async function createExampleProfile(mode: "folders" | "browser", to = "#/"): Promise<void> {
  const d = demoProfile(todayIso());
  if (mode === "folders") {
    await flushSaving();
    const { profile } = await localServer.profiles.create.mutate(d);
    await openLoaded(profile.id, to);
    return;
  }
  await importBackup(
    createBackup({ profile: d.person, measurements: d.measurements, protocols: d.protocols, experiments: d.experiments }, new Date()),
    "replace",
  );
  await db.transaction("rw", [db.plans, db.meals, db.checkins], async () => {
    await Promise.all([db.plans.clear(), db.meals.clear(), db.checkins.clear()]);
    await db.plans.bulkPut(d.plans);
    await db.meals.bulkPut(d.meals);
    await db.checkins.bulkPut(d.checkins);
  });
  await setOnboarded();
  location.hash = to;
  location.reload();
}

/** Restores a backup zip as a new profile and opens it. */
export async function restoreProfile(file: File, to = "#/"): Promise<void> {
  await flushSaving();
  const p = await restoreZip(file);
  await openLoaded(p.id, to);
}

/**
 * Loads profile folders chosen in the browser (one profile folder, or a folder with several, e.g. a copied
 * "profiles" folder). Each becomes a new profile; the last one is opened.
 */
export async function loadProfileFolder(list: FileList, to = "#/"): Promise<void> {
  const files = Array.from(list).map((f) => ({ path: (f.webkitRelativePath || f.name).replace(/\\/g, "/"), f }));
  const found = profilesInFolder(files);
  if (found.length === 0) throw new Error("No profile in that folder. Choose a folder that has a profile.json file in it (or a folder of such folders).");
  const total = found.reduce((n, p) => n + p.files.reduce((m, x) => m + x.file.f.size, 0), 0);
  if (total > 190 * 1024 * 1024) throw new Error("That folder is too large to load at once. Load the profiles one at a time.");
  await flushSaving();
  let last: ProfileSummary | null = null;
  for (const p of found) {
    const entries = await Promise.all(p.files.map(async ({ name, file }) => ({ name, data: new Uint8Array(await file.f.arrayBuffer()) })));
    last = await restoreZip(new Blob([zipStore(entries) as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
  }
  await openLoaded(last!.id, to);
}

/** Keeps a scanned report or other document in the open profile's folder. */
export async function uploadFile(profileId: string, file: File, note?: string): Promise<StoredFile> {
  const q = new URLSearchParams({ name: file.name, ...(note ? { note } : {}) });
  const res = await fetch(`/api/profiles/${profileId}/files?${q}`, {
    method: "POST",
    headers: { "x-bt": "1", "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as { file?: StoredFile; error?: string };
  if (!res.ok || !body.file) throw new Error(body.error ?? "The file couldn't be saved.");
  return body.file;
}

export const fileUrl = (profileId: string, name: string, download = false) =>
  `/api/profiles/${profileId}/files/${encodeURIComponent(name)}${download ? "?download" : ""}`;
