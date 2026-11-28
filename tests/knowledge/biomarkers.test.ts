import { foldLabName } from "@bt/shared/core/importers/labText";
import { validateBiomarkerDef } from "@bt/shared/core/knowledge";
import type { BiomarkerDef } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";
import { loadKnowledgeFiles } from "../helpers";

const files = loadKnowledgeFiles();

describe("knowledge base: biomarkers", () => {
  it("has entries", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("$file is valid", ({ file, json }) => {
    expect(validateBiomarkerDef(json)).toEqual([]);
    expect(`${(json as BiomarkerDef).id}.json`).toBe(file);
  });

  it("has unique ids", () => {
    const ids = files.map(({ json }) => (json as BiomarkerDef).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never gives the same alias to two markers (PDF import relies on this)", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const { json } of files) {
      const d = json as BiomarkerDef;
      // Compared as the importer compares them: case, accents and spacing ignored.
      for (const a of new Set([d.name, ...d.aliases].map((s) => foldLabName(s).text))) {
        const prev = owner.get(a);
        if (prev && prev !== d.id) clashes.push(`"${a}": ${prev} and ${d.id}`);
        owner.set(a, d.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("covers the v0.3 marker groups from CLAUDE.md", () => {
    const ids = new Set(files.map(({ json }) => (json as BiomarkerDef).id));
    const groups = {
      bloodCount: ["hemoglobin", "rbc", "hematocrit", "mcv", "mch", "mchc", "rdw", "wbc", "platelets", "neutrophil_pct", "lymphocyte_pct"],
      lipids: ["total_cholesterol", "ldl", "hdl", "triglycerides"],
      glucose: ["glucose", "hba1c"],
      liver: ["alt", "ast", "ggt", "alp", "bilirubin", "albumin"],
      kidney: ["creatinine", "egfr", "urea"],
      thyroid: ["tsh", "ft4"],
      iron: ["ferritin", "iron", "transferrin_saturation"],
      vitamins: ["vitamin_d", "b12", "folate"],
      inflammation: ["crp_hs"],
    };
    const missing = Object.values(groups)
      .flat()
      .filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  it("critical limits sit outside the normal range", () => {
    for (const { json } of files) {
      const d = json as BiomarkerDef;
      if (!d.criticalRange) continue;
      for (const r of d.defaultRanges ?? []) {
        if (d.criticalRange.low !== undefined && r.low !== undefined) expect(d.criticalRange.low).toBeLessThan(r.low);
        if (d.criticalRange.high !== undefined && r.high !== undefined) expect(d.criticalRange.high).toBeGreaterThan(r.high);
      }
    }
  });

  it("includes every PhenoAge input (needed for v0.2)", () => {
    const ids = new Set(files.map(({ json }) => (json as BiomarkerDef).id));
    for (const id of ["albumin", "creatinine", "glucose", "crp_hs", "lymphocyte_pct", "mcv", "rdw", "alp", "wbc"]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe("validateBiomarkerDef", () => {
  const valid = files[0]!.json as BiomarkerDef;

  it("requires at least one source", () => {
    expect(validateBiomarkerDef({ ...valid, sources: [] })).toContain("at least one source is required");
  });
  it("requires a pmid or doi on every source", () => {
    const errs = validateBiomarkerDef({ ...valid, sources: [{ title: "x", year: 2020, studyType: "review" }] });
    expect(errs).toContain("source 1 needs a pmid or doi");
  });
  it("requires the canonical unit to have factor 1", () => {
    expect(validateBiomarkerDef({ ...valid, conversions: { [valid.canonicalUnit]: 2 } })).toContain("the canonical unit must have conversion factor 1");
  });
  it("rejects inverted ranges", () => {
    expect(validateBiomarkerDef({ ...valid, defaultRanges: [{ low: 5, high: 1 }] })).toContain("range low must be below high");
  });
  it("rejects non-objects", () => {
    expect(validateBiomarkerDef("x")).toEqual(["entry is not an object"]);
  });
});

describe("published within-person variation", () => {
  const withBv = loadKnowledgeFiles()
    .map(({ json }) => json as BiomarkerDef)
    .filter((d) => d.biologicalVariation);

  it("comes only from the reviewed original studies, never EFLM's database or estimates", () => {
    // The owner's decisions, 2026-11-28 (docs/biological-variation-candidates.md): NHANES 1999–2002 (Lacher 2010),
    // Corte & Venta 2020, HCHS/SOL (Thyagarajan 2016) for fasting glucose, Bower 2012 for hs-CRP. No EuBIVAS, TSH or HbA1c.
    const allowed = new Set(["20540274", "32355725", "27756543", "22945505"]);
    expect(withBv.map((d) => d.id).sort()).toEqual(
      ["alt", "b12", "creatinine", "crp_hs", "ferritin", "glucose", "hdl", "homocysteine", "ldl", "total_cholesterol", "triglycerides", "vitamin_d"].sort(),
    );
    for (const d of withBv) {
      const bv = d.biologicalVariation!;
      expect(allowed.has(bv.source.pmid ?? ""), d.id).toBe(true);
      expect(JSON.stringify(bv), d.id).not.toMatch(/eflm|biologicalvariation\.eu|eubivas/i);
    }
  });
});
