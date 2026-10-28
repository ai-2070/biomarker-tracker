// The Station's side panel: what you clicked on the map (the Brain, a team, an agent, the Bench or a
// connection), with what you can do there. React; the map (station.ts) owns the panel's element, slides
// it in and out, and tells it to draw again (update()) when what it shows may have changed.
import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { GET, POST, PUT, DEL, attempt, navigate, approvalCard, ago, toast, promptBox, confirmBox, refreshSoon } from '../core.ts';
import { openTerminal } from './agents.tsx';
import { openBranchBuilder } from '../builder.ts';
import { openDock } from '../dock.tsx';
import { openChat } from '../chatwin.tsx';
import { skillPicker } from '../skillpick.ts';
import { historyButton } from '../history.ts';
import { projectMark, pickLogo, removeLogo, pickModel, removeModel } from '../projectlogo.ts';
import { pickTeamMark, EMOJI_CHOICES, DEFAULT_TEAM_MARK } from '../teammark.ts';
import { icon, logo } from '../icons.ts';
import { modelChip, modelInfo } from '../models.ts';
import { Avatar, DomNode, Icon, useAppState } from '../ui/react.tsx';
import { ChipSet, Segmented, Tabs } from '../ui/controls.tsx';
import { copiesWarning, mcpOptions } from '../mcpcopies.ts';
import { WorldPanel } from './worldpanel.tsx';
import { wfColor, appLogo, mark, intInfo, availableIntegrations, agentLinks, connectorLook } from './stationdata.ts';
import type { AvailableIntegration, Connector, MapPick, Program, TeamView } from './stationdata.ts';
import type { Agent, AppState, Project, Team, TeamAccess, TeamState } from '../../shared/types.ts';

/** What the panel needs from the map. */
export interface StationPanelApi {
  selected(): MapPick | null;
  teams(): TeamView[];
  teamState(id: string): TeamState;
  /** a team's old-style workflow run is going */
  teamBusy(id: string): boolean;
  /** how many of those are going */
  busyTeams(): number;
  programs(): Program[];
  /** the connections a team's desks reach on the map */
  teamLinks(id: string): Set<string>;
  /** what an agent is doing right now, in words ("Blender · rendering the scene") */
  now(agentId: string, wfId?: string): { st: 'needs' | 'idle' | 'working'; text: string };
  /** the connectors on your Claude account */
  connectors(): Connector[];
  choose(p: MapPick | null): void;
  saveTeam(wf: TeamView): Promise<Team | undefined>;
  reloadTeams(): Promise<void>;
  /** turn a team 45° on the map and keep it there */
  spinTeam(id: string): Promise<void>;
  zoomToTeam(id: string): void;
  /** the team builder, for a new team */
  newTeam(): void;
}

/** GET /api/brain: a look inside the Brain folder. */
interface BrainInfo {
  project: Project;
  entries: { name: string; dir: boolean; path: string }[];
  files: number;
  sizeMB: number;
  git: { branch: string; remote: string; url: string; last: string; changes: number } | null;
  /** the description, or the first paragraph of PROJECT.md / README.md */
  summary?: { text: string; from: 'description' | 'PROJECT.md' | 'README.md' | null };
}

/** Draws the panel into el (the map's panel element). update() draws it again. */
export function mountStationPanel(el: HTMLElement, api: StationPanelApi): { update: () => void; unmount: () => void } {
  let version = 0;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
  const root = createRoot(el);
  root.render(
    <StrictMode>
      <Panel api={api} subscribe={subscribe} version={() => version} />
    </StrictMode>,
  );
  return {
    update: () => {
      version++;
      for (const l of listeners) l();
    },
    unmount: () => root.unmount(),
  };
}

function Panel({ api, subscribe, version }: { api: StationPanelApi; subscribe: (l: () => void) => () => void; version: () => number }) {
  useSyncExternalStore(subscribe, version);
  const d = useAppState();
  const p = api.selected();
  if (!p || !d) return null;
  if (p.type === 'agent') return <AgentPanel key={`a:${p.id}`} api={api} d={d} id={p.id} wfId={p.wf} />;
  if (p.type === 'branch') return <TeamPanel key={`t:${p.id}`} api={api} d={d} id={p.id} />;
  if (p.type === 'bench') return <BenchPanel api={api} d={d} />;
  if (p.type === 'brain') return <BrainPanel key={d.project?.id || ''} api={api} d={d} />;
  if (p.type === 'int') return <ConnectionPanel key={`c:${p.id}`} api={api} d={d} id={p.id} />;
  if (p.type === 'world') return <WorldPanel onClose={() => api.choose(null)} teamName={(id) => api.teams().find((t) => t.id === id)?.name} />;
  return null;
}

// (st-panel-title stays as a mark the tests look for)
const TITLE = 'st-panel-title font-sans text-[16px] leading-[1.25] font-bold';
const BODY = 'min-h-0 flex-1 overflow-y-auto px-4 pt-3.5 pb-4.5';
// a row in the connection and team lists (st-conn stays as a mark the tests look for)
const CONN =
  'st-conn flex w-full cursor-pointer items-center gap-2.5 rounded-box border border-line bg-bg px-2 py-1.5 text-left text-[13px] text-ink [transition:transform_0.18s_var(--ease-soft),background-color_0.18s,border-color_0.18s,color_0.18s,box-shadow_0.2s,opacity_0.2s] hover:border-line-2';
const CONNS = 'mt-2 flex flex-col gap-1';
// the Brain's three numbers
const STAT = 'flex flex-col gap-0.75 rounded-box border border-line p-2 font-mono text-[9.5px] leading-[normal] font-medium tracking-[0.1em] text-dim uppercase';
const STAT_N = 'font-sans text-[20px] leading-[normal] font-bold tracking-normal text-ink';
// a round face on the team panel (its border colour is added where it's used)
const FACE =
  'relative grid size-9 cursor-pointer place-items-center rounded-full border bg-bg p-0 [transition:transform_0.15s,border-color_0.15s] hover:[transform:translateY(-2px)] hover:border-accent [&_.avatar]:size-8 [&_.avatar]:rounded-full [&_.avatar]:text-[16px]';
// the @, ★ and ✕ buttons on a member (the lead's ★ stays gold, even on hover)
const MEMBER_ACT = 'size-6.5 cursor-pointer rounded-[6px] border border-line font-mono text-[12px] leading-[normal] font-semibold text-dim hover:border-line-2 hover:text-ink';
const MEMBER_ACT_ON = 'size-6.5 cursor-pointer rounded-[6px] border border-[#ffcc5566] font-mono text-[12px] leading-[normal] font-semibold text-[#ffcc55]';
const LEAD_STAR = 'absolute -top-1.25 -right-1 text-[12px] text-[#ffcc55] [text-shadow:0_0_6px_rgba(255,204,85,0.7)]';

function PanelHead({ api, children }: { api: StationPanelApi; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
      {children}
      <button className="icon-btn" onClick={() => api.choose(null)} aria-label="Close">
        ✕
      </button>
    </div>
  );
}

/** A connection's logo, or its glyph. */
function Mark({ id, size }: { id: string; size: number }) {
  return <DomNode as="span" className="dom-contents" make={() => toNode(mark(id, size))} deps={[id, size]} />;
}
const toNode = (x: Node | string): Node => (typeof x === 'string' ? document.createTextNode(x) : x);
const badgeStyle = (color: string) => ({ '--c': color }) as CSSProperties;

/** The connections in ids, each with whether it is set up and running. */
function ConnectionList({ api, d, ids }: { api: StationPanelApi; d: AppState; ids: Set<string> }) {
  if (!ids.size) return <p className="hint">No outside connections. It works from its instructions and knowledge.</p>;
  const avail = new Map(availableIntegrations(d, api.programs()).map((i) => [i.id, i]));
  return (
    <div className={CONNS}>
      {[...ids].map((id) => {
        const info = intInfo(id);
        if (!info) return null;
        const a = avail.get(id);
        return (
          <button key={id} className={CONN} onClick={() => api.choose({ type: 'int', id })}>
            <span className="st-badge" style={badgeStyle(info.color)}>
              <Mark id={id} size={12} />
            </span>
            <span className="grow min-w-0 flex-1">{info.label}</span>
            <span className={`font-mono text-[9.5px] leading-[normal] font-medium tracking-[0.1em] uppercase ${!a ? 'text-red' : a.live ? 'text-accent' : 'text-amber'}`}>
              {!a ? 'not set up' : a.live ? 'ready' : 'not running'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A list row you can click (an agent or a team). */
function Pick({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <div
      className="list-row cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
    >
      {children}
    </div>
  );
}

function Approvals({ list }: { list: AppState['approvals'] }) {
  return (
    <>
      {list.map((x) => (
        <DomNode key={x.id} className="mt-3.5" make={() => approvalCard(x)} deps={[JSON.stringify(x)]} />
      ))}
    </>
  );
}

/** Runs fn when the field's value is committed (left, or Enter in a one-line field), like the 'change' event. */
function committed<T extends HTMLInputElement | HTMLTextAreaElement>(fn: (el: T) => void) {
  return (el: T | null) => {
    if (!el) return;
    const on = () => fn(el);
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  };
}

// ---------- the Bench ----------
function BenchPanel({ api, d }: { api: StationPanelApi; d: AppState }) {
  const used = new Set(api.teams().flatMap((w) => w.members || []));
  const bench = d.agents.filter((a) => !used.has(a.id));
  const newAgent = async () => {
    const a = await attempt(() => POST<Agent>('/agents', { name: 'New agent' }));
    if (a) navigate(`#/agents/${a.id}/edit`);
  };
  return (
    <>
      <PanelHead api={api}>
        <div className="min-w-0 flex-1">
          <div className="label">Bench</div>
          <div className={TITLE}>{`${bench.length} agents not on a team`}</div>
        </div>
      </PanelHead>
      <div className={BODY}>
        <p className="hint">Agents not in a team yet. Drag one onto a team on the map, or open it and add it to a team.</p>
        <div className="list">
          {bench.map((a) => (
            <Pick key={a.id} onClick={() => api.choose({ type: 'agent', id: a.id })}>
              <Avatar agent={a} />
              <div className="min-w-0 flex-1">
                <div className="title">{a.name}</div>
                <div className="hint">{a.specialty || ''}</div>
              </div>
            </Pick>
          ))}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <a className="btn ghost small" href="#/library">
            Hire more
          </a>
          <button className="btn ghost small" onClick={() => void newAgent()}>
            + New agent
          </button>
        </div>
      </div>
    </>
  );
}

// ---------- the Brain ----------
function BrainPanel({ api, d }: { api: StationPanelApi; d: AppState }) {
  const proj: Partial<Project> = d.project || {};
  const [info, setInfo] = useState<BrainInfo | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    GET<BrainInfo>('/brain')
      .then((bi) => alive && (setInfo(bi), setError('')))
      .catch((e: Error) => alive && setError(e.message));
    return () => void (alive = false);
  }, [reload]);
  const teams = api.teams();
  const addNote = async () => {
    const name = await promptBox('New note in the Brain', { value: 'note.md' });
    if (!name) return;
    const content = await promptBox(name, { multiline: true, placeholder: 'Anything the agents should know about this project.' });
    if (content == null) return;
    await attempt(() => POST('/brain/note', { name, content }), 'Saved to notes/');
    setReload((n) => n + 1);
  };
  return (
    <>
      <PanelHead api={api}>
        {proj.logoAt ? (
          <DomNode as="span" className="grid size-10.5 flex-none place-items-center rounded-box bg-ink/5" make={() => projectMark(proj as Project, 34)} deps={[proj.id, proj.logoAt]} />
        ) : (
          <span className="st-badge lg" style={badgeStyle('#c4ff3d')}>
            <Icon name="brain" size={18} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="label">Project Brain</div>
          <div className={TITLE}>{proj.name || 'Project'}</div>
        </div>
      </PanelHead>
      <div className={BODY}>
        <About proj={proj} summary={proj.description ? { text: proj.description, from: 'description' } : info?.summary?.text ? info.summary : null} />
        <div className="grid grid-cols-[repeat(3,1fr)] gap-1.5">
          <div className={STAT}>
            <b className={STAT_N}>{d.agents.length}</b>agents
          </div>
          <div className={STAT}>
            <b className={STAT_N}>{teams.length}</b>teams
          </div>
          <div className={STAT}>
            <b className={STAT_N}>{d.runs.length + api.busyTeams()}</b>working
          </div>
        </div>
        <button className="btn small mt-3 w-full justify-center" onClick={() => openDock()}>
          <Icon name="sparkles" size={14} />
          Ask the Brain
        </button>
        <div className="label mt-7">Brain folder</div>
        <div className="hint mt-1.5 font-mono wrap-anywhere">{proj.brainPath || ''}</div>
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <button className="btn ghost small" onClick={() => void attempt(() => POST('/brain/open', {}))}>
            <Icon name="folder" size={14} />
            Open folder
          </button>
          <button className="btn ghost small" onClick={() => void attempt(() => POST('/brain/open', { app: 'vscode' }))}>
            <Icon name="external-link" size={14} />
            VS Code
          </button>
          <button className="btn ghost small" onClick={() => void addNote()}>
            <Icon name="pen-line" size={14} />
            Add note
          </button>
        </div>
        <div>
          {error ? (
            <p className="hint">{error}</p>
          ) : !info ? (
            <p className="hint">Reading the Brain folder…</p>
          ) : (
            <>
              {info.git ? (
                <div className={`${CONN} mt-3.5`}>
                  <DomNode as="span" className="dom-contents" make={() => logo('github', 16) || icon('git-branch', 16)} deps={[]} />
                  <div className="min-w-0 flex-1">
                    <div>
                      {info.git.url ? (
                        <a href={info.git.url} target="_blank" rel="noreferrer">
                          {info.git.url.replace('https://github.com/', '')}
                        </a>
                      ) : (
                        'Local git repo'
                      )}
                    </div>
                    <div className="hint">{`${info.git.branch} · ${info.git.last}${info.git.changes ? ` · ${info.git.changes} changed` : ''}`}</div>
                  </div>
                  <button className="btn tiny ghost" onClick={() => void attempt(() => POST<{ message: string }>('/brain/pull'), (r) => r.message)}>
                    Pull
                  </button>
                </div>
              ) : null}
              <div className="hint mt-3.5">{`${info.files} files · ${info.sizeMB} MB`}</div>
              <div className="mt-2 grid grid-cols-[1fr_1fr] gap-x-2.5 gap-y-0.5">
                {info.entries.map((e) => (
                  <div key={e.path || e.name} className="st-file flex items-center gap-1.5 overflow-hidden py-0.5 text-[12.5px] text-ellipsis whitespace-nowrap text-dim">
                    <Icon name={e.dir ? 'folder' : 'pen-line'} size={13} className="text-faint" />
                    {e.name}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="label mt-7">Teams</div>
        <div className="list">
          {teams.map((wf, i) => (
            <Pick key={wf.id} onClick={() => api.choose({ type: 'branch', id: wf.id })}>
              <span className="st-dot" style={badgeStyle(wfColor(wf, i))} />
              <div className="min-w-0 flex-1">
                <div className="title">{wf.name}</div>
                <div className="hint">{wf.description || `${(wf.members || []).length} members`}</div>
              </div>
              {api.teamBusy(wf.id) ? <span className="dot busy" /> : null}
            </Pick>
          ))}
          {!teams.length ? <p className="empty">No teams yet.</p> : null}
        </div>
        {d.approvals.length ? (
          <>
            <div className="label mt-7">Needs you</div>
            <div className="flex flex-col gap-2.5">
              {d.approvals.map((x) => (
                <DomNode key={x.id} make={() => approvalCard(x)} deps={[JSON.stringify(x)]} />
              ))}
            </div>
          </>
        ) : null}
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <button className="btn ghost small" onClick={api.newTeam}>
            <Icon name="git-branch" size={14} />
            New team
          </button>
        </div>
      </div>
    </>
  );
}

// What the project is about, and its logo (shown here, on the start screen, in the project menu and in the globe).
function About({ proj, summary }: { proj: Partial<Project>; summary: { text: string; from: string | null } | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const text = summary?.text || '';
  const ref = proj.id ? { id: proj.id, name: proj.name || '' } : null;
  const edit = () => {
    setDraft(proj.description || text);
    setEditing(true);
  };
  const save = async () => {
    if (!proj.id) return;
    if (await attempt(() => PUT<Project>(`/projects/${proj.id}`, { description: draft }), 'Saved')) {
      refreshSoon(0);
      setEditing(false);
    }
  };
  const rename = async () => {
    const name = (await promptBox('Rename project', { value: proj.name || '' }))?.trim();
    if (!name || name === proj.name || !proj.id) return;
    if (await attempt(() => PUT(`/projects/${encodeURIComponent(proj.id!)}`, { name }), `Renamed to ${name}`)) refreshSoon(0);
  };
  return (
    <div className="mb-3.5 rounded-[12px] border border-line bg-bg p-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="grid size-18 flex-none cursor-pointer place-items-center rounded-[12px] border border-line bg-ink/4 [transition:border-color_0.15s,transform_0.15s] hover:[transform:translateY(-1px)] hover:border-accent"
          title={proj.logoAt ? 'Change the logo' : 'Add a logo'}
          onClick={() => ref && void pickLogo(ref)}
        >
          {proj.logoAt ? (
            <DomNode as="span" className="dom-contents" make={() => projectMark(proj as Project, 64)} deps={[proj.id, proj.logoAt]} />
          ) : (
            <span className="flex flex-col items-center gap-1 text-[11px] text-dim">
              <Icon name="image" size={20} />
              Logo
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-2.5">
              <textarea className="w-full" rows={4} autoFocus aria-label="What this project is about" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What is this project? Who is it for, what should come out of it?" />
              <div className="flex flex-wrap items-center gap-1.5">
                <button className="btn small" onClick={() => void save()}>
                  Save
                </button>
                <button className="btn ghost small" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : text ? (
            <>
              <p className="st-about-text m-0 line-clamp-6 text-[13.5px] leading-[1.5] text-ink">{text}</p>
              {summary?.from && summary.from !== 'description' ? <div className="hint">{`from ${summary.from}`}</div> : null}
            </>
          ) : (
            <p className="hint">No description yet. Say what the project is about, or ask the Brain to write PROJECT.md.</p>
          )}
        </div>
      </div>
      {editing ? null : (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button className="btn ghost tiny" onClick={edit}>
            <Icon name="pencil" size={12} />
            {text ? 'Edit description' : 'Add a description'}
          </button>
          <button className="btn ghost tiny" title="Change the name of this project (its folder keeps its name)" onClick={() => void rename()}>
            <Icon name="pencil" size={12} />
            Rename
          </button>
          <button className="btn ghost tiny" onClick={() => ref && void pickLogo(ref)}>
            <Icon name="image" size={12} />
            {proj.logoAt ? 'Change logo' : 'Add logo'}
          </button>
          {proj.logoAt ? (
            <button className="btn ghost tiny" onClick={() => ref && void removeLogo(ref)}>
              Remove logo
            </button>
          ) : null}
          <button className="btn ghost tiny" title="A 3D model (.glb, .obj, .stl, .ply, .fbx) that replaces the logo inside the Brain" onClick={() => ref && void pickModel(ref)}>
            <Icon name="box" size={12} />
            {proj.modelAt ? 'Change 3D model' : 'Add 3D model'}
          </button>
          {proj.modelAt ? (
            <button className="btn ghost tiny" onClick={() => ref && void removeModel(ref)}>
              Remove 3D model
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------- a connection (a service, a program, an MCP server) ----------
function ConnectionPanel({ api, d, id }: { api: StationPanelApi; d: AppState; id: string }) {
  const teams = api.teams();
  const it = availableIntegrations(d, api.programs()).find((x) => x.id === id) || ({ ...intInfo(id), live: false, missing: true } as AvailableIntegration);
  // (gone: a removed MCP server, say)
  useEffect(() => {
    if (!it?.label) api.choose(null);
  });
  if (!it?.label) return null;
  // A team's own access reaches every member, so count those agents too (same rule as stepLinks).
  const viaTeam = new Set(teams.filter((w) => w.access && agentLinks({ toolGroups: w.access.toolGroups, mcpServers: w.access.mcpServers }).has(it.id)).flatMap((w) => w.members));
  const agentsUsing = d.agents.filter((a) => agentLinks(a).has(it.id) || viaTeam.has(a.id));
  const teamsUsing = teams.filter((w) => api.teamLinks(w.id).has(it.id));
  const prog = it.program;
  const status = it.missing ? 'not set up' : it.live ? (prog?.serviceUrl ? `running · ${prog.serviceUrl}` : prog && !prog.cli ? 'running' : 'ready') : 'installed, not running';
  return (
    <>
      <PanelHead api={api}>
        <span className="st-badge lg" style={badgeStyle(it.color)}>
          <Mark id={it.id} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="label">{it.mcp ? 'MCP server' : prog ? 'Program' : 'Service'}</div>
          <div className={TITLE}>{it.label}</div>
        </div>
      </PanelHead>
      <div className={BODY}>
        <p>
          <span className={`pill ${it.live ? 'ok' : it.missing ? 'bad' : ''}`}>{status}</span>
          {prog?.version ? <span className="hint">{` v${prog.version}`}</span> : null}
        </p>
        <div className="label mt-3.5">{`Teams using it (${teamsUsing.length})`}</div>
        <div className="list">
          {teamsUsing.map((w) => (
            <Pick key={w.id} onClick={() => api.choose({ type: 'branch', id: w.id })}>
              <div className="grow min-w-0 flex-1">{w.name}</div>
            </Pick>
          ))}
        </div>
        <div className="label mt-3.5">{`Agents with access (${agentsUsing.length})`}</div>
        <div className="list">
          {agentsUsing.map((a) => (
            <Pick key={a.id} onClick={() => api.choose({ type: 'agent', id: a.id })}>
              <Avatar agent={a} />
              <div className="grow min-w-0 flex-1">{a.name}</div>
            </Pick>
          ))}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          {prog && !prog.cli && (prog.exe || prog.shortcut) ? (
            <button className="btn small" onClick={() => void attempt(() => POST<{ message: string }>('/programs/launch', { program: prog.id }), (r) => r.message)}>
              Start
            </button>
          ) : null}
          {prog?.serviceUrl ? (
            <a className="btn ghost small" href={prog.serviceUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          ) : null}
          {['x', 'telegram', 'discord'].includes(it.id) ? (
            <a className="btn ghost small" href="#/settings?tab=connections">
              Connections
            </a>
          ) : null}
          {it.mcp ? (
            <a className="btn ghost small" href="#/settings?tab=mcp">
              Tools &amp; MCP
            </a>
          ) : null}
          {['openrouter', 'lmstudio', 'ollama'].includes(it.id) ? (
            <a className="btn ghost small" href="#/settings">
              Settings
            </a>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------- a team ----------
// Team panel: the goal, members and lead, what it can reach, its routine, and the team chat.
const withMembers = (wf: TeamView, members: string[]): TeamView => ({
  ...wf,
  members,
  steps: members.map((id) => ({ type: 'agent' as const, agentId: id })),
  lead: wf.lead && !members.includes(wf.lead) ? null : wf.lead,
});
const presetAgent = (a: Agent) => attempt(() => POST(`/presets/agent/${a.id}`), `Saved ${a.name} as a preset (Agent library › Your presets)`);
const presetTeam = (w: TeamView) => attempt(() => POST(`/presets/team/${w.id}`), `Saved ${w.name} and its agents as a preset (Agent library › Your presets)`);

// (the tab you were on stays open when you pick another team)
type TeamTab = 'members' | 'setup';
let lastTab: TeamTab = 'members';

function TeamPanel({ api, d, id }: { api: StationPanelApi; d: AppState; id: string }) {
  const [tab, setTabState] = useState<TeamTab>(lastTab);
  const setTab = (t: TeamTab) => setTabState((lastTab = t));
  const teams = api.teams();
  const wf = teams.find((w) => w.id === id);
  useEffect(() => {
    if (!wf) api.choose(null);
  });
  if (!wf) return null;
  const c = wfColor(wf, teams.indexOf(wf));
  const byId = new Map(d.agents.map((a) => [a.id, a]));
  const ts = api.teamState(id);
  const members = wf.members.map((mid) => byId.get(mid)).filter((a): a is Agent => !!a);
  const nameOf = (mid: string) => (mid === 'brain' ? 'Brain' : byId.get(mid)?.name || 'Agent');
  const mention = (a: Agent) => openChat('team', id).mention?.(a.name);
  return (
    <>
      <PanelHead api={api}>
        <span className="st-dot" style={badgeStyle(c)} />
        <div className="min-w-0 flex-1">
          <div className="label">Team · group chat</div>
          <div className={TITLE}>{wf.name}</div>
          <div className="st-team-status mt-0.75 text-[12px]">
            {ts.working.length ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-accent">
                <span className="dot busy" />
                {`${ts.working.map(nameOf).join(', ')} working${ts.queued.length ? ` · ${ts.queued.length} waiting` : ''}`}
              </span>
            ) : (
              <span className="hint">{members.length ? 'Quiet · waiting for a message' : 'No members yet'}</span>
            )}
          </div>
        </div>
      </PanelHead>
      <div className={BODY}>
        {wf.description ? <p className="st-team-goal mb-2.5 text-[13px] leading-[1.45] text-dim">{wf.description}</p> : null}
        {/* faces of everyone on the team: who's working pulses, the lead has a star */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {members.map((a) => (
            <button
              key={a.id}
              className={`${FACE} ${ts.working.includes(a.id) ? 'animate-[st-face-pulse_1.4s_ease-in-out_infinite] border-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]' : 'border-line'}`}
              title={`${a.name}${wf.lead === a.id ? ' · lead' : ''}${ts.working.includes(a.id) ? ' · working' : ''}`}
              onClick={() => mention(a)}
            >
              <Avatar agent={a} />
              {wf.lead === a.id ? <span className={LEAD_STAR}>★</span> : null}
            </button>
          ))}
          <button className={`${FACE} border-dashed border-line text-dim`} title="Add someone" aria-label="Add someone" onClick={() => setTab('members')}>
            <Icon name="user-plus" size={15} />
          </button>
        </div>
        <button className="btn small mb-3 w-full justify-center" onClick={() => openChat('team', id)}>
          <Icon name="message-square" size={14} />
          Open the team chat
        </button>
        <Tabs
          label="Team"
          rowClassName="mb-3! [&_button]:px-3 [&_button]:py-2"
          panelClassName="animate-[rise-in_0.2s_ease-out]"
          value={tab}
          onChange={setTab}
          tabs={[
            {
              value: 'members',
              label: (
                <>
                  Members<span className="ml-1.5 rounded-[8px] bg-panel-2 px-1.25 text-[10px] text-dim">{members.length}</span>
                </>
              ),
            },
            { value: 'setup', label: 'Setup' },
          ]}
        >
          {tab === 'setup' ? <TeamSetup api={api} d={d} wf={wf} color={c} /> : <TeamMembers api={api} d={d} wf={wf} members={members} ts={ts} mention={mention} />}
        </Tabs>
      </div>
    </>
  );
}

function TeamMembers({ api, d, wf, members, ts, mention }: { api: StationPanelApi; d: AppState; wf: TeamView; members: Agent[]; ts: TeamState; mention: (a: Agent) => void }) {
  const id = wf.id;
  const others = d.agents.filter((a) => !wf.members.includes(a.id));
  const [pick, setPick] = useState('');
  const addId = others.some((a) => a.id === pick) ? pick : others[0]?.id || '';
  return (
    <>
      <p className="hint">Everyone sees the whole chat. Your messages go to the lead (★) first, or to whoever you @mention. Members hand work to each other with @Name.</p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {members.map((a) => {
          const isLead = wf.lead === a.id;
          const now = api.now(a.id, id);
          const st = ts.working.includes(a.id) ? 'working' : ts.queued.includes(a.id) ? 'queued' : now.st;
          return (
            <div
              key={a.id}
              className={`st-member ${st} flex items-start gap-2.5 rounded-box border bg-bg px-2.5 py-2.25 [transition:border-color_0.2s] ${st === 'working' ? 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))]' : st === 'queued' ? 'border-[color-mix(in_srgb,var(--color-amber)_40%,var(--color-line))]' : 'border-line'}`}
            >
              <div className="relative flex-none [&_.avatar]:size-8.5 [&_.avatar]:text-[17px]">
                <Avatar agent={a} />
                {isLead ? (
                  <span className={LEAD_STAR} title="Team lead">
                    ★
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="st-member-name flex cursor-pointer items-center gap-1.5 text-[13.5px] font-semibold hover:text-accent" role="button" tabIndex={0} onClick={() => api.choose({ type: 'agent', id: a.id, wf: id })} onKeyDown={(e) => e.key === 'Enter' && api.choose({ type: 'agent', id: a.id, wf: id })}>
                  {a.name}
                  {isLead ? <span className="tc-lead">lead</span> : null}
                </div>
                <div className={`st-member-now mt-0.5 flex items-center gap-1 overflow-hidden text-[12px] text-ellipsis whitespace-nowrap ${st === 'working' ? 'text-accent' : 'text-dim'}`}>
                  {st === 'working' ? (
                    <>
                      <span className="dot busy" /> {now.text || 'Working…'}
                    </>
                  ) : st === 'queued' ? (
                    'Up next'
                  ) : st === 'needs' ? (
                    <>
                      <span className="dot warn" /> Waiting for your OK
                    </>
                  ) : (
                    a.specialty || 'Ready'
                  )}
                </div>
                <DomNode className="mt-1.5" make={() => modelChip(a, { compact: true })} deps={[a]} />
              </div>
              <div className="flex gap-1">
                <button className={MEMBER_ACT} title={`Write to ${a.name} in the team chat`} aria-label={`Write to ${a.name} in the team chat`} onClick={() => mention(a)}>
                  @
                </button>
                <button
                  title={isLead ? 'Remove as lead' : 'Make lead: your messages go to them first'}
                  aria-label={isLead ? `Remove ${a.name} as lead` : `Make ${a.name} lead`}
                  className={isLead ? MEMBER_ACT_ON : MEMBER_ACT}
                  onClick={() => void api.saveTeam({ ...wf, lead: isLead ? null : a.id })}
                >
                  ★
                </button>
                <button className={MEMBER_ACT} title="Take off this team (stays in the project)" aria-label={`Take ${a.name} off this team`} onClick={() => void api.saveTeam(withMembers(wf, wf.members.filter((x) => x !== a.id)))}>
                  ✕
                </button>
              </div>
            </div>
          );
        })}
        {!members.length ? <p className="empty">No agents yet. Add one below, hire from the Agent library, or ask the Brain.</p> : null}
      </div>
      <div className="label mt-7">Add someone</div>
      {others.length ? (
        <div className="mt-3.5 flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <select aria-label="Agent to add" value={addId} onChange={(e) => setPick(e.target.value)}>
              {others.map((a) => (
                <option key={a.id} value={a.id}>{`${a.emoji || ''} ${a.name}`}</option>
              ))}
            </select>
          </div>
          <button className="btn small" onClick={() => addId && void api.saveTeam(withMembers(wf, [...wf.members, addId]))}>
            <Icon name="user-plus" size={14} />
            Add
          </button>
        </div>
      ) : (
        <p className="hint">Every agent in this project is already on it.</p>
      )}
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <button className="btn ghost small" onClick={() => navigate(`#/library?branch=${encodeURIComponent(id)}`)}>
          <Icon name="store" size={14} />
          Hire from the Agent library
        </button>
        <button className="btn ghost small" onClick={() => openDock('auto', `For the team "${wf.name}": add `)}>
          <Icon name="brain" size={14} />
          Ask the Brain
        </button>
      </div>
      <p className="hint mt-3.5">Tip: drag an agent onto this team on the map to add it (hold Ctrl to also keep it on its other team).</p>
    </>
  );
}

function TeamSetup({ api, d, wf, color }: { api: StationPanelApi; d: AppState; wf: TeamView; color: string }) {
  const id = wf.id;
  // the access chips change at once; the save waits until you stop clicking
  const [access, setAccess] = useState<TeamAccess>({ toolGroups: wf.access?.toolGroups || [], mcpServers: wf.access?.mcpServers || [] });
  const accessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(wf);
  latest.current = wf;
  const saveAccess = (patch: Partial<TeamAccess>) => {
    const next = { ...access, ...patch };
    setAccess(next);
    if (accessTimer.current) clearTimeout(accessTimer.current);
    accessTimer.current = setTimeout(() => void api.saveTeam({ ...latest.current, access: next }), 500);
  };
  const sch = wf.schedule || { type: 'none' };
  const saveSchedule = (patch: Partial<NonNullable<TeamView['schedule']>>) => {
    const schedule = { ...sch, ...patch } as NonNullable<TeamView['schedule']>;
    void api.saveTeam({ ...wf, schedule, enabled: schedule.type !== 'none' });
  };
  const cloneTeam = async (withAgents: boolean) => {
    const c = await attempt(() => POST<Team>(`/workflows/${id}/clone`, { withAgents }), withAgents ? `Cloned ${wf.name} with copies of its agents` : `Cloned ${wf.name}`);
    if (!c) return;
    if (withAgents) refreshSoon(0);
    await api.reloadTeams();
    api.choose({ type: 'branch', id: c.id });
  };
  const remove = async () => {
    if (!(await confirmBox(`Delete the team "${wf.name}"? Its agents stay in the project, the team chat is removed.`, { ok: 'Delete', danger: true }))) return;
    await attempt(() => DEL(`/workflows/${id}`));
    api.choose(null);
    void api.reloadTeams();
  };
  return (
    <>
      <div className="label">Name and goal</div>
      <div className="mt-3.5 flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <input key={`n:${wf.name}`} aria-label="Team name" defaultValue={wf.name} ref={committed<HTMLInputElement>((el) => void api.saveTeam({ ...latest.current, name: el.value.trim() || latest.current.name }))} />
        </div>
        <input
          key={`c:${color}`}
          type="color"
          aria-label="Team colour"
          defaultValue={color}
          className="h-8.5 w-10 border border-line-2 bg-panel p-0.5"
          ref={committed<HTMLInputElement>((el) => void api.saveTeam({ ...latest.current, color: el.value }))}
        />
      </div>
      <div className="mt-3.5">
        <textarea
          key={`d:${wf.description || ''}`}
          rows={3}
          aria-label="Team goal"
          defaultValue={wf.description || ''}
          placeholder="The team's goal, e.g. grow our X account with daily posts"
          ref={committed<HTMLTextAreaElement>((el) => void api.saveTeam({ ...latest.current, description: el.value.trim() }))}
        />
      </div>
      <p className="hint">Every member reads the goal before it answers in the chat.</p>
      <div className="label mt-7">Team skills</div>
      <p className="hint">Every member gets these while it works for this team (on top of its own and the project's).</p>
      <DomNode
        className="mt-3.5"
        make={() => skillPicker(wf.skills || [], (v) => void api.saveTeam({ ...latest.current, skills: v }), { inherited: (d.project?.skills || []).map((slug) => ({ slug, from: 'project' })), empty: 'No team skills yet.' })}
        deps={[id, (wf.skills || []).join('|'), (d.project?.skills || []).join('|')]}
      />
      <div className="label mt-7">Extra access while working for this team</div>
      <p className="hint">Members get these on top of their own tools.</p>
      <div className="mt-3.5">
        <ChipSet label="Extra tools" options={d.toolGroups.map((g) => ({ value: g.id, label: g.label, title: g.description }))} value={access.toolGroups} onChange={(v) => saveAccess({ toolGroups: v })} />
      </div>
      {(d.mcpServers || []).length ? (
        <div className="mt-3.5">
          <ChipSet label="Extra MCP servers" options={mcpOptions(d.mcpServers, d.mcpInfo)} value={access.mcpServers} onChange={(v) => saveAccess({ mcpServers: v })} />
          {copiesWarning(access.mcpServers, d.mcpInfo) ? <p className="hint mcp-copies-warning mt-2 text-amber">{copiesWarning(access.mcpServers, d.mcpInfo)}</p> : null}
        </div>
      ) : null}
      <div className="label mt-7">Connections the team can reach</div>
      <ConnectionList api={api} d={d} ids={api.teamLinks(id)} />
      <div className="label mt-7">Daily routine</div>
      <p className="hint">The team gets this message on its schedule, as if you wrote it in the chat.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Daily routine"
          options={[
            { value: 'none', label: 'Off' },
            { value: 'daily', label: 'Every day' },
          ]}
          value={sch.type === 'daily' ? 'daily' : 'none'}
          onChange={(t) => saveSchedule({ type: t })}
        />
        {sch.type === 'daily' ? <input key={`t:${sch.time}`} type="time" aria-label="Time" defaultValue={sch.time || '09:00'} className="w-27.5" ref={committed<HTMLInputElement>((el) => saveSchedule({ time: el.value }))} /> : null}
      </div>
      {sch.type === 'daily' ? (
        <div className="mt-3.5">
          <input key={`m:${sch.input || ''}`} aria-label="What the team should do each time" defaultValue={sch.input || ''} placeholder="What the team should do each time" ref={committed<HTMLInputElement>((el) => saveSchedule({ input: el.value }))} />
        </div>
      ) : null}
      <div className="label mt-7">Symbol on the map</div>
      <p className="hint">Shown in the middle of the team's pod. An emoji, or a picture or 3D model of your own.</p>
      <SymbolPicker api={api} wf={wf} />
      <div className="label mt-7">On the map</div>
      <p className="hint">Drag the team to move it anywhere. Shift+drag spins it.</p>
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <button className="btn ghost small" onClick={() => void api.spinTeam(id)}>
          <Icon name="rotate-cw" size={14} />
          Spin 45°
        </button>
        {wf.pos || wf.rot ? (
          <button className="btn ghost small" onClick={() => void api.saveTeam({ ...wf, pos: null, rot: null, angle: null })}>
            <Icon name="rotate-ccw" size={14} />
            Put back next to the Brain
          </button>
        ) : null}
        <button className="btn ghost small" onClick={() => api.zoomToTeam(id)}>
          <Icon name="zoom-in" size={14} />
          Zoom to it
        </button>
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-2.5">
        <button className="btn ghost small" onClick={() => openBranchBuilder({ wf, onSaved: () => void api.reloadTeams() })}>
          <Icon name="workflow" size={14} />
          Open the team builder
        </button>
      </div>
      <div className="label mt-7">Copy it</div>
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <button className="btn ghost small" title="A new team with the same members and settings" onClick={() => void cloneTeam(false)}>
          <Icon name="copy" size={14} />
          Clone team
        </button>
        <button className="btn ghost small" title="A new team with copies of every member" onClick={() => void cloneTeam(true)}>
          <Icon name="copy" size={14} />
          Clone with its agents
        </button>
        <button className="btn ghost small" title="Keep the team and its agents as a template for any project" onClick={() => void presetTeam(wf)}>
          <Icon name="bookmark-plus" size={14} />
          Save as preset
        </button>
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-1.5">
        <DomNode as="span" className="dom-contents" make={() => historyButton('team', id, () => void api.reloadTeams())} deps={[id]} />
        <button className="btn danger tiny" onClick={() => void remove()}>
          Delete team
        </button>
      </div>
    </>
  );
}

// The symbol in the middle of the team's pod: an emoji, or a picture or 3D model instead.
function SymbolPicker({ api, wf }: { api: StationPanelApi; wf: TeamView }) {
  const own = wf.markFile ? (wf.markFile.kind === 'image' ? 'picture' : '3D model') : null;
  const setEmoji = async (e: string) => {
    if (wf.markFile) await attempt(() => DEL(`/workflows/${wf.id}/mark`));
    await api.saveTeam({ ...wf, mark: e, markFile: null });
  };
  const current = wf.mark || DEFAULT_TEAM_MARK;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {EMOJI_CHOICES.map((e) => (
          <button key={e} className="btn ghost small px-2 py-0.5 text-[17px]" title={e} aria-pressed={!own && current === e} onClick={() => void setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <input aria-label="Your own emoji" placeholder="Type or paste an emoji" maxLength={16} className="w-42.5" ref={committed<HTMLInputElement>((el) => el.value.trim() && void setEmoji(el.value.trim()))} />
        <button className="btn ghost small" onClick={() => void pickTeamMark({ id: wf.id, name: wf.name }).then((ok) => void (ok && api.reloadTeams()))}>
          <Icon name="image" size={14} />
          Use a picture or 3D model…
        </button>
        {own ? (
          <button className="btn ghost small" onClick={() => void setEmoji(wf.mark || '')}>
            Back to the emoji
          </button>
        ) : null}
      </div>
      {own ? <p className="hint mt-3.5">{`Showing your ${own} (a .glb turns, a picture stays flat).`}</p> : null}
    </div>
  );
}

// ---------- an agent ----------
// The agent's model, with its version, and how it signs in. Switch it with the chip.
const AUTH_NAMES: Record<string, string> = { login: 'Claude login (subscription)', anthropic: 'Anthropic API key', openrouter: 'OpenRouter key' };
function ModelSection({ a }: { a: Agent }) {
  // (the chip changes the agent in place: draw again)
  const [, redraw] = useState(0);
  const mi = modelInfo(a);
  const setAuth = async (v: string) => {
    if (await attempt(() => PUT(`/agents/${a.id}`, { claudeAuth: v }), 'Saved')) {
      a.claudeAuth = v as Agent['claudeAuth'];
      refreshSoon(0);
      redraw((n) => n + 1);
    }
  };
  return (
    <div className="mt-3.5 flex flex-col gap-2 rounded-box border border-line bg-[rgba(7,8,7,0.5)] p-3">
      <div className="label">Model</div>
      <div className="flex items-center gap-3">
        <DomNode as="span" className="dom-contents" make={() => (mi.brand && logo(mi.brand, 22)) || icon('cpu', 22)} deps={[mi.brand]} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center font-sans text-[17px] leading-[1.25] font-bold">
            {mi.name}
            {mi.latest ? <span className="model-latest">always latest</span> : null}
          </div>
          <div className="hint">{mi.where}</div>
        </div>
      </div>
      <div className="grid grid-cols-[90px_1fr] items-center gap-2 [&_.model-chip]:[justify-self:start]">
        <span className="hint">Switch</span>
        <DomNode as="span" className="dom-contents" make={() => modelChip(a, { onChange: () => redraw((n) => n + 1) })} deps={[a]} />
      </div>
      {a.engine === 'claude-code' ? (
        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
          <span className="hint">Sign in with</span>
          <select className="py-1.5 text-[13px]" aria-label="Sign in with" value={a.claudeAuth || 'login'} onChange={(e) => void setAuth(e.target.value)}>
            {Object.entries(AUTH_NAMES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {a.lastModel ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-dim">
          <Icon name="circle-check" size={13} className="text-accent" />
          Last run used <b className="font-mono text-[12px] leading-[normal] font-semibold text-ink">{a.lastModel}</b>
          <span className="hint">{` · ${ago(a.lastModelAt)}`}</span>
        </div>
      ) : (
        <div className="hint">Not run yet. After the first run you see the exact model it used.</div>
      )}
    </div>
  );
}

// Agent panel: who it is, which teams it's on, what it can reach, its skills.
function AgentPanel({ api, d, id, wfId }: { api: StationPanelApi; d: AppState; id: string; wfId?: string }) {
  const a = d.agents.find((x) => x.id === id);
  useEffect(() => {
    if (!a) api.choose(null);
  });
  const [pick, setPick] = useState('');
  if (!a) return null;
  const teams = api.teams();
  const onTeams = teams.filter((w) => (w.members || []).includes(id));
  const others = teams.filter((w) => !onTeams.includes(w));
  const addTo = others.some((w) => w.id === pick) ? pick : others[0]?.id || '';
  const removeFrom = async (w: TeamView) => {
    await api.saveTeam(withMembers(w, w.members.filter((x) => x !== id)));
    toast(`Removed ${a.name} from ${w.name}`);
  };
  const addToTeam = async () => {
    const w = teams.find((x) => x.id === addTo);
    if (!w) return;
    await api.saveTeam(withMembers(w, [...w.members, id]));
    toast(`Added ${a.name} to ${w.name}`);
  };
  const clone = async () => {
    if (await attempt(() => POST<Agent>(`/agents/${a.id}/duplicate`), `Cloned ${a.name}`)) refreshSoon(0);
  };
  const now = api.now(id, wfId);
  const connectors = a.engine === 'claude-code' ? api.connectors() : [];
  return (
    <>
      <PanelHead api={api}>
        <Avatar agent={a} lg />
        <div className="min-w-0 flex-1">
          <div className={TITLE}>{a.name}</div>
          <div className="hint">{a.specialty || ''}</div>
        </div>
      </PanelHead>
      <div className={BODY}>
        <div
          className={`st-agent-now flex items-center gap-2 rounded-box border bg-bg px-2.5 py-2 text-[12.5px] ${now.st === 'working' ? 'border-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-line))] text-accent' : now.st === 'needs' ? 'border-[color-mix(in_srgb,var(--color-amber)_40%,var(--color-line))] text-amber' : 'border-line text-dim'}`}
        >
          <span className={`dot ${now.st === 'working' ? 'busy' : now.st === 'needs' ? 'warn' : 'on'}`} />
          <span className="min-w-0 flex-1">{now.st === 'working' ? now.text : now.st === 'needs' ? 'Waiting for your OK (see below)' : 'Ready'}</span>
        </div>
        <ModelSection a={a} />
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <button className="btn small" onClick={() => openChat('agent', id)}>
            <Icon name="message-square" size={14} />
            Chat
          </button>
          <button className="btn ghost small" onClick={() => navigate(`#/agents/${id}`)}>
            Full page
          </button>
          {a.engine !== 'openai' ? (
            <button className="btn ghost small" onClick={() => openTerminal(a)}>
              Terminal
            </button>
          ) : null}
          <button className="btn ghost small" onClick={() => navigate(`#/agents/${id}/edit`)}>
            Edit
          </button>
          <button className="btn ghost small" title="Make a copy of this agent" onClick={() => void clone()}>
            <Icon name="copy" size={13} />
            Clone
          </button>
          <button className="btn ghost small" title="Keep it as a template for any project" onClick={() => void presetAgent(a)}>
            <Icon name="bookmark-plus" size={13} />
            Preset
          </button>
        </div>
        <div className="label mt-7">Skills</div>
        <DomNode
          className="mt-3.5"
          make={() =>
            skillPicker(a.skills || [], (v) => void attempt(() => PUT(`/agents/${id}`, { skills: v })).then(() => refreshSoon(0)), {
              inherited: [...(d.project?.skills || []).map((slug) => ({ slug, from: 'project' })), ...onTeams.flatMap((w) => (w.skills || []).map((slug) => ({ slug, from: w.name })))],
              empty: 'No skills yet.',
            })
          }
          deps={[id, (a.skills || []).join('|'), (d.project?.skills || []).join('|'), onTeams.map((w) => `${w.name}:${(w.skills || []).join(',')}`).join('|')]}
        />
        <div className="label mt-7">{`Teams (${onTeams.length})`}</div>
        <div className={CONNS}>
          {onTeams.map((w) => (
            <div key={w.id} className={`${CONN} ok`}>
              <span className="st-dot" style={badgeStyle(wfColor(w, teams.indexOf(w)))} />
              <span className="grow min-w-0 flex-1 cursor-pointer" role="button" tabIndex={0} onClick={() => api.choose({ type: 'branch', id: w.id })} onKeyDown={(e) => e.key === 'Enter' && api.choose({ type: 'branch', id: w.id })}>
                {w.name}
                <span className="hint">{w.lead === id ? ' · ★ lead' : ' · member'}</span>
              </span>
              <button className="btn tiny ghost" title={`Open ${w.name}'s chat with @${a.name}`} onClick={() => openChat('team', w.id).mention?.(a.name)}>
                Chat
              </button>
              {w.lead !== id ? (
                <button className="btn tiny ghost" title="Make lead of this team" aria-label={`Make ${a.name} lead of ${w.name}`} onClick={() => void api.saveTeam({ ...w, lead: id })}>
                  ★
                </button>
              ) : null}
              <button className="btn tiny ghost" title={`Take ${a.name} off this team`} onClick={() => void removeFrom(w)}>
                Remove
              </button>
            </div>
          ))}
          {!onTeams.length ? <p className="hint">On the Bench: not in any team yet. Add it to one below, or drag it onto a team on the map.</p> : null}
        </div>
        {others.length ? (
          <div className="mt-3.5 flex items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <select aria-label="Team to add it to" value={addTo} onChange={(e) => setPick(e.target.value)}>
                {others.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn small" onClick={() => void addToTeam()}>
              Add to team
            </button>
          </div>
        ) : null}
        <div className="label mt-7">Connections it can use</div>
        <ConnectionList api={api} d={d} ids={agentLinks(a)} />
        {connectors.length ? (
          <div className={CONNS}>
            <div className="hint">Plus the connectors on your Claude account:</div>
            <div className="flex flex-wrap items-center gap-1">
              {connectors.map((c) => {
                const look = connectorLook(c.name);
                return (
                  <span key={c.id || c.name} className="st-badge" style={badgeStyle(c.status === 'connected' ? look.color : '#555850')} title={`${c.name}: ${c.status === 'connected' ? 'connected' : 'needs sign-in'}`}>
                    <DomNode as="span" className="dom-contents" make={() => appLogo(c.name, 11) || document.createTextNode(look.glyph)} deps={[c.name]} />
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}
        <Approvals list={d.approvals.filter((x) => x.agentId === id)} />
      </div>
    </>
  );
}
