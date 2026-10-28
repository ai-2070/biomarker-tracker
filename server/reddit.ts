// Reddit: sign in with your own Reddit app (OAuth, permanent token in ./data), read and search,
// and post or comment through the Outbox (you approve first).
import crypto from 'node:crypto';
import { dataPath, readJSON, writeJSON, fetchJSON } from './util.ts';
import { getSettings, getSecrets, emit, log } from './store.ts';
import type { FetchError } from './util.ts';
import type { OutboxPost, RedditAccount } from '../shared/types.ts';
import type { AccountsFile, OAuthQuery, OutboxItem } from './social.ts';

/** A connected Reddit account as accounts.json stores it (tokens never leave the server). */
export type StoredRedditAccount = Omit<RedditAccount, 'autopost'> & {
  autopost?: boolean;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

// ---------- Reddit API answers (only the fields used here) ----------
interface RedditToken {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  error?: string;
}
interface RedditMe {
  id: string;
  name: string;
  icon_img?: string;
}
interface RedditPost {
  name: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  num_comments: number;
  permalink: string;
  selftext?: string;
  created_utc: number;
}
interface RedditComment {
  name: string;
  author: string;
  score: number;
  body?: string;
}
interface Listing<T> {
  kind?: string;
  data?: { children?: { kind: string; data: T }[] };
}
interface RedditSubmitAnswer {
  json?: {
    errors?: string[][];
    data?: { things?: { data: { name?: string; permalink?: string } }[]; name?: string; url?: string };
  };
}

/** A post as the read tools return it. */
export interface RedditBrief {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  comments: number;
  url: string;
  text: string;
  created: string;
}

export interface RedditCommentBrief {
  id: string;
  author: string;
  score: number;
  text: string;
}

const ACCOUNTS_FILE = dataPath('accounts.json');
const SCOPES = 'identity submit read history mysubreddits';
const load = () => readJSON<AccountsFile>(ACCOUNTS_FILE, { x: {} });
const save = (a: AccountsFile) => writeJSON(ACCOUNTS_FILE, a);

const userAgent = (username = '') => `windows:blacksite:0.1.0 (by /u/${username || getSettings().reddit?.username || 'blacksite'})`;

export function redditAccounts(): RedditAccount[] {
  return Object.values(load().reddit || {}).map(({ id, username, autopost, connectedAt, icon }) => ({ id, username, autopost: !!autopost, connectedAt, icon }));
}

export const redditAppConfigured = () => !!(getSettings().reddit?.clientId && getSecrets().redditClientSecret);

const pending = new Map<string, { redirectUri: string; at: number }>();
export function redditAuthStart(baseUrl: string): string {
  const clientId = getSettings().reddit?.clientId;
  if (!clientId) throw new Error('Add your Reddit app Client ID in Connections first.');
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${baseUrl}/oauth/reddit/callback`;
  pending.set(state, { redirectUri, at: Date.now() });
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', state, redirect_uri: redirectUri, duration: 'permanent', scope: SCOPES });
  return `https://www.reddit.com/api/v1/authorize?${q}`;
}

function basic() {
  const id = getSettings().reddit?.clientId;
  const secret = getSecrets().redditClientSecret || '';
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

export async function redditAuthCallback({ code, state, error }: OAuthQuery): Promise<StoredRedditAccount> {
  if (error) throw new Error(`Reddit said: ${error}`);
  const p = pending.get(String(state));
  if (!p) throw new Error('This sign-in link expired. Start again from Connections.');
  pending.delete(String(state));
  const tok = await fetchJSON<RedditToken>('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': userAgent() },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: String(code), redirect_uri: p.redirectUri }),
  });
  if (tok.error) throw new Error(`Reddit said: ${tok.error}`);
  const me = await fetchJSON<RedditMe>('https://oauth.reddit.com/api/v1/me', { headers: { authorization: `Bearer ${tok.access_token}`, 'user-agent': userAgent() } });
  const a = load();
  a.reddit ||= {};
  a.reddit[me.id] = {
    ...(a.reddit[me.id] || {}),
    id: me.id,
    username: me.name,
    icon: (me.icon_img || '').split('?')[0],
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
    connectedAt: a.reddit[me.id]?.connectedAt || Date.now(),
  };
  save(a);
  log('social', `Connected Reddit account u/${me.name}`);
  emit('accounts');
  return a.reddit[me.id];
}

const refreshing = new Map<string, Promise<string>>();
async function token(accountId: string): Promise<string> {
  const acc = load().reddit?.[accountId];
  if (!acc) throw new Error('That Reddit account is not connected.');
  if (acc.expiresAt - Date.now() > 60_000) return acc.accessToken;
  if (refreshing.has(accountId)) return refreshing.get(accountId)!;
  const job = (async () => {
    const tok = await fetchJSON<RedditToken>('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': userAgent(acc.username) },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: acc.refreshToken }),
    }).catch((e: FetchError) => {
      throw new Error(`Couldn't refresh u/${acc.username}'s sign-in (${e.message}). Reconnect it in Connections.`);
    });
    const a = load();
    Object.assign(a.reddit![accountId], { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 });
    save(a);
    return tok.access_token;
  })();
  refreshing.set(accountId, job);
  try {
    return await job;
  } finally {
    refreshing.delete(accountId);
  }
}

export function resolveRedditAccount(handle?: string): StoredRedditAccount {
  const list = Object.values(load().reddit || {});
  if (!list.length) throw new Error('No Reddit account is connected yet. Connect one in Settings > Connections.');
  if (!handle) return list[0];
  const h = String(handle).replace(/^\/?u\//, '').toLowerCase();
  const acc = list.find((x) => x.username.toLowerCase() === h || x.id === handle);
  if (!acc) throw new Error(`u/${h} is not connected. Connected: ${list.map((x) => 'u/' + x.username).join(', ')}`);
  return acc;
}

async function api<T>(accountId: string, method: string, path: string, form?: Record<string, string | undefined>): Promise<T> {
  const acc = load().reddit![accountId];
  const t = await token(accountId);
  return fetchJSON<T>(`https://oauth.reddit.com${path}`, {
    method,
    headers: { authorization: `Bearer ${t}`, 'user-agent': userAgent(acc.username), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form as Record<string, string>) : undefined, // a missing value is sent as "undefined", as before
  });
}

// Reading works signed in (better limits) or through Reddit's public JSON.
async function read<T>(path: string): Promise<T> {
  const acc = Object.values(load().reddit || {})[0];
  if (acc) return api<T>(acc.id, 'GET', path);
  const [p, q] = path.split('?');
  return fetchJSON<T>(`https://www.reddit.com${p}.json${q ? `?${q}` : ''}`, { headers: { 'user-agent': userAgent() } });
}

const brief = (p: RedditPost): RedditBrief => ({ id: p.name, title: p.title, subreddit: p.subreddit, author: p.author, score: p.score, comments: p.num_comments, url: `https://www.reddit.com${p.permalink}`, text: String(p.selftext || '').slice(0, 600), created: new Date(p.created_utc * 1000).toISOString() });

export async function readSubreddit(subreddit: string, sort = 'hot', limit = 10): Promise<RedditBrief[]> {
  const sr = String(subreddit || '').replace(/^\/?r\//, '');
  if (!/^\w{2,21}$/.test(sr)) throw new Error('Which subreddit? e.g. "LocalLLaMA"');
  const s = ['hot', 'new', 'top', 'rising'].includes(sort) ? sort : 'hot';
  const j = await read<Listing<RedditPost>>(`/r/${sr}/${s}?limit=${Math.min(25, Math.max(1, limit))}${s === 'top' ? '&t=week' : ''}`);
  return (j.data?.children || []).map((c) => brief(c.data));
}

export async function searchReddit(query: string, subreddit = '', limit = 10): Promise<RedditBrief[]> {
  const sr = String(subreddit || '').replace(/^\/?r\//, '');
  const q = new URLSearchParams({ q: query, limit: String(Math.min(25, limit)), sort: 'relevance', t: 'month', ...(sr ? { restrict_sr: '1' } : {}) });
  const j = await read<Listing<RedditPost>>(`${sr ? `/r/${sr}` : ''}/search?${q}`);
  return (j.data?.children || []).map((c) => brief(c.data));
}

// A post's id from a permalink (/comments/<id>), a redd.it short link, "t3_<id>" or the bare id.
export function postId(post: unknown): string {
  const s = String(post || '').trim();
  const id = /comments\/(\w+)/.exec(s)?.[1] || /redd\.it\/(\w+)/.exec(s)?.[1] || s.replace(/^t3_/, '');
  if (!/^[a-z0-9]+$/i.test(id)) throw new Error('Which post? Give its link or id, e.g. https://redd.it/abc123');
  return id;
}

export async function postComments(post: string, limit = 15): Promise<{ post: RedditBrief | null; comments: RedditCommentBrief[] }> {
  const id = postId(post);
  const j = await read<[Listing<RedditPost>, Listing<RedditComment>]>(`/comments/${id}?limit=${limit}&depth=2`);
  const top = j?.[0]?.data?.children?.[0]?.data;
  const comments = (j?.[1]?.data?.children || []).filter((c) => c.kind === 't1').map((c) => ({ id: c.data.name, author: c.data.author, score: c.data.score, text: String(c.data.body || '').slice(0, 500) }));
  return { post: top ? brief(top) : null, comments };
}

// Publishing (only from the Outbox, after you approve).
export async function publish(item: Pick<OutboxItem, 'accountId' | 'parts' | 'reddit'>): Promise<{ id: string | undefined; url: string | null | undefined }> {
  const r: Partial<NonNullable<OutboxPost['reddit']>> = item.reddit || {};
  if (r.kind === 'comment') {
    const res = await api<RedditSubmitAnswer>(String(item.accountId), 'POST', '/api/comment', { thing_id: r.parent, text: item.parts.join('\n\n'), api_type: 'json' });
    const errs = res.json?.errors || [];
    if (errs.length) throw new Error(errs.map((e) => e.join(' ')).join('; '));
    const c = res.json?.data?.things?.[0]?.data;
    return { id: c?.name, url: c?.permalink ? `https://www.reddit.com${c.permalink}` : null };
  }
  const form = { sr: r.subreddit, title: r.title, api_type: 'json', kind: r.link ? 'link' : 'self', ...(r.link ? { url: r.link } : { text: item.parts.join('\n\n') }) };
  const res = await api<RedditSubmitAnswer>(String(item.accountId), 'POST', '/api/submit', form);
  const errs = res.json?.errors || [];
  if (errs.length) throw new Error(errs.map((e) => e.join(' ')).join('; '));
  return { id: res.json?.data?.name, url: res.json?.data?.url };
}

export function setRedditAutopost(id: string, on: unknown) {
  const a = load();
  if (!a.reddit?.[id]) throw new Error('Unknown account');
  a.reddit[id].autopost = !!on;
  save(a);
  emit('accounts');
}

export function disconnectReddit(id: string) {
  const a = load();
  const acc = a.reddit?.[id];
  delete a.reddit?.[id];
  save(a);
  if (acc) log('social', `Disconnected u/${acc.username}`);
  emit('accounts');
}
