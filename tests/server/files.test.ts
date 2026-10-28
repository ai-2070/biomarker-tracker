// Files a chat mentions: previews only inside the project's folders, and Show in Explorer / Finder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fileInfo, kindOf, reveal, viewRoots } from '../../server/files.ts';
import { ensureBrain } from '../../server/projects.ts';
import { newAgent } from '../../server/library.ts';

// never really open Explorer / Finder
const shell = vi.hoisted(() => ({ revealed: [] as string[] }));
vi.mock('../../server/util.ts', async (orig) => ({
  ...(await orig<typeof import('../../server/util.ts')>()),
  revealInShell: (p: string) => shell.revealed.push(p),
}));

const write = (p: string, body = 'x') => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, body), p);

describe('fileInfo()', () => {
  it('says what each mentioned file is, inside the project', () => {
    const brain = ensureBrain();
    const img = write(path.join(brain, 'renders', 'shot.png'));
    const vid = write(path.join(brain, 'renders', 'clip.mp4'), 'abcd');
    const doc = write(path.join(brain, 'notes', 'plan.md'));
    const [a, b, c, d] = fileInfo([img, vid, doc, path.join(brain, 'renders')]);
    expect(a).toMatchObject({ ok: true, kind: 'image', name: 'shot.png' });
    expect(b).toMatchObject({ ok: true, kind: 'video', size: 4 });
    expect(c).toMatchObject({ ok: true, kind: 'file' });
    expect(d).toMatchObject({ ok: true, kind: 'folder' });
  });

  it('tells 3D models the page can show from other files', () => {
    for (const f of ['ship.glb', 'ship.GLTF', 'part.obj', 'part.stl', 'scan.ply', 'rig.fbx']) expect(kindOf(f), f).toBe('model');
    // (a Blender scene or a Unity package can't be drawn: they stay plain files)
    for (const f of ['scene.blend', 'level.unitypackage', 'shot.png', 'notes.md']) expect(kindOf(f), f).not.toBe('model');
  });

  it('knows nothing about files outside the project, missing files, or relative paths', () => {
    const outside = write(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-')), 'secret.png'));
    const [a, b, c, d] = fileInfo([outside, path.join(ensureBrain(), 'nope.png'), 'renders/shot.png', 42]);
    expect(a).toEqual({ path: outside, ok: false });
    expect(b.ok).toBe(false);
    expect(c.ok).toBe(false);
    // (non-strings are dropped)
    expect(d).toBeUndefined();
  });

  it("an agent's own workspace folder counts", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
    newAgent({ name: 'Worker', workspace: ws });
    expect(viewRoots()).toContain(ws);
    expect(fileInfo([write(path.join(ws, 'out.webm'))])[0]).toMatchObject({ ok: true, kind: 'video' });
  });

  it('a link inside the project that points outside does not count', (ctx) => {
    const target = write(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'linked-')), 'x.png'));
    const link = path.join(ensureBrain(), 'link.png');
    try {
      fs.symlinkSync(target, link);
    } catch {
      // (no symlinks allowed here, e.g. Windows without developer mode): reported as skipped
      ctx.skip();
    }
    expect(fileInfo([link])[0].ok).toBe(false);
  });

  it('takes 50 paths at most', () => {
    expect(fileInfo(Array.from({ length: 80 }, (_, i) => `/x/${i}.png`))).toHaveLength(50);
  });
});

describe('reveal()', () => {
  it('shows a project file in Explorer / Finder', () => {
    const f = write(path.join(ensureBrain(), 'reveal', 'me.txt'));
    reveal(f);
    // (the real path as the server finds it: on Windows the native one, long names not 8.3 ones like RUNNER~1)
    expect(shell.revealed.at(-1)).toBe(fs.realpathSync.native(f));
  });

  it('refuses files outside the project, and missing ones', () => {
    const outside = write(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'out-')), 'a.txt'));
    expect(() => reveal(outside)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => reveal(path.join(ensureBrain(), 'gone.txt'))).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => reveal('relative.txt')).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('kindOf()', () => {
  it('tells images, videos, audio, files and folders apart', () => {
    expect(['a.PNG', 'b.jpeg', 'c.mov', 'd.m4a', 'e.pdf'].map((p) => kindOf(p))).toEqual(['image', 'image', 'video', 'audio', 'file']);
    expect(kindOf('x', true)).toBe('folder');
  });
});
