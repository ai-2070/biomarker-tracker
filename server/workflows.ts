// Workflows: a list of steps run in order. Each step sees the input and earlier outputs as {{input}}, {{prev}}, {{step1}}…
// Step types: agent (ask an agent), tool (call a dashboard tool), approval (wait for you, editable), x_post (to the Outbox), notify.
import { workflows, runs, agents as agentStore, emit, log, activeProject, withProject, listProjects } from './store.ts';
import { renderTemplate, uid } from './util.ts';
import { askAgent, stopChildren, RunStopped } from './engines/index.ts';
import { callTool, TOOL_GROUPS } from './tools.ts';
import { requestApproval, cancelForRun } from './approvals.ts';
import { draftPost } from './social.ts';
import { postUserMessage, normalize, isStepList } from './teams.ts';
import { pickMember } from './brain.ts';
import type { WorkflowRun } from './store.ts';
import type { Agent, Schedule, Team } from '../shared/types.ts';

/** The schedule as this file and web/views/workflows.ts use it (minutes and days aren't in shared Schedule). */
export interface WorkflowSchedule extends Schedule {
  minutes?: number;
  days?: number[];
}
/** A record in the "workflows" collection with the scheduler's fields. */
export type Workflow = Omit<Team, 'schedule'> & { schedule?: WorkflowSchedule; lastScheduledAt?: number };

interface RunControl {
  stopped: boolean;
  signal: AbortSignal;
  abort: () => void;
}

/** A step in a template: `agent` is a starter's name, matched to one of your agents when it's created. */
interface TemplateStep {
  type: string;
  agent?: string;
  label?: string;
  prompt?: string;
  message?: string;
  text?: string;
}
export interface WorkflowTemplate {
  name: string;
  description: string;
  needs: string[];
  steps: TemplateStep[];
  schedule?: WorkflowSchedule;
}

export interface RunSummary {
  id: string;
  workflowId: string;
  status: WorkflowRun['status'];
  steps: { status: string; label: string; agentId: string | null }[];
  error: string | null;
}

const WORKFLOW_AGENT: Pick<Agent, 'id' | 'name' | 'toolGroups' | 'autonomy' | 'knowledge'> = {
  id: '_workflow',
  name: 'Workflow',
  toolGroups: TOOL_GROUPS.map((g) => g.id),
  autonomy: 'auto',
  knowledge: { folders: [] },
};

const activeRuns = new Map<string, RunControl>();

export async function startWorkflow(id: string, input = '', { trigger = 'manual' }: { trigger?: string } = {}): Promise<WorkflowRun> {
  const wf: Workflow | null = workflows.get(id);
  if (!wf) throw new Error('No such workflow.');
  if (!wf.steps?.length) throw new Error('This workflow has no steps yet.');
  const run = runs.save({
    id: uid('w'),
    workflowId: wf.id,
    workflowName: wf.name,
    input,
    trigger,
    status: 'running',
    steps: wf.steps.map((s) => ({ id: s.id, label: s.label || s.type, type: s.type, status: 'waiting', output: '', agentId: s.agentId ?? null })),
  });
  log('workflow', `Started workflow "${wf.name}" (${trigger})`);
  const ac = new AbortController();
  const ctl: RunControl = { stopped: false, signal: ac.signal, abort: () => ac.abort() };
  activeRuns.set(run.id, ctl);
  // the run stays in this project (its record, agents and tool calls) if you open another one meanwhile
  const project = activeProject();
  withProject(project, () => execute(wf, run, ctl)).finally(() => activeRuns.delete(run.id));
  return run;
}

/** The ids of workflow runs going right now (every project's). */
export const runningWorkflowRuns = (): string[] => [...activeRuns.keys()];

export function stopWorkflowRun(runId: string): boolean {
  const ctl = activeRuns.get(runId);
  if (ctl) {
    ctl.stopped = true;
    ctl.abort();
  }
  cancelForRun(runId); // a waiting checkpoint
  stopChildren(runId); // a running agent step
  return !!ctl;
}

// Runs that were going when the dashboard stopped can't continue (in every project, not only the open one).
export function markInterruptedRuns() {
  for (const p of listProjects()) {
    withProject(p, () => {
      for (const r of runs.list()) {
        if (r.status !== 'running') continue;
        r.status = 'stopped';
        r.error = 'The dashboard was closed while this ran.';
        for (const st of r.steps) if (st.status === 'running' || st.status === 'needs-you') st.status = 'failed';
        runs.save(r);
      }
    });
  }
}

async function execute(wf: Workflow, run: WorkflowRun, ctl: RunControl) {
  const values: Record<string, unknown> = { input: run.input, prev: run.input, date: new Date().toLocaleDateString(), workflow: wf.name };
  const save = () => {
    runs.save(run);
    emit('workflow-run', { id: run.id, run: runSummary(run) });
  };
  try {
    for (let i = 0; i < wf.steps.length; i++) {
      if (ctl.stopped) throw new Error('Stopped.');
      const step = wf.steps[i];
      const st = run.steps[i];
      st.status = 'running';
      st.startedAt = Date.now();
      save();
      let output: unknown = '';
      if (step.type === 'agent') {
        const agent = agentStore.get(step.agentId);
        if (!agent) throw new Error(`Step ${i + 1}: the agent no longer exists.`);
        const prompt = renderTemplate(step.prompt || '{{prev}}', values);
        st.agentName = agent.name;
        output = await askAgent(agent, prompt, { depth: 1, from: `workflow "${wf.name}"`, title: `Workflow: ${wf.name}`, parentRunId: run.id, signal: ctl.signal, extra: wf.access || null });
      } else if (step.type === 'tool') {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(renderTemplate(step.args || '{}', jsonSafe(values))) as Record<string, unknown>;
        } catch (e) {
          throw new Error(`Step ${i + 1}: the tool arguments are not valid JSON after filling in values (${(e as Error).message}).`);
        }
        const r = await callTool(WORKFLOW_AGENT, step.tool as string, args, { runId: run.id, depth: 1, signal: ctl.signal });
        if (r.isError) throw new Error(`Step ${i + 1} (${step.tool}): ${r.text}`);
        output = r.text;
        st.images = r.images;
      } else if (step.type === 'approval') {
        st.status = 'needs-you';
        save();
        const d = await requestApproval({
          kind: 'workflow',
          title: `${wf.name}: ${step.label || 'check this before it continues'}`,
          detail: renderTemplate(step.message || '{{prev}}', values),
          editable: values.prev,
          data: { runId: run.id, workflowId: wf.id },
        });
        if (!d.approved) throw new Error(`You stopped it at step ${i + 1}${d.message ? `: ${d.message}` : ''}.`);
        output = d.edited ?? values.prev;
      } else if (step.type === 'x_post') {
        const text = renderTemplate(step.text || '{{prev}}', values).trim();
        const parts = step.thread ? text.split(/\n-{3,}\n/).map((s) => s.trim()).filter(Boolean) : null;
        const r = await draftPost({ platform: 'x', account: step.account as string | undefined, text, thread: parts, agentName: `Workflow: ${wf.name}`, note: `From workflow "${wf.name}"` });
        output = r.status === 'posted' ? `Posted: ${r.url}` : `In the Outbox for approval (${r.id}).`;
      } else if (step.type === 'notify') {
        const r = await callTool(WORKFLOW_AGENT, 'notify_user', { text: renderTemplate(step.text || '{{prev}}', values), telegram: !!step.telegram }, { runId: run.id });
        output = r.text;
      } else throw new Error(`Unknown step type ${step.type}`);
      // A stopped agent answers normally (with nothing), so check again before calling the step done.
      if (ctl.stopped) throw new Error('Stopped.');
      st.output = String(output ?? '');
      st.status = 'done';
      st.finishedAt = Date.now();
      values.prev = st.output;
      values[`step${i + 1}`] = st.output;
      save();
    }
    if (ctl.stopped) throw new Error('Stopped.');
    run.status = 'done';
    run.output = values.prev;
    log('workflow', `Workflow "${wf.name}" finished`);
  } catch (e) {
    // stopped: the whole run, or the agent working on the current step
    run.status = ctl.stopped || e instanceof RunStopped ? 'stopped' : 'failed';
    run.error = (e as Error).message;
    const cur = run.steps.find((s) => s.status === 'running' || s.status === 'needs-you');
    if (cur) {
      cur.status = 'failed';
      cur.output = (e as Error).message;
    }
    log('error', `Workflow "${wf.name}" ${run.status}: ${(e as Error).message}`);
  }
  run.finishedAt = Date.now();
  save();
}

// What the Station needs to light up a branch.
export function runSummary(r: WorkflowRun): RunSummary {
  return { id: r.id, workflowId: r.workflowId, status: r.status, steps: r.steps.map((s) => ({ status: s.status, label: s.label, agentId: typeof s.agentId === 'string' ? s.agentId : null })), error: r.error || null };
}

// Values pasted into JSON need escaping.
function jsonSafe(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) out[k] = JSON.stringify(String(v ?? '')).slice(1, -1);
  return out;
}

// ---------- scheduling ----------
// Also used for routines: anything with a schedule, an on switch and when it last ran.
export function due(wf: { schedule?: WorkflowSchedule; enabled?: boolean; lastScheduledAt?: number }, now: number): boolean {
  const s = wf.schedule;
  if (!wf.enabled || !s || s.type === 'none') return false;
  const last = wf.lastScheduledAt || 0;
  if (s.type === 'interval') return now - last >= Math.max(5, Number(s.minutes) || 60) * 60_000;
  if (s.type === 'daily') {
    const [h, m] = String(s.time || '09:00').split(':').map(Number);
    const target = new Date(now);
    target.setHours(h, m || 0, 0, 0);
    const days = s.days?.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
    return days.includes(target.getDay()) && now >= target.getTime() && last < target.getTime() && now - target.getTime() < 60 * 60_000;
  }
  return false;
}

export function startScheduler() {
  setInterval(() => {
    const now = Date.now();
    for (const wf of workflows.list() as Workflow[]) {
      if (!due(wf, now)) continue;
      wf.lastScheduledAt = now;
      workflows.save(wf);
      // a step list runs its steps; a team gets its routine message in the team chat
      if (isStepList(wf)) {
        startWorkflow(wf.id, wf.schedule!.input || '', { trigger: 'schedule' }).catch((e: unknown) => log('error', `Scheduled workflow "${wf.name}": ${(e as Error).message}`));
        continue;
      }
      const team = normalize(wf);
      postUserMessage(team.id, wf.schedule!.input || `Scheduled check-in: ${team.description || 'do your routine work'}`, { route: pickMember }).catch((e: unknown) => log('error', `Scheduled team "${wf.name}": ${(e as Error).message}`));
    }
  }, 30_000).unref();
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    name: 'Daily X post',
    description: 'Research a topic, write a post in your voice, you approve, it goes to the Outbox.',
    needs: ['Researcher', 'X Writer'],
    steps: [
      { type: 'agent', agent: 'Researcher', label: 'Research', prompt: 'Find the 3 most interesting things that happened in the last few days about: {{input}}. Give links.' },
      { type: 'agent', agent: 'X Writer', label: 'Write', prompt: 'Write ONE post for X (under 280 characters) based on this research. Reply with only the post text, nothing else.\n\n{{prev}}' },
      { type: 'approval', label: 'Approve the post', message: '{{prev}}' },
      { type: 'x_post', label: 'Send to Outbox', text: '{{prev}}' },
    ],
    schedule: { type: 'daily', time: '09:00', input: 'AI agents' },
  },
  {
    name: 'Prompt to image',
    description: 'An agent turns a rough idea into a detailed prompt and runs your ComfyUI workflow.',
    needs: ['Image Maker'],
    steps: [{ type: 'agent', agent: 'Image Maker', label: 'Make the image', prompt: 'Make an image of: {{input}}. Pick the best workflow and write a detailed prompt.' }],
  },
  {
    name: 'Research brief',
    description: 'Research, then save a markdown brief to the workspace and ping you.',
    needs: ['Researcher'],
    steps: [
      { type: 'agent', agent: 'Researcher', label: 'Research', prompt: 'Research {{input}} and write a one-page markdown brief with sources. Save it with write_file as brief.md and tell me the path.' },
      { type: 'notify', label: 'Tell me', text: 'Brief ready: {{prev}}' },
    ],
  },
];

export function createFromTemplate(name: string): Team {
  const t = TEMPLATES.find((x) => x.name === name);
  if (!t) throw new Error('Unknown template');
  const all = agentStore.list();
  const steps = t.steps.map((s) => {
    const { agent, ...rest } = s;
    const match = agent ? all.find((a) => a.name.toLowerCase() === agent.toLowerCase()) : null;
    return { id: uid('s'), ...rest, ...(agent ? { agentId: match?.id || '' } : {}) };
  });
  return workflows.save({ id: uid('wf'), name: t.name, description: t.description, steps, schedule: t.schedule || { type: 'none' }, enabled: false });
}
