import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { todayIso, addDays } from "@bt/shared/core/dates";
import type { Measurement } from "@bt/shared/core/types";

const state = vi.hoisted(() => ({ all: [] as Measurement[] }));
vi.mock("../../apps/web/src/app/hooks", () => ({ useAllMeasurements: () => state.all, useProfile: () => ({ sex: "f" }), useDisplayUnits: () => ({}) }));
vi.mock("../../apps/web/src/app/brain/store", () => ({ askBrain: vi.fn() }));
import { PeriodSummaryPage } from "../../apps/web/src/app/pages/PeriodSummaryPage";

let n = 0;
const ago = (days: number) => addDays(todayIso(), -days);
const m = (biomarkerId: string, date: string, value: number, labRange?: { low?: number; high?: number }): Measurement => ({
  id: `m${++n}`, biomarkerId, date, value, originalValue: value, originalUnit: "x", source: "pdf", ...(labRange ? { labRange } : {}),
});

describe("PeriodSummaryPage", () => {
  it("shows the year's results, the comparison with before, what wasn't measured and the limits", () => {
    state.all = [
      m("hemoglobin", ago(500), 112, { low: 120, high: 160 }), m("hemoglobin", ago(200), 107, { low: 120, high: 161 }),
      m("ferritin", ago(600), 9, { low: 13, high: 150 }),
      m("ldl", ago(1000), 2.0), m("ldl", ago(640), 2.5), m("ldl", ago(300), 3.1), m("ldl", ago(20), 3.9),
    ];
    const html = renderToStaticMarkup(createElement(PeriodSummaryPage, {}));
    if (process.env.YEAR_HTML) writeFileSync(process.env.YEAR_HTML, html);
    expect(html).toContain("Year summary");
    expect(html).toContain("Not measured in the last 12 months");
    expect(html).toContain("Rising over 4 results");
    expect(html).toContain("With only a few tests");
    expect(html).toContain("Explain this year");
    expect(html).toContain("One test");
  });

  it("says plainly when there was no blood test in the period", () => {
    state.all = [m("ferritin", ago(600), 9, { low: 13, high: 150 })];
    const html = renderToStaticMarkup(createElement(PeriodSummaryPage, {}));
    expect(html).toContain("No blood test in the last 12 months");
    expect(html).toContain("19 months old");
  });

  it("shows the urgent banner for a critical latest result and leaves Brain out", () => {
    state.all = [m("potassium", ago(3), 6.9, { low: 3.5, high: 5.1 })];
    const html = renderToStaticMarkup(createElement(PeriodSummaryPage, {}));
    expect(html).toContain("far outside the usual range");
    expect(html).not.toContain("Explain this year");
  });
});
