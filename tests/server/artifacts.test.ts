// What can be handed in as an artifact: a file or folder inside the project's folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, Team } from '../../shared/types.ts';

// "inside the folders" is decided by files.viewable; here, anything under a folder named allowed/ is
vi.mock('../../server/files.ts', async (orig) => ({ ...(await orig<typeof import('../../server/files.ts')>()), viewable: (p: unknown) => (typeof p === 'string' && p.includes(`${path.sep}allowed${path.sep}`) ? p : null) }));

const { checkTarget, addArtifact } = await import('../../server/artifacts.ts');
const { agents, workflows } = await import('../../server/store.ts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-'));
fs.mkdirSync(path.join(dir, 'allowed', 'renders'), { recursive: true });
fs.writeFileSync(path.join(dir, 'allowed', 'cut.mp4'), 'x');
fs.mkdirSync(path.join(dir, 'private'));

describe('checkTarget', () => {
  it('knows a file from a folder', () => {
    expect(checkTarget(path.join(dir, 'allowed', 'cut.mp4')).kind).toBe('file');
    expect(checkTarget(path.join(dir, 'allowed', 'renders')).kind).toBe('folder');
  });

  it('refuses paths outside the project folders', () => {
    expect(() => checkTarget(path.join(dir, 'private'))).toThrow(/can't be saved as an artifact/);
  });

  it('refuses a path that is not there', () => {
    expect(() => checkTarget(path.join(dir, 'allowed', 'gone.mp4'))).toThrow(/isn't there/);
  });
});

describe('addArtifact', () => {
  it('needs a title and something to hand in', () => {
    expect(() => addArtifact({ title: '  ', text: 'done' })).toThrow(/title/);
    expect(() => addArtifact({ title: 'Cut' })).toThrow(/path to a file or folder, or the text/);
  });

  it('works next to an old step-list team, and finds the team an agent is on through its steps', () => {
    const solo = agents.save({ name: 'Solo writer', engine: 'openai', toolGroups: [] } as Partial<Agent> as Agent);
    const stepper = agents.save({ name: 'Stepper', engine: 'openai', toolGroups: [] } as Partial<Agent> as Agent);
    // (no members field: its agents are in its steps)
    const steps = workflows.save({ name: 'Step team', steps: [{ type: 'agent', agentId: stepper.id }] } as Partial<Team>);
    expect(addArtifact({ title: 'Notes', text: 'done', agentId: solo.id })).toMatchObject({ teamId: null });
    expect(addArtifact({ title: 'Brief', text: 'done', agentId: stepper.id })).toMatchObject({ teamId: steps.id, teamName: 'Step team' });
  });
});
