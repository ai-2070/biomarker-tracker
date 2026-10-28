// The agent chat on the Vercel AI SDK (web/chat), in a simulated page with a fake server: a saved chat
// shows with its COMPACTED mark, tool calls and file previews; a message streams in (text and tool
// calls as they come); /compact compacts; a run started elsewhere is picked up and streamed; a Rich
// answer shows as live components.
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessageChunk } from 'ai';
import { connectEvents, state } from '../../web/core.ts';
import { attachTray } from '../../web/attach.ts';
import { forgetFiles } from '../../web/filepreview.ts';
import { mountChat } from '../../web/chat/mount.tsx';
import { isRichCode } from '../../web/chat/ChatView.tsx';
import type { MountedChat } from '../../web/chat/mount.tsx';
import type { AppState, Chat, ChatItem, QueuedMessage } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeSocket {
  static last: FakeSocket | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
}

/** A UI message stream the test writes into, as the server would. */
function uiStream() {
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  return {
    response: () => new Response(body, { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } }),
    push: (c: UIMessageChunk) => ctl.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`)),
    end: () => {
      ctl.enqueue(enc.encode('data: [DONE]\n\n'));
      ctl.close();
    },
    // the page stopped reading it (as a real response ends when its request is aborted)
    abort: () => {
      try {
        ctl.error(new DOMException('The operation was aborted.', 'AbortError'));
      } catch {
        /* already done */
      }
    },
  };
}

const SAVED: ChatItem[] = [
  { type: 'user', text: 'old question' },
  { type: 'assistant', text: 'old answer' },
  { type: 'compaction', id: 'k1', text: 'COMPACTED HISTORY TEXT', mode: 'instant', trigger: 'auto', upto: 2 },
  { type: 'user', text: 'make a render' },
  { type: 'tool', id: 't1', name: 'blender_run_python', args: { code: 'bpy.ops.render()' }, result: 'rendered', status: 'done' },
  { type: 'assistant', text: 'Saved it to **/w/render.png**' },
];
let chat: Chat;
let requests: { method: string; url: string; body: Record<string, unknown> }[];
let sendStream: ReturnType<typeof uiStream> | null;
let resumeStream: ReturnType<typeof uiStream> | null;
let unqueuedOnStop: QueuedMessage[];

const settle = () => act(() => new Promise((r) => setTimeout(r, 40)));
const wsEvent = (ev: Record<string, unknown>) => act(() => FakeSocket.last!.onmessage!({ data: JSON.stringify({ ts: 0, ...ev }) }));

beforeAll(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  connectEvents();
});
beforeEach(() => {
  chat = { id: 'c1', agentId: 'a1', title: 'Renders', items: structuredClone(SAVED), llm: [], sessionId: null, createdAt: 0, updatedAt: 0 };
  requests = [];
  sendStream = null;
  resumeStream = null;
  unqueuedOnStop = [];
  forgetFiles();
  document.body.append(Object.assign(document.createElement('div'), { id: 'toasts' }));
  state.data = { runs: [], approvals: [], agents: [] } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ method, url, body });
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    if (url === '/api/agents/a1/chats/c1' && method === 'GET') return json(chat);
    if (url === '/api/agents/a1/chats/c1/stream' && method === 'POST') {
      const s = (sendStream = uiStream());
      init.signal?.addEventListener('abort', () => s.abort());
      return s.response();
    }
    if (url === '/api/agents/a1/chats/c1/stream' && method === 'GET') return resumeStream ? resumeStream.response() : new Response(null, { status: 204 });
    if (url === '/api/agents/a1/chats/c1/compact') return json({ compacted: true, item: {} });
    if (url === '/api/agents/a1/chats/c1/stop') return json({ ok: true, unqueued: unqueuedOnStop });
    if (url === '/api/agents/a1/commands') return json([{ name: 'review', about: 'Review the changes' }]);
    // a queued message changed: "gone" was sent meanwhile, "boom" can't be saved
    if (method === 'PUT' && url.startsWith('/api/agents/a1/chats/c1/queue/')) {
      if (body.text === 'boom') return new Response(JSON.stringify({ error: 'Could not save it.' }), { status: 500 });
      return json({ queued: body.text === 'gone' ? null : { id: url.split('/').pop(), text: body.text, ts: 0 } });
    }
    if (url === '/api/files/info') return json((body.paths as string[]).map((p) => ({ path: p, ok: p === '/w/render.png', kind: 'image', name: 'render.png', size: 10, modified: 0 })));
    return json({});
  });
});
let mounted: MountedChat | null = null;
afterEach(() => {
  act(() => mounted?.destroy());
  mounted = null;
  document.body.innerHTML = '';
});

async function open(variant?: 'full' | 'compact' | 'mini'): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.append(el);
  await act(async () => {
    mounted = mountChat(el, { agent: { id: 'a1', name: 'Renderer' }, chatId: 'c1', tray: attachTray(), variant });
  });
  await settle();
  return el;
}

const type = async (el: HTMLElement, text: string) => {
  const box = el.querySelector('textarea')!;
  box.value = text;
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
};

describe('the agent chat (AI SDK)', () => {
  it('shows the saved chat: messages, the tool call, the COMPACTED mark, dimmed old messages, file previews', async () => {
    const el = await open();
    expect(el.textContent).toContain('make a render');
    expect(el.querySelector('details.tool .tname')!.textContent).toBe('blender_run_python');
    expect(el.querySelector('details.compaction .cmp-text')!.textContent).toBe('COMPACTED HISTORY TEXT');
    const old = [...el.querySelectorAll('.msg.user')].find((n) => n.textContent === 'old question')!;
    expect(old.classList.contains('compacted')).toBe(true);
    const recent = [...el.querySelectorAll('.msg.user')].find((n) => n.textContent === 'make a render')!;
    expect(recent.classList.contains('compacted')).toBe(false);
    expect(el.querySelector('.fp-card img')!.getAttribute('src')).toBe('/api/file?path=%2Fw%2Frender.png');
  });

  it('a message streams in: text as written, a tool call as it happens, then the saved chat', async () => {
    const el = await open();
    await type(el, 'and a video');
    await settle();
    expect(requests.find((r) => r.method === 'POST' && r.url.endsWith('/stream'))!.body).toEqual({ text: 'and a video', attachments: [] });
    expect(el.textContent).toContain('and a video');
    const s = sendStream!;
    await act(async () => {
      s.push({ type: 'start', messageId: 'run-r1' });
      s.push({ type: 'text-start', id: 't1' });
      s.push({ type: 'text-delta', id: 't1', delta: 'Render' });
      s.push({ type: 'text-delta', id: 't1', delta: 'ing…' });
      s.push({ type: 'data-status', data: { text: 'Using ffmpeg…' }, transient: true } as UIMessageChunk);
      s.push({ type: 'text-end', id: 't1' });
      s.push({ type: 'tool-input-available', toolCallId: 'v1', toolName: 'ffmpeg', input: { args: ['-i', 'a.png'] }, dynamic: true });
    });
    await settle();
    expect(el.textContent).toContain('Rendering…');
    expect([...el.querySelectorAll('.tname')].map((n) => n.textContent)).toContain('ffmpeg');
    // (a tool is running: the status line says so)
    expect(el.querySelector('.status-line')!.textContent).toContain('Using ffmpeg…');
    expect(el.querySelector('button[aria-label="Stop"]')).not.toBeNull();
    // the tool's result, opened: input and result
    await act(async () => s.push({ type: 'tool-output-available', toolCallId: 'v1', output: { text: 'clip.mp4 written', images: [] }, dynamic: true }));
    await settle();
    const card = [...el.querySelectorAll('details.tool')].find((d) => d.textContent!.includes('ffmpeg'))!;
    expect(card.textContent).toContain('clip.mp4 written');
    // the run ends: the saved chat replaces the stream
    chat.items.push({ type: 'user', text: 'and a video' }, { type: 'assistant', text: 'Rendered it again.' });
    await act(async () => {
      s.push({ type: 'finish' });
      s.end();
    });
    await settle();
    await settle();
    expect(el.textContent).toContain('Rendered it again.');
    expect(el.textContent).not.toContain('Rendering…');
  });

  it('a message the server refuses: its reason as a toast, and the text back in the box', async () => {
    const el = await open();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/stream') && init.method === 'POST') return new Response(JSON.stringify({ error: 'This chat is already working on something.' }), { status: 409 });
      return new Response(JSON.stringify(url === '/api/agents/a1/chats/c1' ? chat : []), { headers: { 'content-type': 'application/json' } });
    });
    await type(el, 'are you there?');
    await settle();
    await settle();
    expect(document.getElementById('toasts')!.textContent).toBe('This chat is already working on something.');
    expect(el.querySelector('textarea')!.value).toBe('are you there?');
  });

  it('a message that never reaches the server (no connection) comes back to the box', async () => {
    const el = await open();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/stream') && init.method === 'POST') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(url === '/api/agents/a1/chats/c1' ? chat : []), { headers: { 'content-type': 'application/json' } });
    });
    await type(el, 'are you there?');
    await settle();
    await settle();
    expect(document.getElementById('toasts')!.textContent).toContain('Failed to fetch');
    expect(el.querySelector('textarea')!.value).toBe('are you there?');
  });

  it('the Send button runs a command like Enter does', async () => {
    const el = await open();
    const box = el.querySelector('textarea')!;
    box.value = '/goal finish the tests';
    await act(async () => box.dispatchEvent(new Event('input', { bubbles: true })));
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click());
    await settle();
    expect(requests.find((r) => r.url === '/api/agents/a1/chats/c1/goal')!.body).toEqual({ text: 'finish the tests' });
    expect(requests.some((r) => r.method === 'POST' && r.url.endsWith('/stream'))).toBe(false);
  });

  it('a long pasted /queue message while it works waits its turn (it does not change the course)', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    const box = el.querySelector('textarea')!;
    const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    box.value = '';
    const data = { types: ['text/plain'], items: [], files: [], getData: (t: string) => (t === 'text/plain' ? `/queue ${long}` : '') } as unknown as DataTransfer;
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: data });
    await act(async () => void box.dispatchEvent(e));
    expect(box.value).toMatch(/^\[Pasted text #1/);
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle();
    expect(requests.find((r) => r.url === '/api/agents/a1/chats/c1/queue')!.body).toEqual({ text: long, attachments: [] });
    expect(requests.filter((r) => r.url.endsWith('/stream') && r.method === 'POST')).toHaveLength(1);
  });

  it('a run that fails says so, and the message stays sent (it is not put back in the box)', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    const s = sendStream!;
    chat.items.push({ type: 'user', text: 'go' }, { type: 'error', text: 'Claude Code exited (1) without an answer.' });
    await act(async () => {
      s.push({ type: 'start', messageId: 'run-r1' });
      s.push({ type: 'error', errorText: 'Claude Code exited (1) without an answer.' });
      s.push({ type: 'finish' });
      s.end();
    });
    await settle();
    await settle();
    expect(document.getElementById('toasts')!.textContent).toBe('Claude Code exited (1) without an answer.');
    expect(el.querySelector('textarea')!.value).toBe('');
    expect(el.querySelector('.msg.error')!.textContent).toBe('Claude Code exited (1) without an answer.');
  });

  it('nothing can be sent while it compacts', async () => {
    const el = await open();
    let finish = () => {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      requests.push({ method: init.method || 'GET', url, body: {} });
      if (url.endsWith('/compact')) {
        await new Promise<void>((r) => (finish = r));
        return new Response(JSON.stringify({ compacted: false, message: 'Nothing to compact yet' }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(url === '/api/agents/a1/chats/c1' ? chat : []), { headers: { 'content-type': 'application/json' } });
    });
    await type(el, '/compact');
    await settle();
    const sendBtn = el.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
    expect(sendBtn.disabled).toBe(true);
    await type(el, 'are you there?');
    await settle();
    expect(requests.some((r) => r.url.endsWith('/stream') && r.method === 'POST')).toBe(false);
    await act(async () => finish());
    await settle();
    expect(el.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(false);
  });

  it('/compact compacts instead of sending', async () => {
    const el = await open();
    await type(el, '/compact');
    await settle();
    expect(requests.some((r) => r.url === '/api/agents/a1/chats/c1/compact')).toBe(true);
    expect(requests.some((r) => r.url.endsWith('/stream') && r.method === 'POST')).toBe(false);
    expect(document.getElementById('toasts')!.textContent).toContain('Compacted');
  });

  it('a run started elsewhere (a team turn, another tab) is picked up and streams in', async () => {
    const el = await open();
    chat.items.push({ type: 'user', text: 'from the team', from: 'team Ops' });
    resumeStream = uiStream();
    await wsEvent({ type: 'run', runId: 'r-team', agentId: 'a1', chatId: 'c1', event: { kind: 'start', text: 'from the team' } });
    await settle();
    expect(requests.some((r) => r.method === 'GET' && r.url.endsWith('/stream'))).toBe(true);
    await act(async () => {
      resumeStream!.push({ type: 'start', messageId: 'run-r-team' });
      resumeStream!.push({ type: 'tool-input-available', toolCallId: 'x1', toolName: 'read_file', input: { path: 'a.txt' }, dynamic: true });
      resumeStream!.push({ type: 'text-start', id: 'a' });
      resumeStream!.push({ type: 'text-delta', id: 'a', delta: 'Reading it now' });
    });
    await settle();
    expect(el.textContent).toContain('from the team');
    expect(el.textContent).toContain('Reading it now');
    expect([...el.querySelectorAll('.tname')].map((n) => n.textContent)).toContain('read_file');
  });

  it('/queue while it works: the server holds it, it shows, × takes it back', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    await type(el, '/queue then write the tests');
    await settle();
    expect(requests.find((r) => r.url === '/api/agents/a1/chats/c1/queue')!.body).toEqual({ text: 'then write the tests', attachments: [] });
    expect(requests.filter((r) => r.url.endsWith('/stream') && r.method === 'POST')).toHaveLength(1);
    expect(el.querySelector('textarea')!.value).toBe('');
    await wsEvent({ type: 'queue', agentId: 'a1', chatId: 'c1', queued: [{ id: 'q1', text: 'then write the tests', ts: 0 }] });
    expect(el.querySelector('.queued-msg')!.textContent).toContain('then write the tests');
    expect(el.querySelector('.queued-head')!.textContent).toBe('Sends when Renderer is done');
    await act(async () => (el.querySelector(`.queued-msg button[aria-label="Don't send this"]`) as HTMLButtonElement).click());
    await settle();
    expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/agents/a1/chats/c1/queue/q1')).toBe(true);
    expect(el.querySelector('.queued-msg')).toBeNull();
  });

  it('the queued message starts as the turn before it ends: that turn streams in too', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    await wsEvent({ type: 'queue', agentId: 'a1', chatId: 'c1', queued: [{ id: 'q1', text: 'next one', ts: 0 }] });
    // the server ends this run and starts the queued one before this view's stream has closed
    await wsEvent({ type: 'run', runId: 'r2', agentId: 'a1', chatId: 'c1', event: { kind: 'start', text: 'next one' } });
    await wsEvent({ type: 'queue', agentId: 'a1', chatId: 'c1', queued: [] });
    chat.items.push({ type: 'user', text: 'go' }, { type: 'assistant', text: 'Went.' }, { type: 'user', text: 'next one' });
    resumeStream = uiStream();
    const s = sendStream!;
    await act(async () => {
      s.push({ type: 'start', messageId: 'run-r1' });
      s.push({ type: 'finish' });
      s.end();
    });
    await settle();
    await settle();
    expect(requests.some((r) => r.method === 'GET' && r.url.endsWith('/stream'))).toBe(true);
    await act(async () => {
      resumeStream!.push({ type: 'start', messageId: 'run-r2' });
      resumeStream!.push({ type: 'text-start', id: 'b' });
      resumeStream!.push({ type: 'text-delta', id: 'b', delta: 'On the next one' });
    });
    await settle();
    expect(el.textContent).toContain('On the next one');
  });

  it('/queue when nothing is working just sends it', async () => {
    const el = await open();
    await type(el, '/queue hello there');
    await settle();
    expect(requests.find((r) => r.method === 'POST' && r.url.endsWith('/stream'))!.body).toEqual({ text: 'hello there', attachments: [] });
    expect(requests.some((r) => r.url.endsWith('/queue'))).toBe(false);
  });

  it('while it works, an empty box shows Stop; typing shows Send, and it goes as a steer', async () => {
    const el = await open();
    await type(el, 'make it red');
    await settle();
    const first = sendStream!;
    await act(async () => first.push({ type: 'start', messageId: 'run-r1' }));
    await settle();
    const box = el.querySelector('textarea')!;
    expect(el.querySelector('button[aria-label="Stop"]')).not.toBeNull();
    expect(el.querySelector('button[aria-label="Send"]')).toBeNull();
    box.value = 'no, blue';
    await act(async () => box.dispatchEvent(new Event('input', { bubbles: true })));
    expect(el.querySelector('button[aria-label="Stop"]')).toBeNull();
    const send = el.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    for (let i = 0; i < 20 && requests.filter((r) => r.method === 'POST' && r.url.endsWith('/stream')).length < 2; i++) await settle();
    const posts = requests.filter((r) => r.method === 'POST' && r.url.endsWith('/stream'));
    expect(posts.map((r) => r.body)).toEqual([
      { text: 'make it red', attachments: [] },
      { text: 'no, blue', attachments: [], steer: true },
    ]);
    // (Stop itself was never asked for: the server stops the run for the steer)
    expect(requests.some((r) => r.url.endsWith('/stop'))).toBe(false);
    expect(el.textContent).toContain('no, blue');
  });

  it('queued messages: Up in an empty box changes the last one; drag changes the order', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    await wsEvent({ type: 'queue', agentId: 'a1', chatId: 'c1', queued: [{ id: 'q1', text: 'first', ts: 0 }, { id: 'q2', text: 'second', ts: 0 }] });
    await settle();
    const box = el.querySelector('textarea')!;
    box.value = '';
    await act(async () => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    const edit = el.querySelector<HTMLTextAreaElement>('.queued-edit')!;
    expect(edit.value).toBe('second');
    edit.value = 'second, shorter';
    await act(async () => edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle();
    expect(requests.find((r) => r.method === 'PUT')).toMatchObject({ url: '/api/agents/a1/chats/c1/queue/q2', body: { text: 'second, shorter' } });
    expect([...el.querySelectorAll('.queued-text')].map((n) => n.textContent)).toEqual(['first', 'second, shorter']);
    // dragged onto the top half of the first: it goes first
    const row = (id: string) => el.querySelector(`[data-qid="${id}"]`)!;
    const dt = new DataTransfer();
    const steps = [
      ['dragstart', row('q2')],
      ['dragover', row('q1')],
      ['drop', row('q1')],
      ['dragend', row('q2')],
    ] as const;
    for (const [kind, target] of steps) await act(async () => void target.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt })));
    await settle();
    expect([...el.querySelectorAll('.queued-text')].map((n) => n.textContent)).toEqual(['second, shorter', 'first']);
    expect(requests.find((r) => r.url.endsWith('/queue/order'))!.body).toEqual({ ids: ['q2', 'q1'] });
  });

  it('while it works for a team or another agent, a message is not sent to change its course', async () => {
    state.data = { runs: [{ id: 'r1', agentId: 'a1', chatId: 'c1', startedAt: 0, agentName: 'Renderer', parentRunId: 'team:t1', depth: 1 }], approvals: [], agents: [] } as unknown as AppState;
    const el = await open();
    await act(async () => {
      for (const fn of state.listeners) fn(state.data!);
    });
    await settle();
    expect(el.querySelector('textarea')!.placeholder).toContain('for a team or another agent');
    await type(el, 'something else');
    await settle();
    expect(requests.some((r) => r.method === 'POST' && r.url.endsWith('/stream'))).toBe(false);
    expect(document.getElementById('toasts')!.textContent).toContain('/queue');
    // (what you typed stays in the box)
    expect(el.querySelector('textarea')!.value).toBe('something else');
  });

  it('a change to a queued message that fails goes back; one already sent comes to the box', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    await wsEvent({ type: 'queue', agentId: 'a1', chatId: 'c1', queued: [{ id: 'q1', text: 'first', ts: 0 }] });
    await settle();
    const box = el.querySelector('textarea')!;
    const change = async (text: string) => {
      box.value = '';
      await act(async () => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
      const edit = el.querySelector<HTMLTextAreaElement>('.queued-edit')!;
      edit.value = text;
      await act(async () => edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      await settle();
    };
    await change('boom');
    expect([...el.querySelectorAll('.queued-text')].map((n) => n.textContent)).toEqual(['first']);
    expect(box.value).toBe('');
    await change('gone');
    expect(box.value).toBe('gone');
  });

  it('Stop puts what you queued back in the box', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    unqueuedOnStop = [{ id: 'q1', text: 'later one', ts: 0 }, { id: 'q2', text: 'later two', ts: 0 }];
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Stop"]')!.click());
    await settle();
    expect(el.querySelector('textarea')!.value).toBe('later one\n\nlater two');
  });

  it('typing "/" suggests the commands, then the agent’s own Claude Code ones', async () => {
    const el = await open();
    const box = el.querySelector('textarea')!;
    box.value = '/';
    await act(async () => box.dispatchEvent(new Event('input', { bubbles: true })));
    const names = [...el.querySelectorAll('.slash-menu .slash-name')].map((n) => n.textContent);
    expect(names).toEqual(['/queue', '/stop', '/resume', '/resend', '/loop', '/goal', '/compact', '/review']);
    expect(el.querySelector('.slash-menu')!.textContent).toContain('Review the changes · Claude Code');
    // a harness command goes in with a space, for what comes after it
    box.value = '/rev';
    await act(async () => box.dispatchEvent(new Event('input', { bubbles: true })));
    await act(async () => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(box.value).toBe('/review ');
    expect(requests.some((r) => r.method === 'POST' && r.url.endsWith('/stream'))).toBe(false);
  });

  it('/resume, /loop and /goal go to the server even while it works; the loop and goal show as chips', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    await type(el, '/resume');
    await settle();
    expect(requests.some((r) => r.method === 'POST' && r.url === '/api/agents/a1/chats/c1/resume')).toBe(true);
    await type(el, '/loop 15m check CI');
    await settle();
    expect(requests.find((r) => r.url === '/api/agents/a1/chats/c1/loop')!.body).toEqual({ text: '15m check CI', attachments: [] });
    await wsEvent({ type: 'loop', agentId: 'a1', chatId: 'c1', loop: { text: 'check CI', every: 900_000, times: 10, done: 1, next: null } });
    expect(el.querySelector('.cmd-chip.loop')!.textContent).toContain('every 15m · 1 of 10 sent');
    await type(el, '/goal the build is green');
    await settle();
    expect(requests.find((r) => r.url === '/api/agents/a1/chats/c1/goal')!.body).toEqual({ text: 'the build is green' });
    await wsEvent({ type: 'brief', projectId: 'p', brief: { id: 'b1', kind: 'agent', targetId: 'a1', chatId: 'c1', name: 'Renderer', text: 'the build is green', goal: 'the build is green', ts: 0, followUps: 1, status: 'open' } });
    expect(el.querySelector('.cmd-chip.goal')!.textContent).toContain('Goal: the build is green');
    expect(el.querySelector('.cmd-chip.goal')!.textContent).toContain('1 of 5 follow-ups');
    // × on the loop ends it (and leaves what you are typing alone)
    el.querySelector('textarea')!.value = 'half a thought';
    await act(async () => (el.querySelector('.cmd-chip.loop button') as HTMLButtonElement).click());
    await settle();
    expect(el.querySelector('textarea')!.value).toBe('half a thought');
    expect(requests.filter((r) => r.url === '/api/agents/a1/chats/c1/loop').at(-1)!.body).toEqual({ text: 'off', attachments: [] });
    // the goal reached: its chip goes
    await wsEvent({ type: 'brief', projectId: 'p', brief: { id: 'b1', kind: 'agent', targetId: 'a1', chatId: 'c1', name: 'Renderer', text: 'x', goal: 'x', ts: 0, followUps: 1, status: 'done' } });
    expect(el.querySelector('.cmd-chip.goal')).toBeNull();
    // none of them was sent to the agent as a message
    expect(requests.filter((r) => r.method === 'POST' && r.url.endsWith('/stream'))).toHaveLength(1);
  });

  it('/stop stops it like the button', async () => {
    const el = await open();
    await type(el, 'go');
    await settle();
    await type(el, '/stop');
    await settle();
    expect(requests.some((r) => r.method === 'POST' && r.url === '/api/agents/a1/chats/c1/stop')).toBe(true);
    expect(el.querySelector('textarea')!.value).toBe('');
  });

  it('the mini version (the Station panel): the last messages, tool calls still open', async () => {
    const el = await open('mini');
    expect(el.querySelector('.oc-mini-list')).not.toBeNull();
    expect(el.querySelector('.st-msg.user')).not.toBeNull();
    expect(el.querySelector('details.tool.small .tname')!.textContent).toBe('blender_run_python');
    expect(el.querySelector('.st-msg.cmp')).not.toBeNull();
  });
});

describe('@ to pick another agent', () => {
  const typeAt = async (box: HTMLTextAreaElement, text: string) => {
    box.value = text;
    box.setSelectionRange(text.length, text.length);
    await act(async () => {
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const key = (box: HTMLTextAreaElement, k: string) => act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

  it('typing @ shows the other agents; arrows and Enter pick one, and nothing is sent', async () => {
    state.data = {
      runs: [],
      approvals: [],
      agents: [
        { id: 'a1', name: 'Renderer', toolGroups: ['agents'] },
        { id: 'a2', name: 'Trend Scout', emoji: '🔭', specialty: 'finds trends' },
        { id: 'a3', name: 'Video Editor' },
      ],
    } as unknown as AppState;
    const el = await open();
    const box = el.querySelector('textarea')!;
    await typeAt(box, 'ask @');
    const opts = () => [...el.querySelectorAll('.mention-menu .tc-sopt')].map((b) => b.textContent);
    expect(opts()).toEqual(['🔭@Trend Scoutfinds trends', '🤖@Video Editor']);
    expect(el.querySelector('.mention-note')).toBeNull();
    await typeAt(box, 'ask @ed');
    expect(opts()).toEqual(['🤖@Video Editor']);
    await typeAt(box, 'ask @');
    await key(box, 'ArrowDown');
    expect(el.querySelector('.mention-menu .tc-sopt.on')!.textContent).toBe('🤖@Video Editor');
    await key(box, 'Enter');
    expect(box.value).toBe('ask @Video Editor ');
    expect(box.selectionStart).toBe(18);
    expect(el.querySelector('.mention-menu')).toBeNull();
    expect(requests.some((r) => r.url.endsWith('/stream') && r.method === 'POST')).toBe(false);
  });

  it('a name two agents share goes in with its id, so the right one is asked', async () => {
    state.data = {
      runs: [],
      approvals: [],
      agents: [
        { id: 'a1', name: 'Renderer', toolGroups: ['agents'] },
        { id: 'a2', name: 'Editor', specialty: 'cuts' },
        { id: 'a3', name: 'Editor', specialty: 'colour' },
      ],
    } as unknown as AppState;
    const el = await open();
    const box = el.querySelector('textarea')!;
    await typeAt(box, '@ed');
    await key(box, 'ArrowDown');
    await key(box, 'Tab');
    expect(box.value).toBe('@Editor [a3] ');
  });

  it('Escape closes it; an agent without Delegate says it needs it', async () => {
    state.data = { runs: [], approvals: [], agents: [{ id: 'a1', name: 'Renderer', toolGroups: [] }, { id: 'a2', name: 'Trend Scout' }] } as unknown as AppState;
    const el = await open('compact');
    const box = el.querySelector('textarea')!;
    await typeAt(box, '@tr');
    expect(el.querySelector('.mention-note')!.textContent).toContain('Renderer needs Delegate');
    await key(box, 'Escape');
    expect(el.querySelector('.mention-menu')).toBeNull();
    expect(box.value).toBe('@tr');
  });
});

describe('Rich answers', () => {
  it('an answer in OpenUI Lang shows as live components, not as code', async () => {
    chat.items = [
      { type: 'user', text: 'compare them' },
      { type: 'assistant', text: 'root = Card([title, body])\ntitle = CardHeader("Plan A wins")\nbody = TextContent("Cheaper and faster to ship.")' },
    ];
    const el = await open();
    // (while it loads, the code itself shows as a fallback: wait for the components)
    for (let i = 0; i < 200 && !el.querySelector('.oc-rich')?.textContent?.includes('Plan A wins'); i++) await settle();
    const rich = el.querySelector('.msg.assistant.rich .oc-rich')!;
    expect(rich.textContent).toContain('Plan A wins');
    expect(rich.textContent).toContain('Cheaper and faster to ship.');
    expect(rich.textContent).not.toContain('root =');
  }, 30_000);

  it('isRichCode() tells OpenUI Lang from markdown', () => {
    expect(isRichCode('root = Card([t])\nt = TextContent("hi")')).toBe(true);
    expect(isRichCode('Here is the plan:\n\n- one\n- two')).toBe(false);
    expect(isRichCode('```\nroot = Card([t])\n```')).toBe(false);
    // an example after some prose is markdown, not a Rich answer
    expect(isRichCode('You can write it like this:\n\nroot = Card([t])\nt = TextContent("hi")')).toBe(false);
    // other statements may come first, as long as there is a root
    expect(isRichCode('t = TextContent("hi")\nroot = Card([t])')).toBe(true);
  });
});

describe('a long chat', () => {
  // happy-dom draws nothing, so give it a layout: a 400px list, each message 100px tall
  const LIST = 400;
  const ROW = 100;
  const tops = new WeakMap<Element, number>();
  const isList = (el: Element) => el.classList.contains('messages') || el.classList.contains('ac-list');
  const contentHeight = (el: Element) => parseFloat((el.querySelector('.msg-window') as HTMLElement | null)?.style.height || '0');
  const maxTop = (el: Element) => Math.max(0, contentHeight(el) - LIST);
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return isList(this) ? LIST : this.classList.contains('msg-row') ? ROW : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return isList(this) ? LIST : 0;
    });
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
      return isList(this) ? Math.max(LIST, contentHeight(this)) : 0;
    });
    vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) {
      return tops.get(this) ?? 0;
    });
    vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, v: number) {
      tops.set(this, Math.min(Math.max(0, v), maxTop(this)));
    });
    vi.spyOn(Element.prototype, 'scrollTo').mockImplementation(function (this: Element, a?: ScrollToOptions | number) {
      if (typeof a === 'object' && a.top != null) this.scrollTop = a.top;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const many = (n: number): ChatItem[] => Array.from({ length: n }, (_, i): ChatItem => (i % 2 ? { type: 'assistant', text: `answer ${i}` } : { type: 'user', text: `question ${i}` }));
  const drawn = (el: HTMLElement) => [...el.querySelectorAll('.msg-row')].map((r) => r.textContent?.trim());
  // (and wait for the scrolling to settle: the list notes where it stopped a moment after)
  const rest = () => act(() => new Promise((r) => setTimeout(r, 200)));
  const scrollTo = async (list: HTMLElement, top: number) => {
    list.scrollTop = top;
    await act(async () => void list.dispatchEvent(new Event('scroll')));
    await rest();
  };

  it('draws only the messages near the screen, starting at the newest; scrolling up draws the older ones', async () => {
    chat.items = many(400);
    const el = await open();
    await rest();
    const list = el.querySelector<HTMLElement>('.messages')!;
    expect(list.querySelector('.msg-window')).not.toBeNull();
    // (the window is sized for every message, drawn or not, so the scrollbar is right)
    expect(contentHeight(list)).toBeGreaterThan(400 * 50);
    const rows = drawn(el);
    expect(rows.length).toBeLessThan(30);
    expect(rows).toContain('answer 399');
    expect(rows).not.toContain('question 0');
    await scrollTo(list, 0);
    expect(drawn(el)).toContain('question 0');
    expect(drawn(el)).not.toContain('answer 399');
  });

  it('a tool call you opened is still open when you scroll back to it', async () => {
    chat.items = [{ type: 'user', text: 'go' }, { type: 'tool', id: 'tk', name: 'look_around', args: {}, result: 'ok', status: 'done' }, ...many(200)];
    const el = await open();
    await rest();
    const list = el.querySelector<HTMLElement>('.messages')!;
    await scrollTo(list, 0);
    const card = () => el.querySelector<HTMLDetailsElement>('details.tool');
    card()!.open = true;
    await act(async () => void card()!.dispatchEvent(new Event('toggle')));
    await scrollTo(list, maxTop(list));
    expect(card()).toBeNull();
    await scrollTo(list, 0);
    expect(card()!.open).toBe(true);
  });

  it('the floating window shows the whole chat too, not just its last messages', async () => {
    chat.items = many(300);
    const el = await open('compact');
    await rest();
    const list = el.querySelector<HTMLElement>('.ac-list')!;
    // (the chat keeps to the bottom as its messages measure taller than guessed; a browser then fires
    // a scroll event, which happy-dom doesn't, so send it)
    await act(async () => void list.dispatchEvent(new Event('scroll')));
    await rest();
    expect(drawn(el)).toContain('answer 299');
    await scrollTo(list, 0);
    expect(drawn(el)).toContain('question 0');
  });

  it('a short chat draws every message, as before', async () => {
    chat.items = many(20);
    const el = await open();
    expect(el.querySelector('.msg-window')).toBeNull();
    expect(el.querySelectorAll('.msg').length).toBe(20);
  });
});
