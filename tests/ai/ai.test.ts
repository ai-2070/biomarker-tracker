import { describe, expect, it } from "vitest";
import { checkCitations, normalizeId } from "../../src/ai/citations";


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
