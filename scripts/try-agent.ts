// Send one message to an agent and print what happens live. Handy for checking an agent works.
//   node scripts/try-agent.js <agentId> "message" [--port 4800] [--approve]
// --approve allows every permission request automatically (testing only).
import WebSocket from 'ws';
import type { Approval, Chat, RunEvent } from '../shared/types.ts';

const [agentId, text] = process.argv.slice(2);
const port = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '4800';
const autoApprove = process.argv.includes('--approve');
if (!agentId || !text) {
  console.log('Usage: node scripts/try-agent.js <agentId> "message" [--port 4800] [--approve]');
  process.exit(1);
}
const base = `http://localhost:${port}/api`;
const call = async <T = unknown>(path: string, body?: unknown): Promise<T> => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-dash': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(j.error);
  return j;
};

const ws = new WebSocket(`ws://localhost:${port}/ws`, { origin: `http://localhost:${port}` });
await new Promise((r) => ws.on('open', r));
const chat = await call<Chat>(`/agents/${agentId}/chats`, {});
const started = Date.now();
ws.on('message', async (raw) => {
  const ev = JSON.parse(String(raw)) as { type: string; chatId?: string; event: RunEvent };
  if (ev.type === 'approvals' && autoApprove) {
    for (const a of await call<Approval[]>('/approvals')) {
      console.log(`\n[auto-approving] ${a.title}\n${String(a.detail).slice(0, 300)}`);
      await call(`/approvals/${a.id}`, { approved: true });
    }
  }
  if (ev.type !== 'run' || ev.chatId !== chat.id) return;
  const e = ev.event;
  if (e.kind === 'text') process.stdout.write(e.text);
  else if (e.kind === 'tool') console.log(`\n[tool] ${e.name} ${JSON.stringify(e.args).slice(0, 300)}`);
  else if (e.kind === 'tool_result') console.log(`[result${e.isError ? ' ERROR' : ''}] ${String(e.text).slice(0, 600)}${e.images?.length ? ` (+${e.images.length} images)` : ''}`);
  else if (e.kind === 'status') console.log(`[status] ${e.text}`);
  else if (e.kind === 'done' || e.kind === 'error') {
    console.log(`\n[${e.kind}] after ${Math.round((Date.now() - started) / 1000)}s ${e.kind === 'error' ? e.text : ''}`);
    ws.close();
    process.exit(e.kind === 'done' ? 0 : 1);
  }
});
await call(`/agents/${agentId}/chats/${chat.id}/messages`, { text });
