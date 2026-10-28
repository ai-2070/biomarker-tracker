// Your /queue messages, in the order they will go: click one (or press Up in an empty message box) to change
// it, drag one (or Alt+Up / Alt+Down) to change the order, × takes one back.
import { useEffect, useRef, useState } from 'react';
import { toast } from './core.ts';
import { Icon } from './ui/react.tsx';
import type { QueuedMessage } from '../shared/types.ts';

// (a drag inside the list: its own type, so the message box and the file drop zones ignore it)
const DRAG_TYPE = 'application/x-queued-message';
// a line where the dragged message will land
const DROP_ABOVE = 'relative before:absolute before:-top-0.5 before:right-2 before:left-2 before:h-0.5 before:rounded-[1px] before:bg-accent';
const DROP_BELOW = 'relative after:absolute after:right-2 after:-bottom-0.5 after:left-2 after:h-0.5 after:rounded-[1px] after:bg-accent';

/** A change to a queued message that couldn't be kept (it was sent meanwhile): into the message box
 *  (restore puts it there), if that is empty. */
export function keepLostEdit(text: string, box: HTMLTextAreaElement | null | undefined, restore: (text: string) => void): void {
  if (!text || box?.value.trim()) return;
  restore(text);
  toast('That message was already sent. Your change is in the box.');
}

/** Where editing goes when one message is done: nowhere (clicked away), the one above or below, or back to the message box. */
type Then = 'stay' | 'prev' | 'next' | 'leave';

export interface QueuedListProps {
  items: QueuedMessage[];
  /** the line above them ("Sends when the team is done") */
  head: string;
  compact?: boolean;
  /** the message being changed (its id), or null */
  editing: string | null;
  onEditing: (id: string | null) => void;
  /** new text for one (not empty, and different) */
  onSave: (q: QueuedMessage, text: string) => void;
  onRemove: (q: QueuedMessage) => void;
  /** every id, in the new order */
  onOrder: (ids: string[]) => void;
  /** editing ended from the keyboard (Enter, Esc, Down past the last one): back to the message box */
  onLeave?: () => void;
  /** the one being changed went (it was sent meanwhile): what you had typed, if it differs */
  onLost?: (q: QueuedMessage, text: string) => void;
  /** a few words after one (who it goes to), or nothing */
  hint?: (q: QueuedMessage) => string | null;
}

export function QueuedList({ items, head, compact = false, editing, onEditing, onSave, onRemove, onOrder, onLeave, onLost, hint }: QueuedListProps) {
  const root = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  // (taken back with × while being changed: what was typed goes with it)
  const removing = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; below: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = items.map((q) => q.id);
  const now = editing && ids.includes(editing) ? editing : null;

  const move = (id: string, to: number) => {
    const without = ids.filter((x) => x !== id);
    const next = [...without.slice(0, to), id, ...without.slice(to)];
    if (next.join() !== ids.join()) onOrder(next);
  };
  // (moved with the keyboard: the row is redrawn in its new place, keep the focus on it)
  const focusLater = (id: string) => setTimeout(() => root.current?.querySelector<HTMLElement>(`[data-qid="${CSS.escape(id)}"] .queued-text`)?.focus(), 0);

  const finish = (q: QueuedMessage, text: string | null, then: Then) => {
    if (text != null) {
      const next = text.trim();
      if (!next && !q.attachments?.length) toast('A queued message needs some words. Take it off the list with × instead.');
      else if (next !== q.text) onSave(q, next);
    }
    const i = ids.indexOf(q.id);
    if (then === 'prev' && i > 0) return onEditing(ids[i - 1]);
    if (then === 'next' && i >= 0 && i < ids.length - 1) return onEditing(ids[i + 1]);
    onEditing(null);
    if (then !== 'stay') onLeave?.();
  };

  const endDrag = () => {
    dragId.current = null;
    setDragging(null);
    setDrop(null);
  };

  if (!items.length) return null;
  const many = items.length > 1;
  return (
    <div className={compact ? 'queued-list compact' : 'queued-list'} ref={root}>
      <div className="queued-head">{head}</div>
      {items.map((q, i) => {
        const open = now === q.id;
        const mark = drop?.id === q.id ? (drop.below ? DROP_BELOW : DROP_ABOVE) : '';
        return (
          <div
            key={q.id}
            data-qid={q.id}
            className={`queued-msg ${mark} ${dragging === q.id ? 'opacity-40' : ''}`}
            draggable={many && !open}
            onDragStart={(e) => {
              dragId.current = q.id;
              e.dataTransfer.setData(DRAG_TYPE, q.id);
              e.dataTransfer.effectAllowed = 'move';
              // (faded a moment later: the drag picture is taken from the row as it is now)
              setTimeout(() => setDragging(q.id), 0);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              const from = dragId.current;
              if (!from) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const box = e.currentTarget.getBoundingClientRect();
              const below = e.clientY > box.top + box.height / 2;
              // (dropped next to itself, or just under the one above it: it stays put, so no line)
              const stays = from === q.id || (below ? ids[i + 1] === from : ids[i - 1] === from);
              const want = stays ? null : { id: q.id, below };
              if (want?.id !== drop?.id || want?.below !== drop?.below) setDrop(want);
            }}
            onDrop={(e) => {
              const from = dragId.current;
              if (!from) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              const below = e.clientY > box.top + box.height / 2;
              endDrag();
              if (from === q.id) return;
              const without = ids.filter((x) => x !== from);
              move(from, without.indexOf(q.id) + (below ? 1 : 0));
            }}
          >
            {many ? (
              <span className="flex flex-none cursor-grab text-faint" title="Drag to change the order">
                <Icon name="grip-vertical" size={12} />
              </span>
            ) : null}
            <Icon name="clock" size={12} />
            {open ? (
              <QueuedEditor key={q.id} q={q} hasPrev={i > 0} onFinish={(text, then) => finish(q, text, then)} onLost={(text) => removing.current !== q.id && onLost?.(q, text)} />
            ) : (
              <button
                type="button"
                className="queued-text cursor-text border-0 bg-transparent p-0 text-left text-inherit hover:text-ink focus-visible:text-ink"
                title={many ? 'Click to change it. Drag to change the order (or Alt+Up / Alt+Down).' : 'Click to change it'}
                onClick={() => onEditing(q.id)}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const to = i + (e.key === 'ArrowUp' ? -1 : 1);
                  if (to < 0 || to >= ids.length) return;
                  move(q.id, to);
                  focusLater(q.id);
                }}
              >
                {q.text || `${q.attachments?.length || 0} file(s)`}
              </button>
            )}
            {hint?.(q) ? <span className="hint">{hint(q)}</span> : null}
            <button type="button" className="tc-act" title="Don't send this" aria-label="Don't send this" onMouseDown={(e) => open && e.preventDefault()} onClick={() => ((removing.current = q.id), onRemove(q))}>
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// The box a queued message turns into while you change it. Enter keeps the change, Esc drops it, clicking
// away keeps it; Up at its start and Down at its end go on to the one above or below.
function QueuedEditor({ q, hasPrev, onFinish, onLost }: { q: QueuedMessage; hasPrev: boolean; onFinish: (text: string | null, then: Then) => void; onLost: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const lost = useRef(onLost);
  lost.current = onLost;
  const was = useRef(q.text);
  useEffect(() => {
    const t = ref.current!;
    // (React's dev mode mounts it twice: the second mount starts over)
    done.current = false;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
    // gone before you finished (it was sent meanwhile): what you typed isn't thrown away
    return () => {
      if (done.current) return;
      done.current = true;
      if (t.value.trim() !== was.current) lost.current(t.value.trim());
    };
  }, []);
  const finish = (save: boolean, then: Then) => {
    if (done.current) return;
    done.current = true;
    onFinish(save ? ref.current!.value : null, then);
  };
  return (
    <textarea
      ref={ref}
      className="queued-edit field-sizing-content max-h-40 min-h-0 min-w-0 flex-1 resize-none px-1.5 py-0.5 text-[12.5px]"
      rows={1}
      defaultValue={q.text}
      aria-label="Change this queued message"
      onKeyDown={(e) => {
        // (the chat's own keys, and the page's, stay out of it)
        e.stopPropagation();
        const t = e.currentTarget;
        const caret = t.selectionStart === t.selectionEnd ? t.selectionStart : -1;
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true, 'leave');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false, 'leave');
        } else if (e.key === 'ArrowUp' && hasPrev && caret === 0 && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          finish(true, 'prev');
        } else if (e.key === 'ArrowDown' && caret === t.value.length && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          finish(true, 'next');
        }
      }}
      onBlur={() => finish(true, 'stay')}
    />
  );
}
