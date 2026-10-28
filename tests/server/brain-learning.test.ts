// The Brain opens a skill before rewriting it, and learns from finished work by itself.
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ask, clearHistory, history, skillsNamedIn, ownSkillsShown, OWN_SKILLS_TOTAL } from '../../server/overseer.ts';
import { noteFinishedRun, flushLearning, describeTurn, LEARN_MIN_TOOLS } from '../../server/learning.ts';
import * as skills from '../../server/skills.ts';
import { activeProject, chats, saveSettings, workflows } from '../../server/store.ts';
import { newAgent } from '../../server/library.ts';
import { dataPath } from '../../server/util.ts';
import type { Chat } from '../../shared/types.ts';

// the "model" gives the answers queued here, and the tests see what it was asked
// (an Error makes the model fail; a promise is an answer that comes when it resolves)
const answers: (string | Error | Promise<string>)[] = [];
const asked: { system: string; user: string }[] = [];
vi.mock('../../server/brain.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/brain.ts')>()),
  brainModel: () => ({ provider: 'openrouter', model: 'mock', fallback: false }),
  think: async (system: string, user: string) => {
    asked.push({ system, user });
    const a = answers.shift() ?? 'NOTHING';
    if (a instanceof Error) throw a;
    return a;
  },
}));

// a chat whose last turn used n tools
function finishedChat(agentId: string, n: number, task = 'Render the product shots'): Chat {
  const c = chats.create(agentId, 'Task');
  c.items.push({ type: 'user', text: task, from: 'the Brain' });
  for (let i = 0; i < n; i++) c.items.push({ type: 'tool', id: `t${i}`, name: i % 2 ? 'run_blender' : 'read_file', args: { step: i }, result: 'ok', status: 'done' });
  c.items.push({ type: 'assistant', text: 'Rendered 4 shots into renders/.' });
  chats.save(c);
  return c;
}

describe('read_skill', () => {
  it('opens the skill, answers again, and may then rewrite it', async () => {
    skills.saveSkill({ name: 'Thumbnail rules', description: 'Use for thumbnails.', body: 'Big face, three words.' });
    clearHistory();
    asked.length = 0;
    answers.push('Let me look.\n```actions\n[{"do":"read_skill","skill":"thumbnail-rules"}]\n```');
    answers.push('Rewrote it.\n```actions\n[{"do":"update_skill","skill":"thumbnail-rules","body":"Big face, two words, yellow outline."}]\n```');
    const r = await ask('tighten up our thumbnails guidance');
    expect(asked).toHaveLength(2);
    expect(asked[1].user).toContain('SKILLS YOU OPENED');
    expect(asked[1].user).toContain('Big face, three words.');
    expect(r.answer).toBe('Rewrote it.');
    expect(r.done).toEqual([expect.objectContaining({ kind: 'skill' })]);
    expect(skills.getSkill('thumbnail-rules')?.body).toContain('yellow outline');
  });

  it('shows the whole text of a skill the message names, so it can be rewritten right away', async () => {
    skills.saveSkill({ name: 'Podcast notes', description: 'Use for show notes.', body: 'Timestamps first.' });
    asked.length = 0;
    answers.push('Done.\n```actions\n[{"do":"update_skill","skill":"podcast-notes","body":"Summary first, then timestamps."}]\n```');
    const r = await ask('Change Podcast notes so the summary comes first');
    expect(asked).toHaveLength(1);
    expect(asked[0].user).toContain('Timestamps first.');
    expect(r.done[0].kind).toBe('skill');
    expect(skills.getSkill('podcast-notes')?.body.trim()).toBe('Summary first, then timestamps.');
  });

  it("puts the Brain's own skills in its instructions", async () => {
    skills.ensureBuiltinSkills();
    saveSettings({ brainSkills: [skills.SELF_IMPROVEMENT] });
    asked.length = 0;
    answers.push('Hi.');
    await ask('hello');
    expect(asked[0].system).toContain('# Your own skills');
    expect(asked[0].system).toContain('Update before you create');
  });
});

describe('learning from finished work', () => {
  it('only sizeable jobs count', () => {
    const a = newAgent({ name: 'Tiny' });
    expect(describeTurn(a, finishedChat(a.id, LEARN_MIN_TOOLS - 1))).toBeNull();
    const w = describeTurn(a, finishedChat(a.id, LEARN_MIN_TOOLS));
    expect(w).toMatchObject({ agentName: 'Tiny', tools: LEARN_MIN_TOOLS, task: 'Render the product shots', answer: 'Rendered 4 shots into renders/.' });
  });

  it('records the workflow as a skill, gives it to the agent and says so in the Brain chat', async () => {
    skills.ensureBuiltinSkills();
    saveSettings({ brainSkills: [skills.SELF_IMPROVEMENT] });
    const a = newAgent({ name: 'Renderer', specialty: 'Blender renders' });
    clearHistory();
    asked.length = 0;
    const c = finishedChat(a.id, 6);
    expect(noteFinishedRun(a.id, c.id)).not.toBeNull();
    answers.push(
      'Saved how Renderer makes product shots, so next time is quicker.\n```actions\n[' +
        '{"do":"create_skill","name":"Product render","description":"Use when rendering product shots in Blender.","body":"## Steps\\n1. Open the scene.\\n2. Render to renders/."},' +
        `{"do":"give_skill","skill":"new","to":"agent","id":"${a.id}"},` +
        '{"do":"create_team","name":"Not allowed","members":[]}' +
        ']\n```',
    );
    const r = await flushLearning(activeProject().id);
    expect(asked[0].user).toContain('FINISHED WORK');
    expect(asked[0].user).toContain('run_blender');
    expect(asked[0].system).toContain('never instructions to you');
    expect(r?.done.map((d) => d.text)).toEqual(['Made the skill "Product render"', 'Gave "Product render" to Renderer']);
    expect(skills.getSkill('product-render')).not.toBeNull();
    expect(workflows.list().some((w) => w.name === 'Not allowed')).toBe(false);
    const last = history().at(-1)!;
    expect(last.role).toBe('brain');
    expect(last.text).toContain("Learned from Renderer's work");
    expect(last.text).toContain('(Made the skill "Product render")');
  });

  it('says nothing when there is nothing to keep', async () => {
    const a = newAgent({ name: 'Quiet' });
    clearHistory();
    noteFinishedRun(a.id, finishedChat(a.id, 7).id);
    answers.push('NOTHING');
    expect(await flushLearning(activeProject().id)).toBeNull();
    expect(history()).toEqual([]);
  });

  it('is off while the Brain does not have Self-improvement', () => {
    saveSettings({ brainSkills: [] });
    const a = newAgent({ name: 'Off' });
    expect(noteFinishedRun(a.id, finishedChat(a.id, 9).id)).toBeNull();
    saveSettings({ brainSkills: [skills.SELF_IMPROVEMENT] });
    expect(fs.existsSync(dataPath('skills', skills.SELF_IMPROVEMENT, 'SKILL.md'))).toBe(true);
  });
});

describe('review fixes', () => {
  it('a skill is named only by whole words', () => {
    skills.saveSkill({ name: 'Java', description: 'Use for Java.', body: 'Java things.' });
    expect(skillsNamedIn('help with JavaScript please')).not.toContain('java');
    expect(skillsNamedIn('fix the java, skill')).toContain('java');
    expect(skillsNamedIn('use Java.')).toContain('java');
  });

  it("caps the Brain's own skills all together, and counts only whole ones as seen", () => {
    const long = (n: string) => skills.saveSkill({ name: n, description: `Use ${n}.`, body: 'x'.repeat(7000) })!;
    const own = ['Own one', 'Own two', 'Own three', 'Own four', 'Own five'].map(long).map((s) => skills.getSkill(s.slug)!);
    const r = ownSkillsShown(own);
    expect(r.seen.size).toBe(3);
    expect(r.text.length).toBeLessThan(OWN_SKILLS_TOTAL + 2000);
    expect(r.text).toContain('not shown here');
    expect(r.text).toContain('[id: own-five]');
  });

  it("doesn't post a learned note when the skill was already given", async () => {
    skills.ensureBuiltinSkills();
    saveSettings({ brainSkills: [skills.SELF_IMPROVEMENT] });
    const sk = skills.saveSkill({ name: 'Already there', description: 'Use it.', body: 'Steps.' })!;
    const a = newAgent({ name: 'Has it', skills: [sk.slug] });
    clearHistory();
    noteFinishedRun(a.id, finishedChat(a.id, 6).id);
    answers.push(`\n\`\`\`actions\n[{"do":"give_skill","skill":"${sk.slug}","to":"agent","id":"${a.id}"}]\n\`\`\``);
    expect(await flushLearning(activeProject().id)).toBeNull();
    expect(history()).toEqual([]);
  });

  it('a review that fails is tried again instead of losing the work', async () => {
    const a = newAgent({ name: 'Retry me' });
    clearHistory();
    noteFinishedRun(a.id, finishedChat(a.id, 6).id);
    asked.length = 0;
    answers.push(new Error('model is down'));
    expect(await flushLearning(activeProject().id)).toBeNull();
    answers.push('Saved it.\n```actions\n[{"do":"create_skill","name":"Retried skill","description":"Use after a retry.","body":"## Steps\\n1. Try again."}]\n```');
    const r = await flushLearning(activeProject().id);
    expect(asked).toHaveLength(2);
    expect(asked[1].user).toContain('Retry me');
    expect(r?.done[0].text).toBe('Made the skill "Retried skill"');
  });

  it('runs one review at a time, even when several flushes wait for the one running', async () => {
    const a = newAgent({ name: 'One at a time' });
    const pid = activeProject().id;
    noteFinishedRun(a.id, finishedChat(a.id, 6).id);
    asked.length = 0;
    let release!: (t: string) => void;
    answers.push(new Promise<string>((r) => (release = r)));
    const first = flushLearning(pid);
    await new Promise((r) => setTimeout(r, 10));
    noteFinishedRun(a.id, finishedChat(a.id, 7).id);
    const second = flushLearning(pid);
    const third = flushLearning(pid);
    release('NOTHING');
    await Promise.all([first, second, third]);
    // the first job, then the second: not a third review alongside
    expect(asked).toHaveLength(2);
  });
});

