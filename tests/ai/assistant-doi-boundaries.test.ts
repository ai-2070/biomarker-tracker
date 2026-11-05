import { describe, expect, it } from "vitest";
import { checkCitations, normalizeId } from "@bt/ai/citations";

describe("assistant DOI prose boundaries", () => {
  it("checks a retrieved DOI surrounded by prose parentheses and preserves the closing punctuation", () => {
    const id = "DOI:10.1038/s43016-019-0005-1";
    const result = checkCitations(`See (${id}).`, new Set([id]));
    expect(result.verified).toEqual([id]);
    expect(result.unverified).toEqual([]);
    expect(result.segments).toEqual([
      { type: "text", text: "See (" },
      { type: "cite", id, valid: true },
      { type: "text", text: ")." },
    ]);
  });

  it("keeps legitimate balanced DOI parentheses while removing only surrounding punctuation", () => {
    const balanced = "DOI:10.1234/study(2020)";
    expect(normalizeId("DOI", "10.1234/STUDY(2020)).")).toBe(balanced);
    const result = checkCitations(`(${balanced}). [DOI:10.1234/unknown(2020)]`, new Set([balanced]));
    expect(result.verified).toEqual([balanced]);
    expect(result.unverified).toEqual(["DOI:10.1234/unknown(2020)"]);
    expect(result.segments).toContainEqual({ type: "text", text: "). " });
    expect(normalizeId("DOI", balanced.slice(4))).toBe(balanced);
  });
});
