// Top-bar status: your Claude plan usage and the connectors on your Claude account.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, run, which, dataPath, readJSON, writeJSON } from './util.ts';

/** One usage window (5-hour session or week): percent used and when it resets (ms), if known. */
export interface UsageWindow {
  percent: number;
  resetsAt: number | null;
}

export interface ClaudeUsage {
  session: UsageWindow | null;
  week: UsageWindow | null;
  at?: number;
}

export interface Connector {
  id: string;
  name: string;
  status: 'connected' | 'needs-auth' | 'failed' | 'off';
  detail: string;
}

export interface OpenRouterUsage {
  left: number | null;
  percent: number | null;
  today: number | null;
  week: number | null;
}

export interface CodexUsage {
  session: UsageWindow | null;
  week: UsageWindow | null;
}

// Usage of your Claude plan (5-hour session and weekly), as Claude Code shows it.
// Reads the Claude Code login token on this PC and sends it only to Anthropic.
// The last numbers are kept on disk, so a restart (or Anthropic rate-limiting us) doesn't blank the meters.
const USAGE_FILE = path.join(dataPath('runtime'), 'claude-usage.json');
const fresh = (v: ClaudeUsage | null): ClaudeUsage | null => {
  if (!v) return null;
  // a window that has already reset no longer tells us anything
  const ok = (x: UsageWindow | null) => (x && (!x.resetsAt || x.resetsAt > Date.now()) ? x : null);
  const out = { session: ok(v.session), week: ok(v.week), at: v.at };
  return out.session || out.week ? out : null;
};
let usageCache: { at: number; value: ClaudeUsage | null; next: number } = { at: 0, value: fresh(readJSON<ClaudeUsage>(USAGE_FILE, null)), next: 0 };
export async function claudeUsage(): Promise<ClaudeUsage | null> {
  if (Date.now() < usageCache.next) return fresh(usageCache.value);
  let value: ClaudeUsage | null = null;
  let wait = 120_000;
  try {
    const token = (JSON.parse(fs.readFileSync(path.join(HOME, '.claude', '.credentials.json'), 'utf8')) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken;
    if (token) {
      const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        type Raw = { utilization?: unknown; resets_at?: string | null } | null | undefined;
        const j = (await r.json()) as { five_hour?: Raw; seven_day?: Raw };
        const pick = (x: Raw): UsageWindow | null => (x && typeof x.utilization === 'number' ? { percent: Math.max(0, Math.min(100, Math.round(x.utilization))), resetsAt: x.resets_at ? Date.parse(x.resets_at) || null : null } : null);
        value = { session: pick(j.five_hour), week: pick(j.seven_day), at: Date.now() };
        writeJSON(USAGE_FILE, value);
      } else wait = r.status === 429 ? 90_000 : 30_000; // rate-limited (other apps read it too): try again soon
    }
  } catch {
    wait = 30_000;
  }
  // On a failed read keep showing the last numbers we had.
  usageCache = { at: Date.now(), value: value || usageCache.value, next: Date.now() + wait };
  return fresh(usageCache.value);
}

// The MCP connectors Claude Code agents get from your Claude account and config (`claude mcp list`).
let connCache: { at: number; value: Connector[]; running: Promise<Connector[]> | null } = { at: 0, value: [], running: null };
export async function claudeConnectors(): Promise<Connector[]> {
  if (Date.now() - connCache.at < 5 * 60_000) return connCache.value;
  if (connCache.running) return connCache.running;
  connCache.running = (async () => {
    if (!which('claude')) return [];
    const r = await run('claude', ['mcp', 'list'], { timeout: 90_000 });
    const out: Connector[] = [];
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = /^(.+?):\s+(.*?)\s+-\s+(.+)$/.exec(line.trim());
      if (!m) continue;
      const raw = m[1].trim();
      const st = m[3];
      const status = /connected/i.test(st) ? 'connected' : /auth/i.test(st) ? 'needs-auth' : /not configured/i.test(st) ? 'off' : 'failed';
      const name = raw.replace(/^claude\.ai\s+/i, '').replace(/^plugin:[^:]+:/i, '').trim();
      out.push({ id: raw, name, status, detail: st.replace(/^[^\w]+/, '') });
    }
    // One entry per service: the best status wins (e.g. Gmail connected via claude.ai beats a failed plugin copy).
    const rank: Record<Connector['status'], number> = { connected: 3, 'needs-auth': 2, failed: 1, off: 0 };
    const best = new Map<string, Connector>();
    for (const c of out) {
      const k = c.name.toLowerCase();
      if (!best.has(k) || rank[c.status] > rank[best.get(k)!.status]) best.set(k, c);
    }
    connCache = { at: Date.now(), value: [...best.values()], running: null };
    return connCache.value;
  })();
  try {
    return await connCache.running;
  } finally {
    connCache.running = null;
  }
}

// OpenRouter: credits left and what you spent today (your key, sent only to OpenRouter).
type ORCredits = { data?: { total_credits?: number; total_usage?: number } };
type ORKey = { data?: { usage_daily?: number; usage_weekly?: number; usage?: number; limit?: number | null } };
let orCache: { at: number; value: OpenRouterUsage | null } = { at: 0, value: null };
export async function openrouterUsage(key: string | null | undefined): Promise<OpenRouterUsage | null> {
  if (!key) return null;
  if (Date.now() - orCache.at < 60_000) return orCache.value;
  let value = orCache.value;
  try {
    const H = { authorization: `Bearer ${key}` };
    const [credits, k] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/credits', { headers: H, signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? (r.json() as Promise<ORCredits>) : null)).catch(() => null),
      fetch('https://openrouter.ai/api/v1/key', { headers: H, signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? (r.json() as Promise<ORKey>) : null)).catch(() => null),
    ]);
    const total = credits?.data?.total_credits;
    const used = credits?.data?.total_usage;
    const today = k?.data?.usage_daily;
    const limit = k?.data?.limit;
    if (typeof total === 'number' || typeof today === 'number') {
      value = {
        left: typeof total === 'number' ? Math.max(0, total - (used || 0)) : null,
        percent: typeof total === 'number' && total > 0 ? Math.min(100, Math.round(((used || 0) / total) * 100)) : limit ? Math.min(100, Math.round(((k?.data?.usage || 0) / limit) * 100)) : null,
        today: typeof today === 'number' ? today : null,
        week: typeof k?.data?.usage_weekly === 'number' ? k.data.usage_weekly : null,
      };
    }
  } catch {
    /* keep the last numbers */
  }
  orCache = { at: Date.now(), value };
  return value;
}

// Codex: the 5-hour and weekly limits, from the newest session log Codex writes on this PC.
type CodexWindow = { used_percent?: unknown; resets_at?: number; resets_in_seconds?: number } | null | undefined;
type CodexLimits = { primary?: CodexWindow; secondary?: CodexWindow };
// One logged window (loggedAt = when the log was written). A window that has already reset is dropped.
export function codexWindow(x: CodexWindow, loggedAt: number, now = Date.now()): UsageWindow | null {
  if (!x || typeof x.used_percent !== 'number') return null;
  const resetsAt = x.resets_at ? (x.resets_at > 1e12 ? x.resets_at : x.resets_at * 1000) : x.resets_in_seconds ? loggedAt + x.resets_in_seconds * 1000 : null;
  if (resetsAt && resetsAt <= now) return null;
  return { percent: Math.round(x.used_percent), resetsAt };
}
let cxCache: { at: number; value: CodexUsage | null } = { at: 0, value: null };
export function codexUsage(): CodexUsage | null {
  if (Date.now() - cxCache.at < 60_000) return cxCache.value;
  let value: CodexUsage | null = null;
  try {
    const root = path.join(HOME, '.codex', 'sessions');
    let newest = null as { full: string; t: number } | null;
    const walk = (dir: string, depth: number) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth < 4) walk(full, depth + 1);
        else if (e.isFile() && e.name.endsWith('.jsonl')) {
          const t = fs.statSync(full).mtimeMs;
          if (!newest || t > newest.t) newest = { full, t };
        }
      }
    };
    if (fs.existsSync(root)) walk(root, 0);
    if (newest) {
      const lines = fs.readFileSync(newest.full, 'utf8').trim().split('\n').reverse();
      for (const l of lines.slice(0, 400)) {
        if (!l.includes('rate_limits')) continue;
        const j = JSON.parse(l) as { payload?: { rate_limits?: CodexLimits }; rate_limits?: CodexLimits; msg?: { rate_limits?: CodexLimits } };
        const rl = j.payload?.rate_limits || j.rate_limits || j.msg?.rate_limits;
        if (!rl) continue;
        const session = codexWindow(rl.primary, newest.t);
        const week = codexWindow(rl.secondary, newest.t);
        value = session || week ? { session, week } : null;
        break;
      }
    }
  } catch {
    /* no logs */
  }
  cxCache = { at: Date.now(), value };
  return value;
}
