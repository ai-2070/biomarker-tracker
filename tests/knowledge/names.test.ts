import { describe, expect, it } from "vitest";
import names from "../../knowledge/names.json";
import { LIFESTYLE, NUTRIENTS, WHOLE_FOODS } from "../../src/app/knowledge";

const key = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

describe("name-only knowledge catalogue", () => {
  it("does not duplicate another name or an existing guide's name or alias", () => {
    for (const group of [
      { entries: names.supplements, guides: NUTRIENTS },
      { entries: names.foods, guides: WHOLE_FOODS },
      { entries: names.lifestyle, guides: LIFESTYLE },
    ]) {
      const registered = new Set(group.guides.flatMap((guide) => [guide.name, ...guide.otherNames]).map(key));
      const seen = new Set<string>();
      for (const entry of group.entries) {
        const name = key(entry.name);
        expect(seen.has(name), `Repeated catalogue name: ${entry.name}`).toBe(false);
        expect(registered.has(name), `Already has a guide: ${entry.name}`).toBe(false);
        seen.add(name);
      }
    }
  });
});
