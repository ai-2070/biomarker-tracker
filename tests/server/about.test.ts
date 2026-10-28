// GET /api/about: the version from package.json and the GitHub repo; stars only when asked for, cached an hour.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aboutInfo, resetAboutCache } from '../../server/about.ts';
import { REPO } from '../../shared/about.ts';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string; license: string };
const github = vi.fn();

beforeEach(() => {
  resetAboutCache();
  github.mockReset();
  vi.stubGlobal('fetch', github);
});
afterEach(() => vi.unstubAllGlobals());

describe('about', () => {
  it("gives the version and licence from package.json and the repo, without asking GitHub", async () => {
    const a = await aboutInfo();
    expect(a).toEqual({ name: 'Blacksite', version: pkg.version, repo: REPO.slug, url: REPO.url, license: pkg.license, stars: null });
    expect(github).not.toHaveBeenCalled();
  });

  it('asks GitHub for the stars when asked, once an hour', async () => {
    github.mockResolvedValue(new Response(JSON.stringify({ stargazers_count: 42 }), { status: 200 }));
    expect((await aboutInfo({ withStars: true })).stars).toBe(42);
    expect((await aboutInfo({ withStars: true })).stars).toBe(42);
    expect(github).toHaveBeenCalledTimes(1);
    expect(String(github.mock.calls[0][0])).toBe(`https://api.github.com/repos/${REPO.slug}`);
  });

  it('has no count when GitHub says no (a private repo) or is out of reach, and does not ask again at once', async () => {
    github.mockResolvedValue(new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }));
    expect((await aboutInfo({ withStars: true })).stars).toBeNull();
    github.mockRejectedValue(new Error('offline'));
    expect((await aboutInfo({ withStars: true })).stars).toBeNull();
    expect(github).toHaveBeenCalledTimes(1);
  });
});
