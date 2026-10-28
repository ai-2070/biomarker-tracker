// Images on an Outbox post: only X, up to 4, real image files inside the project's folders, 5 MB at most.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// "inside the folders" is decided by files.viewable; here, anything under a folder named allowed/ is
vi.mock('../../server/files.ts', async (orig) => ({ ...(await orig<typeof import('../../server/files.ts')>()), viewable: (p: unknown) => (typeof p === 'string' && p.includes(`${path.sep}allowed${path.sep}`) ? p : null) }));

const { checkImages } = await import('../../server/social.ts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-img-'));
fs.mkdirSync(path.join(dir, 'allowed'));
const file = (name: string, bytes = 10, where = 'allowed') => {
  const p = path.join(dir, where, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes));
  return p;
};

describe('checkImages', () => {
  it('returns nothing when there are no images', () => {
    expect(checkImages('x', undefined)).toEqual([]);
    expect(checkImages('reddit', [])).toEqual([]);
  });

  it('accepts PNG, JPEG and WebP inside the folders', () => {
    const a = [file('a.png'), file('b.jpg'), file('c.webp')];
    expect(checkImages('x', a)).toEqual(a);
  });

  it('refuses other platforms', () => {
    expect(() => checkImages('reddit', [file('a.png')])).toThrow(/only go with X/);
    expect(() => checkImages('x_dm', [file('a.png')])).toThrow(/only go with X/);
  });

  it('refuses more than 4', () => {
    expect(() => checkImages('x', [1, 2, 3, 4, 5].map((i) => file(`n${i}.png`)))).toThrow(/at most 4/);
  });

  it('refuses files outside the folders, non-images and GIFs', () => {
    expect(() => checkImages('x', [file('secret.png', 10, 'private')])).toThrow(/can't be attached/);
    expect(() => checkImages('x', [file('notes.txt')])).toThrow(/not a PNG, JPEG or WebP/);
    expect(() => checkImages('x', [file('anim.gif')])).toThrow(/not a PNG, JPEG or WebP/);
  });

  it('refuses images over 5 MB', () => {
    expect(() => checkImages('x', [file('big.png', 5 * 1024 * 1024 + 1)])).toThrow(/up to 5 MB/);
  });
});
