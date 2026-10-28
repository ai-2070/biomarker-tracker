// The page's one way to the server: addresses, headers, errors, uploads and sockets.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, fileUrl, requestHeaders, serverUrl, setConnection, setPageProject, socketUrl } from '../../web/client/connection.ts';
import { api, fetchFile, serverFetch, upload } from '../../web/client/http.ts';
import { dashFetch } from '../../web/chat/transport.ts';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const answer = (body: unknown, status = 200) => vi.fn(async (url: string, init: RequestInit = {}) => {
  calls.push({ url, init });
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Nope' });
});
const headersOf = (c: Call) => Object.fromEntries(new Headers(c.init.headers).entries());

beforeEach(() => {
  calls = [];
  setConnection();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setConnection();
});

describe("the page's project", () => {
  it('goes with every request once known, and goes away when cleared', () => {
    expect(requestHeaders()['x-dash-project']).toBeUndefined();
    setPageProject('proj-a');
    expect(requestHeaders()).toMatchObject({ 'x-dash': '1', 'x-dash-project': 'proj-a' });
    setPageProject(null);
    expect(requestHeaders()['x-dash-project']).toBeUndefined();
  });
});

describe('addresses', () => {
  it('are on the page\'s own server by default', () => {
    expect(apiUrl('/agents')).toBe('/api/agents');
    expect(serverUrl('/oauth/x/start')).toBe('/oauth/x/start');
  });

  it('encode a query the way the server and readers expect (a space is %20), leaving out null', () => {
    expect(fileUrl('C:\\My files\\a b.png')).toBe('/api/file?path=C%3A%5CMy%20files%5Ca%20b.png');
    expect(apiUrl('/backups/restore', { name: 'x&y', folder: null, file: undefined, v: 3 })).toBe('/api/backups/restore?name=x%26y&v=3');
    expect(apiUrl('/search?q=1', { page: 2 })).toBe('/api/search?q=1&page=2');
  });

  it('go to another server when the connection says so', () => {
    setConnection({ base: 'http://127.0.0.1:4900/' });
    expect(apiUrl('/state')).toBe('http://127.0.0.1:4900/api/state');
    expect(socketUrl('/ws/term', { id: 't 1' })).toBe('ws://127.0.0.1:4900/ws/term?id=t%201');
    setConnection({ base: 'https://box.example' });
    expect(socketUrl('/ws')).toBe('wss://box.example/ws');
  });

  it('sockets follow the page when there is no base', () => {
    expect(socketUrl('/ws')).toBe(`ws://${location.host}/ws`);
  });
});

describe('api()', () => {
  it('sends the dashboard header and JSON, and reads JSON back', async () => {
    vi.stubGlobal('fetch', answer({ id: 'a1' }));
    expect(await api('/agents', { method: 'POST', body: { name: 'Ada' } })).toEqual({ id: 'a1' });
    expect(calls[0].url).toBe('/api/agents');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{"name":"Ada"}');
    expect(headersOf(calls[0])).toEqual({ 'x-dash': '1', 'content-type': 'application/json' });
  });

  it('sends a file as it is, with its query', async () => {
    vi.stubGlobal('fetch', answer({ ok: true }));
    const file = new Blob(['zip']);
    await api('/backups/restore', { method: 'POST', raw: file, query: { name: 'New' } });
    expect(calls[0].url).toBe('/api/backups/restore?name=New');
    expect(calls[0].init.body).toBe(file);
    expect(headersOf(calls[0])['content-type']).toBe('application/octet-stream');
  });

  it("throws the server's own message, or the status when there is none", async () => {
    vi.stubGlobal('fetch', answer({ error: 'Unknown agent' }, 404));
    await expect(api('/agents/x')).rejects.toThrow('Unknown agent');
    vi.stubGlobal('fetch', answer('', 500));
    await expect(api('/agents/x')).rejects.toThrow('500 Nope');
  });

  it('sends the headers the connection has (a paired device adds its own)', async () => {
    vi.stubGlobal('fetch', answer({}));
    setConnection({ headers: { 'x-dash': '1', 'x-device': 'phone-1' } });
    await api('/state');
    expect(headersOf(calls[0])).toEqual({ 'x-dash': '1', 'x-device': 'phone-1' });
    expect(requestHeaders()).toEqual({ 'x-dash': '1', 'x-device': 'phone-1' });
  });
});

describe('serverFetch() and the chat transport', () => {
  it('adds the dashboard header to what the caller sends', async () => {
    vi.stubGlobal('fetch', answer({}));
    await serverFetch('/api/brain/stream', { method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(headersOf(calls[0])).toEqual({ 'x-dash': '1', 'content-type': 'application/json' });
  });

  it("turns a refusal into just the server's message for the AI SDK", async () => {
    vi.stubGlobal('fetch', answer({ error: 'This chat is already working on something.' }, 409));
    const res = await dashFetch('/api/agents/a/chats/c/stream', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('This chat is already working on something.');
    expect(headersOf(calls[0])['x-dash']).toBe('1');
  });
});

describe('fetchFile()', () => {
  it('hands back the answer, or throws its status', async () => {
    vi.stubGlobal('fetch', answer('model'));
    expect(await (await fetchFile(fileUrl('/m.glb'))).text()).toBe('model');
    vi.stubGlobal('fetch', answer('', 404));
    await expect(fetchFile(fileUrl('/gone.glb'))).rejects.toThrow('404');
  });
});

describe('upload()', () => {
  class FakeXHR {
    static last: FakeXHR;
    upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = '';
    url = '';
    headers: Record<string, string> = {};
    body: unknown;
    open(_m: string, url: string) {
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send(body: unknown) {
      this.body = body;
      FakeXHR.last = this;
    }
    abort() {
      this.onabort?.();
    }
    finish(status: number, body: unknown) {
      this.status = status;
      this.responseText = JSON.stringify(body);
      this.onload?.();
    }
  }
  beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXHR));

  it('posts the file raw, reports progress and reads the answer', async () => {
    const seen: number[] = [];
    const file = new Blob(['abc']);
    const done = upload('/uploads/b1', file, { query: { path: 'a b.txt' }, onProgress: (n) => seen.push(n) });
    const xhr = FakeXHR.last;
    expect(xhr.url).toBe('/api/uploads/b1?path=a%20b.txt');
    expect(xhr.headers).toEqual({ 'x-dash': '1', 'content-type': 'application/octet-stream' });
    expect(xhr.body).toBe(file);
    xhr.upload.onprogress!({ loaded: 2 });
    xhr.finish(200, { path: '/up/a b.txt' });
    expect(await done).toEqual({ path: '/up/a b.txt' });
    expect(seen).toEqual([2]);
  });

  it("fails with the server's message", async () => {
    const done = upload('/uploads/b1', new Blob(['x']));
    FakeXHR.last.finish(500, { error: 'disk full' });
    await expect(done).rejects.toThrow('disk full');
  });

  it('stops when its signal is aborted, even before it starts', async () => {
    const stop = new AbortController();
    const done = upload('/uploads/b1', new Blob(['x']), { signal: stop.signal });
    stop.abort();
    await expect(done).rejects.toThrow('Cancelled');
    await expect(upload('/uploads/b1', new Blob(['x']), { signal: stop.signal })).rejects.toThrow('Cancelled');
  });
});
