// Presets: save an agent or a whole team (with its agents) as a reusable template, kept in
// data/presets and available in every project. Clone: copy an agent or a team in this project.
import path from 'node:path';
import { agents, workflows, log } from './store.ts';
import { dataPath, ensureDir, readJSON, writeJSON, listFiles, uid } from './util.ts';
import { newAgent } from './library.ts';
import { getTeam, isStepList } from './teams.ts';
import fs from 'node:fs';
import type { Agent, PresetListing, Team } from '../shared/types.ts';

/** An agent without what belongs to one copy of it (id, dates, last model, pin, workspace, _fields). */
export type AgentTemplate = Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'lastModel' | 'lastModelAt' | 'pinned' | 'workspace' | '_teamSkills'>;
/** The parts of a team a preset keeps (members are saved separately). */
export type TeamTemplate = Partial<Pick<Team, 'name' | 'description' | 'color' | 'access' | 'skills' | 'schedule'>>;

/** data/presets/<id>.json */
export interface AgentPreset {
  id: string;
  kind: 'agent';
  name: string;
  description: string;
  savedAt: number;
  agent: AgentTemplate;
}
export interface TeamPreset {
  id: string;
  kind: 'team';
  name: string;
  description: string;
  savedAt: number;
  team: TeamTemplate;
  members: AgentTemplate[];
  leadIndex: number;
}
export type Preset = AgentPreset | TeamPreset;

const DIR = () => ensureDir(dataPath('presets'));
const RUNTIME_FIELDS = ['id', 'createdAt', 'updatedAt', 'lastModel', 'lastModelAt', 'pinned', 'workspace'];
const agentTemplate = (a: Partial<Agent>): AgentTemplate => Object.fromEntries(Object.entries(a).filter(([k]) => !RUNTIME_FIELDS.includes(k) && !k.startsWith('_'))) as AgentTemplate;
const TEAM_FIELDS = ['name', 'description', 'color', 'mark', 'access', 'skills', 'schedule'] as const;
const teamTemplate = (t: Partial<Team>): TeamTemplate => Object.fromEntries(TEAM_FIELDS.filter((k) => t[k] !== undefined).map((k) => [k, structuredClone(t[k])])) as TeamTemplate;

export function listPresets(): PresetListing[] {
  return listFiles(DIR(), (n) => n.endsWith('.json'))
    .map((n) => readJSON<Preset>(path.join(DIR(), n)))
    .filter((p): p is Preset => Boolean(p))
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      description: p.description || '',
      emoji: p.kind === 'agent' ? p.agent?.emoji || '🤖' : null,
      color: p.kind === 'team' ? p.team?.color || null : p.agent?.color || null,
      members: p.kind === 'team' ? p.members.map((m) => ({ name: m.name, emoji: m.emoji })) : null,
      lead: p.kind === 'team' && p.leadIndex >= 0 ? p.members[p.leadIndex]?.name : null,
      skills: p.kind === 'team' ? p.team?.skills || [] : p.agent?.skills || [],
      savedAt: p.savedAt,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveAgentPreset(agentId: string, { name }: { name?: string } = {}): AgentPreset {
  const a = agents.get(agentId);
  if (!a) throw new Error('No such agent.');
  const p: AgentPreset = { id: uid('pa'), kind: 'agent', name: String(name || a.name).slice(0, 80), description: a.specialty || '', savedAt: Date.now(), agent: agentTemplate(a) };
  writeJSON(path.join(DIR(), `${p.id}.json`), p);
  log('preset', `Saved ${a.name} as a preset`);
  return p;
}

export function saveTeamPreset(teamId: string, { name }: { name?: string } = {}): TeamPreset {
  const t = getTeam(teamId); // an old step list gets its members from its agent steps
  if (!t) throw new Error('No such team.');
  const ids = t.members;
  const p: TeamPreset = {
    id: uid('pt'),
    kind: 'team',
    name: String(name || t.name).slice(0, 80),
    description: t.description || '',
    savedAt: Date.now(),
    team: teamTemplate(t),
    members: ids.map((id) => agentTemplate(agents.get(id)!)),
    leadIndex: ids.indexOf(t.lead as string),
  };
  writeJSON(path.join(DIR(), `${p.id}.json`), p);
  log('preset', `Saved the team ${t.name} (${ids.length} agents) as a preset`);
  return p;
}

export function deletePreset(id: string) {
  if (!/^p[at][\w-]+$/.test(String(id))) throw new Error('No such preset.');
  fs.rmSync(path.join(DIR(), `${id}.json`), { force: true });
}

// Make it in the current project: a new agent, or a new team with new agents.
export function usePreset(id: string): { agent: Agent } | { team: Team; agents: Agent[] } {
  const p = readJSON<Preset>(path.join(DIR(), `${path.basename(String(id))}.json`), null);
  if (!p) throw new Error('No such preset.');
  if (p.kind === 'agent') {
    // (an imported preset may carry an id or other per-copy fields: never reuse them)
    const a = newAgent({ ...agentTemplate(structuredClone(p.agent)), source: { type: 'preset', preset: p.id } });
    log('preset', `Created ${a.name} from a preset`, { agentId: a.id });
    return { agent: a };
  }
  const made = p.members.map((m) => newAgent({ ...agentTemplate(structuredClone(m)), source: { type: 'preset', preset: p.id } }));
  const team = workflows.save({
    ...teamTemplate(p.team),
    members: made.map((a) => a.id),
    steps: made.map((a) => ({ type: 'agent', agentId: a.id })),
    lead: p.leadIndex >= 0 ? made[p.leadIndex]?.id || null : null,
    schedule: p.team.schedule || { type: 'none' },
    enabled: false,
  });
  log('preset', `Created the team ${team.name} from a preset (${made.length} agents)`);
  return { team, agents: made };
}

// Copy a team in this project. withAgents: its members are copied too (otherwise the copy shares them).
export function cloneTeam(teamId: string, { withAgents = false }: { withAgents?: boolean } = {}): Team {
  const t = getTeam(teamId); // an old step list gets its members from its agent steps
  if (!t) throw new Error('No such team.');
  let members = t.members;
  let lead = t.lead;
  let swap = (id: string) => id;
  if (withAgents) {
    const map = new Map(members.map((id) => [id, newAgent({ ...agentTemplate(agents.get(id)!), name: `${agents.get(id)!.name} (copy)` })]));
    swap = (id) => map.get(id)?.id || id;
    members = members.map(swap);
    lead = t.lead ? map.get(t.lead)?.id || null : null;
  }
  const copy = workflows.save({
    ...teamTemplate(t),
    name: `${t.name} (copy)`,
    members,
    // a step list keeps its steps (tools, approvals, posts), pointing at the copied agents
    steps: isStepList(t) ? t.steps.map((s) => ({ ...structuredClone(s), ...(s.agentId ? { agentId: swap(s.agentId) } : {}) })) : members.map((id) => ({ type: 'agent', agentId: id })),
    lead,
    schedule: { type: 'none' },
    enabled: false,
  });
  log('team', `Cloned the team ${t.name}${withAgents ? ' with copies of its agents' : ''}`);
  return copy;
}
