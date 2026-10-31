import type { ClaimRequest, ClaimUpdate } from "../core/claimEvidence";
import { EUTILS, sanitizeTopic, type FetchFn } from "./papers";

// PubMed entry date, not publication date or the date a MeSH tag was added.
export const CANDIDATE_DESIGNS = '(review[pt] OR systematic review[pt] OR meta-analysis[pt] OR clinical trial[pt] OR randomized controlled trial[pt] OR review[ti] OR meta-analysis[ti] OR trial[ti])';
let queue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;

/** Share a conservative <3 requests/second queue, including concurrent UI callers. */
export function pubmedMetadata(url: string, fetchFn: FetchFn = fetch, signal?: AbortSignal): Promise<Response> {
  const run = queue.catch(() => undefined).then(async () => {
    signal?.throwIfAborted();
    const delay = Math.max(0, nextRequestAt - Date.now());
    // ES2023/browser baseline does not provide Promise.withResolvers.
    if (delay) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
      signal?.addEventListener('abort', abort, { once: true });
    });
    signal?.throwIfAborted();
    nextRequestAt = Date.now() + 400;
    const response = await fetchFn(url, { signal });
    if (!response.ok) throw new Error(`PubMed metadata request failed (HTTP ${response.status})`);
    return response;
  });
  queue = run;
  return run;
}

export function utcDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) throw new Error('Use a valid ISO review date');
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime()) || (value.length === 10 && date.toISOString().slice(0, 10) !== value)) throw new Error('Use a valid ISO review date');
  return date.toISOString().slice(0, 10);
}

export function publicWords(value: string): string {
  const words = sanitizeTopic(value).map(word => word.slice(0, 60));
  if (!words.length) throw new Error('A public supplement name and topic are required');
  return words.map(word => `"${word}"[tiab]`).join(' AND ');
}

export function claimMetadataQuery(request: ClaimRequest, from: string, to: string): string {
  return `(${publicWords(request.nutrientId.replace(/_/g, ' '))}) AND (${publicWords(request.topic)}) AND ${CANDIDATE_DESIGNS} AND ("${utcDay(from)}"[EDAT] : "${utcDay(to)}"[EDAT])`;
}

export async function searchMetadata(query: string, retstart = 0, retmax = 0, fetchFn: FetchFn = fetch, signal?: AbortSignal): Promise<{ count: number; ids: string[] }> {
  const params = new URLSearchParams({ db: 'pubmed', retmode: 'json', term: query, retstart: String(retstart), retmax: String(retmax), sort: 'pub date' });
  const response = await pubmedMetadata(`${EUTILS}/esearch.fcgi?${params}`, fetchFn, signal);
  const json: unknown = await response.json();
  if (!json || typeof json !== 'object' || !('esearchresult' in json)) throw new Error('Unexpected PubMed metadata response');
  const result = json.esearchresult;
  if (!result || typeof result !== 'object' || !('idlist' in result) || !('count' in result)) throw new Error('Unexpected PubMed metadata response');
  if ('errorlist' in result || !Array.isArray(result.idlist) || typeof result.count !== 'string' || !/^\d+$/.test(result.count)) throw new Error('Unexpected PubMed metadata response');
  const count = Number(result.count);
  if (!Number.isSafeInteger(count) || result.idlist.some(id => typeof id !== 'string' || !/^\d+$/.test(id))) throw new Error('Invalid PubMed metadata count or IDs');
  signal?.throwIfAborted();
  return { count, ids: result.idlist as string[] };
}

/** Candidate records only. The reviewed UTC day is excluded in full; same-day additions cannot be detected. */
export async function countNewClaimStudies(request: ClaimRequest, since: string, opts: { fetchFn?: FetchFn; signal?: AbortSignal; now?: Date } = {}): Promise<ClaimUpdate> {
  const reviewedDay = utcDay(since);
  const start = new Date(`${reviewedDay}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  const now = opts.now ?? new Date();
  const today = utcDay(now.toISOString());
  const query = claimMetadataQuery(request, start.toISOString().slice(0, 10), today);
  opts.signal?.throwIfAborted();
  const count = start.toISOString().slice(0, 10) > today ? 0 : (await searchMetadata(query, 0, 0, opts.fetchFn, opts.signal)).count;
  return { count, checkedAt: now.toISOString(), since, query };
}
