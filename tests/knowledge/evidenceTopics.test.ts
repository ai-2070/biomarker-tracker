import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NutrientDef } from "../../src/core/nutrients";
import { TOPICS } from "../../tools/evidence/topics";

const ROOT = join(import.meta.dirname, "..", "..");

describe("evidence map search definitions", () => {
  it.each(TOPICS)("$id points at real findings and asks a complete question for each", (t) => {
    const file = join(ROOT, "knowledge", "nutrients", `${t.nutrientId}.json`);
    expect(existsSync(file), t.nutrientId).toBe(true);
    const nutrient = JSON.parse(readFileSync(file, "utf8")) as NutrientDef;
    const findings = nutrient.findings.map((f) => f.outcome);
    expect(t.terms.length).toBeGreaterThan(0);
    expect(new Set(t.outcomes.map((o) => o.id)).size).toBe(t.outcomes.length);
    for (const o of t.outcomes) {
      if (o.finding) expect(findings, `${t.id}/${o.id}`).toContain(o.finding);
      for (const part of ["population", "intervention", "comparison", "outcome"] as const) expect(o.question[part].length, `${t.id}/${o.id} ${part}`).toBeGreaterThan(3);
    }
  });

  it("has one definition per nutrient", () => {
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
  });
});
