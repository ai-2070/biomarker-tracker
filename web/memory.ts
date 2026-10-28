// MEMORY.md on the page: read and edit what an agent (or the Brain) remembers across its chats.
// The same editor sits in the agent editor and opens as a window from chats and the Brain chat.
import { h, mount, GET, PUT, attempt, modal, ago, onEvent, onState, state, confirmBox } from './core.ts';
import { icon } from './icons.ts';
import { historyButton } from './history.ts';
import type { MemoryInfo } from '../shared/types.ts';

// an amber note above the editor (the same as the backup warnings in backup.ts)
const WARN = 'm-0 flex items-start gap-1.5 rounded-[8px] border border-[color-mix(in_srgb,var(--color-amber)_30%,var(--color-line))] bg-amber/10 px-2.5 py-2 text-[13px] text-amber';

/** The Brain's memory goes by this owner (an agent's by its id). */
export const BRAIN = 'brain';

export interface MemoryEditor {
  el: HTMLElement;
  /** there are changes not saved yet */
  dirty: () => boolean;
}

const size = (n: number) => (n < 1000 ? `${n} characters` : `${(n / 1000).toFixed(1)}k characters`);

/** The editor for one MEMORY.md. rows: the height of the text box. */
export function memoryEditor(owner: string, { rows = 12 }: { rows?: number } = {}): MemoryEditor {
  const brain = owner === BRAIN;
  let loaded: MemoryInfo | null = null;
  // the text as it was loaded: what "Undo changes" goes back to
  let base = '';
  // it changed elsewhere (the agent wrote to it) while you had changes here
  let changedElsewhere = false;
  // another project was opened: this one isn't the open project's any more
  let gone = false;
  const project = state.data?.project?.id ?? null;

  const area = h('textarea.code', {
    class: 'min-h-40 w-full resize-y leading-[1.55]',
    rows,
    spellcheck: false,
    placeholder: brain
      ? 'Nothing yet. The Brain adds what it learns about how you like to work. You can also write notes here yourself, e.g. "Keep answers short." or "Ask before building a new team."'
      : 'Nothing yet. The agent adds what it learns as it works. You can also write notes here yourself, e.g. "Use British spelling." or "The client is called Northwind."',
    oninput: () => draw(),
    onkeydown: (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    },
  });
  const status = h('div.hint.memory-status', { class: '[&.warn]:text-amber' });
  const note = h('div', { class: 'empty:hidden' });
  const saveBtn = h('button.btn.small', { type: 'button', onclick: () => save() }, 'Save');
  const undoBtn = h('button.btn.ghost.small', { type: 'button', onclick: () => ((area.value = base), draw()) }, 'Undo changes');
  const dirty = () => !!loaded && area.value !== base;

  const draw = () => {
    const d = dirty();
    saveBtn.disabled = !d || gone;
    undoBtn.disabled = !d;
    area.disabled = gone;
    const len = area.value.length;
    const over = loaded ? len > loaded.max : false;
    status.textContent = loaded
      ? `${len ? size(len) : 'Empty'}${over ? ` · too long (up to ${size(loaded.max)})` : ''} · ${loaded.updatedAt ? `changed ${ago(loaded.updatedAt)}` : 'never written'}${d ? ' · not saved' : ''}`
      : 'Loading…';
    status.classList.toggle('warn', over);
    mount(
      note,
      gone
        ? h('p', { class: WARN }, icon('triangle-alert', 14, 'mt-0.5 flex-none'), ' You opened another project. This MEMORY.md belongs to the one before, so it can’t be saved here.')
        : changedElsewhere
          ? h('p', { class: WARN }, icon('triangle-alert', 14, 'mt-0.5 flex-none'), ` ${brain ? 'The Brain' : 'The agent'} changed it while you were editing. Save keeps your text; `, h('button.btn.tiny.ghost', { type: 'button', onclick: () => load(true) }, 'Show its version'), ' drops your changes.')
          : null,
    );
  };

  const load = async (force = false) => {
    if (dirty() && !force) {
      changedElsewhere = true;
      return draw();
    }
    const m = await GET<MemoryInfo>(`/memory/${encodeURIComponent(owner)}`).catch(() => null);
    if (!m || typeof m.text !== 'string') {
      status.textContent = 'Couldn’t load MEMORY.md.';
      return;
    }
    // (typing meanwhile wins: only put the text in when nothing was changed here)
    if (dirty() && !force) {
      changedElsewhere = true;
      loaded = m;
      return draw();
    }
    loaded = m;
    base = m.text;
    area.value = m.text;
    changedElsewhere = false;
    draw();
  };

  const save = async () => {
    if (!dirty() || gone) return;
    const text = area.value;
    const m = await attempt(() => PUT<MemoryInfo>(`/memory/${encodeURIComponent(owner)}`, { text }), 'Saved MEMORY.md');
    if (!m) return;
    loaded = m;
    base = m.text;
    // (the server tidies line ends; keep what's typed when it means the same)
    if (area.value === text) area.value = m.text;
    changedElsewhere = false;
    draw();
  };

  const el = h(
    'div',
    { class: 'flex flex-col gap-2.5' },
    h(
      'p.hint',
      brain
        ? 'What the Brain remembers across its conversations in this project: how you like it to work, decisions, lessons. It reads this with every message and adds to it as it learns. Facts every agent needs belong in PROJECT.md.'
        : 'What this agent remembers across all its chats in this project. It reads this with every message and adds to it as it learns. Change or remove anything. (Not the same as a chat’s memory, which Clear memory resets.)',
    ),
    note,
    area,
    h('div', { class: 'flex flex-wrap items-center justify-between gap-2.5' }, status, h('div', { class: 'flex flex-wrap items-center gap-1.5' }, historyButton('memory', owner, () => load(true)), undoBtn, saveBtn)),
  );

  // live: the agent (or the Brain) wrote to it, or another tab did
  const offEvent = onEvent((ev) => {
    if (!el.isConnected && loaded) return stop();
    if (ev.type === 'memory' && ev.owner === owner && (!ev.project || ev.project === project)) void load();
  });
  const offState = onState((d) => {
    if (!el.isConnected && loaded) return stop();
    if (!gone && project && d.project?.id && d.project.id !== project) {
      gone = true;
      draw();
    }
  });
  const stop = () => {
    offEvent();
    offState();
  };
  draw();
  void load();
  return { el, dirty };
}

/** A window with the MEMORY.md of an agent (its id) or the Brain (BRAIN). */
export function openMemory(owner: string, name = owner === BRAIN ? 'The Brain' : 'Agent'): void {
  const ed = memoryEditor(owner, { rows: 18 });
  let m: ReturnType<typeof modal>;
  const close = async () => {
    if (ed.dirty() && !(await confirmBox('Close without saving your changes to MEMORY.md?', { ok: 'Close', danger: true }))) return;
    m.close();
  };
  m = modal({ title: h('span', icon('file-text', 16), ` ${name} · MEMORY.md`), body: ed.el, foot: [h('button.btn.ghost', { onclick: close }, 'Close')] });
  m.el.classList.add('[&_.modal]:w-[min(760px,100%)]');
  setTimeout(() => ed.el.querySelector('textarea')?.focus(), 30);
}

/** A button that opens it. */
export function memoryButton(owner: string, name?: string, cls = 'button.btn.ghost.small'): HTMLButtonElement {
  return h(cls, { type: 'button', title: 'What it remembers across chats: read and edit', onclick: () => openMemory(owner, name) }, icon('file-text', 13), 'MEMORY.md') as HTMLButtonElement;
}
