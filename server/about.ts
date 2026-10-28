// Which Blacksite this is (the version in package.json) and its GitHub stars.
// Stars are only fetched when asked for (Settings > About), at most once an hour.
import path from 'node:path';
import { ROOT, readJSON, fetchJSON } from './util.ts';
import { REPO } from '../shared/about.ts';
import type { AboutInfo } from '../shared/types.ts';

const pkg = readJSON<{ version?: string; license?: string }>(path.join(ROOT, 'package.json'), {});
const HOUR = 60 * 60_000;
let starCache: { at: number; n: number | null } | null = null;

async function stars(): Promise<number | null> {
  if (starCache && Date.now() - starCache.at < HOUR) return starCache.n;
  let n: number | null = null;
  try {
    const r = await fetchJSON<{ stargazers_count?: unknown }>(`https://api.github.com/repos/${REPO.slug}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Blacksite' }, timeout: 5000 });
    n = typeof r.stargazers_count === 'number' ? r.stargazers_count : null;
  } catch {
    // offline, rate-limited, or a private repo (404 without a login): no count, and don't ask again for an hour
  }
  starCache = { at: Date.now(), n };
  return n;
}

export async function aboutInfo({ withStars = false }: { withStars?: boolean } = {}): Promise<AboutInfo> {
  return { name: REPO.name, version: pkg.version || '0.0.0', repo: REPO.slug, url: REPO.url, license: pkg.license || '', stars: withStars ? await stars() : null };
}

/** For tests: forget the cached star count. */
export const resetAboutCache = (): void => void (starCache = null);
