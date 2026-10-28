// launch_program and open_path ask first for anything that runs code, judged on what really starts.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { riskOf } from '../../server/tools.ts';
import { launchTarget } from '../../server/programs.ts';
import { dataPath, ensureDir } from '../../server/util.ts';

describe('launch risk', () => {
  it('an interpreter with a trailing space is still an interpreter', () => {
    const dir = ensureDir(dataPath('fake-bin'));
    const node = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
    fs.writeFileSync(node, '');
    // the same program for the check and the launch
    expect(launchTarget(`${node} `, true)?.exe).toBe(node);
    expect(riskOf('launch_program', { program: `${node} `, file: 'notes.txt' })).toBe('high');
    expect(riskOf('launch_program', { program: node, file: 'notes.txt' })).toBe('high');
    expect(riskOf('launch_program', { program: ' NODE ' })).toBe('high');
  });

  it('a script handed to a program needs a yes, Adobe scripts too', () => {
    expect(riskOf('launch_program', { program: 'photoshop', file: 'x.jsx' })).toBe('high');
    expect(riskOf('launch_program', { program: 'photoshop', file: 'x.jsxbin' })).toBe('high');
    expect(riskOf('launch_program', { program: 'photoshop', file: 'x.py. ' })).toBe('high');
    expect(riskOf('open_path', { path: 'C:/x/run.jsx' })).toBe('high');
    expect(riskOf('open_path', { path: 'C:/x/run.bat  ' })).toBe('high');
    expect(riskOf('open_path', { path: 'C:/x/picture.png' })).toBe('low');
  });
});
