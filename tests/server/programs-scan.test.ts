// Finding this PC's programs is slow: it runs in the background at most once an hour, and the Brain and
// agents read the last result instead of waiting for a scan.
import { describe, expect, it } from 'vitest';
import { discoverPrograms, knownPrograms } from '../../server/programs.ts';

describe('the program scan', () => {
  it('is read right away, without waiting for a scan', () => {
    // a plain list, not a promise: nothing to wait for
    expect(Array.isArray(knownPrograms())).toBe(true);
  });

  it('scans once, then hands out the same list until the hour is up', async () => {
    const first = await discoverPrograms();
    expect(await discoverPrograms()).toBe(first);
    expect(knownPrograms()).toBe(first);
  }, 30_000);

  it('scans again when asked to (Rescan on the Programs page)', async () => {
    const before = await discoverPrograms();
    expect(await discoverPrograms(true)).not.toBe(before);
  }, 30_000);
});
