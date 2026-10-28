// The real server under Bun, on a spare port, with throwaway data and home folders:
// the API works and the local-only security checks hold.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..', '..');
// set in beforeAll: a port nothing else is using (see startServer)
let port = 0;
let base = '';
let proc: ChildProcess;
let tmp: string;

const req = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) => fetch(base + p, init);
const json = { 'content-type': 'application/json', 'x-dash': '1' };

// A port the system says is free right now.
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });

// Start our own server and wait until it answers. Another dashboard (another test run, another checkout)
// may grab the port first: then ours exits and the one answering isn't ours (other data folder), so try again.
// (all attempts together stay within START_MS, well under beforeAll's timeout)
const START_MS = 45_000;
async function startServer(home: string): Promise<void> {
  const deadline = Date.now() + START_MS;
  for (let attempt = 0; attempt < 5 && Date.now() < deadline; attempt++) {
    port = await freePort();
    base = `http://localhost:${port}`;
    const child = spawn('bun', ['server/index.ts', '--port', String(port), '--no-open'], {
      cwd: root,
      env: { ...process.env, DASH_DATA: path.join(tmp, 'data'), HOME: home, USERPROFILE: home },
      stdio: 'ignore',
    });
    proc = child;
    let exited = false;
    child.once('exit', () => (exited = true));
    for (let i = 0; i < 100 && !exited && Date.now() < deadline; i++) {
      try {
        const r = await req('/api/state');
        if (r.ok && String(((await r.json()) as { dataDir?: string }).dataDir || '').startsWith(tmp)) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    child.kill();
  }
  throw new Error('the server did not start');
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-api-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  await startServer(home);
}, 60_000);

afterAll(() => {
  proc?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('API', () => {
  it('serves the state the page needs', async () => {
    const st = await (await req('/api/state')).json();
    expect(st.project.name).toBe('My workspace');
    expect(st.agents).toEqual([]);
    expect(st.port).toBe(port);
    expect(st.dataDir.startsWith(tmp)).toBe(true);
  });

  it("refuses a change made for a project that is no longer open (finding 19)", async () => {
    const st = await (await req('/api/state')).json();
    const stale = await req('/api/agents', { method: 'POST', headers: { ...json, 'x-dash-project': 'another-project' }, body: JSON.stringify({ name: 'Stale' }) });
    expect(stale.status).toBe(409);
    const agents = await (await req('/api/agents')).json();
    expect(agents.some((a: { name: string }) => a.name === 'Stale')).toBe(false);
    const fresh = await req('/api/agents', { method: 'POST', headers: { ...json, 'x-dash-project': st.project.id }, body: JSON.stringify({ name: 'Fresh' }) });
    expect(fresh.status).toBe(200);
    await req(`/api/agents/${(await fresh.json()).id}`, { method: 'DELETE', headers: json });
  });

  it('creates an agent and a team', async () => {
    const a = await (await req('/api/agents', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Tester' }) })).json();
    expect(a.id).toMatch(/^tester-/);
    const t = await (await req('/api/workflows', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Crew', members: [a.id], lead: a.id }) })).json();
    const list = await (await req('/api/workflows')).json();
    expect(list.find((x: { id: string }) => x.id === t.id)).toMatchObject({ name: 'Crew', members: [a.id] });
  });

  it("keeps a team's emoji symbol, and a picture or model only through its own route", async () => {
    const send = async (method: string, p: string, body?: unknown) => req(p, { method, headers: json, ...(body ? { body: JSON.stringify(body) } : {}) });
    const a = await (await send('POST', '/api/agents', { name: 'Symbol Tester' })).json();
    const t = await (await send('POST', '/api/workflows', { name: 'Symbols', members: [a.id], lead: a.id, mark: '🎬' })).json();
    expect(t.mark).toBe('🎬');
    // anything that is not an emoji falls back to the default (empty)
    expect((await (await send('PUT', `/api/workflows/${t.id}`, { mark: '@' })).json()).mark).toBe('');
    // saving a team cannot make it point at a file: markFile only comes from the picture/model route
    const spoof = await (await send('PUT', `/api/workflows/${t.id}`, { markFile: { kind: 'image', ext: 'png', at: 1 } })).json();
    expect(spoof.markFile ?? null).toBeNull();
    expect((await send('GET', `/api/workflows/${t.id}/mark`)).status).toBe(404);
    // a real picture goes in, comes back out, and saving the team afterwards keeps it
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const saved = await (await send('POST', `/api/workflows/${t.id}/mark`, { name: 'badge.png', data: png })).json();
    expect(saved.markFile).toMatchObject({ kind: 'image', ext: 'png' });
    expect((await send('GET', `/api/workflows/${t.id}/mark`)).headers.get('content-type')).toBe('image/png');
    expect((await (await send('PUT', `/api/workflows/${t.id}`, { description: 'x' })).json()).markFile).toMatchObject({ kind: 'image' });
    expect((await send('POST', `/api/workflows/${t.id}/mark`, { name: 'bad.png', data: 'data:image/png;base64,AAAA' })).status).toBeGreaterThanOrEqual(400);
    expect((await (await send('DELETE', `/api/workflows/${t.id}/mark`)).json()).markFile).toBeNull();
    expect((await send('GET', `/api/workflows/${t.id}/mark`)).status).toBe(404);
  });

  it('makes and edits a routine that mentions an agent and a team', async () => {
    // its own agent and team, so this test runs on its own too
    const post = async (p: string, body: unknown) => (await req(p, { method: 'POST', headers: json, body: JSON.stringify(body) })).json();
    const a = await post('/api/agents', { name: 'Routine Tester' });
    await post('/api/workflows', { name: 'Routine Crew', members: [a.id], lead: a.id });
    const r = await (await req('/api/routines', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Daily' }) })).json();
    // nobody mentioned yet: running it is a clear 400, not a server fault
    expect((await req(`/api/routines/${r.id}/run`, { method: 'POST', headers: json, body: '{}' })).status).toBe(400);
    const saved = await (await req(`/api/routines/${r.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ text: 'Have @Routine Tester and @Routine Crew check in.' }) })).json();
    expect(saved.mentions.map((m: { kind: string; name: string }) => `${m.kind}:${m.name}`)).toEqual(['agent:Routine Tester', 'team:Routine Crew']);
    const list = await (await req('/api/routines')).json();
    expect(list.find((x: { id: string }) => x.id === r.id)).toMatchObject({ name: 'Daily', lastRun: null });
    expect((await req('/api/routines/nope')).status).toBe(404);
    expect((await req(`/api/routines/${r.id}`, { method: 'DELETE', headers: json })).status).toBe(200);
  });

  it('never sends secrets to the browser', async () => {
    await req('/api/secrets', { method: 'POST', headers: json, body: JSON.stringify({ key: 'openrouterKey', value: 'sk-or-v1-supersecretvalue9999' }) });
    const text = await (await req('/api/state')).text();
    expect(text).not.toContain('supersecretvalue');
    expect(JSON.parse(text).secrets.openrouterKey).toEqual({ set: true, hint: '…9999' });
  });

  it('answers 404 for unknown routes and 400 for bad bodies', async () => {
    expect((await req('/api/nope')).status).toBe(404);
    expect((await req('/api/agents', { method: 'POST', headers: json, body: '{oops' })).status).toBe(400);
    expect((await req('/api/agents', { method: 'POST', headers: json, body: 'null' })).status).toBe(400);
  });
});

describe('backups', () => {
  it('backs up a project into the home folder and restores it from an upload or from the backups folder', async () => {
    const st = await (await req('/api/state')).json();
    const made = await (await req(`/api/projects/${st.project.id}/backup`, { method: 'POST', headers: json })).json();
    expect(made.file.startsWith(path.join(tmp, 'home', 'Blacksite Backups'))).toBe(true);
    const list = await (await req('/api/backups')).json();
    expect(list.backups.map((b: { name: string }) => b.name)).toContain(made.name);

    const bytes = fs.readFileSync(made.file);
    // the file as the body: bigger than a JSON body may be is fine too, but it needs the x-dash header
    expect((await req('/api/backups/restore', { method: 'POST', body: bytes })).status).toBe(403);
    const up = await req('/api/backups/restore?name=From%20upload', { method: 'POST', headers: { 'x-dash': '1', 'content-type': 'application/octet-stream' }, body: bytes });
    expect(up.status).toBe(200);
    const p1 = await up.json();
    expect(p1).toMatchObject({ name: 'From upload', restored: { agents: made.summary.agents, teams: made.summary.teams } });

    const p2 = await (await req(`/api/backups/restore?file=${encodeURIComponent(made.name)}&name=From%20folder`, { method: 'POST', headers: { 'x-dash': '1' } })).json();
    expect(p2.name).toBe('From folder');
    expect(p2.brainPath).not.toBe(p1.brainPath);

    const bad = await req('/api/backups/restore', { method: 'POST', headers: { 'x-dash': '1' }, body: 'not a backup' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/isn't a dashboard backup/);
    expect((await req('/api/backups/restore?file=..%2Fsecrets.json', { method: 'POST', headers: { 'x-dash': '1' } })).status).toBe(400);
    expect((await req('/api/backups/restore', { method: 'POST', headers: { 'x-dash': '1' } })).status).toBe(400);
  });

  it('streams a restore upload to a temporary file and always removes it', async () => {
    const received = path.join(tmp, 'data', 'tmp', 'received');
    // bigger than a JSON body may be: it still arrives (and is turned away as not a backup)
    const big = Buffer.alloc(30 * 1024 * 1024, 0x61);
    const r = await req('/api/backups/restore', { method: 'POST', headers: { 'x-dash': '1', 'content-type': 'application/octet-stream' }, body: big });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/isn't a dashboard backup/);
    expect(fs.existsSync(received) ? fs.readdirSync(received) : []).toEqual([]);
    // and after a restore that worked
    const st = await (await req('/api/state')).json();
    const made = await (await req(`/api/projects/${st.project.id}/backup`, { method: 'POST', headers: json })).json();
    const ok = await req('/api/backups/restore?name=Streamed', { method: 'POST', headers: { 'x-dash': '1' }, body: fs.readFileSync(made.file) });
    expect(ok.status).toBe(200);
    expect(fs.readdirSync(received)).toEqual([]);
  });
});

describe('skills from plain words', () => {
  it('asks for words or files before calling the Brain', async () => {
    const r = await req('/api/assist/skill', { method: 'POST', headers: json, body: JSON.stringify({ text: '   ' }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Say what the skill should do/);
    expect((await req('/api/assist/skill', { method: 'POST', body: JSON.stringify({ text: 'x' }) })).status).toBe(403); // needs x-dash
  });
});

describe('local-only security', () => {
  it('rejects requests for another host name (DNS rebinding)', async () => {
    const r = await new Promise<number>((resolve) => {
      // fetch won't let us change Host, so use a raw request
      http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { host: `evil.example:${port}` } }, (res) => resolve(res.statusCode || 0)).on('error', () => resolve(0));
    });
    expect(r).toBe(421);
  });

  it('needs the x-dash header for changes (no simple cross-site POSTs)', async () => {
    const r = await req('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) });
    expect(r.status).toBe(403);
  });

  it('blocks cross-site requests', async () => {
    const r = await req('/api/state', { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(r.status).toBe(403);
  });

  it('sends a strict content security policy with the page', async () => {
    const r = await req('/');
    const csp = r.headers.get('content-security-policy') || '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // fonts come from here too
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toContain('googleapis');
  });

  it('accepts the live-events socket only from its own page', async () => {
    const open = (origin: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers: { origin } });
        ws.on('open', () => (ws.close(), resolve('open')));
        ws.on('error', () => resolve('refused'));
        ws.on('unexpected-response', () => resolve('refused'));
      });
    expect(await open(base)).toBe('open');
    expect(await open('https://evil.example')).toBe('refused');
  });

  it("won't serve files outside its own folders", async () => {
    expect((await req('/api/file?path=' + encodeURIComponent(path.join(root, 'package.json')))).status).toBeGreaterThanOrEqual(400);
    // fetch would normalise a plain "/../", so encode the slash: the server decodes it after parsing the URL
    expect((await req('/%2e%2e%2fpackage.json')).status).not.toBe(200);
    expect((await req('/..%2fpackage.json')).status).not.toBe(200);
  });

  it("won't delete files outside a collection's folder (encoded slash in an id)", async () => {
    const keep = path.join(tmp, 'data', 'keep.json');
    fs.writeFileSync(keep, '{}');
    await req('/api/outbox/..%2fkeep', { method: 'DELETE', headers: json });
    await req('/api/outbox/..%5ckeep', { method: 'DELETE', headers: json });
    expect(fs.existsSync(keep)).toBe(true);
  });
});

describe('attached files', () => {
  const upload = (batch: string, rel: string, data: string, headers: Record<string, string> = { 'x-dash': '1' }) => req(`/api/uploads/${batch}?path=${encodeURIComponent(rel)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body: data });

  it('saves dropped files and folders in the project folder, and never outside it', async () => {
    const { batch } = await (await req('/api/uploads', { method: 'POST', headers: json })).json();
    const st = await (await req('/api/state')).json();
    const root = path.join(st.project.brainPath, 'uploads', batch);
    const f = await (await upload(batch, 'brief.md', '# Brief')).json();
    expect(f.path).toBe(path.join(root, 'brief.md'));
    expect(fs.readFileSync(f.path, 'utf8')).toBe('# Brief');
    const sneaky = await (await upload(batch, '../../../escape.txt', 'x')).json();
    expect(sneaky.path).toBe(path.join(root, 'escape.txt'));
    const inFolder = await (await upload(batch, 'assets/logo.svg', '<svg/>')).json();
    expect(inFolder.top).toBe(path.join(root, 'assets') + path.sep);
    // the page can show it
    expect((await req(`/api/file?path=${encodeURIComponent(f.path)}`)).status).toBe(200);
  });

  it('needs the x-dash header to upload or remove, and removes only uploads', async () => {
    const { batch } = await (await req('/api/uploads', { method: 'POST', headers: json })).json();
    expect((await upload(batch, 'a.md', 'x', {})).status).toBe(403);
    expect((await req('/api/uploads', { method: 'POST' })).status).toBe(403);
    const st = await (await req('/api/state')).json();
    const brainMd = path.join(st.project.brainPath, 'BRAIN.md');
    expect((await req(`/api/uploads?path=${encodeURIComponent(brainMd)}`, { method: 'DELETE', headers: json })).status).toBe(403);
    expect(fs.existsSync(brainMd)).toBe(true);
  });

  it('sends attachments with agent and team messages (a message can be files only)', async () => {
    const { batch } = await (await req('/api/uploads', { method: 'POST', headers: json })).json();
    const f = await (await upload(batch, 'data.csv', 'a,b\n1,2')).json();
    const a = await (await req('/api/agents', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Reader' }) })).json();
    const c = await (await req(`/api/agents/${a.id}/chats`, { method: 'POST', headers: json })).json();
    const outside = path.join(root, 'package.json');
    const sent = await req(`/api/agents/${a.id}/chats/${c.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ text: '', attachments: [f.path, outside] }) });
    expect(sent.status).toBe(200);
    const chat = await (await req(`/api/agents/${a.id}/chats/${c.id}`)).json();
    expect(chat.items[0]).toMatchObject({ type: 'user', text: '', attachments: [f.path] });
    expect(chat.title).toBe('data.csv');
    // nothing to send: no text, no (valid) files
    expect((await req(`/api/agents/${a.id}/chats/${c.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ text: ' ', attachments: [outside] }) })).status).toBe(400);

    const t = await (await req('/api/workflows', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Readers', members: [a.id], files: [f.path, outside] }) })).json();
    expect(t.files).toEqual([f.path]);
    const m = await (await req(`/api/teams/${t.id}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ text: 'Sum it', attachments: [f.path] }) })).json();
    expect(m).toMatchObject({ from: 'user', text: 'Sum it', attachments: [f.path] });
  });

  it('/compact compacts instead of sending, unless files come with it', async () => {
    // an API-model agent with no server address: a run fails at once, nothing real is asked
    const a = await (await req('/api/agents', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Compactor', engine: 'openai', provider: 'custom' }) })).json();
    const c = await (await req(`/api/agents/${a.id}/chats`, { method: 'POST', headers: json })).json();
    const path_ = `/api/agents/${a.id}/chats/${c.id}`;
    const r = await (await req(`${path_}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ text: '/compact' }) })).json();
    expect(r).toMatchObject({ compacted: false, message: expect.stringContaining('Nothing to compact') });
    expect((await (await req(path_)).json()).items).toEqual([]);
    const mem = await (await req(`${path_}/memory`)).json();
    expect(mem).toMatchObject({ tokens: expect.any(Number), window: expect.any(Number), auto: true });
    // with a file it is an ordinary message
    const { batch } = await (await req('/api/uploads', { method: 'POST', headers: json })).json();
    const f = await (await upload(batch, 'notes.txt', 'hello')).json();
    const sent = await (await req(`${path_}/messages`, { method: 'POST', headers: json, body: JSON.stringify({ text: '/compact', attachments: [f.path] }) })).json();
    expect(sent.runId).toEqual(expect.any(String));
    expect((await (await req(path_)).json()).items[0]).toMatchObject({ type: 'user', text: '/compact', attachments: [f.path] });
  });
});

describe('agent runs and projects', () => {
  it("tool calls through the MCP bridge stay in the run's project after you open another", async () => {
    // a fake model that holds its answer until the test lets it go
    let release = () => {};
    const model = http.createServer((rq, rs) => {
      if (rq.url?.endsWith('/models')) return rs.end(JSON.stringify({ data: [{ id: 'mock' }] }));
      new Promise<void>((r) => (release = r)).then(() => {
        rs.writeHead(200, { 'content-type': 'text/event-stream' });
        rs.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((r) => model.listen(0, '127.0.0.1', () => r()));
    try {
      const send = async (p: string, body: unknown, method = 'POST') => (await req(p, { method, headers: json, body: JSON.stringify(body) })).json();
      await send('/api/settings', { providers: { custom: { baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1` } } }, 'PUT');
      const home = path.join(tmp, 'home');
      const a = await send('/api/projects', { name: 'Bridge A', mode: 'new', folder: path.join(home, 'bridge-a') });
      const agent = await send('/api/agents', { name: 'Bridged', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: ['files'], autonomy: 'auto' });
      const chat = await send(`/api/agents/${agent.id}/chats`, {});
      const { runId } = await send(`/api/agents/${agent.id}/chats/${chat.id}/messages`, { text: 'hello' });
      const b = await send('/api/projects', { name: 'Bridge B', mode: 'new', folder: path.join(home, 'bridge-b') });
      expect((await (await req('/api/state')).json()).project.id).toBe(b.id);

      const internal = { 'content-type': 'application/json', 'x-dash-internal': fs.readFileSync(path.join(tmp, 'data', '.internal-token'), 'utf8').trim() };
      const tools = await (await req(`/api/internal/tools?agent=${agent.id}&run=${runId}`, { headers: internal })).json();
      // the run's own agent (files only), not the outside-client stand-in
      expect(tools.tools.map((t: { name: string }) => t.name)).toContain('write_file');
      expect(tools.tools.map((t: { name: string }) => t.name)).not.toContain('list_programs');
      const r = await (await req('/api/internal/tools/call', { method: 'POST', headers: internal, body: JSON.stringify({ agent: agent.id, run: runId, name: 'write_file', args: { path: 'bridge.txt', content: 'via-bridge' } }) })).json();
      expect(r.isError).toBe(false);
      expect(fs.readFileSync(path.join(a.brainPath, 'bridge.txt'), 'utf8')).toBe('via-bridge');
      expect(fs.existsSync(path.join(b.brainPath, 'bridge.txt'))).toBe(false);
    } finally {
      release();
      await new Promise<void>((r) => model.close(() => r()));
    }
  });

  it('the MCP bridge gives an agent the tools its team gave it for the work', async () => {
    let release = () => {};
    const model = http.createServer((rq, rs) => {
      if (rq.url?.endsWith('/models')) return rs.end(JSON.stringify({ data: [{ id: 'mock' }] }));
      new Promise<void>((r) => (release = r)).then(() => {
        rs.writeHead(200, { 'content-type': 'text/event-stream' });
        rs.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((r) => model.listen(0, '127.0.0.1', () => r()));
    try {
      const send = async (p: string, body: unknown, method = 'POST') => (await req(p, { method, headers: json, body: JSON.stringify(body) })).json();
      await send('/api/settings', { providers: { custom: { baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1` } } }, 'PUT');
      // the agent has no Files tools of its own; its team gives them
      const agent = await send('/api/agents', { name: 'Team helper', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [], autonomy: 'auto' });
      const team = await send('/api/workflows', { name: 'File team', members: [agent.id], lead: agent.id, access: { toolGroups: ['files'] } });
      await send(`/api/teams/${team.id}/messages`, { text: `@${agent.name} write it down` });
      let run: { id: string; agentId: string } | undefined;
      for (let i = 0; i < 100 && !run; i++) {
        run = ((await (await req('/api/runs')).json()) as { id: string; agentId: string }[]).find((r) => r.agentId === agent.id);
        if (!run) await new Promise((r) => setTimeout(r, 50));
      }
      expect(run).toBeTruthy();
      const internal = { 'content-type': 'application/json', 'x-dash-internal': fs.readFileSync(path.join(tmp, 'data', '.internal-token'), 'utf8').trim() };
      const tools = await (await req(`/api/internal/tools?agent=${agent.id}&run=${run!.id}`, { headers: internal })).json();
      expect(tools.tools.map((t: { name: string }) => t.name)).toContain('list_files');
      const r = await req('/api/internal/tools/call', { method: 'POST', headers: internal, body: JSON.stringify({ agent: agent.id, run: run!.id, name: 'list_files', args: {} }) });
      expect(r.status).toBe(200);
      // without the run it is the agent's own tools only
      const own = await (await req(`/api/internal/tools?agent=${agent.id}`, { headers: internal })).json();
      expect(own.tools.map((t: { name: string }) => t.name)).not.toContain('list_files');
    } finally {
      release();
      await new Promise<void>((r) => model.close(() => r()));
    }
  });

  it('keeps versions of an agent, restores one, and brings back a deleted one', async () => {
    const send = async (p: string, body: unknown, method = 'POST') => (await req(p, { method, headers: json, body: JSON.stringify(body) })).json();
    const a = await send('/api/agents', { name: 'Api versions', systemPrompt: 'First.' });
    await send(`/api/agents/${a.id}`, { systemPrompt: 'Second.' }, 'PUT');
    const hist = await (await req(`/api/versions/agent/${a.id}`)).json();
    expect(hist.versions).toHaveLength(1);
    expect(hist.versions[0].changes).toEqual(['instructions']);
    const v = await (await req(`/api/versions/agent/${a.id}/${hist.versions[0].id}`)).json();
    expect(v.text).toContain('First.');
    // changes need the custom header, like every other change
    expect((await req(`/api/versions/agent/${a.id}/${v.id}/restore`, { method: 'POST' })).status).toBe(403);
    await send(`/api/versions/agent/${a.id}/${v.id}/restore`, {});
    expect((await (await req(`/api/agents/${a.id}`)).json()).systemPrompt).toBe('First.');
    await req(`/api/agents/${a.id}`, { method: 'DELETE', headers: json });
    expect((await (await req('/api/versions/agent')).json()).map((x: { id: string }) => x.id)).toContain(a.id);
    await send(`/api/versions/agent/${a.id}/undelete`, {});
    expect((await req(`/api/agents/${a.id}`)).ok).toBe(true);
    expect((await req('/api/versions/routine')).status).toBe(404);
  });
});

describe('effort and favorite models', () => {
  const send = async (p: string, body: unknown, method = 'POST') => (await req(p, { method, headers: json, body: JSON.stringify(body) })).json();

  it("reads and edits an agent's and the Brain's MEMORY.md, with history", async () => {
    const a = await (await req('/api/agents', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Rememberer' }) })).json();
    const put = (owner: string, body: unknown, headers: Record<string, string> = json) => req(`/api/memory/${owner}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    expect(await (await req(`/api/memory/${a.id}`)).json()).toMatchObject({ owner: a.id, name: 'Rememberer', text: '', updatedAt: 0 });
    expect((await put(a.id, { text: '- Likes lists.' })).status).toBe(200);
    expect((await put(a.id, { text: '- Likes short lists.' })).status).toBe(200);
    expect(await (await req(`/api/memory/${a.id}`)).json()).toMatchObject({ text: '- Likes short lists.\n' });
    const hist = await (await req(`/api/versions/memory/${a.id}`)).json();
    expect(hist).toMatchObject({ kind: 'memory', current: '- Likes short lists.' });
    expect((await put('brain', { text: '- Keep it short.' })).status).toBe(200);
    expect((await (await req('/api/memory/brain')).json()).name).toBe('The Brain');
    // no such agent, no text, no x-dash header
    expect((await req('/api/memory/nobody')).status).toBe(404);
    expect((await put(a.id, { nope: 1 })).status).toBe(400);
    expect((await put(a.id, { text: 'x' }, { 'content-type': 'application/json' })).status).toBe(403);
    expect((await req('/api/memory/..%2Fsecrets')).status).toBeGreaterThanOrEqual(400);
  });

  it('saves an effort level on an agent, and turns anything else into the default', async () => {
    const a = await send('/api/agents', { name: 'Effortful', effort: 'high' });
    expect(a.effort).toBe('high');
    expect((await send(`/api/agents/${a.id}`, { effort: 'max' }, 'PUT')).effort).toBe('max');
    expect((await send(`/api/agents/${a.id}`, { effort: 'warp' }, 'PUT')).effort).toBe('');
  });

  it('keeps favorite models in the settings', async () => {
    const favoriteModels = [{ engine: 'claude-code', model: 'opus' }, { engine: 'openai', provider: 'openrouter', model: 'x/y' }];
    expect((await send('/api/settings', { favoriteModels }, 'PUT')).favoriteModels).toEqual(favoriteModels);
    expect((await (await req('/api/state')).json()).settings.favoriteModels).toEqual(favoriteModels);
    expect((await send('/api/settings', { favoriteModels: [] }, 'PUT')).favoriteModels).toEqual([]);
  });

  it('sends a server on this PC its nearest effort level, and asks again without one if it says no', async () => {
    const bodies: Record<string, unknown>[] = [];
    let refuse: false | 'http' | 'stream' | 'late' = false;
    const model = http.createServer((rq, rs) => {
      if (rq.url?.endsWith('/models')) return rs.end(JSON.stringify({ data: [{ id: 'mock' }] }));
      let raw = '';
      rq.on('data', (d) => (raw += d));
      rq.on('end', () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        bodies.push(body);
        if (refuse === 'http' && 'reasoning_effort' in body) {
          rs.writeHead(400, { 'content-type': 'application/json' });
          return rs.end(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: reasoning_effort' } }));
        }
        if (refuse === 'stream' && 'reasoning_effort' in body) {
          // a 200 whose stream carries the error (no HTTP status on it)
          rs.writeHead(200, { 'content-type': 'text/event-stream' });
          return rs.end(`data: ${JSON.stringify({ error: { message: 'reasoning_effort is not supported by this model' } })}\n\n`);
        }
        if (refuse === 'late' && 'reasoning_effort' in body) {
          // part of the answer, then an error: never asked again (it would show twice)
          rs.writeHead(200, { 'content-type': 'text/event-stream' });
          return rs.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'half' } }] })}\n\ndata: ${JSON.stringify({ error: { message: 'reasoning budget exceeded' } })}\n\n`);
        }
        rs.writeHead(200, { 'content-type': 'text/event-stream' });
        rs.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((r) => model.listen(0, '127.0.0.1', () => r()));
    try {
      await send('/api/settings', { providers: { custom: { baseUrl: `http://127.0.0.1:${(model.address() as { port: number }).port}/v1` } } }, 'PUT');
      const agent = await send('/api/agents', { name: 'Thinker', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [], effort: 'max' });
      const ask = async (text: string) => {
        const chat = await send(`/api/agents/${agent.id}/chats`, {});
        await send(`/api/agents/${agent.id}/chats/${chat.id}/messages`, { text });
        for (let i = 0; i < 100; i++) {
          const items = (await (await req(`/api/agents/${agent.id}/chats/${chat.id}`)).json()).items as { type: string }[];
          if (items.some((x) => x.type === 'assistant' || x.type === 'error')) return items;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error('no answer');
      };
      await ask('think hard');
      // max is more than an OpenAI-compatible server takes: it gets high
      expect(bodies.at(-1)).toMatchObject({ reasoning_effort: 'high' });
      expect(bodies.at(-1)).not.toHaveProperty('reasoning');

      for (const how of ['http', 'stream'] as const) {
        refuse = how;
        bodies.length = 0;
        const items = await ask(`again (${how})`);
        expect(items.some((x) => x.type === 'assistant')).toBe(true);
        expect(bodies).toHaveLength(2);
        expect(bodies[1]).not.toHaveProperty('reasoning_effort');
      }

      refuse = 'late';
      bodies.length = 0;
      const items = await ask('late error');
      expect(items.some((x) => x.type === 'error')).toBe(true);
      expect(bodies).toHaveLength(1);
    } finally {
      await new Promise<void>((r) => model.close(() => r()));
    }
  });
});

describe('/ commands over the API', () => {
  const send = async (p: string, body: unknown = {}, method = 'POST') => req(p, { method, headers: json, body: JSON.stringify(body) });

  it('agent chats: /goal shows, /loop is checked, /resume and /resend say when there is nothing to do', async () => {
    const a = await (await send('/api/agents', { name: 'Cmd agent' })).json();
    const c = await (await send(`/api/agents/${a.id}/chats`)).json();
    const base_ = `/api/agents/${a.id}/chats/${c.id}`;
    expect(await (await send(`${base_}/goal`, { text: '' })).json()).toEqual({ goal: null });
    const loop = await send(`${base_}/loop`, { text: '10s too fast' });
    expect(loop.status).toBe(400);
    expect((await loop.json()).error).toBe('Loop at most once a minute.');
    expect((await send(`${base_}/resume`)).status).toBe(400);
    expect((await send(`${base_}/resend`)).status).toBe(400);
    const chat = await (await req(base_)).json();
    expect(chat).toMatchObject({ queued: [], loop: null, goal: null });
    expect(await (await req(`/api/agents/${a.id}/commands`)).json()).toEqual([]);
    // like every change, commands need the dashboard's header
    expect((await req(`${base_}/resume`, { method: 'POST' })).status).toBe(403);
  });

  it('the Brain chat: /resume with nothing stopped says so', async () => {
    const r = await send('/api/brain/resume', {});
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Nothing to resume.');
    expect(await (await send('/api/brain/stop', { chats: 'not a list' })).json()).toEqual({ stopped: [] });
  });
});
