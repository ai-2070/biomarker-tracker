import { describe, expect, it } from "vitest";
import { searchKnowledgeNames } from "../../src/core/knowledgeNames";

const names = [{ name: "Red clover" }, { name: "Lion's mane" }, { name: "L-theanine" }, { name: "Broccoli" }];

describe("name-only knowledge search", () => {
  it("requires every query word and matches word prefixes rather than internal fragments", () => {
    expect(searchKnowledgeNames(names, "red clo")).toEqual([names[0]]);
    expect(searchKnowledgeNames(names, "red mane")).toEqual([]);
    expect(searchKnowledgeNames(names, "ccoli")).toEqual([]);
  });
  it("ignores case, accents, apostrophe styles and hyphens", () => {
    expect(searchKnowledgeNames(names, "LÍON’S MÁNE")).toEqual([names[1]]);
    expect(searchKnowledgeNames(names, "l thea")).toEqual([names[2]]);
  });
});
