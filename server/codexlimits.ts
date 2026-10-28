// Codex usage limits and free limit resets, read live from Codex itself (`codex app-server`, which signs in
// with your Codex login and talks only to OpenAI). Also uses one of those resets when you ask.
import crypto from 'node:crypto';
import { spawnCommand, killTree, dataPath, ensureDir } from './util.ts';
import { codexUsage } from './status.ts';
import type { LimitWindow, CodexResets, ProviderLimits, UsageMeter } from '../shared/types.ts';

/** What Codex's account/rateLimits/read answers (only the fields used here). */
interface RawWindow {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
}
interface RawCredit {
  id?: unknown;
  status?: unknown;
  expiresAt?: unknown;
  title?: unknown;
}
interface RawLimits {
  ordinaryUsageAllowed?: unknown;
  rateLimits?: { primary?: RawWindow | null; secondary?: RawWindow | null; planType?: unknown } | null;
  rateLimitResetCredits?: { availableCount?: unknown; credits?: RawCredit[] | null } | null;
}

export type CodexLimits = Omit<ProviderLimits, 'ready' | 'why'> & { resets: CodexResets | null };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'bigint' ? Number(v) : null);

/** A window's name from its length: "5h", "Week", "2d". */
export function windowLabel(mins: number | null, fallback: string): string {
  if (!mins) return fallback;
  if (mins === 10080) return 'Week';
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

/** Turns Codex's answer into the windows and resets the sidebar shows. Times come in seconds. */
export function parseCodexLimits(raw: unknown, now = Date.now()): CodexLimits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as RawLimits;
  const rl = r.rateLimits || {};
  const windows: LimitWindow[] = [];
  const add = (w: RawWindow | null | undefined, fallback: string) => {
    const pct = num(w?.usedPercent);
    if (!w || pct == null) return;
    const at = num(w.resetsAt);
    const resetsAt = at ? at * 1000 : null;
    // a window that has already reset starts again from nothing
    const over = resetsAt != null && resetsAt <= now;
    windows.push({ label: windowLabel(num(w.windowDurationMins), fallback), percent: over ? 0 : Math.max(0, Math.min(100, Math.round(pct))), resetsAt: over ? null : resetsAt });
  };
  add(rl.primary, 'Session');
  add(rl.secondary, 'Week');
  let resets: CodexResets | null = null;
  const rc = r.rateLimitResetCredits;
  if (rc) {
    const listed = rc.credits || [];
    const credits = listed
      .filter((c) => typeof c.id === 'string' && (c.status === 'available' || c.status == null))
      .map((c) => {
        const at = num(c.expiresAt);
        return { id: String(c.id), expiresAt: at ? at * 1000 : null, title: typeof c.title === 'string' ? c.title : null };
      })
      .filter((c) => c.expiresAt == null || c.expiresAt > now)
      // the one that runs out first comes first: that's the one to use
      .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
    // the list may be cut short, so the count wins; less the listed ones that are used or out of date
    const count = num(rc.availableCount) ?? credits.length;
    resets = { available: Math.max(credits.length, count - (listed.length - credits.length)), credits };
  }
  return { plan: typeof rl.planType === 'string' ? rl.planType : null, windows, resets, blocked: r.ordinaryUsageAllowed === false };
}

/** The Station's top bar meters (SESSION, WEEK) from the same limits the sidebar shows. */
export function headbarMeters(l: CodexLimits | null): UsageMeter[] {
  if (!l) return [];
  const week = l.windows.find((w) => w.label === 'Week');
  const session = l.windows.find((w) => w !== week);
  const meters: UsageMeter[] = [];
  if (session) meters.push({ label: 'SESSION', percent: session.percent, resetsAt: session.resetsAt });
  if (week) meters.push({ label: 'WEEK', percent: week.percent, resetsAt: week.resetsAt });
  return meters;
}

/** One request to a short-lived `codex app-server` (JSON lines over stdin/stdout). */
export function codexRequest<T = unknown>(method: string, params: unknown, timeout = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawnCommand>;
    try {
      child = spawnCommand('codex', ['app-server'], { cwd: ensureDir(dataPath('runtime')), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    let buf = '';
    let err = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree(child);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("Codex didn't answer in time."))), timeout);
    const send = (o: unknown) => child.stdin?.write(`${JSON.stringify(o)}\n`);
    child.on('error', (e) => finish(() => reject(e)));
    child.on('exit', () => finish(() => reject(new Error(`Codex stopped before it answered${err ? `: ${err.trim().slice(-300)}` : '.'}`))));
    child.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m: { id?: unknown; result?: unknown; error?: { message?: string } };
        try {
          m = JSON.parse(line) as typeof m;
        } catch {
          continue;
        }
        if (m.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method, params });
        } else if (m.id === 2) {
          const e = m.error;
          finish(() => (e ? reject(new Error(e.message || 'Codex refused.')) : resolve(m.result as T)));
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'blacksite', version: '1' } } });
  });
}

// Read at most once a minute; tabs asking at the same time share one read.
let cache: { at: number; value: CodexLimits | null; running: Promise<CodexLimits | null> | null } = { at: 0, value: null, running: null };
export async function codexLimits({ force = false } = {}): Promise<CodexLimits | null> {
  if (!force && Date.now() - cache.at < 60_000) return cache.value;
  if (cache.running) return cache.running;
  cache.running = (async () => {
    let value: CodexLimits | null;
    try {
      value = parseCodexLimits(await codexRequest('account/rateLimits/read', {}));
    } catch {
      // an older Codex without the app server: the numbers its last session wrote down (no resets)
      const u = codexUsage();
      const windows = [u?.session && { label: 'Session', ...u.session }, u?.week && { label: 'Week', ...u.week }].filter((w): w is LimitWindow => Boolean(w));
      value = windows.length ? { plan: null, windows, resets: null } : cache.value;
    }
    cache = { at: Date.now(), value, running: null };
    return value;
  })();
  try {
    return await cache.running;
  } finally {
    cache.running = null;
  }
}

export type ResetOutcome = 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed';

/** Uses one free limit reset: the given one, or the one that runs out first. */
export async function useCodexReset(creditId?: string | null): Promise<{ outcome: ResetOutcome; limits: CodexLimits | null }> {
  const r = await codexRequest<{ outcome?: unknown }>('account/rateLimitResetCredit/consume', { idempotencyKey: crypto.randomUUID(), creditId: creditId || null });
  const outcome = (['reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed'] as const).find((o) => o === r?.outcome);
  if (!outcome) throw new Error('Codex gave an answer this version of Blacksite does not know.');
  return { outcome, limits: await codexLimits({ force: true }) };
}
