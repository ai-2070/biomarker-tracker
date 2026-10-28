// Glowing things light their surroundings: every spot of glowing voxels (in objects and in every placed
// prefab copy) and every light a builder put up is a candidate, and a fixed pool of real lights goes to the
// strongest ones near where you are looking. The pool never changes size, so shaders never recompile.
import * as THREE from 'three';
import type { WorldQuality } from '../../shared/types.ts';

/** A light that could be lit: where (map units), its colour (linear 0..1), strength (0..10 like WorldLight.intensity), reach. */
export interface LightCandidate {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  strength: number;
  range: number;
  flicker: number;
  /** a spot light: where it shines and its cone (degrees) */
  spot?: { x: number; y: number; z: number; angle: number };
  /** for flicker: a number of its own */
  seed: number;
}

// (High's own cost is its finer shading: more lights there would cost it a quarter of its frames)
export const POOL_SIZE: Record<WorldQuality, { point: number; spot: number }> = { low: { point: 4, spot: 1 }, medium: { point: 8, spot: 2 }, high: { point: 8, spot: 2 } };

/** How strong a spot of glowing voxels is (0..10), from its summed glow (emissive × faces) and the voxel size. */
export function glowStrength(power: number, voxelSize: number): number {
  // the glowing area in map units², brightened by how bright it glows
  const s = Math.sqrt(Math.max(0, power) * voxelSize * voxelSize) * 0.9;
  return Math.min(6, Math.round(s * 100) / 100);
}

/** How far a light of that strength reaches (map units) when it doesn't say. */
export const reachOf = (strength: number): number => 3 + strength * 2.2;

/**
 * The candidates to light: up to `n`, the best score first. Score: strength over distance from what you look
 * at (in view sizes), so a floodlight across the street beats a candle at your feet, and both beat lights far away.
 */
export function pickLights(cands: readonly LightCandidate[], target: { x: number; y: number; z: number }, viewRadius: number, n: number, filter: (c: LightCandidate) => boolean = () => true): number[] {
  const R = Math.max(4, viewRadius);
  const scored: { i: number; s: number }[] = [];
  cands.forEach((c, i) => {
    if (!filter(c) || c.strength <= 0) return;
    const d = Math.hypot(c.x - target.x, (c.y - target.y) * 0.5, c.z - target.z);
    if (d > R * 2.5 + c.range) return;
    scored.push({ i, s: c.strength / (1 + (d / R) * (d / R) * 4) });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, n).map((x) => x.i);
}

/** A light's brightness now, 0..1 of its own: steady at 0, a lively flame or failing neon towards 1. */
export function flicker(t: number, seed: number, amount: number): number {
  if (amount <= 0) return 1;
  const a = Math.min(1, amount);
  const n = 0.5 * Math.sin(t * 7.3 + seed) + 0.3 * Math.sin(t * 13.1 + seed * 1.7) + 0.2 * Math.sin(t * 23.7 + seed * 3.1);
  return Math.max(0, Math.min(1, 1 - a * 0.45 * (1 + n)));
}

/** Strength → a three.js light's intensity. With a gentle falloff (DECAY), a light near the floor lights a pool, not a hot spot. */
const CANDELA = 3.2;
const DECAY = 1.3;

/** The fixed pool of lights in the scene. */
export class LightPool {
  readonly group = new THREE.Group();
  private points: THREE.PointLight[] = [];
  private spots: THREE.SpotLight[] = [];
  private lit: (LightCandidate | null)[] = [];
  private litSpots: (LightCandidate | null)[] = [];

  constructor(quality: WorldQuality) {
    const size = POOL_SIZE[quality];
    for (let i = 0; i < size.point; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, DECAY);
      this.points.push(l);
      this.group.add(l);
    }
    for (let i = 0; i < size.spot; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 10, Math.PI / 6, 0.5, DECAY);
      this.spots.push(l);
      this.group.add(l, l.target);
    }
    this.lit = this.points.map(() => null);
    this.litSpots = this.spots.map(() => null);
  }

  /** Gives the pool to the best candidates near `target`. */
  assign(cands: readonly LightCandidate[], target: THREE.Vector3, viewRadius: number): void {
    const pts = pickLights(cands, target, viewRadius, this.points.length, (c) => !c.spot);
    const sps = pickLights(cands, target, viewRadius, this.spots.length, (c) => !!c.spot);
    this.points.forEach((l, k) => {
      const c = pts[k] === undefined ? null : cands[pts[k]];
      this.lit[k] = c;
      if (!c) return (l.intensity = 0), undefined;
      // a little above its glowing voxels, so the floor under a lamp gets a pool of light, not a hot spot
      l.position.set(c.x, c.y + 0.35, c.z);
      l.color.setRGB(c.r, c.g, c.b);
      l.distance = c.range;
    });
    this.spots.forEach((l, k) => {
      const c = sps[k] === undefined ? null : cands[sps[k]];
      this.litSpots[k] = c;
      if (!c || !c.spot) return (l.intensity = 0), undefined;
      l.position.set(c.x, c.y, c.z);
      l.target.position.set(c.spot.x, c.spot.y, c.spot.z);
      l.target.updateMatrixWorld();
      l.angle = THREE.MathUtils.degToRad(Math.max(5, Math.min(80, c.spot.angle)));
      l.color.setRGB(c.r, c.g, c.b);
      l.distance = c.range;
    });
  }

  /** Brightness this frame (flicker). */
  tick(t: number): void {
    this.points.forEach((l, k) => {
      const c = this.lit[k];
      l.intensity = c ? c.strength * CANDELA * flicker(t, c.seed, c.flicker) : 0;
    });
    this.spots.forEach((l, k) => {
      const c = this.litSpots[k];
      l.intensity = c ? c.strength * CANDELA * 2 * flicker(t, c.seed, c.flicker) : 0;
    });
  }

  dispose(): void {
    for (const l of [...this.points, ...this.spots]) l.dispose();
    this.group.clear();
  }
}
