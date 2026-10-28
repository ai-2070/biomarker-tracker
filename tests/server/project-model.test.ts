// A project's 3D model (kept in <folder>/.dashboard, shown in the Brain's globe in place of the logo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, looksLikeModel, modelFile, removeModel, setModel, withLogo } from '../../server/projects.ts';

const folder = (name: string) => path.join(os.homedir(), 'projects', name);
const url = (buf: Buffer | string) => `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
// the first bytes of real files of each kind
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(40)]);
const STL_ASCII = 'solid cube\nendsolid cube\n';
const OBJ = '# a triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
const PLY = 'ply\nformat ascii 1.0\nend_header\n';

describe('looksLikeModel()', () => {
  it('accepts the start of each kind of model', () => {
    expect(looksLikeModel('glb', GLB)).toBe(true);
    expect(looksLikeModel('gltf', Buffer.from('{"asset":{"version":"2.0"},"scenes":[]}'))).toBe(true);
    expect(looksLikeModel('obj', Buffer.from(OBJ))).toBe(true);
    expect(looksLikeModel('stl', Buffer.from(STL_ASCII))).toBe(true);
    expect(looksLikeModel('ply', Buffer.from(PLY))).toBe(true);
    expect(looksLikeModel('fbx', Buffer.from('Kaydara FBX Binary  \0'))).toBe(true);
    // a binary STL: 80-byte header, a count of 1, and one 50-byte triangle
    const bin = Buffer.alloc(84 + 50);
    bin.writeUInt32LE(1, 80);
    expect(looksLikeModel('stl', bin)).toBe(true);
  });

  it('refuses anything else, whatever its name says', () => {
    expect(looksLikeModel('glb', Buffer.from('<html>not a model</html>'))).toBe(false);
    expect(looksLikeModel('gltf', Buffer.from('{"hello":1}'))).toBe(false);
    expect(looksLikeModel('obj', Buffer.from('just some words'))).toBe(false);
    expect(looksLikeModel('stl', Buffer.alloc(200))).toBe(false);
    expect(looksLikeModel('ply', Buffer.from('plain'))).toBe(false);
    expect(looksLikeModel('exe', GLB)).toBe(false);
  });
});

describe('project 3D model', () => {
  it('saves a model into the project folder and reports its type and when it changed', async () => {
    const p = await createProject({ name: 'Model one', mode: 'new', folder: folder('model-one') });
    expect(withLogo(p)).toMatchObject({ modelAt: null, modelExt: null });
    const after = setModel(p.id, 'ship.glb', url(GLB));
    expect(modelFile(p)).toBe(path.join(p.brainPath, '.dashboard', 'brain-model.glb'));
    expect(after.modelAt).toBeTypeOf('number');
    expect(after.modelExt).toBe('glb');
    // (the logo is its own thing and stays as it was)
    expect(after.logoAt).toBeNull();
  });

  it('replaces the old model, even when the new one is another type', async () => {
    const p = await createProject({ name: 'Model two', mode: 'new', folder: folder('model-two') });
    setModel(p.id, 'ship.glb', url(GLB));
    setModel(p.id, 'part.obj', url(OBJ));
    expect(fs.readdirSync(path.join(p.brainPath, '.dashboard')).filter((n) => n.startsWith('brain-model.'))).toEqual(['brain-model.obj']);
    expect(withLogo(p).modelExt).toBe('obj');
  });

  it("checks the file's name and what is really in it", async () => {
    const p = await createProject({ name: 'Model three', mode: 'new', folder: folder('model-three') });
    expect(() => setModel(p.id, 'ship.exe', url(GLB))).toThrow(/Pick a 3D model/);
    expect(() => setModel(p.id, 'ship.blend', url(GLB))).toThrow(/Pick a 3D model/);
    expect(() => setModel(p.id, 'ship.glb', url('<script>alert(1)</script>'))).toThrow(/isn't a real \.glb/);
    expect(() => setModel(p.id, 'ship.glb', 'not a data url')).toThrow(/read that file/);
    expect(modelFile(p)).toBeNull();
  });

  it('refuses models over 15 MB', async () => {
    const p = await createProject({ name: 'Model four', mode: 'new', folder: folder('model-four') });
    const big = Buffer.concat([GLB, Buffer.alloc(15 * 1024 * 1024)]);
    expect(() => setModel(p.id, 'big.glb', url(big))).toThrow(/too big/);
  });

  it('removes the model', async () => {
    const p = await createProject({ name: 'Model five', mode: 'new', folder: folder('model-five') });
    setModel(p.id, 'ship.glb', url(GLB));
    expect(removeModel(p.id)).toMatchObject({ modelAt: null, modelExt: null });
    expect(modelFile(p)).toBeNull();
  });
});
