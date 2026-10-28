// Stopping a ComfyUI job takes only that job off: a job of someone else's that is running goes on.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelPrompt } from '../../server/comfyui.ts';

let running = 'theirs';
const calls: { url: string; body: string }[] = [];
let server: http.Server;
let base = '';
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    calls.push({ url: `${req.method} ${req.url}`, body });
    if (req.method === 'GET' && req.url === '/queue') return res.end(JSON.stringify({ queue_running: [[1, running, {}, {}, []]], queue_pending: [] }));
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('stopping a ComfyUI job', () => {
  it("doesn't interrupt another job that is running", async () => {
    calls.length = 0;
    running = 'theirs';
    await cancelPrompt(base, 'mine');
    expect(calls.map((c) => c.url)).toEqual(['POST /queue', 'GET /queue']);
    expect(JSON.parse(calls[0].body)).toEqual({ delete: ['mine'] });
  });

  it('interrupts its own job when that one is running', async () => {
    calls.length = 0;
    running = 'mine';
    await cancelPrompt(base, 'mine');
    expect(calls.at(-1)).toEqual({ url: 'POST /interrupt', body: JSON.stringify({ prompt_id: 'mine' }) });
  });
});
