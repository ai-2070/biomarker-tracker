import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Measurement, ProtocolEntry } from "@bt/core/types";

const state = vi.hoisted(() => ({ all: [] as Measurement[], protocols: [] as ProtocolEntry[] }));
vi.mock("../../apps/web/src/app/hooks", () => ({
  useAllMeasurements: () => state.all, useProtocols: () => state.protocols, useProfile: () => ({ sex: "f" }), useDisplayUnits: () => ({}),
}));
vi.mock("../../apps/web/src/app/brain/store", () => ({ askBrain: vi.fn() }));
import { TestSummaryPage } from "../../apps/web/src/app/pages/TestSummaryPage";

let n = 0;
const m = (biomarkerId: string, date: string, value: number, low?: number, high?: number): Measurement => ({
  id: `m${++n}`, biomarkerId, date, value, originalValue: value, originalUnit: "x", source: "pdf",
  ...(low !== undefined || high !== undefined ? { labRange: { ...(low !== undefined ? { low } : {}), ...(high !== undefined ? { high } : {}) } } : {}),
});

describe("TestSummaryPage", () => {
  it("explains a test without diagnosing, with questions and the Brain button", () => {
    state.all = [
      m("hemoglobin", "2026-03-01", 112, 120, 160), m("hemoglobin", "2026-09-29", 107, 120, 161),
      m("creatinine", "2026-09-29", 169, 44, 80), m("egfr", "2026-09-29", 23, 90), m("sodium", "2026-09-29", 140, 133, 145),
      m("urine_acr", "2026-09-29", 0.2, undefined, 3.5), m("mpv", "2026-09-29", 7.8),
    ];
    state.protocols = [{ id: "p", label: "Creatine", category: "supplement", start: "2026-01-01" }];
    const html = renderToStaticMarkup(createElement(TestSummaryPage, {}));
    if (process.env.SUMMARY_HTML) writeFileSync(process.env.SUMMARY_HTML, html);
    expect(html).toContain("Test summary");
    expect(html).toContain("Outside the range");
    expect(html).toContain("Questions for your doctor");
    expect(html).toContain("Explain this test");
    expect(html).toContain("Without a range");
    expect(html).toContain("From your habit");
    expect(html).not.toMatch(/you have (a|an) /i);
  });

  it("puts critical results first and leaves Brain out", () => {
    state.all = [m("potassium", "2026-09-29", 6.9, 3.5, 5.1)];
    state.protocols = [];
    const html = renderToStaticMarkup(createElement(TestSummaryPage, {}));
    expect(html).toContain("Far outside the range");
    expect(html).not.toContain("Explain this test");
  });

  it("says when there are no blood tests", () => {
    state.all = [m("weight", "2026-09-29", 70)];
    expect(renderToStaticMarkup(createElement(TestSummaryPage, {}))).toContain("There are no blood tests yet");
  });
});
