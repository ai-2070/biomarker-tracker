import { readFile } from 'node:fs/promises';
import type { WatchReport } from './watch';
import { issueBody } from './watch';

export function watchMarker(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid watcher month');
  return `<!-- astaxanthin-claim-watch:${month} -->`;
}
export function alreadyReported(issues: readonly { body?: string | null }[], month: string): boolean {
  return issues.some(issue => issue.body?.includes(watchMarker(month)));
}

// Separate opt-in developer CI command. watch.ts itself never contacts GitHub.
if (import.meta.main) {
  const report: WatchReport = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
  if (!report.hasFindings) process.exit(0);
  if (report.supplement !== 'astaxanthin') throw new Error('Only astaxanthin is supported');
  const marker = watchMarker(report.month);
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error('Developer GitHub CI credentials missing');
  const endpoint = `https://api.github.com/repos/${repository}/issues`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  for (let page = 1; ; page++) {
    const response = await fetch(`${endpoint}?state=all&per_page=100&page=${page}`, { headers });
    if (!response.ok) throw new Error(`GitHub issue lookup failed: ${response.status}`);
    const issues: { body?: string | null }[] = await response.json();
    if (!Array.isArray(issues)) throw new Error('Invalid GitHub issue response');
    if (alreadyReported(issues, report.month)) { console.log(`Already reported ${marker}`); process.exit(0); }
    if (issues.length < 100) break;
  }
  const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Astaxanthin metadata signals — ${report.month}`, body: issueBody(report) }) });
  if (!response.ok) throw new Error(`GitHub issue creation failed: ${response.status}`);
  console.log(`Created astaxanthin metadata issue for ${report.month}`);
}
