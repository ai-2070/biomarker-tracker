// Profiles: one folder per person, holding everything about them.
//
//   data/profiles/<id>/
//     profile.json      who this is (name, birth month, sex, height, diet, conditions…)
//     results.json      every result
//     log.json          supplements, diet changes, medicines, habits
//     experiments.json  self-experiments
//     protocols.json    protocols the person follows (Protocols page)
//     settings.json     this profile's display settings (e.g. units)
//     files/            scanned lab reports and other documents
//     files.json        list of those files
//     README.txt        what this folder is
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { cleanProfile, isProfile, parseBackup } from "../src/core/backup";
import { validatePlan, type Plan } from "../src/core/plans";
import { validateMeal, type Meal } from "../src/core/meals";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "../src/core/types";
import { dataPath, getSettings, readJSON, syncDirectory, updateSettings, writeJSON } from "./store";
import { MAX_ZIP_BYTES, MAX_ZIP_EXPANDED_BYTES, readZip, writeZip, type ZipEntry } from "./zip";

export const PROFILES = () => dataPath("profiles");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const MAX_FILE = 50 * 1024 * 1024;

/** File types a profile can keep. */
const FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

export class ProfileError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ProfileFile {
  app: "biomarker-tracker";
  id: string;
  createdAt: string;
  updatedAt: string;
  person: Profile;
}

export interface StoredFile {
  name: string;
  originalName: string;
  size: number;
  type: string;
  addedAt: string;
  /** e.g. "Lab report, 12 results imported". */
  note?: string;
}

export interface ProfileData {
  person: Profile;
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
  /** The Protocols page (protocols.json). */
  plans: Plan[];
  /** Meals (meals.json). */
  meals: Meal[];
  settings: Record<string, unknown>;
}

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

const README = `This folder is one Biomarker Tracker profile: everything about one person.

profile.json      who this is (name, birth month, sex, and other details)
results.json      every blood test result
log.json          supplements, diet changes, medicines and habits
experiments.json  self-experiments
protocols.json    protocols (sets of supplements, foods, exercise you follow)
meals.json        meals you built (foods and grams)
settings.json     display settings for this profile
files/            scanned lab reports and other documents
files.json        list of those files

The app reads and writes these files. You can copy the whole folder to keep a backup,
but don't edit the files while the app is running.
This is health information: keep it somewhere safe.
`;

function dirOf(id: string): string {
  if (!ID_RE.test(id)) throw new ProfileError(400, "That isn't a valid profile.");
  const dir = path.join(PROFILES(), id);
  recoverSave(dir);
  if (!fs.existsSync(path.join(dir, "profile.json"))) throw new ProfileError(404, "No profile with that name.");
  return dir;
}

function slug(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "profile";
}

function newId(name: string): string {
  for (;;) {
    const id = `${slug(name)}-${crypto.randomBytes(2).toString("hex")}`;
    if (!fs.existsSync(path.join(PROFILES(), id))) return id;
  }
}

const readRequired = <T>(dir: string, name: string): T => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as T;
function readMeta(dir: string): ProfileFile {
  const meta = readRequired<ProfileFile>(dir, "profile.json");
  if (meta?.app !== "biomarker-tracker" || !isProfile(meta.person) || !meta.person.name) throw new ProfileError(400, "The profile details on disk are damaged.");
  return meta;
}

const SNAPSHOT_FILES = ["results.json", "log.json", "experiments.json", "protocols.json", "meals.json", "settings.json", "profile.json"] as const;
const JOURNAL = ".save-journal.json";

/** An interrupted save is rolled back before any reader can see the folder. */
function recoverSave(dir: string): void {
  const file = path.join(dir, JOURNAL);
  const text = readJSON<unknown>(file, undefined);
  if (text === undefined) return;
  const journal = text as { previous?: Record<string, string | null> } | null;
  if (!journal?.previous || SNAPSHOT_FILES.some((name) => !Object.hasOwn(journal.previous!, name) || (journal.previous![name] !== null && typeof journal.previous![name] !== "string"))) throw new Error("The profile save journal is damaged.");
  for (const name of SNAPSHOT_FILES) {
    const previous = journal.previous[name];
    if (previous === null) fs.rmSync(path.join(dir, name), { force: true });
    else writeJSON(path.join(dir, name), JSON.parse(previous!));
  }
  fs.unlinkSync(path.join(dir, JOURNAL));
  syncDirectory(dir);
}

type DataInput = { person?: unknown; measurements?: unknown; protocols?: unknown; experiments?: unknown; plans?: unknown; meals?: unknown; settings?: unknown };

function validMeals(v: unknown): Meal[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 1000) throw new ProfileError(400, "The meals are damaged.");
  const ids = new Set<string>();
  for (const m of v) {
    const errors = validateMeal(m);
    if (errors.length) throw new ProfileError(400, `A meal is damaged: ${errors[0]}.`);
    if (ids.has(m.id)) throw new ProfileError(400, "The meals contain duplicate IDs.");
    ids.add(m.id);
  }
  return v as Meal[];
}

function validPlans(v: unknown): Plan[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 200) throw new ProfileError(400, "The protocols are damaged.");
  const ids = new Set<string>();
  for (const p of v) {
    const errors = validatePlan(p);
    if (errors.length) throw new ProfileError(400, `A protocol is damaged: ${errors[0]}.`);
    if (ids.has(p.id)) throw new ProfileError(400, "The protocols contain duplicate IDs.");
    ids.add(p.id);
  }
  return v as Plan[];
}

function validateData(input: DataInput): Omit<ProfileData, "settings"> {
  const person = input.person ?? {};
  if (!isProfile(person)) throw new ProfileError(400, "The person's details are damaged.");
  const r = parseBackup({ app: "biomarker-tracker", version: 2, measurements: input.measurements ?? [], protocols: input.protocols ?? [], experiments: input.experiments ?? [], profile: {} });
  if (!r.ok) throw new ProfileError(400, r.error);
  return { person: cleanProfile(person), measurements: r.backup.measurements, protocols: r.backup.protocols, experiments: r.backup.experiments, plans: validPlans(input.plans), meals: validMeals(input.meals) };
}

function validSettings(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) if (/^[\w.-]{1,40}$/.test(k) && !["profile", "ai", "onboarded"].includes(k)) out[k] = val;
  // Search audits and immutable check history are larger than ordinary display preferences.
  const { claimEvidence, ...preferences } = out;
  if (JSON.stringify(preferences).length > 200_000) throw new ProfileError(400, "Too many settings.");
  if (claimEvidence !== undefined && JSON.stringify(claimEvidence).length > 8_000_000) throw new ProfileError(400, "Evidence history is too large to save in this profile.");
  return out;
}

function writeAll(dir: string, meta: ProfileFile, data: Omit<ProfileData, "settings"> & { settings?: Record<string, unknown> }): void {
  recoverSave(dir);
  const next: Record<(typeof SNAPSHOT_FILES)[number], unknown> = {
    "results.json": data.measurements,
    "log.json": data.protocols,
    "experiments.json": data.experiments,
    "protocols.json": data.plans,
    "meals.json": data.meals,
    "settings.json": data.settings ?? {},
    "profile.json": { ...meta, person: data.person, updatedAt: new Date().toISOString() },
  };
  // Capture every old component and finish serialisation before replacing anything.
  const previous: Record<string, string | null> = {};
  for (const name of SNAPSHOT_FILES) {
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      JSON.parse(text);
      previous[name] = text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      previous[name] = null;
    }
    JSON.stringify(next[name]);
  }
  writeJSON(path.join(dir, JOURNAL), { previous });
  try {
    for (const name of SNAPSHOT_FILES) writeJSON(path.join(dir, name), next[name]);
    // Removing the journal commits the complete generation. A crash before this rolls back.
    fs.unlinkSync(path.join(dir, JOURNAL));
    syncDirectory(dir);
  } catch (error) {
    recoverSave(dir);
    throw error;
  }
}

export function listProfiles(): ProfileSummary[] {
  const root = PROFILES();
  if (!fs.existsSync(root)) return [];
  const out: ProfileSummary[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const dir = path.join(root, e.name);
    recoverSave(dir);
    if (!fs.existsSync(path.join(dir, "profile.json"))) continue;
    const meta = readMeta(dir);
    if (!meta) continue;
    const results = readRequired<Measurement[]>(dir, "results.json");
    out.push({
      id: e.name,
      person: meta.person ?? {},
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      results: results.length,
      lastResult: results.reduce<string | null>((d, m) => (!d || m.date > d ? m.date : d), null),
      files: listFiles(e.name).length,
      folder: dir,
    });
  }
  return out.sort((a, b) => (a.person.name ?? a.id).localeCompare(b.person.name ?? b.id));
}

export function createProfile(input: DataInput): ProfileSummary {
  return createCompleteProfile(input);
}

function createCompleteProfile(input: DataInput, attachments: { originalName: string; data: Buffer; note?: string }[] = []): ProfileSummary {
  const data = validateData(input);
  if (!data.person.name) throw new ProfileError(400, "Give the profile a name.");
  const id = newId(data.person.name);
  fs.mkdirSync(PROFILES(), { recursive: true });
  const staging = fs.mkdtempSync(path.join(PROFILES(), ".restore-"));
  const dir = path.join(PROFILES(), id);
  try {
    fs.mkdirSync(path.join(staging, "files"));
    fs.writeFileSync(path.join(staging, "README.txt"), README);
    writeJSON(path.join(staging, "files.json"), []);
    const now = new Date().toISOString();
    const meta: ProfileFile = { app: "biomarker-tracker", id, createdAt: now, updatedAt: now, person: data.person };
    writeAll(staging, meta, { ...data, settings: validSettings(input.settings) });
    for (const file of attachments) addFileAt(staging, file.originalName, file.data, file.note);
    const summary: ProfileSummary = {
      id, person: data.person, createdAt: now, updatedAt: now, results: data.measurements.length,
      lastResult: data.measurements.reduce<string | null>((d, m) => !d || m.date > d ? m.date : d, null),
      files: attachments.length, folder: dir,
    };
    fs.renameSync(staging, dir);
    return summary;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function getProfileData(id: string): ProfileData {
  const dir = dirOf(id);
  const meta = readMeta(dir)!;
  const measurements = readRequired<unknown>(dir, "results.json");
  const protocols = readRequired<unknown>(dir, "log.json");
  const experiments = readJSON<unknown>(path.join(dir, "experiments.json"), []);
  if (!Array.isArray(measurements) || !Array.isArray(protocols) || !Array.isArray(experiments)) throw new ProfileError(400, "The profile history on disk is damaged.");
  const data = validateData({
    person: meta.person,
    measurements,
    protocols,
    experiments,
    plans: readJSON(path.join(dir, "protocols.json"), []),
    meals: readJSON(path.join(dir, "meals.json"), []),
  });
  return { ...data, settings: validSettings(readJSON(path.join(dir, "settings.json"), {})) };
}

export function saveProfileData(id: string, input: DataInput): void {
  const dir = dirOf(id);
  getProfileData(id); // Never replace a generation whose existing source cannot be read.
  const data = validateData(input);
  if (!data.person.name) throw new ProfileError(400, "A profile needs a name.");
  writeAll(dir, readMeta(dir)!, { ...data, settings: validSettings(input.settings) });
}

export function deleteProfile(id: string): void {
  const dir = dirOf(id);
  fs.rmSync(dir, { recursive: true, force: true });
  if (getSettings().activeProfile === id) updateSettings((s) => delete s.activeProfile);
}

export function activeProfile(): string | null {
  const id = getSettings().activeProfile;
  if (!id || !ID_RE.test(id)) return null;
  const dir = path.join(PROFILES(), id);
  recoverSave(dir);
  return fs.existsSync(path.join(dir, "profile.json")) ? id : null;
}

export function setActiveProfile(id: string): void {
  dirOf(id);
  updateSettings((s) => (s.activeProfile = id));
}

// ---- Files ------------------------------------------------------------------------------------

export function listFiles(id: string): StoredFile[] {
  return listFilesAt(dirOf(id));
}

function listFilesAt(dir: string): StoredFile[] {
  return readJSON<StoredFile[]>(path.join(dir, "files.json"), []).filter((f) => fs.existsSync(path.join(dir, "files", f.name)));
}

/** A safe file name: the original name's letters, with the date in front, never overwriting. */
export function storedName(dir: string, originalName: string, today: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const points = Array.from(path
    .basename(originalName, path.extname(originalName))
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "_")
    .replace(/^[.\s]+/, "")).slice(0, 80);
  // Leave room for the date, extension and collision suffix on byte-limited filesystems.
  let bytes = Buffer.byteLength(points.join(""), "utf8");
  while (bytes > 180) bytes -= Buffer.byteLength(points.pop()!, "utf8");
  const base = points.join("") || "file";
  let name = `${today} ${base}${ext}`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${today} ${base} (${n})${ext}`;
  return name;
}

export function addFile(id: string, originalName: string, data: Buffer, note?: string): StoredFile {
  return addFileAt(dirOf(id), originalName, data, note);
}

function addFileAt(dir: string, originalName: string, data: Buffer, note?: string): StoredFile {
  const ext = path.extname(originalName).toLowerCase();
  const type = FILE_TYPES[ext];
  if (!type) throw new ProfileError(400, "Only PDF, image (PNG, JPG, WebP), text and CSV files can be kept.");
  if (data.length === 0) throw new ProfileError(400, "The file is empty.");
  if (data.length > MAX_FILE) throw new ProfileError(413, "The file is too large (over 50 MB).");
  const filesDir = path.join(dir, "files");
  fs.mkdirSync(filesDir, { recursive: true });
  const name = storedName(filesDir, path.basename(originalName), new Date().toISOString().slice(0, 10));
  fs.writeFileSync(path.join(filesDir, name), data);
  const originalBase = path.basename(originalName, path.extname(originalName));
  const entry: StoredFile = { name, originalName: Array.from(originalBase).slice(0, 200 - ext.length).join("") + ext, size: data.length, type, addedAt: new Date().toISOString(), ...(note ? { note: Array.from(note).slice(0, 200).join("") } : {}) };
  try {
    writeJSON(path.join(dir, "files.json"), [...listFilesAt(dir), entry]);
  } catch (error) {
    fs.rmSync(path.join(filesDir, name), { force: true });
    throw error;
  }
  return entry;
}

function fileOf(id: string, name: string): { file: string; entry: StoredFile } {
  const dir = dirOf(id);
  const entry = listFiles(id).find((f) => f.name === name);
  if (!entry) throw new ProfileError(404, "No file with that name.");
  const file = path.resolve(dir, "files", entry.name);
  if (!file.startsWith(path.resolve(dir, "files") + path.sep)) throw new ProfileError(400, "That isn't a valid file.");
  return { file, entry };
}

export function readFile(id: string, name: string): { data: Buffer; entry: StoredFile } {
  const { file, entry } = fileOf(id, name);
  return { data: fs.readFileSync(file), entry };
}

export function deleteFile(id: string, name: string): void {
  const { file } = fileOf(id, name);
  fs.rmSync(file, { force: true });
  writeJSON(path.join(dirOf(id), "files.json"), listFiles(id));
}

// ---- Backup -----------------------------------------------------------------------------------

/** The whole folder as a zip, inside a folder named after the profile. */
export function backupZip(id: string): { data: Buffer; fileName: string } {
  const dir = dirOf(id);
  getProfileData(id); // Refuse unreadable/corrupt components rather than exporting false history.
  const entries: ZipEntry[] = [];
  let expanded = 0;
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && !e.name.endsWith(".tmp") && !e.name.startsWith(".save-")) {
        const full = path.join(dir, r);
        const stat = fs.statSync(full);
        expanded += stat.size;
        if (expanded > MAX_ZIP_EXPANDED_BYTES) throw new ProfileError(413, "This profile exceeds the 500 MB expanded backup limit. Keep some attachments separately before backing up.");
        entries.push({ name: `${id}/${r}`, data: fs.readFileSync(full), modified: stat.mtime });
      }
    }
  };
  walk("");
  return { data: writeZip(entries), fileName: `biomarker-tracker-${id}-${new Date().toISOString().slice(0, 10)}.zip` };
}

/** Restores a backup zip as a new profile. Everything in it is checked; unknown files are left out. */
export function restoreZip(zip: Buffer): ProfileSummary {
  if (zip.length > MAX_ZIP_BYTES) throw new ProfileError(413, "The backup exceeds the 200 MB upload limit.");
  const entries = readZip(zip);
  const profileEntry = entries.find((e) => /^(?:[^/]+\/)?profile\.json$/.test(e.name));
  if (!profileEntry) throw new ProfileError(400, "This zip isn't a Biomarker Tracker profile backup (no profile.json).");
  const prefix = profileEntry.name.slice(0, -"profile.json".length);
  const json = (name: string, fallback: unknown): unknown => {
    const e = entries.find((x) => x.name === prefix + name);
    if (!e) return fallback;
    try {
      return JSON.parse(e.data.toString("utf8")) as unknown;
    } catch {
      throw new ProfileError(400, `${name} in the backup is damaged.`);
    }
  };
  const meta = json("profile.json", {}) as Partial<ProfileFile>;
  if (meta.app !== "biomarker-tracker") throw new ProfileError(400, "This zip isn't a Biomarker Tracker profile backup.");
  const input: DataInput = {
    person: { ...(meta.person ?? {}), name: meta.person?.name || "Restored profile" },
    measurements: json("results.json", []),
    protocols: json("log.json", []),
    experiments: json("experiments.json", []),
    plans: json("protocols.json", []),
    meals: json("meals.json", []),
    settings: json("settings.json", {}),
  };
  const index = json("files.json", []);
  if (!Array.isArray(index) || index.some((f) => !f || typeof f !== "object" || typeof f.name !== "string" || (f.originalName !== undefined && typeof f.originalName !== "string"))) throw new ProfileError(400, "files.json in the backup is damaged.");
  const listed = index as Partial<StoredFile>[];
  const attachments: { originalName: string; data: Buffer; note?: string }[] = [];
  for (const e of entries) {
    if (!e.name.startsWith(`${prefix}files/`)) continue;
    const name = e.name.slice(`${prefix}files/`.length);
    if (name.includes("/") || !FILE_TYPES[path.extname(name).toLowerCase()]) continue;
    const info = listed.find((f) => f.name === name);
    attachments.push({ originalName: info?.originalName || name, data: e.data, ...(typeof info?.note === "string" ? { note: info.note } : {}) });
  }
  return createCompleteProfile(input, attachments);
}

/** Opens the profile's folder in the computer's file manager. */
export async function revealFolder(id: string): Promise<void> {
  const dir = dirOf(id);
  const [cmd, args]: [string, string[]] = process.platform === "win32" ? ["explorer.exe", [dir]] : process.platform === "darwin" ? ["open", [dir]] : ["xdg-open", [dir]];
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => reject(new ProfileError(500, "Couldn't open the folder. Open it manually from its path instead.")));
  child.once("spawn", () => {
    child.unref();
    resolve();
  });
  await promise;
}
