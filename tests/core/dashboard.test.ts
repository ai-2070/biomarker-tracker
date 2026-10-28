import { describe, expect, it } from "vitest";
import { buildDashboard } from "../../src/core/dashboard";
import { demoProfile } from "../../src/core/demo";
import { loadDefs } from "../helpers";

const today = "2026-10-28";
const demo = demoProfile(today);
const defs = loadDefs();
// The blood tests dashboard sees blood results only; body measurements get their own.
const isBody = (id: string) => defs.get(id)?.category === "Body";
const d = buildDashboard({ ...demo, measurements: demo.measurements.filter((m) => !isBody(m.biomarkerId)), profile: demo.person, defs, today });
const body = buildDashboard({ ...demo, measurements: demo.measurements.filter((m) => isBody(m.biomarkerId)), profile: demo.person, defs, today });

describe("body dashboard", () => {
  it("has the six body measurements, measured monthly", () => {
    expect(body.markers.map((m) => m.def.id).sort()).toEqual(["body_fat", "bp_diastolic", "bp_systolic", "resting_hr", "waist", "weight"]);
    expect(body.draws).toHaveLength(24);
    expect(body.critical).toHaveLength(0);
    expect(body.bioAge).toHaveLength(0);
  });
});

describe("dashboard summary", () => {
  it("counts markers in range against those that can be judged", () => {
    expect(d.judged).toBe(d.markers.filter((m) => m.flag !== "unknown").length);
    expect(d.inRange + d.toWatch.length).toBe(d.judged);
    expect(d.markers).toHaveLength(21);
  });

  it("lists markers to watch first, then the biggest changes", () => {
    const firstNormal = d.markers.findIndex((m) => m.flag === "normal");
    expect(d.markers.slice(0, firstNormal).every((m) => m.flag !== "normal")).toBe(true);
    // The example's LDL is above its range at the latest test.
    expect(d.toWatch.map((m) => m.def.id)).toContain("ldl");
  });

  it("summarises each blood test and its out-of-range markers", () => {
    expect(d.draws.length).toBe(13); // ten full tests and three lipid re-tests
    const lowFerritin = d.draws.find((x) => x.outOfRange.includes("ferritin"));
    expect(lowFerritin).toBeDefined();
    expect(d.lastTest).toBe(d.draws.at(-1)!.date);
    expect(d.daysSinceLastTest).toBe(30);
  });

  it("has biological age for each complete test, marking the approximate one", () => {
    expect(d.bioAge).toHaveLength(10);
    expect(d.bioAge.filter((p) => p.approximate)).toHaveLength(1);
    for (const p of d.bioAge) expect(p.difference).toBeCloseTo(p.phenoAge - p.age, 6);
  });

  it("knows what is being taken today and the time span to draw", () => {
    expect(d.activeLog.map((p) => p.id).sort()).toEqual(["example-log-d3", "example-log-walk"]);
    expect(d.span!.from <= d.draws[0]!.date).toBe(true);
    expect(d.span!.to).toBe(today);
  });

  it("finds the next re-test of a running experiment", () => {
    const running = { id: "e1", change: "Kiwis", category: "diet" as const, markerIds: ["ferritin"], start: "2026-10-01", retestAfterDays: 56 };
    const r = buildDashboard({ ...demo, experiments: [running], profile: demo.person, defs, today });
    expect(r.nextRetest).toEqual({ experimentId: "e1", change: "Kiwis", date: "2026-11-26", daysAway: 29 });
    expect(d.nextRetest).toBeUndefined(); // the example's experiment has ended
  });

  it("is empty but valid with no data", () => {
    const e = buildDashboard({ measurements: [], protocols: [], experiments: [], profile: {}, defs, today });
    expect(e).toMatchObject({ markers: [], inRange: 0, judged: 0, draws: [], bioAge: [] });
    expect(e.span).toBeUndefined();
  });
});
