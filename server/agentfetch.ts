// Web requests an agent asks for (fetch_url). They may go anywhere on the web, but never back into the
// dashboard itself: its API answers any caller on this PC, so a fetched page could read settings and the
// bridge token. Every redirect hop is checked too, and names are resolved, so 127.1, [::1], 0.0.0.0 and
// a name pointing at this PC are all caught.
import dns from 'node:dns/promises';
import net from 'node:net';
import { PORT } from './util.ts';

const MAX_REDIRECTS = 10;

/** The eight 16-bit groups of an IPv6 address, or null when it isn't one. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  // a dotted IPv4 tail (::ffff:127.0.0.1) becomes two groups
  const tail = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(2).map(Number);
    s = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (x: string | undefined) => (x ? x.split(':') : []);
  const head = part(halves[0]);
  const rest = part(halves[1]);
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

/** An address that reaches this PC: loopback (127.x, ::1) or "any" (0.x, ::), also inside IPv6. */
export function isLocalAddress(ip: string): boolean {
  const kind = net.isIP(ip.replace(/^\[|\]$/g, ''));
  const bare = ip.replace(/^\[|\]$/g, '');
  if (kind === 4) {
    const first = Number(bare.split('.')[0]);
    return first === 127 || first === 0;
  }
  if (kind !== 6) return false;
  const g = v6Groups(bare);
  if (!g) return false;
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and the old IPv4-compatible form (::a.b.c.d)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const first = g[6] >> 8;
    return first === 127 || first === 0;
  }
  return false;
}

/** Whether a link points at this dashboard: an address of this PC, on the dashboard's port. */
export async function isDashboardUrl(u: URL): Promise<boolean> {
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (port !== PORT) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (net.isIP(host)) return isLocalAddress(host);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  try {
    const found = await dns.lookup(host, { all: true, verbatim: true });
    return found.some((a) => isLocalAddress(a.address));
  } catch {
    // (a name that doesn't resolve can't be fetched either)
    return false;
  }
}

/** GET a link for an agent, following redirects by hand so each one is checked. */
export async function agentFetch(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<{ res: Response; url: string }> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs.');
    if (await isDashboardUrl(u)) throw new Error("Agents can't fetch the dashboard's own pages.");
    const res = await fetch(u, { ...init, redirect: 'manual' });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) return { res, url: u.href };
    if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects.');
    // (the body of a redirect isn't wanted)
    await res.body?.cancel().catch(() => {});
    current = new URL(next, u).href;
  }
}
