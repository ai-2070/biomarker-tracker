// The history of skills, agents, teams and MEMORY.md files: their kept versions as readable text, putting
// one back, and bringing back deleted ones. (Versions are kept by store.ts, skills.ts and memory.ts; see versions.ts.)
import { agents, workflows, log } from './store.ts';
import { memoryTitle, memoryVersionsDir, readMemory, writeMemory, isMemoryOwner } from './memory.ts';
import type { MemoryVersionItem } from './memory.ts';
import { getSkill, restoreSkill, skillVersionsDir } from './skills.ts';
import type { SkillVersionItem } from './skills.ts';
import { listVersions, getVersion, changedFields, deletedIn, withActor } from './versions.ts';
import type { Version } from './versions.ts';
import type { Agent, DeletedItem, Team, VersionDetail, VersionEntry, VersionHistory, VersionKind } from '../shared/types.ts';

type Item = Agent | Team | SkillVersionItem | MemoryVersionItem;
const notFound = (msg: string) => Object.assign(new Error(msg), { status: 404 });
export const VERSION_KINDS: VersionKind[] = ['skill', 'agent', 'team', 'memory'];
export const isVersionKind = (k: unknown): k is VersionKind => VERSION_KINDS.includes(k as VersionKind);

// Each kind: where its versions are, what it is now, and the fields that don't count.
function kindOf(kind: VersionKind) {
  if (kind === 'agent') return { dir: (id = '') => agents.versionsDir(id)!, now: (id: string): Item | null => agents.get(id), ignore: agents.versionIgnore, label: 'agent' };
  if (kind === 'team') return { dir: (id = '') => workflows.versionsDir(id)!, now: (id: string): Item | null => workflows.get(id), ignore: workflows.versionIgnore, label: 'team' };
  // (a memory is never deleted: one never written is just empty)
  if (kind === 'memory') return { dir: (id = '') => memoryVersionsDir(id), now: (id: string): Item | null => (isMemoryOwner(id) ? { name: memoryTitle(id), text: readMemory(id) } : null), ignore: ['name'] as readonly string[], label: 'memory' };
  return {
    dir: (id = '') => skillVersionsDir(id),
    now: (id: string): Item | null => {
      const s = getSkill(id);
      return s ? { slug: s.slug, name: s.name, description: s.description, body: s.body.trim() } : null;
    },
    ignore: ['files', 'filesHash'] as readonly string[],
    label: 'skill',
  };
}
const okId = (id: string) => /^[\w.-]+$/.test(String(id)) && !id.startsWith('.');

// ---------- as text ----------
const FIELD_NAMES: Record<string, string> = {
  systemPrompt: 'instructions',
  body: 'instructions',
  toolGroups: 'tools',
  mcpServers: 'MCP servers',
  alwaysAllow: 'always allowed',
  claudeAuth: 'sign-in',
  hermesProfile: 'Hermes profile',
  openclawAgent: 'OpenClaw agent',
  knowledge: 'knowledge',
  steps: 'steps',
  lead: 'lead',
  text: 'notes',
};
const fieldName = (kind: VersionKind, k: string) => (kind === 'team' && k === 'description' ? 'goal' : kind === 'skill' && k === 'description' ? 'when to use it' : FIELD_NAMES[k] || k);

const agentName = (id: string) => agents.get(id)?.name || `(deleted agent ${id})`;
const skillName = (slug: string) => getSkill(slug)?.name || slug;
// (a version can come from elsewhere: never trust a field's type when turning it into text)
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const text = (x: unknown): string => (typeof x === 'string' ? x : x === undefined || x === null ? '' : JSON.stringify(x));
const list = (xs: unknown) => (Array.isArray(xs) && xs.length ? xs.join(', ') : '-');

// Anything a version has that the lines above don't show, so a change is never invisible.
function otherFields(item: Record<string, unknown>, shown: readonly string[], ignore: readonly string[]): string {
  const rest = Object.keys(item)
    .filter((k) => !shown.includes(k) && !ignore.includes(k) && k !== 'id' && item[k] !== undefined && item[k] !== null && item[k] !== '' && !(Array.isArray(item[k]) && !(item[k] as unknown[]).length))
    .sort();
  return rest.length ? `Other settings:\n${rest.map((k) => `  ${k}: ${JSON.stringify(item[k])}`).join('\n')}` : '';
}

const AGENT_SHOWN = ['name', 'emoji', 'specialty', 'description', 'engine', 'model', 'provider', 'claudeAuth', 'hermesProfile', 'openclawAgent', 'temperature', 'effort', 'autonomy', 'toolGroups', 'mcpServers', 'skills', 'knowledge', 'workspace', 'alwaysAllow', 'systemPrompt'];
const TEAM_SHOWN = ['name', 'description', 'members', 'lead', 'access', 'skills', 'files', 'schedule', 'enabled', 'steps'];

// One step of an old-style step list (or a member's step), with everything that changes what it does.
function stepLine(st: Record<string, unknown>, i: number): string {
  const { id: _id, type, agentId, label, prompt, ...rest } = st;
  const head = `  ${i + 1}. ${String(type || 'step')}${agentId ? ` ${agentName(String(agentId))}` : ''}${label ? ` "${String(label)}"` : ''}`;
  const extra = Object.keys(rest)
    .filter((k) => rest[k] !== undefined && rest[k] !== '' && rest[k] !== null)
    .sort()
    .map((k) => `${k}: ${typeof rest[k] === 'string' ? rest[k] : JSON.stringify(rest[k])}`);
  return [head, prompt ? `     prompt: ${String(prompt)}` : '', ...extra.map((x) => `     ${x}`)].filter(Boolean).join('\n');
}

export function asText(kind: VersionKind, item: Item): string {
  if (kind === 'memory') return text((item as MemoryVersionItem).text).trim() || '(empty)';
  if (kind === 'skill') {
    const s = item as SkillVersionItem;
    return [`Name: ${s.name}`, `When to use it: ${s.description}`, s.files?.length ? `Extra files: ${s.files.join(', ')}` : '', '', s.body.trim()].filter((x, i) => x || i === 3).join('\n');
  }
  if (kind === 'agent') {
    const a = item as Agent;
    return [
      `Name: ${a.emoji || ''} ${a.name}`.replace(/ +/g, ' '),
      `Specialty: ${a.specialty || '-'}`,
      a.description ? `Description: ${a.description}` : '',
      `Runs on: ${a.engine}${a.model ? ` (${a.model})` : ''}${a.engine === 'hermes' && a.hermesProfile ? `, profile ${a.hermesProfile}` : ''}${a.engine === 'openclaw' && a.openclawAgent ? `, OpenClaw agent ${a.openclawAgent}` : ''}`,
      a.provider ? `Provider: ${a.provider}` : '',
      a.claudeAuth ? `Sign-in: ${a.claudeAuth}` : '',
      `Temperature: ${a.temperature === '' || a.temperature === undefined ? 'default' : a.temperature}`,
      `Effort: ${a.effort || 'default'}`,
      `Autonomy: ${a.autonomy || 'ask'}`,
      `Tools: ${list(a.toolGroups)}`,
      `MCP servers: ${list(a.mcpServers)}`,
      `Skills: ${list(arr(a.skills).map((x) => skillName(String(x))))}`,
      `Knowledge folders: ${list(a.knowledge?.folders)}`,
      `Workspace: ${a.workspace || '(default)'}`,
      `Always allowed: ${list(a.alwaysAllow)}`,
      otherFields(a as unknown as Record<string, unknown>, AGENT_SHOWN, agents.versionIgnore),
      '',
      'Instructions:',
      text(a.systemPrompt).trim() || '(none)',
    ]
      .filter((x, i, all) => x || all[i + 1] === 'Instructions:')
      .join('\n');
  }
  const t = item as Team;
  const allSteps = arr(t.steps).filter((x): x is Team['steps'][number] => !!x && typeof x === 'object');
  const members = Array.isArray(t.members) ? t.members.map(String) : [...new Set(allSteps.filter((x) => x.type === 'agent' && x.agentId).map((x) => String(x.agentId)))];
  const sc = t.schedule;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const schedule = sc && sc.type !== 'none'
    ? [
        `Schedule: ${text(sc.type)}${sc.time ? ` at ${text(sc.time)}` : ''}${sc.minutes ? ` every ${text(sc.minutes)} min` : ''}${arr(sc.days).length ? ` on ${arr(sc.days).map((d) => DAYS[d as number] ?? text(d)).join(', ')}` : ''}${t.enabled === false ? ' (off)' : ''}`,
        sc.input ? `  with: ${sc.input}` : '',
      ].filter(Boolean).join('\n')
    : t.enabled ? 'Schedule: none (on)' : '';
  // members' steps carry nothing beyond the member; any other step (or a member step with more) is listed in full
  const steps = allSteps.filter((x) => x.type !== 'agent' || Object.keys(x).some((k) => !['id', 'type', 'agentId', 'label'].includes(k) && x[k] !== undefined && x[k] !== ''));
  return [
    `Name: ${t.name}`,
    `Goal: ${t.description || '-'}`,
    `Members: ${list(members.map((id) => `${agentName(id)}${t.lead === id ? ' (lead)' : ''}`))}`,
    `Tools: ${list(t.access?.toolGroups)}`,
    `MCP servers: ${list(t.access?.mcpServers)}`,
    `Skills: ${list(arr(t.skills).map((x) => skillName(String(x))))}`,
    `Files: ${list(t.files)}`,
    schedule,
    steps.length ? `Steps:\n${steps.map((x, i) => stepLine(x as Record<string, unknown>, i)).join('\n')}` : '',
    otherFields(t as unknown as Record<string, unknown>, TEAM_SHOWN, workflows.versionIgnore),
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------- history ----------
const entry = (kind: VersionKind, v: Version<Item>, newer: Item | null, ignore: readonly string[]): VersionEntry => ({
  id: v.id,
  at: v.at,
  by: v.by,
  ...(v.deleted ? { deleted: true } : {}),
  ...(v.note ? { note: v.note } : {}),
  changes: newer ? changedFields(v.item, newer, ignore).map((k) => fieldName(kind, k)) : v.deleted ? ['deleted'] : [],
});

// What version i turned into: the next newer version's item, or what it is now (nothing: it was deleted).
const newerThan = (versions: Version<Item>[], i: number, now: Item | null): Item | null => (i > 0 ? versions[i - 1].item : now);

export function historyOf(kind: VersionKind, id: string): VersionHistory {
  if (!okId(id)) throw notFound('Nothing by that id.');
  const k = kindOf(kind);
  const now = k.now(id);
  const versions = listVersions<Item>(k.dir(id));
  if (!now && !versions.length) throw notFound(`No ${k.label} by that id.`);
  // each version's changes: what the one after it (the next newer, or the current) is different in.
  // (a deletion's version holds what it was when it was deleted, so it's what the older one became)
  const entries = versions.map((v, i) => entry(kind, v, newerThan(versions, i, now), k.ignore));
  return { kind, id, name: String((now || versions[0].item).name || id), current: now ? asText(kind, now) : null, versions: entries };
}

export function versionOf(kind: VersionKind, id: string, vid: string): VersionDetail {
  if (!okId(id)) throw notFound('Nothing by that id.');
  const k = kindOf(kind);
  const versions = listVersions<Item>(k.dir(id));
  const i = versions.findIndex((v) => v.id === vid);
  if (i === -1) throw notFound('That version is gone.');
  const v = versions[i];
  return { ...entry(kind, v, newerThan(versions, i, k.now(id)), k.ignore), name: String(v.item.name || id), text: asText(kind, v.item) };
}

/** Put a version back. The current one is kept as a version first, so this can be undone too. */
export function restoreVersion(kind: VersionKind, id: string, vid: string): { name: string } {
  if (!okId(id)) throw notFound('Nothing by that id.');
  const k = kindOf(kind);
  const v = getVersion<Item>(k.dir(id), vid);
  if (!v) throw notFound('That version is gone.');
  const when = new Date(v.at).toLocaleString();
  return withActor(
    'you',
    () => {
      if (kind === 'agent') {
        const now = agents.get(id);
        // what isn't part of a version stays as it is now
        const a = agents.save({ ...(v.item as Agent), id, pinned: now?.pinned ?? (v.item as Agent).pinned, lastModel: now?.lastModel, lastModelAt: now?.lastModelAt });
        log('agent', `${now ? 'Restored an earlier version of' : 'Brought back'} the agent ${a.name}`, { agentId: id });
        return { name: a.name };
      }
      if (kind === 'team') {
        const now = workflows.get(id);
        // (where it sits on the map and when its schedule last ran stay as they are now: an older
        // lastScheduledAt would make an interval schedule run again right away)
        const keep = now ? { pos: now.pos, rot: now.rot, angle: now.angle, lastScheduledAt: (now as Team & { lastScheduledAt?: number }).lastScheduledAt } : {};
        const t = workflows.save({ ...(v.item as Team), id, ...keep });
        log('team', `${now ? 'Restored an earlier version of' : 'Brought back'} the team ${t.name}`);
        return { name: t.name };
      }
      if (kind === 'memory') {
        const name = memoryTitle(id);
        writeMemory(id, text((v.item as MemoryVersionItem).text));
        log('memory', `Restored an earlier version of ${name}`, id === 'brain' ? {} : { agentId: id });
        return { name };
      }
      const had = getSkill(id);
      const s = restoreSkill({ ...(v.item as SkillVersionItem), slug: id }, v.id);
      log('skill', `${had ? 'Restored an earlier version of' : 'Brought back'} the skill "${s?.name || id}"`);
      return { name: s?.name || id };
    },
    { force: true, note: `replaced by the version from ${when}` },
  );
}

/** What was deleted and can come back (in this project for agents and teams; every skill). */
export function deletedItems(kind: VersionKind): DeletedItem[] {
  if (kind === 'memory') return [];
  const k = kindOf(kind);
  return deletedIn<Item>(k.dir(), (id) => k.now(id) !== null).map(({ id, version }) => ({ kind, id, name: String(version.item.name || id), at: version.at, by: version.by }));
}

/** Bring a deleted one back as it was when it was deleted. */
export function undelete(kind: VersionKind, id: string): { name: string } {
  const k = kindOf(kind);
  if (!okId(id)) throw notFound('Nothing by that id.');
  if (k.now(id)) throw Object.assign(new Error(`That ${k.label} isn't deleted.`), { status: 409 });
  const last = listVersions<Item>(k.dir(id))[0];
  if (!last?.deleted) throw notFound(`No deleted ${k.label} by that id.`);
  return restoreVersion(kind, id, last.id);
}
