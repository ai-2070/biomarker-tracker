// The MEMORY.md editor: loads, saves only real changes, follows what the agent writes meanwhile, and
// doesn't throw away what you typed when it does.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectEvents } from '../../web/core.ts';
import { memoryEditor, openMemory } from '../../web/memory.ts';
import type { MemoryInfo } from '../../shared/types.ts';

const tick = () => new Promise((r) => setTimeout(r, 10));

// The server: one memory, the PUTs it got, and a socket to send live events through.
let stored: MemoryInfo;
let puts: { url: string; text: string }[];
let socket: { onmessage?: (m: { data: string }) => void } = {};
beforeEach(() => {
  document.body.innerHTML = '<div id="toasts"></div><div id="modal-root"></div>';
  stored = { owner: 'a1', name: 'Writer', text: '- Likes lists.\n', updatedAt: Date.now() - 60_000, max: 50_000 };
  puts = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const { text } = JSON.parse(String(init.body)) as { text: string };
      puts.push({ url: String(url), text });
      stored = { ...stored, text, updatedAt: Date.now() };
    }
    return new Response(JSON.stringify(String(url).includes('/versions/') ? { kind: 'memory', id: 'a1', name: "Writer's MEMORY.md", current: stored.text, versions: [] } : stored), { status: 200 });
  });
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor() {
        socket = this as unknown as typeof socket;
      }
    },
  );
  connectEvents();
});
const event = (ev: Record<string, unknown>) => socket.onmessage?.({ data: JSON.stringify({ ts: Date.now(), ...ev }) });

const mounted = async (owner = 'a1') => {
  const ed = memoryEditor(owner);
  document.body.append(ed.el);
  await tick();
  const area = ed.el.querySelector('textarea')!;
  const button = (label: string) => Array.from(ed.el.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
  const type = (text: string) => {
    area.value = text;
    area.dispatchEvent(new Event('input'));
  };
  return { ed, area, button, type };
};

describe('the MEMORY.md editor', () => {
  it('shows the memory, saves only when it changed, and can undo what you typed', async () => {
    const { ed, area, button, type } = await mounted();
    expect(area.value).toBe('- Likes lists.\n');
    expect(ed.el.textContent).toContain('changed 1m ago');
    expect(button('Save').disabled).toBe(true);
    type('- Likes short lists.\n');
    expect(ed.dirty()).toBe(true);
    expect(ed.el.textContent).toContain('not saved');
    button('Undo changes').click();
    expect(area.value).toBe('- Likes lists.\n');
    expect(button('Save').disabled).toBe(true);
    type('- Likes short lists.\n');
    button('Save').click();
    await tick();
    expect(puts).toEqual([{ url: '/api/memory/a1', text: '- Likes short lists.\n' }]);
    expect(ed.dirty()).toBe(false);
  });

  it('follows changes the agent makes, but keeps your unsaved text and says so', async () => {
    const { ed, area, button, type } = await mounted();
    stored = { ...stored, text: '- Likes lists.\n- Ships Fridays.\n' };
    event({ type: 'memory', owner: 'a1' });
    await tick();
    expect(area.value).toBe('- Likes lists.\n- Ships Fridays.\n');
    // someone else's memory: nothing happens
    stored = { ...stored, text: 'other' };
    event({ type: 'memory', owner: 'b2' });
    await tick();
    expect(area.value).toContain('Ships Fridays');
    // you're typing: your text stays, with a note
    stored = { ...stored, text: '- From the agent.\n' };
    type('- Mine.\n');
    event({ type: 'memory', owner: 'a1' });
    await tick();
    expect(area.value).toBe('- Mine.\n');
    expect(ed.el.textContent).toContain('changed it while you were editing');
    button('Show its version').click();
    await tick();
    expect(area.value).toBe('- From the agent.\n');
    expect(ed.dirty()).toBe(false);
  });

  it("warns when it's too long", async () => {
    const { ed, type, button } = await mounted();
    type('x'.repeat(50_001));
    expect(ed.el.querySelector('.memory-status')!.classList.contains('warn')).toBe(true);
    expect(ed.el.textContent).toContain('too long');
    expect(button('Save').disabled).toBe(false);
  });

  it("opens the Brain's in a window", async () => {
    stored = { ...stored, owner: 'brain', name: 'The Brain', text: '- Short answers.\n' };
    openMemory('brain');
    await tick();
    const win = document.querySelector('#modal-root')!;
    expect(win.textContent).toContain('The Brain · MEMORY.md');
    expect(win.textContent).toContain('PROJECT.md');
    expect(win.querySelector('textarea')!.value).toBe('- Short answers.\n');
  });
});
