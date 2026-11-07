import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NutrientDef } from "@bt/shared/core/nutrients";
import { buildTestSummary, rangeText, SUMMARY_LIMITS } from "@bt/shared/core/testSummary";
import type { Measurement, ProtocolEntry } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";
import { loadDefs, measurement } from "../helpers";

const defs = loadDefs();
const nutrient = (id: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "knowledge", "nutrients", `${id}.json`), "utf8")) as NutrientDef;
const nutrients = [nutrient("creatine"), nutrient("biotin")];
const m = (biomarkerId: string, date: string, value: number, extra: Partial<Measurement> = {}) =>
  measurement({ biomarkerId, date, value, originalUnit: defs.get(biomarkerId)!.canonicalUnit, source: "pdf", ...extra });
const lab = (low?: number, high?: number) => ({ labRange: { ...(low !== undefined ? { low } : {}), ...(high !== undefined ? { high } : {}) } });

const summary = (measurements: Measurement[], extra: { protocols?: ProtocolEntry[]; date?: string } = {}) =>
  buildTestSummary({
    measurements,
    defs,
    profile: { sex: "f" },
    protocols: extra.protocols ?? [],
    nutrients,
    categoryOrder: ["Blood count", "Kidney", "Electrolytes"],
    ...(extra.date ? { date: extra.date } : {}),
  })!;

describe("buildTestSummary", () => {
  const history = [
    m("hemoglobin", "2026-03-01", 112, lab(120, 160)),
    m("creatinine", "2026-03-01", 120, lab(44, 80)),
    m("ferritin", "2026-03-01", 8, lab(13, 150)),
    m("hemoglobin", "2026-09-29", 107, lab(120, 161)),
    m("creatinine", "2026-09-29", 169, lab(44, 80)),
    m("egfr", "2026-09-29", 23, lab(90)),
    m("ferritin", "2026-09-29", 40, lab(13, 150)),
    m("sodium", "2026-09-29", 140, lab(133, 145)),
    m("mpv", "2026-09-29", 7.8),
  ];

  it("summarises the latest test by default, grouped in the app's category order", () => {
    const s = summary(history);
    expect(s.date).toBe("2026-09-29");
    expect(s.dates).toEqual(["2026-09-29", "2026-03-01"]);
    expect(s.results).toBe(6);
    expect(s.inRange).toBe(2);
    expect(s.outOfRange.map((g) => [g.category, g.items.map((i) => i.id)])).toEqual([
      ["Blood count", ["hemoglobin"]],
      ["Kidney", ["creatinine", "egfr"]],
    ]);
  });

  it("explains each result with the marker file's own meaning and causes", () => {
    const hb = summary(history).outOfRange[0]!.items[0]!;
    expect(hb.meaning).toBe(defs.get("hemoglobin")!.low.meaning);
    expect(hb.commonCauses).toEqual(defs.get("hemoglobin")!.low.commonCauses);
  });

  it("compares with the previous result, using normal test-to-test variation where it's known", () => {
    const s = summary(history);
    const hb = s.outOfRange[0]!.items[0]!;
    expect(hb).toMatchObject({ streak: 2, streakFrom: "2026-03-01", previous: { date: "2026-03-01", value: 112 } });
    // 112 → 107 is a few percent: within haemoglobin's normal variation, not "further".
    expect(hb).toMatchObject({ change: "about the same", beyondNormalVariation: false });
    // 120 → 169 is beyond creatinine's normal variation and further above the range.
    const crea = s.outOfRange[1]!.items[0]!;
    expect(crea).toMatchObject({ change: "further", beyondNormalVariation: true });
    // 150 → 169 would be within it.
    const smaller = summary(history.map((x) => (x.biomarkerId === "creatinine" && x.date === "2026-03-01" ? { ...x, value: 150 } : x)));
    expect(smaller.outOfRange[1]!.items[0]!.change).toBe("about the same");
    expect(s.outOfRange[1]!.items[1]).toMatchObject({ id: "egfr", streak: 1 });
    expect(s.outOfRange[1]!.items[1]!.change).toBeUndefined();
  });

  it("lists results that came back into range and never calls an unranged result normal", () => {
    const s = summary(history);
    expect(s.backInRange.map((r) => r.id)).toEqual(["ferritin"]);
    expect(s.notAssessed.map((r) => r.id)).toEqual(["mpv"]);
  });

  it("can summarise an earlier test", () => {
    const s = summary(history, { date: "2026-03-01" });
    expect(s.date).toBe("2026-03-01");
    expect(s.backInRange).toEqual([]);
    expect(s.outOfRange.flatMap((g) => g.items).every((i) => i.previous === undefined)).toBe(true);
  });

  it("puts critical results apart", () => {
    const s = summary([m("potassium", "2026-01-05", 6.8, lab(3.5, 5.1))]);
    expect(s.critical.map((r) => r.id)).toEqual(["potassium"]);
    expect(s.outOfRange).toEqual([]);
  });

  it("writes doctor questions from the person's own numbers", () => {
    const s = summary(history);
    expect(s.questions).toEqual([
      "My haemoglobin has been low on 2 tests in a row, since 2026-03-01. What could explain it, and does it need follow-up?",
      expect.stringMatching(/^My .*creatinine has been high on 2 tests in a row/),
      expect.stringMatching(
        /^My .* was 23 mL\/min\/1\.73m², below the range \(above 90 mL\/min\/1\.73m²\)\. What could explain it, and should it be re-tested\?$/,
      ),
      "Which of these results matter most for me, and when should I have the next test?",
    ]);
  });

  it("notes a supplement in the log that is known to skew a test, quoting the nutrient file", () => {
    const creatine: ProtocolEntry = { id: "p1", label: "Creatine 5 g", category: "supplement", start: "2026-01-01" };
    const s = summary(history, { protocols: [creatine] });
    const c = s.cautions.find((x) => x.kind === "supplement")!;
    expect(c).toMatchObject({ nutrientId: "creatine", habit: "Creatine 5 g", markers: ["creatinine", "egfr"] });
    expect(nutrient("creatine").cautions).toContain(c.text);
    expect(s.questions).toContainEqual(expect.stringMatching(/^I was taking Creatine 5 g around this test\. Could it affect my creatinine and .+ results\?$/));
    // Not when the habit ended before the test, or the affected test wasn't done.
    expect(summary(history, { protocols: [{ ...creatine, end: "2026-06-01" }] }).cautions.some((x) => x.kind === "supplement")).toBe(false);
    expect(summary([m("sodium", "2026-09-29", 140)], { protocols: [creatine] }).cautions.some((x) => x.kind === "supplement")).toBe(false);
  });

  it("finds a supplement inside a started protocol", () => {
    const routine: ProtocolEntry = {
      id: "p2",
      label: "Morning routine",
      category: "supplement",
      start: "2026-01-01",
      plan: { id: "plan", items: [{ id: "i", label: "Biotin", category: "supplement", when: "morning" }] },
    };
    const s = summary([m("tsh", "2026-02-01", 0.1, lab(0.27, 4.2))], { protocols: [routine] });
    expect(s.cautions.find((x) => x.kind === "supplement")).toMatchObject({ nutrientId: "biotin", markers: ["tsh"] });
  });

  it("flags unfasted fasting tests, photo-read values, typical ranges and bounded values", () => {
    const s = summary([
      m("glucose", "2026-02-01", 5.4),
      m("triglycerides", "2026-02-01", 1.2, { fasted: false }),
      m("crp_hs", "2026-02-01", 0.3, { qualifier: "<", source: "photo" }),
    ]);
    const kinds = Object.fromEntries(s.cautions.map((c) => [c.kind, c]));
    expect(kinds.fasting!.text).toBe(
      "Glucose and triglycerides are usually judged on a fasting sample, and this test isn't marked as fasting, so the fasting range may not apply.",
    );
    expect(kinds.photo!.markers).toEqual(["crp_hs"]);
    expect(kinds["typical-range"]!.markers).toEqual(expect.arrayContaining(["glucose", "triglycerides"]));
    expect(kinds.bounded!.markers).toEqual(["crp_hs"]);
    const fasted = summary([m("glucose", "2026-02-01", 5.4, { fasted: true })]);
    expect(fasted.cautions.some((c) => c.kind === "fasting")).toBe(false);
  });

  it("leaves out body measurements and says nothing when there are no blood tests", () => {
    expect(buildTestSummary({ measurements: [m("weight", "2026-01-01", 70)], defs, profile: {}, protocols: [], nutrients })).toBeUndefined();
  });

  it("never uses diagnosing or prescribing words of its own", () => {
    const s = summary(history, { protocols: [{ id: "p1", label: "Creatine", category: "supplement", start: "2026-01-01" }] });
    const own = [...s.questions, ...s.limits, ...s.cautions.filter((c) => c.kind !== "supplement").map((c) => c.text)].join(" ");
    expect(own).not.toMatch(/\b(you have|diagnos(is|ed)|disease|you should take|stop taking|start taking|dose)\b/i);
    expect(s.limits).toEqual([...SUMMARY_LIMITS]);
  });
});

describe("rangeText", () => {
  it("writes both limits, or the one there is", () => {
    expect(rangeText({ low: 3.4, high: 5 }, "mmol/L")).toBe("3.4–5 mmol/L");
    expect(rangeText({ high: 5 }, "mg/L")).toBe("below 5 mg/L");
    expect(rangeText({ low: 90 }, "ratio")).toBe("above 90");
    expect(rangeText(undefined, "g/L")).toBeUndefined();
  });
});
