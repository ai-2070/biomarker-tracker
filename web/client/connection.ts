// Where the dashboard's server is and how the page reaches it. Every address, request header and socket
// the page uses is built here, so reaching the server another way (a paired phone, later) is one change.

export interface Connection {
  /** The server's address, like 'http://127.0.0.1:4800'. Empty: the address the page came from. */
  base: string;
  /** Headers every request sends. */
  headers: Record<string, string>;
}

// x-dash: the server refuses changes without it (cross-site requests can't send it)
const DEFAULT: Connection = { base: '', headers: { 'x-dash': '1' } };
const conn: Connection = { base: DEFAULT.base, headers: { ...DEFAULT.headers } };

/** Changes where and how the page reaches its server. With no argument, back to the default. */
export function setConnection(next: Partial<Connection> = DEFAULT): void {
  if (next.base !== undefined) conn.base = next.base.replace(/\/+$/, '');
  if (next.headers) conn.headers = { ...next.headers };
}

/** The project the page shows: changes carry it, and the server refuses them once another project is open
 *  (a form loaded from one project can't be saved into the next). */
export function setPageProject(id: string | null | undefined): void {
  if (id) conn.headers['x-dash-project'] = id;
  else delete conn.headers['x-dash-project'];
}

/** A copy of the headers every request sends. */
export const requestHeaders = (): Record<string, string> => ({ ...conn.headers });

/** Query values; null and undefined are left out. */
export type Query = Record<string, string | number | boolean | null | undefined>;

// encodeURIComponent, not URLSearchParams: a space stays %20, as the code reading these back expects
const queryString = (query?: Query): string =>
  Object.entries(query || {})
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

/** The address of a path on the server ('/oauth/x/start'), with an optional query. */
export function serverUrl(path: string, query?: Query): string {
  const q = queryString(query);
  return `${conn.base}${path}${q ? (path.includes('?') ? '&' : '?') + q : ''}`;
}

/** An API address: apiUrl('/agents') is '/api/agents'. */
export const apiUrl = (path: string, query?: Query): string => serverUrl(`/api${path}`, query);

/** A file the server hands out (attachments, images, artifacts), for src and href. */
export const fileUrl = (path: string): string => apiUrl('/file', { path });

/** The ws:// (or wss://) address of a path on the server. */
export function socketUrl(path: string, query?: Query): string {
  const url = new URL(serverUrl(path, query), location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** A WebSocket to a path on the server: '/ws' for live events, '/ws/term' for a terminal. */
export const openSocket = (path: string, query?: Query): WebSocket => new WebSocket(socketUrl(path, query));
