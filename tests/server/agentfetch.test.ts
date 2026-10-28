// fetch_url never reaches the dashboard itself: not directly, not by another address of this PC, not through a redirect.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentFetch, isDashboardUrl, isLocalAddress } from '../../server/agentfetch.ts';
import { setPort } from '../../server/util.ts';

const listen = (handler: http.RequestListener) =>
  new Promise<http.Server>((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
const portOf = (s: http.Server) => (s.address() as AddressInfo).port;

let dash: http.Server;
let other: http.Server;
let dashHits = 0;

beforeAll(async () => {
  dash = await listen((_req, res) => {
    dashHits++;
    res.end('secret');
  });
  setPort(portOf(dash));
  other = await listen((req, res) => {
    if (req.url === '/hop') return void res.writeHead(302, { location: `http://127.0.0.1:${portOf(dash)}/api/mcp` }).end();
    if (req.url === '/hop2') return void res.writeHead(301, { location: '/fine' }).end();
    res.end('public page');
  });
});
afterAll(() => {
  dash.close();
  other.close();
});

describe('agent fetches', () => {
  it('knows the addresses of this PC', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '0.0.0.0', '::1', '::', '[::1]', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:0:0:1', '::ffff:0.0.0.0']) expect(isLocalAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '10.0.0.1', '::ffff:8.8.8.8', '2001:db8::1', 'example.com']) expect(isLocalAddress(ip), ip).toBe(false);
  });

  it('refuses every way of naming the dashboard', async () => {
    const p = portOf(dash);
    for (const u of [`http://127.0.0.1:${p}/`, `http://localhost:${p}/`, `http://LOCALHOST.:${p}/`, `http://[::1]:${p}/`, `http://0.0.0.0:${p}/`, `http://127.1:${p}/`, `http://2130706433:${p}/`, `http://[::ffff:127.0.0.1]:${p}/`, `http://a.localhost:${p}/`]) {
      expect(await isDashboardUrl(new URL(u)), u).toBe(true);
      await expect(agentFetch(u)).rejects.toThrow(/dashboard/);
    }
    // another program on this PC is fine
    expect(await isDashboardUrl(new URL(`http://127.0.0.1:${portOf(other)}/`))).toBe(false);
    expect(dashHits).toBe(0);
  });

  it('checks every redirect', async () => {
    await expect(agentFetch(`http://127.0.0.1:${portOf(other)}/hop`)).rejects.toThrow(/dashboard/);
    expect(dashHits).toBe(0);
    const { res, url } = await agentFetch(`http://127.0.0.1:${portOf(other)}/hop2`);
    expect(await res.text()).toBe('public page');
    expect(url).toBe(`http://127.0.0.1:${portOf(other)}/fine`);
  });
});
