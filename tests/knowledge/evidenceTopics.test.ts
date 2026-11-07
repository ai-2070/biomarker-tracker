import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComparisonTopicFile } from "@bt/shared/core/foodComparison";
import type { LifestyleDef } from "@bt/shared/core/lifestyle";
import type { NutrientDef } from "@bt/shared/core/nutrients";
import type { WholeFoodDef } from "@bt/shared/core/wholeFoods";
import { describe, expect, it } from "vitest";
import { TOPICS } from "../../tools/evidence/topics";

const ROOT = join(import.meta.dirname, "..", "..");

/** What a topic's outcomes can point at: a nutrient's or lifestyle entry's findings, or a food comparison topic's claims. */
function targets(t: (typeof TOPICS)[number]): string[] {
  if (t.kind === "wholefood") {
    const file = join(ROOT, "knowledge", "wholefoods", `${t.wholeFoodId}.json`);
    expect(existsSync(file), String(t.wholeFoodId)).toBe(true);
    return (JSON.parse(readFileSync(file, "utf8")) as WholeFoodDef).findings.map((f) => f.outcome);
  }
  if (t.kind === "lifestyle") {
    const file = join(ROOT, "knowledge", "lifestyle", `${t.lifestyleId}.json`);
    expect(existsSync(file), String(t.lifestyleId)).toBe(true);
    return (JSON.parse(readFileSync(file, "utf8")) as LifestyleDef).findings.map((f) => f.outcome);
  }
  if (t.kind === "food") {
    const file = join(ROOT, "knowledge", "food-comparison", `${t.comparisonId}.json`);
    expect(existsSync(file), String(t.comparisonId)).toBe(true);
    return (JSON.parse(readFileSync(file, "utf8")) as ComparisonTopicFile).claims.map((c) => c.id);
  }
  const file = join(ROOT, "knowledge", "nutrients", `${t.nutrientId}.json`);
  expect(existsSync(file), String(t.nutrientId)).toBe(true);
  return (JSON.parse(readFileSync(file, "utf8")) as NutrientDef).findings.map((f) => f.outcome);
}

describe("evidence map search definitions", () => {
  it.each(TOPICS)("$id points at real findings or claims and asks a complete question for each", (t) => {
    const findings = targets(t);
    expect(new Set(t.outcomes.map((o) => o.id)).size).toBe(t.outcomes.length);
    for (const o of t.outcomes) {
      if (o.finding) expect(findings, `${t.id}/${o.id}`).toContain(o.finding);
      for (const part of ["population", "intervention", "comparison", "outcome"] as const)
        expect(o.question[part].length, `${t.id}/${o.id} ${part}`).toBeGreaterThan(3);
      // A food claim or lifestyle finding is found by its own search; a supplement outcome by words in the title.
      if (t.kind === "food" || t.kind === "lifestyle" || t.kind === "wholefood") expect(o.query, `${t.id}/${o.id}`).toBeTruthy();
      else expect(o.title, `${t.id}/${o.id}`).toBeTruthy();
    }
    if (t.kind !== "food" && t.kind !== "lifestyle" && t.kind !== "wholefood") expect(t.terms.length).toBeGreaterThan(0);
  });

  it("covers every food comparison claim and lifestyle finding, and has one definition per nutrient or topic", () => {
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
    for (const t of TOPICS.filter((x) => x.kind === "food" || x.kind === "lifestyle" || x.kind === "wholefood"))
      expect(t.outcomes.map((o) => o.finding).sort()).toEqual(targets(t).sort());
  });
});
