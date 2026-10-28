// Workflows: chain agents, tools, approvals and posts. Run by hand or on a schedule.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GET, POST, PUT, DEL, attempt, navigate, confirmBox, promptBox, ago, lightbox } from '../core.ts';
import { scheduleEditor, scheduleText } from '../schedule.ts';
import { Field, Switch } from '../ui/controls.tsx';
import { DomNode, ProjectScoped, reactPage, useAppState, useServerEvents } from '../ui/react.tsx';
import type { AppState, Schedule, Team, TeamStep } from '../../shared/types.ts';

/** One entry of GET /api/tools → tools. */
interface ToolInfo {
  name: string;
  group: string;
  risk: string;
  description: string;
}
/** An old-style workflow step: the fields each step type edits. */
interface WorkflowStep extends TeamStep {
  type: string;
  args?: string;
  message?: string;
  account?: string;
  text?: string;
  thread?: boolean;
  telegram?: boolean;
}
/** The schedule as this page and server/workflows.ts use it (minutes and days aren't in shared Schedule). */
interface WorkflowSchedule extends Schedule {
  minutes?: number;
  days?: number[];
}
type Workflow = Omit<Team, 'steps' | 'schedule'> & { steps: WorkflowStep[]; schedule?: WorkflowSchedule };
/** One entry of GET /api/workflow-templates. */
interface WorkflowTemplate {
  name: string;
  description: string;
  needs: string[];
}
/** GET /api/workflow-runs (mirrors WorkflowRun in server/store.ts). */
interface WorkflowRunStep {
  id?: string;
  label: string;
  type: string;
  status: string;
  output: unknown;
  agentName?: string;
  images?: string[];
}
interface WorkflowRun {
  id: string;
  createdAt?: number;
  workflowId: string;
  workflowName: string;
  input: string;
  trigger: string;
  status: string;
  steps: WorkflowRunStep[];
  error?: string;
}

const STEP_TYPES = [
  { value: 'agent', label: 'Ask an agent' },
  { value: 'tool', label: 'Use a tool' },
  { value: 'approval', label: 'Wait for my OK' },
  { value: 'x_post', label: 'Post to X (Outbox)' },
  { value: 'notify', label: 'Notify me' },
];

/** The steps with one moved up or down (by -1 or +1); unchanged at the ends. */
export function moveStep<T>(steps: readonly T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= steps.length) return [...steps];
  const out = [...steps];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function Status({ st }: { st: string }) {
  if (st === 'done') return <span className="text-accent" aria-label="done">✓</span>;
  if (st === 'failed') return <span className="text-red" aria-label="failed">✕</span>;
  if (st === 'running') return <span className="dot busy" aria-label="running" />;
  if (st === 'needs-you') return <span className="text-amber" aria-label="needs you">!</span>;
  return <span className="text-faint">·</span>;
}

// ---------- the list ----------
function WorkflowsList() {
  const d = useAppState();
  const [data, setData] = useState<{ list: Workflow[]; templates: WorkflowTemplate[] } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([GET<Workflow[]>('/workflows'), GET<WorkflowTemplate[]>('/workflow-templates')]).then(([list, templates]) => live && setData({ list, templates }));
    return () => void (live = false);
  }, []);
  if (!data || !d) return null;
  const create = async () => {
    const name = await promptBox('Name the workflow', { value: 'New workflow' });
    if (!name) return;
    const wf = await attempt(() => POST<Workflow>('/workflows', { name }));
    if (wf) navigate(`#/workflows/${wf.id}`);
  };
  const useTemplate = async (t: WorkflowTemplate) => {
    const wf = await attempt(() => POST<Workflow>('/workflow-templates', { name: t.name }));
    if (wf) navigate(`#/workflows/${wf.id}`);
  };
  return (
    <>
      <p className="lede">A workflow is a list of steps that run in order. Each step gets the result of the one before it, so a researcher can hand findings to a writer, then you approve, then it posts.</p>
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3.5">
        <h2 className="section">Your workflows</h2>
        <button className="btn" onClick={() => void create()}>+ New workflow</button>
      </div>
      {data.list.length ? (
        <div className="cards">
          {data.list.map((wf) => (
            <a key={wf.id} className="card clickable" href={`#/workflows/${wf.id}`}>
              <div className="card-title">{wf.name}</div>
              <div className="card-sub">{wf.description || `${wf.steps.length} steps`}</div>
              <div className="card-foot">
                <span className="pill">{`${wf.steps.length} steps`}</span>
                {wf.schedule?.type !== 'none' ? <span className={`pill${wf.enabled ? ' ok' : ''}`}>{wf.enabled ? scheduleText(wf.schedule) : 'schedule off'}</span> : null}
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty box">No workflows yet. Start from a template below.</div>
      )}
      <h2 className="section">Templates</h2>
      <div className="cards">
        {data.templates.map((t) => {
          const missing = t.needs.filter((n) => !d.agents.some((a) => a.name.toLowerCase() === n.toLowerCase()));
          return (
            <div key={t.name} className="card">
              <div className="card-title">{t.name}</div>
              <div className="card-sub">{t.description}</div>
              <div className="hint">{missing.length ? `Uses: ${t.needs.join(', ')}. Missing ${missing.join(', ')} (add from Agent library > Blacksite, or pick other agents after).` : `Uses: ${t.needs.join(', ')}`}</div>
              <div className="card-foot">
                <button className="btn small" onClick={() => void useTemplate(t)}>Use template</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- the editor ----------
function WorkflowEditor({ id }: { id: string }) {
  const d = useAppState();
  const [loaded, setLoaded] = useState<{ wf: Workflow; tools: ToolInfo[] } | 'gone' | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([GET<Workflow>(`/workflows/${id}`), GET<{ tools: ToolInfo[] }>('/tools')])
      .then(([wf, t]) => live && setLoaded({ wf, tools: t.tools }))
      .catch(() => live && setLoaded('gone'));
    return () => void (live = false);
  }, [id]);
  if (loaded === 'gone')
    return (
      <p>
        Workflow not found. <a href="#/workflows">Back</a>
      </p>
    );
  if (!loaded || !d) return null;
  return <EditorForm first={loaded.wf} tools={loaded.tools} d={d} />;
}

function EditorForm({ first, tools, d }: { first: Workflow; tools: ToolInfo[]; d: AppState }) {
  const id = first.id;
  // the schedule editor (plain DOM) changes schedule and enabled on this object directly
  const sched = useRef<Workflow>(structuredClone(first));
  const [name, setName] = useState(first.name);
  const [description, setDescription] = useState(first.description || '');
  const [steps, setSteps] = useState<WorkflowStep[]>(() => structuredClone(first.steps));
  const [dirty, setDirty] = useState(false);
  const [input, setInput] = useState('');
  const [runsVersion, setRunsVersion] = useState(0);
  const change = (next: WorkflowStep[]) => (setSteps(next), setDirty(true));
  const setStep = (i: number, patch: Partial<WorkflowStep>) => change(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = async () => {
    const r = await attempt(() => PUT(`/workflows/${id}`, { ...sched.current, name, description, steps }), 'Saved');
    if (r) setDirty(false);
    return r;
  };
  const run = async () => {
    if (dirty && !(await save())) return;
    if (await attempt(() => POST(`/workflows/${id}/run`, { input }), 'Started')) setRunsVersion((v) => v + 1);
  };
  const del = async () => {
    if (!(await confirmBox(`Delete workflow "${name}"?`, { ok: 'Delete', danger: true }))) return;
    await attempt(() => DEL(`/workflows/${id}`));
    navigate('#/workflows');
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4">
        <a className="btn ghost small" href="#/workflows">← Workflows</a>
        <div className="flex flex-wrap items-center gap-2.5">
          <button className="btn" disabled={!dirty} onClick={() => void save()}>Save</button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4.5">
          <div className="panel">
            <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
              <Field label="Name">
                <input value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} />
              </Field>
              <Field label="Description">
                <input value={description} onChange={(e) => (setDescription(e.target.value), setDirty(true))} />
              </Field>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Steps</h2>
            </div>
            <ol>
              {steps.map((s, i) => (
                <li key={s.id || i}>
                  {i ? <div className="text-center text-faint text-[14px] leading-none py-1" aria-hidden="true">↓</div> : null}
                  <div className="step border border-line bg-bg p-3.5 relative">
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-mono text-[11px] leading-[normal] font-bold text-accent tracking-[0.14em]">{`STEP ${i + 1}`}</span>
                        <select aria-label={`Step ${i + 1}: what it does`} value={s.type} onChange={(e) => setStep(i, { type: e.target.value })}>
                          {STEP_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                        <input className="wf-label w-55" aria-label={`Step ${i + 1}: label`} value={s.label || ''} placeholder="Label (optional)" onChange={(e) => setStep(i, { label: e.target.value })} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <button className="icon-btn" title="Move up" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => change(moveStep(steps, i, -1))}>↑</button>
                        <button className="icon-btn" title="Move down" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => change(moveStep(steps, i, 1))}>↓</button>
                        <button className="icon-btn" title="Remove" aria-label={`Remove step ${i + 1}`} onClick={() => change(steps.filter((_, j) => j !== i))}>✕</button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2.5 mt-3.5">
                      <StepFields s={s} set={(patch) => setStep(i, patch)} tools={tools} d={d} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
              {STEP_TYPES.map((t) => (
                <button key={t.value} className="btn ghost small" onClick={() => change([...steps, { id: Math.random().toString(36).slice(2), type: t.value, prompt: '{{prev}}' }])}>{`+ ${t.label}`}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4.5">
          <div className="panel">
            <div className="panel-head">
              <h2>Run it</h2>
            </div>
            <textarea rows={2} aria-label="Input for this run" placeholder="Input for this run ({{input}})" value={input} onChange={(e) => setInput(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
              <button className="btn" onClick={() => void run()}>Run now</button>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Schedule</h2>
            </div>
            <DomNode make={() => scheduleEditor(sched.current, () => setDirty(true))} deps={[id]} />
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Runs</h2>
            </div>
            <Runs id={id} version={runsVersion} />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button className="btn danger small" onClick={() => void del()}>Delete workflow</button>
          </div>
        </div>
      </div>
    </>
  );
}

function StepFields({ s, set, tools, d }: { s: WorkflowStep; set: (patch: Partial<WorkflowStep>) => void; tools: ToolInfo[]; d: AppState }) {
  const area = (label: string, key: 'prompt' | 'message' | 'text', rows: number, fallback: string, hint?: ReactNode) => (
    <Field label={label} hint={hint}>
      <textarea rows={rows} value={(s[key] as string | undefined) ?? fallback} placeholder={key === 'prompt' ? '{{prev}}' : undefined} onChange={(e) => set({ [key]: e.target.value })} />
    </Field>
  );
  if (s.type === 'agent')
    return (
      <>
        <Field label="Agent">
          <select value={s.agentId || ''} onChange={(e) => set({ agentId: e.target.value })}>
            <option value="">Pick an agent…</option>
            {d.agents.map((a) => (
              <option key={a.id} value={a.id}>{`${a.emoji || ''} ${a.name}`}</option>
            ))}
          </select>
        </Field>
        {area('Message', 'prompt', 4, '', 'Use {{input}} for the run input, {{prev}} for the last step, {{step1}}… for any step, {{date}}.')}
      </>
    );
  if (s.type === 'tool')
    return (
      <>
        <Field label="Tool">
          <select value={s.tool || ''} onChange={(e) => set({ tool: e.target.value })}>
            <option value="">Pick a tool…</option>
            {tools
              .filter((t) => t.group !== 'knowledge')
              .map((t) => (
                <option key={t.name} value={t.name}>{`${t.name} (${t.group})`}</option>
              ))}
          </select>
        </Field>
        {s.tool ? <p className="hint">{tools.find((t) => t.name === s.tool)?.description || ''}</p> : null}
        <Field label="Arguments (JSON)" hint={'Placeholders work inside strings, e.g. {"workflow": "imagegen", "prompt": "{{prev}}"}'}>
          <textarea className="code" rows={4} value={s.args ?? '{}'} onChange={(e) => set({ args: e.target.value })} />
        </Field>
      </>
    );
  if (s.type === 'approval') return area('What to show you', 'message', 2, '{{prev}}', 'The run pauses in Needs you. You can edit the text before it continues.');
  if (s.type === 'x_post')
    return (
      <>
        <Field label="Account">
          <select value={s.account || ''} onChange={(e) => set({ account: e.target.value })}>
            <option value="">{d.accounts.x.length ? 'First connected account' : 'No X account connected yet'}</option>
            {d.accounts.x.map((a) => (
              <option key={a.username} value={a.username}>{`@${a.username}`}</option>
            ))}
          </select>
        </Field>
        {area('Text', 'text', 3, '{{prev}}')}
        <Switch checked={!!s.thread} onChange={(v) => set({ thread: v })}>Thread: split parts on a line with ---</Switch>
        <p className="hint">It goes to the Outbox for approval unless the account has auto-post on.</p>
      </>
    );
  if (s.type === 'notify')
    return (
      <>
        {area('Message', 'text', 2, '{{prev}}')}
        <Switch checked={!!s.telegram} onChange={(v) => set({ telegram: v })}>Also send on Telegram</Switch>
      </>
    );
  return null;
}

/** The workflow's last runs, kept current; the newest is open. */
function Runs({ id, version }: { id: string; version: number }) {
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void GET<WorkflowRun[]>(`/workflow-runs?workflowId=${id}`).then(setRuns).catch(() => setRuns([])), 150);
  }, [id]);
  useEffect(() => (load(), () => clearTimeout(timer.current)), [load, version]);
  useServerEvents((ev) => ev.type === 'workflow-run' && load());
  if (!runs) return null;
  if (!runs.length) return <p className="empty">No runs yet.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {runs.slice(0, 15).map((r, i) => (
        <details key={r.id} open={i === 0}>
          <summary className="cursor-pointer py-1.5">
            <span className="inline-flex flex-wrap items-center gap-2.5">
              <Status st={r.status} />
              <b>{r.status}</b>
              <span className="hint">{`${ago(r.createdAt)} · ${r.trigger}`}</span>
              {r.status === 'running' ? (
                <button className="btn tiny danger" onClick={(e) => (e.preventDefault(), void attempt(() => POST(`/workflow-runs/${r.id}/stop`)))}>Stop</button>
              ) : null}
            </span>
          </summary>
          {r.input ? <div className="hint">{`Input: ${r.input}`}</div> : null}
          {r.steps.map((s, j) => (
            <div key={s.id || j} className="grid grid-cols-[22px_1fr] gap-2.5 py-2 border-b border-line last:border-b-0 [&_pre]:max-h-50">
              <Status st={s.status} />
              <div>
                <div>
                  <b>{`${j + 1}. ${s.label}`}</b>
                  {s.agentName ? <span className="hint">{` · ${s.agentName}`}</span> : null}
                </div>
                {s.output ? <pre>{typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 2)}</pre> : null}
                {s.images?.length ? (
                  <div className="tool-images">
                    {s.images.map((src) => (
                      <button key={src} type="button" className="img-button" aria-label="Show the image big" onClick={() => lightbox(src)}>
                        <img src={src} alt="" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {r.error ? <p className="text-red">{r.error}</p> : null}
        </details>
      ))}
    </div>
  );
}

export const title = () => 'Workflows';
export const { render, unmount } = reactPage((p) => (p[0] ? <ProjectScoped><WorkflowEditor id={p[0]} /></ProjectScoped> : <WorkflowsList />));
