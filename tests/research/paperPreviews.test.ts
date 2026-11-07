import { EUROPE_PMC, type FetchFn } from "@bt/shared/research/papers";
import { describe, expect, it, vi } from "vitest";
import { createPaperPreviewLoader, paperPreviewId } from "../../apps/web/src/app/paperPreviews";

const respond = (records: unknown[] = [], status = 200) =>
  new Response(
    JSON.stringify({
      hitCount: records.length,
      resultList: { result: records },
    }),
    { status },
  );

const record = {
  pmid: "12345678",
  pmcid: "PMC1234567",
  title: "A public paper",
  pubYear: "2024",
  authorString: "A Researcher",
  abstractText: "<p>A public abstract.</p>",
  isOpenAccess: "Y",
};

function deferredResponse() {
  return Promise.withResolvers<Response>();
}

describe("paperPreviewId", () => {
  it.each([
    ["https://pubmed.ncbi.nlm.nih.gov/12345678/", "PMID:12345678"],
    ["https://pubmed.ncbi.nlm.nih.gov/12345678?utm_source=example#abstract", "PMID:12345678"],
    ["https://europepmc.org/article/MED/12345678", "PMID:12345678"],
    ["https://europepmc.org/article/MED/12345678/", "PMID:12345678"],
    ["https://europepmc.org/article/PMC/PMC1234567", "PMCID:PMC1234567"],
    ["https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/", "PMCID:PMC1234567"],
    ["https://doi.org/10.1093/ajcn/72.3.694", "DOI:10.1093/ajcn/72.3.694"],
    ["https://doi.org/10.1000%2Fabc%28def%29", "DOI:10.1000/abc(def)"],
    ["https://pubmed.ncbi.nlm.nih.gov/%31%32%33/", "PMID:123"],
    ["https://PUBMED.NCBI.NLM.NIH.GOV/123/", "PMID:123"],
  ])("recognises %s", (href, id) => {
    expect(paperPreviewId(href)).toBe(id);
  });

  it("keeps encoded DOI reserved characters but not actual URL queries or fragments", () => {
    expect(paperPreviewId("https://doi.org/10.1000/a%3Fb%23c%26d?tracking=1#link")).toBe("DOI:10.1000/a?b#c&d");
    expect(paperPreviewId("https://doi.org/10.1000/a?tracking=1#link")).toBe("DOI:10.1000/a");
    expect(paperPreviewId("https://doi.org/10.1000/a%2523b")).toBe("DOI:10.1000/a%23b");
  });

  it.each([
    "not a URL",
    "/123/",
    "http://pubmed.ncbi.nlm.nih.gov/123/",
    "https:pubmed.ncbi.nlm.nih.gov/123/",
    "https://doi.org/10.1234/a%00b",
    "https://pubmed.ncbi.nlm.nih.gov.evil.example/123/",
    "https://evil.example/pubmed.ncbi.nlm.nih.gov/123/",
    "https://www.pubmed.ncbi.nlm.nih.gov/123/",
    "https://europepmc.org.evil.example/article/MED/123",
    "https://doi.org.evil.example/10.1000/a",
    "https://pubmed.ncbi.nlm.nih.gov@evil.example/123/",
    "https://user:password@pubmed.ncbi.nlm.nih.gov/123/",
    "https://pubmed.ncbi.nlm.nih.gov:8443/123/",
    "https://pubmed.ncbi.nlm.nih.gov/?term=123",
    "https://pubmed.ncbi.nlm.nih.gov/search/123/",
    "https://pubmed.ncbi.nlm.nih.gov/123/extra",
    "https://pubmed.ncbi.nlm.nih.gov/1234567890/",
    "https://pubmed.ncbi.nlm.nih.gov/-123/",
    "https://pubmed.ncbi.nlm.nih.gov/123x/",
    "https://europepmc.org/article/MED/PMC123",
    "https://europepmc.org/article/PMC/123",
    "https://europepmc.org/article/PMC/PMC1234567890",
    "https://europepmc.org/search?query=123",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/extra",
    "https://pmc.ncbi.nlm.nih.gov/articles/123/",
    "https://doi.org/",
    "https://doi.org/10.123/a",
    "https://doi.org/10.1234/",
    "https://doi.org/10.1234/a%20b",
    "https://doi.org/10.1234/a%22b",
    "https://doi.org/10.1234/%zz",
    "https://doi.org/10.1234/%E0%A4%A",
    `https://doi.org/10.1234/${"x".repeat(201)}`,
    " https://pubmed.ncbi.nlm.nih.gov/123/",
    "https://pubmed.ncbi.nlm.nih.gov/12\n3/",
    "https://pubmed.ncbi.nlm.nih.gov\\123\\",
  ])("rejects unsupported or malformed link %s", (href) => {
    expect(paperPreviewId(href)).toBeUndefined();
  });
});

describe("createPaperPreviewLoader", () => {
  it("does not fetch at creation or for invalid citation keys", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => respond([record]));
    const load = createPaperPreviewLoader(fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
    for (const id of ["", "123", "ferritin", "https://doi.org/10.1234/a", "PMID:1234567890", 'DOI:10.1234/a" OR x']) {
      expect(await load(id)).toBeUndefined();
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("shares concurrent and completed lookups, including equivalent citation keys", async () => {
    const deferred = deferredResponse();
    const fetchFn = vi.fn<FetchFn>(() => deferred.promise);
    const load = createPaperPreviewLoader(fetchFn);
    const first = load("PMID:12345678");
    const second = load("pmid: 12345678");
    expect(first).toBe(second);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    deferred.resolve(respond([record]));
    const paper = await first;
    expect(paper).toMatchObject({ id: "PMID:12345678", abstract: "A public abstract.", openAccess: true });
    expect(await second).toBe(paper);
    expect(await load("PMID:12345678")).toBe(paper);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    const request = new URL(url);
    expect(`${request.origin}${request.pathname}`).toBe(EUROPE_PMC);
    expect(Object.fromEntries(request.searchParams)).toEqual({
      query: "EXT_ID:12345678 AND SRC:MED",
      format: "json",
      resultType: "core",
      pageSize: "1",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("looks up DOI reserved characters as part of the public identifier", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => respond([record]));
    const load = createPaperPreviewLoader(fetchFn);
    const id = paperPreviewId("https://doi.org/10.1000/a%3Fb%23c?tracking=1")!;
    await load(id);
    expect(new URL(fetchFn.mock.calls[0]![0]).searchParams.get("query")).toBe('DOI:"10.1000/a?b#c"');
  });

  it("shares and caches a successful no-record response", async () => {
    const deferred = deferredResponse();
    const fetchFn = vi.fn<FetchFn>(() => deferred.promise);
    const load = createPaperPreviewLoader(fetchFn);
    const first = load("PMCID:PMC123");
    const second = load("pmcid:pmc123");
    expect(first).toBe(second);
    deferred.resolve(respond());
    expect(await first).toBeUndefined();
    expect(await load("PMCID:PMC123")).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("shares a rejection but allows the next hover to retry", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(respond([record]));
    const load = createPaperPreviewLoader(fetchFn);
    const first = load("PMID:12345678");
    const second = load("PMID:12345678");
    expect(first).toBe(second);
    await expect(first).rejects.toThrow("Network unavailable");
    expect(await load("PMID:12345678")).toMatchObject({ title: "A public paper" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not cache HTTP errors or malformed responses", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(respond([], 503))
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(respond([record]));
    const load = createPaperPreviewLoader(fetchFn);
    await expect(load("PMID:123")).rejects.toThrow("HTTP 503");
    await expect(load("PMID:123")).rejects.toThrow("Unexpected response from Europe PMC");
    expect(await load("PMID:123")).toBeDefined();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("aborts at 12 seconds, with no background retry, and permits a later retry", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn<FetchFn>((_url, init) => {
        const { promise, reject } = Promise.withResolvers<Response>();
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true });
        return promise;
      });
      const load = createPaperPreviewLoader(fetchFn);
      const request = load("PMID:123");
      const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(11_999);
      expect(fetchFn.mock.calls[0]![1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      fetchFn.mockResolvedValueOnce(respond([record]));
      expect(await load("PMID:123")).toBeDefined();
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps at most 100 completed entries and refreshes recently used entries", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => respond());
    const load = createPaperPreviewLoader(fetchFn);
    for (let id = 1; id <= 100; id++) await load(`PMID:${id}`);
    await load("PMID:1");
    await load("PMID:101");
    await load("PMID:1");
    expect(fetchFn).toHaveBeenCalledTimes(101);
    await load("PMID:2");
    expect(fetchFn).toHaveBeenCalledTimes(102);
  });

  it("evicts completed entries before pending work", async () => {
    const deferred = deferredResponse();
    const fetchFn = vi
      .fn<FetchFn>()
      .mockImplementationOnce(() => deferred.promise)
      .mockImplementation(async () => respond());
    const load = createPaperPreviewLoader(fetchFn);
    const pending = load("PMID:1");
    for (let id = 2; id <= 101; id++) await load(`PMID:${id}`);
    expect(load("PMID:1")).toBe(pending);
    expect(fetchFn).toHaveBeenCalledTimes(101);
    deferred.resolve(respond([record]));
    expect(await pending).toBeDefined();
  });
});
