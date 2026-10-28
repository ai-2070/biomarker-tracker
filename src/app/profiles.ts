// Profiles in the page. With the local server, each profile is a folder on this computer and this
// browser holds a working copy of the open one: every change is saved to the folder shortly after.
// Without the server (a static copy of the app) there is one profile, kept in this browser.
import { createContext, useContext, useSyncExternalStore } from "react";
import { liveQuery } from "dexie";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "../core/types";
import { createBackup } from "../core/backup";
import { todayIso } from "../core/dates";
import { demoProfile } from "../core/demo";
import { profilesInFolder, zipStore } from "../core/zipStore";
import { db, getProfile, importBackup, setOnboarded } from "../db/db";
import { api } from "./api";

export interface ProfileSummary {
  id: string;
  person: Profile;
  createdAt: string;
  updatedAt: string;
  results: number;
  lastResult: string | null;
  files: number;
  folder: string;
}

export interface StoredFile {
  name: string;
  originalName: string;
  size: number;
  type: string;
  addedAt: string;
  note?: string;
}

interface ProfileData {
  person: Profile;
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
  settings: Record<string, unknown>;
}

/** Which folder the data in this browser belongs to. */
const LOADED_KEY = "loadedProfile";
/** Settings that belong to this browser, not to a person. */
const BROWSER_KEYS = new Set(["profile", "onboarded", "ai", LOADED_KEY]);

export interface ProfilesState {
  /** "folders": the local server keeps profiles. "browser": one profile in this browser. */
  mode: "folders" | "browser";
  profiles: ProfileSummary[];
  active: ProfileSummary | null;
  refresh: () => Promise<void>;
}

export const ProfilesContext = createContext<ProfilesState>({ mode: "browser", profiles: [], active: null, refresh: async () => {} });
export const useProfiles = () => useContext(ProfilesContext);

export const listProfiles = () => api<{ profiles: ProfileSummary[]; active: string | null; root: string }>("GET", "/api/profiles");

export async function loadedProfileId(): Promise<string | null> {
  const v = (await db.settings.get(LOADED_KEY))?.value;
  return typeof v === "string" ? v : null;
}

/** Everything in this browser, as saved to a profile folder. */
export async function browserData(): Promise<ProfileData> {
  const [measurements, protocols, experiments, person, settings] = await Promise.all([
    db.measurements.toArray(),
    db.protocols.toArray(),
    db.experiments.toArray(),
    getProfile(),
    db.settings.toArray(),
  ]);
  return { person, measurements, protocols, experiments, settings: Object.fromEntries(settings.filter((s) => !BROWSER_KEYS.has(s.key)).map((s) => [s.key, s.value])) };
}

/** Replaces this browser's copy with a profile from its folder. */
export async function loadIntoBrowser(id: string): Promise<void> {
  const d = await api<ProfileData>("GET", `/api/profiles/${id}/data`);
  await db.transaction("rw", [db.measurements, db.protocols, db.experiments, db.settings], async () => {
    await Promise.all([db.measurements.clear(), db.protocols.clear(), db.experiments.clear()]);
    const keep = (await db.settings.toArray()).filter((s) => s.key === "ai");
    await db.settings.clear();
    await db.measurements.bulkPut(d.measurements);
    await db.protocols.bulkPut(d.protocols);
    await db.experiments.bulkPut(d.experiments);
    await db.settings.bulkPut([
      ...keep,
      ...Object.entries(d.settings).map(([key, value]) => ({ key, value })),
      { key: "profile", value: d.person },
      { key: "onboarded", value: true },
      { key: LOADED_KEY, value: id },
    ]);
  });
}

export async function markLoaded(id: string): Promise<void> {
  await db.settings.put({ key: LOADED_KEY, value: id });
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

let syncing: { id: string; timer?: ReturnType<typeof setTimeout>; dirty: boolean; unsubscribe: () => void } | null = null;

async function push(): Promise<void> {
  const s = syncing;
  if (!s || !s.dirty) return;
  s.dirty = false;
  setStatus("saving");
  try {
    await api("PUT", `/api/profiles/${s.id}/data`, await browserData());
    if (!s.dirty) setStatus("saved");
  } catch {
    s.dirty = true;
    setStatus("error");
    // Try again shortly (e.g. the server was restarted).
    clearTimeout(s.timer);
    s.timer = setTimeout(() => void push(), 5000);
  }
}

/** Saves every change in this browser to the profile's folder, half a second after it happens. */
export function startSaving(id: string): () => void {
  stopSaving();
  let first = true;
  const sub = liveQuery(() => browserData()).subscribe({
    next: () => {
      // The first value is what was just loaded; nothing to save yet.
      if (first) {
        first = false;
        return;
      }
      if (!syncing) return;
      syncing.dirty = true;
      setStatus("saving");
      clearTimeout(syncing.timer);
      syncing.timer = setTimeout(() => void push(), 500);
    },
  });
  syncing = { id, dirty: false, unsubscribe: () => sub.unsubscribe() };
  return stopSaving;
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
    await push();
  }
}

// ---- Switching --------------------------------------------------------------------------------

/** Opens another profile: saves this one, loads the other, and starts the page fresh. */
export async function switchProfile(id: string, to = "#/"): Promise<void> {
  await flushSaving();
  stopSaving();
  await api("PUT", "/api/profiles/active", { id });
  await loadIntoBrowser(id);
  location.hash = to;
  location.reload();
}

/** Creates a profile folder. With `fromBrowser`, the data already in this browser goes into it. */
export async function createProfile(person: Profile, opts: { fromBrowser?: boolean } = {}): Promise<ProfileSummary> {
  await flushSaving();
  stopSaving();
  const data = opts.fromBrowser ? { ...(await browserData()), person } : { person };
  const { profile } = await api<{ profile: ProfileSummary }>("POST", "/api/profiles", data);
  if (opts.fromBrowser) {
    await db.settings.put({ key: "profile", value: person });
    await markLoaded(profile.id);
  } else await loadIntoBrowser(profile.id);
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
  location.hash = to;
  location.reload();
}

/**
 * Creates a profile filled with made-up example data (src/core/demo.ts) and opens it.
 * In a browser-only copy of the app it replaces what is in this browser, so only offer it there when it's empty.
 */
export async function createExampleProfile(mode: "folders" | "browser", to = "#/"): Promise<void> {
  const d = demoProfile(todayIso());
  if (mode === "folders") {
    await flushSaving();
    stopSaving();
    const { profile } = await api<{ profile: ProfileSummary }>("POST", "/api/profiles", d);
    await openLoaded(profile.id, to);
    return;
  }
  await importBackup(createBackup({ profile: d.person, measurements: d.measurements, protocols: d.protocols, experiments: d.experiments }, new Date()), "replace");
  await setOnboarded();
  location.hash = to;
  location.reload();
}

/** Restores a backup zip as a new profile and opens it. */
export async function restoreProfile(file: File, to = "#/"): Promise<void> {
  await flushSaving();
  stopSaving();
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
  stopSaving();
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
  const res = await fetch(`/api/profiles/${profileId}/files?${q}`, { method: "POST", headers: { "x-bt": "1", "content-type": file.type || "application/octet-stream" }, body: file });
  const body = (await res.json().catch(() => ({}))) as { file?: StoredFile; error?: string };
  if (!res.ok || !body.file) throw new Error(body.error ?? "The file couldn't be saved.");
  return body.file;
}

export const fileUrl = (profileId: string, name: string, download = false) =>
  `/api/profiles/${profileId}/files/${encodeURIComponent(name)}${download ? "?download" : ""}`;
