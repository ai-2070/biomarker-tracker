import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { CANDIDATE_DESIGNS, claimMetadataQuery, pubmedMetadata, searchMetadata, utcDay } from '../../src/research/claimUpdates';
import { cleanText, EUTILS, type FetchFn } from '../../src/research/papers';

export interface RecordMetadata { id: string; title: string; trial: boolean; headings: string[] }
export interface WatchReport {
  supplement: string; month: string; from: string; to: string; query: string;
  claims: { claim: string; topic: string; query: string; count: number; ids: string[] }[];
  records: RecordMetadata[]; candidates: { topic: string; ids: string[] }[];
  hasFindings: boolean; factsReviewDue: boolean; factsReviewedOn: string | null; limitations: string;
}
export function previousMonth(now: Date): { month: string; from: string; to: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { month: start.toISOString().slice(0, 7), from: utcDay(start.toISOString()), to: utcDay(end.toISOString()) };
}

// Only EFetch metadata is read: no abstracts, full text, models or user data.
export function parseMetadata(xml: string): RecordMetadata[] {
  if (!xml.includes('<PubmedArticleSet') || /<ERROR[ >]/i.test(xml)) throw new Error('Unexpected PubMed EFetch metadata');
  return [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g)].map(([, article]) => {
    const text = article!;
    const id = /<PMID\b[^>]*>(\d+)<\/PMID>/.exec(text)?.[1];
    const title = /<ArticleTitle\b[^>]*>([\s\S]*?)<\/ArticleTitle>/.exec(text)?.[1];
    if (!id || !title) throw new Error('PubMed metadata missing ID or title');
    const types = [...text.matchAll(/<PublicationType\b[^>]*>([\s\S]*?)<\/PublicationType>/g)].map(match => cleanText(match[1]!));
    const explicitReview = types.some(type => /review|meta-analysis/i.test(type));
    const trial = !explicitReview && (types.some(type => /clinical trial|randomized controlled trial/i.test(type)) || /\btrial\b/i.test(cleanText(title)));
    return { id, title: cleanText(title), trial, headings: [...new Set([...text.matchAll(/<DescriptorName\b[^>]*>([\s\S]*?)<\/DescriptorName>/g)].map(match => cleanText(match[1]!)))] };
  });
}

// Conservative outcome allow-list by heading shape. This intentionally misses many
// real outcomes rather than turning every chemical/demographic MeSH tag into a benefit.
function normalizeOutcome(value: string): string {
  return value.toLowerCase().replace(/\basthenopia\b/g, 'eye strain').replace(/\beyestrain\b/g, 'eye strain');
}
export function candidateTopics(records: RecordMetadata[], knownTopics: string[]): { topic: string; ids: string[] }[] {
  const known = knownTopics.map(normalizeOutcome).join(' ');
  const signals = new Map<string, Set<string>>();
  for (const record of records) {
    if (!record.trial) continue;
    for (const topic of record.headings) {
      if (/astaxanthin|carotenoid|human|animal|male|female|adult|aged|child|adolescent|pregnan|placebo|random|blind|clinical trial|treatment outcome|follow-up|prospective|dietary supplement|drug administration|dose-response|time factor/i.test(topic)) continue;
      const normalized = normalizeOutcome(topic);
      if (!/disease|syndrome|pain|fatigue|stress|function|performance|cognition|memory|pressure|lipid|cholesterol|triglyceride|glucose|insulin|inflamm|oxidative|visual|vision|eye strain|skin|retina|muscle|exercise|sleep|immunity|immune|fertility/i.test(normalized)) continue;
      if (known.includes(normalized)) continue;
      const keyWords = normalized.split(/[^a-z]+/).filter(word => word.length > 3);
      if (keyWords.some(word => known.includes(word))) continue;
      const ids = signals.get(topic) ?? new Set<string>();
      ids.add(record.id); signals.set(topic, ids);
    }
  }
  return [...signals].filter(([, ids]) => ids.size >= 3).map(([topic, ids]) => ({ topic, ids: [...ids].sort() })).sort((a, b) => a.topic.localeCompare(b.topic));
}

export async function allIds(query: string, fetchFn: FetchFn = fetch): Promise<string[]> {
  const ids = new Set<string>();
  let total = 1;
  for (let offset = 0; offset < total; offset += 200) {
    const page = await searchMetadata(query, offset, 200, fetchFn);
    total = page.count;
    if (total > 9999) throw new Error('PubMed search exceeds paging limit; narrow the monthly query');
    if (offset < total && !page.ids.length) throw new Error('PubMed returned an incomplete metadata page');
    page.ids.forEach(id => ids.add(id));
  }
  return [...ids];
}

export async function watch(now = new Date(), fetchFn: FetchFn = fetch): Promise<WatchReport> {
  const guide = JSON.parse(await readFile(new URL('../../knowledge/nutrients/astaxanthin.json', import.meta.url), 'utf8')) as { simpleGuide?: { claimTopics?: Record<string, string>; factsReviewedOn?: string } };
  const topics = guide.simpleGuide?.claimTopics;
  if (!topics || !Object.keys(topics).length) throw new Error('Astaxanthin guide claim topics are missing');
  const period = previousMonth(now);
  const factsReviewedOn = guide.simpleGuide?.factsReviewedOn ?? null;
  const anniversary = factsReviewedOn ? new Date(`${utcDay(factsReviewedOn)}T00:00:00Z`) : null;
  if (anniversary) anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  const factsReviewDue = anniversary !== null && now.getTime() > anniversary.getTime();
  const claims = [];
  for (const [claim, topic] of Object.entries(topics)) {
    const query = claimMetadataQuery({ nutrientId: 'astaxanthin', claim, topic }, period.from, period.to);
    const ids = await allIds(query, fetchFn);
    claims.push({ claim, topic, query, count: ids.length, ids });
  }
  // Title words catch some newest papers before publication-type tags arrive.
  const query = `astaxanthin[tiab] AND ${CANDIDATE_DESIGNS} AND ("${period.from}"[EDAT] : "${period.to}"[EDAT])`;
  const ids = await allIds(query, fetchFn);
  const records: RecordMetadata[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const response = await pubmedMetadata(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${batch.join(',')}`, fetchFn);
    const parsed = parseMetadata(await response.text());
    const received = new Set(parsed.map(record => record.id));
    if (batch.some(id => !received.has(id))) throw new Error('PubMed EFetch omitted requested records');
    records.push(...parsed);
  }
  const candidates = candidateTopics(records, Object.values(topics));
  return { supplement: 'astaxanthin', ...period, query, claims, records, candidates, factsReviewedOn, factsReviewDue, hasFindings: factsReviewDue || claims.some(claim => claim.count > 0) || candidates.length > 0,
    limitations: 'Metadata signals, not validated benefits or updated grades. EDAT is PubMed entry date, not publication date. Newest papers may lack design/MeSH tags; title trial/review words are a partial fallback. MeSH added after the entry month is not revisited. Outcomes require at least three distinct candidate trial PMIDs and conservative heading matching; animal trials and irrelevant outcomes may remain. No prior completed evidence review is implied.' };
}

export function issueBody(report: WatchReport): string {
  return `<!-- astaxanthin-claim-watch:${report.month} -->\n# Astaxanthin metadata signals: ${report.month}\n\n${report.limitations}\n\n## Stable facts review\nLast reviewed: ${report.factsReviewedOn ?? 'not recorded'}. Annual review due: ${report.factsReviewDue ? 'yes — administrative reminder, not new efficacy evidence' : 'no'}.\n\n## Existing guide claims\n${report.claims.filter(claim => claim.count).map(claim => `- ${claim.claim}: ${claim.count} candidate records — ${claim.ids.map(id => `https://pubmed.ncbi.nlm.nih.gov/${id}/`).join(', ')}\n  Query: ${claim.query}`).join('\n')}\n\n## Candidate new outcome topics (not benefits)\n${report.candidates.map(candidate => `- ${candidate.topic}: ${candidate.ids.map(id => `https://pubmed.ncbi.nlm.nih.gov/${id}/`).join(', ')}`).join('\n') || 'None at the three-trial threshold.'}\n\n## Retrieved metadata\n${report.records.map(record => `- PMID ${record.id}: ${record.title}${record.headings.length ? '' : ' (MeSH not available)'}`).join('\n')}\n\nDeveloper review only: inspect relevance, population and study design before changing any guide claim. No claims, grades or evidence maps were changed.\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const at = process.argv.indexOf('--now');
  const report = await watch(at >= 0 ? new Date(process.argv[at + 1]!) : new Date());
  const output = process.argv.indexOf('--output');
  if (output >= 0) {
    await writeFile(process.argv[output + 1]!, JSON.stringify(report, null, 2));
    await writeFile(`${process.argv[output + 1]!}.md`, issueBody(report));
  }
  console.log(JSON.stringify(report, null, 2));
}
