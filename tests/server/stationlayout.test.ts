// The Station's layout, shared by the page (drawing it) and world_info (telling builders): checked against
// three.js doing what the page did before it was shared.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FIRST, benchSpot, platformRadius, teamSpots } from '../../shared/stationlayout.ts';

const all = () => true;

describe('team platforms', () => {
  it('one team stands on the far side of the Brain; with the Bench the front stays open', () => {
    const [t] = teamSpots([{ id: 't', members: ['a', 'b'] }], { benchCount: 0, hasAgent: all });
    expect(Math.hypot(...t.center)).toBeCloseTo(FIRST + 6);
    expect(t.center[0]).toBeCloseTo(-(FIRST + 6));
    const [b] = teamSpots([{ id: 't', members: ['a'] }], { benchCount: 1, hasAgent: all });
    // the Bench is at 45° (+x, +z): the team is opposite it
    expect(b.center[0]).toBeLessThan(0);
    expect(b.center[1]).toBeLessThan(0);
  });

  it('desks are where the page put them: in the platform, turned with it, the lead toward the Brain', () => {
    const team = { id: 't', members: ['a', 'b', 'c', 'gone'], lead: 'c', pos: { x: 30, z: -12 }, rot: 0.7 };
    const [sp] = teamSpots([team], { benchCount: 0, hasAgent: (id) => id !== 'gone' });
    expect(sp.center).toEqual([30, -12]);
    expect(sp.radius).toBeCloseTo(platformRadius(3));
    expect(sp.desks.map((d) => d.agentId)).toEqual(['c', 'a', 'b']);
    // three.js: the pod at its spot, turned by -spin; desks in its frame, the lead on the Brain's side
    const pod = new THREE.Group();
    pod.position.set(30, 0, -12);
    pod.rotation.y = -0.7;
    pod.updateMatrixWorld(true);
    const toBrain = pod.worldToLocal(new THREE.Vector3(0, 0, 0)).setY(0);
    const base = Math.atan2(toBrain.z, toBrain.x);
    sp.desks.forEach((d, k) => {
      const a = base + (k / 3) * Math.PI * 2;
      const local = new THREE.Vector3(Math.cos(a) * (sp.radius - 1.55), 0, Math.sin(a) * (sp.radius - 1.55));
      expect(d.local[0]).toBeCloseTo(local.x);
      expect(d.local[1]).toBeCloseTo(local.z);
      const world = pod.localToWorld(local.clone());
      expect(d.at[0]).toBeCloseTo(world.x);
      expect(d.at[1]).toBeCloseTo(world.z);
    });
    // the lead's desk is the nearest to the Brain
    const near = [...sp.desks].sort((x, y) => Math.hypot(...x.at) - Math.hypot(...y.at))[0];
    expect(near.agentId).toBe('c');
    expect(near.lead).toBe(true);
  });

  it('an angle picked for a team wins over its turn in the ring', () => {
    const [t] = teamSpots([{ id: 't', members: ['a'], angle: Math.PI / 2 }], { benchCount: 0, hasAgent: all });
    expect(t.center[0]).toBeCloseTo(0);
    expect(t.center[1]).toBeGreaterThan(0);
  });
});

describe('the Bench', () => {
  it('in front of the Brain, four to a row; where it was dragged when it was', () => {
    expect(benchSpot([])).toBeNull();
    const b = benchSpot(['a', 'b', 'c', 'd', 'e'])!;
    expect(b.size).toEqual([4 * 3.4 + 1.2, 2 * 3.2 + 1.2]);
    expect(b.center[0]).toBeCloseTo(b.center[1]);
    expect(Math.hypot(...b.center)).toBeCloseTo(11 + 2 * 1.6);
    expect(new Set(b.desks.map((d) => d.at.map((n) => n.toFixed(2)).join())).size).toBe(5);
    expect(benchSpot(['a'], { x: -5, z: 8 })!.desks[0].at).toEqual([-5, 8]);
  });
});
