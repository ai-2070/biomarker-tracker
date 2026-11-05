import { paperById, studyQuery, type FetchFn, type Paper } from "@bt/shared/research/papers";

/** Recognise paper links only; never turn an arbitrary link or search into a request. */
export function paperPreviewId(href: string): string | undefined {
  if (!/^https:\/\//i.test(href) || /[\s\\\u0000-\u001f\u007f]/u.test(href)) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    // Split the URL before decoding: an encoded ? or # belongs to the DOI,
    // whereas an actual query or fragment belongs to the link, not its identity.
    const path = decodeURIComponent(url.pathname);
    if (/[\u0000-\u001f\u007f]/u.test(path)) return undefined;
    let id: string | undefined;
    let match: RegExpExecArray | null;
    if (url.hostname === "pubmed.ncbi.nlm.nih.gov") {
      match = /^\/(\d+)\/?$/.exec(path);
      if (match) id = `PMID:${match[1]}`;
    } else if (url.hostname === "europepmc.org") {
      match = /^\/article\/MED\/(\d+)\/?$/.exec(path);
      if (match) id = `PMID:${match[1]}`;
      else {
        match = /^\/article\/PMC\/(PMC\d+)\/?$/.exec(path);
        if (match) id = `PMCID:${match[1]}`;
      }
    } else if (url.hostname === "pmc.ncbi.nlm.nih.gov") {
      match = /^\/articles\/(PMC\d+)\/?$/.exec(path);
      if (match) id = `PMCID:${match[1]}`;
    } else if (url.hostname === "doi.org") {
      id = `DOI:${path.slice(1)}`;
    }
    return id && studyQuery(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

interface PreviewEntry {
  promise: Promise<Paper | undefined>;
  pending: boolean;
}

const CACHE_LIMIT = 100;
const TIMEOUT_MS = 12_000;

/** An in-memory public-metadata cache. Creating it does not start any requests. */
export function createPaperPreviewLoader(fetchFn: FetchFn): (id: string) => Promise<Paper | undefined> {
  const cache = new Map<string, PreviewEntry>();
  return (id) => {
    const query = studyQuery(id);
    if (!query) return Promise.resolve(undefined);
    const cached = cache.get(query);
    if (cached) {
      // Refresh recency without replacing the shared promise.
      cache.delete(query);
      cache.set(query, cached);
      return cached.promise;
    }
    if (cache.size >= CACHE_LIMIT) {
      // Prefer an old completed entry. Only evict pending work when all 100
      // slots are pending; eviction never cancels another link's request.
      let oldest = cache.keys().next().value;
      for (const [key, entry] of cache) {
        if (!entry.pending) {
          oldest = key;
          break;
        }
      }
      if (oldest !== undefined) cache.delete(oldest);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const entry: PreviewEntry = {
      pending: true,
      promise: paperById(id, fetchFn, controller.signal).then(
        (paper) => {
          entry.pending = false;
          return paper;
        },
        (error: unknown) => {
          if (cache.get(query) === entry) cache.delete(query);
          throw error;
        },
      ).finally(() => clearTimeout(timeout)),
    };
    cache.set(query, entry);
    return entry.promise;
  };
}

export const loadPaperPreview = createPaperPreviewLoader((url, init) => fetch(url, init));
