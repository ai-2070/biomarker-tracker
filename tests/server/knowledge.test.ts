// An agent's knowledge: only plain text files in its folders, never a link to a file elsewhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { knowledgeContext, knowledgeFiles, readKnowledge, searchKnowledge } from '../../server/knowledge.ts';

describe('knowledge files', () => {
  it('reads the plain text files in a linked folder', () => {
    const folder = fs.mkdtempSync(path.join(os.homedir(), 'kb-plain-'));
    fs.writeFileSync(path.join(folder, 'guide.md'), 'plain guide text');
    const agent = { id: 'kb-plain', knowledge: { folders: [folder] } };
    expect(knowledgeFiles(agent).map((f) => f.label)).toEqual([path.join(path.basename(folder), 'guide.md')]);
    expect(knowledgeContext(agent)).toContain('plain guide text');
  });

  it('leaves out a file link that points out of the folder', (ctx) => {
    const base = fs.mkdtempSync(path.join(os.homedir(), 'kb-link-'));
    const folder = path.join(base, 'kb');
    fs.mkdirSync(folder);
    const secret = path.join(base, 'secret.txt');
    fs.writeFileSync(secret, 'outside-sentinel-7171');
    try {
      fs.symlinkSync(secret, path.join(folder, 'reference.md'));
    } catch (e) {
      // file links need admin rights on Windows
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip();
      throw e;
    }
    const agent = { id: 'kb-link', knowledge: { folders: [folder] } };
    expect(knowledgeFiles(agent)).toEqual([]);
    expect(knowledgeContext(agent)).not.toContain('outside-sentinel');
    expect(searchKnowledge(agent, 'outside-sentinel-7171')).toEqual([]);
    expect(() => readKnowledge(agent, 'reference.md')).toThrow(/No knowledge file/);
  });
});
