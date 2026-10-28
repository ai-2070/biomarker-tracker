// Projects as floors: the arrow keys' steps, the faint names around the open project, the direction of a switch, and reordering.
import { describe, expect, it } from 'vitest';
import { floorDirection, moveId, neighbours, shortName, stepIndex } from '../../web/projectnav.ts';

const list = [{ name: 'My workspace' }, { name: 'NET' }, { name: 'Rose & Blade' }];

describe('stepIndex()', () => {
  it('moves one floor and stops at the ends instead of wrapping', () => {
    expect(stepIndex(3, 1, 1)).toBe(2);
    expect(stepIndex(3, 1, -1)).toBe(0);
    expect(stepIndex(3, 2, 1)).toBe(2);
    expect(stepIndex(3, 0, -1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

describe('neighbours()', () => {
  it('gives the project above and below, and nothing past the ends', () => {
    expect(neighbours(list, 1)).toEqual({ above: list[0], below: list[2] });
    expect(neighbours(list, 0)).toEqual({ above: null, below: list[1] });
    expect(neighbours(list, 2)).toEqual({ above: list[1], below: null });
    expect(neighbours([list[0]], 0)).toEqual({ above: null, below: null });
    expect(neighbours([], 0)).toEqual({ above: null, below: null });
  });
});

describe('floorDirection()', () => {
  const ids = ['a', 'b', 'c'];
  it('says which way the view moves', () => {
    expect(floorDirection(ids, 'a', 'c')).toBe(1);
    expect(floorDirection(ids, 'c', 'b')).toBe(-1);
    expect(floorDirection(ids, 'b', 'b')).toBe(0);
    expect(floorDirection(ids, 'a', 'zzz')).toBe(0);
    expect(floorDirection(ids, null, 'a')).toBe(0);
  });
});

describe('moveId()', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moves one project and keeps the rest in order', () => {
    expect(moveId(ids, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveId(ids, 'b', 1)).toEqual(ids);
  });
  it('stays inside the list, and ignores an id that is not there', () => {
    expect(moveId(ids, 'a', -5)).toEqual(ids);
    expect(moveId(ids, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveId(ids, 'nope', 1)).toEqual(ids);
  });
});

describe('shortName()', () => {
  it('keeps a name of up to 13 characters as it is', () => {
    expect(shortName('NET')).toBe('NET');
    expect(shortName('Rose & Blade')).toBe('Rose & Blade');
    expect(shortName('1234567890123')).toBe('1234567890123');
  });
  it('cuts a longer one to 13 characters, "…" included', () => {
    expect(shortName('12345678901234')).toBe('123456789012…');
    expect(shortName('My very long project name')).toBe('My very long…');
    expect([...shortName('x'.repeat(100))]).toHaveLength(13);
  });
  it('does not leave a space before the dots, and counts emoji as one character', () => {
    expect(shortName('Rose & Blade Games')).toBe('Rose & Blade…');
    expect(shortName('🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬')).toBe('🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬🎬…');
    expect(shortName('')).toBe('');
  });
});
