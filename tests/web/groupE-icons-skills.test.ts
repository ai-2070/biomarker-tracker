import { afterEach, describe, expect, it, vi } from 'vitest';
import { brandColor, brandPath, icon, logo } from '../../web/icons.ts';
import { forgetSkills, loadSkills, skillsCache } from '../../web/skillpick.ts';

describe('icons', () => {
  it('finds brand logos by name', () => {
    expect(logo('Gmail')).not.toBeNull();
    expect(brandPath('gmail')?.d).toBeTruthy();
    expect(brandColor('gmail')).toMatch(/^#/);
  });

  it('ignores Object.prototype keys like "constructor"', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(logo(name)).toBeNull();
      expect(brandPath(name)).toBeNull();
      expect(brandColor(name)).toBeNull();
    }
  });

  it('falls back to the box icon for unknown or inherited names', () => {
    const box = icon('box').innerHTML;
    expect(icon('constructor').innerHTML).toBe(box);
    expect(icon('no-such-icon').innerHTML).toBe(box);
  });
});

describe('loadSkills', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetSkills();
  });

  it('does not cache a failed load, so the next one retries', async () => {
    const skills = [{ slug: 'writing', name: 'Writing' }];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'down' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ skills, claude: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    expect(await loadSkills()).toEqual([]);
    expect(skillsCache()).toEqual([]);
    expect(await loadSkills()).toEqual(skills);
    expect(fetch).toHaveBeenCalledTimes(2);
    // now cached
    expect(await loadSkills()).toEqual(skills);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
