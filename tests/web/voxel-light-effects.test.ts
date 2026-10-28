import { describe, expect, it } from 'vitest';
import { flicker, glowStrength, pickLights, reachOf } from '../../web/voxel/lights.ts';
import type { LightCandidate } from '../../web/voxel/lights.ts';
import { countFor, fitToCap, makeParticles, stepFalling, stepRising, stepWander } from '../../web/voxel/effects.ts';
import { ease, lerpAngle, lerpColor, lerpEnv } from '../../web/voxel/envblend.ts';
import { SlowWatch, lowerQuality } from '../../web/voxel/quality.ts';
import { envPreset } from '../../shared/worldenv.ts';

const cand = (x: number, strength: number, extra: Partial<LightCandidate> = {}): LightCandidate => ({ x, y: 1, z: 0, r: 1, g: 1, b: 1, strength, range: reachOf(strength), flicker: 0, seed: x, ...extra });

describe('lights', () => {
  it('picks the strongest near where you look, and leaves far ones out', () => {
    const c = [cand(0, 1.5), cand(2, 4), cand(30, 10), cand(500, 10), cand(-1, 0)];
    expect(pickLights(c, { x: 0, y: 0, z: 0 }, 20, 2)).toEqual([1, 0]);
    // a floodlight across the street beats a candle at your feet once the view is wide enough
    expect(pickLights(c, { x: 0, y: 0, z: 0 }, 60, 1)).toEqual([2]);
    // nothing beyond reach, nothing with no strength
    expect(pickLights(c, { x: 0, y: 0, z: 0 }, 20, 10)).not.toContain(3);
    expect(pickLights(c, { x: 0, y: 0, z: 0 }, 20, 10)).not.toContain(4);
    expect(pickLights(c, { x: 0, y: 0, z: 0 }, 20, 10, (x) => !!x.spot)).toEqual([]);
  });

  it('glow strength grows with glowing area and stays capped', () => {
    expect(glowStrength(0, 0.25)).toBe(0);
    expect(glowStrength(100, 0.125)).toBeGreaterThan(glowStrength(50, 0.125));
    expect(glowStrength(1e9, 1)).toBe(6);
  });

  it('flicker stays between 0 and 1, and a steady light is steady', () => {
    for (let t = 0; t < 20; t += 0.37) {
      expect(flicker(t, 3, 0)).toBe(1);
      const f = flicker(t, 3, 1);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    const values = Array.from({ length: 50 }, (_, i) => flicker(i * 0.1, 1, 0.6));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.1);
  });
});

describe('effects', () => {
  let a = 1;
  const rnd = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
  const box = { w: 10, h: 6, d: 8 };
  const inside = (p: ReturnType<typeof makeParticles>) => {
    for (let i = 0; i < p.n; i++) {
      expect(Math.abs(p.pos[i * 3])).toBeLessThanOrEqual(box.w / 2 + 1e-6);
      expect(p.pos[i * 3 + 1]).toBeGreaterThanOrEqual(0);
      expect(p.pos[i * 3 + 1]).toBeLessThanOrEqual(box.h + 1e-6);
      expect(Math.abs(p.pos[i * 3 + 2])).toBeLessThanOrEqual(box.d / 2 + 1e-6);
    }
  };

  it('falling particles stay in their box and come back at the top', () => {
    const p = makeParticles(200, box, rnd);
    let recycled = false;
    for (let s = 0; s < 400; s++) {
      const before = p.pos[1];
      stepFalling(p, box, 0.05, { fall: 2, sway: 0.5, wind: [3, 0, -2] }, rnd);
      if (p.pos[1] > before) recycled = true;
      inside(p);
    }
    expect(recycled).toBe(true);
  });

  it('rising and wandering particles stay in their box', () => {
    const p = makeParticles(100, box, rnd);
    for (let s = 0; s < 300; s++) (stepRising(p, box, 0.05, { rise: 1, spread: 1, life: 2, wind: [1, 0, 0], gravity: 3 }, rnd), inside(p));
    const q = makeParticles(100, box, rnd);
    for (let s = 0; s < 300; s++) (stepWander(q, box, 0.05, 1, rnd), inside(q));
  });

  it('counts follow the area and the amount, and share the cap', () => {
    expect(countFor('snow', { w: 10, h: 5, d: 10 }, 1)).toBe(60);
    expect(countFor('snow', { w: 10, h: 5, d: 10 }, 0.5)).toBe(30);
    expect(countFor('birds', box, 1)).toBe(20);
    expect(fitToCap([100, 300], 1000)).toEqual([100, 300]);
    expect(fitToCap([1000, 3000], 2000)).toEqual([500, 1500]);
  });
});

describe('time of day blending', () => {
  it('eases colours, numbers and the sun the short way round', () => {
    expect(lerpColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(lerpColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(lerpAngle(350, 10, 0.5)).toBe(360);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    const a = envPreset('day');
    const b = envPreset('night');
    expect(lerpEnv(a, b, 0).sky.top).toBe(a.sky.top);
    expect(lerpEnv(a, b, 1)).toEqual(b);
    const mid = lerpEnv(a, b, 0.5);
    expect(mid.exposure).toBeCloseTo((a.exposure + b.exposure) / 2);
    expect(mid.sun.intensity).toBeCloseTo((a.sun.intensity + b.sun.intensity) / 2);
    expect(mid.preset).toBe('night');
  });
});

describe('stepping down when slow', () => {
  it('steps down once frames stay slow for a few seconds, not for a short stall', () => {
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('low')).toBeNull();
    const w = new SlowWatch('high');
    // warming up: slow frames don't count yet
    let said = false;
    for (let i = 0; i < 100; i++) said ||= w.frame(40);
    expect(said).toBe(false);
    // then four seconds of them
    for (let i = 0; i < 90; i++) said ||= w.frame(40);
    expect(said).toBe(false);
    for (let i = 0; i < 20; i++) said ||= w.frame(40);
    expect(said).toBe(true);
    // only once
    expect(w.frame(40)).toBe(false);
    const fast = new SlowWatch('medium');
    for (let i = 0; i < 2000; i++) expect(fast.frame(i % 50 === 0 ? 120 : 16)).toBe(false);
    // nothing below low
    const low = new SlowWatch('low');
    for (let i = 0; i < 500; i++) expect(low.frame(80)).toBe(false);
  });

  it("frames held back on purpose (30 or 15 a second) aren't slowness; ones late for their aim are", () => {
    const still = new SlowWatch('high');
    for (let i = 0; i < 600; i++) expect(still.frame(i % 4 ? 33.4 : 50, 1000 / 30)).toBe(false);
    const away = new SlowWatch('high');
    for (let i = 0; i < 300; i++) expect(away.frame(66.7, 1000 / 15)).toBe(false);
    const late = new SlowWatch('high');
    let said = false;
    for (let i = 0; i < 300; i++) said ||= late.frame(50, 1000 / 30);
    expect(said).toBe(true);
  });
});
