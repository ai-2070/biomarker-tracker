// Skill folders that come with the dashboard (skills/ in the repo), and reading long skill files.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as skills from '../../server/skills.ts';
import { parseGitHubUrl } from '../../server/skillinstall.ts';
import { callTool } from '../../server/tools.ts';
import { dataPath } from '../../server/util.ts';

const agent = { id: 'a1', name: 'Tester' };

describe('bundled skills', () => {
  it('include the storytold, OOMOL, Composio, Orca, subagent and Hermes skills', () => {
    const slugs = skills.bundledSkills().map((b) => b.slug);
    expect(slugs).toEqual(expect.arrayContaining(['storytold', 'storytold-install', 'vectorcraft', 'photocraft', 'figcraft', 'oo', 'oo-find-skills', 'oo-create-skill', 'oo-publish-skill', 'composio', 'orca-cli', 'orchestration', 'computer-use', 'orca-linear', 'orca-jira', 'jira-tickets', 'orca-emulator', 'orca-emulator-android', 'orca-per-workspace-env', 'delegating-to-subagents', 'commissioning-a-reviewer', 'independent-review', 'reviewed-stage-delivery', 'witness-discipline']));
    // Hermes: the ones that fit any agent on Windows, from its built-in and optional skills
    expect(slugs).toEqual(expect.arrayContaining(['systematic-debugging', 'test-driven-development', 'github', 'pdf', 'docx', 'xlsx', 'powerpoint', 'dcf-model', 'arxiv', 'maps', 'excalidraw', 'manim-video', 'himalaya', 'obsidian', 'one-three-one-rule']));
    expect(slugs).toHaveLength(85);
    // not the ones only for Hermes itself, the Mac-only ones, or the ones that get around safety checks
    for (const s of ['hermes-agent', 'honcho', 'apple-notes', 'imessage', 'godmode', 'obliteratus', 'scrapling']) expect(slugs).not.toContain(s);
    // only Orca's current name for its Linear skill, not the old one too
    expect(slugs).not.toContain('linear-tickets');
    // only the subagent skills that fit any agent, not the ones for one repo or for oh-my-pi
    for (const s of ['net-mesh-development', 'working-in-omp', 'agent-irc', 'gauntlet-loop', 'skill-self-improvement']) expect(slugs).not.toContain(s);
    // the library holds one skill per id, so no two bundles may share one
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('remember their real folder in the repo, so Download again updates them', () => {
    for (const b of skills.bundledSkills()) {
      if (!b.origin) continue;
      // what installing from that link works out (skillinstall.ts): the same repo, branch and folder
      const link = parseGitHubUrl(b.origin.url);
      expect(`${link.owner}/${link.repo}`).toBe(b.origin.repo);
      expect(link.rest[0]).toBe(b.origin.ref);
      expect(link.rest.slice(1).join('/')).toBe(b.origin.path);
    }
    const origin = Object.fromEntries(skills.bundledSkills().map((b) => [b.slug, b.origin]));
    expect(origin.oo).toMatchObject({ repo: 'oomol-lab/oo-cli', path: 'contrib/skills/shared/oo' });
    expect(origin.composio).toMatchObject({ repo: 'ComposioHQ/skills', path: 'skills/composio' });
    expect(origin['orca-cli']).toMatchObject({ repo: 'stablyai/orca', path: 'skills/orca-cli' });
    // Hermes keeps its skills in category folders, built-in and optional apart
    expect(origin.pdf).toMatchObject({ repo: 'NousResearch/hermes-agent', path: 'skills/productivity/pdf', url: 'https://github.com/NousResearch/hermes-agent/tree/main/skills/productivity/pdf' });
    expect(origin.excalidraw).toMatchObject({ repo: 'NousResearch/hermes-agent', path: 'optional-skills/creative/excalidraw' });
    // its repo isn't public, so no link back to it
    expect(origin['independent-review']).toBeUndefined();
    expect(skills.bundledSkills().filter((b) => !b.origin).map((b) => b.slug).sort()).toEqual(['commissioning-a-reviewer', 'delegating-to-subagents', 'independent-review', 'reviewed-stage-delivery', 'witness-discipline']);
  });

  it("are added once, keep where they came from, and don't replace a skill of yours", () => {
    // a skill of yours with the same id as a bundled one
    const mine = dataPath('skills', 'cadcraft');
    fs.mkdirSync(mine, { recursive: true });
    fs.writeFileSync(path.join(mine, 'SKILL.md'), '---\nname: My CAD notes\ndescription: Mine.\n---\nmine');

    skills.ensureBuiltinSkills();
    const v = skills.getSkill('vectorcraft');
    expect(v?.name).toBe('vectorcraft');
    expect(v?.files.map((f) => f.path)).toContain('references/commands.md');
    expect(v?.origin).toMatchObject({ repo: 'hermes-pro/storytold-skills', path: 'vectorcraft', url: 'https://github.com/hermes-pro/storytold-skills/tree/main/vectorcraft' });
    expect(skills.getSkill('storytold-install')?.files.map((f) => f.path)).toContain('scripts/storytold_tools.py');
    expect(skills.getSkill('oo')?.files.map((f) => f.path)).toContain('references/connector-execution.md');
    expect(skills.getSkill('composio')?.files.map((f) => f.path)).toContain('rules/composio-cli.md');
    expect(skills.getSkill('composio')?.origin).toMatchObject({ repo: 'ComposioHQ/skills', path: 'skills/composio', url: 'https://github.com/ComposioHQ/skills/tree/main/skills/composio' });
    expect(skills.getSkill('orchestration')?.origin).toMatchObject({ repo: 'stablyai/orca', path: 'skills/orchestration', url: 'https://github.com/stablyai/orca/tree/main/skills/orchestration' });
    // Orca writes its descriptions as folded YAML ("description: >-")
    expect(skills.getSkill('orchestration')?.description).toMatch(/^Coordinate supervised Orca workers: .* coordinate a DAG, and for terminal control/);
    expect(skills.getSkill('reviewed-stage-delivery')?.files.map((f) => f.path)).toContain('references/ci-triage.md');
    expect(skills.getSkill('reviewed-stage-delivery')?.origin).toBeFalsy();
    // these descriptions are double-quoted YAML holding single quotes and dashes
    expect(skills.getSkill('independent-review')?.description).toMatch(/^Use when acting as the independent reviewer .* 'review this candidate', .*not code review of a PR for style\.$/);
    expect(skills.getSkill('cadcraft')?.name).toBe('My CAD notes');
    // a Hermes skill from a category folder comes whole, with its scripts
    expect(skills.getSkill('pdf')?.files.map((f) => f.path)).toContain('scripts/pdf_create.py');
    expect(skills.getSkill('pdf')?.origin).toMatchObject({ repo: 'NousResearch/hermes-agent', path: 'skills/productivity/pdf' });
    // nothing half-copied left behind
    expect(fs.readdirSync(dataPath('tmp')).filter((x) => x.startsWith('bundled-'))).toEqual([]);
  });

  it('include a skill of our own for starting coding agents in Orca', () => {
    skills.ensureBuiltinSkills();
    const s = skills.getSkill('orca-agents');
    expect(s?.name).toBe('Start agents in Orca');
    // Orca's ids for each agent, and the check that Orca is installed before anything starts
    for (const id of ['claude', 'codex', 'pi', 'omp', 'openclaw']) expect(s?.body).toContain(`| \`${id}\` |`);
    expect(s?.body).toContain('ORCA status --json');
    expect(s?.body).toContain('ORCA worktree create --name <short-task-name> --no-parent --agent <id> --prompt "<brief>" --json');
    expect(s?.body).toContain('ORCA agent launch --agent <id>');
    // not one of the bundled folders, so no GitHub origin
    expect(s?.origin).toBeFalsy();
    expect(skills.bundledSkills().map((b) => b.slug)).not.toContain('orca-agents');
  });

  it('drop the link to a private repo from copies added before it was marked private', () => {
    skills.ensureBuiltinSkills();
    // how 0.1.0 added them: with a link back to the repo
    const src = dataPath('skills', 'independent-review', '.source.json');
    fs.writeFileSync(src, JSON.stringify({ url: 'https://github.com/ai-2070/subagent-skills/tree/master/independent-review', repo: 'ai-2070/subagent-skills', ref: 'master', path: 'independent-review', installedAt: 1 }));
    expect(skills.getSkill('independent-review')?.origin).toBeTruthy();
    skills.ensureBuiltinSkills();
    expect(skills.getSkill('independent-review')?.origin).toBeFalsy();
    // the skill itself stays
    expect(skills.getSkill('independent-review')?.name).toBe('independent-review');
  });

  it('stay deleted once deleted', () => {
    skills.ensureBuiltinSkills();
    skills.deleteSkillEverywhere('photocraft');
    skills.ensureBuiltinSkills();
    expect(skills.getSkill('photocraft')).toBeNull();
  });
});

describe('read_skill on long files', () => {
  it('searches a file, or all of a skill\'s files, like grep', async () => {
    skills.ensureBuiltinSkills();
    const one = await callTool(agent, 'read_skill', { name: 'figcraft', file: 'references/node-properties.md', find: 'sizingH' });
    expect(one.text).toMatch(/references\/node-properties\.md:\d+: .*sizingH/);
    const all = await callTool(agent, 'read_skill', { name: 'figcraft', find: 'variable[.]set' });
    expect(all.text).toContain('references/commands.md:');
    // not a regular expression: searched as plain text
    const plain = await callTool(agent, 'read_skill', { name: 'figcraft', find: 'set_properties {ids' });
    expect(plain.text).toContain('SKILL.md:');
    expect((await callTool(agent, 'read_skill', { name: 'figcraft', find: 'no-such-words-anywhere' })).text).toContain('No line');
  });

  it('reads a file too long for one go in parts', () => {
    const s = skills.saveSkill({ name: 'Long ref', description: 'Use for long refs.', body: 'See ref.md' })!;
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1} ${'x'.repeat(30)}`);
    fs.writeFileSync(dataPath('skills', s.slug, 'ref.md'), lines.join('\n'));
    const first = skills.readSkillFile(s.slug, 'ref.md');
    expect(first.length).toBeLessThan(61000);
    const next = Number(/Go on with from=(\d+)/.exec(first)?.[1]);
    expect(first).toContain(`line ${next - 1} `);
    expect(first).not.toContain(`line ${next} `);
    const rest = skills.readSkillFile(s.slug, 'ref.md', next);
    expect(rest.startsWith(`line ${next} `)).toBe(true);
    expect(rest).toContain('line 2500 ');
    expect(rest).not.toContain('Go on with');
  });

  it("points a Hermes skill's folder at the skill in the library", async () => {
    skills.ensureBuiltinSkills();
    const r = await callTool(agent, 'read_skill', { name: 'gridcraft' });
    expect(r.text).not.toContain('${HERMES_SKILL_DIR}');
    expect(r.text).toContain(`${skills.skillDir('gridcraft').split(path.sep).join('/')}/references/functions.md`);
  });

  it("points where Hermes keeps a skill (~/.hermes/skills/<category>/<id>) at the skill in the library, and names its folder", async () => {
    skills.ensureBuiltinSkills();
    const dir = (slug: string) => skills.skillDir(slug).split(path.sep).join('/');
    const maps = await callTool(agent, 'read_skill', { name: 'maps' });
    expect(maps.text).not.toContain('.hermes/skills');
    expect(maps.text).toContain(`${dir('maps')}/scripts/maps_client.py`);
    expect(maps.text).toContain(`Files with this skill, in its folder ${dir('maps')} (`);
    // in a category folder
    const pixel = await callTool(agent, 'read_skill', { name: 'pixel-art' });
    expect(pixel.text).not.toContain('.hermes/skills');
    expect(pixel.text).toContain(`${dir('pixel-art')}/scripts`);
  });
});
