import { describe, expect, it } from "vitest";
import { findingCounts, interactionsFor, sortFindings, strongestBenefit, validateNutrientDef, type NutrientDef, type NutrientFinding } from "../../src/core/nutrients";

const study = { pmid: "1", title: "A trial", year: 2020, studyType: "rct" as const };
const finding = (outcome: string, effect: NutrientFinding["effect"], grade: NutrientFinding["grade"]): NutrientFinding => ({
  outcome,
  population: "Adults",
  effect,
  grade,
  whyThisGrade: ["Large trials"],
  summary: "What was found.",
  studies: [study],
});
const n: NutrientDef = {
  id: "test_nutrient",
  name: "Test",
  kind: "vitamin",
  otherNames: [],
  summary: "A test nutrient.",
  roles: ["Testing"],
  status: { biomarkerIds: [], note: "No test." },
  low: { signs: ["Tiredness"], atRisk: ["Everyone"] },
  high: { signs: [], note: "Rare." },
  foodSources: { examples: ["Fish"] },
  forms: [],
  reference: { intake: [{ group: "Adults", amount: 10, unit: "µg", type: "AI" }], noUpperLimit: "No harm seen.", sources: [study] },
  findings: [finding("A", "no clear effect", "high"), finding("B", "helps", "moderate"), finding("C", "harms", "high"), finding("D", "helps", "low")],
  interactions: [
    { with: "Warfarin", note: "Affects clotting.", safetyId: "anticoagulant" },
    { with: "Calcium", note: "Competes for absorption." },
  ],
  cautions: [],
  evidenceClaims: [],
  sources: [study],
};

describe("vitamins and minerals", () => {
  it("accepts a complete entry", () => {
    expect(validateNutrientDef(n)).toEqual([]);
  });
  it("needs an upper limit or a reason there is none, and sources everywhere", () => {
    const { noUpperLimit: _, ...ref } = n.reference;
    expect(validateNutrientDef({ ...n, reference: ref })).toContain("give an upperLimit or say why there is none (noUpperLimit)");
    expect(validateNutrientDef({ ...n, findings: [{ ...finding("A", "helps", "high"), studies: [] }] })).toContain("finding 1 needs at least one source");
    expect(validateNutrientDef({ ...n, interactions: [{ with: "X", note: "Y", safetyId: "nope" }] })).not.toEqual([]);
  });
  it("counts and orders findings: strongest first, harms first at the same grade", () => {
    expect(findingCounts(n)).toEqual({ helps: 2, "no clear effect": 1, harms: 1, mixed: 0 });
    expect(sortFindings(n.findings).map((f) => f.outcome)).toEqual(["C", "A", "B", "D"]);
    expect(strongestBenefit(n)).toBe("moderate");
  });
  it("picks the interactions that apply to this person", () => {
    expect(interactionsFor(n, ["anticoagulant"]).map((x) => x.with)).toEqual(["Warfarin"]);
    expect(interactionsFor(n, ["kidney"])).toEqual([]);
  });
});
