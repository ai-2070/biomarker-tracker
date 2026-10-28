import { isIsoDate } from "./dates";
import { isBirthMonth } from "./phenoageDraws";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "./types";

export const BACKUP_APP = "biomarker-tracker";
/** 2 added experiments (v0.8). Version 1 files are still accepted. */
export const BACKUP_VERSION = 2;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  profile: Profile;
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
}

export function createBackup(
  data: { profile: Profile; measurements: Measurement[]; protocols: ProtocolEntry[]; experiments: Experiment[] },
  now: Date,
): Backup {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    profile: data.profile,
    measurements: data.measurements,
    protocols: data.protocols,
    experiments: data.experiments,
  };
}

export type ParseBackupResult = { ok: true; backup: Backup } | { ok: false; error: string };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optional = (v: unknown, check: (x: unknown) => boolean) => v === undefined || check(v);

function isRange(v: unknown): boolean {
  return isObj(v) && optional(v.low, isNum) && optional(v.high, isNum);
}

function isMeasurement(v: unknown): v is Measurement {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.biomarkerId) &&
    isNum(v.value) &&
    isNum(v.originalValue) &&
    isStr(v.originalUnit) &&
    isStr(v.date) &&
    isIsoDate(v.date) &&
    (v.source === "manual" || v.source === "pdf" || v.source === "csv") &&
    optional(v.qualifier, (q) => q === "<" || q === ">") &&
    optional(v.lab, isStr) &&
    optional(v.labRange, isRange) &&
    optional(v.fasted, (f) => typeof f === "boolean") &&
    optional(v.note, isStr)
  );
}

const PROTOCOL_CATEGORIES = new Set(["supplement", "diet", "medication", "lifestyle"]);

function isProtocol(v: unknown): v is ProtocolEntry {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.label) &&
    isStr(v.category) &&
    PROTOCOL_CATEGORIES.has(v.category) &&
    isStr(v.start) &&
    isIsoDate(v.start) &&
    optional(v.end, (e) => isStr(e) && isIsoDate(e))
  );
}

function isExperiment(v: unknown): v is Experiment {
  return (
    isObj(v) &&
    isStr(v.id) &&
    isStr(v.change) &&
    isStr(v.category) &&
    PROTOCOL_CATEGORIES.has(v.category) &&
    Array.isArray(v.markerIds) &&
    v.markerIds.every(isStr) &&
    isStr(v.start) &&
    isIsoDate(v.start) &&
    isNum(v.retestAfterDays) &&
    optional(v.end, (e) => isStr(e) && isIsoDate(e)) &&
    optional(v.protocolId, isStr)
  );
}

function isProfile(v: unknown): v is Profile {
  return (
    isObj(v) &&
    optional(v.sex, (s) => s === "m" || s === "f") &&
    optional(v.birthMonth, (b) => isStr(b) && isBirthMonth(b))
  );
}

/** Keep only known profile fields. */
function cleanProfile(p: Profile): Profile {
  return {
    ...(p.sex ? { sex: p.sex } : {}),
    ...(p.birthMonth ? { birthMonth: p.birthMonth } : {}),
  };
}

/** Validate a parsed JSON value as a backup file. Never trusts the input. */
export function parseBackup(json: unknown): ParseBackupResult {
  if (!isObj(json) || json.app !== BACKUP_APP) {
    return { ok: false, error: "This file is not a Biomarker Tracker backup." };
  }
  if (!isNum(json.version) || json.version > BACKUP_VERSION) {
    return { ok: false, error: "This backup was made by a newer version of the app. Please update first." };
  }
  if (!Array.isArray(json.measurements)) {
    return { ok: false, error: "The backup has no measurements list." };
  }
  const bad = json.measurements.findIndex((m) => !isMeasurement(m));
  if (bad >= 0) {
    return { ok: false, error: `Measurement number ${bad + 1} in the backup is damaged or incomplete.` };
  }
  const protocols = json.protocols ?? [];
  if (!Array.isArray(protocols) || !protocols.every(isProtocol)) {
    return { ok: false, error: "The protocol list in the backup is damaged." };
  }
  const experiments = json.experiments ?? [];
  if (!Array.isArray(experiments) || !experiments.every(isExperiment)) {
    return { ok: false, error: "The experiments in the backup are damaged." };
  }
  const profile = json.profile ?? {};
  if (!isProfile(profile)) {
    return { ok: false, error: "The profile in the backup is damaged." };
  }
  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      version: json.version,
      exportedAt: isStr(json.exportedAt) ? json.exportedAt : "",
      profile: cleanProfile(profile),
      measurements: json.measurements as Measurement[],
      protocols: protocols as ProtocolEntry[],
      experiments: experiments as Experiment[],
    },
  };
}
