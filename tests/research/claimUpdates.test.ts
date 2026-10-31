import { describe, expect, it, vi } from 'vitest';
import { claimMetadataQuery, countNewClaimStudies, publicWords, searchMetadata, utcDay } from '../../src/research/claimUpdates';
import { allIds, candidateTopics, issueBody, parseMetadata, previousMonth, watch, type RecordMetadata } from '../../tools/claims/watch';
import { alreadyReported, watchMarker } from '../../tools/claims/publish';

const request = { nutrientId: 'astaxanthin', claim: 'Eye strain', topic: 'eye strain' };
const response = (count: string, ids: string[] = []) => new Response(JSON.stringify({ esearchresult: { count, idlist: ids } }));

describe('cheap public claim metadata', () => {
  it('excludes the reviewed UTC day, includes deterministic current day, exposes exact query', async () => {
    const fetchFn = vi.fn(async (_url: string) => response('4'));
    const result = await countNewClaimStudies(request, '2026-10-28T23:00:00-02:00', { fetchFn, now: new Date('2026-10-31T12:00:00Z') });
    expect(result.count).toBe(4);
    expect(result.query).toContain('"2026-10-30"[EDAT] : "2026-10-31"[EDAT]');
    expect(result.checkedAt).toBe('2026-10-31T12:00:00.000Z');
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.searchParams.get('retmax')).toBe('0');
    expect(url.searchParams.get('term')).toBe(result.query);
  });
  it('does not request an inverted same-day window', async () => {
    const fetchFn = vi.fn(async () => response('1'));
    expect((await countNewClaimStudies(request, '2026-10-31', { fetchFn, now: new Date('2026-10-31T12:00Z') })).count).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('quotes each sanitized word so operators and field syntax cannot broaden the query', () => {
    const words = publicWords('eye OR cancer[all] NOT (trial)');
    expect(words).toBe('"eye"[tiab] AND "cancer"[tiab] AND "all"[tiab] AND "trial"[tiab]');
    expect(() => publicWords('OR []')).toThrow();
    expect(() => utcDay('2026-02-30')).toThrow();
    expect(claimMetadataQuery(request, '2026-10-01', '2026-10-31')).toContain('trial[ti]');
  });
  it('never converts HTTP, malformed count, PubMed errors or abort into zero', async () => {
    await expect(searchMetadata('x', 0, 0, async () => new Response('', { status: 429 }))).rejects.toThrow('429');
    await expect(searchMetadata('x', 0, 0, async () => response('oops'))).rejects.toThrow();
    await expect(searchMetadata('x', 0, 0, async () => new Response(JSON.stringify({ esearchresult: { count: '0', idlist: [], errorlist: { phrasesnotfound: ['x'] } } })))).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    const fetchFn = vi.fn(async () => response('0'));
    await expect(countNewClaimStudies(request, '2026-10-01', { fetchFn, signal: controller.signal })).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('astaxanthin developer discovery', () => {
  it('uses the last complete calendar month including leap days/year rollover', () => {
    expect(previousMonth(new Date('2024-03-01T00:00Z'))).toEqual({ month: '2024-02', from: '2024-02-01', to: '2024-02-29' });
    expect(previousMonth(new Date('2026-01-31T23:00Z')).month).toBe('2025-12');
  });
  it('pages and deduplicates PMIDs, and rejects truncated pages', async () => {
    const fetchFn = vi.fn(async (url: string) => new URL(url).searchParams.get('retstart') === '0' ? response('201', ['1', '2']) : response('201', ['2', '3']));
    expect(await allIds('astaxanthin', fetchFn)).toEqual(['1', '2', '3']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await expect(allIds('x', async () => response('1'))).rejects.toThrow('incomplete');
  });
  it('requires three distinct trials and filters generic, known and chemical headings', () => {
    const record = (id: string): RecordMetadata => ({ id, title: 'Trial', trial: true, headings: ['Humans', 'Female', 'Astaxanthin', 'Treatment Outcome', 'Skin Aging', 'Muscle Strength'] });
    expect(candidateTopics([record('1'), record('2'), record('2')], ['skin tone'])).toEqual([]);
    expect(candidateTopics([record('1'), record('2'), record('3'), { ...record('4'), trial: false }], ['skin tone'])).toEqual([{ topic: 'Muscle Strength', ids: ['1', '2', '3'] }]);
  });
  it('reads MeSH and design metadata, retains untagged title trials and fails malformed responses', () => {
    const records = parseMetadata('<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article><ArticleTitle>A trial &amp; results</ArticleTitle></Article><MeshHeadingList><MeshHeading><DescriptorName UI="D1">Muscle Strength</DescriptorName></MeshHeading></MeshHeadingList></MedlineCitation></PubmedArticle></PubmedArticleSet>');
    expect(records).toEqual([{ id: '123', title: 'A trial & results', trial: true, headings: ['Muscle Strength'] }]);
    expect(() => parseMetadata('<ERROR>rate limit</ERROR>')).toThrow();
    expect(() => parseMetadata('<PubmedArticleSet><PubmedArticle></PubmedArticle></PubmedArticleSet>')).toThrow();
  });
  it('does not count reviews mentioning trial sequential analysis as trials', () => {
    for (const type of ['Review', 'Systematic Review', 'Meta-Analysis']) {
      const xml = `<PubmedArticleSet><PubmedArticle><PMID>1</PMID><ArticleTitle>A trial sequential analysis</ArticleTitle><PublicationType>${type}</PublicationType></PubmedArticle></PubmedArticleSet>`;
      expect(parseMetadata(xml)[0]!.trial).toBe(false);
    }
    const xml = '<PubmedArticleSet><PubmedArticle><PMID>2</PMID><ArticleTitle>A randomized clinical trial</ArticleTitle><PublicationType>Journal Article</PublicationType></PubmedArticle></PubmedArticleSet>';
    expect(parseMetadata(xml)[0]!.trial).toBe(true);
  });
  it('normalizes Asthenopia to the existing eye-strain topic without hiding an unknown outcome', () => {
    const records: RecordMetadata[] = ['1', '2', '3'].map(id => ({ id, title: 'Clinical trial', trial: true, headings: ['Asthenopia'] }));
    expect(candidateTopics(records, ['eye strain'])).toEqual([]);
    expect(candidateTopics(records, ['eyestrain'])).toEqual([]);
    expect(candidateTopics(records, ['skin tone'])).toEqual([{ topic: 'Asthenopia', ids: ['1', '2', '3'] }]);
  });
  it('deduplicates by exact monthly marker even on closed issue bodies', () => {
    expect(alreadyReported([{ body: `closed ${watchMarker('2026-10')}` }], '2026-10')).toBe(true);
    expect(alreadyReported([{ body: watchMarker('2026-09') }], '2026-10')).toBe(false);
    expect(() => watchMarker('2026-99')).toThrow();
  });
  it('does not invent a prior efficacy baseline and emits an annual facts reminder separately', async () => {
    const report = await watch(new Date('2030-01-01T12:00Z'), async () => response('0'));
    expect(report.factsReviewDue).toBe(true);
    expect(report.hasFindings).toBe(true);
    expect(report.claims.every(claim => claim.count === 0)).toBe(true);
    expect(issueBody(report)).toContain('administrative reminder, not new efficacy evidence');
    expect(report.limitations).toContain('No prior completed evidence review');
  }, 10000);
});
