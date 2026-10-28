// Teams asking teams (#Team Name), end to end with a fake model: the question goes to the other team's
// chat, and once that team is done its answer comes back to whoever asked.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { saveSettings, workflows } from '../../server/store.ts';
import { getThread, otherTeams, postUserMessage, stopTeam, teamState } from '../../server/teams.ts';
import { fromTeam, parseTeamRefs, teamFrom } from '../../shared/teams.ts';
import type { Team, TeamMessage } from '../../shared/types.ts';

// a fake OpenAI-compatible model; each agent answers by its name (and what it was just told)
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body) as { messages: { content: string }[] };
    const system = j.messages[0].content;
    const last = j.messages.at(-1)!.content;
    let reply = 'Okay.';
    if (system.includes('You are Producer')) reply = /#Design answered/.test(last) ? 'Got the logo from Design. All done.' : 'We need a logo. #Design please make one for the launch.';
    // (it names the team that asked: that is its answer, not a new question to them)
    else if (system.includes('You are Designer')) reply = 'Logo done for #Studio: logo.png';
    else if (system.includes('You are Painter')) reply = 'Banner painted: banner.png';
    else if (system.includes('You are Slowpoke')) await new Promise((r) => setTimeout(r, 1500));
    else if (system.includes('You are Norther')) reply = /#East answered/.test(last) ? 'North done.' : 'Need numbers. #East please help.';
    else if (system.includes('You are Easter')) reply = /#South answered/.test(last) ? 'Numbers for #North: 42.' : '#South please count.';
    else if (system.includes('You are Souther')) reply = '#North can you check this first?';
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
const team = (name: string, lead: string, ...others: string[]) =>
  workflows.save({ name, description: `${name} work`, members: [lead, ...others], lead, steps: [] } as Partial<Team>);

// until both teams have nobody working and the check passes
async function settle(teamIds: string[], check: () => boolean, ms = 8000) {
  const quiet = () => teamIds.every((id) => !teamState(id).working.length && !teamState(id).queued.length);
  for (let t = 0; t < ms && !(quiet() && check()); t += 50) await new Promise((r) => setTimeout(r, 50));
}
const lines = (msgs: TeamMessage[], names: Record<string, string>) => msgs.map((m) => `${names[m.from] || m.from}: ${m.text.trim()}`);

describe('parseTeamRefs()', () => {
  const teams = [
    { id: 'd', name: 'Design' },
    { id: 'do', name: 'Design Ops' },
    { id: 's', name: 'Studio' },
  ];
  it('finds #Team Name, longest names first, any case', () => {
    expect(parseTeamRefs('#Design Ops please check', teams)).toEqual(['do']);
    expect(parseTeamRefs('ask #design and #STUDIO.', teams).sort()).toEqual(['d', 's']);
    expect(parseTeamRefs('#Design, then #Design again', teams)).toEqual(['d']);
  });
  it('skips the team itself, code, links, headings and longer words', () => {
    expect(parseTeamRefs('#Studio and #Design', teams, 's')).toEqual(['d']);
    expect(parseTeamRefs('run `#Design` or\n```\n#Design\n```', teams)).toEqual([]);
    expect(parseTeamRefs('see https://x.com/page#Design and a#Design', teams)).toEqual([]);
    expect(parseTeamRefs('# Design notes\n#Designers', teams)).toEqual([]);
  });
  it('tells a message from another team by its sender', () => {
    expect(fromTeam(teamFrom('abc'))).toBe('abc');
    expect(fromTeam('user')).toBeNull();
    expect(fromTeam('team:')).toBeNull();
  });
});

describe('one team asks another', () => {
  it('the question goes to the other team, and its answer comes back to whoever asked', async () => {
    const producer = agent('Producer');
    const designer = agent('Designer');
    const studio = team('Studio', producer.id);
    const design = team('Design', designer.id);
    expect(otherTeams(studio.id).map((t) => t.name)).toContain('Design');

    await postUserMessage(studio.id, 'Plan the launch');
    const done = () => getThread(studio.id).messages.length >= 4;
    await settle([studio.id, design.id], done);

    const names = { [producer.id]: 'Producer', [designer.id]: 'Designer', [teamFrom(design.id)]: '#Design', [teamFrom(studio.id)]: '#Studio' };
    const here = getThread(studio.id).messages;
    expect(lines(here, names)).toEqual([
      'user: Plan the launch',
      'Producer: We need a logo. #Design please make one for the launch.',
      '#Design: Logo done for #Studio: logo.png',
      'Producer: Got the logo from Design. All done.',
    ]);
    // the answer says who wrote it there and which question it answers
    expect(here[2].relay).toMatchObject({ teamId: design.id, teamName: 'Design', by: designer.id, byName: 'Designer', answers: here[1].id });
    expect(here[2].replyTo).toBe(here[1].id);

    // the other team's chat: the question (from the team, by the agent that asked), then its answer.
    // Naming #Studio in the answer didn't send Studio a new question.
    const there = getThread(design.id).messages;
    expect(lines(there, names)).toEqual(['#Studio: We need a logo. #Design please make one for the launch.', 'Designer: Logo done for #Studio: logo.png']);
    expect(there[0].relay).toMatchObject({ teamId: studio.id, by: producer.id, byName: 'Producer' });
    expect(there[0].relay?.answers).toBeUndefined();
  });

  it('you can ask another team from a team chat: nobody here starts, and the answer comes back to you', async () => {
    const host = agent('Host');
    const painter = agent('Painter');
    const lobby = team('Lobby', host.id);
    const banners = team('Banner Desk', painter.id);

    await postUserMessage(lobby.id, '#Banner Desk paint a banner for the launch');
    await settle([lobby.id, banners.id], () => getThread(lobby.id).messages.length >= 2);

    const names = { [painter.id]: 'Painter', [teamFrom(banners.id)]: '#Banner Desk', [teamFrom(lobby.id)]: '#Lobby' };
    expect(lines(getThread(lobby.id).messages, names)).toEqual(['user: #Banner Desk paint a banner for the launch', '#Banner Desk: Banner painted: banner.png']);
    expect(lines(getThread(banners.id).messages, names)).toEqual(['#Lobby: #Banner Desk paint a banner for the launch', 'Painter: Banner painted: banner.png']);
    expect(getThread(banners.id).messages[0].relay).toMatchObject({ by: 'user', byName: 'the user' });
  });

  it("won't ask a team that waits on this one: that would leave them waiting for each other", async () => {
    const n = agent('Norther');
    const e = agent('Easter');
    const so = agent('Souther');
    const north = team('North', n.id);
    const east = team('East', e.id);
    const south = team('South', so.id);

    await postUserMessage(north.id, 'Get the numbers');
    await settle([north.id, east.id, south.id], () => getThread(north.id).messages.length >= 4);

    const names = { [n.id]: 'Norther', [e.id]: 'Easter', [so.id]: 'Souther', [teamFrom(north.id)]: '#North', [teamFrom(east.id)]: '#East', [teamFrom(south.id)]: '#South' };
    // South waits on nobody: its reply is its answer, and the question to North is not sent
    expect(lines(getThread(south.id).messages, names)).toEqual([
      '#East: #South please count.',
      'Souther: #North can you check this first?',
      "system: Not sent to #North: it is waiting on this team's answer. Answer here instead.",
    ]);
    expect(lines(getThread(east.id).messages, names)).toEqual(['#North: Need numbers. #East please help.', 'Easter: #South please count.', '#South: #North can you check this first?', 'Easter: Numbers for #North: 42.']);
    expect(lines(getThread(north.id).messages, names)).toEqual(['user: Get the numbers', 'Norther: Need numbers. #East please help.', '#East: Numbers for #North: 42.', 'Norther: North done.']);
  });

  it('a team stopped before it answered: the asking team hears so', async () => {
    const asker = agent('Asker');
    const slow = agent('Slowpoke');
    const front = team('Front Desk', asker.id);
    const back = team('Back Office', slow.id);

    await postUserMessage(front.id, '#Back Office count the stock');
    await settle([], () => teamState(back.id).working.length > 0);
    stopTeam(back.id);
    await settle([front.id, back.id], () => getThread(front.id).messages.some((m) => m.from === 'system'));

    const msgs = getThread(front.id).messages;
    expect(msgs.map((m) => m.from)).toEqual(['user', 'system']);
    expect(msgs[1].text).toBe('#Back Office was stopped before it answered.');
  });
});
