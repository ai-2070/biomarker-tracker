import { describe, expect, it } from "vitest";
import { checkCitations, normalizeId } from "../../../shared/health/ai/citations.ts";
import { buildAiContext, MAX_ABSTRACT_CHARS, MAX_PAPERS, systemPrompt } from "../../../shared/health/ai/context.ts";
import type { Paper } from "../../../shared/health/research.ts";
import { def } from "../helpers.ts";

const paper = (n: number, extra: Partial<Paper> = {}): Paper => ({
  id: `PMID:${1000 + n}`,
  pmid: String(1000 + n),
  title: `Study ${n}`,
  kind: "meta-analysis",
  openAccess: false,
  url: "https://example.org",
  year: 2024,
  abstract: "Short abstract.",
  ...extra,
});

describe("citation checker", () => {
  const allowed = new Set(["PMID:1001", "PMID:1002", "PMCID:PMC555"]);

  it("marks retrieved IDs as verified and others as unverified", () => {
    const r = checkCitations("Iron raises ferritin [PMID:1001]. Also see [PMID:9999].", allowed);
    expect(r.verified).toEqual(["PMID:1001"]);
    expect(r.unverified).toEqual(["PMID:9999"]);
    expect(r.segments).toEqual([
      { type: "text", text: "Iron raises ferritin " },
      { type: "cite", id: "PMID:1001", valid: true },
      { type: "text", text: ". Also see " },
      { type: "cite", id: "PMID:9999", valid: false },
      { type: "text", text: "." },
    ]);
  });

  it("handles several IDs in one bracket and different spellings", () => {
    const r = checkCitations("Shown in [PMID: 1001; pmid 1002, PMCID:PMC555].", allowed);
    expect(r.verified).toEqual(["PMID:1001", "PMID:1002", "PMCID:PMC555"]);
    expect(r.unverified).toEqual([]);
  });

  it("checks IDs written without brackets too", () => {
    const r = checkCitations("According to PMID 4242, it works.", allowed);
    expect(r.unverified).toEqual(["PMID:4242"]);
  });

  it("leaves ordinary brackets alone", () => {
    const r = checkCitations("Ferritin [a storage protein] is low.", allowed);
    expect(r.segments).toEqual([{ type: "text", text: "Ferritin [a storage protein] is low." }]);
  });

  it("counts author-year references it can't verify", () => {
    expect(checkCitations("As Smith et al. (2019) showed.", allowed).looseReferences).toEqual(["Smith et al. (2019)"]);
  });

  it("normalises IDs", () => {
    expect(normalizeId("pmid", "123")).toBe("PMID:123");
    expect(normalizeId("PMCID", "123")).toBe("PMCID:PMC123");
    expect(normalizeId("pmcid", "pmc123")).toBe("PMCID:PMC123");
  });
});

describe("context builder", () => {
  const base = {
    def: def("ferritin"),
    unit: "µg/L",
    question: "Does vitamin C help iron absorption?",
    papers: [paper(1), paper(2)],
  };

  it("includes rules, studies with IDs and the question", () => {
    const { system, user, allowedIds } = buildAiContext(base);
    expect(system).toMatch(/Cite them with their ID/);
    expect(system).toMatch(/Do not diagnose/);
    expect(user).toMatch(/\[PMID:1001\] Study 1 \(2024, Meta-analysis\)/);
    expect(user).toMatch(/QUESTION: Does vitamin C help iron absorption\?$/);
    expect([...allowedIds]).toEqual(["PMID:1001", "PMID:1002"]);
  });

  it("leaves out personal results unless given", () => {
    expect(buildAiContext(base).user).not.toMatch(/MY RESULTS/);
    const withResults = buildAiContext({
      ...base,
      results: [{ date: "2024-01-01", value: "11", flag: "low", range: "15–150 µg/L" }],
      age: 40.7,
      sex: "f",
    }).user;
    expect(withResults).toMatch(/- 2024-01-01: 11 µg\/L, low \(range 15–150 µg\/L\)/);
    expect(withResults).toMatch(/About me: age 40, female/);
  });

  it("never contains birth dates, lab names or notes (they aren't inputs)", () => {
    const user = buildAiContext({ ...base, results: [{ date: "2024-01-01", value: "11", flag: "low" }], age: 40 }).user;
    expect(user).not.toMatch(/birth|lab name|note/i);
  });

  it("limits studies and abstract length", () => {
    const many = Array.from({ length: MAX_PAPERS + 3 }, (_, i) => paper(i, { abstract: "word ".repeat(1000) }));
    const { user, allowedIds } = buildAiContext({ ...base, papers: many });
    expect(allowedIds.size).toBe(MAX_PAPERS);
    const abstractLine = user.split("\n").find((l) => l.startsWith("Abstract:"))!;
    expect(abstractLine.length).toBeLessThan(MAX_ABSTRACT_CHARS + 20);
    expect(abstractLine.endsWith("…")).toBe(true);
  });

  it("adds a no-nutrient-increase rule when the log calls for caution", () => {
    expect(systemPrompt(false)).not.toMatch(/Do not suggest increasing/);
    expect(systemPrompt(true)).toMatch(/Do not suggest increasing any nutrient/);
  });
});
