// Shared data types. See CLAUDE.md "Data model".

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
}

export type BiomarkerCategory =
  | "Blood count"
  | "Metabolic"
  | "Lipids"
  | "Kidney"
  | "Liver"
  | "Thyroid"
  | "Iron & vitamins"
  | "Electrolytes"
  | "Inflammation"
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
  /** Values beyond these (canonical unit) show an urgent "contact a doctor" banner. */
  criticalRange?: { low?: number; high?: number };
  /** Extra context for the range, e.g. "fasting". */
  rangeNote?: string;
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

export interface Measurement {
  id: string;
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
  /** "photo": read by text recognition from a photo or a scanned PDF. */
  source: "manual" | "pdf" | "csv" | "photo";
  note?: string;
}

export interface ProtocolEntry {
  id: string;
  label: string;
  category: "supplement" | "diet" | "medication" | "lifestyle";
  start: string;
  end?: string;
}

export type EvidenceGrade = "high" | "moderate" | "low" | "very low";
export type SafetyId = "anticoagulant" | "diabetes" | "pregnancy" | "kidney";

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

/** The person a profile belongs to. */
export interface Profile {
  /** Shown in the app only. Never sent to an AI model. */
  name?: string;
  /** Used to pick sex-specific reference ranges. */
  sex?: Sex;
  /** "YYYY-MM". Used for age (PhenoAge, the assistant). The assistant gets the age, never the month. */
  birthMonth?: string;
  heightCm?: number;
  diet?: Diet;
  smoking?: Smoking;
  /** Free text, e.g. "type 2 diabetes, hypothyroidism". Also checked by safetyNotes(). */
  conditions?: string;
  allergies?: string;
  /** Private notes. Never sent to an AI model. */
  notes?: string;
  /** Made-up example data (see src/core/demo.ts); the app labels it everywhere. */
  example?: boolean;
}
