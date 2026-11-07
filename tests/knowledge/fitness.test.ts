import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type FitnessTestDef, validateFitnessTest } from "@bt/shared/core/fitnessTests";
import { PRESCRIBING } from "@bt/shared/core/nutrients";
import { describe, expect, it } from "vitest";
import { loadDefs } from "../helpers";

const DIR = join(import.meta.dirname, "..", "..", "knowledge", "fitness");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((file) => ({ file, json: JSON.parse(readFileSync(join(DIR, file), "utf8")) as unknown }));
const tests = files.map((f) => f.json as FitnessTestDef);
const defs = loadDefs();

describe("knowledge base: fitness tests", () => {
  it.each(files)("$file is valid", ({ file, json }) => {
    expect(validateFitnessTest(json)).toEqual([]);
    expect(`${(json as FitnessTestDef).id}.json`).toBe(file);
  });

  it("each test is stored as a body measurement with the same id and unit", () => {
    for (const t of tests) {
      const d = defs.get(t.id);
      expect(d, t.id).toBeDefined();
      expect(d!.category).toBe("Body");
      expect(d!.canonicalUnit).toBe(t.unit);
    }
  });

  it("never words general information as personal advice", () => {
    for (const t of tests)
      for (const line of [t.summary, ...t.howTo, ...t.safety, ...t.limits, ...t.evidence.map((e) => e.claim)])
        expect(PRESCRIBING.test(line), `${t.id}: ${line}`).toBe(false);
  });

  it("never uses the push-up chart whose source couldn't be traced", () => {
    const push = tests.find((t) => t.id === "pushups")!;
    // Blueprint's chart: men in their 20s "Excellent 39+". The CSEP table says 36+.
    const men20 = push.norms[0]!.rows.find((r) => r.sex === "m" && r.ageFrom === 20)!;
    expect(men20.bands!.find((b) => b.label === "Excellent")!.min).toBe(36);
  });
});
