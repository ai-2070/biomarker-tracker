// One agent's conversation, on the Vercel AI SDK (useChat): the saved chat as UI messages, a message
// you send streams in as its run goes (text as written, tool calls as they happen), and a run started
// anywhere else (a team turn, a routine, another tab) is picked up and streamed too (a resume: the
// turn so far, then the rest). The server speaks the AI SDK's UI message stream (server/uistream.ts).
// Used by the full chat page (views/chat.tsx), the floating window's agent tabs (agentchat.tsx, compact)
// and the Station's agent panel (mini).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { APICallError } from 'ai';
import { GET, POST, PUT, DEL, attempt, toast, state, onState, onEvent, approvalCard } from '../core.ts';
import type { AttachTray } from '../attach.ts';
import { COMPOSER_BTNS, COMPOSER_TEXT } from '../attach.ts';
import { pasteBox } from '../pastes.ts';
import { icon } from '../icons.ts';
import { latestCompaction, memoryStart } from '../../shared/compaction.ts';
import { Dom, MessageView, isRichCode } from './parts.tsx';
import type { Variant } from './parts.tsx';
import { beforeTurn, toUIMessages, userParts } from './messages.ts';
import { WINDOW_FROM, Windowed } from './window.tsx';
import { estimateHeight, messageSig } from './estimate.ts';
import { chatTransport } from './transport.ts';
import { agentMentions, insertMention } from './mention.ts';
import type { MentionAgent } from './mention.ts';
import { agentRef } from '../../shared/agentref.ts';
import { queuedText } from '../../shared/queue.ts';
import { parseCommand, slashSuggestions } from '../../shared/commands.ts';
import type { SlashOption } from '../../shared/commands.ts';
import { goalLine, loopLine } from '../chatcommands.ts';
import { QueuedList, keepLostEdit } from '../queuedlist.tsx';
import type { ChatMessage } from './messages.ts';
import type { AppState, BrainBrief, Chat, ChatItem, LoopInfo, QueuedMessage } from '../../shared/types.ts';

export { isRichCode };

export interface ChatAgent {
  id: string;
  name: string;
  emoji?: string;
  specialty?: string;
  tools?: string[];
}

export interface ChatViewApi {
  /** Load the saved chat again (after a rename, Clear memory, a compaction…). */
  reload: (after?: boolean) => Promise<void>;
  /** Compact the chat now (the Compact button; /compact). */
  compact: (mode?: 'instant' | 'summary') => Promise<void>;
  focus: () => void;
  setDraft: (text: string) => void;
}

export interface ChatViewProps {
  agent: ChatAgent;
  /** The conversation; null: a new one, made when the first message is sent. */
  chatId: string | null;
  /** full: the chat page. compact: the floating window. mini: the Station panel. (compact: true = compact) */
  variant?: Variant;
  compact?: boolean;
  /** Files for the next message (the host owns it, so it can make the whole page a drop zone). */
  tray?: AttachTray | null;
  /** Shown under the composer (the model chip). */
  footer?: HTMLElement | null;
  /** The chat as it was (re)loaded, or made by the first message. */
  onChat?: (chat: Chat) => void;
  apiRef?: { current: ChatViewApi | null };
}

/** The page's shared state (agents, runs, approvals), kept current. */
function useAppState(): AppState | null {
  const [data, setData] = useState(state.data);
  useEffect(() => onState((d) => setData(d)), []);
  return data;
}

export { chatTransport, streamUrl } from './transport.ts';

export function ChatView(p: ChatViewProps) {
  const { agent } = p;
  const variant: Variant = p.variant || (p.compact ? 'compact' : 'full');
  const compact = variant !== 'full';
  const tray = p.tray || null;
  const app = useAppState();
  const chatIdRef = useRef<string | null>(p.chatId);
  const [chatId, setChatId] = useState<string | null>(p.chatId);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [statusText, setStatusText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  // long pasted text, folded into a chip until it is sent
  const [pastes] = useState(pasteBox);
  useEffect(() => (input.current ? pastes.attach(input.current) : undefined), [pastes]);
  // something to send in the box (words or files): Send; nothing while it works: Stop
  const [filled, setFilled] = useState(false);
  const refill = useCallback(() => setFilled(!!input.current?.value.trim() || (tray?.count() ?? 0) > 0), [tray]);
  useEffect(() => tray?.listen(refill), [tray, refill]);
  /** Put text back in the box (a failed send, what Stop brought back). */
  const restore = useCallback(
    (text: string) => {
      pastes.restore(text);
      refill();
    },
    [pastes, refill],
  );
  // the queued message being changed (its id)
  const [editing, setEditing] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  // why the last send failed; refused: the server never took it (so the text goes back in the box)
  const failed = useRef<{ message: string; refused: boolean } | null>(null);
  const [compacting, setCompacting] = useState(false);
  // your /queue messages, waiting for the agent to be done here (the server keeps them)
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  // the next queued message started while this view was still streaming the turn before it
  const missedStart = useRef(false);
  // your /loop and /goal here (the server keeps them)
  const [loop, setLoop] = useState<LoopInfo | null>(null);
  const [goal, setGoal] = useState<BrainBrief | null>(null);
  // the agent's harness's own / commands (a Claude Code agent's), for the / menu
  const [harness, setHarness] = useState<{ name: string; about: string }[]>([]);
  const onChat = useRef(p.onChat);
  onChat.current = p.onChat;
  // one id for this view's useChat, even when its first message makes the chat
  const [viewId] = useState(() => p.chatId || `new-${agent.id}-${Math.random().toString(36).slice(2, 8)}`);

  // the server answered the last send (so it has the message): a failure after that is the run's, not the send's
  const accepted = useRef(false);
  const transport = useMemo(() => chatTransport(agent.id, () => chatIdRef.current, () => (accepted.current = true)), [agent.id]);
  const { messages, setMessages, sendMessage, status, stop: stopStream, resumeStream } = useChat<ChatMessage>({
    id: viewId,
    transport,
    onData: (part) => {
      if (part.type === 'data-status') setStatusText((part.data as { text: string }).text);
    },
    // a refusal (busy, a bad request) comes as the AI SDK's APICallError, and a send that never reached
    // the server (no connection) fails before any answer; a run that failed, as an error in its stream
    // (the message was sent and is in the chat)
    onError: (e) => (failed.current = { message: e.message || 'Could not send.', refused: APICallError.isInstance(e) || !accepted.current }),
  });
  const streaming = status === 'submitted' || status === 'streaming';
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;

  const serverRunning = !!chatId && !!app?.runs.some((r) => r.chatId === chatId);
  const busy = streaming || serverRunning || compacting;
  // it works for a team or another agent here: they wait on its answer, so a message can't change its course
  const helping = !!chatId && !!app?.runs.some((r) => r.chatId === chatId && (r.depth ?? 0) > 0);
  const approvals = (app?.approvals || []).filter((a) => a.agentId === agent.id);

  // the saved chat, shown as it is. after: a stream just ended (its flag may not have caught up yet)
  const reload = useCallback(async (after = false) => {
    const id = chatIdRef.current;
    if (!id) return;
    const saved = await GET<Chat>(`/agents/${agent.id}/chats/${id}`).catch(() => null);
    if (!saved || chatIdRef.current !== id) return;
    setItems(saved.items);
    setQueued(saved.queued || []);
    setLoop(saved.loop || null);
    setGoal(saved.goal || null);
    // (while a stream is going it keeps its own message; the saved chat comes when it ends)
    if (after || !streamingRef.current) setMessages(toUIMessages(saved.items));
    onChat.current?.(saved);
  }, [agent.id, setMessages]);

  // pick up a run going in this chat: the messages before its turn, then the turn streamed in
  const following = useRef(false);
  // done once following (or sending) has wound up, the saved chat loaded again
  const followDone = useRef<Promise<void> | null>(null);
  const sendDone = useRef<Promise<void> | null>(null);
  const follow = useCallback(async () => {
    if (streamingRef.current || following.current || !chatIdRef.current) return;
    following.current = true;
    let finished = () => {};
    followDone.current = new Promise<void>((r) => (finished = r));
    try {
      setMessages((m) => beforeTurn(m));
      setStatusText('Working…');
      await resumeStream();
    } finally {
      following.current = false;
      setStatusText('');
      await reload(true);
      catchUp();
      finished();
    }
  }, [resumeStream, reload, setMessages]);
  // a queued message started while a turn was streaming here: stream that one in too, once this
  // view has seen its own stream end (the effect runs after that render)
  const [ended, setEnded] = useState(0);
  const catchUp = () => setEnded((n) => n + 1);
  useEffect(() => {
    if (!missedStart.current || streaming || sending.current || following.current) return;
    missedStart.current = false;
    void follow();
  }, [ended, streaming, follow]);

  useEffect(() => {
    void (async () => {
      await reload();
      if (chatIdRef.current && state.data?.runs.some((r) => r.chatId === chatIdRef.current)) await follow();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a run starting here from elsewhere, compactions, and runs ending without a stream (missed ones)
  useEffect(
    () =>
      onEvent((ev) => {
        // your /goal here: the Brain followed up, or it is reached, stuck or dropped
        if (ev.type === 'brief') {
          const b = ev.brief as BrainBrief;
          if (b.kind !== 'agent' || !b.goal || !chatIdRef.current || b.chatId !== chatIdRef.current) return;
          return void setGoal((g) => (b.status === 'open' ? b : g?.id === b.id ? null : g));
        }
        if (!chatIdRef.current || ev.chatId !== chatIdRef.current) return;
        if (ev.type === 'compacted' || ev.type === 'chat-note') {
          if (!streamingRef.current) void reload();
          return;
        }
        if (ev.type === 'loop') return void setLoop((ev.loop as LoopInfo | null) || null);
        if (ev.type === 'queue') return void setQueued((ev.queued as QueuedMessage[]) || []);
        if (ev.type !== 'run') return;
        const kind = (ev.event as { kind?: string })?.kind;
        // (the server starts a queued message right as the turn before it ends: this view may still be streaming that one)
        if (kind === 'start' && (streamingRef.current || sending.current || following.current) && queuedRef.current.length) missedStart.current = true;
        if (kind === 'start' && !streamingRef.current && !sending.current) void reload().then(follow);
        else if ((kind === 'done' || kind === 'error') && !streamingRef.current && !sending.current) void reload();
      }),
    [reload, follow],
  );

  const compactNow = useCallback(
    async (mode?: 'instant' | 'summary') => {
      const id = chatIdRef.current;
      if (!id) return void toast('Nothing to compact yet');
      setStatusText(mode === 'summary' ? 'Compacting: the Brain’s model is writing a summary…' : 'Compacting…');
      // (nothing can be sent meanwhile: the server would refuse it)
      setCompacting(true);
      const r = await attempt(
        () => POST<{ compacted: boolean; message?: string }>(`/agents/${agent.id}/chats/${id}/compact`, mode ? { mode } : {}),
        (x) => (x.compacted ? 'Compacted: the agent now remembers the older messages as a short history' : x.message || 'Nothing to compact yet'),
      ).finally(() => setCompacting(false));
      setStatusText('');
      if (r?.compacted) await reload();
    },
    [agent.id, reload],
  );

  const sending = useRef(false);
  const steering = useRef(false);
  const send = useCallback(
    async (typed?: string) => {
      const box = input.current;
      if (steering.current) return;
      if (compacting) return void toast('Wait for the compaction to finish.');
      // (a button in an earlier answer: not while it works)
      if (busy && typed != null) return void toast(`${agent.name} is working. Wait for it, or write a message to change its course.`);
      if (busy && helping) return void toast(`${agent.name} is working for a team or another agent here. /queue your message for when it is done.`);
      // while it works: this message changes its course (the run going now stops, this one goes next)
      const steer = busy;
      if (sending.current && !steer) return;
      const draft = typed ?? box?.value.trim() ?? '';
      if (!draft && !tray?.count()) return;
      if (steer) {
        // (stop reading the turn going now; once that has wound up, this message takes its place)
        steering.current = true;
        try {
          void stopStream();
          await Promise.allSettled([sendDone.current, followDone.current]);
        } finally {
          steering.current = false;
        }
        if (sending.current) return;
      }
      sending.current = true;
      let finished = () => {};
      sendDone.current = new Promise<void>((r) => (finished = r));
      let taken: ReturnType<AttachTray['take']> = [];
      try {
        if (tray?.busy()) setStatusText('Uploading files…');
        const attachments = typed != null || !tray ? [] : await tray.ready();
        setStatusText('');
        if (!attachments) return;
        // what is in the box now (more may have been typed while the files uploaded)
        const typedNow = typed ?? (box ? pastes.text().trim() : '');
        // "/queue …" while it isn't working: nothing to wait for, so it goes now
        const text = typed == null ? (queuedText(typedNow) ?? typedNow) : typedNow;
        if (!text && !attachments.length) return void (typedNow && toast('Write the message after /queue'));
        if (typed == null && box) {
          box.value = '';
          box.style.height = '';
          pastes.sync();
          refill();
        }
        // /compact, /compact instant, /compact summary (with no files attached)
        const cmd = attachments.length ? null : /^\/compact(?:\s+(instant|summary))?\s*$/i.exec(text);
        if (cmd) return void (await compactNow(cmd[1]?.toLowerCase() as 'instant' | 'summary' | undefined));
        // a new conversation: make the chat first
        if (!chatIdRef.current) {
          const made = await attempt(() => POST<Chat>(`/agents/${agent.id}/chats`));
          if (!made) {
            if (typed == null && box) restore(text);
            return;
          }
          chatIdRef.current = made.id;
          setChatId(made.id);
          onChat.current?.(made);
        }
        // (a button in an answer sends no files: the ones staged stay for the next message)
        taken = typed != null ? [] : tray?.take() || [];
        near.current = true;
        failed.current = null;
        accepted.current = false;
        setStatusText('Thinking…');
        await sendMessage({ role: 'user', parts: userParts(text, attachments), metadata: {} }, steer ? { body: { steer: true } } : undefined);
        // (set by onError while it streamed)
        const fail = failed.current as { message: string; refused: boolean } | null;
        if (fail) {
          toast(fail.message, 'error');
          if (fail.refused) {
            if (typed == null && box) restore(text);
            tray?.put(taken);
          }
        }
      } finally {
        sending.current = false;
        setStatusText('');
        await reload(true);
        catchUp();
        finished();
      }
    },
    [busy, helping, compacting, tray, pastes, sendMessage, stopStream, compactNow, reload, refill, restore, agent.id, agent.name],
  );

  // "/queue …" while the agent works: the server holds it and sends it when this turn is done
  const queueing = useRef(false);
  const queueNext = useCallback(async () => {
    const box = input.current;
    const id = chatIdRef.current;
    if (!box || !id || queueing.current) return;
    queueing.current = true;
    try {
      const attachments = tray ? await tray.ready() : [];
      if (!attachments) return;
      // (what is in the box now: more may have been typed while the files uploaded)
      const all = pastes.text();
      const text = queuedText(all) ?? all.trim();
      if (!text && !attachments.length) return void toast('Write the message after /queue');
      box.value = '';
      box.style.height = '';
      pastes.sync();
      refill();
      const taken = tray?.take() || [];
      const r = await attempt(() => POST<{ runId?: string; queued?: QueuedMessage }>(`/agents/${agent.id}/chats/${id}/queue`, { text, attachments }));
      if (!r) {
        restore(`/queue ${text}`);
        tray?.put(taken);
        return;
      }
      const added = r.queued;
      if (added) setQueued((q) => (q.some((x) => x.id === added.id) ? q : [...q, added]));
    } finally {
      queueing.current = false;
    }
  }, [agent.id, tray, pastes, refill, restore]);
  const unqueue = useCallback(
    (q: QueuedMessage) => {
      const id = chatIdRef.current;
      if (!id) return;
      setQueued((list) => list.filter((x) => x.id !== q.id));
      void attempt(() => DEL(`/agents/${agent.id}/chats/${id}/queue/${q.id}`));
    },
    [agent.id],
  );
  const keepEdit = (text: string) => keepLostEdit(text, input.current, restore);
  const editQueued = async (q: QueuedMessage, text: string) => {
    const id = chatIdRef.current;
    if (!id) return;
    const put = (t: string) => setQueued((list) => list.map((x) => (x.id === q.id ? { ...x, text: t } : x)));
    put(text);
    const r = await attempt(() => PUT<{ queued: QueuedMessage | null }>(`/agents/${agent.id}/chats/${id}/queue/${q.id}`, { text }));
    // not saved: it shows what will go after all; already sent: the change comes to the box
    if (!r) put(q.text);
    else if (r.queued === null) keepEdit(text);
  };
  const orderQueued = (ids: string[]) => {
    const id = chatIdRef.current;
    if (!id) return;
    setQueued((list) => ids.map((x) => list.find((q) => q.id === x)).filter((q): q is QueuedMessage => !!q));
    void attempt(() => POST(`/agents/${agent.id}/chats/${id}/queue/order`, { ids }));
  };
  // the chat, made now if this is a new conversation (for a command that needs one)
  const ensureChat = async (): Promise<string | null> => {
    if (chatIdRef.current) return chatIdRef.current;
    const made = await attempt(() => POST<Chat>(`/agents/${agent.id}/chats`));
    if (!made) return null;
    chatIdRef.current = made.id;
    setChatId(made.id);
    onChat.current?.(made);
    return made.id;
  };

  // /stop, /resume, /resend, /loop, /goal (whether it is working or not)
  // fromBox: typed in the box (it is cleared, and comes back if the command fails); not a chip's ×
  const command = async (name: string, rest: string, fromBox = true) => {
    const box = input.current;
    if (!box) return;
    // (with pasted text put back: a long goal pasted in goes in full)
    const typed = fromBox ? pastes.text().trim() : '';
    if (fromBox) {
      box.value = '';
      box.style.height = '';
      pastes.sync();
      refill();
      setSlash(null);
    }
    const back = () => void (fromBox && restore(typed));
    if (name === 'stop') return void stop();
    const id = await ensureChat();
    if (!id) return back();
    const base = `/agents/${agent.id}/chats/${id}`;
    if (name === 'goal' && !rest) return void toast(goal ? `Goal: ${goal.goal || goal.text}` : 'No goal yet. Type /goal and what done looks like.');
    if (name === 'loop') {
      // (with the files in the tray: each loop message carries them; not when it is ended)
      const off = /^(off|stop|end|cancel)$/i.test(rest);
      const attachments = tray && !off ? await tray.ready() : [];
      if (!attachments) return back();
      const taken = off ? [] : tray?.take() || [];
      const r = await attempt(() => POST<{ loop: LoopInfo | null }>(`${base}/loop`, { text: rest, attachments }));
      if (!r) return void (back(), tray?.put(taken));
      return setLoop(r.loop);
    }
    const r = await attempt(() => POST<{ goal?: BrainBrief | null; queued?: QueuedMessage }>(`${base}/${name}`, name === 'goal' ? { text: rest } : {}));
    if (!r) return back();
    if (name === 'goal') setGoal(r.goal || null);
    const added = r.queued;
    if (added) setQueued((q) => (q.some((x) => x.id === added.id) ? q : [...q, added]));
  };

  // Enter: a command; a /queue while it works waits its turn; anything else is sent (when it isn't working)
  const submit = () => {
    const box = input.current;
    const cmd = box ? parseCommand(pastes.text(), 'agent') : null;
    if (cmd && cmd.name !== 'queue' && cmd.name !== 'compact') return void command(cmd.name, cmd.rest);
    if (cmd?.name === 'compact' && busy) return void toast('Compact it when it is done (or /stop it first).');
    // (from the text with pastes put back: a long paste shows as a chip in the box)
    if (box && queuedText(pastes.text()) != null && (busy || sending.current)) return void queueNext();
    void send();
  };

  const stop = useCallback(async () => {
    const id = chatIdRef.current;
    void stopStream();
    if (!id) return;
    const r = await attempt(() => POST<{ unqueued?: QueuedMessage[] }>(`/agents/${agent.id}/chats/${id}/stop`));
    // what you queued comes back to the box, so stopping never loses it
    const back = r?.unqueued || [];
    if (back.length) restore(back.map((q) => q.text).filter(Boolean).join('\n\n'));
    if (back.some((q) => q.attachments?.length)) toast('Your queued messages are back in the box. Attach their files again.');
  }, [agent.id, stopStream, restore]);

  if (p.apiRef)
    p.apiRef.current = {
      reload,
      compact: compactNow,
      focus: () => input.current?.focus(),
      setDraft: (t) => {
        if (!input.current) return;
        input.current.value = t;
        pastes.sync();
        refill();
        input.current.focus();
      },
    };

  // keep to the newest message while you are at the bottom
  useLayoutEffect(() => {
    const el = list.current;
    if (el && near.current) el.scrollTop = el.scrollHeight;
  });
  // previews, videos and Rich answers arrive after the first draw: stay at the bottom as they grow
  // (style too: a long chat's list grows as its messages are measured)
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const stick = () => {
      if (near.current) el.scrollTop = el.scrollHeight;
    };
    const watch = new MutationObserver(stick);
    watch.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    el.addEventListener('load', stick, true);
    el.addEventListener('loadedmetadata', stick, true);
    return () => {
      watch.disconnect();
      el.removeEventListener('load', stick, true);
      el.removeEventListener('loadedmetadata', stick, true);
    };
  }, []);
  const onScroll = () => {
    const el = list.current;
    if (el) near.current = el.scrollHeight - el.scrollTop - el.clientHeight < (compact ? 80 : 140);
  };

  // @ to pick another agent: a menu above the box while the caret is in an "@…"
  const [mention, setMention] = useState<{ start: number; options: MentionAgent[]; active: number } | null>(null);
  // / for commands: a menu above the box while it holds just "/" and the start of a name
  const [slash, setSlash] = useState<{ options: SlashOption[]; active: number } | null>(null);
  useEffect(() => {
    void GET<{ name: string; about: string }[]>(`/agents/${agent.id}/commands`)
      .then((list) => setHarness(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [agent.id]);
  const lookForSlash = () => {
    const options = slashSuggestions(input.current?.value || '', 'agent', harness);
    setSlash((was) => (options.length ? { options, active: was && was.options.length === options.length ? Math.min(was.active, options.length - 1) : 0 } : null));
  };
  const pickSlash = (o: SlashOption) => {
    const box = input.current;
    if (!box) return;
    // ours with nothing after it runs now; the rest wait for what comes after (a harness command goes as typed)
    box.value = o.args || o.harness ? `/${o.name} ` : `/${o.name}`;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    setSlash(null);
    if (!o.args && !o.harness) submit();
  };
  const onSlashKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!slash || e.nativeEvent.isComposing) return false;
    const n = slash.options.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setSlash({ ...slash, active: (slash.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') pickSlash(slash.options[slash.active]);
    else if (e.key === 'Escape') {
      e.stopPropagation();
      setSlash(null);
    } else return false;
    e.preventDefault();
    return true;
  };
  const others = app?.agents || [];
  // (it can only hand work on with ask_agent, which the Delegate tools give it)
  const canDelegate = !!others.find((a) => a.id === agent.id)?.toolGroups?.includes('agents');
  const lookForMention = () => {
    const box = input.current;
    const found = box && box.selectionStart === box.selectionEnd ? agentMentions(box.value, box.selectionStart, others, agent.id) : null;
    setMention((was) => (found ? { ...found, active: was && was.start === found.start ? Math.min(was.active, found.options.length - 1) : 0 } : null));
  };
  const pickMention = (a: MentionAgent) => {
    const box = input.current;
    if (!box || !mention) return;
    // with the id when the name is shared, so ask_agent reaches this one
    const r = insertMention(box.value, mention.start, box.selectionStart, agentRef(a, others));
    box.value = r.text;
    box.setSelectionRange(r.caret, r.caret);
    box.focus();
    setMention(null);
  };
  // arrows move through the menu, Enter or Tab picks, Escape closes it. true: the key was used.
  const onMentionKey = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!mention || e.nativeEvent.isComposing) return false;
    const n = mention.options.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setMention({ ...mention, active: (mention.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') pickMention(mention.options[mention.active]);
    else if (e.key === 'Escape') {
      // (and not the chat window)
      e.stopPropagation();
      setMention(null);
    } else return false;
    e.preventDefault();
    return true;
  };

  const latest = latestCompaction(items);
  const dimBefore = latest ? memoryStart(items) : -1;
  // (a long chat draws only the messages near the screen, so the whole of it can be shown)
  const shown = variant === 'mini' ? messages.slice(-14) : messages;
  const windowed = variant !== 'mini' && shown.length >= WINDOW_FROM;
  const lastId = messages[messages.length - 1]?.id;
  const chatPath = chatId ? `/agents/${agent.id}/chats/${chatId}` : undefined;
  const owner = useMemo(() => ({ agentId: agent.id, chatId }), [agent.id, chatId]);
  const row = (m: ChatMessage) => {
    const seq = m.metadata?.seq;
    return (
      <MessageView
        key={m.id}
        m={m}
        variant={variant}
        busy={busy}
        streaming={streaming && m.id === lastId}
        dim={seq != null && seq < dimBefore}
        onSend={(t) => void send(t)}
        chatPath={chatPath}
        owner={owner}
        latestCompaction={latest?.item.id ?? null}
        onCompactionSaved={() => void reload()}
      />
    );
  };
  const rows = windowed ? (
    <Windowed items={shown} scroller={list} atEnd={near.current} gap={compact ? 8 : 14} estimate={(m, width) => estimateHeight(m, width, compact)} memoKey={(m) => `${agent.id}/${chatId || viewId}/${compact ? 'c' : ''}${m.id}/${messageSig(m)}`} render={row} />
  ) : (
    shown.map(row)
  );

  const empty = !messages.length && !busy;
  // what the streaming message is doing now: writing, or using a tool (a status line from the server,
  // like "Compacting the chat…", comes first)
  const lastPart = streaming ? messages[messages.length - 1]?.parts.at(-1) : undefined;
  const doing = lastPart?.type === 'dynamic-tool' && lastPart.state !== 'output-available' && lastPart.state !== 'output-error' ? `Using ${lastPart.toolName}…` : lastPart?.type === 'text' ? 'Writing…' : '';
  const generic = !statusText || /^(Thinking|Working)…$/.test(statusText);
  const statusLine = (approvals.length && busy ? `Waiting for you: ${approvals[0].title}` : '') || (generic && doing) || statusText || (busy ? 'Working…' : '');
  const composer = (
    <div className="relative flex min-w-0 flex-1">
      <textarea
        ref={input}
        className={variant === 'mini' ? 'max-h-50 min-h-11.5 flex-1 resize-none' : `flex-1 ${COMPOSER_TEXT}`}
        rows={variant === 'mini' ? 1 : 2}
        placeholder={helping ? `${agent.name} is working for a team or another agent… /queue a message for when it is done` : busy ? `${agent.name} is working… Write to change course now, or /queue a message for when it is done` : compact ? `Message ${agent.name}…  (Enter to send, @ for another agent)` : `Message ${agent.name}…`}
        onKeyDown={(e) => {
          if (onSlashKey(e) || onMentionKey(e)) return;
          // Up in an empty box: change the last queued message
          if (e.key === 'ArrowUp' && !e.currentTarget.value && queued.length && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            return setEditing(queued[queued.length - 1].id);
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        onInput={(e) => {
          lookForMention();
          lookForSlash();
          refill();
          if (variant === 'mini') return;
          // grows with the text (its max height stops it, then it scrolls)
          const t = e.currentTarget;
          t.style.height = 'auto';
          t.style.height = `${t.scrollHeight + 2}px`;
        }}
        onClick={lookForMention}
        onKeyUp={(e) => {
          if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) lookForMention();
        }}
        onBlur={() => (setMention(null), setSlash(null))}
      />
      {slash ? (
        <div className="tc-suggest slash-menu" role="listbox">
          {slash.options.map((o, i) => (
            <button
              key={`${o.harness ? 'h' : 'd'}-${o.name}`}
              type="button"
              role="option"
              aria-selected={i === slash.active}
              className={i === slash.active ? 'tc-sopt on items-baseline' : 'tc-sopt items-baseline'}
              onMouseDown={(e) => {
                e.preventDefault();
                pickSlash(o);
              }}
            >
              <b className="slash-name flex-none font-mono text-[12.5px] leading-[normal] font-semibold text-accent">/{o.name}</b>
              {o.args ? <span className="flex-none font-mono text-[11.5px] leading-[normal] text-faint">{o.args}</span> : null}
              <span className="hint min-w-0">{o.harness ? `${o.about || 'Claude Code command'} · Claude Code` : o.about}</span>
            </button>
          ))}
        </div>
      ) : null}
      {mention ? (
        <div className="tc-suggest mention-menu" role="listbox">
          {mention.options.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={i === mention.active}
              className={i === mention.active ? 'tc-sopt on' : 'tc-sopt'}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(a);
              }}
            >
              <span className="avatar" style={{ '--agent-color': a.color || 'var(--color-accent)' } as CSSProperties}>
                {a.emoji || '🤖'}
              </span>
              @{a.name}
              {a.specialty ? <span className="hint">{a.specialty}</span> : null}
            </button>
          ))}
          {canDelegate ? null : <div className="hint mention-note mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[12px]">To pass work on, {agent.name} needs Delegate turned on in its tools.</div>}
        </div>
      ) : null}
    </div>
  );
  // one button under the paperclip: Send, or Stop while it works and there is nothing to send
  const working = streaming || serverRunning;
  const sendBtn =
    working && !filled ? (
      <button key="stop" className={variant === 'mini' ? 'btn danger small' : 'btn danger'} onClick={() => void stop()} title={`Stop ${agent.name}`} aria-label="Stop">
        <Dom make={() => icon('square', variant === 'mini' ? 13 : 14)} deps={[]} />
      </button>
    ) : (
      <button key="send" className={variant === 'mini' ? 'btn small' : 'btn'} onClick={submit} disabled={compacting} title={working ? `Send now: ${agent.name} stops what it is doing and takes this up (Enter)` : 'Send (Enter)'} aria-label="Send">
        <Dom make={() => icon('send', variant === 'mini' ? 14 : 15)} deps={[]} />
      </button>
    );

  // your /goal and /loop here (× ends one)
  const chips =
    goal || loop ? (
      <div className={compact ? 'cmd-chips compact' : 'cmd-chips'}>
        {goal ? (
          <div className="cmd-chip goal">
            <Dom make={() => icon('target', 13)} deps={[]} />
            <span className="min-w-0 flex-1 truncate">
              <b>Goal: </b>
              {goal.goal || goal.text}
            </span>
            <span className="hint">{goalLine(goal)}</span>
            <button type="button" className="tc-act" title="Drop this goal" aria-label="Drop this goal" onClick={() => void command('goal', 'clear', false)}>
              <Dom make={() => icon('x', 12)} deps={[]} />
            </button>
          </div>
        ) : null}
        {loop ? (
          <div className="cmd-chip loop">
            <Dom make={() => icon('repeat', 13)} deps={[]} />
            <span className="min-w-0 flex-1 truncate">
              <b>Loop: </b>
              {loop.text}
            </span>
            <span className="hint">{loopLine(loop)}</span>
            <button type="button" className="tc-act" title="Stop the loop" aria-label="Stop the loop" onClick={() => void command('loop', 'off', false)}>
              <Dom make={() => icon('x', 12)} deps={[]} />
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  // your /queue messages, in the order they will go (click one to change it, drag to reorder, × takes one back)
  const queuedList = (
    <QueuedList
      items={queued}
      head={`Sends when ${agent.name} is done`}
      compact={compact}
      editing={editing}
      onEditing={setEditing}
      onSave={(q, text) => void editQueued(q, text)}
      onRemove={unqueue}
      onOrder={orderQueued}
      onLeave={() => input.current?.focus()}
      onLost={(_q, text) => keepEdit(text)}
    />
  );

  return (
    <>
      <div ref={list} className={variant === 'mini' ? 'oc-mini-list flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto py-1' : compact ? 'ac-list flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-0.5 py-1' : 'messages'} onScroll={onScroll}>
        {empty ? (
          variant === 'mini' ? (
            <p className="empty">No messages yet.</p>
          ) : compact ? (
            <div className="m-auto text-center text-dim">
              <Dom make={() => icon('message-circle', 22)} deps={[]} />
              <p className="mt-1.5 mb-0">Say hi to {agent.name}.</p>
              <p className="hint mt-1.5 mb-0">{agent.specialty || ''}</p>
            </div>
          ) : (
            <div className="empty-chat" style={{ margin: 'auto', textAlign: 'center', maxWidth: '560px', color: 'var(--color-dim)' }}>
              <div style={{ fontSize: '40px' }}>{agent.emoji || '🤖'}</div>
              <p>
                Ask {agent.name} anything{agent.specialty ? `. Good at: ${agent.specialty}` : ''}.
              </p>
              <div className="chips" style={{ justifyContent: 'center', marginTop: '12px' }}>
                {suggestions(agent).map((t) => (
                  <button key={t} className="chip" onClick={() => p.apiRef?.current?.setDraft(t)}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          rows
        )}
      </div>
      {variant === 'mini' ? null : (
        <div className={compact ? 'empty:hidden' : undefined} style={compact ? undefined : { padding: '0 28px' }}>
          {approvals.map((a) => (
            <Dom key={a.id} className={compact ? undefined : 'mb-2.5 max-w-[860px]'} make={() => approvalCard(a)} deps={[a.id]} />
          ))}
        </div>
      )}
      {chips}
      {queuedList}
      <div className={compact ? 'min-h-4 font-mono text-[11.5px] leading-[normal] text-amber' : 'status-line flex min-h-5.5 items-center gap-2 px-7 pt-1 font-mono text-[11.5px] leading-[normal] text-amber max-md:px-4'}>
        {statusLine ? (
          compact ? (
            statusLine
          ) : (
            <>
              <span className="dot busy" />
              {statusLine}
            </>
          )
        ) : null}
      </div>
      {compact ? (
        <>
          {tray ? <Dom make={() => tray.el} deps={[tray]} /> : null}
          <Dom make={() => pastes.el} deps={[pastes]} />
          {variant === 'mini' ? (
            <div className="flex items-end gap-2">
              {composer}
              {tray ? <Dom make={() => tray.picker} deps={[tray]} /> : null}
              {sendBtn}
            </div>
          ) : (
            <div className="flex items-stretch gap-2">
              {composer}
              {/* the paperclip at the top of the box, Send at its bottom */}
              <div className={COMPOSER_BTNS}>
                {tray ? <Dom make={() => tray.picker} deps={[tray]} /> : <span />}
                {sendBtn}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="composer">
          {/* files, the box and its buttons, and the model: one column in the middle of the page */}
          <div className="mx-auto max-w-[1000px]">
            {tray ? <Dom make={() => tray.el} deps={[tray]} /> : null}
            <Dom make={() => pastes.el} deps={[pastes]} />
            <div className="flex items-stretch gap-2.5">
              {composer}
              {/* the paperclip at the top of the box, Send at its bottom */}
              <div className={COMPOSER_BTNS}>
                {tray ? <Dom make={() => tray.picker} deps={[tray]} /> : <span />}
                {sendBtn}
              </div>
            </div>
            {p.footer ? (
              <div className="mt-1.5">
                <Dom make={() => p.footer!} deps={[p.footer]} />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

function suggestions(a: ChatAgent): string[] {
  const t = a.tools || [];
  const out: string[] = [];
  if (t.includes('comfyui_run')) out.push('Make an image of a neon city at night');
  if (t.includes('x_draft_post')) out.push('Draft 3 X posts about what I’m building');
  if (t.includes('blender_run_python')) out.push('Build a low-poly island in Blender and render it');
  if (t.includes('ffmpeg')) out.push('Cut the first 30 seconds of a video');
  if (t.includes('ask_agent')) out.push('Plan this with the team: launch week content');
  if (t.includes('list_programs')) out.push('What programs can you use on my PC?');
  if (!out.length) out.push('What can you do?', 'Summarize what you know');
  return out.slice(0, 4);
}
