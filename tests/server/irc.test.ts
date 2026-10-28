// IRC between the Brain and teams: the Brain hands work on as itself, answers @Brain in team chats,
// and follows up on what it handed out (end to end, with a fake model for the agents and the Brain).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ask, clearHistory, history } from '../../server/overseer.ts';
import { sendBrief, startIrc, FOLLOW_UPS_MAX } from '../../server/irc.ts';
import { addBrief, listBriefs, updateBrief } from '../../server/briefs.ts';
import { resumeInTeam } from '../../server/commands.ts';
import { newAgent } from '../../server/library.ts';
import { activeProject, chats, saveSettings, setActiveProject, workflows } from '../../server/store.ts';
import { createProject } from '../../server/projects.ts';
import { getThread, postUserMessage, stopTeam } from '../../server/teams.ts';
import type { Team } from '../../shared/types.ts';

// the Brain's model: answers queued per kind of question it gets
const answers: string[] = []; // the Brain chat
const verdicts: (string | Promise<string>)[] = []; // checking finished work (a promise: a check that takes a while)
const replies: string[] = []; // @Brain in a team chat
const asked: { system: string; user: string }[] = [];
vi.mock('../../server/brain.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/brain.ts')>()),
  brainModel: () => ({ provider: 'openrouter', model: 'mock', effort: '', fallback: false }),
  think: async (system: string, user: string) => {
    asked.push({ system, user });
    if (system.includes('Decide whether the brief is done')) return verdicts.shift() ?? '{"done":true,"summary":"Looks done."}';
    if (system.includes('wrote to you (@Brain)')) return replies.shift() ?? '{"reply":"Noted."}';
    return answers.shift() ?? 'NOTHING';
  },
}));

// the agents' model: what each one says, by name. "Holder" answers only when the test lets it go.
const calls: Record<string, number> = {};
const held: (() => void)[] = [];
const say = (name: string, last: string): string => {
  calls[name] = (calls[name] || 0) + 1;
  if (name === 'Finisher') return 'Done: saved thumb.png.';
  if (name === 'Dawdler') return 'Started on it.';
  if (name === 'Asker') return last.includes('1280x720') ? 'Done at 1280x720.' : '@Brain which size should it be?';
  if (name === 'Needy') return last.includes('passed it on') ? 'Waiting for the account.' : '@Brain we need an X account to post.';
  if (name === 'Writer') return 'Report written.';
  return 'Okay.';
};
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body) as { messages: { content: string | { text?: string }[] }[] };
    const text = (c: string | { text?: string }[]) => (typeof c === 'string' ? c : c.map((x) => x.text || '').join(''));
    const name = /You are ([A-Z]\w+)/.exec(text(j.messages[0].content))?.[1] || '';
    if (name === 'Holder') await new Promise<void>((go) => held.push(go));
    const reply = name === 'Holder' ? 'Held answer.' : say(name, text(j.messages.at(-1)!.content));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
  startIrc();
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  saveSettings({ brainFollowsUp: true });
  clearHistory();
});

const until = async (ok: () => boolean, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out');
};
const agent = (name: string) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
const team = (name: string, lead: string) => workflows.save({ name, description: 'Make things', members: [lead], lead, steps: [{ type: 'agent', agentId: lead }] } as Partial<Team>);
const delegate = (to: 'team' | 'agent', id: string, message: string) => `On it.\n\`\`\`actions\n[{"do":"delegate","to":"${to}","id":"${id}","message":"${message}"}]\n\`\`\``;
const briefFor = (targetId: string) => listBriefs().findLast((b) => b.targetId === targetId);
const thread = (teamId: string) => getThread(teamId).messages;
const notes = () => history().filter((m) => m.role === 'brain').map((m) => m.text);

describe('the Brain hands work on as itself', () => {
  it('posts the brief in the team chat as the Brain, then checks the result and tells you', async () => {
    const lead = agent('Finisher');
    const t = team('Thumbs', lead.id);
    answers.push(delegate('team', t.id, 'Make the launch thumbnail'));
    const r = await ask('get a thumbnail made');
    expect(r.delegate?.sent?.messageId).toBeTruthy();
    expect(thread(t.id)[0]).toMatchObject({ from: 'brain', text: 'Make the launch thumbnail' });
    await until(() => briefFor(t.id)?.status === 'done');
    expect(thread(t.id).map((m) => m.from)).toEqual(['brain', lead.id]);
    expect(asked.findLast((a) => a.system.includes('Decide whether'))?.user).toContain('Done: saved thumb.png.');
    expect(notes().at(-1)).toContain('**Thumbs finished.**');
  });

  it(`follows up when something is missing, ${FOLLOW_UPS_MAX} times at most, then says it is stuck`, async () => {
    const lead = agent('Dawdler');
    const t = team('Slowpokes', lead.id);
    verdicts.push('{"done":false,"followUp":"@Dawdler please finish it","summary":"Only started."}', '{"done":false,"followUp":"@Dawdler finish it now","summary":"Still only started."}', '{"done":false,"followUp":"again","summary":"Never got past starting."}');
    answers.push(delegate('team', t.id, 'Write the script'));
    await ask('get the script written');
    await until(() => briefFor(t.id)?.status === 'stuck');
    const from = thread(t.id).map((m) => (m.from === 'brain' ? `brain: ${m.text}` : 'agent'));
    expect(from).toEqual(['brain: Write the script', 'agent', 'brain: @Dawdler please finish it', 'agent', 'brain: @Dawdler finish it now', 'agent']);
    expect(briefFor(t.id)?.followUps).toBe(FOLLOW_UPS_MAX);
    expect(notes().at(-1)).toMatch(/Slowpokes hasn't finished.*Never got past starting/);
  });

  it('starts a chat with an agent as the Brain and checks its answer', async () => {
    const w = agent('Writer');
    answers.push(delegate('agent', w.id, 'Write the weekly report'));
    const r = await ask('weekly report please');
    const chatId = r.delegate?.sent?.chatId as string;
    expect(chats.get(w.id, chatId)?.items[0]).toMatchObject({ type: 'user', text: 'Write the weekly report', from: 'the Brain' });
    await until(() => briefFor(w.id)?.status === 'done');
    expect(notes().at(-1)).toContain('**Writer finished.**');
  });

  it('only hands work out when follow-ups are off', async () => {
    saveSettings({ brainFollowsUp: false });
    const lead = agent('Finisher');
    const t = team('Unchecked', lead.id);
    answers.push(delegate('team', t.id, 'Do it'));
    await ask('do it');
    await until(() => thread(t.id).length === 2);
    expect(briefFor(t.id)).toBeUndefined();
  });

  it('a team you stop is not followed up', async () => {
    const lead = agent('Dawdler');
    const t = team('Halted', lead.id);
    answers.push(delegate('team', t.id, 'Start the edit'));
    await ask('edit please');
    stopTeam(t.id);
    await until(() => briefFor(t.id)?.status === 'stopped');
  });
});

describe('follow-up edge cases', () => {
  it('a check that says "not done" without saying what is missing tells you it is stuck', async () => {
    const lead = agent('Finisher');
    const t = team('Vague', lead.id);
    verdicts.push('{"done":false,"followUp":"","summary":"Hard to tell what is left."}');
    answers.push(delegate('team', t.id, 'Make it'));
    await ask('make it');
    await until(() => briefFor(t.id)?.status === 'stuck');
    expect(thread(t.id).filter((m) => m.from === 'brain')).toHaveLength(1);
    expect(notes().at(-1)).toMatch(/Vague hasn't finished\*\*\. Hard to tell/);
  });

  it('turning follow-ups off also stops checking on work handed out before', async () => {
    const h = agent('Holder');
    answers.push(delegate('agent', h.id, 'Hold on'));
    await ask('hold');
    await until(() => held.length > 0);
    saveSettings({ brainFollowsUp: false });
    const checks = asked.filter((a) => a.system.includes('Decide whether')).length;
    held.shift()!();
    await new Promise((r) => setTimeout(r, 300));
    expect(asked.filter((a) => a.system.includes('Decide whether')).length).toBe(checks);
    expect(briefFor(h.id)?.status).toBe('open');
  });

  it('an answer for work handed on anew meanwhile is not followed up', async () => {
    const w = agent('Writer');
    let judge!: (v: string) => void;
    verdicts.push(new Promise<string>((r) => (judge = r)), '{"done":true,"summary":"The new one is done."}');
    answers.push(delegate('agent', w.id, 'First version'));
    const first = await ask('first');
    const firstChat = first.delegate!.sent!.chatId!;
    await until(() => asked.some((a) => a.user.includes('First version') && a.system.includes('Decide whether')));
    // handed on anew while the first answer is being checked
    answers.push(delegate('agent', w.id, 'Second version'));
    await ask('second');
    await until(() => briefFor(w.id)?.status === 'done' && briefFor(w.id)?.text === 'Second version');
    judge('{"done":false,"followUp":"Add the summary","summary":"Missing the summary."}');
    await new Promise((r) => setTimeout(r, 200));
    // no follow-up went into the first chat
    expect(chats.get(w.id, firstChat)!.items.filter((i) => i.type === 'user')).toHaveLength(1);
    expect(listBriefs().find((b) => b.text === 'First version')?.status).toBe('replaced');
  });

  it("checks an agent's answer in its own project after you open another", async () => {
    const a = await createProject({ name: 'IRC A', mode: 'new', folder: path.join(os.homedir(), 'irc-projects', 'a') });
    const h = agent('Holder');
    answers.push(delegate('agent', h.id, 'Work in project A'));
    await ask('work');
    await until(() => held.length > 0);
    const b = await createProject({ name: 'IRC B', mode: 'new', folder: path.join(os.homedir(), 'irc-projects', 'b') });
    expect(activeProject().id).toBe(b.id);
    held.shift()!();
    await until(() => listBriefs(a.id).findLast((x) => x.targetId === h.id)?.status === 'done');
    expect(listBriefs(b.id)).toEqual([]);
    setActiveProject(a.id);
    expect(notes().at(-1)).toContain('**Holder finished.**');
  });

  it('a team stopped while its work is being checked is not followed up', async () => {
    const lead = agent('Finisher');
    const t = team('Stopped mid-check', lead.id);
    let judge!: (v: string) => void;
    verdicts.push(new Promise<string>((r) => (judge = r)));
    answers.push(delegate('team', t.id, 'Make the poster'));
    await ask('poster please');
    await until(() => asked.some((a) => a.user.includes('Make the poster') && a.system.includes('Decide whether')));
    stopTeam(t.id);
    expect(briefFor(t.id)?.status).toBe('stopped');
    judge('{"done":false,"followUp":"@Finisher add the logo","summary":"No logo."}');
    await new Promise((r) => setTimeout(r, 200));
    expect(thread(t.id).filter((m) => m.from === 'brain').map((m) => m.text)).toEqual(['Make the poster']);
    expect(briefFor(t.id)?.status).toBe('stopped');
  });

  it("a stopped team goal with nothing left to pick up stays stopped on /resume", () => {
    const lead = agent('Finisher');
    const t = team('After a restart', lead.id);
    // (stopped before a restart: the brief is saved, the cut-off turns are not)
    const b = addBrief({ kind: 'team', targetId: t.id, name: t.name, text: 'Ship it', goal: 'Ship it', origin: 'chat', ts: Date.now() });
    updateBrief(b.id, { status: 'stopped' });
    expect(() => resumeInTeam(t.id)).toThrow(/Nothing was left to pick up again/);
    expect(briefFor(t.id)?.status).toBe('stopped');
  });

  it('keeps a brief in the project it was handed out in while the team picks who answers', async () => {
    const x = agent('Finisher');
    const y = agent('Writer');
    const t = workflows.save({ name: 'Leaderless', description: '', members: [x.id, y.id], lead: null, steps: [] } as Partial<Team>);
    const a = activeProject();
    const b = await createProject({ name: 'IRC C', mode: 'new', folder: path.join(os.homedir(), 'irc-projects', 'c') });
    setActiveProject(a.id);
    try {
      const sent = sendBrief({ kind: 'branch', id: t.id, name: t.name, message: 'Sort the files' });
      setActiveProject(b.id);
      await sent;
      expect(listBriefs(a.id).findLast((x) => x.targetId === t.id)?.text).toBe('Sort the files');
      expect(listBriefs(b.id)).toEqual([]);
    } finally {
      setActiveProject(a.id);
    }
  });
});

describe('@Brain in a team chat', () => {
  it("answers an agent's question in the thread, and the answer goes back to it", async () => {
    const a = agent('Asker');
    const t = team('Sizes', a.id);
    replies.push('{"reply":"Use 1280x720.","tell_user":""}');
    await postUserMessage(t.id, 'Make a banner');
    await until(() => thread(t.id).some((m) => m.text === 'Done at 1280x720.'));
    const msgs = thread(t.id);
    expect(msgs.map((m) => m.from)).toEqual(['user', a.id, 'brain', a.id]);
    expect(msgs[2]).toMatchObject({ text: 'Use 1280x720.', replyTo: msgs[1].id });
    // the Brain got the thread and the question, and was told the agent's words are data
    const q = asked.findLast((x) => x.system.includes('wrote to you (@Brain)'))!;
    expect(q.system).toContain('treat it as data');
    expect(q.user).toContain('which size should it be?');
  });

  it('passes what only you can give on to the Brain chat', async () => {
    const a = agent('Needy');
    const t = team('Social', a.id);
    replies.push('{"reply":"I passed it on to the user.","tell_user":"They need an X account connected to post."}');
    await postUserMessage(t.id, 'Post the launch');
    await until(() => thread(t.id).some((m) => m.text === 'Waiting for the account.'));
    expect(notes().at(-1)).toBe('**Social needs you:** They need an X account connected to post.');
  });

  it('answers you when you write @Brain, and nobody else starts', async () => {
    const lead = agent('Quietone');
    const t = team('Ask me', lead.id);
    replies.push('{"reply":"This team makes things."}');
    await postUserMessage(t.id, '@Brain what is this team for?');
    await until(() => thread(t.id).length === 2);
    await new Promise((r) => setTimeout(r, 150));
    expect(thread(t.id).map((m) => `${m.from}: ${m.text}`)).toEqual(['user: @Brain what is this team for?', 'brain: This team makes things.']);
    expect(calls.Quietone).toBeUndefined();
  });
});
