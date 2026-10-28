import { describe, expect, it } from 'vitest';
import { cleanSummary, readBackupSummary, summaryLine } from '../../web/backup.ts';

const file = (head: string, rest = 'gzip bytes') => new Blob([head, rest]);

describe('reading what a backup holds', () => {
  it('reads the summary line of a backup file', async () => {
    const s = await readBackupSummary(file(`MY-DASHBOARD-BACKUP 1\n${JSON.stringify({ app: 'my-dashboard', name: 'Launch', agents: 3, teams: 1, skills: 2, agentList: [{ name: 'Writer', emoji: '✍️' }] })}\n`));
    expect(s).toMatchObject({ name: 'Launch', agents: 3, agentList: [{ name: 'Writer', emoji: '✍️' }], omitted: 0 });
    expect(summaryLine(s!)).toBe('3 agents · 1 team · 2 skills');
  });

  it('turns away files that are not backups', async () => {
    expect(await readBackupSummary(file('{"app":"my-dashboard"}\n{}\n'))).toBeNull();
    expect(await readBackupSummary(file('MY-DASHBOARD-BACKUP 1\nnot json\n'))).toBeNull();
    expect(await readBackupSummary(file(`MY-DASHBOARD-BACKUP 1\n${JSON.stringify({ app: 'other' })}\n`))).toBeNull();
  });

  it('fills in what a hand-made summary leaves out, so showing it never fails', async () => {
    // only "app": the page reads agentList.length and the counts
    const s = await readBackupSummary(file(`MY-DASHBOARD-BACKUP 1\n${JSON.stringify({ app: 'my-dashboard' })}\n`));
    expect(s).toMatchObject({ name: '', agents: 0, teams: 0, agentList: [] });
    expect(summaryLine(s!)).toBe('0 agents · 0 teams · 0 skills');
    // wrong types everywhere
    expect(cleanSummary({ app: 'my-dashboard', name: { x: 1 }, agents: '9', agentList: [null, 'x', { name: 7, emoji: null }, { name: 'Ok' }] })).toMatchObject({
      name: '',
      agents: 0,
      agentList: [
        { name: '', emoji: '🤖' },
        { name: 'Ok', emoji: '🤖' },
      ],
    });
    expect(cleanSummary(null)).toBeNull();
  });
});

describe('earlier versions in a backup', () => {
  it('counts them in the summary and in what a restore brought back, and reads old summaries without them', async () => {
    const { cleanSummary, summaryLine, restoredText } = await import('../../web/backup.ts');
    const s = cleanSummary({ app: 'my-dashboard', agents: 1, teams: 0, skills: 2, versions: 14 })!;
    expect(s.versions).toBe(14);
    expect(summaryLine(s)).toContain('14 earlier versions');
    expect(summaryLine(cleanSummary({ app: 'my-dashboard', agents: 1, teams: 0, skills: 2 })!)).not.toContain('earlier');
    const r = { agents: 1, teams: 0, routines: 0, chats: 0, knowledgeFiles: 0, brainFiles: 0, skills: { added: 0, same: 0, renamed: [] }, presets: { added: 0, same: 0 }, versions: 3, paused: 0, logo: false };
    expect(restoredText('P', r)).toContain('3 earlier versions');
  });
});

describe('library prefabs in a backup', () => {
  it('the summary line and the restore message mention them', async () => {
    const { restoredText } = await import('../../web/backup.ts');
    expect(summaryLine(cleanSummary({ app: 'my-dashboard', agents: 1, teams: 0, skills: 0, libraryPrefabs: 3 })!)).toBe('1 agent · 0 teams · 0 skills · 3 library prefabs');
    expect(restoredText('X', { agents: 1, teams: 0, routines: 0, chats: 0, knowledgeFiles: 0, brainFiles: 0, skills: { added: 0, same: 0, renamed: [] }, presets: { added: 0, same: 0 }, libraryPrefabs: { added: 2, same: 1 }, paused: 0, logo: false })).toBe('Restored "X": 1 agent, 0 teams and 2 library prefabs.');
  });
});
