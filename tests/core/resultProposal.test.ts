import { describe, expect, it } from "vitest";
import { durationHours, parseResultProposal, proposalKind } from "@bt/shared/core/importers/resultProposal";
import { loadDefs } from "../helpers";

const defs = loadDefs();
const today = "2026-10-29";
const parse = (input: unknown) => {
  const r = parseResultProposal(input, defs, today);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("results Brain read from a picture", () => {
  it("builds the review report from printed values, units and ranges", () => {
    const r = parse({
      date: "2026-10-20",
      results: [
        { marker: "ferritin", printed: "Ferritin 45 µg/L 15 - 150", value: "45", unit: "ug/L", rangeLow: "15", rangeHigh: "150" },
        { marker: "crp_hs", value: "<0,3", unit: "mg/L" },
      ],
    });
    expect(r.report.date).toBe("2026-10-20");
    expect(r.report.rows).toMatchObject([
      { biomarkerId: "ferritin", line: "Ferritin 45 µg/L 15 - 150", value: "45", unit: "µg/L", labLow: "15", labHigh: "150", problems: [] },
      { biomarkerId: "crp_hs", value: "<0,3", unit: "mg/L", problems: [] },
    ]);
    expect(proposalKind(r.report, defs)).toBe("lab");
    // The checked copy parses to the same report (the page checks it again).
    expect(parse(r.proposal).report).toEqual(r.report);
  });

  it("flags units the marker can't use, missing units and values that aren't numbers", () => {
    const rows = parse({
      results: [
        { marker: "ferritin", value: "45", unit: "mmol/L" },
        { marker: "glucose", value: "5.4" },
        { marker: "hemoglobin", value: "about 140", unit: "g/L" },
      ],
    }).report.rows;
    expect(rows[0]!.unit).toBeUndefined();
    expect(rows[0]!.problems.join(" ")).toMatch(/unit "mmol\/L"/);
    expect(rows[1]!.problems.join(" ")).toMatch(/No unit was read/);
    expect(rows[2]!.problems.join(" ")).toMatch(/isn't a number/);
  });

  it("flags a probably missed decimal point and implausible values", () => {
    const rows = parse({
      results: [
        { marker: "potassium", value: "54", unit: "mmol/L", rangeLow: "3.5", rangeHigh: "5.1" },
        { marker: "ferritin", value: "45000", unit: "µg/L" },
      ],
    }).report.rows;
    expect(rows[0]!.problems.join(" ")).toMatch(/decimal point/);
    expect(rows[1]!.problems.join(" ")).toMatch(/very far from the usual range/);
  });

  it("reads phone-screen values: durations, step counts, spelled-out units", () => {
    const r = parse({
      results: [
        { marker: "sleep_duration", value: "7 h 12 min" },
        { marker: "active_minutes", value: "1 h 5 min" },
        { marker: "steps", value: "8,120" },
        { marker: "weight", value: "154.2", unit: "lbs" },
        { marker: "resting_hr", value: "58", unit: "bpm" },
      ],
    });
    expect(r.report.rows.map((x) => [x.biomarkerId, x.value, x.unit, x.problems])).toEqual([
      ["sleep_duration", "7.2", "h", []],
      ["active_minutes", "65", "min", []],
      ["steps", "8120", "steps", []],
      ["weight", "154.2", "lb", []],
      ["resting_hr", "58", "bpm", []],
    ]);
    expect(r.report.rows[2]!.notes.join(" ")).toMatch(/only unit/);
    // Body values: today's date is filled in, with a note to check it.
    expect(proposalKind(r.report, defs)).toBe("body");
    expect(r.report).toMatchObject({ date: today, dateNote: expect.stringMatching(/today/) });
  });

  it("keeps unknown markers apart and refuses a card with none the app tracks", () => {
    const r = parse({ results: [{ marker: "ferritin", value: "45", unit: "µg/L" }, { marker: "pdw", printed: "PDW 16.1 fL", value: "16.1" }] });
    expect(r.unknownMarkers).toEqual(["pdw"]);
    expect(r.report.unmatched).toEqual(["PDW 16.1 fL"]);
    expect(parseResultProposal({ results: [{ marker: "pdw", value: "16.1" }] }, defs, today)).toMatchObject({ ok: false });
  });

  it("refuses empty, oversized or incomplete proposals and doesn't take future dates", () => {
    expect(parseResultProposal({ results: [] }, defs, today).ok).toBe(false);
    expect(parseResultProposal({ results: Array.from({ length: 81 }, () => ({ marker: "ferritin", value: "45" })) }, defs, today).ok).toBe(false);
    expect(parseResultProposal({ results: [{ marker: "ferritin" }] }, defs, today).ok).toBe(false);
    expect(parseResultProposal(null, defs, today).ok).toBe(false);
    const future = parse({ date: "2027-01-01", results: [{ marker: "ferritin", value: "45", unit: "µg/L" }] }).report;
    expect(future.date).toBeUndefined();
    expect(future.dateNote).toMatch(/2027-01-01/);
  });

  it("turns durations into hours", () => {
    expect(durationHours("7 h 12 min")).toBeCloseTo(7.2);
    expect(durationHours("7h 12m")).toBeCloseTo(7.2);
    expect(durationHours("7.5 h")).toBe(7.5);
    expect(durationHours("7,5 hours")).toBe(7.5);
    expect(durationHours("1.5 h 15 min")).toBe(1.75);
    expect(durationHours("45.5 min")).toBeCloseTo(45.5 / 60);
    expect(durationHours("1:35")).toBeCloseTo(1 + 35 / 60);
    expect(durationHours("123.5 h")).toBeUndefined();
  });
});
