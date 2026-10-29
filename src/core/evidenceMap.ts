/**
 * Evidence maps: how the studies behind a finding were found and chosen, by written rules rather than
 * by hand. A developer tool downloads every matching record from Europe PMC (tools/evidence); the rules
 * here classify each one (study design, people or animals, retracted or not, which outcome), choose the
 * reviews and trials for each outcome, measure how much the chosen reviews overlap, and count what's
 * left at every step. Pure and tested; the app only reads the distilled result.
 */

export interface EvidenceRecord {
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title: string;
  abstract: string;
  year?: number;
  journal?: string;
  firstAuthor?: string;
  pubTypes: string[];
  mesh: string[];
  citedBy: number;
}

export type Design = "guideline" | "meta-analysis" | "systematic review" | "rct" | "other";

/** Study design from the publication types (the most informative type wins). */
export function designOf(r: Pick<EvidenceRecord, "pubTypes">): Design {
  const t = r.pubTypes.map((x) => x.toLowerCase());
  const has = (s: string) => t.some((x) => x.includes(s));
  if (has("guideline")) return "guideline";
  if (has("meta-analysis")) return "meta-analysis";
  if (has("systematic review")) return "systematic review";
  if (has("randomized controlled trial") || has("randomised controlled trial")) return "rct";
  return "other";
}

const ANIMAL_TITLE = /\b(rats?|mice|mouse|murine|rodents?|pigs?|piglets?|swine|dogs?|canine|cats?|feline|cattle|cows?|calves|dairy|sheep|lambs?|goats?|horses?|poultry|chickens?|broilers?|hens?|layers|fish|zebrafish|in vitro|cell lines?)\b/i;

/** People, animals, or unclear: from the MeSH tags when the paper has them, otherwise from the title. */
export function populationOf(r: Pick<EvidenceRecord, "mesh" | "title">): "human" | "animal" | "unclear" {
  if (r.mesh.includes("Humans")) return "human";
  if (r.mesh.includes("Animals")) return "animal";
  if (ANIMAL_TITLE.test(r.title)) return "animal";
  return "unclear";
}

/** Retracted, or a notice of retraction. */
export function isRetracted(r: Pick<EvidenceRecord, "pubTypes" | "title">): boolean {
  return r.pubTypes.some((t) => /retracted publication|retraction of publication/i.test(t)) || /^\s*(retracted|retraction)\b/i.test(r.title);
}

/** A review of trials of giving the nutrient (not of blood levels in observational studies). */
export function isTrialReview(r: Pick<EvidenceRecord, "title" | "abstract">): boolean {
  const text = `${r.title} ${r.abstract}`;
  return /\brandomi[sz]ed\b|\bRCTs?\b|\bcontrolled trials?\b/i.test(text) && /\bsupplement\w*|\bintervention\w*|\btreatment\b|\badministration\b|\bgiven\b/i.test(text);
}

const PEOPLE = "participants|patients|adults|women|men|subjects|individuals|people|persons|children|infants|volunteers|residents|participants";

/**
 * The number of people in a trial, read from its abstract ("25,871 participants", "n = 2157"): the
 * largest such number, ignoring thousands-separators and implausible values. Undefined when none is
 * written; a reading from text, shown as such.
 */
export function sampleSize(abstract: string): number | undefined {
  const nums: number[] = [];
  const grab = (s: string) => {
    const n = Number(s.replace(/[,\s  ]/g, ""));
    if (Number.isFinite(n) && n >= 10 && n <= 5_000_000) nums.push(n);
  };
  for (const m of abstract.matchAll(new RegExp(`(\\d{1,3}(?:[,\\s\\u202f\\u00a0]\\d{3})+|\\d+)\\s+(?:[a-z-]+\\s+){0,3}(?:${PEOPLE})\\b`, "gi"))) grab(m[1]!);
  for (const m of abstract.matchAll(/\b[nN]\s*=\s*(\d{1,3}(?:[,\s  ]\d{3})+|\d+)/g)) grab(m[1]!);
  return nums.length ? Math.max(...nums) : undefined;
}

export interface Classified extends EvidenceRecord {
  design: Design;
  population: "human" | "animal" | "unclear";
  retracted: boolean;
  outcomes: string[];
  n?: number;
}

/** Titles and abstracts as plain text: HTML tags removed and entities decoded ("D&lt;sub&gt;3" → "D3"). */
export function plainText(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const decode = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (named[e.toLowerCase()] ?? m)));
  return decode(decode(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function classify(raw: EvidenceRecord, outcomes: readonly { id: string; title: RegExp }[]): Classified {
  const r = { ...raw, title: plainText(raw.title), abstract: plainText(raw.abstract) };
  const n = sampleSize(r.abstract);
  return {
    ...r,
    design: designOf(r),
    population: populationOf(r),
    retracted: isRetracted(r),
    outcomes: outcomes.filter((o) => o.title.test(r.title)).map((o) => o.id),
    ...(n !== undefined ? { n } : {}),
  };
}

export interface Chosen {
  pmid?: string;
  doi?: string;
  title: string;
  year?: number;
  firstAuthor?: string;
  journal?: string;
  citedBy: number;
  n?: number;
  /** Why this one: "Newest meta-analysis of trials on this outcome (2024)". */
  why: string;
}

const pick = (r: Classified, why: string): Chosen => ({
  ...(r.pmid ? { pmid: r.pmid } : {}),
  ...(r.doi ? { doi: r.doi } : {}),
  title: r.title.replace(/\.$/, ""),
  ...(r.year ? { year: r.year } : {}),
  ...(r.firstAuthor ? { firstAuthor: r.firstAuthor } : {}),
  ...(r.journal ? { journal: r.journal } : {}),
  citedBy: r.citedBy,
  ...(r.n !== undefined ? { n: r.n } : {}),
  why,
});

/**
 * Reviews eligible for an outcome: meta-analyses or systematic reviews of trials, in people, not
 * retracted, with the topic in the title (so a review of every falls-prevention method, which mentions
 * vitamin D only in its abstract, isn't counted as a vitamin D review).
 */
export function eligibleReviews(records: readonly Classified[], outcome: string, topicInTitle?: RegExp, excludeTitle?: RegExp): Classified[] {
  return records.filter(
    (r) =>
      (r.design === "meta-analysis" || r.design === "systematic review") &&
      r.population !== "animal" &&
      !r.retracted &&
      r.outcomes.includes(outcome) &&
      isTrialReview(r) &&
      (!topicInTitle || topicInTitle.test(r.title)) &&
      // A review of a different group of people (sepsis, surgery, pregnancy...) answers a different question.
      (!excludeTitle || !excludeTitle.test(r.title)),
  );
}

/** How many trials a review pooled, read from its abstract ("41 randomised controlled trials"): the largest such number. */
export function trialsPooled(abstract: string): number | undefined {
  const nums = [...abstract.matchAll(/\b(\d{1,4})\s+(?:(?:eligible|independent|individual|double-blind(?:ed)?|placebo-controlled|randomi[sz]ed|controlled|clinical)\s+){0,4}(?:trials|RCTs)\b/gi)].map((m) => Number(m[1]));
  const ok = nums.filter((n) => n >= 2 && n <= 2000);
  return ok.length ? Math.max(...ok) : undefined;
}

/**
 * The reviews chosen for an outcome, by rule: the three newest meta-analyses of trials (systematic
 * reviews only when there are fewer than three), then the most comprehensive eligible review (the most
 * trials pooled, read from its abstract) if it isn't already among them. Ties go to the more-cited one.
 * Citations are shown but don't choose: older reviews collect more of them whatever their quality.
 */
export function chooseReviews(records: readonly Classified[], outcome: string, newest = 3, topicInTitle?: RegExp, excludeTitle?: RegExp): Chosen[] {
  return chooseFrom(eligibleReviews(records, outcome, topicInTitle, excludeTitle), newest);
}

/** The same choice from a given pool (for example only the reviews screened as answering the question). */
export function chooseFrom(pool: readonly Classified[], newest = 3): Chosen[] {
  const byNew = (a: Classified, b: Classified) => (b.year ?? 0) - (a.year ?? 0) || b.citedBy - a.citedBy;
  const metas = pool.filter((r) => r.design === "meta-analysis").sort(byNew);
  const others = pool.filter((r) => r.design !== "meta-analysis").sort(byNew);
  const first = [...metas, ...others].slice(0, newest);
  const out = first.map((r) => pick(r, `${r.design === "meta-analysis" ? "One of the newest meta-analyses" : "One of the newest systematic reviews"} of trials on this outcome (${r.year ?? "year unknown"})`));
  const pooled = (r: Classified) => trialsPooled(r.abstract) ?? 0;
  const widest = [...pool].sort((a, b) => pooled(b) - pooled(a) || (b.year ?? 0) - (a.year ?? 0) || b.citedBy - a.citedBy)[0];
  if (widest && pooled(widest) > 0 && !first.includes(widest)) out.push(pick(widest, `The most comprehensive review of trials on this outcome (${pooled(widest)} trials, ${widest.year ?? "year unknown"})`));
  return out;
}

/** Large trials (at least `minN` people, read from the abstract) on an outcome from a given year on: evidence newer reviews may not include. */
export function largeTrialsSince(records: readonly Classified[], outcome: string, sinceYear: number, minN = 1000): Chosen[] {
  return records
    .filter((r) => r.design === "rct" && r.population !== "animal" && !r.retracted && r.outcomes.includes(outcome) && (r.n ?? 0) >= minN && (r.year ?? 0) >= sinceYear)
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
    .map((r) => pick(r, `A large trial (about ${(r.n ?? 0).toLocaleString("en-GB")} people) from ${r.year}, as new as the newest review or newer`));
}

/**
 * How much the chosen reviews draw on the same trials: the corrected covered area (Pieper 2014, PMID
 * 24581293): (N − r) / (r·c − r), N = trial inclusions across reviews, r = distinct trials, c = reviews.
 * 0 means no trial is shared; 1 means every review includes every trial.
 */
export function coveredArea(included: readonly (readonly string[])[]): { cca: number; trials: number; inclusions: number } | undefined {
  const c = included.length;
  const r = new Set(included.flat()).size;
  const N = included.reduce((s, x) => s + new Set(x).size, 0);
  if (c < 2 || r === 0) return undefined;
  return { cca: (N - r) / (r * c - r), trials: r, inclusions: N };
}

/** Records per year, by design: reviews and trials (people only, not retracted), for a timeline. */
export function perYear(records: readonly Classified[], outcome?: string): { year: number; reviews: number; trials: number }[] {
  const m = new Map<number, { reviews: number; trials: number }>();
  for (const r of records) {
    if (!r.year || r.population === "animal" || r.retracted) continue;
    if (outcome && !r.outcomes.includes(outcome)) continue;
    const kind = r.design === "rct" ? "trials" : r.design === "meta-analysis" || r.design === "systematic review" ? "reviews" : undefined;
    if (!kind) continue;
    const row = m.get(r.year) ?? { reviews: 0, trials: 0 };
    row[kind]++;
    m.set(r.year, row);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ...v }));
}

/** Where the page's own studies stand against the chosen ones. */
export function compareWithPage(cited: readonly string[], chosen: readonly Chosen[], eligible: readonly Classified[]) {
  const chosenIds = new Set(chosen.map((c) => c.pmid).filter(Boolean));
  const eligibleIds = new Set(eligible.map((c) => c.pmid).filter(Boolean));
  return {
    alsoChosen: cited.filter((p) => chosenIds.has(p)),
    citedNotChosen: cited.filter((p) => !chosenIds.has(p)),
    /** Cited reviews the rules didn't find as eligible (other designs, or outside the outcome words): worth a look. */
    citedNotEligible: cited.filter((p) => !eligibleIds.has(p) && !chosenIds.has(p)),
    chosenNotCited: chosen.filter((c) => c.pmid && !cited.includes(c.pmid)),
  };
}

// ---- The distilled map the app reads (knowledge/evidence-maps/<topic>.json) -------------------------

export interface EvidenceMapOutcome {
  id: string;
  label: string;
  finding?: string;
  counts: { reviews: number; trialReviews: number; trials: number; largeTrials: number };
  chosenReviews: Chosen[];
  newerLargeTrials: Chosen[];
  overlap?: {
    cca: number;
    trials: number;
    inclusions: number;
    reviews: { pmid: string; trials: number }[];
    reviewsWithoutReferences: string[];
    shared: { pmid: string; title: string; year?: number; n?: number; inReviews: string[] }[];
  };
  timeline: { year: number; reviews: number; trials: number }[];
  largeTrials: { pmid?: string; title: string; year: number; n: number }[];
  page: { alsoChosen: string[]; citedNotChosen: string[]; citedNotEligible: string[]; chosenNotCited: Chosen[] };
  /** When the eligible reviews were screened against the finding's question. */
  screening?: {
    question: Question;
    by: string;
    at: string;
    counts: { yes: number; partly: number; no: number; unscreened: number };
    /** Reviews that don't fit (or only partly), with the reason, newest first. */
    left: { pmid: string; title: string; year?: number; fits: "partly" | "no"; reason: string }[];
  };
}

export interface EvidenceMapFile {
  topic: string;
  nutrientId: string;
  builtAt: string;
  fetchedAt: string;
  source: string;
  queries: Record<string, string>;
  rules: string[];
  counts: { all: number; retrieved: number; animal: number; retracted: number; reviews: number; trials: number; guidelines: number };
  guidelines: Chosen[];
  outcomes: EvidenceMapOutcome[];
}

/** Problems with a map file; empty means valid. */
export function validateEvidenceMap(v: unknown): string[] {
  if (typeof v !== "object" || v === null) return ["not an object"];
  const m = v as Partial<EvidenceMapFile>;
  const e: string[] = [];
  if (typeof m.topic !== "string" || typeof m.nutrientId !== "string") e.push("topic and nutrient are missing");
  if (typeof m.builtAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.builtAt)) e.push("builtAt must be a date");
  if (!Array.isArray(m.rules) || m.rules.length === 0) e.push("the rules must be written down");
  if (!m.counts || typeof m.counts.all !== "number") e.push("counts are missing");
  if (!Array.isArray(m.outcomes) || m.outcomes.length === 0) e.push("no outcomes");
  else
    for (const o of m.outcomes) {
      if (!o.id || !o.label) e.push("an outcome has no id or label");
      for (const c of [...(o.chosenReviews ?? []), ...(o.newerLargeTrials ?? [])]) {
        if (!c.title || !c.why) e.push(`${o.id}: a chosen study has no title or reason`);
        if (!c.pmid && !c.doi) e.push(`${o.id}: a chosen study has no PMID or DOI`);
      }
      if (o.overlap && !(o.overlap.cca >= 0 && o.overlap.cca <= 1)) e.push(`${o.id}: overlap must be between 0 and 1`);
      if (o.screening) {
        const sc = o.screening;
        if (!sc.question?.population || !sc.question.intervention || !sc.question.comparison || !sc.question.outcome) e.push(`${o.id}: the screening question is incomplete`);
        if (!sc.by) e.push(`${o.id}: who screened is missing`);
        if (sc.left.length !== sc.counts.partly + sc.counts.no) e.push(`${o.id}: every review left out must be listed`);
        if (sc.left.some((r) => !r.reason)) e.push(`${o.id}: a review left out has no reason`);
        // Only reviews that answer the question can be chosen.
        const left = new Set(sc.left.map((r) => r.pmid));
        if (o.chosenReviews.some((c) => c.pmid && left.has(c.pmid))) e.push(`${o.id}: a chosen review was screened out`);
      }
    }
  return [...new Set(e)];
}

// ---- Screening: does a review answer the finding's question? ------------------------------------
// Rules can't judge this from title words (a review of blood-sugar control in people who have diabetes
// isn't about preventing it), so a model reads each eligible review's title and abstract against the
// question, and every decision is kept with its reason for people to check.

/** The question a finding answers, in plain words (who, what was given, compared with what, what was measured). */
export interface Question {
  population: string;
  intervention: string;
  comparison: string;
  outcome: string;
}

export type Fit = "yes" | "partly" | "no";
export interface Decision {
  pmid: string;
  fits: Fit;
  /** One plain sentence: which part matches or differs. */
  reason: string;
}

export const questionText = (q: Question) =>
  `Population: ${q.population}\nIntervention: ${q.intervention}\nComparison: ${q.comparison}\nOutcome: ${q.outcome}`;

/** The prompt for one batch of reviews. Abstracts are shortened; the model judges only what it is given. */
export function screeningPrompt(q: Question, reviews: readonly Pick<Classified, "pmid" | "title" | "year" | "abstract">[], maxAbstract = 2500): string {
  const list = reviews
    .filter((r) => r.pmid)
    .map((r) => `PMID ${r.pmid} (${r.year ?? "year unknown"})\nTitle: ${r.title}\nAbstract: ${r.abstract.slice(0, maxAbstract) || "(none)"}`)
    .join("\n\n---\n\n");
  return [
    "You are screening systematic reviews for an evidence map. For each review below, decide whether it answers this question:",
    "",
    questionText(q),
    "",
    'fits = "yes": the review pooled randomised trials matching the population, intervention, comparison and outcome (a separate analysis or subgroup that matches counts).',
    'fits = "partly": close, but one part differs (for example the vitamin is only given together with something else, a narrower or different group of people, treating an illness instead of preventing it, or the outcome is only a blood marker).',
    'fits = "no": a different question.',
    "Judge only from the title and abstract given. Don't judge whether the supplement works, and don't use outside knowledge about the paper.",
    "",
    'Answer with JSON only, no other text: [{"pmid": "...", "fits": "yes" | "partly" | "no", "reason": "one plain sentence, under 200 characters, saying which part matches or differs"}], one entry per review, in the same order.',
    "",
    "Reviews:",
    "",
    list,
  ].join("\n");
}

/** The model's answer, checked: only the PMIDs asked about, a known `fits`, a short reason. Anything else is dropped (left unscreened). */
export function parseScreening(text: string, asked: readonly string[]): Decision[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const want = new Set(asked);
  const out = new Map<string, Decision>();
  for (const d of raw) {
    if (typeof d !== "object" || d === null) continue;
    const { pmid, fits, reason } = d as Record<string, unknown>;
    const id = typeof pmid === "number" ? String(pmid) : pmid;
    if (typeof id !== "string" || !want.has(id) || out.has(id)) continue;
    if (fits !== "yes" && fits !== "partly" && fits !== "no") continue;
    if (typeof reason !== "string" || !reason.trim()) continue;
    out.set(id, { pmid: id, fits, reason: reason.trim().slice(0, 300) });
  }
  return [...out.values()];
}

/** Eligible reviews split by the screening decisions. Reviews without a decision are `unscreened`, never counted as fitting. */
export function splitByScreening<T extends Pick<Classified, "pmid">>(eligible: readonly T[], decisions: readonly Decision[]) {
  const by = new Map(decisions.map((d) => [d.pmid, d]));
  const out = { yes: [] as T[], partly: [] as T[], no: [] as T[], unscreened: [] as T[] };
  for (const r of eligible) {
    const d = r.pmid ? by.get(r.pmid) : undefined;
    out[d ? d.fits : "unscreened"].push(r);
  }
  return out;
}
