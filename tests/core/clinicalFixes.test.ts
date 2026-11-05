import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeMarker, personalBand, t95 } from "@bt/shared/core/experiments";
import { phenoAgePace } from "@bt/shared/core/agePace";
import { bodySummary } from "@bt/shared/core/bodySummary";
import { ageMatch, describePlace, fitnessSummary, placeInRow, placeResult, type FitnessTestDef } from "@bt/shared/core/fitnessTests";
import { framinghamRisk, heartAgeData } from "@bt/shared/core/heartAge";
import { personalRange } from "@bt/shared/core/personalRange";
import { summarizePhenoAge } from "@bt/shared/core/phenoageDraws";
import { dayNumber } from "@bt/shared/core/dates";
import { timeTicks } from "@bt/shared/core/timeWindow";
import { computeTrend, flagLatest, flagMeasurement, flagValue, isAlreadySaved, latestByBiomarker, recentAverage, recentTotal, sortByDate } from "@bt/shared/core/trends";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "@bt/shared/core/types";
import { def, measurement } from "../helpers";

const m = (biomarkerId: string, date: string, value: number, extra: Partial<Measurement> = {}) => measurement({ biomarkerId, date, value, ...extra });
const balance = JSON.parse(readFileSync(new URL("../../knowledge/fitness/one_leg_stand.json", import.meta.url), "utf8")) as FitnessTestDef;
const date = (day: number) => new Date(Date.UTC(2026, 8, day)).toISOString().slice(0, 10);
const profile: Profile = { sex: "f", birthMonth: "1976-10", heightCm: 170, smoking: "never" };
const heartReadings = [m("weight", "2026-10-29", 70), m("bp_systolic", "2026-10-29", 125), m("bp_diastolic", "2026-10-29", 80)];
const experiment: Experiment = { id: "clinical", change: "Own recorded change", category: "lifestyle", markerIds: ["crp_hs", "pushups"], start: "2026-09-01", retestAfterDays: 28 };

describe("clinical review: critical and qualified results", () => {
  it.each([["bp_systolic", 180], ["bp_diastolic", 120]] as const)("includes the documented %s emergency boundary only", (id, threshold) => {
    const d = def(id);
    expect(flagMeasurement(d, m(id, date(1), threshold - 0.01))).toBe("high");
    expect(flagMeasurement(d, m(id, date(1), threshold))).toBe("critical-high");
    expect(flagValue(threshold, { high: threshold - 1 }, { high: threshold })).toBe("high");
    expect(flagValue(threshold + 0.01, { high: threshold - 1 }, { high: threshold })).toBe("critical-high");
  });

  it("distinguishes exact potassium at its strict boundary from a definite critical bound", () => {
    const d = def("potassium");
    const threshold = d.criticalRange!.high!;
    expect(flagMeasurement(d, m(d.id, date(1), threshold))).toBe("high");
    expect(flagMeasurement(d, m(d.id, date(1), threshold, { qualifier: ">" }))).toBe("critical-high");
    expect(flagMeasurement(d, m(d.id, date(1), d.criticalRange!.low!, { qualifier: "<" }))).toBe("critical-low");
    expect(flagMeasurement(def("ferritin"), m("ferritin", date(1), 15, { qualifier: "<" }), { sex: "f" })).toBe("low");
  });

  it.each([
    ["<", 15, "low"], ["<", 16, "unknown"], ["<", 30, "unknown"],
    [">", 30, "high"], [">", 29, "unknown"], [">", 15, "unknown"],
  ] as const)("classifies %s%s using interval certainty", (qualifier, value, expected) => {
    expect(flagValue(value, { low: 15, high: 30 }, undefined, qualifier)).toBe(expected);
  });

  it("never reports normality or exact daily aggregation for an uncertain detection bound", () => {
    const sleep = def("sleep_duration");
    const rows = [1, 2, 3].map((d) => m(sleep.id, date(d), 8, { qualifier: "<" }));
    expect(flagLatest(sleep, rows)).toBe("unknown");
    expect(recentAverage(rows)).toBeUndefined();
    expect(recentTotal(rows, 7, 3)).toBeUndefined();
    expect(flagMeasurement(def("ferritin"), m("ferritin", date(1), 30, { qualifier: "<" }), { sex: "f" })).toBe("unknown");
  });

  it("deduplicates equivalent canonical bounds, not exact versus censored observations", () => {
    const exact = m("crp_hs", date(1), 0.3);
    const less = { ...exact, qualifier: "<" as const };
    const greater = { ...exact, qualifier: ">" as const };
    expect(isAlreadySaved([exact], less)).toBe(false);
    expect(isAlreadySaved([less], exact)).toBe(false);
    expect(isAlreadySaved([less], greater)).toBe(false);
    expect(isAlreadySaved([less], { ...less, value: 0.3 + 1e-12 })).toBe(true);
    expect(isAlreadySaved([exact], { ...exact, value: 0.3 + 1e-12 })).toBe(true);
  });
});

describe("clinical review: saved order and daily coverage", () => {
  it("selects the newest saved same-date observation regardless of UUID or input order", () => {
    const old = m("potassium", date(1), 4, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", savedOrder: 10 });
    const critical = m("potassium", date(1), 7, { id: "00000000-0000-4000-8000-000000000000", savedOrder: 11 });
    for (const rows of [[old, critical], [critical, old]]) {
      expect(sortByDate(rows).map((r) => r.value)).toEqual([4, 7]);
      expect(computeTrend(rows)?.latest).toBe(critical);
      expect(latestByBiomarker(rows).get("potassium")).toBe(critical);
      expect(flagLatest(def("potassium"), rows)).toBe("critical-high");
    }
    const laterNormal = { ...old, savedOrder: 12 };
    expect(flagLatest(def("potassium"), [laterNormal, critical])).toBe("normal");
    expect(sortByDate([critical, { ...old, date: date(2), savedOrder: 1 }]).at(-1)?.date).toBe(date(2));
  });

  it("uses persisted save order for same-draw PhenoAge marker selection too", () => {
    const values = { albumin: 44, creatinine: 80, glucose: 5, crp_hs: 1, lymphocyte_pct: 30, mcv: 90, rdw: 13, alp: 70, wbc: 5 };
    const originals = Object.entries(values).map(([id, value]) => m(id, date(1), value, { id: `ffff-${id}`, savedOrder: 10 }));
    const correction = m("crp_hs", date(1), 2, { id: "0000-correction", savedOrder: 11 });
    for (const rows of [[correction, ...originals], [...originals, correction]]) {
      const draw = summarizePhenoAge(rows, "1976-10").draws[0]!;
      expect(draw.used.crp_hs).toBe(correction);
      expect(draw.status).toBe("ok");
      expect(Number.isFinite(draw.phenoAge)).toBe(true);
    }
  });

  it("retains stable legacy ordering when no persisted save order exists", () => {
    const rows = [m("ferritin", date(1), 20), m("ferritin", date(1), 30)];
    expect(sortByDate(rows)).toEqual(rows);
    expect(sortByDate([...rows].reverse())).toEqual([...rows].reverse());
  });

  it("requires three distinct nights and adds sleep pieces before averaging nights", () => {
    const sleep = def("sleep_duration");
    const oneNight = [5, 1, 1].map((v) => m(sleep.id, date(1), v));
    expect(recentAverage(oneNight)).toBeUndefined();
    expect(flagLatest(sleep, oneNight)).toBe("unknown");
    const threeNights = [...oneNight, m(sleep.id, date(2), 7), m(sleep.id, date(3), 7)];
    expect(recentAverage(threeNights)).toMatchObject({ value: 7, count: 3 });
    expect(flagLatest(sleep, threeNights)).toBe("normal");
    expect(flagLatest(sleep, [1, 2, 3].map((d) => m(sleep.id, date(d), 5)))).toBe("low");
  });

  it("gives each date equal weight while preserving additive step totals", () => {
    const hrv = [m("hrv", date(1), 20), m("hrv", date(1), 40), m("hrv", date(2), 60), m("hrv", date(3), 90)];
    expect(recentAverage(hrv)).toMatchObject({ value: 60, count: 3 });
    const steps = hrv.map((row) => ({ ...row, biomarkerId: "steps" }));
    expect(recentAverage(steps)).toMatchObject({ value: 70, count: 3 });
  });

  it("requires fourteen distinct baseline HRV dates and three recent dates", () => {
    const baseline = Array.from({ length: 14 }, (_, i) => m("hrv_resting", date(i + 1), i % 2 ? 60 : 40));
    const recent = [22, 23, 24].map((d) => m("hrv_resting", date(d), 50));
    expect(personalRange([...baseline.slice(0, 13), ...recent])).toBeUndefined();
    expect(personalRange([...Array.from({ length: 14 }, () => baseline[0]!), ...recent])).toBeUndefined();
    const result = personalRange([...baseline, ...recent])!;
    expect(result.baseline.count).toBe(14);
    expect(result.recent).toMatchObject({ count: 3, position: "within" });
    expect(personalRange([...baseline, ...Array.from({ length: 3 }, () => recent[0]!)])?.recent).toBeUndefined();
    // Duplicating a whole day's identical observations does not overweight that day.
    const duplicated = personalRange([...baseline, ...Array.from({ length: 10 }, () => baseline[0]!), ...recent])!;
    expect(duplicated.low).toBeCloseTo(result.low, 12);
    expect(duplicated.high).toBeCloseTo(result.high, 12);
  });
});

describe("clinical review: bounded cardiovascular inputs and axes", () => {
  it("ends both reported blood-pressure averages at the selected paired reading", () => {
    const rows = [m("bp_systolic", "2026-09-10", 260), m("bp_diastolic", "2026-09-10", 160), m("bp_systolic", "2026-09-11", 120), m("bp_diastolic", "2026-09-11", 80), m("bp_systolic", "2026-10-10", 120), m("bp_diastolic", "2026-10-10", 80), m("bp_systolic", "2026-10-20", 180)];
    expect(bodySummary({}, rows, [], "2026-10-29").bloodPressure).toEqual({ latest: "120/80 mmHg", date: "2026-10-10", last30DaysAverage: "120/80 mmHg (2 readings)" });
    const laterDiastolic = rows.filter((r) => r.date !== "2026-10-20").concat(m("bp_diastolic", "2026-10-20", 120));
    expect(bodySummary({}, laterDiastolic, [], "2026-10-29").bloodPressure?.last30DaysAverage).toBe("120/80 mmHg (2 readings)");
  });

  it("includes fractional ages throughout age 74 and excludes age 75", () => {
    const eligible = heartAgeData({ ...profile, birthMonth: "1952-06" }, heartReadings, [], "2026-10-29");
    expect(eligible.input!.age).toBeGreaterThan(74);
    expect(eligible.input!.age).toBeLessThan(75);
    expect(eligible.outOfRange).toBeUndefined();
    expect(heartAgeData({ ...profile, birthMonth: "1951-06" }, heartReadings, [], "2026-10-29").outOfRange).toBe("old");
  });

  it.each(["No diabetes. No hypertension treatment.", "Without diabetes; not on blood pressure medication.", "Diabetes: no. Hypertension untreated.", "Diabetes ruled out. No antihypertensive."])("does not turn negated history into affirmative risk factors: %s", (conditions) => {
    const base = heartAgeData(profile, heartReadings, [], "2026-10-29");
    const negative = heartAgeData({ ...profile, conditions }, heartReadings, [], "2026-10-29");
    expect(negative.missing).toEqual([]);
    expect(negative.input).toEqual(base.input);
    expect(framinghamRisk(negative.input!)).toBe(framinghamRisk(base.input!));
  });

  it("still honors affirmative history and active medicines, and asks about ambiguous history", () => {
    const positive = heartAgeData({ ...profile, conditions: "Type 2 diabetes. Hypertension treated with medication." }, heartReadings, [], "2026-10-29");
    expect(positive.input).toMatchObject({ diabetes: true, treatedBp: true });
    const mixed = heartAgeData({ ...profile, conditions: "No diabetes. Hypertension treated." }, heartReadings, [], "2026-10-29");
    expect(mixed.input).toMatchObject({ diabetes: false, treatedBp: true });
    const meds: ProtocolEntry[] = [{ id: "bp", label: "Amlodipine", category: "medication", start: "2026-01-01" }, { id: "diabetes", label: "Metformin", category: "medication", start: "2026-01-01" }];
    expect(heartAgeData({ ...profile, conditions: "No diabetes. No hypertension treatment." }, heartReadings, meds, "2026-10-29").input).toMatchObject({ diabetes: true, treatedBp: true });
    const ambiguous = heartAgeData({ ...profile, conditions: "Possible diabetes?" }, heartReadings, [], "2026-10-29");
    expect(ambiguous.input).toBeUndefined();
    expect(ambiguous.missing).toContain("confirmation of diabetes");
  });

  it("labels every decade through the endpoint of a long history", () => {
    const ticks = timeTicks({ from: dayNumber("1970-01-01"), to: dayNumber("2026-10-29") });
    expect(ticks.at(-1)?.date).toBe("2026-01-01");
    expect(ticks.map((t) => t.date)).toContain("2010-01-01");
    expect(ticks.every((t, i) => t.kind === "year" && (i === 0 || t.day > ticks[i - 1]!.day))).toBe(true);
    expect(ticks).toHaveLength(56);
  });
});

describe("clinical review: exact experiment outputs and finite pace intervals", () => {
  it.each(["<", ">"] as const)("omits exact aggregates and percentage for %s qualified experiment inputs", (qualifier) => {
    for (const qualifiedBefore of [true, false]) {
      const before = m("crp_hs", "2026-08-20", 0.3, qualifiedBefore ? { qualifier } : {});
      const after = m("crp_hs", "2026-10-01", 0.2, qualifiedBefore ? {} : { qualifier });
      const result = analyzeMarker(experiment, def("crp_hs"), [before, after]);
      expect(result.verdict).toBe("below-limit");
      expect(result.before).toEqual([before]);
      expect(result.after).toEqual([after]);
      expect(result.beforeValue).toBeUndefined();
      expect(result.afterValue).toBeUndefined();
      expect(result.change).toBeUndefined();
      expect(result.band).toBeUndefined();
    }
  });

  it.each([[0, 5], [0, 0], [5, 0], [-1, 5], [Infinity, 5]])("retains %s to %s source readings without invalid log-domain outputs", (beforeValue, afterValue) => {
    const before = m("pushups", "2026-08-20", beforeValue);
    const after = m("pushups", "2026-10-01", afterValue);
    const result = analyzeMarker(experiment, def("pushups"), [before, after]);
    expect(result.before).toEqual([before]);
    expect(result.after).toEqual([after]);
    expect(result.verdict).toBe("no-variation-data");
    expect(result.beforeValue).toBeUndefined();
    expect(result.afterValue).toBeUndefined();
    expect(result.change).toBeUndefined();
    expect(result.band).toBeUndefined();
  });

  it("retains exact positive experiment comparisons", () => {
    const result = analyzeMarker(experiment, def("crp_hs"), [m("crp_hs", "2026-08-20", 2), m("crp_hs", "2026-10-01", 1)]);
    expect(result.beforeValue).toBe(2);
    expect(result.afterValue).toBe(1);
    expect(result.change).toBe(-0.5);
    expect(result.band).toBeDefined();
    expect(personalBand([1, 2, Infinity], [1, 2, 3])).toBeUndefined();
  });

  it.each([[1, 12.706], [2, 4.303], [3, 3.182]])("uses a finite two-sided 95%% t critical at df %s", (df, expected) => {
    expect(t95(df)).toBe(expected);
    const count = df + 2;
    const points = Array.from({ length: count }, (_, i) => ({ date: new Date(Date.UTC(2024, 0, 1) + i * 365.25 * 86_400_000 / (count - 1)).toISOString().slice(0, 10), years: 40 }));
    const exact = phenoAgePace(points)!;
    expect(exact.pace).toBe(0);
    expect(exact.low).toBe(0);
    expect(exact.high).toBe(0);
    const scattered = phenoAgePace(points.map((p, i) => ({ ...p, years: 40 + (i % 2) })))!;
    expect(Number.isFinite(scattered.low)).toBe(true);
    expect(Number.isFinite(scattered.high)).toBe(true);
    expect(scattered.low).toBeLessThan(scattered.high);
  });
});

describe("clinical review: fitness protocol and norm uncertainty", () => {
  it.each([30, 60])("does not rank a tied capped balance result of %s as above the 75th percentile", (value) => {
    const british = balance.norms.find((set) => set.ceiling === 30)!;
    const place = placeInRow(british, british.rows[0]!, value)!;
    expect(place).toMatchObject({ kind: "percentile", capped: true });
    expect(describePlace(place)).toBe("Reached the test limit; the table cannot rank results at the limit");
    expect(placeResult(balance, value, { age: 53, sex: "f" }).find((p) => p.set === british)?.place).toEqual(place);
    expect(fitnessSummary([balance], [m(balance.id, date(1), value)], { sex: "f", ageAt: () => 53 })[0]!.comparedWith.find((r) => r.norms === british.label)?.place).toBe(describePlace(place));
    expect(describePlace(placeInRow(british, british.rows[0]!, 29)!)).toBe("Between the 25th and 50th percentile");
  });

  it("omits an unsupported age inside the final open interval, retaining actual oldest bounds", () => {
    const iran = balance.norms.find((set) => set.label === "Iran (right leg)")!;
    expect(ageMatch(iran, "f", 20, true)).toBeUndefined();
    expect(ageMatch(iran, "f", 6.9, true)).toEqual({ kind: "oldest", age: 70 });
    expect(ageMatch(iran, "f", 5, true)).toEqual({ kind: "oldest", age: 70 });
    const summary = fitnessSummary([balance], [m(balance.id, date(1), 20)], { sex: "f", ageAt: () => 60 })[0]!;
    expect(summary.typicalOfAge?.find((r) => r.norms === iran.label)).toBeUndefined();
  });

  it("only instructs recording the supported eyes-open right-leg protocol", () => {
    expect(balance.summary).toContain("eyes open");
    expect(balance.howTo.join(" ")).toContain("Keep your eyes open");
    expect(balance.howTo.join(" ")).toContain("Do not enter an eyes-closed time");
    expect(balance.howTo.join(" ")).not.toMatch(/close your eyes|eyes closed \(harder\)/i);
  });
});
