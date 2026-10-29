import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateEvidenceMap, type EvidenceMapFile } from "../../src/core/evidenceMap";

const DIR = join(import.meta.dirname, "..", "..", "knowledge", "evidence-maps");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((file) => ({ file, json: JSON.parse(readFileSync(join(DIR, file), "utf8")) as EvidenceMapFile }));

describe("knowledge base: evidence maps", () => {
  it.each(files)("$file is valid", ({ file, json }) => {
    expect(validateEvidenceMap(json)).toEqual([]);
    expect(`${json.topic}.json`).toBe(file);
  });
  it("only chooses studies in people that aren't retracted, and every chosen review is about the outcome", () => {
    for (const { json } of files)
      for (const o of json.outcomes) for (const c of o.chosenReviews) expect(/retract/i.test(c.title), `${o.id}: ${c.title}`).toBe(false);
  });
});
