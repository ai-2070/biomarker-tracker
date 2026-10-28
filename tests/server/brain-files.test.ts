// What the Brain is told about attached files (an OpenRouter Brain can't open files, so it gets their text).
import http from 'node:http';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { saveSettings, setSecret } from '../../server/store.ts';
import { designAgent } from '../../server/brain.ts';
import { ask } from '../../server/overseer.ts';
import { newBatch, receive } from '../../server/uploads.ts';

const prompts: string[] = [];
let reply = 'Noted.';
const realFetch = globalThis.fetch;
beforeAll(() => {
  saveSettings({ brain: { provider: 'openrouter', model: 'mock' } });
  setSecret('openrouterKey', 'sk-or-test');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).includes('openrouter.ai/api/v1/chat/completions')) return realFetch(url, init);
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    prompts.push(body.messages.at(-1)!.content);
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
  });
});
afterAll(() => vi.restoreAllMocks());

const upload = async (rel: string, text: string) => {
  const { batch } = newBatch();
  return (await receive(Object.assign(Readable.from([Buffer.from(text)]), { headers: {} }) as unknown as http.IncomingMessage, batch, rel)).path;
};

describe('the Brain and attached files', () => {
  it('designs an agent from files alone', async () => {
    const brief = await upload('role.md', 'ROLE: writes release notes');
    reply = '{"name":"Notes","emoji":"📝","specialty":"release notes","systemPrompt":"x","toolGroups":[]}';
    prompts.length = 0;
    await designAgent('', { attachments: [brief] });
    expect(prompts[0]).toMatch(/^Design the agent from the attached files/);
    expect(prompts[0]).toContain('ROLE: writes release notes');
  });

  it('still has the text of files attached in an earlier turn', async () => {
    const report = await upload('report.md', 'REPORT-BODY: revenue up 12%');
    reply = 'Got the report.';
    await ask('Here is the report', { attachments: [report] });
    prompts.length = 0;
    await ask('Summarize that report');
    expect(prompts[0]).toContain('Files the user attached earlier in this chat');
    expect(prompts[0]).toContain('REPORT-BODY: revenue up 12%');
  });
});
