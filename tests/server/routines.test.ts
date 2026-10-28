// Routines: @mentions of agents, teams and skills, and a run end to end with a fake model.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { agents, saveSettings, workflows } from '../../server/store.ts';
import { getThread, postUserMessage } from '../../server/teams.ts';
import { saveSkill } from '../../server/skills.ts';
import { getRoutine, listRuns, routineTargets, saveRoutine, startRoutine } from '../../server/routines.ts';
import { cleanSchedule, findMentions, mentionQuery, renameMentions } from '../../shared/routines.ts';
import type { RoutineMention, RoutineRun, Team } from '../../shared/types.ts';

describe('findMentions()', () => {
  const c: RoutineMention[] = [
    { kind: 'agent', id: 'a1', name: 'Trend' },
    { kind: 'agent', id: 'a2', name: 'Trend Scout' },
    { kind: 'team', id: 't1', name: 'Content Team' },
    { kind: 'skill', id: 'brand-voice', name: 'Brand voice' },
  ];
  it('finds agents, teams and skills in the order they appear, longest names first', () => {
    const found = findMentions('@content team asks @Trend Scout, then @Trend, using @Brand voice.', c);
    expect(found.map((m) => m.id)).toEqual(['t1', 'a2', 'a1', 'brand-voice']);
  });
  it('ignores e-mail addresses, partial words and repeats', () => {
    expect(findMentions('mail bob@Trend or @Trendy', c)).toEqual([]);
    expect(findMentions('@Trend and @Trend again', c).map((m) => m.id)).toEqual(['a1']);
  });
  it('gives a clash to the earlier candidate', () => {
    const clash: RoutineMention[] = [{ kind: 'agent', id: 'a', name: 'Writer' }, { kind: 'skill', id: 'w', name: 'Writer' }];
    expect(findMentions('@Writer', clash)).toEqual([{ kind: 'agent', id: 'a', name: 'Writer' }]);
  });
});

describe('mentions in any script', () => {
  const c: RoutineMention[] = [{ kind: 'agent', id: 'cafe', name: 'Café' }];
  it("doesn't match a longer word that starts with a name", () => {
    expect(findMentions('ask @Caféé', c)).toEqual([]);
    expect(findMentions('ask @Café1', c)).toEqual([]);
    expect(findMentions('ask @Café!', c).map((m) => m.id)).toEqual(['cafe']);
    expect(findMentions('ask ü@Café', c)).toEqual([]);
  });
  it('knows a mention being typed after a non-English word is not one', () => {
    expect(mentionQuery('größe@Ca', 8)).toBeNull();
    expect(mentionQuery('größe @Ca', 9)).toEqual({ start: 6, query: 'Ca' });
  });
});

describe('cleanSchedule()', () => {
  it('counts each day once, so repeats of one day are not every day', () => {
    expect(cleanSchedule({ type: 'daily', time: '8:05', days: ['Mon', 'Mon', 'Mon', 'Mon', 'Mon', 'Mon', 'Mon'] })).toEqual({ type: 'daily', time: '08:05', days: [1] });
    expect(cleanSchedule({ type: 'daily', days: [0, 1, 2, 3, 4, 5, 6] })).toEqual({ type: 'daily', time: '09:00' });
  });
  it('keeps intervals at 5 minutes or more, and drops what it does not know', () => {
    expect(cleanSchedule({ type: 'interval', minutes: 1, extra: 'x' })).toEqual({ type: 'interval', minutes: 5 });
    expect(cleanSchedule({ type: 'interval', minutes: 0 })).toEqual({ type: 'interval', minutes: 60 });
    expect(cleanSchedule({ type: 'weird' })).toEqual({ type: 'none' });
  });
});

describe('renameMentions() and mentionQuery()', () => {
  it('renames only whole mentions, longest first', () => {
    const stored: RoutineMention[] = [{ kind: 'agent', id: 'a1', name: 'Trend' }, { kind: 'agent', id: 'a2', name: 'Trend Scout' }];
    const text = renameMentions('@Trend Scout and @Trend', stored, new Map([['agent:a1', 'Writer'], ['agent:a2', 'Trend Scout']]));
    expect(text).toBe('@Trend Scout and @Writer');
  });
  it('knows when the caret is in a mention being typed', () => {
    expect(mentionQuery('hi @Res', 7)).toEqual({ start: 3, query: 'Res' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('mail bob@x', 10)).toBeNull();
    expect(mentionQuery('@a\nb', 4)).toBeNull();
  });
});

// a fake OpenAI-compatible model that remembers what it was asked
const asked: { system: string; last: string }[] = [];
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const ch of req) body += ch;
    const j = JSON.parse(body) as { messages: { content: string }[] };
    asked.push({ system: j.messages[0].content, last: j.messages.at(-1)!.content });
    const reply = j.messages[0].content.includes('You are Boss') && !/@Helper: Done/.test(j.messages.at(-1)!.content) ? '@Helper please do the work.' : 'Done.';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const agent = (name: string) => newAgent({ name, engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
const waitFor = async (fn: () => boolean) => {
  for (let i = 0; i < 80 && !fn(); i++) await new Promise((r) => setTimeout(r, 100));
};

describe('a routine', () => {
  it('keeps its mentions up to date when things are renamed or deleted', () => {
    const scout = agent('Scout');
    const temp = agent('Temp');
    const r = saveRoutine({ name: 'Morning', text: 'Ask @Scout and @Temp.' });
    expect(r.mentions.map((m) => m.name)).toEqual(['Scout', 'Temp']);
    agents.save({ ...scout, name: 'Lookout' });
    agents.remove(temp.id);
    const now = getRoutine(r.id)!;
    expect(now.text).toBe('Ask @Lookout and @Temp.');
    expect(now.mentions).toEqual([
      { kind: 'agent', id: scout.id, name: 'Lookout' },
      { kind: 'agent', id: temp.id, name: 'Temp', missing: true },
    ]);
  });

  it('keeps who it is for when only its name or schedule changes after a rename or delete', () => {
    const lead = agent('Planner');
    const gone = agent('Leaver');
    const r = saveRoutine({ name: 'Plan', text: '@Planner plans, @Leaver checks.' });
    agents.save({ ...lead, name: 'Chief' });
    agents.remove(gone.id);
    const saved = saveRoutine({ name: 'Plan 2', schedule: { type: 'interval', minutes: 2 } }, r.id);
    expect(saved.text).toBe('@Chief plans, @Leaver checks.');
    expect(saved.schedule).toEqual({ type: 'interval', minutes: 5 });
    expect(saved.mentions).toEqual([
      { kind: 'agent', id: lead.id, name: 'Chief' },
      { kind: 'agent', id: gone.id, name: 'Leaver' },
    ]);
    // still shown as deleted when read, and gone from the list once the text no longer names it
    expect(getRoutine(r.id)!.mentions[1]).toMatchObject({ name: 'Leaver', missing: true });
    expect(routineTargets(getRoutine(r.id)!).agents.map((a) => a.id)).toEqual([lead.id]);
    expect(saveRoutine({ text: '@Chief plans.' }, r.id).mentions.map((m) => m.name)).toEqual(['Chief']);
  });

  it('will not run without an agent or a team', async () => {
    const r = saveRoutine({ name: 'Nobody', text: 'Do something.' });
    await expect(startRoutine(r.id)).rejects.toThrow(/Mention at least one agent or team/);
  });

  it('goes to each agent and team with its skills, and reaches team members through the team', async () => {
    saveSkill({ name: 'House style', description: 'How we write.', body: 'Short sentences.' });
    const solo = agent('Analyst');
    const lead = agent('Editor');
    const member = agent('Copywriter');
    const team = workflows.save({ name: 'Content Crew', description: '', members: [lead.id, member.id], lead: lead.id, steps: [] } as Partial<Team>);
    const r = saveRoutine({ name: 'Weekly post', text: '@Analyst sums up the week. @Content Crew writes the post, @Copywriter drafts it. Use @House style.' });
    expect(r.mentions.map((m) => `${m.kind}:${m.name}`)).toEqual(['agent:Analyst', 'team:Content Crew', 'agent:Copywriter', 'skill:House style']);
    const targets = routineTargets(getRoutine(r.id)!);
    expect(targets.teams.map((t) => t.id)).toEqual([team.id]);
    expect(targets.agents.map((a) => a.id)).toEqual([solo.id]); // the Copywriter is reached through the team

    asked.length = 0;
    const run = await startRoutine(r.id, { input: 'Focus on AI.' });
    let latest: RoutineRun | undefined;
    await waitFor(() => (latest = listRuns(r.id)[0])?.status !== 'running');
    expect(latest!.status).toBe('done');
    expect(latest!.id).toBe(run.id);
    expect(latest!.skills).toEqual(['house-style']);
    expect(latest!.targets.map((t) => `${t.kind}:${t.name}:${t.status}`).sort()).toEqual(['agent:Analyst:done', 'team:Content Crew:sent']);
    expect(latest!.targets.find((t) => t.kind === 'agent')!.chatId).toBeTruthy();

    // the team chat got the routine, and the @mentioned member picked it up (not the lead)
    const thread = getThread(team.id);
    expect(thread.messages[0].text).toContain('Routine "Weekly post"');
    expect(thread.messages[0].mentions).toEqual([member.id]);
    await waitFor(() => asked.some((a) => a.system.includes('You are Copywriter')));
    const forAnalyst = asked.find((a) => a.system.includes('You are Analyst'))!;
    const forCopywriter = asked.find((a) => a.system.includes('You are Copywriter'))!;
    // both got the skill for this work, and the message says to use it
    for (const a of [forAnalyst, forCopywriter]) {
      expect(a.system).toContain('House style');
      expect(a.last).toContain('read_skill');
      expect(a.last).toContain('Focus on AI.');
    }
    expect(forAnalyst.last).toContain('also went to: @Content Crew (team)');
  });
});

describe("a routine's skills in a team", () => {
  it('go with the handoff they started, even when another message comes in meanwhile, and not with the next one', async () => {
    saveSkill({ name: 'Handoff guide', description: 'How to hand work on.', body: 'Be clear.' });
    const boss = agent('Boss');
    const helper = agent('Helper');
    const team = workflows.save({ name: 'Duo', description: '', members: [boss.id, helper.id], lead: boss.id, steps: [] } as Partial<Team>);
    const helperAsks = () => asked.filter((a) => a.system.includes('You are Helper'));
    const quiet = () => {
      const t = getThread(team.id);
      return !t.working.length && !t.queued.length;
    };
    asked.length = 0;
    await postUserMessage(team.id, 'Get it done.', { skills: ['handoff-guide'] });
    // another message, without skills, while the Boss is still on the first one
    await postUserMessage(team.id, '@Boss and keep me posted.');
    await waitFor(() => helperAsks().length >= 1);
    // the Boss had the skill, and so did the Helper it handed the routine's work to
    expect(asked.find((a) => a.system.includes('You are Boss'))!.system).toContain('Handoff guide');
    expect(helperAsks()[0].system).toContain('Handoff guide');
    await waitFor(() => quiet() && getThread(team.id).messages.length >= 4);
    // a plain message afterwards doesn't bring the routine's skill along
    const before = helperAsks().length;
    await postUserMessage(team.id, '@Helper one more thing.');
    await waitFor(() => helperAsks().length > before);
    expect(helperAsks().at(-1)!.system).not.toContain('Handoff guide');
  });
});
