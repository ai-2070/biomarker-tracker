// When the server stops (the desktop app quits, Ctrl+C), every agent run is stopped first and no new one starts.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { chats, saveSettings } from '../../server/store.ts';
import { activeRuns, startRun, stopAllRuns } from '../../server/engines/index.ts';

// a fake model that never answers: it holds every request open until the client goes away
let server: http.Server;
let asked = 0;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    asked++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    req.on('close', () => res.end());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('stopAllRuns()', () => {
  it('stops every run, waits for them to end, and refuses new ones', async () => {
    const a = newAgent({ name: 'Busy', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
    const run = startRun(a, chats.create(a.id, 'One'), 'go');
    const ended = run.promise.catch(() => 'stopped');
    for (const end = Date.now() + 5000; asked === 0 && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
    expect(asked).toBeGreaterThan(0);
    await stopAllRuns();
    expect(run.signal.aborted).toBe(true);
    expect(activeRuns()).toHaveLength(0);
    await ended;
    expect(() => startRun(a, chats.create(a.id, 'Two'), 'again')).toThrow(/stopping/);
  });
});
