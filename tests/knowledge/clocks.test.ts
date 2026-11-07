import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ClockFile, clockFindingsAbout, clockPrescribes, validateClockFile } from "@bt/shared/core/clocks";
import { describe, expect, it } from "vitest";

const K = join(import.meta.dirname, "..", "..", "knowledge");
const FILE = join(K, "clocks", "interventions.json");
const file = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as ClockFile) : undefined;

describe("knowledge base: what has moved the aging clocks", () => {
  it.skipIf(!file)("is valid, never prescribes, and links only to pages that exist", () => {
    expect(validateClockFile(file)).toEqual([]);
    expect(clockPrescribes(file!)).toEqual([]);
    const dir = { nutrient: "nutrients", wholefood: "wholefoods", lifestyle: "lifestyle" } as const;
    for (const f of file!.findings)
      for (const a of f.about ?? []) expect(existsSync(join(K, dir[a.kind], `${a.id}.json`)), `${f.outcome} -> ${a.kind}/${a.id}`).toBe(true);
    // The caveat must say the clocks are stand-ins, not proof of longer life.
    expect(file!.caveat).toMatch(/life|lifespan|live longer/i);
  });

  it("finds the clock findings about one page", () => {
    const src = [{ pmid: "1", title: "T", year: 2025, studyType: "rct" }];
    const f = {
      intro: "I",
      caveat: "C",
      sources: src,
      findings: [
        {
          outcome: "Omega-3: clocks",
          population: "P",
          effect: "helps",
          grade: "low",
          whyThisGrade: ["w"],
          summary: "S",
          label: "Omega-3",
          line: "Slightly slower clocks",
          studies: src,
          clocks: ["PhenoAge"],
          about: [{ kind: "nutrient", id: "omega_3" }],
        },
      ],
    } as unknown as ClockFile;
    expect(validateClockFile(f)).toEqual([]);
    expect(clockFindingsAbout(f, "nutrient", "omega_3").length).toBe(1);
    expect(clockFindingsAbout(f, "wholefood", "omega_3")).toEqual([]);
    expect(validateClockFile({ ...f, findings: [{ ...f.findings[0], clocks: ["Magic"] }] })[0]).toMatch(/clocks must be from/);
  });
});
