// Long text pasted into a chat box (an agent's, a team's, the Brain's) shows as one short marker,
// "[Pasted text #1 · 52 lines]", so the box stays readable. A chip above the box (or a click on the
// marker) opens what was pasted; the full text goes back in the marker's place when the message is sent.
import { h, mount, modal, copy } from './core.ts';
import { icon } from './icons.ts';
import { pasteHasFiles, restoreDraft } from './attach.ts';

/** A paste longer than this (in lines or characters) is folded into a marker. */
export const LONG_LINES = 10;
export const LONG_CHARS = 800;

export const isLongPaste = (text: string): boolean => text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;

/** "Pasted text #1 · 52 lines" (or "· 1,200 characters" for one long line). */
export function pasteLabel(n: number, text: string): string {
  const lines = text.split('\n').length;
  return `Pasted text #${n} · ${lines > 1 ? `${lines.toLocaleString('en-US')} lines` : `${text.length.toLocaleString('en-US')} characters`}`;
}

const MARKER = /\[Pasted text #(\d+)[^\]\n]*\]/g;

/** The text with each known marker swapped for what was pasted (unknown ones stay as they are). */
export function expandPastes(text: string, pasted: ReadonlyMap<number, string>): string {
  return text.replace(MARKER, (m: string, n: string) => pasted.get(Number(n)) ?? m);
}

interface Paste {
  n: number;
  text: string;
  marker: string;
}

export interface PasteBox {
  /** The chips, one per paste still in the box (hidden while there are none). */
  el: HTMLDivElement;
  /** Start folding long pastes in this box; returns a function that stops it. */
  attach: (input: HTMLTextAreaElement) => () => void;
  /** What is in the box, with the pasted texts put back. */
  text: () => string;
  /** restoreDraft(), with the pasted texts folded back into their markers. */
  restore: (text: string) => void;
  /** Redraw the chips after the box was changed in code (cleared, filled). */
  sync: () => void;
}

export function pasteBox(): PasteBox {
  const el = h('div.att-tray.paste-tray.hidden');
  const pastes = new Map<number, Paste>();
  let next = 1;
  let input: HTMLTextAreaElement | null = null;

  // where each paste's marker is in the box now
  const found = (): { p: Paste; start: number; end: number }[] => {
    const out: { p: Paste; start: number; end: number }[] = [];
    for (const m of (input?.value || '').matchAll(MARKER)) {
      const p = pastes.get(Number(m[1]));
      if (p) out.push({ p, start: m.index, end: m.index + m[0].length });
    }
    return out;
  };

  // Change part of the box the way typing would, so Ctrl+Z undoes it and the box hears about it.
  const replace = (start: number, end: number, text: string) => {
    if (!input) return;
    input.focus();
    input.setSelectionRange(start, end);
    const done = typeof document.execCommand === 'function' && document.execCommand(text ? 'insertText' : 'delete', false, text);
    if (!done) {
      input.setRangeText(text, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    sync();
  };
  const at = (p: Paste) => found().find((f) => f.p === p);

  const view = (p: Paste) => {
    const m = modal({
      title: p.marker.slice(1, -1),
      body: h('pre.paste-view', { class: 'm-0 max-h-[60vh] overflow-auto rounded-ctl border border-line bg-bg px-3.5 py-3 font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap wrap-anywhere' }, p.text),
      foot: [
        h('button.btn.ghost', { onclick: () => (m.close(), remove(p)) }, icon('x', 13), 'Remove'),
        h('button.btn.ghost', { onclick: () => copy(p.text) }, icon('copy', 13), 'Copy'),
        h('button.btn.ghost', { title: 'Put the whole text in the message box, to change it', onclick: () => (m.close(), unfold(p)) }, 'Edit in the box'),
        h('button.btn', { onclick: () => m.close() }, 'Close'),
      ],
    });
  };
  const remove = (p: Paste) => {
    const f = at(p);
    if (f) replace(f.start, f.end, '');
  };
  const unfold = (p: Paste) => {
    const f = at(p);
    if (f) replace(f.start, f.end, p.text);
  };

  const chip = (p: Paste) =>
    h(
      'div.att-chip',
      { class: 'py-0 pr-1.5 pl-0 hover:border-accent-dim' },
      h('button.paste-open', { class: 'inline-flex min-w-0 cursor-pointer items-center gap-1.5 py-1 pr-0 pl-1.5 hover:text-accent', type: 'button', title: 'See what you pasted', onclick: () => view(p) }, h('span.att-ico', icon('file-text', 14)), h('span.att-name', p.marker.slice(1, -1))),
      h('button.att-x', { type: 'button', title: 'Remove', 'aria-label': `Remove ${p.marker.slice(1, -1)}`, onclick: () => remove(p) }, icon('x', 12)),
    );
  let shown = '';
  function sync() {
    const now = found().map((f) => f.p);
    const key = now.map((p) => p.n).join(',');
    if (key === shown) return;
    shown = key;
    el.classList.toggle('hidden', !now.length);
    mount(el, now.map(chip));
  }

  const onPaste = (e: ClipboardEvent) => {
    const dt = e.clipboardData;
    if (!input || e.defaultPrevented || !dt || pasteHasFiles(dt)) return;
    const text = dt.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!isLongPaste(text)) return;
    e.preventDefault();
    const n = next++;
    const p: Paste = { n, text, marker: `[${pasteLabel(n, text)}]` };
    pastes.set(n, p);
    replace(input.selectionStart, input.selectionEnd, p.marker);
  };
  // a click inside a marker opens it
  const onClick = () => {
    if (!input || input.selectionStart !== input.selectionEnd) return;
    const c = input.selectionStart;
    const f = found().find((x) => x.start < c && c < x.end);
    if (f) view(f.p);
  };
  // Backspace just after a marker (or Delete just before one) takes the whole marker
  const onKey = (e: KeyboardEvent) => {
    if (!input || (e.key !== 'Backspace' && e.key !== 'Delete') || input.selectionStart !== input.selectionEnd) return;
    const c = input.selectionStart;
    const f = found().find((x) => (e.key === 'Backspace' ? x.end === c : x.start === c));
    if (!f) return;
    e.preventDefault();
    replace(f.start, f.end, '');
  };

  return {
    el,
    attach: (box) => {
      input = box;
      box.addEventListener('paste', onPaste);
      box.addEventListener('click', onClick);
      box.addEventListener('keydown', onKey);
      box.addEventListener('input', sync);
      sync();
      return () => {
        box.removeEventListener('paste', onPaste);
        box.removeEventListener('click', onClick);
        box.removeEventListener('keydown', onKey);
        box.removeEventListener('input', sync);
        if (input === box) input = null;
      };
    },
    text: () => expandPastes(input?.value || '', new Map([...pastes].map(([n, p]) => [n, p.text]))),
    restore: (text) => {
      if (!input) return;
      // (the longest first, so one paste inside another can't break it up)
      let folded = text;
      for (const p of [...pastes.values()].sort((a, b) => b.text.length - a.text.length)) {
        const i = folded.indexOf(p.text);
        if (i >= 0) folded = folded.slice(0, i) + p.marker + folded.slice(i + p.text.length);
      }
      restoreDraft(input, folded);
      sync();
    },
    sync,
  };
}
