/**
 * Evidence map, step 3: from the downloaded records (fetch.ts), classify, choose and compare by the rules
 * in packages/shared/src/core/evidenceMap.ts. Bibliographies cannot establish included-study overlap,
 * and write the distilled map the app reads: knowledge/evidence-maps/<topic>.json.
 * `bun tools/evidence/build.ts vitamin_d`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Chosen, chooseFrom, compareWithPage, currentDecisions, largeTrialsSince, perYear, splitByScreening } from "@bt/shared/core/evidenceMap";
import { loadTopic, ROOT } from "./load";

const { topic, raw, food, studiesFor, records, eligible: eligibleFor, screening, topicTitle } = loadTopic(process.argv[2]);

const people = records.filter((r) => r.population !== "animal");
const counts = {
  // Unknown when the search had to be filtered after downloading (see localFilter).
  ...(topic.localFilter ? {} : { all: raw.counts.all ?? 0 }),
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
  // Missing, legacy or changed inputs stay unscreened; never silently choose from that pool.
  const mode = food ? topic.kind! : o.anyDesign ? "any-design" : "supplement";
  const screened = screening?.outcomes[o.id];
  const decisions = currentDecisions(o.question, eligible, mode, screened?.decisions ?? []);
  const split = splitByScreening(eligible, decisions);
  if (split.unscreened.length > 0)
    throw new Error(`${topic.id}/${o.id}: ${split.unscreened.length} eligible reviews need current screening; published map was not replaced`);
  const reasons = new Map(decisions.map((d) => [d.pmid, d]));
  const chosen = chooseFrom(split.yes, 3, food || o.anyDesign ? "on this finding (reviews of any study design)" : undefined).map((c) => ({
    ...c,
    why: `${c.why}; screened as answering the question`,
  }));
  const newestYear = Math.max(0, ...chosen.slice(0, 3).map((c) => c.year ?? 0));
  const newer = newestYear ? largeTrialsSince(records, o.id, newestYear) : [];
  // Included-study membership is not available. Do not fetch or cache bibliography overlap.
  const cited = studiesFor(o.finding)
    .map((s) => s.pmid)
    .filter((p): p is string => !!p);
  const all = [...chosen, ...newer];
  outcomes.push({
    id: o.id,
    label: o.label,
    anyDesign: food || !!o.anyDesign,
    ...(o.finding ? { finding: o.finding } : {}),
    counts: {
      ...(raw.outcomeCounts?.[o.id] !== undefined ? { all: raw.outcomeCounts[o.id] } : {}),
      reviews: people.filter((r) => !r.retracted && (r.design === "meta-analysis" || r.design === "systematic review") && r.outcomes.includes(o.id)).length,
      trialReviews: eligible.length,
      trials: people.filter((r) => !r.retracted && r.design === "rct" && r.outcomes.includes(o.id)).length,
      largeTrials: people.filter((r) => !r.retracted && r.design === "rct" && r.outcomes.includes(o.id) && (r.n ?? 0) >= 1000).length,
    },
    chosenReviews: chosen,
    newerLargeTrials: newer,
    timeline: perYear(records, o.id),
    largeTrials: records
      .filter((r) => r.design === "rct" && r.population !== "animal" && !r.retracted && r.outcomes.includes(o.id) && (r.n ?? 0) >= 1000 && r.year)
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
      .map((r) => ({ pmid: r.pmid, title: r.title.replace(/\.$/, ""), year: r.year!, n: r.n! })),
    page: compareWithPage(cited, all, eligible),
    screening: {
      question: o.question,
      by: [...new Set(decisions.map((d) => d.by!))].join("; ") || "Not yet screened with current inputs",
      at:
        decisions
          .map((d) => d.at!)
          .sort()
          .at(-1) ?? new Date().toISOString().slice(0, 10),
      provenance: "current" as const,
      decisions,
      counts: { yes: split.yes.length, partly: split.partly.length, no: split.no.length, unscreened: split.unscreened.length },
      left: [...split.partly, ...split.no]
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        .map((r) => {
          const d = reasons.get(r.pmid!)!;
          return { pmid: r.pmid!, title: r.title.replace(/\.$/, ""), ...(r.year ? { year: r.year } : {}), fits: d.fits as "partly" | "no", reason: d.reason };
        }),
    },
  });
  console.log(
    `${o.id}: ${eligible.length} eligible reviews (${split.yes.length} answer the question, ${split.partly.length} partly, ${split.no.length} not, ${split.unscreened.length} unscreened), chose ${chosen.length}; ${newer.length} newer large trials`,
  );
}

const guidelines = people
  .filter((r) => r.design === "guideline" && !r.retracted && (!topicTitle || topicTitle.test(r.title)))
  .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  .slice(0, 6)
  .map(
    (r): Chosen => ({
      ...(r.pmid ? { pmid: r.pmid } : {}),
      ...(r.doi ? { doi: r.doi } : {}),
      title: r.title.replace(/\.$/, ""),
      ...(r.year ? { year: r.year } : {}),
      ...(r.journal ? { journal: r.journal } : {}),
      citedBy: r.citedBy,
      why: food
        ? `One of the newest guidelines the ${topic.kind === "lifestyle" || topic.kind === "wholefood" ? "findings'" : "claims'"} searches found`
        : `One of the newest guidelines with ${topic.name} in the title`,
    }),
  );

const map = {
  topic: topic.id,
  ...(topic.kind === "wholefood"
    ? { kind: "wholefood", wholeFoodId: topic.wholeFoodId }
    : topic.kind === "lifestyle"
      ? { kind: "lifestyle", lifestyleId: topic.lifestyleId }
      : food
        ? { kind: "food", comparisonId: topic.comparisonId }
        : { nutrientId: topic.nutrientId }),
  name: topic.name,
  ...(topic.scope ? { scope: topic.scope } : {}),
  builtAt: new Date().toISOString().slice(0, 10),
  fetchedAt: raw.fetchedAt,
  source: "Europe PMC (PubMed records)",
  queries: raw.queries,
  rules:
    topic.kind === "wholefood"
      ? [
          "Each finding has its own written search of every PubMed record in Europe PMC (titles and abstracts); all reviews, randomised trials and guidelines it found were downloaded.",
          "Left out animal studies (MeSH tags, or the title when there are none) and retracted papers.",
          "A review counts for a finding when the finding's search found it and the finding's words are in its title.",
          `Reviews: meta-analyses or systematic reviews of any design, because much of what is known about eating ${topic.name} comes from studies that follow people over years, as well as from trials. Chosen: the three newest meta-analyses (systematic reviews only if fewer than three), plus the most comprehensive one (most studies pooled, read from the abstract). Citations are shown but do not choose.`,
          "Newer large trials: randomised trials of at least 1,000 people (read from the abstract) from the year of the newest chosen review on, which those reviews may not include.",
          "Only decisions with matching title, abstract, question and screening mode and known per-decision model attribution may select reviews. Missing, legacy or stale decisions remain unscreened. Current decisions and their provenance are listed per finding; not yet checked by a clinician.",
          "Overlap between the chosen reviews isn't shown: many pool cohort studies, which aren't downloaded, so shared studies can't be counted reliably.",
        ]
      : topic.kind === "lifestyle"
        ? [
            "Each finding has its own written search of every PubMed record in Europe PMC (titles and abstracts); all reviews, randomised trials and guidelines it found were downloaded.",
            "Left out animal studies (MeSH tags, or the title when there are none) and retracted papers.",
            "A review counts for a finding when the finding's search found it and the finding's words are in its title.",
            "Reviews: meta-analyses or systematic reviews of any design, because most of what is known about habits like walking, sleep or sauna comes from studies that follow people over years, as well as from trials. Chosen: the three newest meta-analyses (systematic reviews only if fewer than three), plus the most comprehensive one (most studies pooled, read from the abstract). Citations are shown but do not choose.",
            "Newer large trials: randomised trials of at least 1,000 people (read from the abstract) from the year of the newest chosen review on, which those reviews may not include.",
            "Only decisions with matching title, abstract, question and screening mode and known per-decision model attribution may select reviews. Missing, legacy or stale decisions remain unscreened. Current decisions and their provenance are listed per finding; not yet checked by a clinician.",
            "Overlap between the chosen reviews isn't shown: they mostly pool cohort studies, which aren't downloaded, so shared studies can't be counted reliably.",
          ]
        : food
          ? [
              "Each claim has its own written search of every PubMed record in Europe PMC (titles and abstracts); all reviews, randomised trials and guidelines it found were downloaded.",
              "Left out animal studies (MeSH tags, or the title when there are none) and retracted papers.",
              "A review counts for a claim when the claim's search found it and the claim's words are in its title.",
              "Reviews: meta-analyses or systematic reviews of any design, because claims about foods rest on absorption studies, cohort studies and food analyses as well as trials. Chosen: the three newest meta-analyses (systematic reviews only if fewer than three), plus the most comprehensive one (most trials pooled, read from the abstract). Citations are shown but do not choose.",
              "Newer large trials: randomised trials of at least 1,000 people (read from the abstract) from the year of the newest chosen review on, which those reviews may not include.",
              "Only decisions with matching title, abstract, question and screening mode and known per-decision model attribution may select reviews. Missing, legacy or stale decisions remain unscreened. Current decisions and their provenance are listed per claim; not yet checked by a clinician.",
              "Overlap between the chosen reviews isn't shown for these claims: their reviews mostly pool cohort, absorption and food-analysis studies, which aren't downloaded, so shared studies can't be counted reliably.",
            ]
          : [
              `Searched every PubMed record in Europe PMC with ${topic.name} (${topic.terms.join(", ")}) in its title or abstract${topic.scope ? `, ${topic.scope}` : ""}; downloaded all reviews, randomised trials and guidelines.`,
              "Left out animal studies (MeSH tags, or the title when there are none) and retracted papers.",
              "An outcome counts when its words are in the title.",
              `Reviews: meta-analyses or systematic reviews of randomised trials of giving ${topic.name}, with ${topic.name} in the title, or in the abstract of a review of several supplements (not reviews of blood levels in observational studies; reviews without an abstract are kept for screening), and not about another group of people (such as sepsis, intensive care or surgery; each outcome's list is in the search definition). Chosen: the three newest meta-analyses (systematic reviews only if fewer than three), plus the most comprehensive one (most trials pooled, read from the abstract). Citations are shown but do not choose.`,
              "Newer large trials: randomised trials of at least 1,000 people (read from the abstract) from the year of the newest chosen review on, which those reviews may not include.",
              "Only decisions with matching title, abstract, question and screening mode and known per-decision model attribution may select reviews. Missing, legacy or stale decisions remain unscreened. Current decisions and their provenance are listed per finding; not yet checked by a clinician.",
              ...(topic.outcomes.some((o) => o.anyDesign)
                ? [
                    `For ${topic.outcomes
                      .filter((o) => o.anyDesign)
                      .map((o) => o.label.toLowerCase())
                      .join(", ")}, reviews of any study design count, because that evidence comes from lab or observational studies rather than trials.`,
                  ]
                : []),
              "Overlap is not shown: a bibliography can cite background or excluded trials, so it does not establish which studies a review included or pooled.",
            ],
  counts,
  guidelines,
  outcomes,
};
mkdirSync(join(ROOT, "knowledge", "evidence-maps"), { recursive: true });
writeFileSync(join(ROOT, "knowledge", "evidence-maps", `${topic.id}.json`), JSON.stringify(map, null, 1));
console.log("counts", counts);
