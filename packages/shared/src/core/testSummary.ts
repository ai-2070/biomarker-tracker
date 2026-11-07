/**
 * A summary of one blood test: what was outside its range, what each result usually means, what changed
 * since the previous result, things that can skew a reading, and questions to take to a doctor.
 *
 * Explain, don't diagnose: every sentence comes from the marker and nutrient knowledge files or from
 * the person's own numbers. It never says what the person has, what causes their results or what to take.
 * The model (Brain) gets the same summary, so it explains these facts instead of working them out.
 */
import { rcvBand } from "./experiments";
import type { NutrientDef } from "./nutrients";
import { nutrientFor } from "./plans";
import { isActiveOn } from "./protocols";
import { type Flag, flagMeasurement, isCritical, isOutOfRange, type ResolvedRange, resolveRange, sortByDate } from "./trends";
import type { BiomarkerDef, Measurement, Profile, ProtocolEntry } from "./types";
import { formatValue } from "./units";

export interface SummaryResult {
  id: string;
  name: string;
  category: string;
  measurement: Measurement;
  flag: Flag;
  range?: ResolvedRange;
  /** What a result on this side usually means, from the marker's knowledge file. */
  meaning?: string;
  commonCauses: string[];
  /** The marker's latest result before this test. */
  previous?: { date: string; value: number; flag: Flag };
  /**
   * Compared with the previous result: "new" (in range or no flag before), "closer" or "further" from the
   * range, or "about the same" (within normal test-to-test variation). Undefined without a comparable result.
   */
  change?: "new" | "closer" | "further" | "about the same";
  /** Whether the change is beyond normal test-to-test variation; undefined when that variation isn't known. */
  beyondNormalVariation?: boolean;
  /** Tests in a row (this one included) on the same side of the range. */
  streak: number;
  /** Date of the first test of that streak. */
  streakFrom: string;
}

export interface SummaryCaution {
  kind: "fasting" | "supplement" | "photo" | "typical-range" | "bounded";
  text: string;
  /** Marker ids it concerns. */
  markers: string[];
  /** For supplements: the nutrient page with the evidence. */
  nutrientId?: string;
  /** For supplements: the habit that matched. */
  habit?: string;
}

export interface TestSummary {
  date: string;
  /** Every test date, newest first, for choosing another one. */
  dates: string[];
  results: number;
  inRange: number;
  /** Urgent: contact a doctor before anything else. */
  critical: SummaryResult[];
  /** Outside the range, grouped by category in the given order. */
  outOfRange: { category: string; items: SummaryResult[] }[];
  /** Outside the range last time, inside it now. */
  backInRange: SummaryResult[];
  /** Results without a range to compare with (never called normal). */
  notAssessed: SummaryResult[];
  cautions: SummaryCaution[];
  questions: string[];
  limits: string[];
}

export const SUMMARY_LIMITS: readonly string[] = [
  "This summary says what the numbers are and what each result usually means. It can't tell what is causing them or what they mean for your health: only a doctor who knows you, your history and your other tests can.",
  "Ranges differ between labs and methods; the lab's own range on the report wins.",
  "A single result just outside its range is common in healthy people and often normal on a repeat test. Results far outside it, or outside on several tests, are more likely to matter.",
];

/** Lab-test interferences documented in the nutrient files: the caution sentence is quoted from there. */
const INTERFERENCES: readonly { nutrient: string; markers: readonly string[]; caution: RegExp }[] = [
  { nutrient: "creatine", markers: ["creatinine", "egfr"], caution: /creatinine/i },
  { nutrient: "biotin", markers: ["tsh", "ft4"], caution: /blood tests/i },
];

export interface SummaryInput {
  measurements: readonly Measurement[];
  defs: ReadonlyMap<string, BiomarkerDef>;
  profile: Profile;
  protocols: readonly ProtocolEntry[];
  nutrients: readonly NutrientDef[];
  /** The test to summarise; the latest when missing or not a test date. */
  date?: string;
  /** Category order for the groups (the app's list order). */
  categoryOrder?: readonly string[];
  /** How dates appear in questions. ISO by default. */
  formatDate?: (iso: string) => string;
}

const side = (f: Flag): "high" | "low" | undefined =>
  f === "high" || f === "critical-high" ? "high" : f === "low" || f === "critical-low" ? "low" : undefined;

/** "3.4–5.0", "below 5.0", "above 90" in the canonical unit. */
export function rangeText(range: Pick<ResolvedRange, "low" | "high"> | undefined, unit: string): string | undefined {
  if (!range) return undefined;
  const u = unit === "ratio" ? "" : ` ${unit}`;
  if (range.low !== undefined && range.high !== undefined) return `${formatValue(range.low)}–${formatValue(range.high)}${u}`;
  if (range.high !== undefined) return `below ${formatValue(range.high)}${u}`;
  if (range.low !== undefined) return `above ${formatValue(range.low)}${u}`;
  return undefined;
}

export function valueText(m: Pick<Measurement, "value" | "qualifier">, unit: string): string {
  return `${m.qualifier ?? ""}${formatValue(m.value)}${unit === "ratio" ? "" : ` ${unit}`}`;
}

/** Distance outside the range, as a fraction of the nearer limit (0 inside). */
function outside(value: number, range: ResolvedRange | undefined): number {
  if (!range) return 0;
  if (range.high !== undefined && value > range.high && range.high > 0) return value / range.high - 1;
  if (range.low !== undefined && value < range.low && value > 0) return range.low / value - 1;
  return 0;
}

function compare(def: BiomarkerDef, cur: Measurement, prev: Measurement, curFlag: Flag, prevFlag: Flag, range: ResolvedRange | undefined) {
  if (cur.qualifier || prev.qualifier || !(cur.value > 0) || !(prev.value > 0)) return {};
  if (side(prevFlag) !== side(curFlag)) return { change: "new" as const };
  const rel = cur.value / prev.value - 1;
  const band = def.biologicalVariation ? rcvBand(def.biologicalVariation.cvi) : undefined;
  const beyond = band ? rel > band.up || rel < band.down : undefined;
  if (beyond === false || rel === 0) return { change: "about the same" as const, beyondNormalVariation: false };
  const closer = outside(cur.value, range) < outside(prev.value, resolveRange(def, prev) ?? range);
  return { change: closer ? ("closer" as const) : ("further" as const), ...(beyond !== undefined ? { beyondNormalVariation: beyond } : {}) };
}

export function buildTestSummary(input: SummaryInput): TestSummary | undefined {
  const { defs, profile, protocols, nutrients } = input;
  const fmtDate = input.formatDate ?? ((d: string) => d);
  const blood = input.measurements.filter((m) => {
    const def = defs.get(m.biomarkerId);
    return def && def.category !== "Body";
  });
  const dates = [...new Set(blood.map((m) => m.date))].sort().reverse();
  if (dates.length === 0) return undefined;
  const date = input.date && dates.includes(input.date) ? input.date : dates[0]!;

  // One result per marker on that date: the last saved.
  const onDate = new Map<string, Measurement>();
  for (const m of sortByDate(blood.filter((x) => x.date === date))) onDate.set(m.biomarkerId, m);
  const earlier = (id: string) => sortByDate(blood.filter((m) => m.biomarkerId === id && m.date < date));

  const results: SummaryResult[] = [...onDate.values()].map((m) => {
    const def = defs.get(m.biomarkerId)!;
    const flag = flagMeasurement(def, m, profile);
    const range = resolveRange(def, m, profile);
    const s = side(flag);
    const past = earlier(def.id);
    const prev = past.at(-1);
    const prevFlag = prev ? flagMeasurement(def, prev, profile) : undefined;
    let streak = 1;
    let streakFrom = date;
    if (s) {
      for (let i = past.length - 1; i >= 0 && side(flagMeasurement(def, past[i]!, profile)) === s; i--) {
        streak++;
        streakFrom = past[i]!.date;
      }
    }
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      measurement: m,
      flag,
      ...(range ? { range } : {}),
      ...(s ? { meaning: def[s].meaning } : {}),
      commonCauses: s ? def[s].commonCauses : [],
      ...(prev && prevFlag ? { previous: { date: prev.date, value: prev.value, flag: prevFlag } } : {}),
      ...(s && prev && prevFlag ? compare(def, m, prev, flag, prevFlag, range) : {}),
      streak,
      streakFrom,
    };
  });

  const order = input.categoryOrder ?? [];
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
  const byName = (a: SummaryResult, b: SummaryResult) => a.name.localeCompare(b.name);
  const critical = results.filter((r) => isCritical(r.flag)).sort(byName);
  const out = results.filter((r) => isOutOfRange(r.flag) && !isCritical(r.flag));
  const categories = [...new Set(out.map((r) => r.category))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const outOfRange = categories.map((category) => ({ category, items: out.filter((r) => r.category === category).sort(byName) }));
  const backInRange = results.filter((r) => r.flag === "normal" && r.previous && isOutOfRange(r.previous.flag)).sort(byName);
  const notAssessed = results.filter((r) => r.flag === "unknown").sort(byName);

  const cautions = cautionsFor(results, defs, protocols, nutrients, date);
  return {
    date,
    dates,
    results: results.length,
    inRange: results.filter((r) => r.flag === "normal").length,
    critical,
    outOfRange,
    backInRange,
    notAssessed,
    cautions,
    questions: questionsFor([...critical, ...outOfRange.flatMap((g) => g.items)], cautions, defs, fmtDate),
    limits: [...SUMMARY_LIMITS],
  };
}

const list = (names: readonly string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
/** "haemoglobin" inside a sentence, but "LDL cholesterol" and "C-reactive protein" keep their capitals. */
const inSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function cautionsFor(
  results: readonly SummaryResult[],
  defs: ReadonlyMap<string, BiomarkerDef>,
  protocols: readonly ProtocolEntry[],
  nutrients: readonly NutrientDef[],
  date: string,
): SummaryCaution[] {
  const out: SummaryCaution[] = [];
  const ids = new Set(results.map((r) => r.id));

  const fasting = results.filter((r) => /\bfasting\b/i.test(defs.get(r.id)?.rangeNote ?? "") && r.measurement.fasted !== true);
  if (fasting.length) {
    const marked = fasting.every((r) => r.measurement.fasted === false) ? "is marked as not fasting" : "isn't marked as fasting";
    const names = list(fasting.map((r) => inSentence(r.name)));
    out.push({
      kind: "fasting",
      text: `${names.charAt(0).toUpperCase()}${names.slice(1)} ${fasting.length === 1 ? "is" : "are"} usually judged on a fasting sample, and this test ${marked}, so the fasting range may not apply.`,
      markers: fasting.map((r) => r.id),
    });
  }

  const active = protocols.filter((p) => isActiveOn(p, date));
  for (const rule of INTERFERENCES) {
    const nutrient = nutrients.find((n) => n.id === rule.nutrient);
    const affected = rule.markers.filter((id) => ids.has(id));
    const caution = nutrient?.cautions.find((c) => rule.caution.test(c));
    if (!nutrient || !caution || affected.length === 0) continue;
    const habit = active.find((p) => nutrientFor(p, [nutrient]) || (p.plan?.items ?? []).some((item) => nutrientFor(item, [nutrient])));
    if (habit) out.push({ kind: "supplement", text: caution, markers: affected, nutrientId: nutrient.id, habit: habit.label });
  }

  const photo = results.filter((r) => r.measurement.source === "photo");
  if (photo.length) {
    out.push({
      kind: "photo",
      text: `${photo.length === 1 ? "One result was" : `${photo.length} results were`} read from a photo or a scanned page. Check ${photo.length === 1 ? "it" : "them"} against the paper report.`,
      markers: photo.map((r) => r.id),
    });
  }

  const typical = results.filter((r) => r.range?.source === "default" && r.flag !== "unknown");
  if (typical.length) {
    out.push({
      kind: "typical-range",
      text: `For ${typical.length === 1 ? "one result" : `${typical.length} results`} no lab range was saved, so the app's typical adult range was used. The lab's own range can differ.`,
      markers: typical.map((r) => r.id),
    });
  }

  const bounded = results.filter((r) => r.measurement.qualifier);
  if (bounded.length) {
    out.push({
      kind: "bounded",
      text: `${bounded.length === 1 ? "One result was" : `${bounded.length} results were`} beyond what the lab measures (shown with < or >), so only that side of the range can be judged.`,
      markers: bounded.map((r) => r.id),
    });
  }
  return out;
}

function questionsFor(
  flagged: readonly SummaryResult[],
  cautions: readonly SummaryCaution[],
  defs: ReadonlyMap<string, BiomarkerDef>,
  fmtDate: (iso: string) => string,
): string[] {
  const qs: string[] = [];
  for (const r of flagged) {
    const def = defs.get(r.id)!;
    const s = side(r.flag)!;
    const name = inSentence(def.name);
    if (r.streak >= 2) {
      qs.push(`My ${name} has been ${s} on ${r.streak} tests in a row, since ${fmtDate(r.streakFrom)}. What could explain it, and does it need follow-up?`);
    } else {
      const range = rangeText(r.range, def.canonicalUnit);
      qs.push(
        `My ${name} was ${valueText(r.measurement, def.canonicalUnit)}, ${s === "high" ? "above" : "below"} the range${range ? ` (${range})` : ""}. What could explain it, and should it be re-tested?`,
      );
    }
  }
  for (const c of cautions) {
    if (c.kind !== "supplement" || !c.habit) continue;
    const names = c.markers.map((id) => inSentence(defs.get(id)?.name ?? id));
    qs.push(`I was taking ${c.habit} around this test. Could it affect my ${list(names)} result${names.length === 1 ? "" : "s"}?`);
  }
  qs.push(
    flagged.length
      ? "Which of these results matter most for me, and when should I have the next test?"
      : "Is there anything in these results you'd like to follow up, and when should I have the next test?",
  );
  return qs;
}
