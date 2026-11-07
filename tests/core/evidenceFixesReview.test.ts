import {
  chooseFrom,
  classify,
  currentDecisions,
  type Decision,
  designOf,
  type EvidenceRecord,
  largeTrialsSince,
  plainText,
  type Question,
  type ScreeningMode,
  sampleSize,
  screeningInput,
  screeningPrompt,
  splitByScreening,
} from "@bt/shared/core/evidenceMap";
import { describe, expect, it, vi } from "vitest";
import { screenOutcome } from "../../tools/evidence/screening";

const question: Question = { population: "Adults", intervention: "Vitamin D", comparison: "Placebo", outcome: "Fractures" };
const review = (patch: Partial<EvidenceRecord> = {}) =>
  classify(
    {
      pmid: "100",
      title: "Vitamin D fractures: systematic review",
      abstract: "A review of randomized supplementation trials.",
      year: 2026,
      pubTypes: ["Systematic Review"],
      mesh: ["Humans"],
      citedBy: 0,
      ...patch,
    },
    [{ id: "fractures", title: /fractures/i }],
  );
const approved = (r = review(), mode: ScreeningMode = "supplement", by = "Claude Code (opus)"): Decision => ({
  pmid: r.pmid!,
  fits: "yes",
  reason: "Matches the question.",
  input: screeningInput(question, r, mode),
  by,
  at: "2026-10-29",
});

describe("evidence review: extraction and classification", () => {
  it("preserves encoded and literal inequalities, facts between them, and encoded formatting", () => {
    const text = plainText("<p>BMI &lt; 30; 1200 adults enrolled; P &gt; 0.05</p> D&amp;lt;sub&amp;gt;3&amp;lt;/sub&amp;gt;");
    expect(text).toBe("BMI < 30; 1200 adults enrolled; P > 0.05 D3");
    expect(sampleSize(text)).toBe(1200);
    expect(plainText("BMI < 30; 1200 adults enrolled; P > 0.05")).toBe("BMI < 30; 1200 adults enrolled; P > 0.05");
  });
  it("prioritises title-declared meta-analysis over a weaker tag, but not over guidelines", () => {
    expect(designOf({ pubTypes: ["Systematic Review"], title: "Systematic review and meta-analysis" })).toBe("meta-analysis");
    expect(designOf({ pubTypes: ["Practice Guideline"], title: "A meta-analysis" })).toBe("guideline");
    const meta = review({ pmid: "meta", title: "Fractures: systematic review and meta-analysis", year: 2024 });
    const systematic = review({ pmid: "systematic", title: "Fractures: systematic review", year: 2026 });
    expect(chooseFrom([systematic, meta], 1).map((r) => r.pmid)).toEqual(["meta"]);
  });
  it("does not promote dose numbers to participant counts or large trials", () => {
    const r = review({
      title: "Vitamin D fractures",
      pubTypes: ["Randomized Controlled Trial"],
      abstract: "In this randomized trial (n = 60), we assessed vitamin D 2000 IU in adults with fractures.",
    });
    expect(r.n).toBe(60);
    expect(largeTrialsSince([r], "fractures", 2020)).toEqual([]);
    expect(sampleSize("Vitamin D 2000 IU in adults with fractures.")).toBeUndefined();
    expect(sampleSize("We enrolled 21 315 older adults receiving 2000 IU daily.")).toBe(21315);
    const large = review({ pmid: "large", title: "Fractures", pubTypes: ["Randomized Controlled Trial"], abstract: "We enrolled 2,000 healthy participants." });
    expect(largeTrialsSince([large], "fractures", 2020).map((r) => r.pmid)).toEqual(["large"]);
  });
  it("prefers actual randomisation to screened pools, arm counts, intervention identifiers and dates", () => {
    const abstract = plainText(
      "<h4>Methods</h4>Twenty-seven participants were randomized to active treatment (n = 13) or placebo (n = 14).<h4>Results</h4>Recruitment identified 1378 potentially eligible individuals.",
    );
    expect(sampleSize(abstract)).toBe(27);
    expect(sampleSize("Patients (n = 154) received MD1003. MD1003 patients were followed.")).toBe(154);
    expect(sampleSize("Of 3722 women screened, 555 were randomly assigned to three arms.")).toBe(555);
    expect(sampleSize("21 258 women were screened, and 862 randomly assigned (n = 430 or n = 432).")).toBe(862);
    expect(sampleSize("5349 individuals commenced the screening process; 1721 were randomly allocated.")).toBe(1721);
    expect(sampleSize("From March 2023 to February 2024 we included 164 subjects.")).toBe(164);
    const small = review({ title: "Vitamin D fractures", pubTypes: ["Randomized Controlled Trial"], abstract });
    expect(largeTrialsSince([small], "fractures", 2020)).toEqual([]);
  });
});

describe("evidence review: current-input decisions and individual provenance", () => {
  it("rejects missing/legacy decisions and invalidates each input independently", () => {
    const r = review();
    const decision = approved(r);
    expect(currentDecisions(question, [r], "supplement", [decision])).toEqual([decision]);
    for (const changed of [
      review({ title: r.title + " updated" }),
      review({ abstract: "New abstract." }),
      { ...r, design: "meta-analysis" as const },
      { ...r, year: 2025 },
    ]) {
      expect(currentDecisions(question, [changed], "supplement", [decision])).toEqual([]);
    }
    expect(currentDecisions({ ...question, outcome: "Death" }, [r], "supplement", [decision])).toEqual([]);
    expect(currentDecisions(question, [r], "any-design", [decision])).toEqual([]);
    expect(currentDecisions(question, [r], "supplement", [{ pmid: "100", fits: "yes", reason: "Legacy." }])).toEqual([]);
    expect(currentDecisions(question, [r], "supplement", [])).toEqual([]);
  });
  it("rescreens an updated abstract and legacy decision while retaining the actual model on unchanged work", async () => {
    const unchanged = review({ pmid: "200" });
    const formerlyMissing = review({ abstract: "" });
    const refreshed = review({ abstract: "Now available: a review of randomized supplementation trials." });
    const stale = { ...approved(formerlyMissing), fits: "no" as const, reason: "No abstract." };
    const retained = approved(unchanged);
    const legacy: Decision = { pmid: "300", fits: "yes", reason: "Legacy approval." };
    const other = review({ pmid: "300" });
    const ask = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("Now available:");
      expect(prompt).not.toContain("PMID 200");
      expect(prompt).toContain("PMID 300");
      return JSON.stringify([
        { pmid: "100", fits: "yes", reason: "Now matches." },
        { pmid: "300", fits: "partly", reason: "Different population." },
      ]);
    });
    const saved: Decision[][] = [];
    const result = await screenOutcome({
      question,
      reviews: [refreshed, unchanged, other],
      mode: "supplement",
      previous: [stale, retained, legacy],
      by: "Claude Code (sonnet)",
      ask,
      onBatch: (d) => saved.push(d),
      today: () => "2026-10-30",
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.find((d) => d.pmid === "200")).toEqual(retained);
    expect(result.find((d) => d.pmid === "100")).toMatchObject({
      fits: "yes",
      by: "Claude Code (sonnet)",
      at: "2026-10-30",
      input: screeningInput(question, refreshed, "supplement"),
    });
    expect(result.find((d) => d.pmid === "300")).toMatchObject({ fits: "partly", by: "Claude Code (sonnet)" });
    expect(saved).toEqual([result]);
  });
  it("keeps short replies partial and retries only missing reviews, never manufacturing approvals", async () => {
    const first = review(),
      missing = review({ pmid: "200" });
    const ask = vi.fn().mockResolvedValueOnce('[{"pmid":"100","fits":"yes","reason":"Matches."}]').mockResolvedValueOnce("malformed reply");
    const onBatch = vi.fn();
    const result = await screenOutcome({
      question,
      reviews: [first, missing],
      mode: "supplement",
      previous: [],
      by: "Fixture model",
      ask,
      onBatch,
      today: () => "2026-10-30",
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1]![0]).not.toContain("PMID 100");
    expect(ask.mock.calls[1]![0]).toContain("PMID 200");
    const split = splitByScreening([first, missing], currentDecisions(question, [first, missing], "supplement", result));
    expect(chooseFrom(split.yes).map((r) => r.pmid)).toEqual(["100"]);
    expect(split.unscreened.map((r) => r.pmid)).toEqual(["200"]);
    expect(onBatch).toHaveBeenCalledWith(result);
  });
  it("keeps model errors distinct from completed empty screening", async () => {
    const onBatch = vi.fn();
    await expect(
      screenOutcome({
        question,
        reviews: [review()],
        mode: "supplement",
        previous: [],
        by: "Fixture model",
        ask: async () => {
          throw new Error("Fixture process failed");
        },
        onBatch,
      }),
    ).rejects.toThrow("Fixture process failed");
    expect(onBatch).not.toHaveBeenCalled();
  });
  it.each(["food", "lifestyle", "wholefood", "any-design"] as const)("keeps %s eligibility and prompt mode separate from trial-only screening", (mode) => {
    const r = review();
    expect(currentDecisions(question, [r], mode, [approved(r, mode)])).toHaveLength(1);
    expect(currentDecisions(question, [r], "supplement", [approved(r, mode)])).toEqual([]);
    expect(screeningPrompt(question, [r], mode)).toContain("studies of any design");
    if (mode === "any-design") {
      expect(screeningPrompt(question, [r], mode)).toContain("laboratory or observational");
      expect(screeningPrompt(question, [r], mode)).toContain("Intervention: Vitamin D");
    }
  });
});
