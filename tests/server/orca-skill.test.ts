// With Orca on the PC, a project that is created or opened gives all its agents "Start agents in Orca".
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProject, updateProject } from '../../server/projects.ts';
import { ORCA_SKILL, enableOrcaSkill, ensureBuiltinSkills } from '../../server/skills.ts';
import { orcaInstalled } from '../../server/programs.ts';
import { clearWhichCache, dataPath, ensureDir } from '../../server/util.ts';
import { listProjects } from '../../server/store.ts';

const skillsOf = (id: string) => listProjects().find((p) => p.id === id)?.skills || [];

describe('Start agents in Orca, for every agent in a project', () => {
  beforeAll(() => ensureBuiltinSkills());

  it('is added to the project when Orca is installed', async () => {
    const p = await createProject({ name: 'With Orca' });
    updateProject(p.id, { skills: ['self-improvement'] });
    expect(enableOrcaSkill(p.id, true)?.skills).toEqual(['self-improvement', ORCA_SKILL]);
    expect(skillsOf(p.id)).toEqual(['self-improvement', ORCA_SKILL]);
  });

  it('is added once, however often the project is opened', async () => {
    const p = await createProject({ name: 'Opened twice' });
    enableOrcaSkill(p.id, true);
    expect(enableOrcaSkill(p.id, true)).toBeNull();
    expect(skillsOf(p.id).filter((s) => s === ORCA_SKILL)).toHaveLength(1);
  });

  it('is left out when Orca is not installed', async () => {
    const p = await createProject({ name: 'Without Orca' });
    expect(enableOrcaSkill(p.id, false)).toBeNull();
    expect(skillsOf(p.id)).not.toContain(ORCA_SKILL);
  });

  it('does nothing for a project that is not there', () => {
    expect(enableOrcaSkill('nope', true)).toBeNull();
  });
});

describe('finding Orca', () => {
  const before = process.env.ORCA_CLI_COMMAND;
  afterEach(() => {
    if (before === undefined) delete process.env.ORCA_CLI_COMMAND;
    else process.env.ORCA_CLI_COMMAND = before;
    clearWhichCache();
  });

  it('counts the command named in ORCA_CLI_COMMAND', () => {
    const exe = path.join(ensureDir(dataPath('tmp', 'fake-orca')), process.platform === 'win32' ? 'orca.cmd' : 'orca');
    fs.writeFileSync(exe, '');
    process.env.ORCA_CLI_COMMAND = exe;
    clearWhichCache();
    expect(orcaInstalled()).toBe(true);
  });
});
