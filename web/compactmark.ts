// The "— COMPACTED —" marker in a chat: opens to show what the agent now remembers of the messages
// above it (the compacted history), and lets you edit the latest one.
import { h, mount, PUT, attempt } from './core.ts';
import { kTokens } from '../shared/compaction.ts';
import type { CompactionItem } from '../shared/types.ts';

export interface MarkOptions {
  /** Where to save an edit (/agents/:id/chats/:cid). Without it the marker is read-only. */
  chatPath?: string;
  /** Only the latest compaction can be edited: the agent no longer reads the older ones. */
  latest: boolean;
  /** The chat is answering right now (edits wait until it is done). */
  busy?: boolean;
  /** After a saved edit. */
  onSaved?: () => void;
  compact?: boolean;
}

// the dashed line on each side of COMPACTED
const RULE = 'min-w-4 flex-1 border-t border-dashed border-current opacity-60';

const TRIGGER: Record<string, string> = { auto: 'automatic', manual: 'by you', overflow: 'the model said it was too long' };

export function compactionMark(item: CompactionItem, o: MarkOptions): HTMLElement {
  const engine = item.mode === 'engine';
  const facts = [
    engine ? 'by the engine' : item.mode,
    TRIGGER[item.trigger] || item.trigger,
    item.tokensBefore != null && item.tokensAfter != null ? `about ${kTokens(item.tokensBefore)} → ${kTokens(item.tokensAfter)} tokens` : item.tokensBefore != null ? `was about ${kTokens(item.tokensBefore)} tokens` : '',
    item.editedAt ? 'edited' : '',
  ].filter(Boolean);
  const body = h('div', { class: 'mt-1.5 mb-1 flex flex-col gap-2 rounded-[8px] border border-line bg-panel-2 px-3 py-2.5 [&_.hint]:m-0' });
  const show = () => {
    if (engine) {
      mount(body, h('p.hint', 'Claude Code compacted its own memory of this chat here. It keeps that summary itself, so there is nothing to show or edit. Everything above is still in this chat.'));
      return;
    }
    const canEdit = !!o.chatPath && o.latest;
    mount(
      body,
      item.note ? h('p.hint.warn', item.note) : null,
      h(
        'p.hint',
        o.latest
          ? 'This is what the agent now remembers of the dimmed messages above; the latest messages stay in full. The messages themselves are all still here, and the agent can read any of them back word for word (recall_history).'
          : 'An earlier compaction. A later one includes it, so the agent no longer reads this text directly.',
      ),
      h('pre.cmp-text', { class: `m-0 overflow-auto font-mono text-[11.5px] leading-[1.5] whitespace-pre-wrap wrap-anywhere ${o.compact ? 'max-h-65' : 'max-h-[420px]'}` }, item.text),
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-1.5' },
        canEdit ? h('button.btn.tiny', { disabled: o.busy, title: o.busy ? 'Wait until the agent is done' : 'Change what the agent remembers', onclick: edit }, 'Edit') : null,
        h('button.btn.tiny.ghost', { onclick: () => navigator.clipboard?.writeText(item.text).catch(() => {}) }, 'Copy'),
        h('span.hint', `${item.text.length.toLocaleString()} characters`),
      ),
    );
  };
  const edit = () => {
    const ta = h('textarea.code', { class: 'min-h-65 w-full resize-y font-mono text-[11.5px] leading-[1.5]', rows: 16, value: item.text });
    const save = async () => {
      const ok = await attempt(() => PUT(`${o.chatPath}/compactions/${item.id}`, { text: ta.value }), 'Saved: the agent works from your version now');
      if (!ok) return;
      item.text = ta.value;
      item.editedAt = Date.now();
      show();
      o.onSaved?.();
    };
    mount(
      body,
      h('p.hint', 'Edit what the agent remembers of the messages above. Its next message works from this text.'),
      ta,
      h('div', { class: 'flex flex-wrap items-center gap-1.5' }, h('button.btn.tiny', { onclick: save }, 'Save'), h('button.btn.tiny.ghost', { onclick: show }, 'Cancel')),
    );
    ta.focus();
  };
  show();
  return h(
    `details.compaction${o.compact ? '.small' : ''}${engine ? '.engine' : ''}`,
    h('summary', { title: engine ? 'The engine compacted its own memory here' : 'Show what the agent remembers of the messages above' }, h('span', { class: RULE }), h('span.font-bold', 'COMPACTED'), h('span', { class: o.compact ? 'hidden' : 'min-w-0 truncate tracking-[0.02em] text-faint' }, facts.join(' · ')), h('span', { class: RULE })),
    body,
  );
}
