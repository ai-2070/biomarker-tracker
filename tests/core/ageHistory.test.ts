import { describe, expect, it } from "vitest";
import { ageHistory } from "../../src/core/ageHistory";
import { demoProfile } from "../../src/core/demo";
import { fitnessAge } from "../../src/core/fitnessAge";
import { heartAge, heartAgeData } from "../../src/core/heartAge";
import { summarizePhenoAge } from "../../src/core/phenoageDraws";
import type { Measurement } from "../../src/core/types";

const today = "2026-10-29";
const demo = demoProfile(today);
const h = ageHistory(demo.person, demo.measurements, demo.protocols);

describe("age history for the Biological age chart", () => {
  it("has PhenoAge for every complete blood test", () => {
    const ok = summarizePhenoAge(demo.measurements, demo.person.birthMonth).draws.filter((d) => d.status === "ok");
    expect(h.blood.map((p) => p.date)).toEqual(ok.map((d) => d.date));
    expect(h.blood.some((p) => p.approximate)).toBe(true);
  });
  it("has heart age on each blood pressure day, from what was known that day", () => {
    expect(h.heart).toHaveLength(24);
    const first = h.heart[0]!;
    const known = demo.measurements.filter((m) => m.date <= first.date);
    const then = heartAgeData(demo.person, known, demo.protocols, first.date);
    expect(first.years).toBeCloseTo(heartAge(then.input!), 9);
    // The latest equals the heart age shown on the page today, on the day of the latest reading.
    const now = heartAgeData(demo.person, demo.measurements, demo.protocols, h.heart.at(-1)!.date);
    expect(h.heart.at(-1)!.years).toBeCloseTo(heartAge(now.input!), 9);
  });
  it("has fitness age at each VO2max reading, with the table's bounds", () => {
    const vo2 = demo.measurements.filter((m) => m.biomarkerId === "vo2max");
    expect(h.fitness).toHaveLength(vo2.length);
    expect(h.fitness[0]!.years).toBeCloseTo(fitnessAge(vo2[0]!.value, "f").age, 9);
    const top = ageHistory({ ...demo.person }, [{ id: "x", biomarkerId: "vo2max", date: "2026-01-01", value: 60, originalValue: 60, originalUnit: "mL/kg/min", source: "manual" } as Measurement], []);
    expect(top.fitness[0]).toMatchObject({ years: 25, bound: "younger" });
  });
  it("puts calendar age beside each estimate, and shows nothing without a birth month", () => {
    for (const p of [...h.blood, ...h.heart, ...h.fitness]) expect(p.age).toBeGreaterThan(40);
    expect(ageHistory({ ...demo.person, birthMonth: undefined }, demo.measurements, demo.protocols)).toEqual({ blood: [], heart: [], fitness: [] });
  });
});
