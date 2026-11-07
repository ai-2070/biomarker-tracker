import { DOSE, markerIdFor, parseHabitProposal } from "@bt/shared/core/habitProposal";
import { describe, expect, it } from "vitest";
import { loadDefs } from "../helpers";

const defs = loadDefs();
const today = "2026-10-29";
const ok = { label: "Iron-rich breakfast", category: "diet", reason: "You asked to track this.", watchMarkers: ["Ferritin", "hb"] };

describe("habit suggestions from Brain", () => {
  it("accepts a habit, resolving markers by name or alias, starting today by default", () => {
    const r = parseHabitProposal({ ...ok, watchMarkers: ["Ferritin", "HbA1c", "nonsense"] }, defs, today);
    expect(r.ok && r.proposal).toEqual({
      label: "Iron-rich breakfast",
      category: "diet",
      start: today,
      markerIds: ["ferritin", "hba1c"],
      reason: "You asked to track this.",
    });
    expect(r.ok && r.unknownMarkers).toEqual(["nonsense"]);
  });
  it("never suggests a medicine or an amount", () => {
    expect(parseHabitProposal({ ...ok, category: "medication" }, defs, today)).toMatchObject({ ok: false, error: expect.stringMatching(/Medicines/) });
    for (const label of ["Vitamin D 2000 IU", "Magnesium 300mg at night", "Fish oil 2 capsules", "Iron 1 tablet"]) {
      expect(parseHabitProposal({ ...ok, label }, defs, today)).toMatchObject({ ok: false, error: expect.stringMatching(/amounts/) });
    }
    expect(DOSE.test("Walk 30 minutes after dinner")).toBe(false);
    expect(DOSE.test("Vitamin B12")).toBe(false);
  });
  it("needs a name, a known category, a reason and a valid date, and watches at most 5 markers", () => {
    expect(parseHabitProposal({ ...ok, label: " " }, defs, today).ok).toBe(false);
    expect(parseHabitProposal({ ...ok, category: "other" }, defs, today).ok).toBe(false);
    expect(parseHabitProposal({ ...ok, reason: "" }, defs, today).ok).toBe(false);
    expect(parseHabitProposal({ ...ok, start: "next week" }, defs, today).ok).toBe(false);
    expect(parseHabitProposal({ ...ok, watchMarkers: ["ferritin", "iron", "hemoglobin", "mcv", "b12", "folate"] }, defs, today).ok).toBe(false);
  });
  it("finds markers by id, name, abbreviation or alias", () => {
    expect(markerIdFor("vitamin_d", defs)).toBe("vitamin_d");
    expect(markerIdFor("LDL-C", defs)).toBe("ldl");
    expect(markerIdFor("Kalium", defs)).toBe("potassium");
    expect(markerIdFor("nope", defs)).toBeUndefined();
  });
});
