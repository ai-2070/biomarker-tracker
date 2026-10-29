import { describe, expect, it } from "vitest";
import { findingCounts, interactionsFor, searchNutrients, sortFindings, strongestBenefit, validateNutrientDef, type NutrientDef, type NutrientFinding } from "../../src/core/nutrients";

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

  it("searches names, other names and what is inside each entry, and says where it matched", () => {
    const b12: NutrientDef = { ...n, id: "b12", name: "Vitamin B12", otherNames: ["Cobalamin"], foodSources: { examples: ["Meat", "Eggs"] }, interactions: [] };
    const d: NutrientDef = { ...n, id: "d", name: "Vitamin D", otherNames: ["Cholecalciferol (vitamin D3)"], foodSources: { examples: ["Oily fish"] } };
    const all = [n, b12, d];
    expect(searchNutrients(all, "").map((x) => x.n.id)).toEqual(["test_nutrient", "b12", "d"]);
    expect(searchNutrients(all, "  ")).toHaveLength(3);
    // Name first, no reason shown; "B12", "b 12" and "vit b12" all find it.
    for (const q of ["B12", "b 12", "vit b12", "VITAMIN b-12"]) expect(searchNutrients(all, q)).toEqual([{ n: b12 }]);
    expect(searchNutrients(all, "d3")).toEqual([{ n: d, match: { label: "Also called", text: "Cholecalciferol (vitamin D3)" } }]);
    expect(searchNutrients(all, "cobalamin")[0]).toEqual({ n: b12, match: { label: "Also called", text: "Cobalamin" } });
    // Words start words: "fish" finds "Oily fish" and "Fish"; "ish" finds nothing.
    expect(searchNutrients(all, "fish").map((x) => x.n.id)).toEqual(["test_nutrient", "d"]);
    expect(searchNutrients(all, "ish")).toEqual([]);
    expect(searchNutrients(all, "warfarin").map((x) => [x.n.id, x.match?.label])).toEqual([["test_nutrient", "Interaction"], ["d", "Interaction"]]);
    // Every word must match somewhere; a part with all of them wins.
    expect(searchNutrients(all, "oily fish").map((x) => x.match)).toEqual([{ label: "Food", text: "Oily fish" }]);
    expect(searchNutrients(all, "vitamin warfarin").map((x) => x.n.id)).toEqual(["d"]);
    expect(searchNutrients(all, "café")).toEqual([]);
  });
});
