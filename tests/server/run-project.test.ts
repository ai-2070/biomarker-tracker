// A run keeps working in the project it started in, even when you open another project meanwhile.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeProject, agents, chats, openProject, runs, saveSettings, setActiveProject, withProject, workflows } from '../../server/store.ts';
import { createProject } from '../../server/projects.ts';
import { dataPath, readJSON } from '../../server/util.ts';
import { newAgent } from '../../server/library.ts';
import { activeRuns, runInfo, startRun, stopRun } from '../../server/engines/index.ts';
import { listRuns, saveRoutine, startRoutine } from '../../server/routines.ts';
import { startWorkflow } from '../../server/workflows.ts';
import type { Team } from '../../shared/types.ts';

// A fake model. Each request waits until the test releases it; the first answer of a conversation
// asks for write_file with a relative path, the answer after the tool result is plain text.
let server: http.Server;
const held: { release: () => void }[] = [];
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock' }] }));
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body) as { messages: { role: string; content: string | null }[] };
    await new Promise<void>((release) => held.push({ release }));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if (j.messages.at(-1)?.role === 'tool') send({ content: 'Saved it.' }, 'stop');
    else send({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'out.txt', content: 'from-project-a-run' }) } }] }, 'tool_calls');
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  saveSettings({ providers: { custom: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, label: 'Fake model' } } });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};
const release = async () => {
  await until(() => held.length > 0);
  held.shift()!.release();
};
const folder = (name: string) => path.join(os.homedir(), 'run-projects', name);
const filesAgent = () => newAgent({ name: 'Writer', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: ['files'], autonomy: 'auto' });

describe('withProject()', () => {
  it('pins the project across awaits; openProject() still sees the one that is open', async () => {
    const a = await createProject({ name: 'Pin A', mode: 'new', folder: folder('pin-a') });
    const b = await createProject({ name: 'Pin B', mode: 'new', folder: folder('pin-b') });
    expect(activeProject().id).toBe(b.id);
    await withProject(a, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(activeProject().id).toBe(a.id);
      expect(openProject().id).toBe(b.id);
    });
    expect(activeProject().id).toBe(b.id);
  });
});

describe('a run', () => {
  it('writes its files and chat into the project it started in, after you open another', async () => {
    const a = await createProject({ name: 'Run A', mode: 'new', folder: folder('run-a') });
    const agent = filesAgent();
    const chat = chats.create(agent.id);
    const { runId, promise } = startRun(agent, chat, 'Write the file');
    const b = await createProject({ name: 'Run B', mode: 'new', folder: folder('run-b') });
    expect(activeProject().id).toBe(b.id);
    expect(runInfo(runId)?.project.id).toBe(a.id);
    await release(); // the write_file call
    await release(); // the answer after it
    expect(await promise).toBe('Saved it.');

    expect(fs.readFileSync(path.join(a.brainPath, 'out.txt'), 'utf8')).toBe('from-project-a-run');
    expect(fs.existsSync(path.join(b.brainPath, 'out.txt'))).toBe(false);
    setActiveProject(a.id);
    expect(chats.get(agent.id, chat.id)!.items.map((i) => i.type)).toEqual(['user', 'tool', 'assistant']);
    setActiveProject(b.id);
    expect(chats.list(agent.id)).toEqual([]);
    expect(agents.get(agent.id)).toBeNull();
  });

  it("a workflow's record and agent steps stay in its project", async () => {
    const a = await createProject({ name: 'Flow A', mode: 'new', folder: folder('flow-a') });
    const agent = filesAgent();
    const wf = workflows.save({ name: 'Write it', steps: [{ id: 's1', type: 'agent', agentId: agent.id, label: 'Write', prompt: '{{input}}' }] } as Partial<Team>);
    const run = await startWorkflow(wf.id, 'go');
    await until(() => held.length > 0);
    const b = await createProject({ name: 'Flow B', mode: 'new', folder: folder('flow-b') });
    await release();
    await release();
    setActiveProject(a.id);
    await until(() => runs.get(run.id)?.status !== 'running');
    expect(runs.get(run.id)).toMatchObject({ status: 'done', output: 'Saved it.' });
    expect(fs.readFileSync(path.join(a.brainPath, 'out.txt'), 'utf8')).toBe('from-project-a-run');
    setActiveProject(b.id);
    expect(runs.get(run.id)).toBeNull();
    expect(fs.existsSync(path.join(b.brainPath, 'out.txt'))).toBe(false);
  });

  it("a routine's record and agent stay in its project", async () => {
    const a = await createProject({ name: 'Routine A', mode: 'new', folder: folder('routine-a') });
    newAgent({ name: 'Scribe', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: ['files'], autonomy: 'auto' });
    const r = saveRoutine({ name: 'Write it down', text: '@Scribe write the file.' });
    const run = await startRoutine(r.id);
    await until(() => held.length > 0);
    const b = await createProject({ name: 'Routine B', mode: 'new', folder: folder('routine-b') });
    await release();
    await release();
    // wait for it to finish while B is still open, reading A's record straight from disk
    const record = () => readJSON<{ status?: string }>(dataPath('projects', a.id, 'routine-runs', `${run.id}.json`), {});
    await until(() => record().status !== 'running');
    expect(activeProject().id).toBe(b.id);
    expect(record()).toMatchObject({ status: 'done' });
    expect(listRuns()).toEqual([]);
    expect(fs.readFileSync(path.join(a.brainPath, 'out.txt'), 'utf8')).toBe('from-project-a-run');
    setActiveProject(a.id);
    expect(listRuns(r.id)[0]).toMatchObject({ id: run.id, status: 'done' });
  });

  it("a routine whose agent's run is stopped directly ends stopped, not done", async () => {
    await createProject({ name: 'Routine stop', mode: 'new', folder: folder('routine-stop') });
    newAgent({ name: 'Stoppable', engine: 'openai', provider: 'custom', model: 'mock', toolGroups: [] });
    const r = saveRoutine({ name: 'Stop me', text: '@Stoppable do the thing.' });
    const run = await startRoutine(r.id);
    await until(() => held.length > 0);
    stopRun(activeRuns().find((x) => x.parentRunId === run.id)!.id);
    held.shift()!.release(); // let the fake model's request finish
    await until(() => listRuns(r.id)[0]?.status !== 'running');
    expect(listRuns(r.id)[0]).toMatchObject({ status: 'stopped', targets: [expect.objectContaining({ status: 'stopped' })] });
  });
});
