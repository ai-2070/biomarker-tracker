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
import type { Experiment, Measurement, Profile, ProtocolEntry } from "../src/core/types";
import { dataPath, getSettings, readJSON, updateSettings, writeJSON } from "./store";
import { readZip, writeZip, type ZipEntry } from "./zip";

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

const readMeta = (dir: string) => readJSON<ProfileFile | null>(path.join(dir, "profile.json"), null);

type DataInput = { person?: unknown; measurements?: unknown; protocols?: unknown; experiments?: unknown; plans?: unknown; settings?: unknown };

function validPlans(v: unknown): Plan[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 200) throw new ProfileError(400, "The protocols are damaged.");
  for (const p of v) if (validatePlan(p).length) throw new ProfileError(400, `A protocol is damaged: ${validatePlan(p)[0]}.`);
  return v as Plan[];
}

function validateData(input: DataInput): Omit<ProfileData, "settings"> {
  const person = input.person ?? {};
  if (!isProfile(person)) throw new ProfileError(400, "The person's details are damaged.");
  const r = parseBackup({ app: "biomarker-tracker", version: 2, measurements: input.measurements ?? [], protocols: input.protocols ?? [], experiments: input.experiments ?? [], profile: {} });
  if (!r.ok) throw new ProfileError(400, r.error);
  return { person: cleanProfile(person), measurements: r.backup.measurements, protocols: r.backup.protocols, experiments: r.backup.experiments, plans: validPlans(input.plans) };
}

function validSettings(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) if (/^[\w.-]{1,40}$/.test(k) && !["profile", "ai", "onboarded"].includes(k)) out[k] = val;
  if (JSON.stringify(out).length > 200_000) throw new ProfileError(400, "Too many settings.");
  return out;
}

function writeAll(dir: string, meta: ProfileFile, data: Omit<ProfileData, "settings"> & { settings?: Record<string, unknown> }): void {
  writeJSON(path.join(dir, "results.json"), data.measurements);
  writeJSON(path.join(dir, "log.json"), data.protocols);
  writeJSON(path.join(dir, "experiments.json"), data.experiments);
  writeJSON(path.join(dir, "protocols.json"), data.plans);
  if (data.settings) writeJSON(path.join(dir, "settings.json"), data.settings);
  writeJSON(path.join(dir, "profile.json"), { ...meta, person: data.person, updatedAt: new Date().toISOString() });
}

export function listProfiles(): ProfileSummary[] {
  const root = PROFILES();
  if (!fs.existsSync(root)) return [];
  const out: ProfileSummary[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const dir = path.join(root, e.name);
    const meta = readMeta(dir);
    if (!meta) continue;
    const results = readJSON<Measurement[]>(path.join(dir, "results.json"), []);
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
  const data = validateData(input);
  if (!data.person.name) throw new ProfileError(400, "Give the profile a name.");
  const id = newId(data.person.name);
  const dir = path.join(PROFILES(), id);
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.txt"), README);
  writeJSON(path.join(dir, "files.json"), []);
  const now = new Date().toISOString();
  writeAll(dir, { app: "biomarker-tracker", id, createdAt: now, updatedAt: now, person: data.person }, { ...data, settings: validSettings(input.settings) });
  return listProfiles().find((p) => p.id === id)!;
}

export function getProfileData(id: string): ProfileData {
  const dir = dirOf(id);
  const meta = readMeta(dir)!;
  return {
    person: meta.person ?? {},
    measurements: readJSON(path.join(dir, "results.json"), []),
    protocols: readJSON(path.join(dir, "log.json"), []),
    experiments: readJSON(path.join(dir, "experiments.json"), []),
    plans: readJSON(path.join(dir, "protocols.json"), []),
    settings: readJSON(path.join(dir, "settings.json"), {}),
  };
}

export function saveProfileData(id: string, input: DataInput): void {
  const dir = dirOf(id);
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
  return id && ID_RE.test(id) && fs.existsSync(path.join(PROFILES(), id, "profile.json")) ? id : null;
}

export function setActiveProfile(id: string): void {
  dirOf(id);
  updateSettings((s) => (s.activeProfile = id));
}

// ---- Files ------------------------------------------------------------------------------------

export function listFiles(id: string): StoredFile[] {
  const dir = path.join(PROFILES(), id);
  return readJSON<StoredFile[]>(path.join(dir, "files.json"), []).filter((f) => fs.existsSync(path.join(dir, "files", f.name)));
}

/** A safe file name: the original name's letters, with the date in front, never overwriting. */
export function storedName(dir: string, originalName: string, today: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const base = path
    .basename(originalName, path.extname(originalName))
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "_")
    .replace(/^[.\s]+/, "")
    .slice(0, 80) || "file";
  let name = `${today} ${base}${ext}`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${today} ${base} (${n})${ext}`;
  return name;
}

export function addFile(id: string, originalName: string, data: Buffer, note?: string): StoredFile {
  const dir = dirOf(id);
  const ext = path.extname(originalName).toLowerCase();
  const type = FILE_TYPES[ext];
  if (!type) throw new ProfileError(400, "Only PDF, image (PNG, JPG, WebP), text and CSV files can be kept.");
  if (data.length === 0) throw new ProfileError(400, "The file is empty.");
  if (data.length > MAX_FILE) throw new ProfileError(413, "The file is too large (over 50 MB).");
  const filesDir = path.join(dir, "files");
  fs.mkdirSync(filesDir, { recursive: true });
  const name = storedName(filesDir, path.basename(originalName), new Date().toISOString().slice(0, 10));
  fs.writeFileSync(path.join(filesDir, name), data);
  const entry: StoredFile = { name, originalName: path.basename(originalName).slice(0, 200), size: data.length, type, addedAt: new Date().toISOString(), ...(note ? { note: note.slice(0, 200) } : {}) };
  writeJSON(path.join(dir, "files.json"), [...listFiles(id), entry]);
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
  const entries: ZipEntry[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && !e.name.endsWith(".tmp")) {
        const full = path.join(dir, r);
        entries.push({ name: `${id}/${r}`, data: fs.readFileSync(full), modified: fs.statSync(full).mtime });
      }
    }
  };
  walk("");
  return { data: writeZip(entries), fileName: `biomarker-tracker-${id}-${new Date().toISOString().slice(0, 10)}.zip` };
}

/** Restores a backup zip as a new profile. Everything in it is checked; unknown files are left out. */
export function restoreZip(zip: Buffer): ProfileSummary {
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
  const created = createProfile({
    person: { ...(meta.person ?? {}), name: meta.person?.name || "Restored profile" },
    measurements: json("results.json", []),
    protocols: json("log.json", []),
    experiments: json("experiments.json", []),
    plans: json("protocols.json", []),
    settings: json("settings.json", {}),
  });
  const index = json("files.json", []);
  const listed = Array.isArray(index) ? (index as Partial<StoredFile>[]) : [];
  for (const e of entries) {
    if (!e.name.startsWith(`${prefix}files/`)) continue;
    const name = e.name.slice(`${prefix}files/`.length);
    if (name.includes("/") || !FILE_TYPES[path.extname(name).toLowerCase()]) continue;
    const info = listed.find((f) => f.name === name);
    addFile(created.id, info?.originalName || name, e.data, typeof info?.note === "string" ? info.note : undefined);
  }
  return listProfiles().find((p) => p.id === created.id)!;
}

/** Opens the profile's folder in the computer's file manager. */
export function revealFolder(id: string): void {
  const dir = dirOf(id);
  const [cmd, args] = process.platform === "win32" ? ["explorer.exe", [dir]] : process.platform === "darwin" ? ["open", [dir]] : ["xdg-open", [dir]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}
