// Pictures for world_look (aiming the camera) and the build effect's curves.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitCamera, snapCamera, SNAP_DISTANCE } from '../../web/voxel/snapshot.ts';
import { arcAt, arcPoint, growAt, BuildFx } from '../../web/voxel/buildfx.ts';

const box = (min: [number, number, number], max: [number, number, number]) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

/** Where the box's corners land in the camera's view (-1..1 is on the picture). */
function onScreen(b: THREE.Box3, cam: THREE.Camera) {
  let mx = 0;
  let my = 0;
  const v = new THREE.Vector3();
  for (const x of [b.min.x, b.max.x])
    for (const y of [b.min.y, b.max.y])
      for (const z of [b.min.z, b.max.z]) {
        v.set(x, y, z).project(cam);
        mx = Math.max(mx, Math.abs(v.x));
        my = Math.max(my, Math.abs(v.y));
      }
  return { mx, my };
}

describe('aiming a picture', () => {
  it('fits the box on the picture with a little room, from the Station\'s angle', () => {
    const b = box([-5, 0, -3], [5, 4, 3]);
    const f = fitCamera(b, 45, 35, 1, 1.6);
    const cam = snapCamera(f);
    const { mx, my } = onScreen(b, cam);
    expect(Math.max(mx, my)).toBeGreaterThan(0.8);
    expect(Math.max(mx, my)).toBeLessThanOrEqual(1);
    expect(f.position.distanceTo(f.target)).toBeCloseTo(SNAP_DISTANCE);
    // the camera stands on the azimuth's side, up high
    expect(f.position.x - f.target.x).toBeGreaterThan(0);
    expect(f.position.z - f.target.z).toBeGreaterThan(0);
    expect(f.position.y - f.target.y).toBeGreaterThan(0);
  });

  it('zoom 2 is twice as close; another azimuth looks from the other side', () => {
    const b = box([0, 0, 0], [2, 2, 2]);
    expect(fitCamera(b, 45, 35, 2).halfHeight).toBeCloseTo(fitCamera(b, 45, 35, 1).halfHeight / 2);
    const f = fitCamera(b, 225, 35);
    expect(f.position.x - f.target.x).toBeLessThan(0);
  });

  it('straight down works (no degenerate up), and centres an off-centre box', () => {
    const b = box([10, 0, 10], [14, 1, 12]);
    const f = fitCamera(b, 45, 90, 1, 1);
    const cam = snapCamera(f);
    const { mx, my } = onScreen(b, cam);
    expect(Number.isFinite(mx) && Number.isFinite(my)).toBe(true);
    expect(Math.max(mx, my)).toBeLessThanOrEqual(1);
    const c = b.getCenter(new THREE.Vector3()).project(cam);
    expect(Math.abs(c.x)).toBeLessThan(0.05);
    expect(Math.abs(c.y)).toBeLessThan(0.05);
  });

  it('a tiny or empty box still gives a usable camera', () => {
    expect(fitCamera(box([0, 0, 0], [0.01, 0.01, 0.01])).halfHeight).toBeGreaterThanOrEqual(1);
    expect(fitCamera(new THREE.Box3()).halfHeight).toBe(1);
  });
});

describe('the build effect', () => {
  it('grows from nothing to full height with a small overshoot', () => {
    expect(growAt(0)).toBe(0);
    expect(growAt(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => growAt(i / 50)))).toBeGreaterThan(1);
    expect(growAt(0.5)).toBeGreaterThan(0.5);
  });

  it('the arc fades in fast and out slowly, and bows up between its ends', () => {
    expect(arcAt(0)).toBe(0);
    expect(arcAt(0.12)).toBeCloseTo(1);
    expect(arcAt(0.5)).toBeGreaterThan(arcAt(0.9));
    expect(arcAt(1)).toBe(0);
    const a = new THREE.Vector3(0, 0, 0);
    const b = new THREE.Vector3(20, 0, 0);
    expect(arcPoint(a, b, 0).equals(a)).toBe(true);
    expect(arcPoint(a, b, 1).distanceTo(b)).toBeLessThan(1e-9);
    expect(arcPoint(a, b, 0.5).y).toBeGreaterThan(3);
  });

  it('a growing object reaches full height and is forgotten; reduced motion skips growing', () => {
    const fx = new BuildFx(false);
    const g = new THREE.Group();
    fx.grow(g, 1000);
    expect(fx.heightOf(g, 1000)).toBeLessThan(0.01);
    expect(fx.heightOf(g, 1500)).toBeGreaterThan(0.5);
    expect(fx.heightOf(g, 3000)).toBe(1);
    const calm = new BuildFx(true);
    calm.grow(g, 0);
    expect(calm.heightOf(g, 0)).toBe(1);
    // an arc and a puff come and go
    fx.built(new THREE.Vector3(), new THREE.Vector3(10, 0, 0), '#c4ff3d', 0);
    expect(fx.group.children.length).toBe(3);
    fx.update(5000);
    expect(fx.group.children.length).toBe(0);
    fx.dispose();
  });
});
