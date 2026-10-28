// Backups on the page: back up the open project (with every skill and preset) into the backups
// folder, read what a backup file holds, and restore one as a new project.
import { h, GET, POST, api, attempt, modal, copy, ago } from './core.ts';
import { icon } from './icons.ts';
import type { Project } from '../shared/types.ts';

export const BACKUP_EXT = '.dashbackup';

/** The second line of a backup file (server/backup.ts BackupSummary). */
export interface BackupSummary {
  app: string;
  format: number;
  createdAt: number;
  name: string;
  description: string;
  agents: number;
  teams: number;
  routines: number;
  chats: number;
  skills: number;
  presets: number;
  knowledgeFiles: number;
  agentList: { name: string; emoji: string }[];
  /** MEMORY.md files (older backups: missing) */
  memories?: number;
  /** Files left out because a size limit was reached (older backups: missing) */
  omitted?: number;
  /** Kept versions of agents, teams and skills (older backups: missing) */
  versions?: number;
  /** Prefabs in the prefab library (older backups: missing) */
  libraryPrefabs?: number;
}

/** GET /api/backups */
export interface BackupListing {
  name: string;
  size: number;
  modifiedAt: number;
  summary: BackupSummary | null;
}

/** What POST /api/backups/restore says it brought back. */
export interface BackupRestored {
  agents: number;
  teams: number;
  routines: number;
  chats: number;
  knowledgeFiles: number;
  brainFiles: number;
  skills: { added: number; same: number; renamed: { from: string; to: string }[] };
  presets: { added: number; same: number };
  /** kept versions brought back (older servers: missing) */
  versions?: number;
  /** MEMORY.md files brought back (older servers: missing) */
  memories?: number;
  /** prefab library entries added (older servers: missing) */
  libraryPrefabs?: { added: number; same: number };
  paused: number;
  logo: boolean;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const fileSize = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** "3 agents · 1 team · 2 skills": what a backup holds, in one line. */
export function summaryLine(s: BackupSummary): string {
  return [plural(s.agents, 'agent'), plural(s.teams, 'team'), s.routines ? plural(s.routines, 'routine') : '', s.chats ? plural(s.chats, 'chat') : '', plural(s.skills, 'skill'), s.presets ? plural(s.presets, 'preset') : '', s.libraryPrefabs ? plural(s.libraryPrefabs, 'library prefab') : '', s.memories ? plural(s.memories, 'MEMORY.md file') : '', s.versions ? plural(s.versions, 'earlier version') : ''].filter(Boolean).join(' · ');
}

/** The summary in a backup file's first lines, or null when it isn't a backup. Reads only the start of the file. */
export async function readBackupSummary(file: Blob): Promise<BackupSummary | null> {
  const text = await file.slice(0, 64 * 1024).text();
  const lines = text.split('\n');
  if (!/^MY-DASHBOARD-BACKUP \d+$/.test(lines[0]?.trim() || '') || lines.length < 3) return null;
  try {
    return cleanSummary(JSON.parse(lines[1]));
  } catch {
    return null;
  }
}

/** A summary the page can show safely, or null: the file is anyone's, so every field is checked. */
export function cleanSummary(v: unknown): BackupSummary | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (s.app !== 'my-dashboard') return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
  return {
    app: 'my-dashboard',
    format: num(s.format),
    createdAt: num(s.createdAt),
    name: str(s.name, 120),
    description: str(s.description, 6000),
    agents: num(s.agents),
    teams: num(s.teams),
    routines: num(s.routines),
    chats: num(s.chats),
    skills: num(s.skills),
    presets: num(s.presets),
    knowledgeFiles: num(s.knowledgeFiles),
    agentList: (Array.isArray(s.agentList) ? s.agentList : [])
      .filter((a): a is { name?: unknown; emoji?: unknown } => !!a && typeof a === 'object')
      .slice(0, 12)
      .map((a) => ({ name: str(a.name, 80), emoji: str(a.emoji, 8) || '🤖' })),
    omitted: num(s.omitted),
    memories: num(s.memories),
    versions: num(s.versions),
    libraryPrefabs: num(s.libraryPrefabs),
  };
}

/** Back up a project and show where the file went. */
export async function backupProject(p: Pick<Project, 'id' | 'name'>): Promise<void> {
  const r = await attempt(() => POST<{ file: string; name: string; size: number; summary: BackupSummary }>(`/projects/${encodeURIComponent(p.id)}/backup`));
  if (!r) return;
  const m = modal({
    title: 'Backup saved',
    narrow: true,
    body: h(
      'div',
      { class: 'flex flex-col gap-2.5' },
      h('p', `${p.name}: ${summaryLine(r.summary)}, in one file (${fileSize(r.size)}). No keys or passwords are in it.`),
      r.summary.omitted
        ? h('p', { class: 'm-0 flex items-start gap-1.5 rounded-[8px] border border-[color-mix(in_srgb,var(--color-amber)_30%,var(--color-line))] bg-amber/10 px-2.5 py-2 text-[13px] text-amber' }, icon('triangle-alert', 14, 'mt-0.5 flex-none'), ` ${r.summary.omitted} file${r.summary.omitted === 1 ? ' was' : 's were'} too big to fit and left out (limits: chats 200 MB, knowledge 50 MB, MEMORY.md files 20 MB, skills 50 MB, earlier versions 50 MB, PROJECT.md and notes 20 MB).`)
        : null,
      h('div', { class: 'flex items-center gap-2 rounded-[8px] border border-line bg-panel-2 px-2.5 py-2' }, h('code', { class: 'min-w-0 flex-1 font-mono text-[12px] leading-[normal] font-normal wrap-anywhere text-ink' }, r.file), h('button.icon-btn', { title: 'Copy the path', 'aria-label': 'Copy the path', onclick: () => copy(r.file) }, icon('copy', 14))),
      h('p.hint', 'To bring it back, here or on another PC: New project > From backup, and drop this file in.'),
    ),
    foot: [h('button.btn.ghost', { onclick: () => void attempt(() => POST('/backups/open')) }, icon('folder-open', 15), ' Show in folder'), h('button.btn', { onclick: () => m.close() }, 'Done')],
  });
}

/** Restore a backup as a new project: a dropped file, or the name of one in the backups folder. */
export async function restoreBackup(src: { file: File } | { listed: string }, opts: { name: string; folder: string; description: string }): Promise<Project & { restored: BackupRestored }> {
  const query = { name: opts.name || null, folder: opts.folder || null, description: opts.description || null, file: 'listed' in src ? src.listed : null };
  const data = await api<(Project & { restored: BackupRestored }) | null>('/backups/restore', { method: 'POST', raw: 'file' in src ? src.file : undefined, query });
  if (!data || !('restored' in data)) throw new Error('Restore failed: the dashboard gave no answer.');
  return data;
}

/** "Loaded 3 agents, 1 team and 2 new skills" */
export function restoredText(name: string, r: BackupRestored): string {
  const parts = [plural(r.agents, 'agent'), plural(r.teams, 'team')];
  if (r.routines) parts.push(plural(r.routines, 'routine'));
  if (r.skills.added) parts.push(plural(r.skills.added, 'new skill'));
  if (r.presets.added) parts.push(plural(r.presets.added, 'preset'));
  if (r.libraryPrefabs?.added) parts.push(plural(r.libraryPrefabs.added, 'library prefab'));
  if (r.memories) parts.push(plural(r.memories, 'MEMORY.md file'));
  if (r.versions) parts.push(plural(r.versions, 'earlier version'));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  let text = `Restored "${name}": ${list}.`;
  if (r.paused) text += ` ${plural(r.paused, 'schedule')} paused: turn them back on when you're ready.`;
  return text;
}

// the server reads these from files in the backups folder: anyone could have put one there
export const listBackups = () => GET<{ dir: string; backups: BackupListing[] }>('/backups').then((r) => ({ ...r, backups: r.backups.map((b) => ({ ...b, summary: cleanSummary(b.summary) })) }));
export const backupAgo = (s: BackupSummary | null, modifiedAt: number) => ago(s?.createdAt || modifiedAt);
