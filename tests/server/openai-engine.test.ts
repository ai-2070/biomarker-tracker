// The API-model engine with a fake model and a fake MCP server: how risky MCP tools are, "Always allow"
// within the run, tool pictures reaching the model, turned-off servers, Stop, and cut-off answers.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { chats, saveSettings } from '../../server/store.ts';
import { startRun } from '../../server/engines/index.ts';
import { cutReason, trimHistory } from '../../server/engines/openai.ts';
import type { LlmMessage } from '../../server/engines/openai.ts';
import { decide, listApprovals } from '../../server/approvals.ts';
import * as mcp from '../../server/mcp.ts';
import type { Chat } from '../../shared/types.ts';

const FAKE_MCP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp.mjs');

type Reply = { text?: string; call?: { name: string; args: string }; finish?: string };
// what the fake model answers next, and every request it got
let replies: Reply[] = [];
const requests: { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] }[] = [];
let server: http.Server;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    requests.push(JSON.parse(body));
    const r = replies.shift() || { text: 'done' };
    const chunk = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (r.text) res.write(chunk({ content: r.text }));
    if (r.call) res.write(chunk({ tool_calls: [{ index: 0, id: `c${requests.length}`, function: { name: r.call.name, arguments: r.call.args } }] }));
    res.end(chunk({}, r.finish || (r.call ? 'tool_calls' : 'stop')) + 'data: [DONE]\n\n');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ brainApproves: false, providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
  mcp.saveServer('fake', { type: 'stdio', command: process.execPath, args: [FAKE_MCP] });
  mcp.saveServer('off', { type: 'stdio', command: process.execPath, args: [FAKE_MCP], enabled: false });
});
afterAll(async () => {
  await mcp.disconnect('fake');
  await new Promise<void>((r) => server.close(() => r()));
});

const agentWith = (autonomy: 'auto' | 'ask' | 'full', mcpServers = ['fake']) => newAgent({ name: `Tester ${autonomy}`, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [], mcpServers, autonomy });
const go = async (autonomy: 'auto' | 'ask' | 'full', script: Reply[], onApproval?: (title: string) => void, mcpServers?: string[]) => {
  const agent = agentWith(autonomy, mcpServers);
  const chat = chats.create(agent.id, 'Test');
  replies = script;
  requests.length = 0;
  const { promise } = startRun(agent, chat, 'Go', { depth: 0 });
  // answer approvals as they come
  let done = false;
  const answering = (async () => {
    while (!done) {
      for (const a of listApprovals()) {
        onApproval?.(a.title);
        decide(a.id, { approved: true, always: true });
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  await promise;
  done = true;
  await answering;
  return { agent, chat: chats.get(agent.id, chat.id) as Chat };
};

describe('MCP tools for API models', () => {
  it('a tool that only reads needs no yes on Auto, and its picture reaches the model', async () => {
    const asked: string[] = [];
    await go('auto', [{ call: { name: 'fake__look', args: '{}' } }, { text: 'I see a dot.' }], (t) => asked.push(t));
    expect(asked).toEqual([]);
    const after = JSON.stringify(requests[1].messages);
    expect(after).toContain('data:image/png;base64,');
    expect(after).toContain('you get them in the next message');
  });

  it('any other tool asks first on Auto, and "Always allow" covers the rest of the run', async () => {
    const asked: string[] = [];
    const { agent } = await go('auto', [{ call: { name: 'fake__send', args: '{}' } }, { call: { name: 'fake__send', args: '{}' } }, { text: 'Sent twice.' }], (t) => asked.push(t));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('fake__send');
    // both calls ran
    expect(JSON.stringify(requests[2].messages).match(/"sent"/g)).toHaveLength(2);
    expect(agent.alwaysAllow || []).toContain('fake__send');
    expect(mcp.mcpToolRisk({ annotations: { readOnlyHint: true } })).toBe('low');
    expect(mcp.mcpToolRisk({})).toBe('high');
  });

  it('a server you turned off is neither offered nor started', async () => {
    await go('full', [{ text: 'ok' }], undefined, ['off', 'fake']);
    const names = (requests[0].tools || []).map((t) => t.function.name);
    expect(names).toContain('fake__look');
    expect(names.some((n) => n.startsWith('off__'))).toBe(false);
    await expect(mcp.listTools('off')).rejects.toThrow(/turned off/);
    await expect(mcp.callTool('off', 'look')).rejects.toThrow(/turned off/);
    // the Test button still may
    expect((await mcp.testServer('off')).map((t) => t.name)).toContain('look');
    await mcp.disconnect('off');
  });

  it('a stopped call is never sent', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(mcp.callTool('fake', 'send', {}, { signal: ctl.signal })).rejects.toThrow(/Stopped/);
  });
});

describe('cut-off answers', () => {
  it('an answer that ran out of tokens is not a finished one', async () => {
    const { chat } = await go('full', [{ text: 'Half an ans', finish: 'length' }]);
    expect(chat.items.at(-1)).toMatchObject({ type: 'error', text: expect.stringContaining('cut off') });
    // what it wrote stays in its memory, for /resume
    expect(chat.llm?.at(-1)).toMatchObject({ role: 'assistant', content: 'Half an ans' });
    expect(cutReason('stop')).toBe('');
  });

  it('a half-written tool call does not run', async () => {
    const asked: string[] = [];
    const { chat } = await go('ask', [{ call: { name: 'fake__send', args: '{"to": "bo' }, finish: 'length' }], (t) => asked.push(t));
    expect(asked).toEqual([]);
    expect(chat.items.some((i) => i.type === 'tool')).toBe(false);
    expect(chat.items.at(-1)).toMatchObject({ type: 'error' });
  });
});

describe('tool pictures as data (for models and the MCP bridge)', () => {
  it("keeps data pictures and reads ComfyUI's result links from ComfyUI", async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const asked: string[] = [];
    const comfy = http.createServer((req, res) => {
      asked.push(req.url || '');
      if (req.url?.startsWith('/system_stats')) return res.end('{}');
      if (req.url?.startsWith('/view')) return res.writeHead(200, { 'content-type': 'image/png' }).end(png);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => comfy.listen(0, '127.0.0.1', () => r()));
    try {
      saveSettings({ comfyui: { url: `http://127.0.0.1:${(comfy.address() as AddressInfo).port}` } });
      const { inlineToolImages } = await import('../../server/toolimages.ts');
      const data = `data:image/png;base64,${png.toString('base64')}`;
      const out = await inlineToolImages([data, '/api/comfyui/view?filename=a.png&subfolder=&type=output&extra=x', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://elsewhere/x.png']);
      expect(out).toEqual([data, data]);
      // only the picture's own fields go to ComfyUI
      expect(asked.find((u) => u.startsWith('/view'))).toBe('/view?filename=a.png&subfolder=&type=output');
    } finally {
      await new Promise<void>((r) => comfy.close(() => r()));
    }
  });
});

describe('trimHistory', () => {
  it('keeps the newest user message even when it alone is over the budget', () => {
    const msgs: LlmMessage[] = [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'x'.repeat(5000) },
    ];
    expect(trimHistory(msgs, 1000)).toEqual([msgs[2]]);
  });
});
