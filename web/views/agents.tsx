// Agents: your team, and the editor for one agent.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GET, POST, PUT, DEL, attempt, refreshSoon, navigate, toast, confirmBox, promptBox, isRunning, ENGINE_LABEL } from '../core.ts';
import { skillPicker } from '../skillpick.ts';
import { historyButton, deletedButton } from '../history.ts';
import { memoryEditor } from '../memory.ts';
import { ChipSet, Field, Segmented, Switch } from '../ui/controls.tsx';
import { Avatar, DomNode, ProjectScoped, reactPage, useAppState } from '../ui/react.tsx';
import type { ModelListing } from '../models.ts';
import { EFFORT_NAMES, effortFor, effortLevels } from '../../shared/effort.ts';
import { copiesWarning, mcpOptions } from '../mcpcopies.ts';
import { ENGINE_NAMES, agentCategory, agentModel, categorySlices, engineKey, inSlice, modelSlices } from '../agentstats.ts';
import type { Slice } from '../agentstats.ts';
import type { Agent, AppState, Autonomy, EngineStatus, McpServerInfo, Team, Terminal } from '../../shared/types.ts';

/** GET /api/agents/:id: the agent plus its knowledge files and resolved workspace. */
export interface AgentDetail extends Agent {
  knowledgeFiles: { label: string; size: number; own: boolean }[];
  workspacePath: string;
  tools: string[];
}
/** One entry of GET /api/openclaw/agents. */
interface OpenClawAgent {
  id: string;
  model: string;
  isDefault: boolean;
}
/** One entry of GET /api/hermes/profiles. */
interface HermesProfile {
  name: string;
  model: string;
  gateway: string;
  isDefault: boolean;
}
/** The part of GET /api/mcp used here. */
interface McpListing {
  servers: Record<string, unknown>;
  info?: Record<string, McpServerInfo>;
}

export async function openTerminal(agent: Pick<Agent, 'id'>): Promise<void> {
  const t = await attempt(() => POST<Terminal>('/terminals', { kind: 'agent', agentId: agent.id }));
  if (t) navigate(`#/terminals/${t.id}`);
}

/** "Claude Code", "API model · openrouter", "Hermes · writer"… */
export function engineLabel(a: Pick<Agent, 'engine'> & Partial<Pick<Agent, 'provider' | 'hermesProfile' | 'openclawAgent'>>): string {
  const label = ENGINE_LABEL[a.engine] || a.engine;
  const extra = a.engine === 'openai' ? ` · ${a.provider}` : a.engine === 'hermes' && a.hermesProfile ? ` · ${a.hermesProfile}` : a.engine === 'openclaw' && a.openclawAgent ? ` · ${a.openclawAgent}` : '';
  return `${label}${extra}`;
}

// ---------- the overview ----------
/** A category or model picked in the overview, or an engine tile clicked on the Station: the list shows only its agents. */
interface ChartPick {
  kind: 'category' | 'model' | 'engine';
  slice: Slice;
}
const MICRO = 'font-mono text-[10.5px] leading-none tracking-[0.14em] uppercase text-faint';

/** What kinds of agents the project has (one bar, a segment per category) and which models they run on. */
function AgentsOverview({ agents, d, pick, setPick }: { agents: Agent[]; d: AppState; pick: ChartPick | null; setPick: (p: ChartPick | null) => void }) {
  const [hot, setHot] = useState<string | null>(null);
  const total = agents.length;
  const cats = categorySlices(agents);
  const models = modelSlices(agents, d.settings.defaults);
  // the model bars are measured against the biggest one
  const topModel = Math.max(1, ...models.map((m) => m.count));
  const kinds = new Set(agents.map((a) => agentCategory(a).id)).size;
  const working = agents.filter((a) => isRunning(a.id)).length;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  const toggle = (kind: ChartPick['kind'], slice: Slice) => setPick(pick?.kind === kind && pick.slice.id === slice.id ? null : { kind, slice });
  const picked = (kind: ChartPick['kind'], s: Slice) => pick?.kind === kind && pick.slice.id === s.id;
  // a segment is dimmed while another one is pointed at or picked
  const catFocus = hot || (pick?.kind === 'category' ? pick.slice.id : null);
  const shown = cats.find((s) => s.id === hot);
  const before = shown ? cats.slice(0, cats.indexOf(shown)).reduce((n, s) => n + s.count, 0) : 0;
  return (
    <section className="agents-overview panel mb-4" aria-label="Your agents at a glance">
      <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-x-10 gap-y-7 max-lg:grid-cols-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="flex items-baseline gap-2.5">
              <b className="agents-total font-mono text-[34px] leading-none font-semibold tracking-[-0.02em] text-ink">{total}</b>
              <span className={MICRO}>agents</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[11px] leading-none tracking-[0.08em] uppercase text-dim">
              <span>
                <b className={working ? 'text-accent' : 'text-ink'}>{working}</b> working now
              </span>
              <span>
                <b className="text-ink">{kinds}</b> {kinds === 1 ? 'category' : 'categories'}
              </span>
              <span>
                <b className="text-ink">{new Set(agents.map((a) => agentModel(a, d.settings.defaults).id)).size}</b> models
              </span>
            </div>
          </div>
          <div className={`${MICRO} mt-6 mb-2.5`}>By category</div>
          <div className="relative">
            <div className="agents-cat-bar flex h-4 gap-0.5" onMouseLeave={() => setHot(null)}>
              {cats.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`h-full min-w-1 cursor-pointer transition-[opacity,filter] duration-150 first:rounded-l-[4px] last:rounded-r-[4px] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${catFocus && catFocus !== s.id ? 'opacity-30' : ''}`}
                  style={{ flexGrow: s.count, flexBasis: 0, background: s.color }}
                  aria-label={`${s.label}: ${s.count} of ${total} agents`}
                  aria-pressed={picked('category', s)}
                  onMouseEnter={() => setHot(s.id)}
                  onFocus={() => setHot(s.id)}
                  onBlur={() => setHot(null)}
                  onClick={() => toggle('category', s)}
                />
              ))}
            </div>
            {shown ? (
              <div className="pointer-events-none absolute bottom-full z-10 mb-2.5 -translate-x-1/2 rounded-ctl border border-line-2 bg-panel-2 px-2.5 py-1.75 text-[12.5px] leading-[1.4] whitespace-nowrap shadow-pop" style={{ left: `${((before + shown.count / 2) / total) * 100}%` }} role="tooltip">
                <b className="text-ink">{shown.label}</b>
                <span className="font-mono text-dim">{`  ${shown.count} · ${pct(shown.count)}`}</span>
                {shown.rest ? <div className="max-w-70 whitespace-normal text-dim">{shown.rest.map((r) => `${r.label} ${r.count}`).join(', ')}</div> : null}
              </div>
            ) : null}
          </div>
          <ul className="agents-cat-legend mt-4 flex flex-wrap gap-x-5 gap-y-2.5">
            {cats.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-ctl text-[13px] leading-none text-ink transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent ${catFocus && catFocus !== s.id ? 'opacity-45' : ''} ${picked('category', s) ? 'underline decoration-accent decoration-2 underline-offset-5' : ''}`}
                  aria-pressed={picked('category', s)}
                  onMouseEnter={() => setHot(s.id)}
                  onMouseLeave={() => setHot(null)}
                  onClick={() => toggle('category', s)}
                >
                  <span className="size-2.5 flex-none rounded-[3px]" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                  <span className="font-mono text-[11.5px] text-dim">{s.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <div className={`${MICRO} mb-2.5`}>By model</div>
          <ul className="agents-models flex flex-col gap-0.5">
            {models.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`group grid w-full cursor-pointer grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_1.75rem] items-center gap-3 rounded-ctl px-1.5 py-1.5 text-left transition-[background,opacity] duration-150 hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-accent ${pick?.kind === 'model' && !picked('model', m) ? 'opacity-45' : ''} ${picked('model', m) ? 'bg-panel-2' : ''}`}
                  title={m.rest ? m.rest.map((r) => `${r.label} (${r.sub}) ${r.count}`).join('\n') : `${m.label} · ${m.sub}`}
                  aria-label={`${m.label}${m.sub ? ` on ${m.sub}` : ''}: ${m.count} of ${total} agents`}
                  aria-pressed={picked('model', m)}
                  onClick={() => toggle('model', m)}
                >
                  <span className="min-w-0 truncate text-[13px] leading-[1.3]">
                    <span className="text-ink">{m.label}</span>
                    <span className="ml-1.5 text-[11px] text-faint">{m.rest ? `${m.rest.length} more` : m.sub}</span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-[4px] bg-line" aria-hidden="true">
                    <span className="block h-full rounded-[4px] bg-accent-dim transition-colors duration-150 group-hover:bg-accent" style={{ width: `${(m.count / topModel) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono text-[12px] text-dim">{m.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---------- the list ----------
// kept while you move around the app, as before
let lastFilter = '';
let lastPick: ChartPick | null = null;
/** #/agents?uses=claude-code (from an engine tile on the Station): that engine's agents. */
function engineFromLink(): ChartPick | null {
  const key = new URLSearchParams(location.hash.split('?')[1] || '').get('uses');
  return key && ENGINE_NAMES[key] ? { kind: 'engine', slice: { id: key, label: ENGINE_NAMES[key], count: 0 } } : null;
}

function AgentsList() {
  const d = useAppState();
  const [filter, setFilter] = useState(lastFilter);
  const [pick, setPickState] = useState(() => (lastPick = engineFromLink() || lastPick));
  const setPick = (p: ChartPick | null) => {
    setPickState((lastPick = p));
    // (the link's ?uses= goes with it, so a reload shows what you picked)
    if (location.hash.includes('?')) history.replaceState(null, '', '#/agents');
  };
  if (!d) return null;
  const q = filter.toLowerCase();
  const inPick = (a: Agent) => !pick || inSlice(pick.slice, pick.kind === 'category' ? agentCategory(a).id : pick.kind === 'engine' ? engineKey(a) : agentModel(a, d.settings.defaults).id);
  const shown = d.agents.filter((a) => (!q || `${a.name} ${a.specialty} ${a.description}`.toLowerCase().includes(q)) && inPick(a));
  const create = async () => {
    const a = await attempt(() => POST<Agent>('/agents', { name: 'New agent' }));
    if (a) navigate(`#/agents/${a.id}/edit`);
  };
  return (
    <>
      {d.agents.length > 1 ? <AgentsOverview agents={d.agents} d={d} pick={pick} setPick={setPick} /> : null}
      <div className="flex flex-wrap items-center gap-2.5 justify-between mb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-[min(360px,100%)]">
            <input placeholder="Search agents" aria-label="Search agents" value={filter} onChange={(e) => setFilter((lastFilter = e.target.value))} />
          </div>
          {pick ? (
            <button type="button" className="agents-pick btn ghost small" onClick={() => setPick(null)} title="Show every agent">
              {pick.kind === 'model' ? `Model: ${pick.slice.label}` : pick.kind === 'engine' ? `On ${pick.slice.label}` : pick.slice.label}
              <span aria-hidden="true">✕</span>
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <DomNode as="span" make={() => deletedButton(['agent', 'team'], () => refreshSoon(0))} deps={[]} />
          <a className="btn ghost" href="#/library">Hire from Agent library</a>
          <button className="btn" onClick={() => void create()}>+ New agent</button>
        </div>
      </div>
      <div className="cards">
        {shown.map((a) => (
          <div key={a.id} className="card">
            <div className="card-top">
              <Avatar agent={a} lg />
              <div className="flex-1 min-w-0">
                <div className="card-title">{a.name}</div>
                <div className="card-sub">{a.specialty || a.description || 'No specialty yet'}</div>
              </div>
            </div>
            {isRunning(a.id) ? (
              <span className="corner pill warn">
                <span className="dot busy" />
                working
              </span>
            ) : a.pinned ? (
              <span className="corner text-faint" aria-label="pinned">★</span>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="pill">{engineLabel(a)}</span>
              <span className="pill">{a.autonomy === 'full' ? 'full autonomy' : a.autonomy === 'ask' ? 'asks first' : 'auto'}</span>
            </div>
            <div className="card-foot">
              <a className="btn small" href={`#/agents/${a.id}`}>Chat</a>
              <a className="btn ghost small" href={`#/agents/${a.id}/edit`}>Edit</a>
              {a.engine !== 'openai' ? <button className="btn ghost small" onClick={() => void openTerminal(a)}>Terminal</button> : null}
            </div>
          </div>
        ))}
        {!shown.length ? <div className="empty box">{d.agents.length ? 'No agent matches.' : 'No agents yet. Create one, or hire from the Agent library.'}</div> : null}
      </div>
    </>
  );
}

// ---------- the editor ----------
const AUTONOMY: { value: Autonomy; label: string; title: string }[] = [
  { value: 'ask', label: 'Ask first', title: 'You approve every action that changes something' },
  { value: 'auto', label: 'Auto', title: 'Runs on its own; asks only for risky things (running code, shell, messages)' },
  { value: 'full', label: 'Full', title: 'Never asks. Only for agents you trust completely' },
];

interface EditorData {
  agent: AgentDetail;
  servers: string[];
  /** each server's label, service and "use for" */
  info?: Record<string, McpServerInfo>;
  teams: Team[];
}

function AgentEditor({ id }: { id: string }) {
  const d = useAppState();
  const [data, setData] = useState<EditorData | null>(null);
  // a new number draws the editor again from the server (after History put back an earlier version)
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    // (Hermes profiles and OpenClaw agents ask their CLIs, which can be slow: they load with their engine's fields)
    void Promise.all([GET<AgentDetail>(`/agents/${id}`), GET<McpListing>('/mcp').catch(() => ({ servers: {} })), GET<Team[]>('/workflows').catch((): Team[] => [])]).then(
      ([agent, mcp, teams]) => live && setData({ agent, servers: Object.keys(mcp.servers), info: (mcp as McpListing).info, teams }),
    );
    return () => void (live = false);
  }, [id, version]);
  if (!data || !d) return null;
  return <EditorForm key={version} data={data} d={d} reload={() => setVersion((v) => v + 1)} />;
}

function EditorForm({ data, d, reload }: { data: EditorData; d: AppState; reload: () => void }) {
  const { agent, servers, info, teams } = data;
  const id = agent.id;
  const [a, setA] = useState<Agent>(() => structuredClone(agent));
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => {
    setA((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  // (saved by its own Save button: the agent may write to it while you edit the rest)
  const memory = useRef<ReturnType<typeof memoryEditor> | null>(null);
  useEffect(() => {
    window.onbeforeunload = () => (dirty || memory.current?.dirty() ? true : undefined);
    return () => void (window.onbeforeunload = null);
  }, [dirty]);

  const save = async (thenChat = false) => {
    if (await attempt(() => PUT(`/agents/${id}`, a), 'Saved')) {
      setDirty(false);
      if (thenChat) navigate(`#/agents/${id}`);
    }
  };
  // A new engine or provider may not have the effort level: keep the nearest one it has, the one the Effort field shows.
  const fit = (x: Agent): Agent => (x.effort ? { ...x, effort: effortFor(x.engine, x.effort, x.provider) } : x);
  const pickEngine = (engine: Agent['engine']) => {
    setA((x) => fit({ ...x, engine, model: engine === 'claude-code' ? d.settings.defaults.claudeModel : engine === 'openai' ? d.settings.defaults.openrouterModel : '' }));
    setDirty(true);
  };
  const del = async () => {
    if (!(await confirmBox(`Delete ${a.name}? Its chats stay in the data folder.`, { ok: 'Delete', danger: true }))) return;
    if (await attempt(() => DEL(`/agents/${id}`), 'Deleted')) navigate('#/agents');
  };
  const clone = async () => {
    const c = await attempt(() => POST<Agent>(`/agents/${id}/duplicate`), 'Duplicated');
    if (c) navigate(`#/agents/${c.id}/edit`);
  };
  const pin = () =>
    void PUT(`/agents/${id}`, { pinned: !a.pinned }).then(() => {
      setA((x) => ({ ...x, pinned: !x.pinned }));
      toast(a.pinned ? 'Unpinned' : 'Pinned');
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 justify-between mb-4">
        <a className="btn ghost small" href="#/agents">← Agents</a>
        <div className="flex flex-wrap items-center gap-2.5">
          <button className="btn ghost" onClick={() => (dirty ? void save(true) : navigate(`#/agents/${id}`))}>Chat</button>
          <button className="btn" disabled={!dirty} onClick={() => void save()}>Save</button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4.5">
          <div className="panel">
            <div className="panel-head">
              <h2>Who it is</h2>
            </div>
            <div className="flex items-end gap-2.5 [&>label.field]:flex-none">
              <Field label="Icon">
                <input className="w-16 text-center text-[20px]" value={a.emoji} onChange={(e) => set('emoji', e.target.value)} />
              </Field>
              <Field label="Color">
                <input className="w-11 h-9.5 p-0.5 bg-panel border border-line-2" type="color" value={a.color || '#c4ff3d'} onChange={(e) => set('color', e.target.value)} />
              </Field>
              <div className="flex-1 min-w-0">
                <Field label="Name">
                  <input value={a.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="mt-3.5">
              <Field label="Specialty" hint="One line. Other agents see it when deciding who to ask.">
                <input value={a.specialty} placeholder="e.g. writes punchy X threads about AI" onChange={(e) => set('specialty', e.target.value)} />
              </Field>
            </div>
            <div className="mt-3.5">
              <Field label="Instructions">
                <textarea className="code" rows={16} value={a.systemPrompt} placeholder="How this agent thinks, works and talks. Its process, rules, what good output looks like." onChange={(e) => set('systemPrompt', e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Knowledge</h2>
            </div>
            {/* (the agent is saved whole: it takes the knowledge as it is now, so Save doesn't undo a link made here) */}
            <Knowledge id={id} synced={(knowledge) => setA((x) => ({ ...x, knowledge }))} />
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>MEMORY.md</h2>
              <span className="hint">saved on its own</span>
            </div>
            <DomNode make={() => (memory.current = memoryEditor(id, { rows: 10 })).el} deps={[id]} />
          </div>
        </div>

        <div className="flex flex-col gap-4.5">
          <div className="panel">
            <div className="panel-head">
              <h2>Brain</h2>
            </div>
            <Segmented label="Brain" options={d.engineList.map((e) => ({ value: e.id, label: e.label, title: e.description }))} value={a.engine} onChange={pickEngine} />
            <p className="hint mt-3.5">{d.engineList.find((e) => e.id === a.engine)?.description || ''}</p>
            <div className="mt-3.5">
              <EngineFields a={a} d={d} set={set} fit={(x) => (setA(fit(x)), setDirty(true))} />
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Autonomy</h2>
            </div>
            <Segmented label="Autonomy" options={AUTONOMY} value={a.autonomy || 'auto'} onChange={(v) => set('autonomy', v)} />
            <p className="hint mt-3.5">Ask first: you approve anything that changes something. Auto: asks only for risky actions (running code or scripts in Blender, Photoshop, After Effects, ffmpeg, shell, sending messages); click Always allow to stop being asked for a tool. Full: never asks. X posts always wait in the Outbox unless you turn on auto-post for that account.</p>
            {a.alwaysAllow?.length ? (
              <div className="mt-3.5">
                <div className="label">Always allowed</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-3.5">
                  {a.alwaysAllow.map((t) => (
                    <span key={t} className="pill">{t}</span>
                  ))}
                </div>
                <button className="btn tiny ghost mt-3.5" onClick={() => (set('alwaysAllow', []), toast('Cleared; save to apply'))}>Clear</button>
              </div>
            ) : null}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Answers</h2>
            </div>
            <Switch checked={!!a.richAnswers} onChange={(v) => set('richAnswers', v)}>Rich answers</Switch>
            <p className="hint mt-3.5">In your own chats with this agent it answers with live components (cards, tables, charts, forms with buttons) instead of plain text. Good for research, comparisons, reports and plans. Off for coding agents and team chats: it adds about 13k tokens of instructions to every message, and smaller or local models often get it wrong. Team chats, routines and other agents always get plain text.</p>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Tools</h2>
            </div>
            <ChipSet label="Tools" options={d.toolGroups.map((g) => ({ value: g.id, label: g.label, title: g.description }))} value={a.toolGroups} onChange={(v) => set('toolGroups', v)} />
            <p className="hint mt-3.5">Hover a tool for what it does. Claude Code and Hermes agents also keep their own built-in tools.</p>
            <div className="label mt-7">MCP servers</div>
            {servers.length ? (
              <div className="mt-3.5">
                <ChipSet label="MCP servers" options={mcpOptions(servers, info)} value={a.mcpServers} onChange={(v) => set('mcpServers', v)} />
                {copiesWarning(a.mcpServers, info) ? <p className="hint mcp-copies-warning mt-2 text-amber">{copiesWarning(a.mcpServers, info)}</p> : null}
              </div>
            ) : (
              <p className="hint mt-3.5">
                No MCP servers yet. <a href="#/settings?tab=mcp">Add one</a> (browser control, GitHub, Blender live…).
              </p>
            )}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Skills</h2>
            </div>
            <DomNode
              make={() =>
                skillPicker(a.skills || [], (skills) => set('skills', skills), {
                  inherited: [
                    ...(d.project?.skills || []).map((slug) => ({ slug, from: 'project' })),
                    ...teams.filter((w) => (w.members || []).includes(id)).flatMap((w) => (w.skills || []).map((slug) => ({ slug, from: w.name }))),
                  ],
                  empty: 'No skills of its own yet.',
                })
              }
              deps={[id]}
            />
            <p className="hint mt-3.5">Skills given to this agent. It also gets the project's skills and, while working for a team, that team's skills (both greyed). Save to apply. Manage the library under Skills.</p>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Workspace</h2>
            </div>
            <Field label="Working folder" hint="Where it saves files and runs commands. Empty = its own folder in the dashboard data.">
              <input value={a.workspace || ''} placeholder={agent.workspacePath} onChange={(e) => set('workspace', e.target.value.trim())} />
            </Field>
            <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
              <button className="btn ghost small" onClick={() => void attempt(() => POST(`/agents/${id}/open-workspace`))}>Open folder</button>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>More</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button className="btn ghost small" onClick={pin}>{a.pinned ? 'Unpin' : 'Pin to top'}</button>
              <button className="btn ghost small" onClick={() => void clone()}>Clone</button>
              {/* put back: show it as it is now (changes not saved yet are dropped) */}
              <DomNode as="span" make={() => historyButton('agent', id, () => (setDirty(false), reload()))} deps={[id]} />
              <button className="btn ghost small" title="Keep it as a template you can create again in any project (Agent library > Your presets)" onClick={() => void attempt(() => POST(`/presets/agent/${id}`), `Saved ${a.name} as a preset`)}>Save as preset</button>
              <button className="btn ghost small" title="Write it to ~/.claude/agents so any Claude Code session can use it" onClick={() => void attempt(() => POST<{ file: string }>(`/agents/${id}/export-claude`), (r) => `Saved as ${r.file}`)}>Install in Claude Code</button>
              <button className="btn danger small" onClick={() => void del()}>Delete</button>
            </div>
            <p className="hint mt-3.5">{`Id: ${a.id}${a.source?.type && a.source.type !== 'custom' ? ` · from ${a.source.type}${a.source.slug ? ` (${a.source.slug})` : ''}` : ''}`}</p>
          </div>
        </div>
      </div>
    </>
  );
}

/** The fields that depend on the engine: model, sign-in, provider, profile, and how hard it thinks. */
function EngineFields({ a, d, set, fit }: {
  a: Agent;
  d: AppState;
  set: <K extends keyof Agent>(k: K, v: Agent[K]) => void;
  fit: (x: Agent) => void;
}) {
  const [models, setModels] = useState<ModelListing[]>([]);
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [clawAgents, setClawAgents] = useState<OpenClawAgent[]>([]);
  const needs = a.engine === 'hermes' ? 'hermes' : a.engine === 'openclaw' ? 'openclaw' : null;
  useEffect(() => {
    let live = true;
    if (needs === 'hermes') void GET<HermesProfile[]>('/hermes/profiles').then((p) => live && setProfiles(p)).catch(() => {});
    if (needs === 'openclaw') void GET<OpenClawAgent[]>('/openclaw/agents').then((c) => live && setClawAgents(c)).catch(() => {});
    return () => void (live = false);
  }, [needs]);
  useEffect(() => {
    let live = true;
    const q = a.engine === 'openai' ? `engine=openai&provider=${a.provider}` : `engine=${a.engine}`;
    void GET<ModelListing[]>(`/models?${q}`)
      .catch((): ModelListing[] => [])
      .then((m) => live && setModels(m.slice(0, 600)));
    return () => void (live = false);
  }, [a.engine, a.provider]);
  const placeholder =
    a.engine === 'claude-code' ? 'sonnet' : a.engine === 'hermes' ? "profile's default" : a.engine === 'openclaw' ? "the OpenClaw agent's model" : a.engine === 'pi' || a.engine === 'omp' ? 'its default (e.g. anthropic/claude-sonnet-5-5)' : 'anthropic/claude-sonnet-5.5';
  const model = (label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <input value={a.model || ''} list="models" placeholder={placeholder} onChange={(e) => set('model', e.target.value.trim())} />
    </Field>
  );
  const pick = (label: string, value: string, options: { value: string; label: string }[], onChange: (v: string) => void, hint?: ReactNode) => (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
  let parts: ReactNode = null;
  if (a.engine === 'claude-code')
    parts = (
      <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
        {model('Model', 'sonnet, opus, haiku, fable, or a full model id.')}
        {pick(
          'Sign in with',
          a.claudeAuth || 'login',
          [
            { value: 'login', label: 'My Claude login (subscription)' },
            { value: 'anthropic', label: `Anthropic API key${d.secrets.anthropicKey.set ? '' : ' (not set)'}` },
            { value: 'openrouter', label: `OpenRouter key${d.secrets.openrouterKey.set ? '' : ' (not set)'}` },
          ],
          (v) => set('claudeAuth', v as Agent['claudeAuth']),
          'With OpenRouter, use OpenRouter model ids like anthropic/claude-sonnet-5.5.',
        )}
      </div>
    );
  else if (a.engine === 'openai')
    parts = (
      <>
        <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
          {pick(
            'Provider',
            a.provider || 'openrouter',
            [
              { value: 'openrouter', label: `OpenRouter${d.secrets.openrouterKey.set ? '' : ' (add key in Settings)'}` },
              { value: 'lmstudio', label: 'LM Studio (local)' },
              { value: 'ollama', label: 'Ollama (local)' },
              { value: 'custom', label: 'Custom OpenAI-compatible' },
            ],
            // a server on this PC takes fewer effort levels
            (v) => fit({ ...a, provider: v as Agent['provider'] }),
          )}
          {model('Model', 'Start typing to search. Pick one that supports tools.')}
        </div>
        <Field label="Temperature">
          <input type="number" step="0.1" min="0" max="2" value={a.temperature ?? ''} placeholder="model default" onChange={(e) => set('temperature', (e.target.value === '' ? '' : Number(e.target.value)) as Agent['temperature'])} />
        </Field>
      </>
    );
  else if (a.engine === 'codex') {
    const cx: Partial<EngineStatus['codex']> = d.engines.codex || {};
    parts = (
      <>
        <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
          {model('Model', "Empty = Codex's default. Pick one of the models Codex lists, or type an id.")}
          <div>
            <div className="label">Codex</div>
            <p className="hint">{cx.installed ? (cx.loggedIn ? `Signed in · ${cx.version || ''}` : 'Installed, not signed in yet: Settings > General > Sign in') : 'Not installed yet: Settings > General > Install Codex'}</p>
          </div>
        </div>
        <p className="hint">Codex runs in the workspace folder. Autonomy maps to its sandbox: Ask first = read-only, Auto = can edit the workspace, Full = no sandbox.</p>
      </>
    );
  } else if (a.engine === 'hermes')
    parts = (
      <>
        <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
          {pick('Hermes profile', a.hermesProfile || '', [{ value: '', label: 'default' }, ...profiles.filter((p) => p.name !== 'default').map((p) => ({ value: p.name, label: `${p.name} (${p.model})` }))], (v) => set('hermesProfile', v), 'The profile brings its own memory, skills and tools.')}
          {model('Model override', "Leave empty to use the profile's model.")}
        </div>
        <p className="hint">Hermes uses its own tools. To give it the dashboard tools too, use "Give Hermes the dashboard tools" on the Tools &amp; MCP page.</p>
      </>
    );
  else if (a.engine === 'pi' || a.engine === 'omp') {
    const name = a.engine === 'pi' ? 'pi' : 'oh-my-pi';
    const st: Partial<EngineStatus['pi']> = d.engines[a.engine] || {};
    parts = (
      <>
        <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
          {model('Model', `Empty = ${name}'s default. Ids are provider/model, e.g. anthropic/claude-sonnet-5-5.`)}
          <div>
            <div className="label">{name}</div>
            <p className="hint">{st.installed ? `Found${st.version ? ` · ${st.version}` : ''}` : `Not installed yet: ${a.engine === 'pi' ? 'npm install -g @earendil-works/pi-coding-agent' : 'bun install -g @oh-my-pi/pi-coding-agent'}`}</p>
          </div>
        </div>
        <p className="hint">{`${name} works in the workspace folder with its own tools (read, bash, edit, write…) and runs them without asking, whatever the autonomy below says. Sign it in to a model provider in a terminal (/login). For the dashboard tools too, use "Give pi and oh-my-pi the dashboard tools" on the Tools & MCP page.`}</p>
      </>
    );
  } else if (a.engine === 'openclaw')
    parts = (
      <>
        <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
          {pick('OpenClaw agent', a.openclawAgent || '', [{ value: '', label: 'its default agent' }, ...clawAgents.map((x) => ({ value: x.id, label: `${x.id}${x.model ? ` (${x.model})` : ''}${x.isDefault ? ' · default' : ''}` }))], (v) => set('openclawAgent', v), 'It brings its own memory, skills and tools.')}
          {model('Model override', "Leave empty to use the OpenClaw agent's model.")}
        </div>
        <p className="hint">Each chat here is its own OpenClaw session. It goes through your OpenClaw Gateway when it is running, else OpenClaw answers here on its own. OpenClaw's own approval settings apply to its tools.</p>
      </>
    );
  return (
    <div className="flex flex-col gap-2.5">
      {parts}
      {pick(
        'Effort',
        effortFor(a.engine, a.effort, a.provider),
        [{ value: '', label: "Model's default" }, ...effortLevels(a.engine, a.provider).map((e) => ({ value: e, label: EFFORT_NAMES[e] }))],
        (v) => set('effort', v as Agent['effort']),
        'How hard the model thinks before it answers. More effort: better on hard work, but slower and uses more of your plan.',
      )}
      <datalist id="models">
        {models.map((m) => (
          <option key={m.id} value={m.id}>{`${m.name}${m.price ? ` · $${m.price.in.toFixed(2)}/$${m.price.out.toFixed(2)} per M` : ''}${m.tools === false ? ' · no tools' : ''}`}</option>
        ))}
      </datalist>
    </div>
  );
}

/** What the agent knows: notes and files of its own, linked folders, saved web pages. */
function Knowledge({ id, synced }: { id: string; synced: (knowledge: Agent['knowledge']) => void }) {
  const [info, setInfo] = useState<{ folders: string[]; files: AgentDetail['knowledgeFiles'] } | null>(null);
  const load = useCallback(
    () =>
      GET<AgentDetail>(`/agents/${id}`)
        .then((fresh) => {
          setInfo({ folders: fresh.knowledge?.folders || [], files: fresh.knowledgeFiles });
          synced(fresh.knowledge);
        })
        .catch(() => {}),
    [id],
  );
  useEffect(() => void load(), [load]);
  if (!info) return null;
  const total = info.files.reduce((n, f) => n + f.size, 0);
  const addNote = async () => {
    const name = await promptBox('Note name', { value: 'notes.md' });
    if (!name) return;
    const content = await promptBox(name, { multiline: true, placeholder: 'Facts, style guides, product details, anything this agent should know.' });
    if (content == null) return;
    await attempt(() => POST(`/agents/${id}/knowledge`, { name, content }), 'Added');
    await load();
  };
  const upload = async (files: FileList | null) => {
    for (const f of files || []) {
      if (f.size > 5_000_000) {
        toast(`${f.name} is over 5 MB; link its folder instead.`, 'warn');
        continue;
      }
      await attempt(() => f.text().then((content) => POST(`/agents/${id}/knowledge`, { name: f.name, content })));
    }
    toast('Uploaded');
    await load();
  };
  const addFolder = async () => {
    const folder = await promptBox('Link a folder or file', { label: 'Full path on this PC (the agent reads text files inside it)', placeholder: 'C:\\Users\\you\\Documents\\brand' });
    if (!folder) return;
    await attempt(() => POST(`/agents/${id}/knowledge`, { folder: folder.trim().replace(/^"|"$/g, '') }), 'Linked');
    await load();
  };
  const addUrl = async () => {
    const url = await promptBox('Save a web page as knowledge', { placeholder: 'https://…' });
    if (!url) return;
    await attempt(() => POST(`/agents/${id}/knowledge`, { url: url.trim() }), 'Saved');
    await load();
  };
  return (
    <div className="flex flex-col gap-2.5">
      <p className="hint">
        {total <= 24000 ? 'Small knowledge is given to the agent in full with every message.' : 'Large knowledge: the agent searches it when needed (knowledge_search).'}
        {` ${info.files.length} file${info.files.length === 1 ? '' : 's'} · ${Math.round(total / 1024)} KB`}
      </p>
      {info.folders.map((f) => (
        <div key={f} className="list-row">
          <span aria-hidden="true">📁</span>
          <div className="flex-1 min-w-0 font-mono text-[12.5px] wrap-anywhere">{f}</div>
          <button className="btn tiny ghost" onClick={() => void attempt(() => DEL(`/agents/${id}/knowledge?folder=${encodeURIComponent(f)}`)).then(load)}>Unlink</button>
        </div>
      ))}
      {info.files
        .filter((f) => f.own)
        .map((f) => (
          <div key={f.label} className="list-row">
            <span aria-hidden="true">📄</span>
            <div className="flex-1 min-w-0">
              {f.label}
              <span className="hint">{` · ${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
            </div>
            <button className="btn tiny ghost" onClick={() => void attempt(() => DEL(`/agents/${id}/knowledge?label=${encodeURIComponent(f.label)}`)).then(load)}>Remove</button>
          </div>
        ))}
      <div className="flex flex-wrap items-center gap-2.5">
        <button className="btn ghost small" onClick={() => void addNote()}>+ Write a note</button>
        <label className="btn ghost small">
          + Upload files
          <input type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
        </label>
        <button className="btn ghost small" onClick={() => void addFolder()}>+ Link a folder</button>
        <button className="btn ghost small" onClick={() => void addUrl()}>+ From a web page</button>
      </div>
    </div>
  );
}

export const title = (params: string[] = []): string => (params[1] === 'edit' ? 'Edit agent' : 'Agents');
export const { render, unmount } = reactPage((params) => (params[0] && params[1] === 'edit' ? <ProjectScoped><AgentEditor id={params[0]} /></ProjectScoped> : <AgentsList />));
