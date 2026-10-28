// A character for animation: its prefab's voxels and its named parts (copies of part prefabs, nested up to
// 4 levels), each part a group that turns around its own pivot, so an animation can move arms, legs, a head.
// partTree() is pure (tested); buildRig() makes the groups, applyPose() puts a pose on them every frame.
import * as THREE from 'three';
import { MAX_NESTING, composeSwaps, variantKey } from './instances.ts';
import type { Variant } from './instances.ts';
import type { Pose } from './animate.ts';
import type { PrefabInstance, Vec3, VoxelObjectData } from '../../shared/types.ts';

/** A part of a character: which prefab variant, where it rests in its parent, and its own parts. */
export interface PartNode {
  name: string | null;
  prefab: string;
  variant: Variant;
  key: string;
  /** where its pivot rests in its parent (map units), and its rest turn, tilt, roll (degrees) and scale */
  p: Vec3;
  turn: number;
  tilt: number;
  roll: number;
  scale: number;
  /** its prefab's pivot (mirrored with it) */
  pivot: Vec3;
  children: PartNode[];
}

export type RigLookup = (id: string) => { data: VoxelObjectData | null; pivot: Vec3 } | null;

/**
 * The part tree of a character prefab: any prefab (a person, an animal, a lamp, a crystal), with named parts
 * or none (then it is drawn whole and only "self" moves it). The root has no name; "self" moves it. A mirrored part's own parts are
 * mirrored with it, like placed copies; a prefab inside itself stops there.
 */
export function partTree(rootId: string, lookup: RigLookup, maxDepth = MAX_NESTING): PartNode | null {
  const root = lookup(rootId);
  if (!root) return null;
  const node = (raw: PrefabInstance, parentMirror: boolean, parentSwaps: Map<string, string>, depth: number, path: Set<string>): PartNode | null => {
    const pf = lookup(raw.prefab);
    if (!pf || path.has(raw.prefab)) return null;
    const mirror = !!raw.mirror !== parentMirror;
    const p: Vec3 = parentMirror ? [-raw.p[0], raw.p[1], raw.p[2]] : [raw.p[0], raw.p[1], raw.p[2]];
    const swap = composeSwaps(raw.swap, parentSwaps);
    const variant: Variant = { mirror, swap: [...swap].sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
    const n: PartNode = {
      // (names match without case: "Left Arm" is "left arm")
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().toLowerCase() : null,
      prefab: raw.prefab,
      variant,
      key: variantKey(variant),
      p,
      turn: (parentMirror ? -1 : 1) * (raw.turn || 0),
      tilt: raw.tilt || 0,
      roll: (parentMirror ? -1 : 1) * (raw.roll || 0),
      scale: raw.scale && raw.scale > 0 ? raw.scale : 1,
      pivot: mirror ? [-pf.pivot[0], pf.pivot[1], pf.pivot[2]] : pf.pivot,
      children: [],
    };
    if (depth < maxDepth) {
      const inner = new Set([...path, raw.prefab]);
      for (const c of pf.data?.instances || []) {
        if (!c || typeof c.prefab !== 'string' || !Array.isArray(c.p)) continue;
        const child = node(c, mirror, swap, depth + 1, inner);
        if (child) n.children.push(child);
      }
    }
    return n;
  };
  // the character itself stands with its pivot (bottom centre) at the spot
  return node({ prefab: rootId, p: [0, 0, 0] }, false, new Map(), 0, new Set());
}

/** Part names in a tree (to tell builders which names their animations can move). */
export function partNames(tree: PartNode | null): string[] {
  const out: string[] = [];
  const walk = (n: PartNode) => {
    if (n.name) out.push(n.name);
    n.children.forEach(walk);
  };
  if (tree) walk(tree);
  return out;
}

/** A part on the map: the group that turns around its pivot, and how it rests. */
interface RigPart {
  group: THREE.Group;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  restScale: number;
}

export interface Rig {
  root: THREE.Group;
  /** by part name; "self" is the whole character */
  parts: Map<string, RigPart[]>;
}

const DEG = Math.PI / 180;
const quarter = (n: number) => ((((Math.round(n / 90) * 90) % 360) + 360) % 360) * DEG;

/** Groups for a part tree; `meshes(node)` gives the meshes of a part's own voxels (already made). */
export function buildRig(tree: PartNode, meshes: (n: PartNode) => THREE.Object3D[]): Rig {
  const parts = new Map<string, RigPart[]>();
  const add = (name: string, part: RigPart) => {
    const list = parts.get(name);
    if (list) list.push(part);
    else parts.set(name, [part]);
  };
  const make = (n: PartNode, isRoot: boolean): THREE.Group => {
    const pivotGroup = new THREE.Group();
    pivotGroup.position.set(n.p[0], n.p[1], n.p[2]);
    pivotGroup.rotation.set(quarter(n.tilt), n.turn * DEG, quarter(n.roll), 'YXZ');
    pivotGroup.scale.setScalar(n.scale);
    const inner = new THREE.Group();
    inner.position.set(-n.pivot[0], -n.pivot[1], -n.pivot[2]);
    for (const m of meshes(n)) inner.add(m);
    for (const c of n.children) inner.add(make(c, false));
    pivotGroup.add(inner);
    const part: RigPart = { group: pivotGroup, restPos: pivotGroup.position.clone(), restQuat: pivotGroup.quaternion.clone(), restScale: n.scale };
    if (isRoot) add('self', part);
    if (n.name) add(n.name, part);
    return pivotGroup;
  };
  const root = new THREE.Group();
  root.add(make(tree, true));
  return { root, parts };
}

// (reused every frame)
const _euler = new THREE.Euler();
const _q = new THREE.Quaternion();

/** Puts a pose on a rig: each named part turned around its pivot, moved and scaled from its rest. Parts without a pose rest. */
export function applyPose(rig: Rig, pose: Pose): void {
  for (const [name, list] of rig.parts) {
    const p = pose.get(name);
    for (const part of list) {
      const g = part.group;
      if (!p) {
        g.position.copy(part.restPos);
        g.quaternion.copy(part.restQuat);
        g.scale.setScalar(part.restScale);
        continue;
      }
      g.position.set(part.restPos.x + p.move[0], part.restPos.y + p.move[1], part.restPos.z + p.move[2]);
      _euler.set(p.turn[0] * DEG, p.turn[1] * DEG, p.turn[2] * DEG, 'XYZ');
      g.quaternion.copy(part.restQuat).multiply(_q.setFromEuler(_euler));
      g.scale.setScalar(part.restScale * (Number.isFinite(p.scale) && p.scale > 0 ? p.scale : 1));
    }
  }
}
