/**
 * Evidence maps: how the studies behind a finding were found and chosen, by written rules rather than
 * by hand. A developer tool downloads every matching record from Europe PMC (tools/evidence); the rules
 * here classify each one (study design, people or animals, retracted or not, which outcome), choose the
 * reviews and trials for each outcome using current attributed screening, and count what's
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
  /** For maps searched claim by claim (foods): the outcomes whose search found this record. */
  matched?: string[];
}

export type Design = "guideline" | "meta-analysis" | "systematic review" | "rct" | "other";

/** Study design from the publication types (the most informative type wins). */
export function designOf(r: Pick<EvidenceRecord, "pubTypes"> & { title?: string }): Design {
  const t = r.pubTypes.map((x) => x.toLowerCase());
  const has = (s: string) => t.some((x) => x.includes(s));
  if (has("guideline")) return "guideline";
  if (has("meta-analysis")) return "meta-analysis";
  // The newest reviews aren't tagged yet (PubMed indexes publication types weeks or months later): their title says what they are.
  if (/\bmeta-? ?analy[sz](is|es)\b/i.test(r.title ?? "")) return "meta-analysis";
  if (has("systematic review")) return "systematic review";
  if (/\bsystematic (literature )?review\b/i.test(r.title ?? "")) return "systematic review";
  if (has("randomized controlled trial") || has("randomised controlled trial")) return "rct";
  return "other";
}

const ANIMAL_TITLE =
  /\b(rats?|mice|mouse|murine|rodents?|pigs?|piglets?|swine|dogs?|canine|cats?|feline|cattle|cows?|calves|sheep|lambs?|goats?|horses?|poultry|chickens?|broilers?|hens?|layers|zebrafish|in vitro|cell lines?)\b/i;
// Not "fish" or "dairy": reviews of people eating fish or dairy foods name them in the title.

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
  return (
    /\brandomi[sz]ed\b|\bRCTs?\b|\bcontrolled trials?\b|\bintervention (studies|trials)\b|\bplacebo\b|\bcontrol (group|arm)s?\b|\bin (the )?control\b/i.test(
      text,
    ) && /\bsupplement\w*|\bintervention\w*|\btreatment\b|\badministration\b|\bgiven\b/i.test(text)
  );
}

const PEOPLE = "participants|patients|adults|women|men|subjects|individuals|people|persons|children|infants|volunteers|residents|participants";
const SAMPLE_TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SAMPLE_ONES: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

/**
 * A participant count read from an abstract. Prefer explicit enrollment/randomisation to arm sizes,
 * event counts or recruitment pools; never treat doses, intervention identifiers or calendar years
 * as participants. Ambiguous/missing counts can remain unknown.
 */
export function sampleSize(abstract: string): number | undefined {
  const text = abstract.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?\b/gi,
    (_, ten: string, one: string | undefined) => String(SAMPLE_TENS[ten.toLowerCase()]! + (one ? SAMPLE_ONES[one.toLowerCase()]! : 0)),
  );
  const counts: { n: number; rank: number }[] = [];
  const number = "(?<![\\w-])(\\d{1,3}(?:[,\\s\\u202f\\u00a0]\\d{3})+|\\d+)";
  const assigned = /\b(?:randomly (?:assigned|allocated)|randomi[sz]ed|enrolled|recruited)\b/i;
  const grab = (m: RegExpMatchArray, rank: number) => {
    const n = Number(m[1]!.replace(/[,\s  ]/g, ""));
    const before = text.slice(Math.max(0, m.index! - 45), m.index);
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 120);
    const screened = /\b(?:pre-)?screen(?:ed|ing)\b/i.exec(after);
    const joined = assigned.exec(after);
    if (
      rank === 2 &&
      (/(?:randomly (?:assigned|allocated)|randomi[sz]ed|enrolled|recruited)\s*$/i.test(before) ||
        /^\s*(?:were|was|who were)?\s*(?:randomly (?:assigned|allocated)|randomi[sz]ed|enrolled|recruited)\b/i.test(after))
    )
      rank = 3;
    if (rank !== 3 && (/\b(?:screened|approached|identified)\s*$/i.test(before) || (screened && (!joined || screened.index < joined.index)))) return;
    if (Number.isFinite(n) && n >= 10 && n <= 5_000_000) counts.push({ n, rank });
  };
  // Only participant descriptors: arbitrary words here also match doses ("2000 IU in adults").
  const modifiers =
    "healthy|older|young|younger|elderly|adult|male|female|pregnant|postmenopausal|community-dwelling|randomi[sz]ed|newborn|participating|preschool|high-risk|nulliparous";
  for (const m of text.matchAll(new RegExp(`${number}\\s+(?:(?:${modifiers})\\s+){0,3}(?:${PEOPLE})\\b`, "gi"))) grab(m, 2);
  for (const m of text.matchAll(
    new RegExp(
      `${number}\\s+(?:provided consent to participate and\\s+)?(?:were\\s+)?(?:randomly (?:assigned|allocated)|randomi[sz]ed|enrolled|recruited)\\b`,
      "gi",
    ),
  ))
    grab(m, 3);
  for (const m of text.matchAll(/\b[nN]\s*=\s*(\d{1,3}(?:[,\s  ]\d{3})+|\d+)/g)) grab(m, 1);
  const rank = Math.max(0, ...counts.map((c) => c.rank));
  const preferred = counts.filter((c) => c.rank === rank);
  return preferred.length ? Math.max(...preferred.map((c) => c.n)) : undefined;
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
  const decode = (t: string) =>
    t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (named[e.toLowerCase()] ?? m),
    );
  // Decode encoded formatting too, but remove only actual named tags, never "< 30 ... >".
  const tags = /<\/?(?:abstract|title|p|div|span|i|b|em|strong|sub|sup|br|a|section|h[1-6]|jats:[a-z-]+)(?:\s+[^<>]*|\/)?>/gi;
  return decode(decode(s))
    .replace(/<\/?(?:abstract|title|p|div|section|h[1-6])(?:\s+[^<>]*|\/)?>/gi, " ")
    .replace(tags, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * An outcome a record can belong to: by words in its title (every pattern must match), and, for maps
 * searched claim by claim, only when that outcome's own search found it (`matched`).
 */
export interface OutcomeMatch {
  id: string;
  title?: RegExp | readonly RegExp[];
}

export function classify(raw: EvidenceRecord, outcomes: readonly OutcomeMatch[]): Classified {
  const r = { ...raw, title: plainText(raw.title), abstract: plainText(raw.abstract) };
  const n = sampleSize(r.abstract);
  const fits = (o: OutcomeMatch) => {
    if (raw.matched && !raw.matched.includes(o.id)) return false;
    if (!o.title) return !!raw.matched;
    return (Array.isArray(o.title) ? o.title : [o.title as RegExp]).every((t) => t.test(r.title));
  };
  return {
    ...r,
    design: designOf(r),
    population: populationOf(r),
    retracted: isRetracted(r),
    outcomes: outcomes.filter(fits).map((o) => o.id),
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

/** Titles of reviews that cover several supplements at once ("Nutritional supplements for migraine prevention"). */
export const SEVERAL_SUPPLEMENTS =
  /\b(dietary|nutritional) supplements?\b|\bsupplements\b|\bmicronutrients?\b|\bvitamins\b|\bminerals\b|\bnutraceuticals?\b|\bmultivitamins?\b/i;

/**
 * Reviews eligible for an outcome: meta-analyses or systematic reviews of trials, in people, not
 * retracted, with the topic in the title (so a review of every falls-prevention method, which mentions
 * vitamin D only in its abstract, isn't counted as a vitamin D review). A review of several supplements
 * counts when the topic is in its abstract. A review without an abstract can't be checked for trials,
 * so it is kept for screening rather than dropped.
 */
export function eligibleReviews(
  records: readonly Classified[],
  outcome: string,
  topicInTitle?: RegExp,
  excludeTitle?: RegExp,
  kind: MapKind = "supplement",
): Classified[] {
  return records.filter(
    (r) =>
      (r.design === "meta-analysis" || r.design === "systematic review") &&
      r.population !== "animal" &&
      !r.retracted &&
      r.outcomes.includes(outcome) &&
      // Claims about foods and habits rest on cohort, absorption and food-analysis studies too, so any design counts.
      (anyDesignKind(kind) || isTrialReview(r) || !r.abstract.trim()) &&
      (!topicInTitle || topicInTitle.test(r.title) || (SEVERAL_SUPPLEMENTS.test(r.title) && topicInTitle.test(r.abstract))) &&
      // A review of a different group of people (sepsis, surgery, pregnancy...) answers a different question.
      (!excludeTitle || !excludeTitle.test(r.title)),
  );
}

/** How many trials a review pooled, read from its abstract ("41 randomised controlled trials"): the largest such number. */
export function trialsPooled(abstract: string): number | undefined {
  const nums = [
    ...abstract.matchAll(
      /\b(\d{1,4})\s+(?:(?:eligible|independent|individual|double-blind(?:ed)?|placebo-controlled|randomi[sz]ed|controlled|clinical)\s+){0,4}(?:trials|RCTs)\b/gi,
    ),
  ].map((m) => Number(m[1]));
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
export function chooseFrom(pool: readonly Classified[], newest = 3, about = "of trials on this outcome"): Chosen[] {
  const byNew = (a: Classified, b: Classified) => (b.year ?? 0) - (a.year ?? 0) || b.citedBy - a.citedBy;
  const metas = pool.filter((r) => r.design === "meta-analysis").sort(byNew);
  const others = pool.filter((r) => r.design !== "meta-analysis").sort(byNew);
  const first = [...metas, ...others].slice(0, newest);
  const out = first.map((r) =>
    pick(
      r,
      `${r.design === "meta-analysis" ? "One of the newest meta-analyses" : "One of the newest systematic reviews"} ${about} (${r.year ?? "year unknown"})`,
    ),
  );
  const pooled = (r: Classified) => trialsPooled(r.abstract) ?? 0;
  const widest = [...pool].sort((a, b) => pooled(b) - pooled(a) || (b.year ?? 0) - (a.year ?? 0) || b.citedBy - a.citedBy)[0];
  if (widest && pooled(widest) > 0 && !first.includes(widest))
    out.push(pick(widest, `The most comprehensive review ${about} (${pooled(widest)} trials, ${widest.year ?? "year unknown"})`));
  return out;
}

/** Large trials (at least `minN` people, read from the abstract) on an outcome from a given year on: evidence newer reviews may not include. */
export function largeTrialsSince(records: readonly Classified[], outcome: string, sinceYear: number, minN = 1000): Chosen[] {
  return records
    .filter(
      (r) =>
        r.design === "rct" && r.population !== "animal" && !r.retracted && r.outcomes.includes(outcome) && (r.n ?? 0) >= minN && (r.year ?? 0) >= sinceYear,
    )
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
    .map((r) => pick(r, `A large trial (about ${(r.n ?? 0).toLocaleString("en-GB")} people) from ${r.year}, as new as the newest review or newer`));
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
  /** Reviews of any study design, rather than only trials (also set per supplement outcome). */
  anyDesign?: boolean;
  /** `all`: records the outcome's own search found (maps searched claim by claim). */
  counts: { all?: number; reviews: number; trialReviews: number; trials: number; largeTrials: number };
  chosenReviews: Chosen[];
  newerLargeTrials: Chosen[];
  /** Overlap is deliberately omitted: bibliographies don't establish included-study membership. */
  timeline: { year: number; reviews: number; trials: number }[];
  largeTrials: { pmid?: string; title: string; year: number; n: number }[];
  page: { alsoChosen: string[]; citedNotChosen: string[]; citedNotEligible: string[]; chosenNotCited: Chosen[] };
  /** When the eligible reviews were screened against the finding's question. */
  screening?: {
    question: Question;
    by: string;
    at: string;
    /** Old published decisions lack recoverable input/model attribution; not current screening. */
    provenance?: "current" | "legacy-inputs-unverified";
    decisions?: Decision[];
    counts: { yes: number; partly: number; no: number; unscreened: number };
    /** Reviews that don't fit (or only partly), with the reason, newest first. */
    left: { pmid: string; title: string; year?: number; fits: "partly" | "no"; reason: string }[];
  };
}

export interface EvidenceMapFile {
  topic: string;
  /** A supplement map (default) or a map of claims about foods. */
  kind?: MapKind;
  /** The nutrient page it belongs to, the food comparison topic (knowledge/food-comparison), the lifestyle entry or the whole food. */
  nutrientId?: string;
  comparisonId?: string;
  lifestyleId?: string;
  wholeFoodId?: string;
  /** The nutrient in sentences ("vitamin D"), and how the search was narrowed, if it was. */
  name: string;
  scope?: string;
  builtAt: string;
  fetchedAt: string;
  source: string;
  queries: Record<string, string>;
  rules: string[];
  counts: { all?: number; retrieved: number; animal: number; retracted: number; reviews: number; trials: number; guidelines: number };
  guidelines: Chosen[];
  outcomes: EvidenceMapOutcome[];
}

/** Problems with a map file; empty means valid. */
export function validateEvidenceMap(v: unknown): string[] {
  if (typeof v !== "object" || v === null) return ["not an object"];
  const m = v as Partial<EvidenceMapFile>;
  const e: string[] = [];
  const owners = [m.nutrientId, m.comparisonId, m.lifestyleId, m.wholeFoodId].filter((x) => typeof x === "string").length;
  if (typeof m.topic !== "string" || typeof m.name !== "string" || owners !== 1) e.push("a map needs a topic, a name and exactly one page it belongs to");
  if (typeof m.builtAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.builtAt)) e.push("builtAt must be a date");
  if (!Array.isArray(m.rules) || m.rules.length === 0) e.push("the rules must be written down");
  if (!m.counts || typeof m.counts.retrieved !== "number") e.push("counts are missing");
  if (!Array.isArray(m.outcomes) || m.outcomes.length === 0) e.push("no outcomes");
  else
    for (const o of m.outcomes) {
      if (!o.id || !o.label) e.push("an outcome has no id or label");
      for (const c of [...(o.chosenReviews ?? []), ...(o.newerLargeTrials ?? [])]) {
        if (!c.title || !c.why) e.push(`${o.id}: a chosen study has no title or reason`);
        if (!c.pmid && !c.doi) e.push(`${o.id}: a chosen study has no PMID or DOI`);
      }
      if (o.screening) {
        const sc = o.screening;
        if (!sc.question?.population || !sc.question.intervention || !sc.question.comparison || !sc.question.outcome)
          e.push(`${o.id}: the screening question is incomplete`);
        if (!sc.by) e.push(`${o.id}: who screened is missing`);
        if (sc.left.length !== sc.counts.partly + sc.counts.no) e.push(`${o.id}: every review left out must be listed`);
        if (sc.left.some((r) => !r.reason)) e.push(`${o.id}: a review left out has no reason`);
        // Only reviews that answer the question can be chosen.
        const left = new Set(sc.left.map((r) => r.pmid));
        if (o.chosenReviews.some((c) => c.pmid && left.has(c.pmid))) e.push(`${o.id}: a chosen review was screened out`);
        if (sc.provenance === "current") {
          const approved = new Set((sc.decisions ?? []).filter((d) => d.fits === "yes" && d.input && d.by && d.at).map((d) => d.pmid));
          if (o.chosenReviews.some((c) => !c.pmid || !approved.has(c.pmid))) e.push(`${o.id}: a chosen review has no current attributed approval`);
        }
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
  /** Exact versioned screening inputs; absent on legacy decisions, which must be screened again. */
  input?: string;
  by?: string;
  at?: string;
}

/**
 * What a map is about: a supplement (reviews of trials of giving it) or a claim about foods (reviews of
 * any design: trials, cohort studies, absorption studies, food analyses).
 */
export type MapKind = "supplement" | "food" | "lifestyle" | "wholefood";
export type ScreeningMode = MapKind | "any-design";

/** Food, lifestyle and whole-food maps: a search per finding or claim, and reviews of any design (cohorts, absorption studies, trials). */
export const anyDesignKind = (kind: MapKind | undefined) => kind === "food" || kind === "lifestyle" || kind === "wholefood";

export const questionText = (q: Question, kind: ScreeningMode = "supplement") =>
  `Population: ${q.population}\n${kind === "food" ? "Food or exposure" : kind === "lifestyle" ? "Habit or exposure" : kind === "wholefood" ? "Food" : "Intervention"}: ${q.intervention}\nComparison: ${q.comparison}\nOutcome: ${q.outcome}`;

/** The prompt for one batch of reviews. Abstracts are shortened; the model judges only what it is given. */
export function screeningPrompt(
  q: Question,
  reviews: readonly Pick<Classified, "pmid" | "title" | "year" | "abstract">[],
  kind: ScreeningMode = "supplement",
  maxAbstract = 2500,
): string {
  const list = reviews
    .filter((r) => r.pmid)
    .map((r) => `PMID ${r.pmid} (${r.year ?? "year unknown"})\nTitle: ${r.title}\nAbstract: ${r.abstract.slice(0, maxAbstract) || "(none)"}`)
    .join("\n\n---\n\n");
  const food = kind === "any-design" || anyDesignKind(kind);
  const habit = kind === "lifestyle";
  const eating = kind === "wholefood";
  return [
    "You are screening systematic reviews for an evidence map. For each review below, decide whether it answers this question:",
    "",
    questionText(q, kind),
    "",
    food
      ? kind === "any-design"
        ? 'fits = "yes": the review pooled or systematically reviewed studies of any design, including laboratory or observational studies, matching the population, intervention or exposure, comparison and outcome (a matching separate analysis or subgroup counts).'
        : eating
          ? 'fits = "yes": the review pooled or systematically reviewed studies of any design (randomised trials or studies following people over time) of people eating or drinking the food itself (whole, juice, or dried and powdered whole food) that match the population, comparison and outcome (a separate analysis or subgroup that matches counts).'
          : habit
            ? 'fits = "yes": the review pooled or systematically reviewed studies of any design (randomised trials or studies following people over time) that match the population, habit or exposure, comparison and outcome (a separate analysis or subgroup that matches counts).'
            : 'fits = "yes": the review pooled or systematically reviewed studies of any design (trials, cohort studies, absorption or feeding studies, analyses of foods) that match the population, food or exposure, comparison and outcome (a separate analysis or subgroup that matches counts).'
      : 'fits = "yes": the review pooled randomised trials matching the population, intervention, comparison and outcome (a separate analysis or subgroup that matches counts).',
    food
      ? kind === "any-design"
        ? 'fits = "partly": close, but part of the population, intervention or exposure, comparison or outcome differs.'
        : eating
          ? 'fits = "partly": close, but one part differs (for example an extract or supplement of the food instead of the food itself, a group of foods where this one is not analysed on its own, a narrower or different group of people, or only one part of the outcome).'
          : habit
            ? 'fits = "partly": close, but one part differs (for example a different kind of exercise, heat, cold or light than the question names, a combined programme where this habit is not analysed on its own, a narrower or different group of people, or only one part of the outcome).'
            : 'fits = "partly": close, but one part differs (for example a supplement instead of the food, a narrower or different group of people, or only one part of the claim).'
      : 'fits = "partly": close, but one part differs (for example the vitamin is only given together with something else, a narrower or different group of people, treating an illness instead of preventing it, or the outcome is only a blood marker).',
    'fits = "no": a different question.',
    `Judge only from the title and abstract given. Don't judge whether ${eating ? "the food works" : habit ? "the habit works" : food ? "the claim is true" : "the supplement works"}, and don't use outside knowledge about the paper.`,
    "",
    'Answer with JSON only, no other text: [{"pmid": "...", "fits": "yes" | "partly" | "no", "reason": "one plain sentence, under 200 characters, saying which part matches or differs"}], one entry per review, in the same order.',
    "",
    "Reviews:",
    "",
    list,
  ].join("\n");
}

/** Canonical input key, collision-free rather than a lossy hash; includes the prompt version and mode. */
export function screeningInput(q: Question, r: Pick<Classified, "pmid" | "title" | "year" | "abstract" | "design">, kind: ScreeningMode): string {
  return JSON.stringify([
    "screening-v1",
    kind,
    r.design,
    q.population,
    q.intervention,
    q.comparison,
    q.outcome,
    r.pmid,
    r.year ?? null,
    r.title,
    r.abstract,
    screeningPrompt(q, [r], kind),
  ]);
}

/** Reuse only decisions with known attribution and the exact inputs the current screen would receive. */
export function currentDecisions(q: Question, reviews: readonly Classified[], kind: ScreeningMode, decisions: readonly Decision[]): Decision[] {
  const inputs = new Map(reviews.filter((r) => r.pmid).map((r) => [r.pmid!, screeningInput(q, r, kind)]));
  return decisions.filter((d) => !!d.by && !!d.at && d.input !== undefined && d.input === inputs.get(d.pmid));
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
