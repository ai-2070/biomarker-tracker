// The global chat: one window on every page. Talk to the Brain (it answers, builds teams and agents,
// writes PROJECT.md or hands the work to an agent or team), or straight to any agent or team.
// The chat's state and what it does (sending, /queue, /loop, live events) live here in the module;
// React draws it (draw() asks for a redraw, at most once a frame).
import { StrictMode, Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { h, state, GET, POST, attempt, md, onEvent, onState, navigate, refreshSoon, toast } from './core.ts';
import { openBranchBuilder } from './builder.ts';
import { modelChip, modelInfo, brainModelChip, brainAsAgent } from './models.ts';
import { brainQueue, chatLoop, holdQueue, latestLoad } from './brainqueue.ts';
import { queuedText } from '../shared/queue.ts';
import { parseCommand, parseLoop } from '../shared/commands.ts';
import { commandChips, slashMenu } from './chatcommands.ts';
import { flipFrom, flipTo, slideIn, reducedMotion } from './motion.ts';
import { attachTray, COMPOSER_BTNS, COMPOSER_TEXT } from './attach.ts';
import { pasteBox } from './pastes.ts';
import { QueuedList, keepLostEdit } from './queuedlist.tsx';
import { openMemory, BRAIN } from './memory.ts';
import { mentionPreviews } from './filepreview.ts';
import { brainKeyLabel, brainKeyTitle, brainShortcut } from './shortcuts.ts';
import { Avatar, DomNode, Icon, useAppState } from './ui/react.tsx';
import { ChipSet } from './ui/controls.tsx';
import type { AttachTray, PickedFile } from './attach.ts';
import type { PasteBox } from './pastes.ts';
import type { AgentDraft, BranchDesign } from './builder.ts';
import type { TeamEvent } from './teamchat.tsx';
import type { ActiveRun, Agent, AppState, BrainAnswer, BrainDelegate, BrainDone, Chat, ChatItem, QueuedMessage, RunEvent, ServerEvent, TeamListing, TeamMessage } from '../shared/types.ts';
import type { UIMessage } from 'ai';

// A handed-off agent's turn, streamed in as it goes: the AI SDK pieces load when first needed.
const TurnView = lazy(() => import('./chat/TurnView.tsx').then((m) => ({ default: m.TurnView })));

/** One line of GET /api/brain/history. */
interface BrainHistoryEntry {
  role: 'user' | 'brain';
  text: string;
  ts: number;
  attachments?: string[];
}
/** A workflow run as 'workflow-run' events and GET /api/workflow-runs carry it (old step-list teams). */
interface WorkflowRun {
  id: string;
  status: string;
  steps?: unknown;
  error?: string | null;
  output?: unknown;
}
interface ToolChip {
  id: string;
  name: string;
  status: 'running' | 'done';
  isError?: boolean;
}
/** What a message was sent as (to whom, a /goal?): /resend and /resume send it again the same way. */
interface Sent {
  text: string;
  attachments: string[];
  target: string;
  goal?: boolean;
}
type UserItem = { id: string; kind: 'user'; text: string; attachments?: string[]; sent?: Sent };
/** action: a button after the text ("Send it my message") */
type NoteItem = { id: string; kind: 'note'; text: string; busy?: boolean; error?: boolean; action?: { label: string; run: () => void } };
/** started: its message went, so its turn can be streamed in (web/chat/TurnView); turn: counts the
 *  turns started since (a /resume), so the view follows the new one */
type AgentItem = { id: string; kind: 'agent'; agentId: string; chatId: string; text: string; tools: ToolChip[]; images: string[]; reason: string; done: boolean; status?: string; started?: boolean; turn?: number };
type BranchItem = { id: string; kind: 'branch'; wfId: string; name: string; reason: string; since: number; messages: TeamMessage[]; working: string[]; next?: string[]; runId?: string; steps?: unknown; error?: string | null; output?: string; briefId?: string };
/** A tool the Brain used while it answered (it reads the project's files). */
interface BrainStep {
  id: string;
  name: string;
  input: unknown;
  state: 'running' | 'done' | 'error';
  output: string;
}
/** live: the answer is still streaming in (answer: what it has written so far; steps: the tools it used) */
type BrainItem = { id: string; kind: 'brain'; answer?: string; done: BrainDone[]; delegate?: BrainDelegate | null; old?: boolean; live?: boolean; steps?: BrainStep[]; ask?: Sent };
type DraftItem = { id: string; kind: 'agent-draft'; agent: AgentDraft; task: string; attachments: string[] };
/** One message in the Brain chat. */
type DockItem = UserItem | NoteItem | AgentItem | BranchItem | BrainItem | DraftItem;
type NewItem = DockItem extends infer T ? (T extends DockItem ? Omit<T, 'id'> : never) : never;
/** A failed request, kept as a value (the .catch below). */
type Failed = { error?: string };

interface Dock {
  open: boolean;
  /** the panel is showing (it stays while it folds back into the button) */
  shown: boolean;
  /** the "Ask the Brain" button: hidden while the chat is open, see-through while the chat folds into it */
  launcherHidden: boolean;
  launcherFaded: boolean;
  /** 'auto' | 'new-agent' | 'new-branch' | 'a:<agent id>' | 'b:<team id>' */
  target: string;
  items: DockItem[];
  input: HTMLTextAreaElement | null;
  workflows: TeamListing[];
  /** the project this chat shows */
  project: string | null;
  panel: HTMLDivElement | null;
  launcher: HTMLButtonElement | null;
  /** Files waiting to go with the next message. */
  tray?: AttachTray;
  /** Long pasted text, folded into a chip until it is sent. */
  pastes?: PasteBox;
  /** What the last /stop cut off: the Brain's answer it was writing, and the agents and teams working from here. */
  stoppedAsk?: Sent | null;
  stoppedWork?: { chats: { agentId: string; chatId: string }[]; teams: string[] } | null;
}

const D: Dock = { open: false, shown: false, launcherHidden: false, launcherFaded: false, target: 'auto', items: [], input: null, workflows: [], project: null, panel: null, launcher: null };
const PLACEHOLDER = 'What do you want done?';

// ---------- looks (dock-msg, user and brain stay: tests look them up) ----------
const MSG = 'dock-msg rounded-box animate-[rise-in_0.22s_var(--ease-soft)] py-2.5 px-3 border text-[14px] leading-[1.55] wrap-anywhere';
const MSG_AGENT = `${MSG} border-line bg-[rgba(7,8,7,0.55)]`;
const MSG_DRAFT = `${MSG} border-accent-dim bg-[rgba(7,8,7,0.55)]`;
const MSG_USER = `${MSG} user font-chat self-end max-w-[85%] whitespace-pre-wrap border-[color-mix(in_srgb,var(--color-accent)_28%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_9%,#111611)]`;
/** who wrote it: the avatar, the name, a hint (smaller in a team's thread) */
const WHO = 'flex items-center gap-2 mb-2 [&_.avatar]:size-6.5 [&_.avatar]:text-[14px]';
const WHO_SMALL = 'flex items-center gap-2 mb-2 [&_.avatar]:size-5.5 [&_.avatar]:text-[12px]';
const NOTE = 'animate-[rise-in_0.22s_var(--ease-soft)] flex flex-wrap items-center gap-2 text-[13px] text-dim';
const NOTE_ERR = 'animate-[rise-in_0.22s_var(--ease-soft)] flex flex-wrap items-center gap-2 text-[13px] text-red';
/** an answer in Markdown */
const ANSWER = 'font-chat [&_p]:mx-0 [&_p]:mt-0 [&_p]:mb-1.5 [&_pre]:max-h-[220px]';
const BRAIN_AV = 'avatar bg-accent/16 text-accent';
const ACT = 'flex items-center gap-2 py-1.5 px-2.25 rounded-[8px] text-[12.5px] border animate-[rise-in_.22s_ease-out_both]';
const ACT_OK = `${ACT} bg-accent/8 border-[color-mix(in_srgb,var(--color-accent)_22%,var(--color-line))]`;
const ACT_ERR = `${ACT} bg-amber/10 border-[color-mix(in_srgb,var(--color-amber)_35%,var(--color-line))]`;

// ---------- drawing ----------
// React reads the module's state; notify() draws it again now, draw() at most once a frame.
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const notify = () => {
  version++;
  for (const l of listeners) l();
};
const useDock = () => useSyncExternalStore(subscribe, () => version);
const now = () => flushSync(notify);
let frame = false;
function draw() {
  if (frame) return;
  frame = true;
  requestAnimationFrame(() => {
    frame = false;
    notify();
    // something may have finished: a /queue message can go now, then the loop's next one
    held.check();
    loop.check();
  });
}

export function initDock(): void {
  D.tray = attachTray({ onChange: draw });
  D.pastes = pasteBox();
  // the bottom bar holds the "Ask the Brain" button (and the minimized chats, web/chatwin.tsx)
  const bar = h('div.bottom-bar', { class: 'fixed z-45 left-1/2 bottom-4.5 [transform:translateX(-50%)] flex items-center gap-2.5 pointer-events-none *:pointer-events-auto' });
  const host = h('div.dom-contents');
  document.body.append(bar, host);
  D.project = state.data?.project?.id || null;
  // (drawn at once: askBrain() and openDock() may come right after)
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <StrictMode>
        <DockView bar={bar} />
      </StrictMode>,
    ),
  );
  onState(() => {
    checkTarget();
    draw();
  });
  onState(projectChanged);
  // Ctrl+K (⌘K) opens or closes the chat from anywhere; Space opens it on the Station
  document.addEventListener('keydown', (e) => {
    const shortcut = brainShortcut(e, { open: D.open, onStation: onStation() });
    if (shortcut) {
      e.preventDefault();
      toggle(shortcut === 'open' ? true : !D.open);
    } else if (e.key === 'Escape' && D.open && !e.defaultPrevented && !document.querySelector('.modal-back, .model-menu')) {
      e.preventDefault();
      toggle(false);
    }
  });
  onEvent(handleEvent);
  loadWorkflows();
  loadHistory();
}

const onStation = () => document.body.classList.contains('station-mode');
// the Station (where Space opens it) comes and goes with the page
const watchBody = (tick: () => void) => {
  const o = new MutationObserver(tick);
  o.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => o.disconnect();
};

// Ask the Brain from anywhere (e.g. right after creating a project), with files already uploaded.
export function askBrain(text: string, attachments: string[] = []): void {
  D.target = 'auto';
  toggle(true);
  now();
  D.input!.value = text;
  send(attachments);
}

// Files dropped on the Brain on the map: open the Brain chat with them attached, ready for what to do.
export function attachToBrain(picked: PickedFile[]): void {
  D.target = 'auto';
  toggle(true);
  draw();
  D.tray!.add(picked);
  setTimeout(() => D.input?.focus(), 40);
}

// The last few turns with the Brain, so the chat picks up where it left off.
// (only the newest load counts: one from a project you have since left must not fill this one's chat)
const historyLoads = latestLoad();
async function loadHistory() {
  const current = historyLoads.start();
  const project = D.project;
  const msgs = await GET<BrainHistoryEntry[]>('/brain/history').catch((): BrainHistoryEntry[] => []);
  if (!current() || project !== D.project || D.items.length) return;
  for (const m of msgs.slice(-6)) D.items.push(m.role === 'user' ? { id: `h${m.ts}u`, kind: 'user', text: m.text, attachments: m.attachments } : { id: `h${m.ts}b`, kind: 'brain', answer: m.text, done: [], old: true });
  draw();
}

async function newConversation() {
  // keep the transcript if the Brain still remembers it
  if (!(await attempt(() => POST('/brain/clear')))) return;
  brainAsks.reset(); // answers still on their way belong to the old conversation
  held.clear();
  loop.stop();
  historyLoads.reset();
  forgetConversation();
  draw();
}

// What belonged to the conversation just left: what /resume would pick up again, and (by the
// generation) the agent and team designs still on their way.
let conversation = 0;
function forgetConversation() {
  conversation++;
  D.stoppedAsk = null;
  D.stoppedWork = null;
  D.items = [];
}
/** Take an item out of the chat, if it is still there (a new conversation may have cleared it). */
function remove(it: DockItem) {
  const at = D.items.indexOf(it);
  if (at !== -1) D.items.splice(at, 1);
}

// Another project was opened: this chat was about the old one. Drop it (and anything still waiting
// to be sent or answered there) and show the new project's Brain chat.
function projectChanged(d: { project?: { id: string } | null }) {
  const id = d.project?.id || null;
  if (!id || id === D.project) return;
  const first = D.project === null;
  D.project = id;
  if (first) return;
  brainAsks.reset();
  held.clear();
  loop.stop();
  forgetConversation();
  draw();
  loadHistory();
  loadWorkflows();
}

export function openDock(target: string | null = null, text = ''): void {
  if (target) D.target = target;
  toggle(true);
  checkTarget();
  now();
  if (text) {
    D.input!.value = text;
    D.pastes!.sync();
  }
}

// Opening grows the chat out of the "Ask the Brain" button; closing folds it back into it.
let closing: Promise<void> | null = null;
function toggle(open: boolean) {
  if (open === D.open && !closing) return;
  D.open = open;
  const { panel, launcher } = D;
  if (open) {
    const from = launcher?.getBoundingClientRect();
    closing = null;
    panel?.getAnimations().forEach((a) => a.cancel());
    Object.assign(D, { shown: true, launcherHidden: true, launcherFaded: false });
    checkTarget();
    now();
    if (panel && from?.width && !reducedMotion()) {
      flipFrom(panel, from, { duration: 460, fade: true });
      // the inside arrives a moment later, so the shape leads
      for (const [i, part] of [...panel.children].entries()) slideIn(part, { y: 10, duration: 360 + i * 60 })?.effect?.updateTiming({ delay: 120 + i * 40, fill: 'backwards' });
    }
    setTimeout(() => D.input?.focus(), 30);
    return;
  }
  // closing: show the button again (invisible) so we know where to fold into
  Object.assign(D, { launcherHidden: false, launcherFaded: true });
  now();
  if (!panel || !launcher) return void (Object.assign(D, { shown: false, launcherFaded: false }), now());
  const done = (closing = flipTo(panel, launcher.getBoundingClientRect(), { duration: 300 }).then(() => {
    if (closing !== done) return;
    closing = null;
    Object.assign(D, { shown: false, launcherFaded: false });
    now();
    slideIn(launcher, { scale: 0.92, duration: 260 });
  }));
}

async function loadWorkflows() {
  D.workflows = await GET<TeamListing[]>('/workflows').catch(() => D.workflows);
  checkTarget();
  draw();
}

// Who you can write to: the Brain, a new agent or team, any agent, any team.
const teamsToPick = () => D.workflows.filter((w) => w.members?.length || w.steps?.length);
function checkTarget() {
  const t = D.target;
  const ok = t === 'auto' || t === 'new-agent' || t === 'new-branch' || (t.startsWith('a:') && !!state.data?.agents.some((a) => a.id === t.slice(2))) || (t.startsWith('b:') && teamsToPick().some((w) => w.id === t.slice(2)));
  if (!ok) D.target = 'auto';
}

// The model that will answer: the agent's (switchable), the Brain's own for Auto / New, or the team's lead.
function modelNode(t: string, agents: readonly Agent[]): Node | null {
  if (t.startsWith('a:')) {
    const a = agents.find((x) => x.id === t.slice(2));
    return a ? modelChip(a, { compact: true }) : null;
  }
  if (t.startsWith('b:')) {
    const wf = D.workflows.find((w) => w.id === t.slice(2));
    const lead = wf?.lead ? agents.find((x) => x.id === wf.lead) : null;
    return lead ? h('span', { class: 'inline-flex items-center gap-1 text-[11px]', title: 'The team lead answers first' }, '★ ', modelChip(lead, { compact: true })) : h('span.hint', { class: 'inline-flex items-center gap-1 text-[11px]' }, 'each agent its own model');
  }
  // The Brain itself (and New agent / New team): the Brain's own model
  return brainModelChip();
}

// ---------- messages ----------
function add<K extends DockItem['kind']>(item: NewItem & { kind: K }): Extract<DockItem, { kind: K }> {
  D.items.push({ id: Math.random().toString(36).slice(2), ...item } as DockItem);
  draw();
  return D.items[D.items.length - 1] as Extract<DockItem, { kind: K }>;
}

const agentOf = (id: string) => state.data?.agents.find((a) => a.id === id);

/** Markdown, as a plain-DOM piece, with the chat's classes. */
function Markdown({ text, className }: { text: string; className: string }) {
  return (
    <DomNode
      className="dom-contents"
      make={() => {
        const el = md(text);
        el.classList.add(...className.split(' ').filter(Boolean));
        return el;
      }}
      deps={[text, className]}
    />
  );
}
function Previews({ text, attachments, id }: { text: string; attachments?: string[]; id: string }) {
  return <DomNode className="dom-contents" make={() => mentionPreviews(text, attachments, { compact: true, key: `dock:${id}` })} deps={[id, text, JSON.stringify(attachments || [])]} />;
}

// A tool call the Brain made, as the chats show them (open it for its input and result).
function StepCard({ st }: { st: BrainStep }) {
  const input = typeof st.input === 'string' ? st.input : JSON.stringify(st.input ?? {}, null, 2);
  const brief = st.input && typeof st.input === 'object' ? Object.values(st.input as Record<string, unknown>).filter((v) => typeof v === 'string').join(' · ').slice(0, 120) : '';
  return (
    <details className={`tool small${st.state === 'error' ? ' error' : ''}`}>
      <summary>
        {st.state === 'running' ? <span className="dot busy" /> : st.state === 'error' ? <span className="text-red">✕</span> : <span className="text-accent">✓</span>}
        <span className="tname">{st.name}</span>
        <span className="targ">{brief}</span>
      </summary>
      <div className="tbody">
        <div className="label">Input</div>
        <pre>{input}</pre>
        {st.state === 'running' ? (
          <div className="hint">Running…</div>
        ) : (
          <>
            <div className="label">{st.state === 'error' ? 'Error' : 'Result'}</div>
            <pre>{st.output || '(empty)'}</pre>
          </>
        )}
      </div>
    </details>
  );
}

const DONE_ICONS: Record<string, string> = { team: 'users', hired: 'user-plus', file: 'file-text', routine: 'repeat', skill: 'puzzle', model: 'cpu', mcp: 'plug', stop: 'square', memory: 'file-text', error: 'triangle-alert', note: 'check' };
// What the Brain did, with where to see it.
function DoneAction({ d }: { d: BrainDone }) {
  const open = d.teamId
    ? { label: 'Show', go: () => navigate(`#/station?team=${d.teamId}`) }
    : d.routineId
      ? { label: 'Open', go: () => navigate(`#/routines/${d.routineId}`) }
      : d.skillId
        ? { label: 'Open', go: () => navigate(`#/skills/${d.skillId}`) }
        : d.kind === 'mcp'
          ? { label: 'Open', go: () => navigate('#/settings?tab=mcp') }
          : d.memory
            ? { label: 'Open', go: () => openMemory(d.memory!, d.memory === BRAIN ? 'The Brain' : agentOf(d.memory!)?.name) }
            : null;
  return (
    <div className={d.kind === 'error' ? ACT_ERR : ACT_OK}>
      <Icon name={DONE_ICONS[d.kind] || 'check'} size={13} />
      <span className="flex-1">{d.text}</span>
      {open ? (
        <button className="btn tiny ghost" onClick={open.go}>
          {open.label}
        </button>
      ) : null}
    </div>
  );
}

function BrainMessage({ it, settings }: { it: BrainItem; settings: AppState['settings'] | undefined }) {
  const b = settings?.brain || { model: 'haiku' };
  return (
    <div className={`${MSG_AGENT} brain`}>
      <div className={WHO}>
        <div className={BRAIN_AV}>
          <Icon name="brain" size={14} />
        </div>
        <b>Brain</b>
        <span className="text-[10.5px] text-faint font-mono">{modelInfo(brainAsAgent(b)).short}</span>
      </div>
      {it.steps?.length ? (
        <div className="flex flex-col gap-1 my-1 font-mono text-[12.5px] leading-[normal] font-normal text-dim">
          {it.steps.map((st) => (
            <StepCard key={st.id} st={st} />
          ))}
        </div>
      ) : null}
      {/* (still streaming: what it has written so far; nothing yet: it is looking at the project) */}
      {it.live && !it.answer ? (
        <div className={NOTE}>
          <span className="dot busy" />
          The Brain is looking at the project…
        </div>
      ) : (
        <Markdown text={it.answer || (it.done?.length ? '' : '(no answer)')} className={it.live ? `${ANSWER} cursor` : ANSWER} />
      )}
      {it.answer && !it.live ? <Previews text={it.answer} id={it.id} /> : null}
      {it.done?.length ? (
        <div className="flex flex-col gap-1 mt-2">
          {it.done.map((d, i) => (
            <DoneAction key={i} d={d} />
          ))}
        </div>
      ) : null}
      {it.delegate ? (
        <div className={`${ACT_OK} mt-1.5`}>
          <Icon name="send" size={13} />
          <span className="flex-1">
            Handed to <b>{it.delegate.name}</b>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function AgentMessage({ it }: { it: AgentItem }) {
  const a = agentOf(it.agentId);
  return (
    <div className={MSG_AGENT}>
      <div className={WHO}>
        {a ? <Avatar agent={a} /> : null}
        <b>{a?.name || 'Agent'}</b>
        {a ? <span className="text-[10.5px] text-faint font-mono">{modelInfo(a).short}</span> : null}
        {it.reason ? <span className="hint">{it.reason}</span> : null}
        <span className="flex-1 min-w-0" />
        <button className="btn tiny ghost" onClick={() => navigate(`#/agents/${it.agentId}/${it.chatId}`)}>
          Open chat
        </button>
      </div>
      {/* its turn, streamed in: text as written, tool calls you can open (and file previews) */}
      {it.started ? (
        <div className="flex flex-col gap-1.5 min-w-0">
          <Suspense fallback={null}>
            <TurnView key={it.turn || 0} agentId={it.agentId} chatId={it.chatId} live onSend={(t) => void continueAgent(it, t)} />
          </Suspense>
        </div>
      ) : it.text ? (
        <Markdown text={it.text} className={ANSWER} />
      ) : (
        <div className="hint">{it.done ? '(no answer)' : 'Working…'}</div>
      )}
      {!it.done ? (
        <div className={NOTE}>
          <span className="dot busy" />
          {it.status || 'Working…'}
        </div>
      ) : null}
    </div>
  );
}

function TeamThreadMessage({ m }: { m: TeamMessage }) {
  const a = agentOf(m.from);
  // (the Brain follows up in the thread too)
  const brain = m.from === 'brain';
  return (
    <div className="border-t border-line pt-2 mt-2">
      <div className={WHO_SMALL}>
        {a ? (
          <Avatar agent={a} />
        ) : brain ? (
          <div className={BRAIN_AV}>
            <Icon name="brain" size={14} />
          </div>
        ) : null}
        <b>{a?.name || (brain ? 'Brain' : 'Team')}</b>
        {m.mentions?.length ? <span className="hint">{`→ ${m.mentions.map((id) => agentOf(id)?.name).filter(Boolean).join(', ')}`}</span> : null}
      </div>
      <Markdown text={String(m.text).slice(0, 3000)} className={ANSWER} />
      <Previews text={m.text} attachments={m.attachments} id={m.id} />
    </div>
  );
}

function TeamMessageView({ it }: { it: BranchItem }) {
  const nameOf = (id: string) => (id === 'brain' ? 'Brain' : agentOf(id)?.name);
  return (
    <div className={MSG_AGENT}>
      <div className={WHO}>
        <div className="avatar">
          <Icon name="users" size={14} />
        </div>
        <b>{it.name}</b>
        {it.reason ? <span className="hint">{it.reason}</span> : null}
        <span className="flex-1 min-w-0" />
        <button className="btn tiny ghost" onClick={() => navigate('#/station')}>
          Open team
        </button>
      </div>
      {(it.messages || []).map((m) => (
        <TeamThreadMessage key={m.id} m={m} />
      ))}
      {it.working?.length ? (
        <div className={NOTE}>
          <span className="dot busy" />
          {`${it.working.map((id) => nameOf(id) || 'Agent').join(', ')} working…`}
        </div>
      ) : !it.messages?.length ? (
        <div className={NOTE}>
          <span className="dot busy" />
          Sent to the team…
        </div>
      ) : null}
    </div>
  );
}

// A new agent the Brain designed: check it, then create it.
function DraftCard({ it }: { it: DraftItem }) {
  const a = it.agent;
  const [name, setName] = useState(a.name);
  const [spec, setSpec] = useState(a.specialty);
  const [groups, setGroups] = useState<string[]>(a.toolGroups || []);
  // the card turns into a plain note once it is done
  const becomeNote = (text: string) => {
    Object.assign(it as unknown as NoteItem, { kind: 'note', text });
    draw();
  };
  const create = async (thenRun: boolean) => {
    const created = await attempt(() => POST<Agent>('/agents', a));
    if (!created) return;
    becomeNote(`Created ${created.emoji || ''} ${created.name}.`);
    refreshSoon(0);
    if (thenRun) void toAgent(created.id, it.task, 'new agent', it.attachments);
  };
  return (
    <div className={MSG_DRAFT}>
      <div className={WHO}>
        <div className="avatar">{a.emoji}</div>
        <b>New agent</b>
        <span className="hint">designed from your message</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <input aria-label="Name" value={name} onChange={(e) => setName((a.name = e.target.value))} />
        <input aria-label="What it does" value={spec} onChange={(e) => setSpec((a.specialty = e.target.value))} />
      </div>
      <div className="mt-3.5">
        <ChipSet label="Tools" options={(state.data?.toolGroups || []).map((g) => ({ value: g.id, label: g.label, title: g.description }))} value={groups} onChange={(v) => setGroups((a.toolGroups = v))} />
      </div>
      <details className="mt-3.5">
        <summary className="hint cursor-pointer">Instructions</summary>
        <pre>{a.systemPrompt}</pre>
      </details>
      <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
        <button className="btn small" onClick={() => void create(true)}>
          Create &amp; do it
        </button>
        <button className="btn ghost small" onClick={() => void create(false)}>
          Create only
        </button>
        <button className="btn ghost small" onClick={() => becomeNote('Skipped.')}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Item({ it, settings }: { it: DockItem; settings: AppState['settings'] | undefined }) {
  if (it.kind === 'user')
    return (
      <div className="flex flex-col gap-1.5">
        <div className={MSG_USER}>{it.text || null}</div>
        <Previews text={it.text} attachments={it.attachments} id={it.id} />
      </div>
    );
  if (it.kind === 'note')
    return (
      <div className={it.error ? NOTE_ERR : NOTE}>
        {it.busy ? <span className="dot busy" /> : null}
        {it.text}
        {it.action ? (
          <button className="btn tiny" onClick={it.action.run}>
            {it.action.label}
          </button>
        ) : null}
      </div>
    );
  if (it.kind === 'agent') return <AgentMessage it={it} />;
  if (it.kind === 'branch') return <TeamMessageView it={it} />;
  if (it.kind === 'brain') return <BrainMessage it={it} settings={settings} />;
  if (it.kind === 'agent-draft') return <DraftCard it={it} />;
  return null;
}

// The messages. They stay the same elements while the chat changes (each piece of a streaming answer
// draws them again), so none replays its entrance.
function DockList({ settings }: { settings: AppState['settings'] | undefined }) {
  const list = useRef<HTMLDivElement>(null);
  // stays at the newest message while you are there (by where you scrolled), following what grows
  const stick = useRef(true);
  const follow = () => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  };
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
  }, []);
  return (
    <div
      className="dock-list flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-2.5"
      ref={list}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {D.items.length ? (
        D.items.map((it) => <Item key={it.id} it={it} settings={settings} />)
      ) : (
        <div className="m-auto text-center text-dim max-w-[380px]">
          <Icon name="sparkles" size={26} className="text-accent mb-2" />
          <p>Ask the Brain anything about the project, or for anything to be done.</p>
          <p className="hint">It sees every agent and team and what they are doing. It answers questions itself, builds teams from the Agent library ("make me a social media team"), and hands work to the right agent or team.</p>
        </div>
      )}
    </div>
  );
}

// whether the box had words in it when the chat was last drawn (typing redraws only when that changes)
let drawnFilled = false;

function DockView({ bar }: { bar: HTMLElement }) {
  useDock();
  const data = useAppState();
  const station = useSyncExternalStore(watchBody, onStation);
  const input = useRef<HTMLTextAreaElement>(null);
  const slashHost = useRef<HTMLSpanElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  // the queued message being changed (its id)
  const [editing, setEditing] = useState<string | null>(null);

  // the box: the / menu, long pastes, Enter to send; files dropped anywhere on the chat
  useLayoutEffect(() => {
    const box = input.current!;
    D.input = box;
    const slash = slashMenu(box, 'brain', { run: () => void send() });
    slashHost.current!.replaceChildren(slash.el);
    const offPastes = D.pastes!.attach(box);
    const onInput = () => {
      slash.update();
      // (Send or Stop: drawn again only when the box goes from empty to not, or back)
      if (!!box.value.trim() !== drawnFilled) draw();
    };
    const onKey = (e: KeyboardEvent) => {
      if (slash.key(e)) return;
      // Up in an empty box: change the last queued message
      const waiting = held.items();
      if (e.key === 'ArrowUp' && !box.value && waiting.length && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        return setEditing(waiting[waiting.length - 1].id);
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void send();
      }
    };
    box.addEventListener('input', onInput);
    box.addEventListener('keydown', onKey);
    const offDrop = D.tray!.dropZone(D.panel!, 'Drop files or folders for the Brain');
    return () => {
      box.removeEventListener('input', onInput);
      box.removeEventListener('keydown', onKey);
      offPastes();
      offDrop();
    };
  }, []);

  // your /loop's chip
  const loopSig = JSON.stringify(loop.info());
  useEffect(() => {
    commandChips(chips.current!, { loop: loop.info(), goal: null, onStopLoop: () => loop.stop() && add({ kind: 'note', text: 'Loop stopped.' }), onClearGoal: () => {} });
  }, [loopSig]);

  const agents = data?.agents || [];
  const teams = teamsToPick();
  const waiting = held.items();
  const idle = dockIdle();
  const placeholder = D.tray?.count() ? 'What should be done with these files?' : idle ? PLACEHOLDER : 'Working… Write to change course now, or /queue a message for when this is done';
  // nothing to send while something works: Stop in Send's place
  drawnFilled = !!D.input?.value.trim();
  const stopInstead = !idle && !drawnFilled && !D.tray?.count();
  // (the list works with queued messages: the files a held one carries, and whom it goes to)
  const queuedItems: QueuedMessage[] = waiting.map((m) => ({ id: m.id, text: m.text, ts: 0, ...(m.extra.attachments.length ? { attachments: m.extra.attachments } : {}) }));
  const targetOf = new Map(waiting.map((m) => [m.id, m.extra.target]));
  return (
    <>
      {createPortal(
        <button
          ref={(el) => void (D.launcher = el)}
          className={`dock-launcher relative flex items-center gap-2.5 py-2.75 pr-4.5 pl-3.5 cursor-pointer bg-glass backdrop-blur-[16px] border border-accent-dim rounded-full text-ink font-sans text-[14px] font-medium leading-[normal] shadow-[0_10px_30px_rgba(0,0,0,0.45),0_0_24px_rgba(196,255,61,0.12)] [transition:transform_0.18s_var(--ease-soft),background-color_0.18s,border-color_0.18s,color_0.18s,box-shadow_0.2s,opacity_0.2s] hover:[transform:translateY(-2px)] hover:border-accent hover:shadow-[0_14px_34px_rgba(0,0,0,0.5),0_0_30px_rgba(196,255,61,0.22)] in-[.in-chat]:hidden ${D.launcherHidden ? ' hidden' : ''}`}
          style={D.launcherFaded ? { opacity: 0 } : undefined}
          title={brainKeyTitle()}
          onClick={() => toggle(true)}
          // files dragged onto the button open the chat with them
          onDragEnter={(e) => e.dataTransfer?.types.includes('Files') && toggle(true)}
        >
          <Icon name="sparkles" size={17} />
          <span>Ask the Brain…</span>
          <kbd className="font-mono text-[10px] font-medium leading-[normal] text-faint border border-line-2 rounded-[4px] px-1.25 py-px">{brainKeyLabel(station)}</kbd>
        </button>,
        bar,
      )}
      <div
        className={`dock fixed z-46 left-1/2 bottom-4 -translate-x-1/2 w-[min(680px,calc(100vw-32px))] h-[min(70vh,640px)] flex flex-col border border-line-2 overflow-hidden rounded-box bg-glass backdrop-blur-[16px] backdrop-saturate-140 shadow-pop ${D.shown ? '' : ' hidden'}`}
        ref={(el) => void (D.panel = el)}
      >
        <div className="flex items-center gap-2.5 py-3 px-3.5 border-b border-line">
          <b className="flex items-center gap-2 text-[14px]">
            <Icon name="brain" size={16} className="text-accent" />
            Brain chat
          </b>
          <span className="flex-1 min-w-0" />
          <span className="font-mono text-[10px] font-medium leading-[normal] tracking-[0.14em] uppercase text-faint">to</span>
          <select
            className="dock-target w-[230px] py-1.5 pr-7 pl-2.5 text-[13px]"
            aria-label="Send to"
            value={D.target}
            onChange={(e) => {
              D.target = e.target.value;
              now();
            }}
          >
            <option value="auto">🧠 The Brain: answers, builds, hands off</option>
            <option value="new-agent">+ New agent from this</option>
            <option value="new-branch">+ New team from this</option>
            {agents.length ? (
              <optgroup label="Agents">
                {agents.map((a) => (
                  <option key={a.id} value={`a:${a.id}`}>{`${a.emoji || ''} ${a.name}`}</option>
                ))}
              </optgroup>
            ) : null}
            {teams.length ? (
              <optgroup label="Teams">
                {teams.map((w) => (
                  <option key={w.id} value={`b:${w.id}`}>{`⇢ ${w.name}`}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <DomNode className="dock-model inline-flex items-center [&_.model-chip]:text-[11px]" make={() => modelNode(D.target, agents)} deps={[D.target, data, D.workflows]} />
          <button className="icon-btn" onClick={() => openMemory(BRAIN)} title="The Brain's MEMORY.md: what it remembers across conversations" aria-label="The Brain's MEMORY.md">
            <Icon name="file-text" size={15} />
          </button>
          <button className="icon-btn" onClick={() => void newConversation()} title="New conversation (the Brain forgets this chat)" aria-label="New conversation">
            <Icon name="rotate-ccw" size={15} />
          </button>
          <button className="icon-btn" onClick={() => toggle(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <DockList settings={data?.settings} />
        <div className="cmd-chips compact pt-1.5 px-3.5 pb-0 max-sm:pt-1 max-sm:px-0 hidden" ref={chips} />
        {/* your /queue messages, in the order they will go (click one to change it, drag to reorder, × takes one back) */}
        <div className="px-3.5 dock-held empty:hidden">
          <QueuedList
            items={queuedItems}
            head="Sends when everything above is done"
            compact
            editing={editing}
            onEditing={setEditing}
            onSave={(q, text) => void (held.edit(q.id, text) || keepEdit(text))}
            onRemove={(q) => held.remove(q.id)}
            onOrder={(ids) => held.order(ids)}
            onLeave={() => input.current?.focus()}
            onLost={(_q, text) => keepEdit(text)}
            hint={(q) => {
              const t = targetOf.get(q.id);
              return t && t !== 'auto' ? `to ${targetName(t)}` : null;
            }}
          />
        </div>
        <div className="px-3.5 [&_.att-tray]:pt-2.5">
          <DomNode className="dom-contents" make={() => D.tray!.el} deps={[]} />
          <DomNode className="dom-contents" make={() => D.pastes!.el} deps={[]} />
        </div>
        <div className="flex gap-2 py-3 px-3.5 border-t border-line items-stretch">
          <div className="flex-1 min-w-0 relative">
            <textarea className={`dock-input ${COMPOSER_TEXT}`} ref={input} rows={2} aria-label="Message the Brain" placeholder={placeholder} />
            <span className="dom-contents" ref={slashHost} />
          </div>
          {/* the paperclip at the top of the box, Send at its bottom (Stop there while something works and the box is empty) */}
          <div className={COMPOSER_BTNS}>
            <DomNode as="span" className="dom-contents" make={() => D.tray!.picker} deps={[]} />
            {stopInstead ? (
              <button className="btn danger" onClick={() => void brainStop()} title="Stop the Brain and the work it handed on" aria-label="Stop">
                <Icon name="square" size={14} />
              </button>
            ) : (
              <button className="btn" onClick={() => void send()} title={idle ? 'Send (Enter)' : 'Send now: the Brain stops the answer it is writing and takes this up (Enter)'} aria-label="Send">
                <Icon name="send" size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- sending ----------
// One Brain ask at a time, each tied to the project and conversation it was typed in (see brainqueue.ts).
// The Brain's answer streams in (Vercel AI SDK: its transport and stream reader; server/uistream.ts
// streamBrain): onUpdate sees the message so far, and the whole answer comes at the end (data-answer).
interface BrainAsk {
  attachments: string[];
  onUpdate: (m: UIMessage) => void;
  /** your /goal: the Brain hands it on and follows up until it is met */
  goal?: boolean;
  /** stop reading its answer (you sent a new message meanwhile) */
  signal?: AbortSignal;
}
async function streamBrainAnswer(text: string, project: string | null, { attachments, onUpdate, goal, signal }: BrainAsk): Promise<BrainAnswer> {
  const [{ readUIMessageStream }, { brainTransport }] = await Promise.all([import('ai'), import('./chat/transport.ts')]);
  const stream = await brainTransport({ text, project, attachments, ...(goal ? { goal: true } : {}) }).sendMessages({ chatId: 'brain', messages: [], trigger: 'submit-message', messageId: undefined, abortSignal: signal });
  let answer: BrainAnswer | null = null;
  const errors: string[] = [];
  for await (const m of readUIMessageStream({ stream, onError: (e) => errors.push((e as Error).message || String(e)) })) {
    onUpdate(m);
    const d = m.parts.find((p) => p.type === 'data-answer') as { data?: BrainAnswer } | undefined;
    if (d?.data) answer = d.data;
  }
  if (!answer) throw new Error(errors[0] || "The Brain didn't answer.");
  return answer;
}
/** What a Brain message shows while it streams: the text and tools since it last started over. */
export function brainProgress(m: UIMessage): { answer: string; steps: BrainStep[] } {
  const parts = m.parts.slice(m.parts.findLastIndex((p) => p.type === 'data-restart') + 1);
  const answer = parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
  const steps = parts.flatMap((p): BrainStep[] => {
    if (p.type !== 'dynamic-tool') return [];
    const out = p.state === 'output-available' ? p.output : null;
    return [{ id: p.toolCallId, name: p.toolName, input: p.input, state: p.state === 'output-error' ? 'error' : p.state === 'output-available' ? 'done' : 'running', output: p.state === 'output-error' ? p.errorText : out && typeof out === 'object' && 'text' in out ? String((out as { text: unknown }).text) : '' }];
  });
  return { answer, steps };
}
const brainAsks = brainQueue<BrainAnswer, BrainAsk>((text, project, extra) => streamBrainAnswer(text, project, extra ?? { attachments: [], onUpdate: () => {} }));
const openProject = () => state.data?.project?.id || null;

let sending = false;
const emptyBox = () => {
  D.input!.value = '';
  D.pastes!.sync();
  draw();
};
function keepEdit(text: string) {
  keepLostEdit(text, D.input, (t) => {
    D.pastes!.restore(t);
    draw();
  });
}

// given: files uploaded elsewhere (a new project), sent along with what's in the tray
async function send(given: string[] = []) {
  const input = D.input!;
  const tray = D.tray!;
  // /stop, /resume, /resend, /goal: done now (files in the tray stay for your next message)
  // (with pasted text put back: a long goal pasted in goes in full)
  const quick = parseCommand(D.pastes!.text(), 'brain');
  if (quick && ['stop', 'resume', 'resend', 'goal'].includes(quick.name)) {
    emptyBox();
    return command(quick.name, quick.rest);
  }
  if ((!input.value.trim() && !tray.count() && !given.length) || sending) return;
  sending = true;
  let attachments: string[] | null;
  let uploading: NoteItem | null = null;
  try {
    if (tray.busy()) uploading = add({ kind: 'note', text: 'Uploading files…', busy: true });
    attachments = await tray.ready();
  } finally {
    sending = false;
    if (uploading) {
      remove(uploading);
      draw();
    }
  }
  if (!attachments) return;
  attachments = [...given, ...attachments];
  // what is in the box now (more may have been typed while the files uploaded)
  const typed = D.pastes!.text().trim();
  // "/loop [15m] [5x] …" (with the files), or /loop off
  const cmd = parseCommand(typed, 'brain');
  if (cmd?.name === 'loop') {
    if (/^(off|stop|end|cancel)$/i.test(cmd.rest)) {
      emptyBox();
      return void (loop.stop() ? add({ kind: 'note', text: 'Loop stopped.' }) : toast('No loop is going here.'));
    }
    const spec = parseLoop(cmd.rest);
    if ('error' in spec) return toast(spec.error);
    if (D.target === 'auto' && !(D.project || openProject())) return toast('The project is still loading. Try again in a moment.');
    emptyBox();
    tray.take();
    return loop.start(spec, { attachments, target: D.target });
  }
  if (cmd && cmd.name !== 'queue') {
    emptyBox();
    return command(cmd.name, cmd.rest);
  }
  // "/queue …": waits until everything in this chat is done (goes now if nothing is working)
  const queued = queuedText(typed);
  const text = queued ?? typed;
  if (!text && !attachments.length) return void (typed && toast('Write the message after /queue'));
  // who it goes to: as chosen now (not whoever is picked while the Brain's answer is being stopped)
  const target = D.target;
  // a Brain message belongs to a project: wait until the page knows which one is open
  if (target === 'auto' && !(D.project || openProject())) return toast('The project is still loading. Send it again in a moment.');
  emptyBox();
  tray.take();
  if (queued != null) return void held.add(text, { attachments, target });
  // to the Brain while it writes an answer: that answer stops, and this one is answered now
  if (target === 'auto') await steerBrain();
  return track(() => dispatch(text, attachments, target));
}

// The answers the Brain is writing now, to cut off when you send a new message meanwhile.
const answering = new Map<BrainItem, AbortController>();
/** A new message to the Brain while it answers: that answer is dropped (it changes nothing, like /stop) and
 *  the question it was answering stays in the Brain's history, so the new answer knows it. Your waiting
 *  messages, the loop, and the agents and teams it handed work to carry on. (One too far along to stop
 *  still comes, by itself: brain-late.) */
async function steerBrain() {
  const live = D.items.filter((x): x is BrainItem => x.kind === 'brain' && !!x.live);
  if (!live.length) return;
  // (what is still on its way is no longer wanted)
  brainAsks.reset();
  for (const x of live) {
    answering.get(x)?.abort();
    answering.delete(x);
    remove(x);
  }
  add({ kind: 'note', text: "Stopped the Brain's answer to take your new message." });
  await attempt(() => POST('/brain/steer'));
}

// ---------- /queue ----------
// Waiting messages, sent one at a time once nothing in the chat is working: no Brain answer on its
// way, no agent or team still on work from here, no message being sent.
interface HeldExtra {
  attachments: string[];
  target: string;
  goal?: boolean;
}
let pending = 0;
async function track(work: () => Promise<unknown>): Promise<void> {
  pending++;
  try {
    await work();
  } finally {
    pending--;
    draw();
  }
}
const working = (it: DockItem) => (it.kind === 'brain' && !!it.live) || (it.kind === 'agent' && !it.done) || (it.kind === 'branch' && !!(it.working.length || it.next?.length));
const dockIdle = () => !pending && !D.items.some(working);
const held = holdQueue<HeldExtra>({ idle: dockIdle, send: (m) => track(() => dispatch(m.text, m.extra.attachments, m.extra.target, { goal: m.extra.goal })), onChange: draw });
// /loop: kept in the page; a due one waits for /queue messages and for the chat to be idle
const loop = chatLoop<HeldExtra>({
  idle: () => dockIdle() && !held.items().length,
  send: (text, x) => track(() => dispatch(text, x.attachments, x.target)),
  onChange: draw,
  onEnd: (l) => add({ kind: 'note', text: `Loop done: sent ${l.times} time${l.times > 1 ? 's' : ''}.` }),
});

// ---------- /stop, /resume, /resend, /goal ----------
async function command(name: string, rest: string) {
  if (name === 'stop') return brainStop();
  if (name === 'resume') return brainResume();
  if (name === 'resend') {
    const last = D.items.findLast((x): x is UserItem => x.kind === 'user' && !!x.sent)?.sent;
    if (!last) return toast('Nothing to send again yet.');
    return void held.add(last.text, { attachments: last.attachments, target: last.target, goal: last.goal });
  }
  if (name === 'goal') {
    if (!rest) return toast('Type /goal and what done looks like. The Brain hands it on and follows up until it is met.');
    if (D.target === 'auto' && !(D.project || openProject())) return toast('The project is still loading. Try again in a moment.');
    // (waits like a /queue message if something is working)
    return void held.add(rest, { attachments: [], target: D.target, goal: true });
  }
}

// /stop: the answer the Brain is writing (it changes nothing), your waiting messages (back to the box),
// the loop, and the agents and teams working from here.
async function brainStop() {
  const live = D.items.filter((x): x is BrainItem => x.kind === 'brain' && !!x.live);
  D.stoppedAsk = live.find((x) => x.ask)?.ask || null;
  brainAsks.reset();
  for (const x of live) remove(x);
  const back = held.clear();
  if (back.length) D.pastes!.restore(back.map((m) => m.text).filter(Boolean).join('\n\n'));
  const looped = loop.stop();
  const chats = D.items.filter((x): x is AgentItem => x.kind === 'agent' && !x.done).map((x) => ({ agentId: x.agentId, chatId: x.chatId }));
  const teams = [...new Set(D.items.filter((x): x is BranchItem => x.kind === 'branch' && !!(x.working.length || x.next?.length)).map((x) => x.wfId))];
  D.stoppedWork = { chats, teams };
  const r = await attempt(() => POST<{ stopped: string[] }>('/brain/stop', { chats, teams }));
  const what = [live.length ? 'the Brain' : '', ...(r?.stopped || []), looped ? 'the loop' : ''].filter(Boolean);
  add({ kind: 'note', text: what.length ? `Stopped ${what.join(', ')}. /resume picks it up again.` : 'Nothing was working.' });
}

// /resume: the answer /stop cut off is asked again; the agents and teams it stopped carry on.
async function brainResume() {
  const ask = D.stoppedAsk;
  D.stoppedAsk = null;
  if (ask) void track(() => dispatch(ask.text, ask.attachments, ask.target, { goal: ask.goal }));
  const r = await POST<{ resumed: string[]; chats: string[] }>('/brain/resume', D.stoppedWork || {}).catch((e: Error) => e);
  if (r instanceof Error) return void (ask || toast(r.message || 'Nothing to resume.'));
  D.stoppedWork = null;
  // (they work again: the chat waits for them before a /queue message or the loop's next one)
  // (the newest card of each chat follows it: an older one shows a turn already done)
  const cards = new Map<string, AgentItem>();
  for (const x of D.items) if (x.kind === 'agent') cards.set(x.chatId, x);
  for (const x of cards.values()) if (r.chats.includes(x.chatId)) again(x);
  add({ kind: 'note', text: `Resumed: ${r.resumed.join(', ')}.` });
}

function targetName(t: string): string {
  if (t.startsWith('a:')) return agentOf(t.slice(2))?.name || 'an agent';
  if (t.startsWith('b:')) return D.workflows.find((w) => w.id === t.slice(2))?.name || 'a team';
  return t === 'new-agent' ? 'a new agent' : t === 'new-branch' ? 'a new team' : 'the Brain';
}

// Sends one message: to the chosen agent or team, or to the Brain (which may hand it on).
// goal: your /goal: an agent or team gets it as its goal; the Brain hands it on and follows up.
async function dispatch(text: string, attachments: string[], t: string, { goal = false }: { goal?: boolean } = {}) {
  const sent: Sent = { text, attachments, target: t, ...(goal ? { goal } : {}) };
  add({ kind: 'user', text: goal ? `Goal: ${text}` : text, attachments, sent });
  if (t.startsWith('a:')) return toAgent(t.slice(2), text, goal ? 'goal' : '', attachments, goal);
  if (t.startsWith('b:')) return toBranch(t.slice(2), text, goal ? 'goal' : '', attachments, goal);
  if (t === 'new-agent' && !goal) return newAgent(text, attachments);
  if (t === 'new-branch' && !goal) return newBranch(text, attachments);
  // The Brain: answers, changes the roster, or hands the work on
  // its answer streams into this message as it is written
  const live = add({ kind: 'brain', answer: '', done: [], live: true, steps: [], ask: sent }) as BrainItem;
  const cutOff = new AbortController();
  answering.set(live, cutOff);
  const turn = await brainAsks.ask(text, D.project || openProject(), () => D.project || openProject(), {
    goal,
    attachments,
    signal: cutOff.signal,
    onUpdate: (m) => {
      if (!D.items.includes(live)) return;
      Object.assign(live, brainProgress(m));
      draw();
    },
  });
  answering.delete(live);
  const drop = () => {
    const at = D.items.indexOf(live);
    if (at !== -1) D.items.splice(at, 1);
  };
  // a new conversation or another project since: this answer is no longer wanted here
  if (turn.kind === 'stale') return drop(), draw();
  if (turn.kind === 'error') return drop(), add({ kind: 'note', text: `The Brain couldn't answer: ${turn.error}`, error: true });
  showAnswer(live, turn.answer, goal);
}

/** The Brain's answer in its message, and the agent or team it handed the work to, followed here. */
function showAnswer(live: BrainItem, r: BrainAnswer, goal: boolean) {
  if (!D.items.includes(live)) D.items.push(live);
  Object.assign(live, { answer: r.answer, done: r.done || [], delegate: r.delegate, live: false });
  draw();
  if (r.done?.length) {
    refreshSoon(0);
    loadWorkflows();
  }
  // the server already handed it on, as the Brain: follow the agent's chat or the team's thread here
  const d = r.delegate;
  if (goal && !d) add({ kind: 'note', text: "The Brain didn't hand this goal to anyone, so there is nothing to follow up. Pick an agent or team above, or ask it to hand it on." });
  if (d?.kind === 'agent' && d.sent?.chatId) {
    const chatId = d.sent.chatId;
    const it = add({ kind: 'agent', agentId: d.id, chatId, text: '', tools: [], images: [], reason: 'from the Brain', done: false, started: true });
    // it may have finished before this answer got here (then no 'done' comes for this card)
    void GET<ActiveRun[]>('/runs')
      .then((runs) => {
        if (!runs.some((x) => x.chatId === chatId)) (it.done = true), draw();
      })
      .catch(() => {});
  }
  if (d?.kind === 'branch' && d.sent?.ts) {
    const it = add({ kind: 'branch', wfId: d.id, name: d.name, reason: 'from the Brain', since: d.sent.ts, messages: [], working: [], briefId: d.sent.messageId });
    // the team may have answered before this answer got here: those messages came before the item did
    void GET<{ messages: TeamMessage[]; working: string[]; queued: string[] }>(`/teams/${d.id}/chat`)
      .then((t) => {
        if (!D.items.includes(it)) return;
        mergeTeamMessages(it, t.messages);
        it.working = t.working;
        it.next = t.queued;
        draw();
      })
      .catch(() => {});
  }
}

// Team messages for a dock item: the ones since its brief (not yours, not the brief itself), each once, in order.
export function mergeTeamMessages(it: Pick<BranchItem, 'messages' | 'since' | 'briefId'>, messages: TeamMessage[]): void {
  const have = new Set(it.messages.map((m) => m.id));
  for (const m of messages) if (!have.has(m.id) && m.from !== 'user' && m.id !== it.briefId && m.ts >= it.since) it.messages.push(m);
  it.messages.sort((a, b) => a.ts - b.ts);
}

// goal: sent as its /goal (the Brain checks each turn and follows up)
async function toAgent(agentId: string, text: string, reason = '', attachments: string[] = [], goal = false) {
  const c = await attempt(() => POST<Chat>(`/agents/${agentId}/chats`));
  if (!c) return;
  const it = add({ kind: 'agent', agentId, chatId: c.id, text: '', tools: [], images: [], reason, done: false });
  const r = await attempt(() => (goal ? POST(`/agents/${agentId}/chats/${c.id}/goal`, { text }) : POST(`/agents/${agentId}/chats/${c.id}/messages`, { text, attachments })));
  if (!r) {
    it.done = true;
    it.text = '(could not start)';
  } else it.started = true;
  draw();
}

/** Its chat works again (a new turn): the card follows that turn. */
function again(it: AgentItem) {
  it.done = false;
  it.status = '';
  it.turn = (it.turn || 0) + 1;
}

// A button in an agent's Rich answer: what it sends goes to that agent's chat, followed here.
async function continueAgent(it: AgentItem, text: string) {
  if (!it.done) return toast('It is still working. Wait for it to finish.');
  const r = await attempt(() => POST(`/agents/${it.agentId}/chats/${it.chatId}/messages`, { text, attachments: [] }));
  if (!r || !D.items.includes(it)) return;
  add({ kind: 'user', text });
  add({ kind: 'agent', agentId: it.agentId, chatId: it.chatId, text: '', tools: [], images: [], reason: it.reason, done: false, started: true });
}

async function toBranch(wfId: string, text: string, reason = '', attachments: string[] = [], goal = false) {
  const wf = D.workflows.find((w) => w.id === wfId);
  // (shown before it is sent, so it hears who starts working: the team starts before the reply comes)
  const it = add({ kind: 'branch', wfId, name: wf?.name || 'Team', reason, since: Date.now(), messages: [], working: [] });
  if (goal) {
    if (!(await attempt(() => POST(`/teams/${wfId}/goal`, { text })))) remove(it);
    return draw();
  }
  // (while the team works, it changes its course: whoever is working takes it up now)
  const msg = await attempt(() => POST<TeamMessage>(`/teams/${wfId}/steer`, { text, attachments }));
  if (!msg) {
    remove(it);
    return draw();
  }
  it.since = msg.ts;
  it.messages = it.messages.filter((m) => m.ts >= msg.ts);
  draw();
}

async function newAgent(text: string, attachments: string[] = []) {
  const n = add({ kind: 'note', text: 'Designing an agent for this…', busy: true });
  const gen = conversation;
  const a: Partial<AgentDraft> & Failed = await POST<AgentDraft>('/assist/agent', { text, attachments }).catch((e: Error) => ({ error: e.message }));
  // (a new conversation or another project since: the design belongs to the old one)
  if (gen !== conversation) return;
  remove(n);
  if (a.error) return add({ kind: 'note', text: `Couldn't design it: ${a.error}`, error: true });
  add({ kind: 'agent-draft', agent: a as AgentDraft, task: text, attachments });
}

async function newBranch(text: string, attachments: string[] = []) {
  const n = add({ kind: 'note', text: 'Building a team from your agents…', busy: true });
  const gen = conversation;
  const design: Partial<BranchDesign> & Failed = await POST<BranchDesign>('/assist/branch', { text, attachments }).catch((e: Error) => ({ error: e.message }));
  if (gen !== conversation) return;
  remove(n);
  if (design.error) return add({ kind: 'note', text: `Couldn't build it: ${design.error}`, error: true });
  draw();
  openBranchBuilder({
    prefill: design,
    files: attachments,
    onSaved: async (wf) => {
      await loadWorkflows();
      D.items.push({ id: 'ran' + wf.id, kind: 'note', text: `Team "${wf.name}" is ready.`, action: { label: 'Send it my message', run: () => void toBranch(wf.id, text, '', attachments) } });
      draw();
    },
  });
}

// ---------- live updates ----------
function handleEvent(ev: ServerEvent) {
  if (ev.type === 'workflows') loadWorkflows();
  // the Brain reviewed finished work by itself and recorded or improved a skill, or checked on work it
  // handed out (brain-note: done, stuck, or a team needs you)
  if ((ev.type === 'brain-learned' || ev.type === 'brain-note') && ev.projectId === D.project) {
    add({ kind: 'brain', answer: String(ev.answer || ''), done: (ev.done as BrainDone[]) || [] });
    return;
  }
  // an answer your new message cut off, but too far along to stop: what it did shows, and the work it handed on is followed
  if (ev.type === 'brain-late' && ev.projectId === D.project && ev.answer && typeof ev.answer === 'object') {
    showAnswer(add({ kind: 'brain', answer: '', done: [], steps: [] }) as BrainItem, ev.answer as BrainAnswer, ev.goal === true);
    return;
  }
  if (ev.type === 'run') {
    // (the newest card for the chat: a button in an answer adds one for the turn it starts)
    const it = D.items.findLast((x): x is AgentItem => x.kind === 'agent' && x.chatId === ev.chatId);
    if (!it) return;
    const e = ev.event as RunEvent;
    // a new turn in its chat (a /resume, a button in its answer): follow that one
    if (e.kind === 'start' && it.done) again(it);
    else if (e.kind === 'text') {
      it.text += e.text;
      it.status = 'Writing…';
    } else if (e.kind === 'tool') {
      it.tools.push({ id: e.id, name: e.name, status: 'running' });
      it.status = `Using ${e.name}…`;
    } else if (e.kind === 'tool_result') {
      const t = it.tools.find((x) => x.id === e.id);
      if (t) Object.assign(t, { status: 'done', isError: e.isError });
      if (e.images?.length) it.images.push(...e.images);
    } else if (e.kind === 'status') it.status = e.text;
    else if (e.kind === 'done' || e.kind === 'error') {
      it.done = true;
      if (e.kind === 'error') it.text += `\n\n**Error:** ${e.text}`;
      // the saved chat has the full answer
      GET<Chat>(`/agents/${it.agentId}/chats/${it.chatId}`)
        .then((c) => {
          const lastUser = c.items.findLastIndex((x) => x.type === 'user');
          const answer = c.items.slice(lastUser + 1).filter((x): x is Extract<ChatItem, { type: 'assistant' }> => x.type === 'assistant').map((x) => x.text).join('\n\n');
          if (answer) it.text = answer;
          draw();
        })
        .catch(() => {});
    }
    draw();
  }
  if (ev.type === 'team') {
    const items = D.items.filter((x): x is BranchItem => x.kind === 'branch' && x.wfId === ev.teamId);
    const it = items[items.length - 1];
    if (!it) return;
    const e = ev.event as TeamEvent;
    if (e.kind === 'message') mergeTeamMessages(it, [e.message]);
    // (every message to this team shows who works on it now, so none looks busy forever)
    if (e.kind === 'state')
      for (const b of items) {
        b.working = e.working;
        b.next = e.queued;
      }
    draw();
    return;
  }
  if (ev.type === 'workflow-run' && ev.run) {
    const run = ev.run as WorkflowRun;
    const it = D.items.find((x): x is BranchItem => x.kind === 'branch' && x.runId === run.id);
    if (!it) return;
    it.steps = run.steps;
    if (run.status !== 'running') {
      it.error = run.error || null;
      GET<WorkflowRun[]>(`/workflow-runs?workflowId=${it.wfId}`)
        .then((runs) => {
          const r = runs.find((x) => x.id === it.runId);
          if (r?.output) it.output = String(r.output).slice(0, 4000);
          draw();
        })
        .catch(() => {});
    }
    draw();
  }
}
