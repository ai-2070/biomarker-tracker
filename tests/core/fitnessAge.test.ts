import { describe, expect, it } from "vitest";
import { HUNT_VO2MAX, fitnessAge, vo2maxForAge } from "../../src/core/fitnessAge";

describe("fitness age (HUNT 3 Fitness Study reference data)", () => {
  it("uses the means from Loe et al. 2013, Table 2", () => {
    expect(HUNT_VO2MAX.m.map((r) => r.mean)).toEqual([54.4, 49.1, 47.2, 42.6, 39.2, 35.3]);
    expect(HUNT_VO2MAX.f.map((r) => r.mean)).toEqual([43.0, 40.0, 38.4, 34.4, 31.1, 28.3]);
  });
  it("gives the middle of an age group for its mean, and interpolates between groups", () => {
    expect(fitnessAge(47.2, "m")).toEqual({ age: 45 });
    expect(fitnessAge(34.4, "f")).toEqual({ age: 55 });
    expect(fitnessAge((47.2 + 42.6) / 2, "m").age).toBeCloseTo(50, 9);
  });
  it("doesn't extrapolate past the youngest and oldest groups", () => {
    expect(fitnessAge(60, "m")).toEqual({ age: 25, bound: "younger" });
    expect(fitnessAge(20, "f")).toEqual({ age: 75, bound: "older" });
  });
  it("compares with the person's own age group", () => {
    const r = vo2maxForAge(38.4, 47, "f");
    expect(r.group).toBe("40–49");
    expect(r.z).toBeCloseTo(0, 9);
    expect(vo2maxForAge(40, 82, "m").group).toBe("70 and over");
  });
});
