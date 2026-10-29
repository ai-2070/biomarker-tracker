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

const base = `(${topic.terms.map((t) => `TITLE_ABS:"${t}"`).join(" OR ")}) AND SRC:MED`;
const queries = {
  all: base,
  reviews: `${base} AND (PUB_TYPE:"meta-analysis" OR PUB_TYPE:"systematic review")`,
  trials: `${base} AND PUB_TYPE:"randomized controlled trial"`,
  guidelines: `${base} AND PUB_TYPE:"practice guideline"`,
  retracted: `${base} AND PUB_TYPE:"retracted publication"`,
};

const counts = Object.fromEntries(await Promise.all(Object.entries(queries).map(async ([k, q]) => [k, await count(q)] as const)));
console.log("counts", counts);
const records = { reviews: await all(queries.reviews), trials: await all(queries.trials), guidelines: await all(queries.guidelines) };

const dir = join(import.meta.dirname, "cache");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${topic.id}.json`), JSON.stringify({ topic: topic.id, fetchedAt: new Date().toISOString().slice(0, 10), queries, counts, records }));
console.log(`saved ${records.reviews.length + records.trials.length + records.guidelines.length} records`);
