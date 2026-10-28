import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftSkill, libraryForPrompt, skillAnswerBudget, think } from '../../server/brain.ts';
import { saveSettings, setSecret } from '../../server/store.ts';

// The model's part is played by a function that records what it was asked and answers with set text.
function model(answer: unknown) {
  const calls: { system: string; user: string; maxTokens: number }[] = [];
  const ask = async (system: string, user: string, { maxTokens }: { maxTokens: number }) => {
    calls.push({ system, user, maxTokens });
    return typeof answer === 'string' ? answer : `Here it is:\n${JSON.stringify(answer)}`;
  };
  return { ask, calls };
}

const current = { name: 'Release notes', description: 'Use when writing release notes.', body: '# Steps\n\n1. List user-facing changes first.\n2. Link the PR.' };

describe('skills from plain words', () => {
  it('writes a new skill from a description', async () => {
    const m = model({ name: 'Email to clients', description: 'Use when writing an email to a client.', body: '# How\n\nBe brief.', note: 'Wrote a short email skill.' });
    const d = await draftSkill('How I write emails to clients: brief, warm, one ask', { ask: m.ask, others: [{ slug: 'brand-voice', name: 'Brand voice', description: 'Our tone everywhere' }] });
    expect(d).toEqual({ name: 'Email to clients', description: 'Use when writing an email to a client.', body: '# How\n\nBe brief.', note: 'Wrote a short email skill.' });
    expect(m.calls[0].system).toMatch(/Write a new skill/);
    expect(m.calls[0].system).toContain('Brand voice: Our tone everywhere'); // so it doesn't write a copy
    expect(m.calls[0].system).toMatch(/Never put secrets/);
    expect(m.calls[0].user).toContain('brief, warm, one ask');
    expect(m.calls[0].user).not.toContain('CURRENT skill');
  });

  it('changes a skill: the model sees all of it, with its files, and what to change', async () => {
    const m = model({ ...current, body: `${current.body}\n3. Add a thumbnail.`, note: 'Added a thumbnail step.' });
    const d = await draftSkill('add a step about thumbnails', { current, files: ['template.md'], ask: m.ask });
    expect(d.body).toContain('3. Add a thumbnail.');
    expect(m.calls[0].system).toMatch(/Keep everything they did not ask to change/);
    expect(m.calls[0].user).toContain('CURRENT skill:\nname: Release notes');
    expect(m.calls[0].user).toContain('1. List user-facing changes first.');
    expect(m.calls[0].user).toContain('extra files with it: template.md');
    expect(m.calls[0].user).toContain('What to change:\nadd a step about thumbnails');
  });

  it('keeps a field the model left out or emptied while editing', async () => {
    const d = await draftSkill('shorter description', { current, ask: model({ description: 'Release notes.', body: '   ', note: 'Shortened it.' }).ask });
    expect(d).toMatchObject({ name: 'Release notes', description: 'Release notes.', body: current.body });
  });

  it('turns away an answer that is not a skill', async () => {
    await expect(draftSkill('x', { ask: model('Sorry, I cannot help with that.').ask })).rejects.toThrow(/wasn't a skill/);
    await expect(draftSkill('x', { ask: model('{"name": "broken" "x"}').ask })).rejects.toThrow(/wasn't a skill/);
    // a new skill needs all three
    await expect(draftSkill('x', { ask: model({ name: 'Only a name' }).ask })).rejects.toThrow(/missing/);
  });

  it('keeps every field to its size, on one line where it must be', async () => {
    const d = await draftSkill('big', { ask: model({ name: 'N'.repeat(200), description: 'Use\nwhen\n\nwriting.', body: 'b'.repeat(70000) }).ask });
    expect(d.name).toHaveLength(80);
    expect(d.description).toBe('Use when writing.');
    expect(d.body).toHaveLength(60000);
  });

  it('works from attached files alone, and the model gets their names and text', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), 'attached-'));
    const notes = path.join(dir, 'how-we-ship.md');
    fs.writeFileSync(notes, 'We ship on Thursdays and always tag the release.');
    const m = model({ ...current, note: '' });
    await draftSkill('', { ask: m.ask, attachments: [notes] });
    expect(m.calls[0].user).toMatch(/Write a skill from the attached files/);
    expect(m.calls[0].user).toContain(notes);
    expect(m.calls[0].user).toContain('We ship on Thursdays and always tag the release.');
    await draftSkill('', { current, ask: m.ask, attachments: [notes] });
    expect(m.calls[1].user).toMatch(/Improve it using the attached files/);
    expect(m.calls[1].user).toContain('how-we-ship.md');
  });

  it('shows the model the skills most like the request, and every other one by name, however big the library', async () => {
    const lib = Array.from({ length: 120 }, (_, i) => ({ slug: `s${i}`, name: `Skill ${String(i).padStart(3, '0')}`, description: `About topic ${i}` }));
    lib.push({ slug: 'zz', name: 'Zz changelog', description: 'Use when writing release notes for a version.' });
    const m = model({ name: 'Release notes', description: 'Use when writing release notes.', body: 'b' });
    await draftSkill('how we write release notes', { ask: m.ask, others: lib });
    const sys = m.calls[0].system;
    // last alphabetically, but the closest match: first, with what it's for
    expect(sys.indexOf('- Zz changelog: Use when writing release notes')).toBeGreaterThan(-1);
    expect(sys.indexOf('- Zz changelog')).toBeLessThan(sys.indexOf('- Skill 000'));
    for (const o of lib) expect(sys).toContain(o.name);
    expect(libraryForPrompt(lib, 'x', { detailed: 5, names: 10 })).toMatch(/…and 106 more$/);
  });

  it('gives a long skill room to come back whole', async () => {
    expect(skillAnswerBudget(null)).toBe(4000);
    const long = { ...current, body: 'x'.repeat(60000) };
    expect(skillAnswerBudget(long)).toBeGreaterThan(60000 / 3);
    expect(skillAnswerBudget({ ...current, body: 'x'.repeat(500000) })).toBe(32000);
    const m = model({ ...long, note: '' });
    await draftSkill('tidy it', { current: long, ask: m.ask });
    expect(m.calls[0].maxTokens).toBe(skillAnswerBudget(long));
  });

  it('says plainly when the answer was cut off', async () => {
    await expect(draftSkill('x', { current, ask: model('{"name":"Release notes","description":"…","body":"# Steps\n1. List').ask })).rejects.toThrow(/cut off before the end/);
    const stopped = async () => {
      throw new Error('The answer was cut off: it ran past the length limit.');
    };
    await expect(draftSkill('x', { current, ask: stopped })).rejects.toThrow(/cut off before the end/);
  });
});

describe('the Brain on OpenRouter', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('treats an answer stopped at the length limit as cut off, not as an answer', async () => {
    setSecret('openrouterKey', 'sk-or-test');
    saveSettings({ brain: { provider: 'openrouter', model: 'some/model' } });
    const sent: { max_tokens?: number }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"name":"half' }, finish_reason: 'length' }] }), { status: 200 });
    });
    await expect(think('s', 'u', { maxTokens: 12345 })).rejects.toThrow(/cut off/);
    expect(sent[0].max_tokens).toBe(12345);
    await expect(draftSkill('x', { current: { name: 'a', description: 'b', body: 'c' } })).rejects.toThrow(/cut off before the end/);
  });
});
