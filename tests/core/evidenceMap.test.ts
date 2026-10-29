import { describe, expect, it } from "vitest";
import { chooseReviews, classify, plainText, trialsPooled, compareWithPage, coveredArea, designOf, isRetracted, isTrialReview, largeTrialsSince, perYear, populationOf, sampleSize, type EvidenceRecord } from "../../src/core/evidenceMap";

const OUT = [{ id: "fractures", title: /\bfractur\w*/i }];
const rec = (o: Partial<EvidenceRecord>): EvidenceRecord => ({ title: "", abstract: "", pubTypes: [], mesh: ["Humans"], citedBy: 0, ...o });

describe("evidence maps", () => {
  it("reads the study design, the most informative type winning", () => {
    expect(designOf({ pubTypes: ["Journal Article", "Systematic Review", "Meta-Analysis"] })).toBe("meta-analysis");
    expect(designOf({ pubTypes: ["Practice Guideline", "Review"] })).toBe("guideline");
    expect(designOf({ pubTypes: ["Randomized Controlled Trial"] })).toBe("rct");
    expect(designOf({ pubTypes: ["Review"] })).toBe("other");
  });

  it("tells people from animals, and finds retractions", () => {
    expect(populationOf({ mesh: ["Humans", "Animals"], title: "" })).toBe("human");
    expect(populationOf({ mesh: ["Animals", "Rats"], title: "" })).toBe("animal");
    expect(populationOf({ mesh: [], title: "Vitamin D in broiler chickens" })).toBe("animal");
    expect(populationOf({ mesh: [], title: "Vitamin D in older adults" })).toBe("unclear");
    expect(isRetracted({ pubTypes: ["Retracted Publication"], title: "x" })).toBe(true);
    expect(isRetracted({ pubTypes: [], title: "RETRACTED: Vitamin D and..." })).toBe(true);
    expect(isRetracted({ pubTypes: ["Journal Article"], title: "Vitamin D" })).toBe(false);
  });

  it("knows a review of supplement trials from a review of blood levels", () => {
    expect(isTrialReview({ title: "Vitamin D supplementation and fractures: a meta-analysis of randomized controlled trials", abstract: "" })).toBe(true);
    expect(isTrialReview({ title: "Serum 25-hydroxyvitamin D and fracture risk: a meta-analysis of cohort studies", abstract: "Prospective cohorts." })).toBe(false);
  });

  it("reads trial sizes from abstracts", () => {
    expect(sampleSize("We randomly assigned 25,871 participants to vitamin D3 or placebo.")).toBe(25871);
    expect(sampleSize("A total of 21 315 older adults were enrolled (n = 21315).")).toBe(21315);
    expect(sampleSize("Of 2157 women, 1200 were followed.")).toBe(2157);
    expect(sampleSize("Serum levels rose by 25 nmol/L.")).toBeUndefined();
  });

  it("chooses the newest meta-analyses of trials, then the most cited, by rule", () => {
    const meta = (year: number, citedBy: number, pmid: string): EvidenceRecord =>
      rec({ pmid, year, citedBy, title: "Vitamin D supplementation and fractures: a meta-analysis of randomized trials", pubTypes: ["Meta-Analysis"] });
    const records = [meta(2014, 900, "old"), meta(2021, 50, "a"), meta(2023, 20, "b"), meta(2024, 5, "c"), meta(2019, 10, "d"),
      rec({ pmid: "obs", year: 2025, title: "Serum vitamin D and fractures: meta-analysis of cohort studies", pubTypes: ["Meta-Analysis"] }),
      rec({ pmid: "ret", year: 2025, title: "Vitamin D supplementation and fractures: meta-analysis of randomized trials", pubTypes: ["Meta-Analysis", "Retracted Publication"] })].map((r) => classify(r, OUT));
    // The oldest one pooled the most trials: it's added as the most comprehensive, not for its citations.
    records[0]!.abstract = "We pooled 41 randomized controlled trials.";
    const chosen = chooseReviews(records, "fractures");
    expect(chosen.map((c) => c.pmid)).toEqual(["c", "b", "a", "old"]);
    expect(chosen[3]!.why).toMatch(/most comprehensive.*41 trials/);
  });

  it("finds large trials as new as the newest review", () => {
    const trial = (pmid: string, year: number, n: number) => classify(rec({ pmid, year, title: "Vitamin D and incident fractures", abstract: `We enrolled ${n} participants.`, pubTypes: ["Randomized Controlled Trial"] }), OUT);
    expect(largeTrialsSince([trial("big", 2022, 25871), trial("small", 2023, 300), trial("early", 2010, 2256)], "fractures", 2021).map((t) => t.pmid)).toEqual(["big"]);
  });

  it("measures how much reviews share trials (corrected covered area, Pieper 2014)", () => {
    // 3 reviews, 4 distinct trials, 8 inclusions: (8 − 4) / (4·3 − 4) = 0.5.
    expect(coveredArea([["t1", "t2", "t3"], ["t1", "t2", "t4"], ["t1", "t2"]])).toEqual({ cca: 0.5, trials: 4, inclusions: 8 });
    expect(coveredArea([["t1"], ["t2"]])!.cca).toBe(0);
    expect(coveredArea([["t1", "t2"]])).toBeUndefined();
  });

  it("counts reviews and trials per year, leaving out animals and retractions", () => {
    const rs = [
      rec({ year: 2020, pubTypes: ["Meta-Analysis"], title: "fractures" }),
      rec({ year: 2020, pubTypes: ["Randomized Controlled Trial"], title: "fractures" }),
      rec({ year: 2020, pubTypes: ["Randomized Controlled Trial"], title: "fractures in rats", mesh: ["Animals"] }),
      rec({ year: 2021, pubTypes: ["Randomized Controlled Trial", "Retracted Publication"], title: "fractures" }),
    ].map((r) => classify(r, OUT));
    expect(perYear(rs, "fractures")).toEqual([{ year: 2020, reviews: 1, trials: 1 }]);
  });

  it("compares the page's own studies with the chosen ones", () => {
    const r = compareWithPage(["a", "x"], [{ pmid: "a", title: "A", citedBy: 1, why: "" }, { pmid: "b", title: "B", citedBy: 1, why: "" }], []);
    expect(r.alsoChosen).toEqual(["a"]);
    expect(r.citedNotChosen).toEqual(["x"]);
    expect(r.chosenNotCited.map((c) => c.pmid)).toEqual(["b"]);
  });

  it("cleans titles, and only counts reviews with the topic in their title when asked", () => {
    expect(plainText("Vitamin D&lt;sub&gt;3&lt;/sub&gt; and falls")).toBe("Vitamin D3 and falls");
    expect(plainText("<i>In vitro</i> &amp; trials")).toBe("In vitro & trials");
    const broad = classify(rec({ pmid: "broad", year: 2025, title: "Interventions for preventing falls in older people: meta-analysis of randomized trials", abstract: "Vitamin D supplementation was one of many.", pubTypes: ["Meta-Analysis"] }), [{ id: "falls", title: /falls/i }]);
    expect(chooseReviews([broad], "falls").map((c) => c.pmid)).toEqual(["broad"]);
    expect(chooseReviews([broad], "falls", 3, /vitamin D/i)).toEqual([]);
  });

  it("reads how many trials a review pooled, and leaves out reviews of other groups of people", () => {
    expect(trialsPooled("We included 46 randomised controlled trials (75 541 participants).")).toBe(46);
    expect(trialsPooled("Data from 11 double-blind placebo-controlled trials and 3 cohorts.")).toBe(11);
    expect(trialsPooled("Serum levels.")).toBeUndefined();
    const sepsis = classify(rec({ pmid: "s", year: 2026, title: "Vitamin D supplementation and mortality in sepsis: meta-analysis of randomized trials", pubTypes: ["Meta-Analysis"] }), [{ id: "mortality", title: /mortality/i }]);
    expect(chooseReviews([sepsis], "mortality", 3, /vitamin D/i, /\bsepsis\b/i)).toEqual([]);
  });
});
