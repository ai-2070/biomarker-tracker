import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanText,
  europePmcQuery,
  europePmcUrl,
  kindFromPubTypes,
  markerTerms,
  parseEuropePmc,
  parsePubmedSearch,
  parsePubmedSummary,
  pubmedTerm,
  sanitizeTopic,
  paperById,
  searchPapers,
  studyQuery,
  type FetchFn,
} from "@bt/shared/research/papers";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "research", name), "utf8"));

describe("query building", () => {
  it("uses the marker name without brackets and skips very short abbreviations", () => {
    expect(markerTerms("Ferritin")).toEqual(["Ferritin"]);
    expect(markerTerms("Vitamin D (25-OH)")).toEqual(["Vitamin D"]);
    expect(markerTerms("Haemoglobin A1c", "HbA1c")).toEqual(["Haemoglobin A1c", "HbA1c"]);
    expect(markerTerms("Potassium", "K")).toEqual(["Potassium"]);
  });

  it("keeps only plain words from the topic, so it can't change the query", () => {
    expect(sanitizeTopic('iron "supplement") OR PUB_TYPE:"x"')).toEqual(["iron", "supplement", "PUB", "TYPE"]);
    expect(sanitizeTopic("  vitamin-C  and  absorption ")).toEqual(["vitamin-C", "absorption"]);
    expect(sanitizeTopic("a b c d e f g h i j k")).toEqual([]);
    expect(sanitizeTopic("one two three four five six seven eight nine ten").length).toBe(8);
  });

  it("builds a Europe PMC query for reviews with a topic", () => {
    expect(europePmcQuery(["Ferritin"], "reviews", "pregnancy")).toBe(
      '(TITLE_ABS:"Ferritin") AND (TITLE_ABS:"pregnancy") AND (PUB_TYPE:"review" OR PUB_TYPE:"systematic review" OR PUB_TYPE:"meta-analysis" OR PUB_TYPE:"practice guideline") AND SRC:MED',
    );
    expect(europePmcQuery(["LDL cholesterol", "LDL-C"], "trials")).toBe(
      '(TITLE_ABS:"LDL cholesterol" OR TITLE_ABS:"LDL-C") AND PUB_TYPE:"randomized controlled trial" AND SRC:MED',
    );
    expect(europePmcUrl("x", 5)).toBe("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=x&format=json&resultType=core&pageSize=5");
  });

  it("builds an equivalent PubMed term", () => {
    expect(pubmedTerm(["Ferritin"], "reviews", "pregnancy")).toBe(
      '("Ferritin"[tiab]) AND (pregnancy[tiab]) AND (review[pt] OR systematic review[pt] OR meta-analysis[pt] OR practice guideline[pt])',
    );
  });
});

describe("cleanText", () => {
  it("strips tags and decodes entities", () => {
    expect(cleanText("Effect of <i>n</i>-3 fatty acids &amp; vitamin D &lt;10&#x27;s&#39;")).toBe("Effect of n-3 fatty acids & vitamin D <10's'");
    expect(cleanText("<h4>Background</h4>Text one.<h4>Methods</h4>Text two.")).toBe("Background\nText one.Methods\nText two.");
    expect(cleanText("<script>alert(1)</script>ok")).toBe("alert(1)ok");
  });
});

describe("kindFromPubTypes", () => {
  it("picks the strongest design label", () => {
    expect(kindFromPubTypes(["Journal Article", "Meta-Analysis", "Systematic Review"])).toBe("meta-analysis");
    expect(kindFromPubTypes(["Practice Guideline", "Journal Article"])).toBe("guideline");
    expect(kindFromPubTypes(["Randomized Controlled Trial"])).toBe("randomised trial");
    expect(kindFromPubTypes(["review-article", "Review"])).toBe("review");
    expect(kindFromPubTypes(["Journal Article"])).toBe("other");
  });
});

describe("parseEuropePmc (real response, trimmed)", () => {
  const { papers, total } = parseEuropePmc(fixture("europepmc-ferritin-reviews.json"));

  it("maps every record", () => {
    expect(total).toBeGreaterThan(100);
    expect(papers.length).toBe(3);
    for (const p of papers) {
      expect(p.id).toMatch(/^PMID:\d+$/);
      expect(p.title.length).toBeGreaterThan(10);
      expect(p.title).not.toMatch(/<[^>]+>/);
      expect(p.kind).toBe("meta-analysis");
      expect(p.abstract?.length).toBeGreaterThan(100);
      expect(p.year).toBe(2026);
    }
  });

  it("links open-access papers to the full text", () => {
    const oa = papers.find((p) => p.openAccess)!;
    expect(oa.pmcid).toMatch(/^PMC\d+$/);
    expect(oa.url).toBe(`https://europepmc.org/article/PMC/${oa.pmcid}`);
    const closed = papers.find((p) => !p.openAccess)!;
    expect(closed.url).toBe(`https://pubmed.ncbi.nlm.nih.gov/${closed.pmid}/`);
  });

  it("skips records without an ID or title and rejects malformed responses", () => {
    expect(parseEuropePmc({ hitCount: 2, resultList: { result: [{ title: "No id" }, { pmid: "1" }, "junk"] } }).papers).toEqual([]);
    expect(() => parseEuropePmc({ nope: true })).toThrow();
  });
});

describe("PubMed parsing (real response, trimmed)", () => {
  it("reads the ID list", () => {
    const s = parsePubmedSearch(fixture("pubmed-esearch.json"));
    expect(s.ids).toEqual(["36728680", "35662478"]);
  });

  it("maps summaries without abstracts", () => {
    const papers = parsePubmedSummary(fixture("pubmed-esummary.json"));
    expect(papers.map((p) => [p.id, p.kind, p.year])).toEqual([
      ["PMID:36728680", "meta-analysis", 2023],
      ["PMID:35662478", "guideline", 2022],
    ]);
    expect(papers.every((p) => p.abstract === undefined)).toBe(true);
  });
});

describe("searchPapers", () => {
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("uses Europe PMC when it works", async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      urls.push(url);
      return respond(fixture("europepmc-ferritin-reviews.json"));
    };
    const r = await searchPapers(["Ferritin"], "reviews", "", fetchFn);
    expect(r.source).toBe("europepmc");
    expect(r.papers.length).toBe(3);
    expect(urls.length).toBe(1);
    expect(urls[0]).toMatch(/^https:\/\/www\.ebi\.ac\.uk\//);
  });

  it("falls back to PubMed when Europe PMC fails", async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      urls.push(url);
      if (url.includes("ebi.ac.uk")) return respond({}, 503);
      if (url.includes("esearch")) return respond(fixture("pubmed-esearch.json"));
      return respond(fixture("pubmed-esummary.json"));
    };
    const r = await searchPapers(["Ferritin"], "reviews", "", fetchFn);
    expect(r.source).toBe("pubmed");
    expect(r.papers.length).toBe(2);
    expect(urls.map((u) => new URL(u).host)).toEqual(["www.ebi.ac.uk", "eutils.ncbi.nlm.nih.gov", "eutils.ncbi.nlm.nih.gov"]);
  });
});

describe("one study by its ID", () => {
  it("builds the Europe PMC query for PMID, PMCID and DOI keys", () => {
    expect(studyQuery("PMID:42765482")).toBe("EXT_ID:42765482 AND SRC:MED");
    expect(studyQuery("pmcid:pmc123456")).toBe("PMCID:PMC123456");
    expect(studyQuery("DOI:10.1093/ajcn/72.3.694")).toBe('DOI:"10.1093/ajcn/72.3.694"');
    expect(studyQuery("ferritin OR 1=1")).toBeUndefined();
    expect(studyQuery('DOI:10.1/x" OR "y')).toBeUndefined();
  });
  it("fetches it from Europe PMC with its abstract", async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(fixture("europepmc-ferritin-reviews.json")), { status: 200 });
    };
    const p = await paperById("PMID:36728680", fetchFn);
    expect(p?.id).toMatch(/^PMID:/);
    expect(new URL(urls[0]!).searchParams.get("query")).toBe("EXT_ID:36728680 AND SRC:MED");
    expect(await paperById("not an id", fetchFn)).toBeUndefined();
    expect(urls).toHaveLength(1);
  });
});
