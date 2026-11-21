import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WholeFoodDef } from "@bt/shared/core/wholeFoods";
import { describe, expect, it } from "vitest";
import { ANCIENT_WRITERS, BEFORE_THE_BLOCK_LIST, BLOCKED_PATTERN } from "../../tools/wholefoods/ancientSources";

const DIR = join(import.meta.dirname, "..", "..", "knowledge", "wholefoods");
const foods = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as WholeFoodDef);

describe("whole foods: Then and now sources", () => {
  it("keeps the writer list free of blocked cultures", () => {
    for (const w of ANCIENT_WRITERS) expect(`${w.name} ${w.works}`).not.toMatch(BLOCKED_PATTERN);
  });

  it.each(foods.filter((f) => !BEFORE_THE_BLOCK_LIST.includes(f.id)).map((f) => [f.id, f] as const))("%s has no blocked cultures in Then and now", (_id, f) => {
    const text = [...(f.history ?? []).flatMap((h) => [h.who, h.use, h.note]), ...(f.lore ?? []).flatMap((l) => [l.who, l.belief, l.note ?? ""])];
    for (const t of text) expect(t).not.toMatch(BLOCKED_PATTERN);
  });
});
