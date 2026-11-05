import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateComparisonTopic, type ComparisonTopicFile } from "@bt/core/foodComparison";
import { PRESCRIBING } from "@bt/core/nutrients";

const DIR = join(import.meta.dirname, "..", "..", "knowledge", "food-comparison");
const files = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .map((file) => ({ file, json: JSON.parse(readFileSync(join(DIR, file), "utf8")) as ComparisonTopicFile }))
  : [];

describe("knowledge base: animal foods, fruit and plants compared", () => {
  it.each(files)("$file is valid", ({ file, json }) => {
    expect(validateComparisonTopic(json)).toEqual([]);
    expect(`${json.topic}.json`).toBe(file);
  });
  it("has unique claim ids and never words them as advice", () => {
    const claims = files.flatMap((f) => f.json.claims);
    expect(new Set(claims.map((c) => c.id)).size).toBe(claims.length);
    for (const c of claims) for (const t of [c.claim, c.summary, c.bottomLine ?? "", ...c.whyThisGrade]) expect(PRESCRIBING.test(t), t).toBe(false);
  });
  it("gives every claim a bottom line, shown first on the page", () => {
    for (const c of files.flatMap((f) => f.json.claims)) expect(c.bottomLine, c.id).toBeTruthy();
  });
  it("rejects claims without sources", () => {
    expect(validateComparisonTopic({ topic: "safety", title: "T", intro: "I", claims: [{ id: "x", claim: "c", verdict: "supported", grade: "high", favours: "neither", summary: "s", whyThisGrade: ["r"], studies: [] }] })).toContain("claim 1: needs at least one study");
  });
});
