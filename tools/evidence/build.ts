/**
 * Evidence map, step 3: from the downloaded records (fetch.ts), classify, choose and compare by the rules
 * in src/core/evidenceMap.ts, fetch the chosen reviews' reference lists (to see which trials they pooled),
 * and write the distilled map the app reads: knowledge/evidence-maps/<topic>.json.
 * `bun tools/evidence/build.ts vitamin_d`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chooseFrom, compareWithPage, coveredArea, largeTrialsSince, perYear, splitByScreening, type Chosen } from "../../src/core/evidenceMap";
import { CACHE, ROOT, loadTopic } from "./load";

const { topic, raw, nutrient, records, eligible: eligibleFor, screening } = loadTopic(process.argv[2]);
const trialIds = new Set(records.filter((r) => r.design === "rct" && r.pmid).map((r) => r.pmid!));

/** A review's reference list (PMIDs), from Europe PMC, cached. */
async function references(pmid: string): Promise<string[]> {
  const file = join(CACHE, `refs-${pmid}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as string[];
  const ids: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/MED/${pmid}/references?format=json&pageSize=1000&page=${page}`);
    if (!res.ok) break;
    const j = (await res.json()) as { hitCount?: number; referenceList?: { reference?: { id?: string; source?: string }[] } };
    const refs = j.referenceList?.reference ?? [];
    for (const r of refs) if (r.source === "MED" && r.id) ids.push(r.id);
    if (refs.length < 1000) break;
  }
  writeFileSync(file, JSON.stringify(ids));
  return ids;
}

const people = records.filter((r) => r.population !== "animal");
const counts = {
  all: raw.counts.all ?? 0,
  retrieved: records.length,
  animal: records.length - people.length,
  retracted: people.filter((r) => r.retracted).length,
  reviews: people.filter((r) => !r.retracted && (r.design === "meta-analysis" || r.design === "systematic review")).length,
  trials: people.filter((r) => !r.retracted && r.design === "rct").length,
  guidelines: people.filter((r) => !r.retracted && r.design === "guideline").length,
};

const outcomes = [];
for (const o of topic.outcomes) {
  const eligible = eligibleFor(o.id);
  // With screening (screen.ts) for this question, choose only from the reviews that answer it.
  const screened = screening?.outcomes[o.id];
  const current = screened && JSON.stringify(screened.question) === JSON.stringify(o.question) ? screened : undefined;
  const split = current ? splitByScreening(eligible, current.decisions) : undefined;
  const reasons = new Map(current?.decisions.map((d) => [d.pmid, d]) ?? []);
  const chosen = chooseFrom(split ? split.yes : eligible).map((c) => (split ? { ...c, why: `${c.why}; screened as answering the question` } : c));
  const newestYear = Math.max(0, ...chosen.slice(0, 3).map((c) => c.year ?? 0));
  const newer = newestYear ? largeTrialsSince(records, o.id, newestYear) : [];
  // Which vitamin D trials each chosen review lists in its references.
  const included: { review: string; trials: string[] }[] = [];
  for (const c of chosen) {
    if (!c.pmid) continue;
    const refs = await references(c.pmid);
    included.push({ review: c.pmid, trials: [...new Set(refs.filter((id) => trialIds.has(id)))] });
  }
  const withRefs = included.filter((x) => x.trials.length > 0);
  const overlap = coveredArea(withRefs.map((x) => x.trials));
  const trialInfo = new Map(records.filter((r) => r.pmid && trialIds.has(r.pmid)).map((r) => [r.pmid!, r]));
  const sharedTrials = [...new Set(withRefs.flatMap((x) => x.trials))]
    .map((id) => {
      const t = trialInfo.get(id)!;
      return { pmid: id, title: t.title.replace(/\.$/, ""), year: t.year, ...(t.n !== undefined ? { n: t.n } : {}), inReviews: withRefs.filter((x) => x.trials.includes(id)).map((x) => x.review) };
    })
    .sort((a, b) => b.inReviews.length - a.inReviews.length || (b.n ?? 0) - (a.n ?? 0));
  const finding = nutrient.findings.find((f) => f.outcome === o.finding);
  const cited = finding ? finding.studies.map((s) => s.pmid).filter((p): p is string => !!p) : [];
  const all = [...chosen, ...newer];
  outcomes.push({
    id: o.id,
    label: o.label,
    ...(o.finding ? { finding: o.finding } : {}),
    counts: {
      reviews: people.filter((r) => !r.retracted && (r.design === "meta-analysis" || r.design === "systematic review") && r.outcomes.includes(o.id)).length,
      trialReviews: eligible.length,
      trials: people.filter((r) => !r.retracted && r.design === "rct" && r.outcomes.includes(o.id)).length,
      largeTrials: people.filter((r) => !r.retracted && r.design === "rct" && r.outcomes.includes(o.id) && (r.n ?? 0) >= 1000).length,
    },
    chosenReviews: chosen,
    newerLargeTrials: newer,
    overlap: overlap ? { ...overlap, reviews: withRefs.map((x) => ({ pmid: x.review, trials: x.trials.length })), reviewsWithoutReferences: chosen.filter((c) => c.pmid && !withRefs.some((x) => x.review === c.pmid)).map((c) => c.pmid!), shared: sharedTrials.slice(0, 60) } : undefined,
    timeline: perYear(records, o.id),
    largeTrials: records
      .filter((r) => r.design === "rct" && r.population !== "animal" && !r.retracted && r.outcomes.includes(o.id) && (r.n ?? 0) >= 1000 && r.year)
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
      .map((r) => ({ pmid: r.pmid, title: r.title.replace(/\.$/, ""), year: r.year!, n: r.n! })),
    page: compareWithPage(cited, all, eligible),
    ...(current && split
      ? {
          screening: {
            question: current.question,
            by: screening!.by,
            at: current.at,
            counts: { yes: split.yes.length, partly: split.partly.length, no: split.no.length, unscreened: split.unscreened.length },
            left: [...split.partly, ...split.no]
              .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
              .map((r) => {
                const d = reasons.get(r.pmid!)!;
                return { pmid: r.pmid!, title: r.title.replace(/\.$/, ""), ...(r.year ? { year: r.year } : {}), fits: d.fits as "partly" | "no", reason: d.reason };
              }),
          },
        }
      : {}),
  });
  console.log(`${o.id}: ${eligible.length} eligible reviews${split ? ` (${split.yes.length} answer the question, ${split.partly.length} partly, ${split.no.length} not, ${split.unscreened.length} unscreened)` : ""}, chose ${chosen.length}; ${newer.length} newer large trials; overlap ${overlap ? Math.round(overlap.cca * 100) + "%" : "n/a"}`);
}

const guidelines = people
  .filter((r) => r.design === "guideline" && !r.retracted && /vitamin D|cholecalciferol|calcifediol/i.test(r.title))
  .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  .slice(0, 6)
  .map((r): Chosen => ({ ...(r.pmid ? { pmid: r.pmid } : {}), ...(r.doi ? { doi: r.doi } : {}), title: r.title.replace(/\.$/, ""), ...(r.year ? { year: r.year } : {}), ...(r.journal ? { journal: r.journal } : {}), citedBy: r.citedBy, why: "One of the newest guidelines with vitamin D in the title" }));

const map = {
  topic: topic.id,
  nutrientId: topic.nutrientId,
  builtAt: new Date().toISOString().slice(0, 10),
  fetchedAt: raw.fetchedAt,
  source: "Europe PMC (PubMed records)",
  queries: raw.queries,
  rules: [
    "Searched every PubMed record in Europe PMC with a vitamin D term in its title or abstract; downloaded all reviews, randomised trials and guidelines.",
    "Left out animal studies (MeSH tags, or the title when there are none) and retracted papers.",
    "An outcome counts when its words are in the title.",
    "Reviews: meta-analyses or systematic reviews of randomised trials of giving vitamin D, with vitamin D in the title (not reviews of blood levels in observational studies), and not about another group of people (sepsis, COVID-19, surgery, dialysis, pregnancy, type 1 diabetes and similar; the list is in the search definition). Chosen: the three newest meta-analyses (systematic reviews only if fewer than three), plus the most comprehensive one (most trials pooled, read from the abstract). Citations are shown but do not choose.",
    "Newer large trials: randomised trials of at least 1,000 people (read from the abstract) from the year of the newest chosen review on, which those reviews may not include.",
    ...(screening
      ? [`Screening: each eligible review's title and abstract was read against the finding's question (who, what was given, compared with what, what was measured) by ${screening.by}. Only reviews that answer it can be chosen; the others are listed with the reason. The decisions are kept in the repository and have not yet been checked by a clinician.`]
      : []),
    "Overlap: the chosen reviews' reference lists (from Europe PMC) matched against the downloaded vitamin D trials, measured as the corrected covered area (Pieper 2014, PMID 24581293).",
  ],
  counts,
  guidelines,
  outcomes,
};
mkdirSync(join(ROOT, "knowledge", "evidence-maps"), { recursive: true });
writeFileSync(join(ROOT, "knowledge", "evidence-maps", `${topic.id}.json`), JSON.stringify(map, null, 1));
console.log("counts", counts);
