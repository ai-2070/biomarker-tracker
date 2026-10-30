/**
 * Evidence map, step 1: download every matching record from Europe PMC for one topic, by study type.
 * A developer tool (`bun tools/evidence/fetch.ts vitamin_d`), not part of the app: the app ships only the
 * distilled map in /knowledge/evidence-maps. The raw records go to tools/evidence/cache (not committed).
 *
 * Every record is kept as Europe PMC gives it, trimmed to the fields the map uses.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOPICS } from "./topics";

const API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const topicId = process.argv[2];
const topic = TOPICS.find((t) => t.id === topicId);
if (!topic) {
  console.error(`Unknown topic. Known: ${TOPICS.map((t) => t.id).join(", ")}`);
  process.exit(1);
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** The fields the map uses, from one Europe PMC "core" record. */
function trim(r: Raw) {
  const pubTypes = ((r.pubTypeList as Raw | undefined)?.pubType as string[] | undefined) ?? [];
  const mesh = (((r.meshHeadingList as Raw | undefined)?.meshHeading as Raw[] | undefined) ?? []).map((m) => str(m.descriptorName)).filter((x): x is string => !!x);
  return {
    pmid: str(r.pmid),
    pmcid: str(r.pmcid),
    doi: str(r.doi),
    title: str(r.title) ?? "",
    abstract: str(r.abstractText) ?? "",
    year: Number(str(r.pubYear)) || undefined,
    journal: str((r.journalInfo as Raw | undefined)?.journal ? ((r.journalInfo as Raw).journal as Raw).title : undefined),
    firstAuthor: str(r.authorString)?.split(",")[0],
    pubTypes,
    mesh,
    citedBy: typeof r.citedByCount === "number" ? r.citedByCount : 0,
  };
}

async function count(query: string): Promise<number> {
  const u = `${API}?${new URLSearchParams({ query, format: "json", pageSize: "1", resultType: "lite" })}`;
  const j = (await (await fetch(u)).json()) as { hitCount: number };
  return j.hitCount;
}

async function all(query: string) {
  const out: ReturnType<typeof trim>[] = [];
  let cursor = "*";
  for (let page = 0; page < 200; page++) {
    const u = `${API}?${new URLSearchParams({ query, format: "json", pageSize: "1000", resultType: "core", cursorMark: cursor })}`;
    let j: { resultList: { result: Raw[] }; nextCursorMark?: string } | undefined;
    for (let attempt = 0; attempt < 4 && !j; attempt++) {
      const res = await fetch(u);
      if (res.ok) j = (await res.json()) as typeof j;
      else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    if (!j) throw new Error(`Europe PMC failed for ${query}`);
    const rows = j.resultList.result;
    out.push(...rows.map(trim));
    process.stdout.write(`\r  ${out.length} records`);
    if (!rows.length || !j.nextCursorMark || j.nextCursorMark === cursor) break;
    cursor = j.nextCursorMark;
  }
  process.stdout.write("\n");
  return out;
}

const byType = (base: string) => ({
  all: base,
  // Also by title: the newest reviews aren't tagged with a publication type yet.
  reviews: `${base} AND (PUB_TYPE:"meta-analysis" OR PUB_TYPE:"systematic review" OR TITLE:"meta-analysis" OR TITLE:"meta analysis" OR TITLE:"systematic review")`,
  trials: `${base} AND PUB_TYPE:"randomized controlled trial"`,
  guidelines: `${base} AND PUB_TYPE:"practice guideline"`,
  retracted: `${base} AND PUB_TYPE:"retracted publication"`,
});
type Rec = ReturnType<typeof trim> & { matched?: string[] };
const download = async (q: ReturnType<typeof byType>) => ({ reviews: (await all(q.reviews)) as Rec[], trials: (await all(q.trials)) as Rec[], guidelines: (await all(q.guidelines)) as Rec[] });
const countAll = async (q: Record<string, string>) => Object.fromEntries(await Promise.all(Object.entries(q).map(async ([k, v]) => [k, await count(v)] as const)));

let queries: Record<string, string>;
let counts: Record<string, number>;
let records: { reviews: Rec[]; trials: Rec[]; guidelines: Rec[] };
let outcomeCounts: Record<string, number> | undefined;

if (topic.kind === "food" || topic.kind === "lifestyle" || topic.kind === "wholefood") {
  // A search per claim; each record remembers which claims' searches found it.
  const per = topic.outcomes.map((o) => ({ id: o.id, q: byType(`(${o.query}) AND SRC:MED`) }));
  queries = Object.fromEntries(per.map((p) => [p.id, p.q.all]));
  counts = await countAll(byType(`(${topic.outcomes.map((o) => `(${o.query})`).join(" OR ")}) AND SRC:MED`));
  outcomeCounts = Object.fromEntries(await Promise.all(per.map(async (p) => [p.id, await count(p.q.all)] as const)));
  console.log("counts", counts, outcomeCounts);
  records = { reviews: [], trials: [], guidelines: [] };
  const index = new Map<string, Rec>();
  for (const p of per) {
    console.log(p.id);
    const got = await download(p.q);
    for (const kind of ["reviews", "trials", "guidelines"] as const)
      for (const r of got[kind]) {
        const key = r.pmid ?? r.doi ?? r.title;
        const seen = index.get(key);
        if (seen) seen.matched = [...new Set([...(seen.matched ?? []), p.id])];
        else {
          const rec = { ...r, matched: [p.id] };
          index.set(key, rec);
          records[kind].push(rec);
        }
      }
  }
} else {
  const q = byType(`(${topic.terms.map((t) => `TITLE_ABS:"${t}"`).join(" OR ")})${topic.context ? ` AND (${topic.context})` : ""} AND SRC:MED`);
  queries = q;
  counts = await countAll(q);
  console.log("counts", counts);
  records = await download(q);
}

const dir = join(import.meta.dirname, "cache");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${topic.id}.json`), JSON.stringify({ topic: topic.id, fetchedAt: new Date().toISOString().slice(0, 10), queries, counts, ...(outcomeCounts ? { outcomeCounts } : {}), records }));
console.log(`saved ${records.reviews.length + records.trials.length + records.guidelines.length} records`);
