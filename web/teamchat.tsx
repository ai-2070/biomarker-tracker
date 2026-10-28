// A team's group chat: everyone's messages, who is working, @mention suggestions, reply-to, stop.
// The Brain writes here too (from 'brain'): its briefs, follow-ups, and answers to @Brain.
// Other teams too (from 'team:<id>'): what they ask this team after a #Team Name, and their answers.
// React; renderTeamChat() puts it into a plain-DOM place (the chat window's tab) and hands back
// focus, mention and destroy. The message box stays uncontrolled: the paste chips, the / menu and
// mention() change its text directly, as typing does.
import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { state, GET, POST, PUT, DEL, attempt, md, ago, onEvent, onReconnect, confirmBox, toast } from './core.ts';
import { attachTray, COMPOSER_BTNS, COMPOSER_TEXT } from './attach.ts';
import { pasteBox } from './pastes.ts';
import { QueuedList, keepLostEdit } from './queuedlist.tsx';
import { mentionPreviews } from './filepreview.ts';
import { queuedText } from '../shared/queue.ts';
import { parseCommand } from '../shared/commands.ts';
import { commandChips, slashMenu } from './chatcommands.ts';
import type { SlashMenu } from './chatcommands.ts';
import { Avatar, DomNode, Icon, mountReact, useAppState } from './ui/react.tsx';
import type { Agent, BrainBrief, LoopInfo, QueuedMessage, RunEvent, Team, TeamMessage, TeamRef, TeamState } from '../shared/types.ts';

// A working agent's turn (and the work behind a reply): the AI SDK pieces load when first needed.
const TurnView = lazy(() => import('./chat/TurnView.tsx').then((m) => ({ default: m.TurnView })));

/** What the server pushes as a 'team' event (ev.event). */
export type TeamEvent =
  | { kind: 'message'; message: TeamMessage }
  | ({ kind: 'state' } & TeamState)
  | { kind: 'routed'; to: string[]; why: string }
  | { kind: 'turn'; agentId: string; state: 'start' | 'end'; chatId?: string }
  | { kind: 'cleared' };
/** GET /api/teams/:id/chat */
export interface TeamChatResponse extends TeamState {
  team: Team;
  messages: TeamMessage[];
  /** each agent's own session for this team (agentId → chatId) */
  sessions?: Record<string, string>;
  /** your /goal for the team, while the Brain follows it */
  goal?: BrainBrief | null;
  /** the other teams it can ask (#Team Name) */
  others?: TeamRef[];
}
/** What renderTeamChat() hands back. */
export interface TeamChatApi {
  focus: () => void;
  mention: (name: string) => void;
  destroy: () => void;
}
interface TeamChatOptions {
  height?: number;
  fill?: boolean;
}
/** The chat as it stands: changed by the first load and by live events, then drawn. */
interface TeamChatData {
  team: Team | null;
  /** the other teams (#Team Name) */
  others: TeamRef[];
  messages: TeamMessage[];
  working: string[];
  queued: string[];
  /** your /queue messages, posted when nobody is working (the server keeps them) */
  held: QueuedMessage[];
  /** your /loop and /goal here */
  loop: LoopInfo | null;
  goal: BrainBrief | null;
  activity: Record<string, string>;
  /** each agent's own session for this team (agentId → chatId): where its turn streams from */
  sessions: Record<string, string>;
  /** whose turn is going now, by the turn events (a state update can lag behind a turn's end) */
  turning: Set<string>;
}
interface MentionOption {
  label: string;
  a?: Agent;
  /** another team, typed as #Name */
  t?: TeamRef;
}

const PLACEHOLDER = 'Message the team… type @ to mention someone';
// what ends a /loop (server/commands.ts)
const LOOP_OFF = /^(off|stop|end|cancel)$/i;

// ---------- looks (tc-msg, tc-relay, tc-live, tc-team-av, tc-mention, tc-team stay: tests look them up) ----------
const MSG = 'tc-msg py-2 px-2.5 border rounded-box animate-[rise-in_0.22s_var(--ease-soft)]';
const MSG_OTHER = `${MSG} border-line bg-[rgba(7,8,7,0.55)]`;
const MSG_ME = `${MSG} border-[color-mix(in_srgb,var(--color-accent)_24%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_7%,#111611)]`;
/** from another team (#Team): in that team's color (--team-color) */
const MSG_RELAY = `${MSG} tc-relay border-[color-mix(in_srgb,var(--team-color,var(--color-ice))_28%,var(--color-line))] bg-[color-mix(in_srgb,var(--team-color,var(--color-ice))_6%,#0d100d)]`;
/** an agent working now, its turn streaming in */
const MSG_LIVE = `${MSG} tc-live border-dashed border-[color-mix(in_srgb,var(--color-accent)_30%,var(--color-line))] bg-[rgba(7,8,7,0.55)]`;
const WHO = 'flex items-center gap-1.75 mb-1 text-[13px] [&_.avatar]:size-5.5 [&_.avatar]:text-[12px]';
const TEAM_AV = 'avatar tc-team-av bg-[color-mix(in_srgb,var(--team-color,var(--color-ice))_18%,transparent)] text-[color:var(--team-color,var(--color-ice))] font-mono text-[12px] leading-[normal] font-bold';
/** a message's text (Markdown) */
const TEXT = 'font-chat text-[13.5px] leading-[1.55] wrap-anywhere [&_p]:mx-0 [&_p]:mt-0 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_pre]:max-h-[200px]';
const MENTION = 'tc-mention font-semibold rounded-[4px] px-0.75 text-accent bg-accent/10';
const MENTION_TEAM = 'tc-mention tc-team font-semibold rounded-[4px] px-0.75 text-ice bg-ice/10';
const TYPING = 'flex items-center gap-1.75 font-mono text-[11.5px] leading-[normal] font-normal';
/** the steps behind a reply, and a live turn */
const TURN_BODY = 'mt-1.5 flex flex-col gap-1.5 min-w-0';
const blank = (): TeamChatData => ({ team: null, others: [], messages: [], working: [], queued: [], held: [], loop: null, goal: null, activity: {}, sessions: {}, turning: new Set() });
const agentOf = (id: string) => state.data?.agents.find((a) => a.id === id);

/** Who wrote a message, in a few words (the quote above a reply). */
export function senderName(m: TeamMessage, agentName: (id: string) => string | undefined): string {
  if (m.relay) return `#${m.relay.teamName}`;
  return m.from === 'user' ? 'You' : m.from === 'brain' ? 'Brain' : m.from === 'system' ? 'System' : agentName(m.from) || '';
}

/** What highlights @Names and #Teams in a message (group 1: an @name, group 2: a #team). */
export function mentionPattern(names: string[], teams: string[]): RegExp {
  const esc = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const longest = (xs: string[]) => [...xs].sort((a, b) => b.length - a.length).map(esc).join('|');
  return new RegExp(`@(${longest(names)})${teams.length ? `|(?<![\\w#&/])#(${longest(teams)})(?![\\w-])` : ''}`, 'gi');
}

// The first GET's messages, plus what live events added meanwhile. After a clear the snapshot may be from before it, so only the live ones count.
export function mergeSnapshot(snapshot: TeamMessage[], live: TeamMessage[], clearedSince: boolean): TeamMessage[] {
  if (clearedSince) return live;
  const ids = new Set(snapshot.map((m) => m.id));
  return [...snapshot, ...live.filter((m) => !ids.has(m.id))].sort((a, b) => a.ts - b.ts);
}

/** The chat's data, kept current by its first load and live events. bump() draws it again. */
function useTeamData(teamId: string): [TeamChatData, () => void, { current: TeamChatData }] {
  const C = useRef<TeamChatData>(blank());
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    const c = (C.current = blank());
    // what arrived while a GET was on its way, so the snapshot can't undo it (fresh: those messages;
    // turned: whose turns started)
    let early = { loading: true, cleared: false, state: false, fresh: new Set<string>(), turned: new Set<string>() };
    const off = onEvent((ev) => {
      if (!alive) return;
      if (ev.type === 'team' && ev.teamId === teamId) {
        const e = ev.event as TeamEvent;
        if (e.kind === 'message' && !c.messages.some((m) => m.id === e.message.id)) c.messages = [...c.messages, e.message];
        if (e.kind === 'message' && early.loading) early.fresh.add(e.message.id);
        if (e.kind === 'state') {
          Object.assign(c, { working: e.working, queued: e.queued, held: e.held || [], loop: e.loop || null });
          early.state ||= early.loading;
        }
        if (e.kind === 'cleared') {
          // (the agents' sessions are gone with it)
          Object.assign(c, { messages: [], sessions: {}, working: [], held: [], loop: null, turning: new Set() });
          early.cleared ||= early.loading;
        }
        if (e.kind === 'turn' && e.state === 'start') {
          if (e.chatId) c.sessions = { ...c.sessions, [e.agentId]: e.chatId };
          c.turning = new Set(c.turning).add(e.agentId);
          if (early.loading) early.turned.add(e.agentId);
        }
        if (e.kind === 'turn' && e.state === 'end') {
          const { [e.agentId]: _gone, ...rest } = c.activity;
          c.activity = rest;
          const next = new Set(c.turning);
          next.delete(e.agentId);
          c.turning = next;
        }
        bump();
      }
      // your /goal: the Brain followed up, or it is reached, stuck or dropped
      if (ev.type === 'brief') {
        const b = ev.brief as BrainBrief;
        if (b.kind !== 'team' || b.targetId !== teamId || !b.goal) return;
        if (b.status === 'open') c.goal = b;
        else if (c.goal?.id === b.id) c.goal = null;
        bump();
      }
      // what a working member is doing right now
      if (ev.type === 'run' && c.working.includes(ev.agentId as string)) {
        const run = ev.event as RunEvent;
        const doing = run.kind === 'tool' ? run.name.replace(/^mcp__dashboard__/, '').replace(/_/g, ' ') : run.kind === 'text' ? 'writing' : null;
        if (doing && c.activity[ev.agentId as string] !== doing) {
          c.activity = { ...c.activity, [ev.agentId as string]: doing };
          bump();
        }
      }
    });
    // again: the event socket came back, and what happened while it was down never came as events
    const load = (again: boolean) => {
      const now: typeof early = (early = { loading: true, cleared: false, state: false, fresh: new Set(), turned: new Set() });
      GET<TeamChatResponse>(`/teams/${teamId}/chat`)
        .then((r) => {
          if (!alive || now !== early) return;
          c.team = r.team;
          c.others = r.others || [];
          // (again: the saved chat stands, with what came in while it loaded)
          c.messages = mergeSnapshot(r.messages, again ? c.messages.filter((m) => now.fresh.has(m.id)) : c.messages, now.cleared);
          // (cleared while it loaded: the snapshot's sessions and who was working are from before)
          if (!now.cleared) {
            c.sessions = { ...(r.sessions || {}), ...c.sessions };
            // who was already working when this opened: their turns are going now (again: a turn that
            // ended while the socket was down is not going any more)
            c.turning = new Set([...(again ? [...c.turning].filter((id) => now.turned.has(id)) : c.turning), ...r.working]);
          }
          if (!now.state && !now.cleared) Object.assign(c, { working: r.working, queued: r.queued, held: r.held || [], loop: r.loop || null });
          c.goal = again ? r.goal || null : c.goal || r.goal || null;
          bump();
        })
        .catch(() => {})
        .finally(() => (now.loading = false));
    };
    load(false);
    const offReconnect = onReconnect(() => alive && load(true));
    return () => {
      alive = false;
      off();
      offReconnect();
    };
  }, [teamId, bump]);
  return [C.current, bump, C];
}

// "5m ago" moves on by itself: one clock for every message, ticking while any is shown
let minute = 0;
const ticks = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
export const clock = (tick: () => void) => {
  ticks.add(tick);
  clockTimer ??= setInterval(() => {
    minute = Date.now();
    for (const t of ticks) t();
  }, 30_000);
  return () => {
    ticks.delete(tick);
    if (!ticks.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
};
function Ago({ ts }: { ts: number }) {
  useSyncExternalStore(clock, () => minute);
  return <span className="hint">{ago(ts)}</span>;
}

/** A message's text with @Names and #Teams picked out (not inside code). */
function textWithMentions(text: string, names: readonly string[], teams: readonly string[]): HTMLElement {
  const el = md(text);
  el.classList.add(...TEXT.split(' '));
  const re = mentionPattern([...names, 'everyone', 'Brain'], [...teams]);
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3 && re.test(child.textContent!)) {
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        // (the match's offset is next to last: the pattern has one group without other teams, two with)
        child.textContent!.replace(re, (m: string, ...rest: unknown[]) => {
          const idx = rest[rest.length - 2] as number;
          const tag = document.createElement('span');
          tag.className = m.startsWith('#') ? MENTION_TEAM : MENTION;
          tag.textContent = m;
          frag.append(child.textContent!.slice(last, idx), tag);
          last = idx + m.length;
          return m;
        });
        frag.append(child.textContent!.slice(last));
        child.replaceWith(frag);
      } else if (child.nodeType === 1 && (child as Element).tagName !== 'CODE' && (child as Element).tagName !== 'PRE') walk(child);
    }
  };
  walk(el);
  return el;
}

/** "Show the work": the steps and tool calls behind a reply, loaded when opened. */
function Work({ m }: { m: TeamMessage }) {
  const [opened, setOpened] = useState(false);
  const turn = m.turn!;
  return (
    <details className="tc-work mt-1.5" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpened(true)}>
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.25 font-mono text-[11px] leading-[normal] font-normal text-faint [&::-webkit-details-marker]:hidden hover:text-accent [[open]>&]:text-accent">
        <Icon name="wrench" size={12} />
        Show the work
      </summary>
      <div className={TURN_BODY}>
        {opened ? (
          <Suspense fallback={null}>
            <TurnView agentId={m.from} chatId={turn.chatId} from={turn.from} to={turn.to} empty="No steps were saved for this reply." />
          </Suspense>
        ) : null}
      </div>
    </details>
  );
}

/** One message. Memo: a message drawn once stays as it is while others arrive or stream in. */
const Message = memo(function Message({ m, parent, author, team, lead, names, teams, onReply }: { m: TeamMessage; parent: TeamMessage | null; author: Agent | undefined; team: TeamRef | undefined; lead: boolean; names: string; teams: string; onReply: (m: TeamMessage) => void }) {
  if (m.from === 'system') return <div className="text-center font-mono text-[11.5px] leading-[normal] font-normal text-faint py-0.5">{m.text}</div>;
  const brain = m.from === 'brain';
  // a message from another team (#Team): in that team's colour
  const relay = m.relay;
  return (
    <div className={relay ? MSG_RELAY : m.from === 'user' ? MSG_ME : MSG_OTHER} style={relay ? ({ '--team-color': team?.color || 'var(--color-ice)' } as CSSProperties) : undefined}>
      <div className={WHO}>
        {author ? (
          <Avatar agent={author} />
        ) : brain ? (
          <div className="avatar bg-accent/16 text-accent"><Icon name="brain" size={14} /></div>
        ) : relay ? (
          <div className={TEAM_AV}>{team?.mark || '#'}</div>
        ) : (
          <div className="avatar text-accent"><Icon name="users" size={14} /></div>
        )}
        <b>{author ? author.name : brain ? 'Brain' : relay ? `#${team?.name || relay.teamName}` : m.from === 'user' ? 'You' : 'Someone'}</b>
        {relay ? <span className="tc-relay-tag font-mono text-[10.5px] font-medium leading-[normal] text-faint">{relay.answers ? `answered · ${relay.byName}` : `asks this team · ${relay.byName}`}</span> : null}
        {lead ? <span className="tc-lead">★ lead</span> : null}
        <Ago ts={m.ts} />
        <span className="flex-1 min-w-0" />
        {author ? (
          <button className="tc-act" title={`Reply to ${author.name}`} aria-label={`Reply to ${author.name}`} onClick={() => onReply(m)}>
            <Icon name="message-circle" size={13} />
          </button>
        ) : null}
      </div>
      {parent ? <div className="text-[12px] text-faint mb-1 truncate">{`↪ ${senderName(parent, (id) => agentOf(id)?.name)}: ${String(parent.text).slice(0, 90)}`}</div> : null}
      {m.text ? <DomNode className="dom-contents" make={() => textWithMentions(m.text, names ? names.split('\n') : [], teams ? teams.split('\n') : [])} deps={[m.text, names, teams]} /> : null}
      <DomNode className="dom-contents" make={() => mentionPreviews(m.text, m.attachments, { compact: true, key: `team:${m.id}` })} deps={[m.id, m.text, JSON.stringify(m.attachments || [])]} />
      {m.turn && m.from !== 'user' && m.from !== 'system' ? <Work m={m} /> : null}
      {m.mentions?.length && m.from !== 'user' ? (
        <div className="flex items-center gap-1.25 mt-1.5 font-mono text-[10.5px] font-medium leading-[normal] text-ice">
          <Icon name="send" size={11} />
          {`handed to ${m.mentions.map((id) => agentOf(id)?.name).filter(Boolean).join(', ')}`}
        </div>
      ) : null}
    </div>
  );
});

/** A working agent's turn, streamed in as it goes (its text and tool calls). */
function LiveTurn({ agentId, chatId }: { agentId: string; chatId: string }) {
  const a = agentOf(agentId);
  return (
    <div className={MSG_LIVE}>
      <div className={WHO}>
        {a ? <Avatar agent={a} /> : <div className="avatar"><Icon name="bot" size={14} /></div>}
        <b>{a?.name || 'Agent'}</b>
        <span className="hint">working…</span>
      </div>
      <div className={TURN_BODY}>
        <Suspense fallback={null}>
          <TurnView agentId={agentId} chatId={chatId} live />
        </Suspense>
      </div>
    </div>
  );
}

/** The parts the box shares with renderTeamChat's focus() and mention(). */
interface BoxRef {
  input: HTMLTextAreaElement | null;
  /** asked for before the box was drawn (React draws it a moment after renderTeamChat returns) */
  pending: { focus: boolean; mentions: string[] };
}

/** Start a message to someone: "@Name " at the front of the box, the caret at the end. */
function mentionIn(input: HTMLTextAreaElement, name: string): void {
  const tag = `@${name} `;
  if (!input.value.includes(tag)) input.value = `${tag}${input.value}`;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function TeamChat({ teamId, height, fill, box }: { teamId: string; height: number; fill: boolean; box: BoxRef }) {
  useAppState(); // (names, avatars and who is lead follow the app state)
  const [C, bump, store] = useTeamData(teamId);
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const [suggest, setSuggest] = useState<{ start: number; opts: MentionOption[]; index: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [slash, setSlash] = useState<SlashMenu | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  // something to send in the box (words or files): Send; nothing while the team works: Stop
  const [filled, setFilled] = useState(false);
  const refill = useRef(() => {});
  const tray = useMemo(() => attachTray({ onChange: () => refill.current() }), []);
  refill.current = () => setFilled(!!input.current?.value.trim() || tray.count() > 0);
  // long pasted text, folded into a chip until it is sent
  const pastes = useMemo(() => pasteBox(), []);
  /** Put text back in the box (a failed send, what Stop brought back). */
  const restore = (text: string) => {
    pastes.restore(text);
    refill.current();
  };
  const sending = useRef(false);
  // the queued message being changed (its id)
  const [editing, setEditing] = useState<string | null>(null);

  const members = (C.team?.members || []).map(agentOf).filter((a): a is Agent => Boolean(a));
  const names = members.map((a) => a.name).join('\n');
  // the teams a #Name can mean: the others, and this one (named in their messages)
  const teams = [...C.others.map((t) => t.name), ...(C.team ? [C.team.name] : [])].join('\n');
  const busy = [...C.working, ...C.queued.filter((q) => !C.working.includes(q))];

  // ---- staying at the newest message: by where you scrolled, not measured at a redraw (a live turn or a
  // preview grows between redraws). While you are at the bottom, it follows anything that grows.
  const stick = useRef(true);
  const follow = useCallback(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(follow);
  useEffect(() => {
    const el = list.current!;
    const grows = new MutationObserver(follow);
    grows.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('load', follow, true);
    el.addEventListener('loadedmetadata', follow, true);
    return () => {
      grows.disconnect();
      el.removeEventListener('load', follow, true);
      el.removeEventListener('loadedmetadata', follow, true);
    };
  }, [follow]);

  // ---- your /loop and /goal (× ends one)
  const chipsSig = JSON.stringify([C.loop, C.goal?.id, C.goal?.followUps]);
  useEffect(() => {
    if (!chips.current) return;
    commandChips(chips.current, {
      loop: store.current.loop,
      goal: store.current.goal,
      onStopLoop: () => void attempt(() => DEL(`/teams/${teamId}/loop`)),
      onClearGoal: () => void attempt(() => DEL(`/teams/${teamId}/goal`)).then((r) => r && ((store.current.goal = null), bump())),
    });
  }, [chipsSig, teamId, store, bump]);

  const unqueue = (q: QueuedMessage) => {
    store.current.held = store.current.held.filter((x) => x.id !== q.id);
    bump();
    void attempt(() => DEL(`/teams/${teamId}/queue/${q.id}`));
  };
  const keepEdit = (text: string) => keepLostEdit(text, input.current, restore);
  const editQueued = async (q: QueuedMessage, text: string) => {
    const put = (t: string) => {
      store.current.held = store.current.held.map((x) => (x.id === q.id ? { ...x, text: t } : x));
      bump();
    };
    put(text);
    const r = await attempt(() => PUT<{ queued: QueuedMessage | null }>(`/teams/${teamId}/queue/${q.id}`, { text }));
    // not saved: it shows what will go after all; sent before the change got there: the new words come back to the box
    if (!r) put(q.text);
    else if (r.queued === null) keepEdit(text);
  };
  const orderQueued = (ids: string[]) => {
    const by = new Map(store.current.held.map((q) => [q.id, q]));
    store.current.held = ids.map((id) => by.get(id)).filter((q): q is QueuedMessage => !!q);
    bump();
    void attempt(() => POST(`/teams/${teamId}/queue/order`, { ids }));
  };
  const stop = async () => {
    const r = await attempt(() => POST<{ unqueued?: QueuedMessage[] }>(`/teams/${teamId}/stop`));
    // what you queued comes back to the box, so stopping never loses it
    const back = r?.unqueued || [];
    if (back.length) restore(back.map((q) => q.text).filter(Boolean).join('\n\n'));
    if (back.some((q) => q.attachments?.length)) toast('Your queued messages are back in the box. Attach their files again.');
  };
  const reply = useCallback((m: TeamMessage | null) => {
    setReplyTo(m);
    if (m) input.current?.focus();
  }, []);
  const clear = async (): Promise<boolean> => {
    if (!(await confirmBox('Clear this team chat? Each agent also forgets the conversation.', { ok: 'Clear', danger: true }))) return false;
    return (await attempt(() => POST(`/teams/${teamId}/clear`))) !== undefined;
  };
  const held = (q: QueuedMessage | undefined) => {
    if (q && !store.current.held.some((x) => x.id === q.id)) {
      store.current.held = [...store.current.held, q];
      bump();
    }
  };
  const emptyBox = () => {
    input.current!.value = '';
    slashRef.current?.update();
    pastes.sync();
    refill.current();
  };

  // /stop, /resume, /resend, /goal: done now (files in the tray stay for your next message)
  const command = async (name: string, rest: string, typed: string) => {
    emptyBox();
    if (name === 'stop') return stop();
    // (said no, or it failed: the /clear stays in the box)
    if (name === 'clear') return void ((await clear()) || restore(typed));
    if (name === 'goal' && !rest) {
      const r = await attempt(() => GET<TeamChatResponse>(`/teams/${teamId}/chat`));
      return void (r && toast(r.goal ? `Goal: ${r.goal.goal || r.goal.text}` : 'No goal yet. Type /goal and what done looks like.'));
    }
    type Done = { goal?: BrainBrief | null; queued?: QueuedMessage };
    const r = await attempt(() => POST<Done>(`/teams/${teamId}/${name}`, name === 'goal' ? { text: rest } : {}));
    if (!r) return restore(typed);
    if (name === 'goal') {
      store.current.goal = r.goal || null;
      bump();
    }
    held(r.queued);
  };

  const loopOff = async (rest: string, typed: string) => {
    emptyBox();
    const r = await attempt(() => POST<{ loop: LoopInfo | null }>(`/teams/${teamId}/loop`, { text: rest, attachments: [] }));
    if (!r) return restore(typed);
    store.current.loop = r.loop;
    bump();
  };

  const send = async () => {
    const box = input.current!;
    // (with pasted text put back: a long goal pasted in goes in full)
    const now = parseCommand(pastes.text(), 'team');
    if (now && ['stop', 'resume', 'resend', 'goal', 'clear'].includes(now.name)) return command(now.name, now.rest, pastes.text().trim());
    // /loop off ends the loop: the files staged for the next message stay (they would go nowhere)
    if (now?.name === 'loop' && LOOP_OFF.test(now.rest)) return loopOff(now.rest, pastes.text().trim());
    if ((!box.value.trim() && !tray.count()) || sending.current) return;
    sending.current = true;
    try {
      if (tray.busy()) setUploading(true);
      const attachments = await tray.ready();
      setUploading(false);
      if (!attachments) return;
      // what is in the box now (more may have been typed while the files uploaded)
      const typed = pastes.text().trim();
      // "/loop [15m] [5x] …": posted again and again (with the files), or /loop off
      const cmd = parseCommand(typed, 'team');
      if (cmd?.name === 'loop') {
        if (LOOP_OFF.test(cmd.rest)) return loopOff(cmd.rest, typed);
        emptyBox();
        const taken = tray.take();
        const r = await attempt(() => POST<{ loop: LoopInfo | null }>(`/teams/${teamId}/loop`, { text: cmd.rest, attachments }));
        if (!r) return void (restore(typed), tray.put(taken));
        store.current.loop = r.loop;
        return bump();
      }
      if (cmd && cmd.name !== 'queue') return command(cmd.name, cmd.rest, typed);
      // "/queue …": posted once nobody is working (now, if nobody is). Anything else while the team works
      // changes its course: whoever is working stops and takes it up now.
      const queued = queuedText(typed);
      const steer = store.current.working.length > 0;
      const text = queued ?? typed;
      if (!text && !attachments.length) return void (typed && toast('Write the message after /queue'));
      emptyBox();
      const taken = tray.take();
      const body = { text, replyTo: replyRef.current?.id || null, attachments };
      type Sent = { message?: TeamMessage; queued?: QueuedMessage };
      const r = await attempt((): Promise<Sent> => (queued != null ? POST<Sent>(`/teams/${teamId}/queue`, body) : POST<TeamMessage>(`/teams/${teamId}/${steer ? 'steer' : 'messages'}`, body).then((message) => ({ message }))));
      if (!r) {
        restore(typed);
        tray.put(taken);
        return;
      }
      setReplyTo(null);
      held(r.queued);
    } finally {
      sending.current = false;
    }
  };
  // the box's own listeners (native: the paste chips and the / menu change its text as typing does) read these
  const sendRef = useRef(send);
  sendRef.current = send;
  const replyRef = useRef(replyTo);
  replyRef.current = replyTo;
  const membersRef = useRef(members);
  membersRef.current = members;
  const slashRef = useRef<SlashMenu | null>(null);
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;

  const pick = (o: MentionOption) => {
    const ta = input.current!;
    const pos = ta.selectionStart;
    const m = /(^|\s)([@#])([\w .-]{0,30})$/.exec(ta.value.slice(0, pos));
    if (!m) return;
    const start = pos - m[3].length - 1;
    ta.value = `${ta.value.slice(0, start)}${o.t ? '#' : '@'}${o.label} ${ta.value.slice(pos)}`;
    const caret = start + o.label.length + 2;
    ta.setSelectionRange(caret, caret);
    setSuggest(null);
    ta.focus();
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // ---- the box: @ suggestions, the / menu, Enter to send
  useEffect(() => {
    const ta = input.current!;
    box.input = ta;
    // what was asked before the box was here (opened from the Station with a member's @)
    const { focus, mentions } = box.pending;
    box.pending = { focus: false, mentions: [] };
    for (const name of mentions) mentionIn(ta, name);
    if (focus && !mentions.length) ta.focus();
    const menu = slashMenu(ta, 'team', { run: () => void sendRef.current() });
    slashRef.current = menu;
    setSlash(menu);
    const offPastes = pastes.attach(ta);
    const find = (index = 0): { start: number; opts: MentionOption[]; index: number } | null => {
      const pos = ta.selectionStart;
      const m = /(^|\s)([@#])([\w .-]{0,30})$/.exec(ta.value.slice(0, pos));
      if (!m) return null;
      const q = m[3].toLowerCase();
      // # is another team, @ someone here
      const all: MentionOption[] = m[2] === '#' ? store.current.others.map((t) => ({ label: t.name, t })) : [...membersRef.current.map((a) => ({ label: a.name, a })), { label: 'everyone' }, { label: 'Brain' }];
      const opts = all.filter((o) => o.label.toLowerCase().startsWith(q) || o.label.toLowerCase().includes(q));
      return opts.length ? { start: pos - m[3].length - 1, opts, index: Math.min(index, opts.length - 1) } : null;
    };
    const onInput = () => {
      setSuggest(find());
      menu.update();
      refill.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (menu.key(e)) return void e.stopPropagation();
      const s = suggestRef.current && find(suggestRef.current.index);
      if (s && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setSuggest({ ...s, index: (s.index + (e.key === 'ArrowDown' ? 1 : -1) + s.opts.length) % s.opts.length });
        return;
      }
      if (s && (e.key === 'Tab' || e.key === 'Enter')) {
        e.preventDefault();
        pickRef.current(s.opts[s.index]);
        return;
      }
      if (e.key === 'Escape' && suggestRef.current) return e.preventDefault(), setSuggest(null);
      // Up in an empty box: change the last queued message
      const held = store.current.held;
      if (e.key === 'ArrowUp' && !ta.value && held.length && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        return setEditing(held[held.length - 1].id);
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void sendRef.current();
      }
      e.stopPropagation();
    };
    ta.addEventListener('input', onInput);
    ta.addEventListener('keydown', onKey);
    return () => {
      ta.removeEventListener('input', onInput);
      ta.removeEventListener('keydown', onKey);
      offPastes();
      if (box.input === ta) box.input = null;
    };
  }, [pastes, box, store]);

  // ---- files: dropped on the chat, and gone with it
  useEffect(() => {
    const off = tray.dropZone(root.current!, 'Drop files or folders for the team');
    return () => {
      off();
      // the tab closed: unsent attachments go too
      tray.discard();
    };
  }, [tray]);

  const turns = [...C.turning].filter((id) => C.sessions[id]);
  const lead = C.team?.lead;
  return (
    <div className={fill ? 'flex flex-col gap-2 h-full' : 'flex flex-col gap-2'} ref={root}>
      <div
        // (in a scrolling column, an item must keep its height: never squeezed by the list's)
        className={fill ? 'tc-list overflow-y-auto flex flex-col gap-2 py-1 px-0.5 *:shrink-0 flex-1 min-h-0' : 'tc-list overflow-y-auto flex flex-col gap-2 py-1 px-0.5 *:shrink-0 min-h-[120px]'}
        ref={list}
        style={fill ? undefined : { maxHeight: `${height}px` }}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {C.messages.length ? (
          C.messages.map((m) => (
            <Message
              key={m.id}
              m={m}
              parent={m.replyTo ? C.messages.find((x) => x.id === m.replyTo) || null : null}
              author={m.from === 'user' || m.from === 'system' || m.from === 'brain' || m.relay ? undefined : agentOf(m.from)}
              team={m.relay ? C.others.find((t) => t.id === m.relay!.teamId) : undefined}
              lead={!!lead && lead === m.from}
              names={names}
              teams={teams}
              onReply={reply}
            />
          ))
        ) : (
          <div className="text-center text-dim py-4.5 px-2 text-[13px]">
            <Icon name="message-square" size={22} className="text-accent mb-1.5" />
            <p>{lead ? `Write to the team. ${agentOf(lead)?.name} (lead) takes it and brings in the others.` : 'Write to the team. The best fit answers, or @mention someone.'}</p>
          </div>
        )}
        {/* whose turn is going now, streaming in, after the messages */}
        {turns.map((id) => (
          <LiveTurn key={`${id}:${C.sessions[id]}`} agentId={id} chatId={C.sessions[id]} />
        ))}
      </div>
      <div className="cmd-chips compact hidden" ref={chips} />
      <QueuedList
        items={C.held}
        head="Sends when the team is done"
        compact
        editing={editing}
        onEditing={setEditing}
        onSave={(q, text) => void editQueued(q, text)}
        onRemove={unqueue}
        onOrder={orderQueued}
        onLeave={() => input.current?.focus()}
        onLost={(_q, text) => keepEdit(text)}
      />
      {/* who is working and who is next */}
      <div className="tc-status flex flex-col gap-0.75 min-h-0" aria-live="polite">
        {uploading ? (
          <span className={`${TYPING} text-amber`}>
            <span className="dot busy" />
            Uploading files…
          </span>
        ) : (
          <>
            {C.working.map((id) => (
              <span key={id} className={`${TYPING} text-amber`}>
                <span className="dot busy" />
                {id === 'brain' ? 'The Brain is answering…' : `${agentOf(id)?.name || 'Agent'} is working${C.activity[id] ? ` · ${C.activity[id]}` : '…'}`}
              </span>
            ))}
            {C.queued
              .filter((q) => !C.working.includes(q))
              .map((id) => (
                <span key={`q:${id}`} className={`${TYPING} text-dim`}>
                  <Icon name="clock" size={12} />
                  {`${agentOf(id)?.name || 'Agent'} is next`}
                </span>
              ))}
          </>
        )}
      </div>
      <div className={`flex items-center gap-1.5 text-[12px] text-ice ${replyTo ? '' : ' hidden'}`}>
        {replyTo ? (
          <>
            <Icon name="message-circle" size={12} />
            {`Replying to ${agentOf(replyTo.from)?.name}`}
            <button className="tc-act" aria-label="Don't reply" onClick={() => reply(null)}>
              <Icon name="x" size={12} />
            </button>
          </>
        ) : null}
      </div>
      <DomNode className="dom-contents" make={() => tray.el} deps={[tray]} />
      <DomNode className="dom-contents" make={() => pastes.el} deps={[pastes]} />
      <div className="flex gap-1.5 items-stretch relative">
        <div className="flex-1 min-w-0 relative">
          <textarea className={`${COMPOSER_TEXT} text-[13.5px]`} ref={input} rows={2} aria-label="Message the team" placeholder={busy.length ? 'The team is working… Write to change its course now, or /queue a message for when it is done' : PLACEHOLDER} />          <div className={`tc-suggest${suggest ? '' : ' hidden'}`} role="listbox" aria-label="Mention">
            {suggest?.opts.map((o, i) => (
              <button
                key={`${o.t ? '#' : '@'}${o.label}`}
                className={`tc-sopt${i === suggest.index ? ' on' : ''}`}
                role="option"
                aria-selected={i === suggest.index}
                onMouseDown={(e) => (e.preventDefault(), pick(o))}
              >
                {o.a ? (
                  <Avatar agent={o.a} />
                ) : o.t ? (
                  <div className={TEAM_AV} style={{ '--team-color': o.t.color || 'var(--color-ice)' } as CSSProperties}>{o.t.mark || '#'}</div>
                ) : (
                  <Icon name={o.label === 'Brain' ? 'brain' : 'users'} size={14} />
                )}
                {`${o.t ? '#' : '@'}${o.label}`}
                {o.label === 'Brain' && !o.t ? <span className="hint">ask the Brain</span> : null}
                {o.a?.specialty ? <span className="hint">{o.a.specialty}</span> : o.t ? <span className="hint">{o.t.description || 'ask this team'}</span> : null}
              </button>
            ))}
          </div>
          {slash ? <DomNode as="span" className="dom-contents" make={() => slash.el} deps={[slash]} /> : null}
        </div>
        {/* the paperclip at the top of the box, Send at its bottom (Stop there while the team works and the box is empty) */}
        <div className={COMPOSER_BTNS}>
          <DomNode as="span" className="dom-contents" make={() => tray.picker} deps={[tray]} />
          {busy.length && !filled ? (
            <button className="btn danger" title="Stop the whole team" aria-label="Stop" onClick={() => void stop()}>
              <Icon name="square" size={14} />
            </button>
          ) : (
            <button className="btn" title={busy.length ? 'Send now: whoever is working stops and takes this up (Enter)' : 'Send (Enter)'} aria-label="Send" onClick={() => void send()}>
              <Icon name="send" size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function renderTeamChat(container: HTMLElement, teamId: string, { height = 360, fill = false }: TeamChatOptions = {}): TeamChatApi {
  const box: BoxRef = { input: null, pending: { focus: false, mentions: [] } };
  const root = mountReact(container, <TeamChat teamId={teamId} height={height} fill={fill} box={box} />);
  return {
    // (before the box is drawn, kept until it is)
    focus: () => (box.input ? box.input.focus() : (box.pending.focus = true)),
    // start a message to someone: "@Name "
    mention: (name: string) => (box.input ? mentionIn(box.input, name) : void box.pending.mentions.push(name)),
    destroy: () => root.unmount(),
  };
}
