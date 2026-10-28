// A build, seen as it happens: a new object grows up out of the ground, a puff of little cubes, and an arc of
// light from the builder's desk (or the Brain) to what it built. Only for live builds, never on page load.
// With reduced motion: no growing and no puff, and the arc fades at once.
import * as THREE from 'three';

/** How far a new object has grown (0..1) at a moment of its growth (0..1): quick, with a small overshoot. */
export function growAt(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** How bright the arc is at a moment of its life (0..1): in fast, out slowly. */
export function arcAt(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return t < 0.12 ? t / 0.12 : 1 - ((t - 0.12) / 0.88) ** 1.6;
}

/** A point on an arc from a to b, lifted in the middle (t 0..1). */
export function arcPoint(a: THREE.Vector3, b: THREE.Vector3, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const lift = Math.max(3, a.distanceTo(b) * 0.35);
  out.lerpVectors(a, b, t);
  out.y += Math.sin(Math.PI * t) * lift;
  return out;
}

const GROW_S = 1.1;
const ARC_S = 1.6;
const PUFF_S = 1.1;
const PUFF_N = 36;

interface Grow {
  group: THREE.Object3D;
  start: number;
}
interface Arc {
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  spark: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  life: number;
}
interface Puff {
  mesh: THREE.InstancedMesh;
  at: THREE.Vector3;
  vel: Float32Array;
  start: number;
}

let glowTex: THREE.CanvasTexture | null = null;
function glow(): THREE.CanvasTexture | null {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export class BuildFx {
  readonly group = new THREE.Group();
  private grows = new Map<THREE.Object3D, Grow>();
  private arcs: Arc[] = [];
  private puffs: Puff[] = [];
  private readonly reduced: boolean;
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  constructor(reduced: boolean) {
    this.reduced = reduced;
  }

  /** A new object: it grows up out of the ground. */
  grow(group: THREE.Object3D, now: number): void {
    if (this.reduced) return;
    this.grows.set(group, { group, start: now });
  }

  /** How tall a growing object is now (1 when done); the world layer multiplies its height by this. */
  heightOf(group: THREE.Object3D, now: number): number {
    const g = this.grows.get(group);
    if (!g) return 1;
    const t = (now - g.start) / (GROW_S * 1000);
    if (t >= 1) {
      this.grows.delete(group);
      return 1;
    }
    return Math.max(0.001, growAt(t));
  }

  /** An arc of light from the builder to what it built, and a puff of cubes there. */
  built(from: THREE.Vector3 | null, to: THREE.Vector3, color: THREE.ColorRepresentation, now: number): void {
    if (from) {
      const path = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => arcPoint(from, to, i / 8)));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 40, 0.09, 6, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      spark.scale.setScalar(2.2);
      this.group.add(mesh, spark);
      this.arcs.push({ mesh, spark, from: from.clone(), to: to.clone(), start: now, life: this.reduced ? 0.5 : ARC_S });
    }
    if (this.reduced) return;
    const mesh = new THREE.InstancedMesh(this.cube, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false }), PUFF_N);
    mesh.frustumCulled = false;
    const vel = new Float32Array(PUFF_N * 3);
    for (let i = 0; i < PUFF_N; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      vel.set([Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp], i * 3);
    }
    this.group.add(mesh);
    this.puffs.push({ mesh, at: to.clone(), vel, start: now });
  }

  /** Every frame. */
  update(now: number): void {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      const t = (now - a.start) / (a.life * 1000);
      if (t >= 1) {
        this.group.remove(a.mesh, a.spark);
        a.mesh.geometry.dispose();
        a.mesh.material.dispose();
        a.spark.material.dispose();
        this.arcs.splice(i, 1);
        continue;
      }
      const k = arcAt(t);
      a.mesh.material.opacity = 0.85 * k;
      a.spark.material.opacity = k;
      // the spark runs along the arc in the first half, then rests at the build
      arcPoint(a.from, a.to, Math.min(1, t * 2), a.spark.position);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      const s = (now - p.start) / 1000;
      if (s >= PUFF_S) {
        this.group.remove(p.mesh);
        p.mesh.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const size = 0.22 * (1 - s / PUFF_S);
      this.s.setScalar(Math.max(0.001, size));
      for (let j = 0; j < PUFF_N; j++) {
        this.v.set(p.at.x + p.vel[j * 3] * s, p.at.y + p.vel[j * 3 + 1] * s - 4.9 * s * s, p.at.z + p.vel[j * 3 + 2] * s);
        this.q.setFromEuler(this.e.set(s * 6 + j, s * 4 + j * 0.7, 0));
        p.mesh.setMatrixAt(j, this.m.compose(this.v, this.q, this.s));
      }
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const a of this.arcs) {
      a.mesh.geometry.dispose();
      a.mesh.material.dispose();
      a.spark.material.dispose();
    }
    for (const p of this.puffs) {
      p.mesh.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.arcs = [];
    this.puffs = [];
    this.grows.clear();
    this.group.clear();
    this.cube.dispose();
  }
}
