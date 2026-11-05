import { describe, expect, it } from "vitest";
import { parseBackup } from "@bt/shared/core/backup";
import { addDays } from "@bt/shared/core/dates";
import { DEMO_BODY_IDS, DEMO_UNITS, demoProfile, demoBodyMeasurements } from "@bt/shared/core/demo";
import { analyzeMarker } from "@bt/shared/core/experiments";
import { summarizePhenoAge } from "@bt/shared/core/phenoageDraws";
import { isActiveOn } from "@bt/shared/core/protocols";
import { validSleepSessions, sleepLocalTime } from "@bt/shared/core/sleepSessions";
import { buildSleepTiming, pairSleepCardiac } from "@bt/shared/core/sleepTiming";
import { flagMeasurement, groupByBiomarker } from "@bt/shared/core/trends";
import { def, loadDefs } from "../helpers";

const today = "2026-10-28";
const demo = demoProfile(today);
const series = (id: string) => demo.measurements.filter((m) => m.biomarkerId === id);

describe("example profile (made-up data)", () => {
  it("is a valid backup, marked as an example, and the same every time", () => {
    const r = parseBackup({ app: "biomarker-tracker", version: 2, ...demo, profile: demo.person });
    expect(r.ok).toBe(true);
    expect(r.ok && r.backup.profile.example).toBe(true);
    expect(demo.person.name).toMatch(/example/i);
    expect(demoProfile(today)).toEqual(demo);
    expect(new Set(demo.measurements.map((m) => m.id)).size).toBe(demo.measurements.length);
  });

  it("uses each marker's own unit and known markers only", () => {
    const defs = loadDefs();
    for (const [id, unit] of Object.entries(DEMO_UNITS)) expect(defs.get(id)?.canonicalUnit, id).toBe(unit);
    for (const m of demo.measurements) expect(defs.has(m.biomarkerId)).toBe(true);
  });

  it("covers about five years, all in the past, with no critical values", () => {
    const dates = demo.measurements.map((m) => m.date).sort();
    expect(dates.at(-1)! < today).toBe(true);
    expect(dates[0]! <= addDays(today, -4 * 365)).toBe(true);
    const defs = loadDefs();
    for (const m of demo.measurements) expect(flagMeasurement(defs.get(m.biomarkerId)!, m, demo.person), `${m.biomarkerId} ${m.date}`).not.toMatch(/critical/);
  });

  it("tells its stories: low ferritin during, and recovery after, the iron supplement", () => {
    const ferritin = series("ferritin");
    const flags = ferritin.map((m) => flagMeasurement(def("ferritin"), m, demo.person));
    expect(flags).toContain("low");
    expect(flags.at(-1)).toBe("normal");
    const iron = demo.protocols.find((p) => p.id === "example-log-iron")!;
    expect(ferritin.some((m) => isActiveOn(iron, m.date))).toBe(true);
  });

  it("has biological age for every test, one marked approximate", () => {
    const s = summarizePhenoAge(demo.measurements, demo.person.birthMonth);
    expect(s.draws).toHaveLength(10);
    expect(s.draws.every((d) => d.status === "ok")).toBe(true);
    expect(s.draws.filter((d) => d.approximate.length > 0)).toHaveLength(1);
  });

  it("has two years of body measurements: waist goes below the usual limit, blood pressure stays below 140/90", () => {
    const body = demo.measurements.filter((m) => ["weight", "waist", "body_fat", "bp_systolic", "bp_diastolic", "resting_hr"].includes(m.biomarkerId));
    expect(body.length).toBeGreaterThan(100);
    expect(body.every((m) => m.lab === undefined)).toBe(true);
    const waist = body.filter((m) => m.biomarkerId === "waist").sort((a, b) => a.date.localeCompare(b.date));
    expect(waist[0]!.value).toBeGreaterThan(80);
    expect(waist.at(-1)!.value).toBeLessThan(80);
    expect(body.filter((m) => m.biomarkerId === "bp_systolic").every((m) => m.value < 140)).toBe(true);
    expect(body.filter((m) => m.biomarkerId === "bp_diastolic").every((m) => m.value < 90)).toBe(true);
  });

  it("can give just the body measurements, for older example profiles", () => {
    const body = demoBodyMeasurements(today);
    expect(body.length).toBeGreaterThan(100);
    expect(new Set(body.map((m) => m.biomarkerId))).toEqual(new Set(DEMO_BODY_IDS));
    expect(body.filter((m) => m.biomarkerId === "spo2").every((m) => m.value >= 95 && m.value <= 100)).toBe(true);
    const glucose = body.filter((m) => m.biomarkerId === "glucose_home");
    expect(glucose.some((m) => m.fasted === true) && glucose.some((m) => m.fasted === false)).toBe(true);
    expect(glucose.every((m) => (m.fasted ? m.value <= 5.5 : m.value < 7.8))).toBe(true);
    expect(demoBodyMeasurements(today)).toEqual(body);
  });

  it("has a finished diet experiment where LDL fell by more than test-to-test noise", () => {
    const e = demo.experiments[0]!;
    expect(demo.protocols.some((p) => p.id === e.protocolId)).toBe(true);
    const r = analyzeMarker(e, def("ldl"), groupByBiomarker(demo.measurements).get("ldl")!);
    expect(r.verdict).toBe("fall");
  });
});

describe("made-up example sleep timing", () => {
  it("adds deterministic recorded windows to the new daily watch readings without changing hours", () => {
    const daily = series("sleep_duration").filter((m) => m.source === "device");
    expect(daily).toHaveLength(70);
    expect(daily.every((m) => validSleepSessions(m.sleepSessions, m.biomarkerId, m.date))).toBe(true);
    for (const m of daily) {
      const window = m.sleepSessions![0]!;
      expect(window).toMatchObject({ kind: "asleep", source: "Example watch" });
      expect(window).not.toHaveProperty("startOffsetMinutes");
      expect(window).not.toHaveProperty("endOffsetMinutes");
      expect(window.start).not.toMatch(/Z|[+-]\d{2}:\d{2}$/);
      expect(window.end.slice(0, 10)).toBe(m.date);
      expect((sleepLocalTime(window.end)! - sleepLocalTime(window.start)!) / 3_600_000).toBeCloseTo(m.value, 10);
      expect(m.originalValue).toBe(m.value);
    }
    expect(new Set(daily.map((m) => m.sleepSessions![0]!.end.slice(11, 16))).size).toBeGreaterThan(10);
    expect(demoProfile(today).measurements.filter((m) => m.biomarkerId === "sleep_duration" && m.source === "device")).toEqual(daily);
    expect(demo.measurements.filter((m) => m.biomarkerId !== "sleep_duration").every((m) => m.sleepSessions === undefined)).toBe(true);
    // The older monthly sample nights remain duration-only.
    expect(series("sleep_duration").filter((m) => m.source !== "device").every((m) => m.sleepSessions === undefined)).toBe(true);
  });

  it("gives the fictional sleep comparison matching resting pulse and resting HRV on every nightly date", () => {
    const timing = buildSleepTiming(demo.measurements, { today });
    const dates = timing.nights.map((night) => night.date);
    for (const metric of ["resting_hr", "hrv_resting"] as const) {
      expect(pairSleepCardiac(timing.nights, demo.measurements, metric, "midpoint").points.map((point) => point.date)).toEqual(dates);
    }
    const resting = series("resting_hr");
    expect(new Set(resting.map((m) => m.date)).size).toBe(resting.length);
  });

  it("keeps generated windows valid across calendar and offset-transition dates without guessed offsets", () => {
    for (const end of ["2026-01-01", "2026-03-30", "2026-10-26"]) {
      const example = demoProfile(end);
      const daily = example.measurements.filter((m) => m.biomarkerId === "sleep_duration" && m.source === "device");
      expect(buildSleepTiming(daily, { today: end }).nights).toHaveLength(70);
      expect(daily.every((m) => validSleepSessions(m.sleepSessions, m.biomarkerId, m.date))).toBe(true);
    }
  });
});
