// A team's symbol on the Station map: an emoji (default 💬), or a picture or 3D model of its own.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflows, projectData } from '../../server/store.ts';
import { cleanMark, markFile, removeMarkFile, setMarkFile, DEFAULT_MARK } from '../../server/teammark.ts';
import type { Team } from '../../shared/types.ts';

// a real 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const GLB = `data:application/octet-stream;base64,${Buffer.concat([Buffer.from('glTF'), Buffer.alloc(40)]).toString('base64')}`;
const team = (name: string): Team => workflows.save({ name, description: '', members: [], lead: null, steps: [], schedule: { type: 'none' }, enabled: false } as unknown as Team);
const files = () => fs.readdirSync(path.join(projectData('team-marks')));

describe('cleanMark()', () => {
  it('keeps an emoji, and anything else becomes the default (empty)', () => {
    expect(DEFAULT_MARK).toBe('💬');
    expect(cleanMark('🎬')).toBe('🎬');
    expect(cleanMark('  🎧  ')).toBe('🎧');
    expect(cleanMark('👨‍💻')).toBe('👨‍💻'); // joined emoji count as one
    expect(cleanMark('@')).toBe('');
    expect(cleanMark('hello')).toBe('');
    expect(cleanMark('<script>')).toBe('');
    expect(cleanMark('🎬'.repeat(10))).toBe('');
    expect(cleanMark(42)).toBe('');
    expect(cleanMark(null)).toBe('');
  });
});

describe('a team picture or 3D model', () => {
  it('saves a picture and a model, one at a time, and says which it is', () => {
    const t = team('Mark one');
    const pic = setMarkFile(t.id, 'logo.png', PNG);
    expect(pic.markFile).toMatchObject({ kind: 'image', ext: 'png' });
    expect(markFile(pic)).toBe(path.join(projectData('team-marks'), `${t.id}.png`));
    const model = setMarkFile(t.id, 'ship.glb', GLB);
    expect(model.markFile).toMatchObject({ kind: 'model', ext: 'glb' });
    // the picture went when the model came
    expect(files().filter((f) => f.startsWith(t.id))).toEqual([`${t.id}.glb`]);
    expect(workflows.get(t.id)?.markFile?.kind).toBe('model');
  });

  it("checks the name and what is really in the file", () => {
    const t = team('Mark two');
    expect(() => setMarkFile(t.id, 'x.exe', PNG)).toThrow(/Pick a picture/);
    expect(() => setMarkFile(t.id, 'x.svg', 'data:image/svg+xml;base64,PHN2Zy8+')).toThrow(/Pick a picture/);
    // a "picture" that is really a script, and a "model" that is really text
    expect(() => setMarkFile(t.id, 'x.png', `data:image/png;base64,${Buffer.from('<svg onload="x"/>').toString('base64')}`)).toThrow(/isn't a real \.png/);
    expect(() => setMarkFile(t.id, 'x.glb', `data:;base64,${Buffer.from('plain words').toString('base64')}`)).toThrow(/isn't a real \.glb/);
    expect(() => setMarkFile(t.id, 'x.png', 'not a data url')).toThrow(/read that file/);
    expect(() => setMarkFile('nope', 'x.png', PNG)).toThrow(/No such team/);
    expect(workflows.get(t.id)?.markFile ?? null).toBeNull();
  });

  it('refuses a picture over 3 MB and a model over 15 MB', () => {
    const t = team('Mark three');
    const bigPng = Buffer.concat([Buffer.from(PNG.split(',')[1], 'base64'), Buffer.alloc(3 * 1024 * 1024)]);
    expect(() => setMarkFile(t.id, 'big.png', `data:image/png;base64,${bigPng.toString('base64')}`)).toThrow(/too big/);
    const bigGlb = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(15 * 1024 * 1024)]);
    expect(() => setMarkFile(t.id, 'big.glb', `data:;base64,${bigGlb.toString('base64')}`)).toThrow(/too big/);
  });

  it('goes back to the emoji when removed', () => {
    const t = team('Mark four');
    setMarkFile(t.id, 'ship.glb', GLB);
    const back = removeMarkFile(t.id);
    expect(back.markFile).toBeNull();
    expect(markFile(back)).toBeNull();
    expect(files().filter((f) => f.startsWith(t.id))).toEqual([]);
  });

  it('never reaches a file outside the team-marks folder', () => {
    expect(() => markFile({ id: '../secrets', markFile: { kind: 'image', ext: 'png', at: 1 } })).toThrow(/No such team/);
    expect(markFile({ id: 'x', markFile: { kind: 'image', ext: 'exe', at: 1 } })).toBeNull();
  });
});
