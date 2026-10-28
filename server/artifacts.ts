// Artifacts: what an agent or team finished that isn't an outgoing post or email (a written result, a file, a folder).
import fs from 'node:fs';
import path from 'node:path';
import { agents, artifacts, chats, emit, log } from './store.ts';
import { listTeams } from './teams.ts';
import { viewable } from './files.ts';
import { uid } from './util.ts';
import type { Artifact } from '../shared/types.ts';

const TEXT_MAX = 200_000;

/** The kind and real path of a file or folder an agent hands in, or an error saying what is wrong with it. */
export function checkTarget(raw: unknown): { kind: 'file' | 'folder'; path: string } {
  const real = viewable(raw);
  if (!real) throw new Error(`${String(raw)} is not a file or folder in this project's folders, so it can't be saved as an artifact.`);
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    throw new Error(`${path.basename(real)} isn't there.`);
  }
  return { kind: st.isDirectory() ? 'folder' : 'file', path: real };
}

/** The team a run was for: the team chat it runs in, else the agent's team when it is on exactly one. */
export function teamOf(agentId: string, chatId?: string | null): { id: string; name: string } | null {
  const chatTeam = chatId ? chats.get(agentId, chatId)?.teamId : null;
  // (teams as they read now: an old step list gets its members from its agent steps)
  const teams = listTeams();
  const team = (chatTeam && teams.find((t) => t.id === chatTeam)) || (() => {
    const mine = teams.filter((t) => t.members.includes(agentId));
    return mine.length === 1 ? mine[0] : null;
  })();
  return team ? { id: team.id, name: team.name } : null;
}

export interface ArtifactInput {
  title: string;
  path?: string;
  text?: string;
  note?: string;
  agentId?: string | null;
  chatId?: string | null;
  /** who made it when it isn't an agent (the activity feed's words), e.g. "You" */
  by?: string;
}

export function addArtifact({ title, path: target, text, note = '', agentId = null, chatId = null, by }: ArtifactInput): Artifact {
  const name = String(title || '').trim().slice(0, 120);
  if (!name) throw new Error('Give the artifact a title.');
  if (!target && !String(text || '').trim()) throw new Error('Give a path to a file or folder, or the text of the result.');
  const body: Partial<Artifact> = target ? checkTarget(target) : { kind: 'text', text: String(text).slice(0, TEXT_MAX) };
  const agent = agentId ? agents.get(agentId) : null;
  const team = agentId ? teamOf(agentId, chatId) : null;
  const item = artifacts.save({
    id: uid('a'),
    title: name,
    ...(body as Pick<Artifact, 'kind'>),
    ...(note ? { note: String(note).slice(0, 500) } : {}),
    agentId,
    agentName: agent?.name || '',
    teamId: team?.id || null,
    teamName: team?.name || '',
  });
  log('artifact', `${agent?.name || by || 'Someone'} ${agent || !by ? 'finished' : 'saved'} "${name}"${team ? ` for ${team.name}` : ''}`, { agentId });
  emit('artifacts');
  return item;
}

export function removeArtifact(id: string): void {
  artifacts.remove(id);
  emit('artifacts');
}
