// Attached files through real runs, with a fake model: what the agent is given, and when.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAgent } from '../../server/library.ts';
import { saveSettings, workflows } from '../../server/store.ts';
import { getThread, postUserMessage } from '../../server/teams.ts';
import { newBatch, receive, uploadsRoot } from '../../server/uploads.ts';
import { expandImages } from '../../server/engines/openai.ts';
import { uploadsDirArgs } from '../../server/engines/claude.ts';
import type { LlmMessage } from '../../server/engines/openai.ts';
import type { Agent, Team } from '../../shared/types.ts';

// every user message the fake model was sent (the newest one of each request)
const seen: string[] = [];
let server: http.Server;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    const last = (JSON.parse(body) as { messages: { content: unknown }[] }).messages.at(-1)!.content;
    seen.push(typeof last === 'string' ? last : JSON.stringify(last));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Got it.' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const upload = async (rel: string, text: string) => {
  const { batch } = newBatch();
  return (await receive(Object.assign(Readable.from([Buffer.from(text)]), { headers: {} }) as unknown as http.IncomingMessage, batch, rel)).path;
};
const waitFor = async (n: number, teamId: string) => {
  for (let i = 0; i < 80 && getThread(teamId).messages.length < n; i++) await new Promise((r) => setTimeout(r, 50));
};

describe('a team with files', () => {
  it('gives each member the team files once (new ones when added), and routes a files-only message on their names', async () => {
    const a = newAgent({ name: 'Analyst', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
    const guide = await upload('guide.md', 'GUIDE-TEXT: be brief.');
    const team = workflows.save({ name: 'Numbers', members: [a.id], lead: null, steps: [], files: [guide] } as Partial<Team>);
    const sheet = await upload('sales.csv', 'SALES-ROWS');
    const routed: string[] = [];
    const route = async (text: string) => (routed.push(text), a.id);

    seen.length = 0;
    await postUserMessage(team.id, '', { attachments: [sheet], route });
    await waitFor(2, team.id);
    expect(routed[0]).toBe('(attached: sales.csv)');
    // first turn: the team file and the message's file, with their text (API model, no file tools)
    expect(seen[0]).toContain('GUIDE-TEXT');
    expect(seen[0]).toContain('SALES-ROWS');

    seen.length = 0;
    await postUserMessage(team.id, 'And the total?', { route });
    await waitFor(4, team.id);
    // not sent again, only where it is
    expect(seen[0]).not.toContain('GUIDE-TEXT');
    expect(seen[0]).toContain(`The team's files: ${guide}`);

    const extra = await upload('notes.md', 'NEW-NOTES');
    workflows.save({ ...workflows.get(team.id)!, files: [guide, extra] });
    seen.length = 0;
    await postUserMessage(team.id, 'Use the new notes', { route });
    await waitFor(6, team.id);
    expect(seen[0]).toContain('NEW-NOTES');
    expect(seen[0]).not.toContain('GUIDE-TEXT');
  });

  it("never sends a file outside this project's uploads, as a restored team or thread could name one", async () => {
    const a = newAgent({ name: 'Reader', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
    const outside = path.join(os.homedir(), 'private-team-file.md');
    fs.writeFileSync(outside, 'OUTSIDE-PRIVATE-TEXT');
    // saved straight to the store, as a restore from a folder or backup does (not through the routes)
    const team = workflows.save({ name: 'Restored', members: [a.id], lead: null, steps: [], files: [outside] } as Partial<Team>);
    seen.length = 0;
    await postUserMessage(team.id, 'Go', { route: async () => a.id });
    await waitFor(2, team.id);
    expect(seen[0]).toBeTruthy();
    expect(seen[0]).not.toContain('OUTSIDE-PRIVATE-TEXT');
    expect(seen[0]).not.toContain(outside);
  });
});

describe('images for API models', () => {
  it('sends only the newest few images across the history', () => {
    const img = (n: number) => ({ type: 'image_url' as const, image_url: { url: `dash-file:${path.join(uploadsRoot(), `i${n}.png`)}` } });
    for (let n = 1; n <= 8; n++) fs.writeFileSync(path.join(uploadsRoot(), `i${n}.png`), 'P');
    const msgs: LlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'old' }, img(1), img(2), img(3), img(4)] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: [{ type: 'text', text: 'new' }, img(5), img(6), img(7), img(8)] },
    ];
    const out = JSON.stringify(expandImages(msgs, true));
    expect(out.match(/data:image\/png;base64/g)).toHaveLength(6);
    expect(out).toContain('earlier image i1.png, not sent again');
    expect(out).toContain('earlier image i2.png, not sent again');
    expect(out).not.toContain('earlier image i3.png');
  });
});

describe('Claude Code and the uploads folder', () => {
  it('adds uploads/ for an agent with its own workspace whenever the chat has had files', () => {
    const own = { workspace: path.join(path.dirname(uploadsRoot()), '..', 'elsewhere') } as Agent;
    const withFiles = { items: [{ type: 'user' as const, text: 'see', attachments: ['/x/uploads/a.md'] }, { type: 'user' as const, text: 'follow-up' }] };
    expect(uploadsDirArgs(own, withFiles)).toEqual(['--add-dir', uploadsRoot()]);
    expect(uploadsDirArgs(own, { items: [] })).toEqual([]);
    expect(uploadsDirArgs(own, { items: [] }, ['/x/uploads/a.md'])).toEqual(['--add-dir', uploadsRoot()]);
    // the default workspace is the Brain folder: uploads/ is already inside it
    expect(uploadsDirArgs({ workspace: '' } as Agent, withFiles)).toEqual([]);
  });
});
