// Home (Overview): what's happening, what needs you, and a quick way to give any agent a task.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GET, POST, attempt, ago, navigate, approvalCard } from '../core.ts';
import { Avatar, DomNode, reactPage, useAppState, useServerEvents } from '../ui/react.tsx';
import type { ActivityEntry, AppState, Chat } from '../../shared/types.ts';
import { appIconUrl } from '../appicons.ts';

/** One entry of GET /api/programs (only the fields this page reads). */
interface ProgramInfo {
  id: string;
  name: string;
  icon: string;
  installed: boolean;
  running: boolean;
  serviceUrl: string | null;
  version: string | null;
}
/** GET /api/library: only the starters are used here. */
interface LibraryStarters {
  starters?: { name: string }[];
}

const SERVICES = ['comfyui', 'lmstudio', 'ollama', 'netdesk', 'orca', 'blender', 'premiere', 'photoshop'];
const KIND_ICON: Record<string, string> = { run: '◉', error: '✕', approval: '!', social: '⟁', workflow: '⇢', program: '▣', mcp: '⌁', library: '▤', terminal: '›', system: '·', notify: '✉' };
/** The newest activity kept on the page. */
const KEEP = 200;

// the quick task keeps its text and choice while you move around the app
const quick = { text: '', agentId: '' };

function HomePage() {
  const d = useAppState();
  const [progs, setProgs] = useState<ProgramInfo[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  useEffect(() => {
    void GET<ProgramInfo[]>('/programs').then(setProgs).catch(() => setProgs([]));
    void GET<ActivityEntry[]>('/activity').then(setActivity).catch(() => {});
  }, []);
  useServerEvents((ev) => ev.type === 'activity' && setActivity((a) => [ev.entry as ActivityEntry, ...a].slice(0, KEEP)));
  if (!d) return null;
  const agents = d.agents || [];
  const needs = d.approvals.length + d.outboxPending + (d.questions?.length || 0);
  const services = (progs || []).filter((p) => p.installed && SERVICES.includes(p.id));
  return (
    <>
      <div className="stats grid grid-cols-4 gap-3 mb-4.5 max-lg:grid-cols-2">
        <Stat label="Agents" num={agents.length} href="#/agents" />
        <Stat label="Working now" num={d.runs.length} kind={d.runs.length ? 'live' : ''} />
        <Stat label="Needs you" num={needs} kind={needs ? 'hot' : ''} onClick={() => document.getElementById('drawer')!.classList.remove('hidden')} />
        <Stat label="X accounts" num={d.accounts.x.length} href="#/settings?tab=connections" />
      </div>
      {!agents.length ? <Onboarding d={d} /> : null}
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4.5">
          {agents.length ? <QuickTask d={d} /> : null}
          {d.approvals.length ? (
            <div className="panel">
              <div className="panel-head">
                <h2>Needs you</h2>
              </div>
              <div className="flex flex-col gap-2.5">
                {d.approvals.map((a) => (
                  <DomNode key={a.id} make={() => approvalCard(a)} deps={[JSON.stringify(a)]} />
                ))}
              </div>
            </div>
          ) : null}
          {d.runs.length ? (
            <div className="panel">
              <div className="panel-head">
                <h2>Working now</h2>
              </div>
              <div className="list">
                {d.runs.map((r) => {
                  const a = agents.find((x) => x.id === r.agentId);
                  return (
                    <div key={r.id} className="list-row">
                      {a ? <Avatar agent={a} /> : null}
                      <div className="flex-1 min-w-0">
                        <div className="title">{r.agentName}</div>
                        <div className="hint">{`started ${ago(r.startedAt)}`}</div>
                      </div>
                      <a className="btn ghost small" href={`#/agents/${r.agentId}/${r.chatId}`}>Watch</a>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {agents.length ? (
            <div className="panel">
              <div className="panel-head">
                <h2>Your agents</h2>
                <div className="actions">
                  <a className="btn ghost small" href="#/agents">All agents</a>
                </div>
              </div>
              <div className="cards grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                {agents.slice(0, 8).map((a) => (
                  <a key={a.id} className="card clickable" href={`#/agents/${a.id}`}>
                    <div className="card-top">
                      <Avatar agent={a} />
                      <div className="flex-1 min-w-0">
                        <div className="card-title">{a.name}</div>
                        <div className="card-sub line-clamp-2">{a.specialty || ''}</div>
                      </div>
                    </div>
                    {d.runs.some((r) => r.agentId === a.id) ? (
                      <span className="corner" aria-label="working">
                        <span className="dot busy" />
                      </span>
                    ) : null}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-4.5">
          <div className="panel">
            <div className="panel-head">
              <h2>Programs</h2>
              <div className="actions">
                <a className="btn ghost small" href="#/settings?tab=programs">All programs</a>
              </div>
            </div>
            {services.length ? (
              <div className="list">
                {services.map((p) => (
                  <div key={p.id} className="list-row">
                    <span className="w-5.5 text-center">{appIconUrl(p.id) ? <img className="inline-block align-middle" src={appIconUrl(p.id)!} width={20} height={20} alt="" /> : p.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="title">{p.name}</div>
                      <div className="hint">{p.running ? (p.serviceUrl ? `running · ${p.serviceUrl}` : 'running') : p.version ? `v${p.version}` : 'installed'}</div>
                    </div>
                    <span className={`dot${p.running ? ' on' : ''}`} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">{progs ? 'None of the usual programs found.' : 'Scanning…'}</p>
            )}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Activity</h2>
            </div>
            <div className="list">
              {activity.length ? (
                activity.slice(0, 40).map((a, i) => (
                  <div key={`${a.ts}:${i}`} className="list-row">
                    <span className={a.kind === 'error' ? 'font-mono w-4 text-center text-red' : 'font-mono w-4 text-center text-faint'}>{KIND_ICON[a.kind] || '·'}</span>
                    <div className="home-activity flex-1 min-w-0 text-[13.5px]">{a.text}</div>
                    <span className="font-mono text-faint whitespace-nowrap text-[11px]">{ago(a.ts)}</span>
                  </div>
                ))
              ) : (
                <p className="empty">Nothing yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const NUM = "num font-sans text-[28px] leading-none font-bold [font-feature-settings:'tnum'] mt-2";

/** A number at the top. With href or onClick it is a link or a button to where that number lives. */
function Stat({ label, num, kind = '', href, onClick }: { label: string; num: number; kind?: string; href?: string; onClick?: () => void }) {
  // stat and num stay for the tests
  const cls = href || onClick ? 'stat bg-panel border border-line rounded-box py-3.5 px-4 block w-full cursor-pointer text-inherit text-left [font:inherit] hover:border-accent-dim' : 'stat bg-panel border border-line rounded-box py-3.5 px-4';
  const numCls = kind === 'hot' ? `${NUM} text-amber` : kind === 'live' ? `${NUM} text-accent` : NUM;
  const body: ReactNode = (
    <>
      <div className="label">{label}</div>
      <div className={numCls}>{num}</div>
    </>
  );
  // (a link's text takes the page's link hover color, as links do everywhere)
  if (href) return <a className={`${cls} hover:text-accent-hover`} href={href}>{body}</a>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

function QuickTask({ d }: { d: AppState }) {
  const agents = d.agents;
  const [text, setText] = useState(quick.text);
  const [agentId, setAgentId] = useState(() => (agents.some((a) => a.id === quick.agentId) ? quick.agentId : agents[0].id));
  const box = useRef<HTMLTextAreaElement>(null);
  const send = () =>
    attempt(async () => {
      const t = text.trim();
      if (!t || !agentId) return;
      const chat = await POST<Chat>(`/agents/${agentId}/chats`);
      await POST(`/agents/${agentId}/chats/${chat.id}/messages`, { text: t });
      quick.text = '';
      navigate(`#/agents/${agentId}/${chat.id}`);
    });
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Give an agent a task</h2>
      </div>
      <div className="max-w-75">
        <select aria-label="Agent" value={agentId} onChange={(e) => setAgentId((quick.agentId = e.target.value))}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{`${a.emoji || ''} ${a.name}`}</option>
          ))}
        </select>
      </div>
      <div className="mt-3.5">
        <textarea
          ref={box}
          rows={3}
          aria-label="Task"
          value={text}
          placeholder="Tell an agent what to do…  (Ctrl+Enter to send)"
          onChange={(e) => setText((quick.text = e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void send()}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2.5 mt-3.5">
        <span className="hint">Opens a new chat with that agent.</span>
        <button className="btn" onClick={() => void send()}>Send</button>
      </div>
    </div>
  );
}

function Onboarding({ d }: { d: AppState }) {
  const [adding, setAdding] = useState(false);
  // One click: Coordinator, X Writer, Image Maker, 3D Artist, Video Editor, Researcher.
  const addStarterTeam = async () => {
    setAdding(true);
    const lib = await GET<LibraryStarters>('/library').catch(() => null);
    for (const s of lib?.starters || []) await attempt(() => POST('/library/hire', { source: 'starter', name: s.name }));
    navigate('#/agents');
  };
  const steps = [
    { done: d.engines['claude-code'].installed || d.secrets.openrouterKey.set, text: 'Pick how agents think: Claude Code is found on this PC; add an OpenRouter key for any other model.', href: '#/settings', cta: 'Settings' },
    { done: false, text: 'Add agents: start with ready-made ones, or hire specialists from the library of 270+.', href: '#/library', cta: 'Open library' },
    { done: d.accounts.x.length > 0, text: 'Connect your X account so agents can draft posts for you to approve.', href: '#/settings?tab=connections', cta: 'Connections' },
    { done: false, text: 'Give agents more abilities: browser control, files, GitHub and any MCP server.', href: '#/settings?tab=mcp', cta: 'Tools & MCP' },
  ];
  return (
    <div className="panel mb-4 border-accent-dim">
      <div className="panel-head">
        <h2>Get started</h2>
      </div>
      <ol className="list home-steps">
        {steps.map((s, i) => (
          <li key={s.cta} className="list-row">
            <span className={s.done ? 'font-mono text-accent' : 'font-mono text-faint'} aria-label={s.done ? 'done' : `step ${i + 1}`}>{s.done ? '✓' : `0${i + 1}`}</span>
            <div className="flex-1 min-w-0">{s.text}</div>
            {i === 1 ? <button className="btn small" disabled={adding} onClick={() => void addStarterTeam()}>Add Blacksite team</button> : null}
            <a className="btn ghost small" href={s.href}>{s.cta}</a>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const title = () => 'Home';
export const { render, unmount } = reactPage(() => <HomePage />);
