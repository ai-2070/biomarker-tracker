// Shared data types. See CLAUDE.md "Data model".
import type { Plan } from "./plans";

export type Sex = "m" | "f";

export type StudyType =
  | "meta-analysis"
  | "rct"
  | "observational"
  | "animal"
  | "in vitro"
  | "review"
  | "guideline";

export interface Citation {
  pmid?: string;
  doi?: string;
  title: string;
  year: number;
  studyType: StudyType;
  n?: number;
}

/** Link from a biomarker to an entry in /knowledge/evidence. */
export interface EvidenceRef {
  evidenceId: string;
}

// Food composition (/knowledge/foods)

export interface FoodItem {
  /** Source table code, e.g. CoFID "13-524". */
  id: string;
  name: string;
  /** Exact name in the source table. */
  cofidName: string;
  /** Example portion chosen for this app. */
  portion: { grams: number; label: string };
  /** Measured values per 100 g. Missing = not measured; never guessed. */
  per100g: Record<string, number>;
}

export interface FoodTable {
  source: { name: string; publisher: string; url: string; licence: string; notes: string };
  nutrients: Record<string, { label: string; unit: string }>;
  foods: FoodItem[];
}

/**
 * How to turn a value in some unit into the canonical unit:
 * a plain number is a multiplier; an object is `value * factor + offset`
 * (needed for HbA1c, where IFCC mmol/mol and NGSP % are not proportional).
 */
export type Conversion = number | { factor: number; offset: number };

export interface RangeDef {
  low?: number;
  high?: number;
  /** Omit for a range that applies to everyone. */
  sex?: Sex;
  /**
   * Only for readings taken fasting (true) or after a meal (false), e.g. home glucose.
   * A range without it is used when the reading's state isn't given.
   */
  fasted?: boolean;
  /** Only from this age (years, inclusive), e.g. body fat or sleep, whose ranges change with age. */
  ageFrom?: number;
  /** Only below this age (years, exclusive). */
  ageTo?: number;
}

export type BiomarkerCategory =
  | "Blood count"
  | "Metabolic"
  | "Lipids"
  | "Kidney"
  /** Lab tests on a urine sample (albumin-to-creatinine ratio…). Imported only from rows that name urine or sit under a urine heading. */
  | "Urine"
  | "Liver"
  | "Thyroid"
  | "Iron & vitamins"
  | "Electrolytes"
  | "Inflammation"
  /** Measures of how fast the body ages from a specialised blood test (DunedinPACE). */
  | "Aging"
  /** Not a blood test: weight, waist, blood pressure, heart rate. */
  | "Body";

export interface BiomarkerDef {
  id: string;
  name: string;
  /** Short abbreviation, e.g. "HbA1c". Shown with its full name once. */
  abbreviation?: string;
  category: BiomarkerCategory;
  aliases: string[];
  loinc?: string[];
  canonicalUnit: string;
  conversions: Record<string, Conversion>;
  /** Typical adult ranges in the canonical unit. Labs differ; their own range wins. */
  defaultRanges?: RangeDef[];
  /** Default ranges are descriptive comparisons, not clinical flag limits. Lab and critical limits still apply. */
  comparisonOnly?: boolean;
  /** Values beyond these (canonical unit) show an urgent "contact a doctor" banner. */
  criticalRange?: { low?: number; high?: number; lowInclusive?: boolean; highInclusive?: boolean };
  /** Extra context for the range, e.g. "fasting". */
  rangeNote?: string;
  /**
   * Judge the range on the average of this many days, never on one reading (sleep: one short night
   * isn't a problem). Single readings are then only flagged when critical.
   */
  judgeAverageOfDays?: number;
  /**
   * Judge the range on the total of this many days (active minutes: the WHO advice is per week). Values
   * are stored per day; the range is for the total, so single days are only flagged when critical.
   */
  judgeSumOfDays?: number;
  /** No population range: the person's own usual range is shown instead (HRV). See `personalRange.ts`. */
  personalRange?: boolean;
  /**
   * How a habit watch compares before and after: "ratio" (default, percent change on the log scale) or
   * "difference" (plain difference, for values that can be zero or negative, like the PhenoAge gap).
   */
  changeScale?: "ratio" | "difference";
  summary: string;
  high: { meaning: string; commonCauses: string[] };
  low: { meaning: string; commonCauses: string[] };
  affectedBy: EvidenceRef[];
  /** Within-person variation from test to test, used to tell real change from noise. */
  biologicalVariation?: BiologicalVariation;
  sources: Citation[];
}

export interface BiologicalVariation {
  /** Within-subject biological variation (CVI), % (median of the meta-analysis). */
  cvi: number;
  ciLow: number;
  ciHigh: number;
  /** Number of studies in the meta-analysis. */
  studies: number;
  /** Analyte name in the source database. */
  analyte: string;
  matrix: string;
  source: string;
  url: string;
  retrieved: string;
}

/** A self-experiment: one change, some markers, before vs after. */
export interface Experiment {
  id: string;
  /** What changes, e.g. "2 kiwis a day". Also the label of the linked log entry. */
  change: string;
  category: ProtocolEntry["category"];
  markerIds: string[];
  /** Date the change started (ISO). */
  start: string;
  /** Re-test this many days after the start. */
  retestAfterDays: number;
  /** Set when the user ends the experiment. */
  end?: string;
  /** The log entry created for this change, so it shows on charts. */
  protocolId?: string;
  /** When the markers were picked (ISO). Picked after the "after" results existed = a hint, not a test. */
  chosenOn?: string;
}

/** Recorded local sleep-window bounds. Local ISO timestamps have no guessed time zone. */
export interface SleepSession {
  /** YYYY-MM-DDTHH:mm:ss[.SSS], in the source's local clock. */
  start: string;
  end: string;
  /** Minutes east of UTC, only when the source supplies them (may differ across daylight saving). */
  startOffsetMinutes?: number;
  endOffsetMinutes?: number;
  /** A session or in-bed boundary must not be described as the exact moment of falling asleep. */
  kind: "asleep" | "in-bed" | "session";
  /** Stable device/provider label, when known; not the person's name. */
  source?: string;
}

export interface Measurement {
  id: string;
  /** Monotonic save order in this profile; disambiguates readings on the same sample date. */
  savedOrder?: number;
  biomarkerId: string;
  /** In the biomarker's canonical unit. */
  value: number;
  originalValue: number;
  originalUnit: string;
  /** Set when the lab reported "<x" or ">x" (e.g. below detection limit). */
  qualifier?: "<" | ">";
  /** ISO date (YYYY-MM-DD) of the blood sample. */
  date: string;
  lab?: string;
  /** In the canonical unit. */
  labRange?: { low?: number; high?: number };
  fasted?: boolean;
  /** "photo": read from a photo or a scanned PDF (by text recognition before 2026-11-05, by Brain since). */
  /** "device": read from a watch or phone app's export file. */
  source: "manual" | "pdf" | "csv" | "photo" | "device";
  note?: string;
  /** Imported sleep windows on the waking date; only on sleep_duration. Never inferred from hours. */
  sleepSessions?: SleepSession[];
}

export interface ProtocolEntry {
  id: string;
  label: string;
  category: "supplement" | "diet" | "medication" | "lifestyle";
  start: string;
  end?: string;
  /** The protocol as it was when started. Kept even if its source is edited or deleted. */
  plan?: Pick<Plan, "id" | "items">;
}

export type EvidenceGrade = "high" | "moderate" | "low" | "very low";
export type SafetyId = "anticoagulant" | "antiplatelet" | "diabetes" | "pregnancy" | "kidney";

/** A graded statement about what affects a marker. /knowledge/evidence/*.json */
export interface EvidenceClaim {
  id: string;
  /** Short lever shown as the title, e.g. "Tea or coffee between meals, not with them". */
  lever: string;
  intervention: string;
  /** Whole food, overall diet, isolated supplement or habit. Never mixed in one claim. */
  kind: "food" | "diet" | "supplement" | "habit";
  /** The outcome that was actually measured, e.g. "Iron absorption from a meal". */
  outcome: string;
  direction: "increase" | "decrease" | "no effect" | "mixed";
  grade: EvidenceGrade;
  whyThisGrade: string[];
  /** Plain-language summary of what the evidence shows, including its limits. */
  summary: string;
  /** Which markers this is relevant to, and when. */
  markers: { biomarkerId: string; helpsWhen: "low" | "high" }[];
  /** Foods to list with measured amounts of one nutrient (from /knowledge/foods). */
  foods?: { nutrient: string; foodIds: string[]; note?: string };
  caution?: string;
  /** Hide entirely when the user's log has one of these (see safetyNotes()). */
  hideWhen?: SafetyId[];
  studies: Citation[];
}

export type Diet = "omnivore" | "vegetarian" | "vegan" | "pescatarian" | "other";
export type Smoking = "never" | "former" | "current";
export type HeightUnit = "cm" | "ft/in";

/** The person a profile belongs to. */
export interface Profile {
  /** Shown in the app only. Never sent to an AI model. */
  name?: string;
  /** Used to pick sex-specific reference ranges. */
  sex?: Sex;
  /** "YYYY-MM". Used for age (PhenoAge, the assistant). The assistant gets the age, never the month. */
  birthMonth?: string;
  heightCm?: number;
  /** Preferred height-entry units. The value itself is always kept in heightCm. */
  heightUnit?: HeightUnit;
  /** Where the person lives, as Eurostat writes it ("HU", "DE", "EL"): picks the life table for "Best before". */
  country?: string;
  diet?: Diet;
  smoking?: Smoking;
  /** Free text, e.g. "type 2 diabetes, hypothyroidism". Also checked by safetyNotes(). */
  conditions?: string;
  allergies?: string;
  /** Private notes. Never sent to an AI model. */
  notes?: string;
  /** Made-up example data (see packages/shared/src/core/demo.ts); the app labels it everywhere. */
  example?: boolean;
}
