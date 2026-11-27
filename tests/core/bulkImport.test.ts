import { mergeReports, testSpan } from "@bt/shared/core/importers/bulk";
import type { ParsedReport, ParsedRow } from "@bt/shared/core/importers/labText";
import { describe, expect, it } from "vitest";
import { loadDefs, measurement } from "../helpers";

const defs = loadDefs();
const today = "2026-11-27";
const row = (biomarkerId: string, value: string, unit: string): ParsedRow => ({
  line: `${biomarkerId} ${value} ${unit}`,
  biomarkerId,
  value,
  unit,
  problems: [],
  notes: [],
});
const report = (date: string | undefined, ...rows: ParsedRow[]): ParsedReport => ({ rows, unmatched: [], ...(date ? { date } : {}) });

describe("many reports at once", () => {
  it("makes one review per test date, oldest first, undated last", () => {
    const tests = mergeReports(
      [
        { name: "2024.pdf", report: report("2024-05-01", row("ferritin", "45", "µg/L")) },
        { name: "photo.jpg", report: report(undefined, row("ferritin", "50", "µg/L")) },
        { name: "2019.pdf", report: report("2019-02-03", row("ferritin", "30", "µg/L")) },
      ],
      [],
      defs,
      today,
    );
    expect(tests.map((t) => [t.date, t.files])).toEqual([
      ["2019-02-03", ["2019.pdf"]],
      ["2024-05-01", ["2024.pdf"]],
      [undefined, ["photo.jpg"]],
    ]);
  });

  it("joins pages of one test, drops exact repeats (also in another unit) and names the file", () => {
    const [t] = mergeReports(
      [
        { name: "page1.jpg", report: report("2025-03-12", row("ferritin", "45", "µg/L"), row("hba1c", "5.4", "%")) },
        { name: "page2.jpg", report: report("2025-03-12", row("ferritin", "45", "ng/mL"), row("crp_hs", "0.8", "mg/L")) },
      ],
      [],
      defs,
      today,
    );
    expect(t!.report.rows.map((r) => r.biomarkerId)).toEqual(["ferritin", "hba1c", "crp_hs"]);
    expect(t!.report.rows[0]!.notes).toEqual(["Also in page2.jpg."]);
    expect(t!.report.rows[2]!.line).toContain("page2.jpg");
    expect(t!.report.rows.every((r) => r.problems.length === 0)).toBe(true);
  });

  it("unticks both values when a marker has two on one date, and results already saved", () => {
    const [t] = mergeReports(
      [
        { name: "a.pdf", report: report("2025-03-12", row("ferritin", "45", "µg/L"), row("hba1c", "5.4", "%")) },
        { name: "b.jpg", report: report("2025-03-12", row("ferritin", "54", "µg/L")) },
      ],
      [measurement({ biomarkerId: "hba1c", date: "2025-03-12", value: 5.4, originalUnit: "%" })],
      defs,
      today,
    );
    expect(t).toMatchObject({ conflicts: 2, alreadySaved: 1 });
    expect(t!.report.rows.map((r) => r.problems)).toEqual([
      ["More than one Ferritin value for this date. Tick the right one."],
      ["Already saved."],
      ["More than one Ferritin value for this date. Tick the right one."],
    ]);
  });

  it("skips files where nothing was found and gives the span of dates", () => {
    expect(mergeReports([{ name: "empty.pdf", report: report("2025-01-01") }], [], defs, today)).toEqual([]);
    expect(testSpan(["2026-01-01", "2014-05-02", "2020-01-01"])).toEqual({ from: "2014-05-02", to: "2026-01-01" });
    expect(testSpan([])).toBeUndefined();
  });
});
