import { describe, expect, it } from "vitest";
import { parseBackup } from "../../src/core/backup";
import { addDays } from "../../src/core/dates";
import { DEMO_UNITS, demoProfile, demoBodyMeasurements } from "../../src/core/demo";
import { analyzeMarker } from "../../src/core/experiments";
import { summarizePhenoAge } from "../../src/core/phenoageDraws";
import { isActiveOn } from "../../src/core/protocols";
import { flagMeasurement, groupByBiomarker } from "../../src/core/trends";
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
    for (const m of demo.measurements) expect(flagMeasurement(def(m.biomarkerId), m, demo.person), `${m.biomarkerId} ${m.date}`).not.toMatch(/critical/);
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
    expect(new Set(body.map((m) => m.biomarkerId))).toEqual(new Set(["weight", "waist", "body_fat", "bp_systolic", "bp_diastolic", "resting_hr"]));
    expect(demoBodyMeasurements(today)).toEqual(body);
  });

  it("has a finished diet experiment where LDL fell by more than test-to-test noise", () => {
    const e = demo.experiments[0]!;
    expect(demo.protocols.some((p) => p.id === e.protocolId)).toBe(true);
    const r = analyzeMarker(e, def("ldl"), groupByBiomarker(demo.measurements).get("ldl")!);
    expect(r.verdict).toBe("fall");
  });
});
