// The Brain's actions: parsing its ```actions block and carrying them out (teams, members, PROJECT.md, delegate).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyActions, parseActions, withGoalTools } from '../../server/overseer.ts';
import { agents, workflows, activeProject } from '../../server/store.ts';
import { newAgent } from '../../server/library.ts';
import { ensureBrain } from '../../server/projects.ts';

describe('parseActions()', () => {
  it('splits the reply from the actions block', () => {
    const r = parseActions('Building it now.\n```actions\n[{"do":"create_team","name":"Crew"}]\n```');
    expect(r.answer).toBe('Building it now.');
    expect(r.actions).toEqual([{ do: 'create_team', name: 'Crew' }]);
  });

  it('accepts a single action object and tolerates text around the JSON', () => {
    expect(parseActions('ok\n```actions\n{"do":"hire","members":[]}\n```').actions).toEqual([{ do: 'hire', members: [] }]);
    expect(parseActions('```actions\nhere: [{"do":"hire"}] done\n```').actions).toEqual([{ do: 'hire' }]);
  });

  it('a plain answer has no actions; broken JSON gives none instead of failing', () => {
    expect(parseActions('Nobody is working right now.')).toEqual({ answer: 'Nobody is working right now.', actions: [] });
    expect(parseActions('x\n```actions\n[{oops\n```').actions).toEqual([]);
  });
});

describe('applyActions()', () => {
  it('builds a team from existing and new agents, with a lead', () => {
    const writer = newAgent({ name: 'Writer' });
    const before = agents.list().length;
    const r = applyActions([
      { do: 'create_team', name: 'Social', description: 'Posts', members: [{ agent: writer.id }, { new: { name: 'Designer', emoji: '🎨', specialty: 'images', instructions: 'Make images.' } }], lead: { agent: writer.id } },
    ]);
    expect(agents.list().length).toBe(before + 1);
    const team = workflows.list().find((w) => w.name === 'Social')!;
    expect(team.members).toHaveLength(2);
    expect(team.lead).toBe(writer.id);
    expect(r.done.map((d) => d.kind)).toEqual(['hired', 'team']);
  });

  it('adds and removes members, and updates the goal and lead', () => {
    const a = newAgent({ name: 'A' });
    const b = newAgent({ name: 'B' });
    applyActions([{ do: 'create_team', name: 'Pair', members: [{ agent: a.id }] }]);
    const team = workflows.list().find((w) => w.name === 'Pair')!;
    applyActions([{ do: 'add_members', team: team.id, members: [{ agent: b.id }] }]);
    expect(workflows.get(team.id)!.members).toEqual([a.id, b.id]);
    applyActions([{ do: 'update_team', team: team.id, description: 'New goal', lead: b.id }]);
    expect(workflows.get(team.id)).toMatchObject({ description: 'New goal', lead: b.id });
    applyActions([{ do: 'remove_members', team: team.id, agents: [b.id] }]);
    expect(workflows.get(team.id)).toMatchObject({ members: [a.id], lead: null });
    // removing someone from a team never deletes the agent
    expect(agents.get(b.id)).not.toBeNull();
  });

  it('can delegate to the team it just built ("new")', () => {
    const a = newAgent({ name: 'Solo' });
    const r = applyActions([
      { do: 'create_team', name: 'Fresh', members: [{ agent: a.id }] },
      { do: 'delegate', to: 'team', id: 'new', message: 'Start on the launch posts.' },
    ]);
    expect(r.delegate).toMatchObject({ kind: 'branch', name: 'Fresh', message: 'Start on the launch posts.' });
  });

  it('reports unknown teams and agents instead of throwing', () => {
    const r = applyActions([
      { do: 'add_members', team: 'missing', members: [] },
      { do: 'delegate', to: 'agent', id: 'nobody', message: 'x' },
    ]);
    expect(r.delegate).toBeNull();
    expect(r.done.every((d) => d.kind === 'error')).toBe(true);
  });

  it('writes PROJECT.md and keeps the old version', () => {
    const dir = ensureBrain(activeProject());
    applyActions([{ do: 'write_project_md', content: '# Project\n\nFirst version of the brief.' }]);
    applyActions([{ do: 'write_project_md', content: '# Project\n\nSecond version of the brief.' }]);
    expect(fs.readFileSync(path.join(dir, 'PROJECT.md'), 'utf8')).toContain('Second version');
    const hist = fs.readdirSync(path.join(dir, '.brain-history'));
    expect(hist.length).toBe(1);
    expect(fs.readFileSync(path.join(dir, '.brain-history', hist[0]), 'utf8')).toContain('First version');
  });

  // (junctions need no admin rights on Windows; elsewhere 'junction' makes a plain folder link)
  it("doesn't keep the old PROJECT.md through a .brain-history link", () => {
    const dir = ensureBrain(activeProject());
    const outside = fs.mkdtempSync(path.join(os.homedir(), 'outside-history-'));
    const hist = path.join(dir, '.brain-history');
    fs.writeFileSync(path.join(dir, 'PROJECT.md'), '# Project\n\nThe brief so far.');
    fs.rmSync(hist, { recursive: true, force: true });
    fs.symlinkSync(outside, hist, 'junction');
    try {
      const r = applyActions([{ do: 'write_project_md', content: '# Project\n\nA new brief, long enough.' }]);
      expect(r.done[0].kind).toBe('error');
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(fs.readFileSync(path.join(dir, 'PROJECT.md'), 'utf8')).toContain('The brief so far');
    } finally {
      fs.rmSync(hist, { recursive: true, force: true });
    }
  });

  it("doesn't write through a PROJECT.md that links elsewhere", (ctx) => {
    const dir = ensureBrain(activeProject());
    const outside = path.join(fs.mkdtempSync(path.join(os.homedir(), 'outside-brief-')), 'precious.md');
    fs.writeFileSync(outside, 'keep me');
    const file = path.join(dir, 'PROJECT.md');
    fs.rmSync(file, { force: true });
    try {
      fs.symlinkSync(outside, file);
    } catch (e) {
      // file links need admin rights on Windows
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip();
      throw e;
    }
    try {
      const r = applyActions([{ do: 'write_project_md', content: '# Project\n\nA new brief, long enough.' }]);
      expect(r.done[0].kind).toBe('error');
      expect(fs.readFileSync(outside, 'utf8')).toBe('keep me');
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('ignores a PROJECT.md that is (almost) empty', () => {
    const r = applyActions([{ do: 'write_project_md', content: 'hi' }]);
    expect(r.done[0].kind).toBe('error');
  });
});

describe('the Brain and routines', () => {
  it('builds a team and a routine that mentions it in one answer, with a cleaned-up schedule', async () => {
    const { saveSkill } = await import('../../server/skills.ts');
    saveSkill({ name: 'Brand voice', description: 'How we sound.', body: 'Warm.' });
    newAgent({ name: 'Scout' });
    const { done } = applyActions([
      { do: 'create_team', name: 'Post Crew', members: [{ new: { name: 'Poster', specialty: 'writes posts' } }] },
      { do: 'create_routine', name: 'Morning post', text: '@Scout finds news, @Post Crew writes it up with @Brand voice.', schedule: { type: 'daily', time: '7:30', days: ['Mon', 'wednesday', 9] }, enabled: true },
    ]);
    const made = done.find((d) => d.kind === 'routine')!;
    expect(made.text).toBe('Made the routine "Morning post" (daily 07:30 Mon Wed; for Post Crew, Scout; skills: Brand voice)');
    const { getRoutine } = await import('../../server/routines.ts');
    const r = getRoutine(made.routineId!)!;
    expect(r.mentions.map((m) => `${m.kind}:${m.name}`)).toEqual(['agent:Scout', 'team:Post Crew', 'skill:Brand voice']);
    expect(r.schedule).toEqual({ type: 'daily', time: '07:30', days: [1, 3] });
    expect(r.enabled).toBe(true);
    expect(done.some((d) => d.kind === 'error')).toBe(false);
  });

  it('updates a routine by name, then deletes it', async () => {
    const { listRoutines, getRoutine } = await import('../../server/routines.ts');
    const { done: made } = applyActions([{ do: 'create_routine', name: 'Weekly report', text: '@Scout sums up the week.' }]);
    const id = made[0].routineId!;
    const { done } = applyActions([{ do: 'update_routine', routine: 'weekly report', text: '@Scout sums up the week in 5 bullets.', schedule: { type: 'interval', minutes: 1 } }]);
    expect(done[0].text).toMatch(/^Updated "Weekly report": what to do, schedule/);
    expect(getRoutine(id)!.text).toBe('@Scout sums up the week in 5 bullets.');
    expect(getRoutine(id)!.schedule).toEqual({ type: 'interval', minutes: 5 }); // at least 5 minutes
    applyActions([{ do: 'delete_routine', routine: id }]);
    expect(getRoutine(id)).toBeNull();
    expect(listRoutines().some((r) => r.name === 'Weekly report')).toBe(false);
  });

  it('says so when a routine mentions nobody, and will not run it', () => {
    const { done } = applyActions([{ do: 'create_routine', name: 'Lonely', text: 'Ask @Nobody Real to check in.' }, { do: 'run_routine', routine: 'new' }]);
    expect(done.map((d) => d.kind)).toEqual(['routine', 'error', 'error']);
    expect(done[1].text).toMatch(/doesn't mention an agent or team/);
    expect(done[2].text).toMatch(/^run_routine: .*can't run/);
  });

  it("won't rewrite the text of a routine too long for it to have seen in full", async () => {
    const { ROUTINE_TEXT_SHOWN, snapshot } = await import('../../server/overseer.ts');
    const { getRoutine } = await import('../../server/routines.ts');
    const long = `@Scout ${'checks one more source. '.repeat(Math.ceil(ROUTINE_TEXT_SHOWN / 20))}THE END`;
    const { done: made } = applyActions([{ do: 'create_routine', name: 'Long one', text: long }]);
    const id = made[0].routineId!;
    const snap = await snapshot({ fileBudget: 0 });
    expect(snap).toContain('more characters not shown');
    expect(snap).not.toContain('THE END');
    const { done } = applyActions([{ do: 'update_routine', routine: id, text: '@Scout does less.', schedule: { type: 'daily', time: '10:00' } }]);
    expect(done[0].kind).toBe('error');
    expect(done[0].text).toMatch(/too long to rewrite here/);
    expect(getRoutine(id)!.text).toBe(long);
    // its other fields can still change
    expect(applyActions([{ do: 'update_routine', routine: id, enabled: true }]).done[0].kind).toBe('routine');
    // a short routine is shown whole
    applyActions([{ do: 'create_routine', name: 'Short one', text: '@Scout says hi.\nThen waves.' }]);
    expect(await snapshot({ fileBudget: 0 })).toContain('text: @Scout says hi.\nThen waves.');
  });

  it('shows routines and skills in its snapshot', async () => {
    const { snapshot } = await import('../../server/overseer.ts');
    const snap = await snapshot({ fileBudget: 0 });
    expect(snap).toMatch(/ROUTINES \(\d+;[\s\S]*Morning post \| daily 07:30 Mon Wed \| agents: Scout \| teams: Post Crew \| skills: Brand voice \| last run: never run/);
    expect(snap).toMatch(/- id=brand-voice[^|]* \| Brand voice: How we sound\. \| given to: /);
  });
});

describe("a team's tools follow its work", () => {
  it('a goal that posts gets the Social tools, world building the world tools; other goals nothing extra', () => {
    expect(withGoalTools(['files'], 'Launch team: writes our X posts and Reddit threads')).toEqual(['files', 'social']);
    expect(withGoalTools([], 'Posts on Telegram and Discord')).toEqual(['social']);
    expect(withGoalTools([], 'World builders: build the world from WORLD.md')).toEqual(['world']);
    expect(withGoalTools([], 'A voxel harbour town')).toEqual(['world']);
    // (no false alarms on everyday words)
    expect(withGoalTools([], 'Writes a blog post and an explainer about the new world of AI')).toEqual([]);
    expect(withGoalTools(['social'], 'Tweets daily')).toEqual(['social']);
  });

  it("the Brain's team gets them even when it forgets, and a tool you take away stays away", () => {
    const eng = newAgent({ name: 'Engineer', toolGroups: ['files', 'programs'] });
    applyActions([{ do: 'create_team', name: 'Launch', description: 'Ships the app and tweets about each release', members: [{ agent: eng.id }] }]);
    const team = workflows.list().find((w) => w.name === 'Launch')!;
    expect(team.access?.toolGroups).toContain('social');
    // taken away on purpose: not put back
    applyActions([{ do: 'update_team', team: team.id, access: { tools: [] } }]);
    expect(workflows.get(team.id)!.access?.toolGroups).toEqual([]);
    // a new goal that needs them: given again
    applyActions([{ do: 'update_team', team: team.id, description: 'Posts release notes to Discord' }]);
    expect(workflows.get(team.id)!.access?.toolGroups).toEqual(['social']);
  });
});

describe('the Blacksite agents', () => {
  it("our coordinator isn't named like the Agency's Chief of Staff", async () => {
    const { STARTERS } = await import('../../server/library.ts');
    expect(STARTERS.map((x) => x.name)).toContain('Coordinator');
    expect(STARTERS.map((x) => x.name)).not.toContain('Chief of Staff');
  });
});
