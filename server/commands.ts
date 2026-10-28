// The / commands you type in a chat (the list is in shared/commands.ts), done here for an agent's chat,
// a team's and the Brain chat: /resend, /resume, /loop, /goal, and /stop in the Brain chat.
// (/queue and /stop in agent and team chats are their own routes; /compact is the engines'.)
import fs from 'node:fs';
import path from 'node:path';
import { agents, chats, activeProject } from './store.ts';
import { HOME } from './util.ts';
import { workspaceOf } from './tools.ts';
import * as engines from './engines/index.ts';
import * as teams from './teams.ts';
import { listBriefs, openGoal } from './briefs.ts';
import { clearGoal, resumeBrief, setAgentGoal, setTeamGoal, stoppedBrief, stoppedBriefs } from './irc.ts';
import { stopAsks } from './overseer.ts';
import { pickMember } from './brain.ts';
import { COMMANDS, parseLoop } from '../shared/commands.ts';
import type { Agent, BrainBrief, Chat, LoopInfo } from '../shared/types.ts';

/** What a resumed turn says to the agent. */
export const RESUME_TEXT = 'Continue from where you stopped.';

const fail = (status: number, msg: string) => Object.assign(new Error(msg), { status });

function agentChat(agentId: string, chatId: string): { agent: Agent; chat: Chat } {
  const agent = agents.get(agentId);
  const chat = agent ? chats.get(agent.id, chatId) : null;
  if (!agent || !chat) throw fail(404, 'Not found');
  return { agent, chat };
}

// ---------- in an agent's chat ----------
/** /resend: your last message (with its files) again, now or once the agent is done. */
export function resendInChat(agentId: string, chatId: string) {
  const { agent, chat } = agentChat(agentId, chatId);
  // (yours: not one the Brain, a loop or a team sent)
  const last = chat.items.findLast((i) => i.type === 'user' && !i.from);
  if (!last || last.type !== 'user') throw fail(400, 'Nothing to send again yet.');
  return engines.queueMessage(agent, chat, last.text, last.attachments || []);
}

/** The last turn was cut off (stopped, or it failed) before it answered. */
export function cutOff(chat: Chat): boolean {
  const lastUser = chat.items.findLastIndex((i) => i.type === 'user');
  return lastUser !== -1 && chat.items.slice(lastUser + 1).some((i) => i.type === 'error');
}

/** /resume: the agent carries on where its last turn was cut off (and a stopped goal is followed again). */
export function resumeInChat(agentId: string, chatId: string): { resumed: true } {
  const { agent, chat } = agentChat(agentId, chatId);
  if (engines.isChatBusy(chat.id)) throw fail(409, 'It is still working. Use /stop first, or /queue a message.');
  const brief = stoppedBrief('agent', agent.id, chat.id);
  if (brief) {
    if (!resumeBrief(brief, RESUME_TEXT)) throw fail(409, 'Could not pick it up again.');
    return { resumed: true };
  }
  if (!cutOff(chat)) throw fail(400, 'Nothing to resume: the last turn finished.');
  engines.queueMessage(agent, chat, RESUME_TEXT, [], { from: '/resume' });
  return { resumed: true };
}

const offWords = /^(off|stop|end|cancel)$/i;

/** /loop [15m] [5x] message, or /loop off. */
export function loopInChat(agentId: string, chatId: string, rest: string, attachments: string[] = []): { loop: LoopInfo | null } {
  const { agent, chat } = agentChat(agentId, chatId);
  if (offWords.test(rest)) {
    if (!engines.stopLoop(chat.id, 'Loop stopped.')) throw fail(400, 'No loop is going here.');
    return { loop: null };
  }
  const req = parseLoop(rest);
  if ('error' in req) throw fail(400, req.error);
  return { loop: engines.startLoop(agent, chat, req, attachments) };
}

/** /goal what done looks like, /goal clear, or /goal (what it is now). */
export function goalInChat(agentId: string, chatId: string, text: string): { goal: BrainBrief | null } {
  const { agent, chat } = agentChat(agentId, chatId);
  if (!text) return { goal: openGoal('agent', agent.id, chat.id) };
  if (/^(clear|off|stop|none)$/i.test(text)) {
    if (!clearGoal('agent', agent.id, chat.id)) throw fail(400, 'There is no goal here.');
    return { goal: null };
  }
  return { goal: setAgentGoal(agent, chat, text) };
}

// ---------- in a team's chat ----------
function team(teamId: string) {
  const t = teams.getTeam(teamId);
  if (!t) throw fail(404, 'No such team.');
  return t;
}

export function resendInTeam(teamId: string) {
  const t = team(teamId);
  const last = teams.lastUserMessage(t.id);
  if (!last) throw fail(400, 'Nothing to send again yet.');
  return teams.queueUserMessage(t.id, last.text, { replyTo: last.replyTo || null, route: pickMember, attachments: last.attachments || [] });
}

export function resumeInTeam(teamId: string): { resumed: true } {
  const t = team(teamId);
  const brief = stoppedBrief('team', t.id);
  const picked = brief ? resumeBrief(brief, RESUME_TEXT) : teams.resumeTeam(t.id) > 0;
  // (a stopped goal whose cut-off turns are gone, e.g. after a restart, stays stopped)
  if (!picked && brief) throw fail(409, 'Nothing was left to pick up again. Write in the chat to start the work again.');
  if (!picked) throw fail(400, "Nothing to resume: the team wasn't stopped or paused.");
  return { resumed: true };
}

export function loopInTeam(teamId: string, rest: string, attachments: string[] = []): { loop: LoopInfo | null } {
  const t = team(teamId);
  if (offWords.test(rest)) {
    if (!teams.stopTeamLoop(t.id, 'Loop stopped.')) throw fail(400, 'No loop is going here.');
    return { loop: null };
  }
  const req = parseLoop(rest);
  if ('error' in req) throw fail(400, req.error);
  return { loop: teams.startTeamLoop(t.id, req, { attachments, route: pickMember }) };
}

export async function goalInTeam(teamId: string, text: string): Promise<{ goal: BrainBrief | null }> {
  const t = team(teamId);
  if (!text) return { goal: openGoal('team', t.id) };
  if (/^(clear|off|stop|none)$/i.test(text)) {
    if (!clearGoal('team', t.id)) throw fail(400, 'There is no goal here.');
    return { goal: null };
  }
  return { goal: await setTeamGoal(t.id, text) };
}

// ---------- in the Brain chat ----------
// when you last stopped the Brain, by project: /resume picks up what that stop cut off
const lastStop = new Map<string, number>();

export interface BrainWork {
  /** agent chats and teams the Brain chat shows working (handed on from it, or sent straight to them) */
  chats?: { agentId: string; chatId: string }[];
  teams?: string[];
}
const cleanWork = (w: BrainWork) => ({
  chats: (Array.isArray(w.chats) ? w.chats : []).filter((c) => typeof c?.agentId === 'string' && typeof c?.chatId === 'string').slice(0, 50),
  teams: (Array.isArray(w.teams) ? w.teams : []).filter((t): t is string => typeof t === 'string').slice(0, 50),
});

const teamBusy = (id: string) => {
  const s = teams.teamState(id);
  return !!(s.working.length || s.queued.length || s.held?.length || s.loop);
};
function stopAgentChat(chatId: string) {
  engines.unqueue(chatId);
  engines.stopLoop(chatId, 'Loop stopped.');
  engines.stopChat(chatId);
}

/** /stop in the Brain chat: its answer being written changes nothing, and the work it handed out stops. */
export function stopBrain(work: BrainWork): { stopped: string[] } {
  const pid = activeProject().id;
  const { chats: list, teams: teamIds } = cleanWork(work);
  stopAsks(pid);
  lastStop.set(pid, Date.now());
  const names = new Set<string>();
  // (marked stopped first, so their follow-up checks don't run on the cut-off work)
  for (const b of stoppedBriefs(listBriefs(pid).filter((x) => x.status === 'open' && x.origin !== 'chat'))) {
    if (b.kind === 'team' && teamBusy(b.targetId)) teams.stopTeam(b.targetId), names.add(b.name);
    if (b.kind === 'agent' && b.chatId && engines.isChatBusy(b.chatId)) stopAgentChat(b.chatId), names.add(b.name);
  }
  for (const c of list)
    if (engines.isChatBusy(c.chatId)) {
      stopAgentChat(c.chatId);
      names.add(agents.get(c.agentId)?.name || 'an agent');
    }
  for (const id of teamIds)
    if (teams.getTeam(id) && teamBusy(id)) {
      teams.stopTeam(id);
      names.add(teams.getTeam(id)?.name || 'a team');
    }
  return { stopped: [...names] };
}

/** /resume in the Brain chat: the work the last /stop cut off carries on. Returns who carries on (and
 *  which of the chats and teams it was given). */
export function resumeBrain(work: BrainWork): { resumed: string[]; chats: string[]; teams: string[] } {
  const pid = activeProject().id;
  const { chats: list, teams: teamIds } = cleanWork(work);
  const since = lastStop.get(pid);
  const stopped = listBriefs(pid).filter((b) => b.status === 'stopped' && b.origin !== 'chat');
  const briefs = since ? stopped.filter((b) => (b.updatedAt || 0) >= since - 2000) : stopped.slice(-1);
  const names = new Set<string>();
  const done = new Set<string>();
  const going = { chats: [] as string[], teams: [] as string[] };
  for (const b of briefs) {
    const key = b.kind === 'team' ? b.targetId : b.chatId || '';
    done.add(key);
    if (!resumeBrief(b, RESUME_TEXT)) continue;
    names.add(b.name);
    (b.kind === 'team' ? going.teams : going.chats).push(key);
  }
  for (const c of list) {
    if (done.has(c.chatId)) continue;
    try {
      resumeInChat(c.agentId, c.chatId);
      names.add(agents.get(c.agentId)?.name || 'an agent');
      going.chats.push(c.chatId);
    } catch {
      /* nothing cut off there */
    }
  }
  for (const id of teamIds)
    if (!done.has(id) && teams.getTeam(id) && teams.resumeTeam(id) > 0) {
      names.add(teams.getTeam(id)?.name || 'a team');
      going.teams.push(id);
    }
  if (!names.size) throw fail(400, 'Nothing to resume.');
  lastStop.delete(pid);
  return { resumed: [...names], ...going };
}

// ---------- the harness's own commands ----------
/** A command of the agent's harness, for the / menu (sent to it as you type it). */
export interface HarnessCommand {
  name: string;
  about: string;
}

// "description:" from a file's front matter, else its first line of text
function describe(file: string): string {
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4000);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    text = buf.subarray(0, n).toString('utf8');
  } catch {
    return '';
  }
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const desc = front && /^description:\s*["']?(.+?)["']?\s*$/m.exec(front[1]);
  if (desc) return desc[1].slice(0, 160);
  const body = front ? text.slice(front[0].length) : text;
  return (body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '').trim().slice(0, 160);
}

const names = (dir: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/** A Claude Code agent's own commands and skills (yours in ~/.claude, and its work folder's .claude), which
 *  it runs when a message starts with /name. Other harnesses run one message at a time without them. */
export function harnessCommands(agentId: string): HarnessCommand[] {
  const agent = agents.get(agentId);
  if (!agent || agent.engine !== 'claude-code') return [];
  const ours = new Set(COMMANDS.filter((c) => c.in.includes('agent')).map((c) => c.name));
  const out = new Map<string, HarnessCommand>();
  for (const root of [path.join(HOME, '.claude'), path.join(workspaceOf(agent), '.claude')]) {
    for (const e of names(path.join(root, 'commands')))
      if (e.isFile() && e.name.endsWith('.md')) {
        const name = e.name.slice(0, -3);
        if (!ours.has(name)) out.set(name, { name, about: describe(path.join(root, 'commands', e.name)) });
      }
    for (const e of names(path.join(root, 'skills'))) {
      const file = path.join(root, 'skills', e.name, 'SKILL.md');
      if (e.isDirectory() && !ours.has(e.name) && fs.existsSync(file)) out.set(e.name, { name: e.name, about: describe(file) });
    }
  }
  return [...out.values()].filter((c) => /^[\w:.-]+$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);
}
