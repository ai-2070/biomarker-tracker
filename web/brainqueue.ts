// Messages to the Brain go one at a time (the server saves each turn on top of the history), so a
// message can wait behind another. Each one belongs to the project and conversation it was typed
// in: if you switch projects or start a new conversation before it is sent, it isn't sent; if that
// happens while it is being answered, the answer is dropped.

import { reorderQueued } from '../shared/queue.ts';

export type BrainTurn<T> = { kind: 'answer'; answer: T } | { kind: 'error'; error: string } | { kind: 'stale' };

export interface BrainQueue<T, X = undefined> {
  /** Send text, typed in project. currentProject says which project is open now. A message typed before
   *  the project was known (null) goes stale as soon as one is: it was never meant for that project.
   *  extra: anything else the message carries (its attachments), handed to post as is. */
  ask(text: string, project: string | null, currentProject: () => string | null, extra?: X): Promise<BrainTurn<T>>;
  /** Forget every waiting and pending message (new conversation, other project). */
  reset(): void;
}

export function brainQueue<T, X = undefined>(post: (text: string, project: string | null, extra?: X) => Promise<T>): BrainQueue<T, X> {
  let turn: Promise<unknown> = Promise.resolve();
  let conversation = 0;
  return {
    ask(text, project, currentProject, extra) {
      const mine = conversation;
      const stale = () => mine !== conversation || currentProject() !== project;
      const next = turn.then(async (): Promise<BrainTurn<T>> => {
        if (stale()) return { kind: 'stale' };
        try {
          const answer = await post(text, project, extra);
          return stale() ? { kind: 'stale' } : { kind: 'answer', answer };
        } catch (e) {
          return stale() ? { kind: 'stale' } : { kind: 'error', error: (e as Error).message || String(e) };
        }
      });
      turn = next;
      return next;
    },
    reset() {
      conversation++;
    },
  };
}

// Of overlapping loads (e.g. the Brain chat history while you switch projects), only the newest may
// fill the view: start() gives each load a check that stays true until a newer load starts or reset().
export function latestLoad(): { start(): () => boolean; reset(): void } {
  let n = 0;
  return {
    start() {
      const mine = ++n;
      return () => mine === n;
    },
    reset() {
      n++;
    },
  };
}

// "/queue …" in the Brain chat: the message waits here, in the page, until nothing in the chat is
// working (the Brain's answer and whatever it handed on), then goes like any message, one at a time.
export interface Held<X> {
  id: string;
  text: string;
  extra: X;
}

export interface HoldQueue<X> {
  add(text: string, extra: X): Held<X>;
  remove(id: string): void;
  /** Change one's text (false: it already went). */
  edit(id: string, text: string): boolean;
  /** Put them in this order (ids it doesn't name keep their place after the ones it does). */
  order(ids: string[]): void;
  /** Forget them all (new conversation, other project); returns what was waiting. */
  clear(): Held<X>[];
  items(): Held<X>[];
  /** Send the next one if the chat is idle now (call it whenever something finished). */
  check(): void;
}

/** idle: nothing in the chat is working. send: sends one, resolving once it is on its way (it may
 *  then keep the chat busy by itself). onChange: the waiting list changed. */
export function holdQueue<X>({ idle, send, onChange }: { idle: () => boolean; send: (m: Held<X>) => Promise<unknown>; onChange: () => void }): HoldQueue<X> {
  let items: Held<X>[] = [];
  let sending = false;
  let n = 0;
  const check = () => {
    if (sending || !items.length || !idle()) return;
    const next = items.shift()!;
    sending = true;
    onChange();
    void send(next)
      .catch(() => {})
      .finally(() => {
        sending = false;
        check();
      });
  };
  return {
    add(text, extra) {
      const m = { id: `q${++n}`, text, extra };
      items.push(m);
      onChange();
      check();
      return m;
    },
    remove(id) {
      items = items.filter((m) => m.id !== id);
      onChange();
    },
    edit(id, text) {
      const m = items.find((x) => x.id === id);
      if (!m) return false;
      items = items.map((x) => (x === m ? { ...x, text } : x));
      onChange();
      return true;
    },
    order(ids) {
      items = reorderQueued(items, ids);
      onChange();
    },
    clear() {
      const out = items;
      items = [];
      onChange();
      return out;
    },
    items: () => [...items],
    check,
  };
}

// "/loop …" in the Brain chat: kept in the page like /queue. A timed loop sends every so often (a due one
// waits until nothing in the chat is working); the other kind sends again once its last one is done.
export interface LoopSpec {
  text: string;
  every: number | null;
  times: number;
}
export interface LoopState {
  text: string;
  every: number | null;
  times: number;
  done: number;
  next: number | null;
}
export interface ChatLoop<X> {
  start(spec: LoopSpec, extra: X): void;
  /** End it (true when one was going). */
  stop(): boolean;
  info(): LoopState | null;
  /** Send the next one if it is due and the chat is idle (call it whenever something finished). */
  check(): void;
}

/** send: sends one, resolving once it is on its way. onEnd: the loop finished all its sends. */
export function chatLoop<X>({ idle, send, onChange, onEnd }: { idle: () => boolean; send: (text: string, extra: X) => Promise<unknown>; onChange: () => void; onEnd: (l: LoopState) => void }): ChatLoop<X> {
  type Going = LoopState & { extra: X; due: boolean; sending: boolean; timer: ReturnType<typeof setTimeout> | null };
  let l: Going | null = null;
  const info = (): LoopState | null => (l ? { text: l.text, every: l.every, times: l.times, done: l.done, next: l.next } : null);
  const stop = () => {
    if (!l) return false;
    if (l.timer) clearTimeout(l.timer);
    l = null;
    onChange();
    return true;
  };
  const check = () => {
    const me = l;
    if (!me || !me.due || me.sending || !idle()) return;
    me.due = false;
    me.sending = true;
    me.done++;
    me.next = null;
    if (me.every != null && me.done < me.times) {
      const every = me.every;
      me.next = Date.now() + every;
      me.timer = setTimeout(() => {
        me.timer = null;
        me.due = true;
        check();
      }, every);
    }
    onChange();
    void send(me.text, me.extra)
      .catch(() => {})
      .finally(() => {
        me.sending = false;
        if (l !== me) return;
        if (me.done >= me.times) {
          const last = info()!;
          stop();
          return onEnd(last);
        }
        if (me.every == null) me.due = true;
        onChange();
        check();
      });
  };
  return {
    start(spec, extra) {
      stop();
      l = { ...spec, done: 0, next: null, extra, due: true, sending: false, timer: null };
      onChange();
      check();
    },
    stop,
    info,
    check,
  };
}
