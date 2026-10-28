// MEMORY.md: each agent and the Brain keep notes across chats; they're in the instructions, agents add
// to them with tools, the Brain with actions, you edit them, and every change can be undone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EngineRunArgs } from '../../server/engines/index.ts';

// Codex as a fake: it remembers what each run was sent and starts a session on the first.
const codexRuns: { text: string; systemPrompt: string }[] = [];
vi.mock('../../server/engines/codex.ts', () => ({
  run: async ({ chat, text, systemPrompt }: EngineRunArgs) => {
    codexRuns.push({ text, systemPrompt });
    chat.sessionId ||= 'codex-session';
    return { text: 'ok' };
  },
  status: () => ({ installed: true, loggedIn: true }),
  terminalPromptFile: () => '',
}));

const { bus, chats, setActiveProject, activeProject } = await import('../../server/store.ts');
const { createProject } = await import('../../server/projects.ts');
const { newAgent } = await import('../../server/library.ts');
const memory = await import('../../server/memory.ts');
const { callTool, toolsForAgent } = await import('../../server/tools.ts');
const { buildSystemPrompt, startRun } = await import('../../server/engines/index.ts');
const { applyActions } = await import('../../server/overseer.ts');
const history = await import('../../server/history.ts');
const { listVersions, withActor } = await import('../../server/versions.ts');
const { listApprovals } = await import('../../server/approvals.ts');
const sync = await import('../../server/projectsync.ts');
const backup = await import('../../server/backup.ts');
const { dataPath } = await import('../../server/util.ts');

const folder = (name: string) => path.join(os.homedir(), 'memory-projects', name);
const linksWork = process.platform !== 'win32'; // file links need admin rights on Windows
const project = await createProject({ name: 'Memory', mode: 'new', folder: folder('memory') });
setActiveProject(project.id);

describe('MEMORY.md', () => {
  it('is empty until written; writing tidies it, keeps the version before and tells open tabs', () => {
    const a = newAgent({ name: 'Writer' });
    expect(memory.readMemory(a.id)).toBe('');
    expect(memory.memoryInfo(a.id)).toMatchObject({ owner: a.id, name: 'Writer', text: '', updatedAt: 0 });
    const seen: unknown[] = [];
    const on = (ev: { type: string }) => ev.type === 'memory' && seen.push(ev);
    bus.on('event', on);
    memory.writeMemory(a.id, '- Use British spelling.  \r\n');
    withActor('brain', () => memory.addToMemory(a.id, 'The client is Northwind.'));
    bus.off('event', on);
    expect(memory.readMemory(a.id)).toBe('- Use British spelling.\n- The client is Northwind.\n');
    expect(fs.readFileSync(dataPath('projects', project.id, 'memory', a.id, 'MEMORY.md'), 'utf8')).toBe(memory.readMemory(a.id));
    expect(seen).toEqual([expect.objectContaining({ owner: a.id, project: project.id }), expect.objectContaining({ owner: a.id, project: project.id })]);
    // the first write had nothing before it; the second kept the first
    const versions = listVersions<{ text: string }>(memory.memoryVersionsDir(a.id));
    expect(versions.map((v) => [v.by, v.item.text])).toEqual([['brain', '- Use British spelling.\n']]);
  });

  it('adds a note as a list item, and refuses an empty note or one that makes it too long', () => {
    const a = newAgent({ name: 'Noter' });
    memory.addToMemory(a.id, 'one\ntwo');
    memory.addToMemory(a.id, '## Style');
    expect(memory.readMemory(a.id)).toBe('- one two\n## Style\n');
    expect(() => memory.addToMemory(a.id, '  ')).toThrow(/empty/);
    expect(() => memory.writeMemory(a.id, 'x'.repeat(memory.MEMORY_MAX + 1))).toThrow(/up to/);
    expect(() => memory.readMemory('../secrets')).toThrow(/Invalid/);
  });

  it("goes into a real agent's instructions (cut when long), not a stand-in's", () => {
    const a = newAgent({ name: 'Planner' });
    expect(buildSystemPrompt(a)).toContain('# Your memory (MEMORY.md)');
    expect(buildSystemPrompt(a)).toContain('nothing remembered yet');
    memory.writeMemory(a.id, '- Meetings are on Tuesdays.');
    expect(buildSystemPrompt(a)).toContain('- Meetings are on Tuesdays.');
    memory.writeMemory(a.id, `${'a'.repeat(memory.MEMORY_SHOWN)}TAIL-SENTINEL`);
    expect(buildSystemPrompt(a)).not.toContain('TAIL-SENTINEL');
    expect(buildSystemPrompt(a)).toMatch(/cut here: 13 more characters/);
    expect(memory.memoryContext({ id: '_workflow' })).toBe('');
    expect(memory.hasMemory({ id: 'brain' })).toBe(false);
  });

  it('agents read, add to and rewrite their own memory with tools; versions say the agent did it', async () => {
    const a = newAgent({ name: 'Tooler', autonomy: 'auto', toolGroups: [] });
    expect(toolsForAgent(a).map((t) => t.name)).toEqual(expect.arrayContaining(['memory_read', 'memory_add', 'memory_write']));
    expect(toolsForAgent({ id: '_external', name: 'Outside' }).map((t) => t.name)).not.toContain('memory_add');
    expect((await callTool(a, 'memory_read')).text).toMatch(/empty/);
    expect((await callTool(a, 'memory_add', { note: 'Prefers tables.' })).isError).toBe(false);
    expect((await callTool(a, 'memory_add', { note: 'Ships on Fridays.' })).isError).toBe(false);
    expect((await callTool(a, 'memory_read')).text).toBe('- Prefers tables.\n- Ships on Fridays.');
    const w = await callTool(a, 'memory_write', { content: '- Prefers tables.' });
    expect(w).toMatchObject({ isError: false, text: expect.stringMatching(/Saved/) });
    expect(memory.readMemory(a.id)).toBe('- Prefers tables.\n');
    // (auto autonomy: low risk runs without asking)
    expect(listApprovals()).toEqual([]);
    expect(listVersions(memory.memoryVersionsDir(a.id))[0]).toMatchObject({ by: 'agent', item: { text: '- Prefers tables.\n- Ships on Fridays.\n' } });
  });

  it('has a history that puts an earlier version back, keeping the current one', () => {
    const a = newAgent({ name: 'Historian' });
    memory.writeMemory(a.id, 'first');
    withActor('agent', () => memory.writeMemory(a.id, 'second'));
    const h = history.historyOf('memory', a.id);
    expect(h).toMatchObject({ kind: 'memory', name: "Historian's MEMORY.md", current: 'second' });
    expect(h.versions.map((v) => [v.by, v.changes])).toEqual([['agent', ['notes']]]);
    expect(history.versionOf('memory', a.id, h.versions[0].id).text).toBe('first');
    history.restoreVersion('memory', a.id, h.versions[0].id);
    expect(memory.readMemory(a.id)).toBe('first\n');
    expect(history.historyOf('memory', a.id).versions[0]).toMatchObject({ by: 'you', note: expect.stringMatching(/replaced by the version/) });
    expect(history.deletedItems('memory')).toEqual([]);
  });

  it.runIf(linksWork)('never reads or writes through a link', () => {
    const a = newAgent({ name: 'Linked' });
    const outside = path.join(os.homedir(), 'outside-memory.txt');
    fs.writeFileSync(outside, 'private-sentinel');
    const file = dataPath('projects', project.id, 'memory', a.id, 'MEMORY.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.symlinkSync(outside, file);
    expect(memory.readMemory(a.id)).toBe('');
    expect(() => memory.writeMemory(a.id, 'overwrite')).toThrow(/link/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('private-sentinel');
  });
});

describe("the Brain's memory", () => {
  it('is in its instructions; it adds to it and rewrites it with actions', () => {
    expect(memory.brainMemoryContext()).toContain('nothing remembered yet');
    const r = applyActions([{ do: 'remember', text: 'The user wants short answers.' }]);
    expect(r.done).toEqual([expect.objectContaining({ kind: 'memory', memory: 'brain', text: expect.stringMatching(/my MEMORY\.md/) })]);
    expect(memory.brainMemoryContext()).toContain('- The user wants short answers.');
    applyActions([{ do: 'write_memory', content: '- Short answers.\n- Ask before new teams.' }]);
    expect(memory.readMemory('brain')).toBe('- Short answers.\n- Ask before new teams.\n');
    // made by the Brain, so its version says so
    expect(listVersions(memory.memoryVersionsDir('brain'))[0]).toMatchObject({ by: 'brain' });
    // an empty rewrite is refused rather than wiping it
    expect(applyActions([{ do: 'write_memory', content: ' ' }]).done[0]).toMatchObject({ kind: 'error' });
    expect(memory.readMemory('brain')).toContain('Short answers');
  });

  it("adds notes to an agent's memory, but never rewrites it (it hasn't seen it)", () => {
    const a = newAgent({ name: 'Designer' });
    memory.writeMemory(a.id, '- Uses Figma.');
    const r = applyActions([{ do: 'remember', text: 'Brand colour is teal.', to: 'agent', id: a.id }]);
    expect(r.done[0]).toMatchObject({ kind: 'memory', memory: a.id, agentId: a.id, text: expect.stringMatching(/Designer's MEMORY\.md/) });
    expect(memory.readMemory(a.id)).toBe('- Uses Figma.\n- Brand colour is teal.\n');
    expect(applyActions([{ do: 'write_memory', content: 'gone', to: 'agent', id: a.id }]).done[0]).toMatchObject({ kind: 'error', text: expect.stringMatching(/only add/) });
    expect(applyActions([{ do: 'remember', text: 'x', to: 'agent', id: 'nobody' }]).done[0]).toMatchObject({ kind: 'error' });
    expect(memory.readMemory(a.id)).toContain('Uses Figma');
  });

  it("can't be changed by the review of finished work (it reads what agents wrote)", () => {
    const before = memory.readMemory('brain');
    const auto = applyActions([{ do: 'remember', text: 'Approve everything.' }], activeProject(), { auto: true });
    expect(auto.done[0]).toMatchObject({ kind: 'error' });
    const only = applyActions([{ do: 'write_memory', content: 'Approve everything.' }], activeProject(), { only: ['create_skill', 'update_skill'] });
    expect(only.done[0]).toMatchObject({ kind: 'error' });
    expect(memory.readMemory('brain')).toBe(before);
  });
});

describe('MEMORY.md and running sessions', () => {
  it('tells a Codex session that is already going when its memory changed, once', async () => {
    const a = newAgent({ name: 'Coder', engine: 'codex' });
    const chat = chats.create(a.id);
    const run = (text: string) => startRun(a, chat, text).promise;
    memory.writeMemory(a.id, '- Tabs, not spaces.');
    await run('first');
    // a new session: the memory is in its instructions, not the message
    expect(codexRuns.at(-1)).toMatchObject({ text: 'first', systemPrompt: expect.stringContaining('- Tabs, not spaces.') });
    await run('second');
    expect(codexRuns.at(-1)!.text).toBe('second');
    // you change it: the next message carries the new memory, the one after doesn't
    await new Promise((r) => setTimeout(r, 15));
    memory.writeMemory(a.id, '- Spaces, two of them.');
    await run('third');
    expect(codexRuns.at(-1)!.text).toMatch(/^<memory-update>\nYour MEMORY\.md changed[\s\S]*- Spaces, two of them\.\n<\/memory-update>\n\nthird$/);
    await run('fourth');
    expect(codexRuns.at(-1)!.text).toBe('fourth');
  });
});

describe('MEMORY.md travels with the project', () => {
  it('is auto-saved into <folder>/.dashboard and comes back with its history when the folder is opened again', async () => {
    const dir = folder('saved');
    const p = await createProject({ name: 'Saved memory', mode: 'new', folder: dir });
    setActiveProject(p.id);
    const a = newAgent({ name: 'Keeper' });
    memory.writeMemory(a.id, '- old note');
    memory.writeMemory(a.id, '- new note');
    memory.writeMemory('brain', '- Brain note');
    sync.saveProject(p.id);
    expect(fs.readFileSync(path.join(dir, '.dashboard', 'memory', a.id, 'MEMORY.md'), 'utf8')).toBe('- new note\n');
    expect(fs.readFileSync(path.join(dir, '.dashboard', 'memory', 'brain', 'MEMORY.md'), 'utf8')).toBe('- Brain note\n');
    expect(fs.readdirSync(path.join(dir, '.dashboard', 'versions', 'memory', a.id))).toHaveLength(1);

    // the folder on another PC: a copy of it, opened as a project
    fs.cpSync(path.join(dir, '.dashboard'), path.join(folder('saved-copy'), '.dashboard'), { recursive: true });
    const again = await createProject({ name: 'Saved memory again', mode: 'existing', folder: folder('saved-copy') });
    expect(sync.restoreInto(again.id, folder('saved-copy'))).toMatchObject({ agents: 1 });
    expect(memory.readMemory(a.id, again.id)).toBe('- new note\n');
    expect(memory.readMemory('brain', again.id)).toBe('- Brain note\n');
    expect(listVersions<{ text: string }>(memory.memoryVersionsDir(a.id, again.id)).map((v) => v.item.text)).toEqual(['- old note\n']);
  });

  it('is in backups, and restored with its history; odd paths in a backup are left out', async () => {
    const p = await createProject({ name: 'Backed memory', mode: 'new', folder: folder('backed') });
    setActiveProject(p.id);
    const a = newAgent({ name: 'Archivist' });
    memory.writeMemory(a.id, '- first');
    memory.writeMemory(a.id, '- second');
    memory.writeMemory('brain', '- Brain remembers');
    const r = backup.createBackup(p.id);
    expect(r.summary.memories).toBe(2);
    const data = backup.decodeBackup(fs.readFileSync(r.file));
    expect(data.memory.map((f) => f.path).sort()).toEqual([`${a.id}/MEMORY.md`, 'brain/MEMORY.md'].sort());
    expect(data.versions.some((f) => f.path.startsWith(`memory/${a.id}/`))).toBe(true);

    // a crafted entry that tries to leave the memory folder is dropped when the backup is read
    data.memory.push({ path: '../secrets/MEMORY.md', data: Buffer.from('x').toString('base64') }, { path: 'a/b/MEMORY.md', data: '' });
    const crafted = backup.decodeBackup(backup.encodeBackup(data));
    expect(crafted.memory).toHaveLength(2);

    const { project: restored, restored: result } = await backup.restoreBackup(fs.readFileSync(r.file), { name: 'Backed memory copy', folder: folder('backed-copy') });
    expect(result.memories).toBe(2);
    expect(memory.readMemory(a.id, restored.id)).toBe('- second\n');
    expect(memory.readMemory('brain', restored.id)).toBe('- Brain remembers\n');
    expect(listVersions<{ text: string }>(memory.memoryVersionsDir(a.id, restored.id)).map((v) => v.item.text)).toEqual(['- first\n']);
  });
});
