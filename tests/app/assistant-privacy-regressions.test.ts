import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CitedAnswer } from "../../src/app/components/CitedAnswer";
import { questionWithFiles, redactName } from "../../src/app/brain/logic";

describe("assistant document privacy and transport boundaries", () => {
  it.each([
    ["Li Wu", "Patient: Li Wu. Li Wuther remains unrelated.", "Patient: [name]. Li Wuther remains unrelated."],
    ["吴敏", "Patient: 吴敏. Follow-up note.", "Patient: [name]. Follow-up note."],
    ["José Li", "Patient: Jose\u0301 Li. Follow-up note.", "Patient: [name]. Follow-up note."],
    ["Anne (Li)", "Patient: Anne (Li). Follow-up note.", "Patient: [name]. Follow-up note."],
  ])("redacts the normalized full name %s independently of short individual parts", (name, document, expected) => {
    const redacted = redactName(document, name);
    expect(redacted).toBe(expected);
  });

  it("redacts names in model-facing filenames and text while preserving unrelated words", () => {
    const name = "Anna Kovacs";
    const local = { name: "Anna Kovacs referral.txt", text: "Patient Anna Kovacs. Annabel is the clinician." };
    const sent = questionWithFiles("Please explain", [{ name: redactName(local.name, name), text: redactName(local.text, name) }]);
    expect(sent).not.toContain("Anna Kovacs");
    expect(sent).toContain("[name] referral.txt");
    expect(sent).toContain("Annabel");
    expect(local.name).toBe("Anna Kovacs referral.txt");
  });

  it("budgets the entire prepared message and discloses document shortening", () => {
    const sent = questionWithFiles("Q".repeat(8000), [{ name: "note.txt", text: "X".repeat(13_990) + "END_SENTINEL" }]);
    expect(sent.length).toBeLessThanOrEqual(20_000);
    expect(sent).toContain("the rest of this file was left out");
    expect(sent).not.toContain("END_SENTINEL");
    const whole = questionWithFiles("Q".repeat(8000), [{ name: "note.txt", text: "X".repeat(100) + "END_SENTINEL" }]);
    expect(whole).toContain("END_SENTINEL");
    expect(whole).not.toContain("left out");
    expect(() => questionWithFiles("Q".repeat(20_001), [])).toThrow(/20,000/);
    expect(() => questionWithFiles("Q".repeat(19_950), [{ name: "note.txt", text: "TAIL" }])).toThrow(/too long/);
  });

  it("renders verified DOI links and flags fabricated DOI references", () => {
    const html = renderToStaticMarkup(createElement(CitedAnswer, { text: "[DOI:10.1234/real] [DOI:10.1234/fake]", allowed: new Set(["DOI:10.1234/real"]) }));
    expect(html).toContain('href="https://doi.org/10.1234/real"');
    expect(html).not.toContain('href="https://doi.org/10.1234/fake"');
    expect(html).toContain("Not one of the studies the assistant retrieved");
  });
});
