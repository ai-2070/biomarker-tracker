/**
 * Research search: Europe PMC first (abstracts, open-access flags), PubMed
 * E-utilities as a backup (titles only). Only search words are sent: the
 * marker name and an optional topic the user typed. Never health data.
 */

export type PaperKind =
  | "guideline"
  | "meta-analysis"
  | "systematic review"
  | "randomised trial"
  | "review"
  | "observational"
  | "other";

export interface Paper {
  /** Citation key the AI must use, e.g. "PMID:12345678". */
  id: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title: string;
  year?: number;
  journal?: string;
  authors?: string;
  kind: PaperKind;
  abstract?: string;
  openAccess: boolean;
  url: string;
}

export type SearchFilter = "reviews" | "trials" | "all";

export interface SearchResult {
  papers: Paper[];
  total: number;
  source: "europepmc" | "pubmed";
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const EUROPE_PMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
export const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// Text helpers

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Remove HTML tags and decode common entities. Results are shown as text, never as HTML. */
export function cleanText(s: string): string {
  return s
    .replace(/<\/(p|h\d|li|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Strip a free-text topic down to plain words, so it can't change the
 * structure of the search query. At most 8 words.
 */
export function sanitizeTopic(topic: string): string[] {
  return topic
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length > 1 && !/^(and|or|not)$/i.test(w))
    .slice(0, 8);
}

/** Search terms for a marker: its name without brackets, plus a usable abbreviation. */
export function markerTerms(name: string, abbreviation?: string): string[] {
  const terms = [name.replace(/\s*\(.*?\)\s*/g, " ").trim()];
  // Very short abbreviations (K, Na, Hb, TG) match too many unrelated papers.
  if (abbreviation && abbreviation.length >= 3 && abbreviation.toLowerCase() !== terms[0]!.toLowerCase()) terms.push(abbreviation);
  return terms.filter(Boolean);
}

export function kindFromPubTypes(types: readonly string[]): PaperKind {
  const t = types.map((x) => x.toLowerCase());
  const has = (s: string) => t.some((x) => x.includes(s));
  if (has("guideline")) return "guideline";
  if (has("meta-analysis")) return "meta-analysis";
  if (has("systematic review")) return "systematic review";
  if (has("randomized controlled trial") || has("randomised controlled trial")) return "randomised trial";
  if (has("review")) return "review";
  if (has("observational")) return "observational";
  return "other";
}

const quote = (s: string) => `"${s.replace(/"/g, "")}"`;

// Europe PMC

export function europePmcQuery(terms: readonly string[], filter: SearchFilter, topic = ""): string {
  const parts = [`(${terms.map((t) => `TITLE_ABS:${quote(t)}`).join(" OR ")})`];
  const words = sanitizeTopic(topic);
  if (words.length) parts.push(`(${words.map((w) => `TITLE_ABS:${quote(w)}`).join(" AND ")})`);
  if (filter === "reviews") {
    parts.push('(PUB_TYPE:"review" OR PUB_TYPE:"systematic review" OR PUB_TYPE:"meta-analysis" OR PUB_TYPE:"practice guideline")');
  } else if (filter === "trials") {
    parts.push('PUB_TYPE:"randomized controlled trial"');
  }
  parts.push("SRC:MED");
  return parts.join(" AND ");
}

export function europePmcUrl(query: string, pageSize = 10): string {
  const p = new URLSearchParams({ query, format: "json", resultType: "core", pageSize: String(pageSize) });
  return `${EUROPE_PMC}?${p}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function paperUrl(pmid?: string, pmcid?: string, doi?: string): string {
  if (pmcid) return `https://europepmc.org/article/PMC/${pmcid}`;
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
  return `https://doi.org/${doi}`;
}

/** Turn a Europe PMC response into papers. Skips records without a usable ID or title. */
export function parseEuropePmc(json: unknown): { papers: Paper[]; total: number } {
  if (!isObj(json) || !isObj(json.resultList) || !Array.isArray(json.resultList.result)) {
    throw new Error("Unexpected response from Europe PMC");
  }
  const papers: Paper[] = [];
  for (const r of json.resultList.result) {
    if (!isObj(r)) continue;
    const pmid = str(r.pmid);
    const pmcid = str(r.pmcid);
    const doi = str(r.doi);
    const title = str(r.title);
    if (!title || (!pmid && !pmcid)) continue;
    const pubTypes = isObj(r.pubTypeList) && Array.isArray(r.pubTypeList.pubType) ? r.pubTypeList.pubType.filter((x): x is string => typeof x === "string") : [];
    const journal = isObj(r.journalInfo) && isObj(r.journalInfo.journal) ? str(r.journalInfo.journal.medlineAbbreviation) ?? str(r.journalInfo.journal.title) : undefined;
    const year = Number(r.pubYear);
    const abstract = str(r.abstractText);
    const paper: Paper = {
      id: pmid ? `PMID:${pmid}` : `PMCID:${pmcid}`,
      title: cleanText(title),
      kind: kindFromPubTypes(pubTypes),
      openAccess: r.isOpenAccess === "Y",
      url: paperUrl(pmid, pmcid, doi),
    };
    if (pmid) paper.pmid = pmid;
    if (pmcid) paper.pmcid = pmcid;
    if (doi) paper.doi = doi;
    if (Number.isInteger(year) && year > 1800) paper.year = year;
    if (journal) paper.journal = journal;
    const authors = str(r.authorString);
    if (authors) paper.authors = authors;
    if (abstract) paper.abstract = cleanText(abstract);
    papers.push(paper);
  }
  const total = typeof json.hitCount === "number" ? json.hitCount : papers.length;
  return { papers, total };
}

// PubMed (backup)

export function pubmedTerm(terms: readonly string[], filter: SearchFilter, topic = ""): string {
  const parts = [`(${terms.map((t) => `${quote(t)}[tiab]`).join(" OR ")})`];
  const words = sanitizeTopic(topic);
  if (words.length) parts.push(`(${words.map((w) => `${w}[tiab]`).join(" AND ")})`);
  if (filter === "reviews") parts.push("(review[pt] OR systematic review[pt] OR meta-analysis[pt] OR practice guideline[pt])");
  else if (filter === "trials") parts.push("randomized controlled trial[pt]");
  return parts.join(" AND ");
}

export function parsePubmedSearch(json: unknown): { ids: string[]; total: number } {
  if (!isObj(json) || !isObj(json.esearchresult) || !Array.isArray(json.esearchresult.idlist)) {
    throw new Error("Unexpected response from PubMed");
  }
  const ids = json.esearchresult.idlist.filter((x): x is string => typeof x === "string" && /^\d+$/.test(x));
  return { ids, total: Number(json.esearchresult.count) || ids.length };
}

export function parsePubmedSummary(json: unknown): Paper[] {
  if (!isObj(json) || !isObj(json.result) || !Array.isArray(json.result.uids)) throw new Error("Unexpected response from PubMed");
  const result = json.result;
  const papers: Paper[] = [];
  for (const uid of result.uids as unknown[]) {
    if (typeof uid !== "string") continue;
    const r = result[uid];
    if (!isObj(r)) continue;
    const title = str(r.title);
    if (!title) continue;
    const ids = Array.isArray(r.articleids) ? r.articleids.filter(isObj) : [];
    const idOf = (type: string) => str(ids.find((a) => a.idtype === type)?.value);
    const pmcid = idOf("pmc");
    const doi = idOf("doi");
    const year = Number(String(r.pubdate ?? "").slice(0, 4));
    const pubTypes = Array.isArray(r.pubtype) ? r.pubtype.filter((x): x is string => typeof x === "string") : [];
    const authors = Array.isArray(r.authors) ? r.authors.filter(isObj).map((a) => str(a.name)).filter(Boolean) : [];
    const paper: Paper = {
      id: `PMID:${uid}`,
      pmid: uid,
      title: cleanText(title),
      kind: kindFromPubTypes(pubTypes),
      openAccess: !!pmcid,
      url: paperUrl(uid, pmcid, doi),
    };
    if (pmcid) paper.pmcid = pmcid;
    if (doi) paper.doi = doi;
    if (Number.isInteger(year) && year > 1800) paper.year = year;
    const journal = str(r.source) ?? str(r.fulljournalname);
    if (journal) paper.journal = journal;
    if (authors.length) paper.authors = authors.join(", ") + (authors.length >= 3 ? " et al." : "");
    papers.push(paper);
  }
  return papers;
}

// Client

async function getJson(fetchFn: FetchFn, url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchFn(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Search Europe PMC; if that fails, fall back to PubMed. */
export async function searchPapers(
  terms: readonly string[],
  filter: SearchFilter,
  topic: string,
  fetchFn: FetchFn,
  signal?: AbortSignal,
  pageSize = 10,
): Promise<SearchResult> {
  try {
    const json = await getJson(fetchFn, europePmcUrl(europePmcQuery(terms, filter, topic), pageSize), signal);
    return { ...parseEuropePmc(json), source: "europepmc" };
  } catch (e) {
    if (signal?.aborted) throw e;
    const term = encodeURIComponent(pubmedTerm(terms, filter, topic));
    const search = parsePubmedSearch(await getJson(fetchFn, `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${pageSize}&term=${term}`, signal));
    if (search.ids.length === 0) return { papers: [], total: 0, source: "pubmed" };
    const summary = await getJson(fetchFn, `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${search.ids.join(",")}`, signal);
    return { papers: parsePubmedSummary(summary), total: search.total, source: "pubmed" };
  }
}
