import { describe, expect, it } from 'vitest';
import { CHUNK, CHUNK_CELLS, countVoxels, decodeChunk, encodeChunk, fromBase64, getVoxel, hash3, materialShades, newVolume, setVoxel, toBase64, volumeBounds, voxelShade } from '../../shared/voxel.ts';

describe('voxel volumes', () => {
  it('sets and reads voxels across chunks, negative coordinates included', () => {
    const v = newVolume(0.5);
    setVoxel(v, 0, 0, 0, 1);
    setVoxel(v, -1, -1, -1, 2);
    setVoxel(v, CHUNK, 3, CHUNK * 2 + 1, 3);
    expect(getVoxel(v, 0, 0, 0)).toBe(1);
    expect(getVoxel(v, -1, -1, -1)).toBe(2);
    expect(getVoxel(v, CHUNK, 3, CHUNK * 2 + 1)).toBe(3);
    expect(getVoxel(v, 5, 5, 5)).toBe(0);
    expect(v.chunks.size).toBe(3);
    expect(countVoxels(v)).toBe(3);
    expect(volumeBounds(v)).toEqual({ min: [-1, -1, -1], max: [CHUNK, 3, CHUNK * 2 + 1] });
  });

  it('erasing where there is no chunk makes none', () => {
    const v = newVolume();
    setVoxel(v, 40, 40, 40, 0);
    expect(v.chunks.size).toBe(0);
    expect(volumeBounds(v)).toBeNull();
  });
});

describe('voxel storage', () => {
  it('base64 round-trips every length', () => {
    for (let n = 0; n < 9; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
      expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
    }
    expect(toBase64(Uint8Array.from([255, 0, 128]))).toBe('/wCA');
  });

  it('chunks round-trip, and a plain chunk is tiny', () => {
    const c = new Uint8Array(CHUNK_CELLS);
    for (let i = 0; i < c.length; i++) c[i] = i % 7 === 0 ? 0 : (i >> 6) & 255;
    expect(decodeChunk(encodeChunk(c))).toEqual(c);
    const empty = new Uint8Array(CHUNK_CELLS);
    expect(encodeChunk(empty).length).toBe(48);
    expect(decodeChunk(encodeChunk(empty))).toEqual(empty);
  });

  it('refuses a damaged chunk', () => {
    expect(() => decodeChunk(toBase64(Uint8Array.from([10, 1])))).toThrow(/damaged/);
    expect(() => decodeChunk('*not base64*')).toThrow();
  });
});

describe('voxel shading', () => {
  it('the same voxel always gets the same shade, and neighbours differ', () => {
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(1, 2, 4));
    expect(hash3(1, 2, 3, 1)).not.toBe(hash3(1, 2, 3, 2));
    const s = materialShades({ name: 'grass', color: '#608040', jitter: 0.2, kind: 'solid' });
    expect(voxelShade(s, 4, 5, 6)).toEqual(voxelShade(s, 4, 5, 6));
    const many = new Set(Array.from({ length: 20 }, (_, i) => voxelShade(s, i, 0, 0).join(',')));
    expect(many.size).toBeGreaterThan(5);
  });

  it('jitter stays within its range and shades come from the ramp', () => {
    const s = materialShades({ name: 'x', color: '#646464', ramp: ['#c8c8c8'], jitter: 0.1, kind: 'solid' });
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const [r] = voxelShade(s, i, i * 3, 7);
      seen.add(r > 150 ? 1 : 0);
      expect(r === 0 || (r >= 90 && r <= 110) || (r >= 180 && r <= 220)).toBe(true);
    }
    expect(seen.size).toBe(2);
  });

  it('a bad color shows as magenta, not an error', () => {
    expect(materialShades({ name: 'x', color: 'nope', jitter: 0, kind: 'solid' }).shades[0]).toEqual([255, 0, 255]);
  });
});
