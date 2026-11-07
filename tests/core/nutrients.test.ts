import {
  findingCounts,
  interactionsFor,
  type NutrientDef,
  type NutrientFinding,
  searchNutrients,
  sortFindings,
  strongestBenefit,
  validateNutrientDef,
} from "@bt/shared/core/nutrients";
import { describe, expect, it } from "vitest";

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

const basic: NutrientDef = {
  ...n,
  id: "basic_supplement",
  kind: "supplement",
  researchStatus: "not-reviewed",
  commonUses: ["Used in products marketed for relaxation"],
  low: { signs: [], atRisk: [] },
  foodSources: { examples: [] },
  reference: { intake: [], noUpperLimit: "No reference values supplied in this guide.", sources: [] },
  findings: [],
  interactions: [],
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
  it("accepts sourced basic guides without inventing findings or deficiency signs", () => {
    expect(validateNutrientDef(basic)).toEqual([]);
    expect(
      validateNutrientDef({
        ...basic,
        sources: [],
        basicSources: [{ title: "Public safety guidance", year: 2025, url: "https://example.org/safety" }],
      }),
    ).toEqual([]);
  });
  it("does not let unreviewed guides present graded benefits or omit their purpose", () => {
    expect(validateNutrientDef({ ...basic, commonUses: [] })).not.toEqual([]);
    expect(validateNutrientDef({ ...basic, findings: [finding("A", "helps", "high")] })).not.toEqual([]);
    expect(validateNutrientDef({ ...basic, foodFindings: [finding("A", "helps", "high")] })).not.toEqual([]);
    expect(validateNutrientDef({ ...basic, evidenceClaims: ["claim"] })).not.toEqual([]);
    expect(validateNutrientDef({ ...basic, kind: "vitamin" })).not.toEqual([]);
  });
  it("requires origin and amount context without turning a claim guide into a graded review", () => {
    const simpleGuide = { origin: ["Cultivated algae"], dosage: ["Read the active ingredient amount."] };
    expect(validateNutrientDef({ ...basic, simpleGuide })).toEqual([]);
    expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, origin: [] } })).not.toEqual([]);
    expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, dosage: [""] } })).not.toEqual([]);
    expect(validateNutrientDef({ ...n, simpleGuide })).not.toEqual([]);
    expect(validateNutrientDef({ ...basic, simpleGuide, findings: [finding("A", "helps", "high")] })).not.toEqual([]);
  });
  it("keeps live checks attached to their exact claim and rejects unsafe metadata", () => {
    const claim = basic.commonUses![0]!;
    const simpleGuide = {
      origin: ["Cultivated algae"],
      dosage: ["A safety assessment, not a personal dose."],
      factsReviewedOn: "2026-10-31",
      claimsSource: { title: "Research notes", url: "https://example.org/notes" },
      claimTopics: { [claim]: "relaxation" },
    };
    expect(validateNutrientDef({ ...basic, simpleGuide })).toEqual([]);
    for (const claimTopics of [{}, { "A different claim": "relaxation" }, { [claim]: "" }]) {
      expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, claimTopics } })).not.toEqual([]);
    }
    expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, factsReviewedOn: "2026-02-30" } })).not.toEqual([]);
    expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, claimsSource: { title: "Notes", url: "javascript:alert(1)" } } })).not.toEqual([]);
  });
  it("requires a valid display category for every claim without turning categories into evidence", () => {
    const claim = basic.commonUses![0]!;
    const simpleGuide = { origin: ["Cultivated algae"], dosage: ["Read the active ingredient amount."] };
    for (const category of ["health", "longevity", "appearance"]) {
      expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, claimCategories: { [claim]: category } } })).toEqual([]);
    }
    for (const claimCategories of [{}, { [claim]: "beauty" }, { [claim]: "health", Other: "appearance" }]) {
      expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, claimCategories } })).not.toEqual([]);
    }
  });
  it("allows neutral labels while requiring every stable claim to stay identifiable", () => {
    const claim = basic.commonUses![0]!;
    const simpleGuide = { origin: ["Cultivated algae"], dosage: ["Read the active ingredient amount."] };
    expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, claimLabels: { [claim]: "Relaxation" } } })).toEqual([]);
    for (const claimLabels of [{}, { [claim]: "" }, { Other: "Relaxation" }]) {
      expect(validateNutrientDef({ ...basic, simpleGuide: { ...simpleGuide, claimLabels } })).not.toEqual([]);
    }
  });
  it("keeps the source and finding requirements for researched entries", () => {
    expect(validateNutrientDef({ ...n, findings: [] })).not.toEqual([]);
    expect(validateNutrientDef({ ...n, sources: [] })).not.toEqual([]);
    expect(validateNutrientDef({ ...n, researchStatus: "complete" })).not.toEqual([]);
    expect(validateNutrientDef({ ...n, basicSources: [{ title: "Web page", year: 2025, url: "https://example.org/" }] })).not.toEqual([]);
  });
  it("requires real sources and safe source links on basic guides", () => {
    expect(validateNutrientDef({ ...basic, sources: [] })).not.toEqual([]);
    expect(
      validateNutrientDef({
        ...basic,
        sources: [],
        basicSources: [{ title: "Unsafe link", year: 2025, url: "javascript:alert(1)" }],
      }),
    ).not.toEqual([]);
    expect(
      validateNutrientDef({
        ...basic,
        sources: [],
        basicSources: [{ title: "Broken link", year: 2025, url: "not a URL" }],
      }),
    ).not.toEqual([]);
  });
  it("finds basic guides by their common uses", () => {
    expect(searchNutrients([n, basic], "relaxation").map((x) => x.n.id)).toEqual(["basic_supplement"]);
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
    expect(searchNutrients(all, "warfarin").map((x) => [x.n.id, x.match?.label])).toEqual([
      ["test_nutrient", "Interaction"],
      ["d", "Interaction"],
    ]);
    // Every word must match somewhere; a part with all of them wins.
    expect(searchNutrients(all, "oily fish").map((x) => x.match)).toEqual([{ label: "Food", text: "Oily fish" }]);
    expect(searchNutrients(all, "vitamin warfarin").map((x) => x.n.id)).toEqual(["d"]);
    expect(searchNutrients(all, "café")).toEqual([]);
  });
});
