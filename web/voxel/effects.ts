// Particles: petals, leaves, snow and dust as tiny tumbling cubes (they match the voxels), rain as streaks,
// fireflies, embers and sparks as glowing points, smoke, steam and mist as soft puffs, and small flocks of
// birds. Each effect fills its box and recycles its particles; the weather fills the area you look at.
// The movement is plain functions on arrays (tested without WebGL); the drawing is three.js.
import * as THREE from 'three';
import type { WorldEffectKind, WorldQuality } from '../../shared/types.ts';

/** An effect's box: w × d around its middle, from the floor (y 0) up to h. Map units. */
export interface EffectBox {
  w: number;
  h: number;
  d: number;
}

/** Particle state: positions (3 per), velocities (3 per), a phase and a life each. */
export interface Particles {
  n: number;
  pos: Float32Array;
  vel: Float32Array;
  phase: Float32Array;
  life: Float32Array;
}

export type Rand = () => number;

export function makeParticles(n: number, box: EffectBox, rnd: Rand): Particles {
  const p: Particles = { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), phase: new Float32Array(n), life: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    p.pos[i * 3] = (rnd() - 0.5) * box.w;
    p.pos[i * 3 + 1] = rnd() * box.h;
    p.pos[i * 3 + 2] = (rnd() - 0.5) * box.d;
    p.phase[i] = rnd() * 100;
    p.life[i] = rnd();
  }
  return p;
}

/** Keeps x and z inside the box by wrapping round (what blows out one side comes in the other). */
function wrapXZ(p: Particles, i: number, box: EffectBox): void {
  const hw = box.w / 2;
  const hd = box.d / 2;
  const k = i * 3;
  if (p.pos[k] > hw) p.pos[k] -= box.w;
  else if (p.pos[k] < -hw) p.pos[k] += box.w;
  if (p.pos[k + 2] > hd) p.pos[k + 2] -= box.d;
  else if (p.pos[k + 2] < -hd) p.pos[k + 2] += box.d;
}

/** Falling things (petals, leaves, snow, rain, dust): down, with the wind and a sway; back to the top at the floor. */
export function stepFalling(p: Particles, box: EffectBox, dt: number, o: { fall: number; sway: number; wind: [number, number, number] }, rnd: Rand): void {
  for (let i = 0; i < p.n; i++) {
    const k = i * 3;
    p.phase[i] += dt;
    const ph = p.phase[i];
    p.pos[k] += (o.wind[0] + Math.sin(ph * 1.7 + i) * o.sway) * dt;
    p.pos[k + 1] += (o.wind[1] - o.fall * (0.75 + 0.5 * ((i * 0.618) % 1))) * dt;
    p.pos[k + 2] += (o.wind[2] + Math.cos(ph * 1.3 + i * 0.7) * o.sway) * dt;
    if (p.pos[k + 1] < 0) {
      p.pos[k] = (rnd() - 0.5) * box.w;
      p.pos[k + 1] = box.h * (0.85 + rnd() * 0.15);
      p.pos[k + 2] = (rnd() - 0.5) * box.d;
    } else if (p.pos[k + 1] > box.h) p.pos[k + 1] -= box.h;
    wrapXZ(p, i, box);
  }
}

/** Rising things (smoke, steam, embers, sparks): up from the floor and spreading; they live `life` seconds and start again. */
export function stepRising(p: Particles, box: EffectBox, dt: number, o: { rise: number; spread: number; life: number; wind: [number, number, number]; gravity?: number }, rnd: Rand): void {
  for (let i = 0; i < p.n; i++) {
    const k = i * 3;
    p.phase[i] += dt;
    p.life[i] -= dt / o.life;
    p.vel[k + 1] -= (o.gravity || 0) * dt;
    p.pos[k] += (p.vel[k] + o.wind[0]) * dt;
    p.pos[k + 1] += (o.rise + p.vel[k + 1]) * dt;
    p.pos[k + 2] += (p.vel[k + 2] + o.wind[2]) * dt;
    if (p.life[i] <= 0 || p.pos[k + 1] > box.h || p.pos[k + 1] < 0) {
      // from near the middle of the floor, a little spread
      p.pos[k] = (rnd() - 0.5) * box.w * 0.3;
      p.pos[k + 1] = rnd() * 0.2;
      p.pos[k + 2] = (rnd() - 0.5) * box.d * 0.3;
      p.vel[k] = (rnd() - 0.5) * o.spread;
      p.vel[k + 1] = (o.gravity ? 1.5 + rnd() * 2 : 0);
      p.vel[k + 2] = (rnd() - 0.5) * o.spread;
      p.life[i] = 0.6 + rnd() * 0.4;
    }
    wrapXZ(p, i, box);
  }
}

/** Wandering things (fireflies, dust motes): a slow random drift that stays inside the box. */
export function stepWander(p: Particles, box: EffectBox, dt: number, speed: number, rnd: Rand): void {
  for (let i = 0; i < p.n; i++) {
    const k = i * 3;
    p.phase[i] += dt;
    for (let a = 0; a < 3; a++) {
      p.vel[k + a] = Math.max(-speed, Math.min(speed, p.vel[k + a] + (rnd() - 0.5) * speed * dt * 4));
      p.pos[k + a] += p.vel[k + a] * dt;
    }
    if (p.pos[k + 1] < 0.2) (p.pos[k + 1] = 0.2), (p.vel[k + 1] = Math.abs(p.vel[k + 1]));
    if (p.pos[k + 1] > box.h) (p.pos[k + 1] = box.h), (p.vel[k + 1] = -Math.abs(p.vel[k + 1]));
    wrapXZ(p, i, box);
  }
}

// ---------- what each kind looks like and how many ----------
type Look = 'cube' | 'streak' | 'glow' | 'puff' | 'bird';
interface KindSpec {
  look: Look;
  /** particles per square map unit of the box's floor at amount 1 */
  density: number;
  colors: string[];
  /** cube edge, puff or glow size, map units */
  size: number;
}
export const KINDS: Record<WorldEffectKind, KindSpec> = {
  petals: { look: 'cube', density: 0.25, colors: ['#f6b8cf', '#fbd3e2', '#e98fb2', '#ffffff'], size: 0.07 },
  leaves: { look: 'cube', density: 0.2, colors: ['#c8622a', '#e0a040', '#a8401c', '#7d8a2c'], size: 0.09 },
  snow: { look: 'cube', density: 0.6, colors: ['#f4f7fb', '#e6edf5'], size: 0.06 },
  dust: { look: 'glow', density: 0.12, colors: ['#e8d6a8', '#d8c090'], size: 0.12 },
  rain: { look: 'streak', density: 0.5, colors: ['#a8c0d8'], size: 0.7 },
  fireflies: { look: 'glow', density: 0.04, colors: ['#d8ff6a', '#ffe36a'], size: 0.35 },
  embers: { look: 'glow', density: 0.12, colors: ['#ff8a2a', '#ffb040', '#ff5a1a'], size: 0.18 },
  sparks: { look: 'glow', density: 0.15, colors: ['#ffe9a0', '#ffd060'], size: 0.12 },
  smoke: { look: 'puff', density: 0.05, colors: ['#5a5a5e', '#707074'], size: 1.6 },
  steam: { look: 'puff', density: 0.06, colors: ['#f0f2f4', '#dfe4ea'], size: 1.2 },
  mist: { look: 'puff', density: 0.02, colors: ['#e6eaf0', '#d8dee8'], size: 4 },
  birds: { look: 'bird', density: 0, colors: ['#2a2a30'], size: 0.5 },
};

export const PARTICLE_CAP: Record<WorldQuality, number> = { low: 500, medium: 3000, high: 8000 };

/** Particles for an effect, before the overall cap. */
export function countFor(kind: WorldEffectKind, box: EffectBox, amount: number): number {
  const a = Math.max(0, Math.min(1, amount));
  if (kind === 'birds') return Math.round(4 + a * 16);
  return Math.min(4000, Math.round(KINDS[kind].density * a * box.w * box.d));
}

/** Shares the cap out: every effect gets the same share of what it asked for. */
export function fitToCap(counts: number[], cap: number): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= cap) return counts;
  const k = cap / total;
  return counts.map((c) => Math.floor(c * k));
}

// ---------- drawing ----------
/** One effect as the layer gives it. */
export interface EffectSpec {
  key: string;
  kind: WorldEffectKind;
  box: EffectBox;
  amount: number;
  colors?: string[];
  wind?: [number, number, number];
}

const SOFT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPx;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uPx);
  }`;
const SOFT_FRAG = /* glsl */ `
  uniform float uBoost;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * uBoost, a);
  }`;

/** One effect's particles and how they are drawn. */
class System {
  readonly obj: THREE.Object3D;
  readonly spec: EffectSpec;
  private p: Particles;
  private look: Look;
  private colors: THREE.Color[];
  private slow: number;
  private rnd: Rand;
  private px: { value: number } = { value: 10 };
  // drawing
  private inst?: THREE.InstancedMesh;
  private line?: THREE.LineSegments;
  private points?: THREE.Points;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(spec: EffectSpec, count: number, slow: number, seed: number, cubeGeo: THREE.BufferGeometry, birdGeo: THREE.BufferGeometry) {
    this.spec = spec;
    this.slow = slow;
    let a = seed >>> 0 || 1;
    this.rnd = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
    const k = KINDS[spec.kind];
    this.look = k.look;
    this.colors = (spec.colors?.length ? spec.colors : k.colors).map((c) => new THREE.Color(c));
    this.p = makeParticles(count, spec.box, this.rnd);
    if (this.look === 'cube' || this.look === 'bird') {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
      this.inst = new THREE.InstancedMesh(this.look === 'cube' ? cubeGeo : birdGeo, mat, count);
      for (let i = 0; i < count; i++) this.inst.setColorAt(i, this.colors[i % this.colors.length]);
      this.inst.frustumCulled = false;
      this.obj = this.inst;
    } else if (this.look === 'streak') {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
      this.line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: this.colors[0], transparent: true, opacity: 0.45, depthWrite: false }));
      this.line.frustumCulled = false;
      this.obj = this.line;
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1));
      const col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) this.colors[i % this.colors.length].toArray(col, i * 3);
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      const glow = this.look === 'glow';
      const mat = new THREE.ShaderMaterial({
        uniforms: { uPx: this.px, uBoost: { value: glow ? 3 : 1 } },
        vertexShader: SOFT_VERT,
        fragmentShader: SOFT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.points = new THREE.Points(geo, mat);
      this.points.frustumCulled = false;
      this.obj = this.points;
    }
  }

  update(dt: number, t: number, wind: [number, number, number], pxPerUnit: number): void {
    const { p, spec } = this;
    const box = spec.box;
    const d = dt * this.slow;
    const w: [number, number, number] = spec.wind || wind;
    const size = KINDS[spec.kind].size;
    switch (spec.kind) {
      case 'petals':
      case 'leaves':
        stepFalling(p, box, d, { fall: 0.6, sway: 0.7, wind: w }, this.rnd);
        break;
      case 'snow':
        stepFalling(p, box, d, { fall: 0.9, sway: 0.25, wind: w }, this.rnd);
        break;
      case 'rain':
        stepFalling(p, box, d, { fall: 16, sway: 0, wind: [w[0] * 2, 0, w[2] * 2] }, this.rnd);
        break;
      case 'dust':
      case 'fireflies':
        stepWander(p, box, d, spec.kind === 'dust' ? 0.15 : 0.6, this.rnd);
        break;
      case 'embers':
        stepRising(p, box, d, { rise: 1.1, spread: 0.6, life: 3, wind: w }, this.rnd);
        break;
      case 'sparks':
        stepRising(p, box, d, { rise: 0, spread: 2.5, life: 0.9, wind: w, gravity: 6 }, this.rnd);
        break;
      case 'smoke':
      case 'steam':
        stepRising(p, box, d, { rise: spec.kind === 'smoke' ? 0.7 : 1.1, spread: 0.3, life: spec.kind === 'smoke' ? 6 : 3, wind: w }, this.rnd);
        break;
      case 'mist':
        stepWander(p, box, d, 0.12, this.rnd);
        break;
      case 'birds':
        break;
    }
    if (this.inst && this.look === 'cube') {
      for (let i = 0; i < p.n; i++) {
        const ph = p.phase[i];
        this.e.set(ph * 1.9, ph * 1.3, ph * 0.7);
        this.q.setFromEuler(this.e);
        this.s.set(size, size * (spec.kind === 'snow' ? 1 : 0.35), size);
        this.m.compose(this.v.fromArray(p.pos, i * 3), this.q, this.s);
        this.inst.setMatrixAt(i, this.m);
      }
      this.inst.instanceMatrix.needsUpdate = true;
    } else if (this.inst) {
      // birds: circling at their own radius and height, wings beating
      const r0 = Math.min(box.w, box.d) * 0.35;
      for (let i = 0; i < p.n; i++) {
        const sp = 0.25 + (i % 5) * 0.03;
        const a = t * sp * this.slow + (i / p.n) * Math.PI * 2;
        const r = r0 * (0.7 + 0.3 * Math.sin(i * 1.7));
        this.v.set(Math.cos(a) * r, box.h * (0.6 + 0.3 * Math.sin(i * 2.3 + t * 0.3)), Math.sin(a) * r);
        this.e.set(0, -a, Math.sin(t * 9 + i) * 0.5);
        this.q.setFromEuler(this.e);
        this.s.set(size, size, size);
        this.m.compose(this.v, this.q, this.s);
        this.inst.setMatrixAt(i, this.m);
      }
      this.inst.instanceMatrix.needsUpdate = true;
    } else if (this.line) {
      const a = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let i = 0; i < p.n; i++) {
        const k = i * 3;
        arr.set([p.pos[k], p.pos[k + 1], p.pos[k + 2], p.pos[k] - w[0] * 0.04, p.pos[k + 1] + size, p.pos[k + 2] - w[2] * 0.04], i * 6);
      }
      a.needsUpdate = true;
    } else if (this.points) {
      this.px.value = pxPerUnit;
      const g = this.points.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).set(p.pos);
      g.getAttribute('position').needsUpdate = true;
      const sz = (g.getAttribute('aSize') as THREE.BufferAttribute).array as Float32Array;
      const al = (g.getAttribute('aAlpha') as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < p.n; i++) {
        const life = Math.max(0, Math.min(1, p.life[i]));
        if (this.look === 'glow') {
          // fireflies blink; embers and sparks fade as they go
          const blink = spec.kind === 'fireflies' ? Math.max(0, Math.sin(p.phase[i] * 1.8 + i)) : spec.kind === 'dust' ? 0.35 : life;
          sz[i] = size;
          al[i] = blink;
        } else {
          // puffs grow and fade as they rise
          sz[i] = size * (spec.kind === 'mist' ? 1 : 0.5 + (1 - life) * 1.3);
          al[i] = spec.kind === 'mist' ? 0.12 : life * (spec.kind === 'smoke' ? 0.35 : 0.3);
        }
      }
      g.getAttribute('aSize').needsUpdate = true;
      g.getAttribute('aAlpha').needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.inst) (this.inst.material as THREE.Material).dispose(), this.inst.dispose();
    if (this.line) this.line.geometry.dispose(), (this.line.material as THREE.Material).dispose();
    if (this.points) this.points.geometry.dispose(), (this.points.material as THREE.Material).dispose();
  }
}

/** Where an effect is this frame (its box's bottom centre and turn), or null to hide it. */
export type EffectPlace = (key: string) => THREE.Matrix4 | null;

/** Every effect in the scene: rebuilt when the set of effects changes, moved and stepped each frame. */
export class EffectsLayer {
  readonly group = new THREE.Group();
  private systems: System[] = [];
  private key = '';
  private quality: WorldQuality;
  private reduced: boolean;
  private cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  private birdGeo: THREE.BufferGeometry;

  constructor(quality: WorldQuality, reducedMotion: boolean) {
    this.quality = quality;
    this.reduced = reducedMotion;
    // a bird seen from above: two wings in a shallow V
    const wing = (side: number) => new THREE.BoxGeometry(1, 0.08, 0.35).translate(side * 0.5, 0, 0).rotateY(side * 0.35);
    const l = wing(-1);
    const r = wing(1);
    const pos = [...(l.getAttribute('position').array as Float32Array), ...(r.getAttribute('position').array as Float32Array)];
    const nor = [...(l.getAttribute('normal').array as Float32Array), ...(r.getAttribute('normal').array as Float32Array)];
    const li = l.getIndex()!.array;
    const ri = r.getIndex()!.array;
    const idx = [...li, ...Array.from(ri, (i) => i + l.getAttribute('position').count)];
    this.birdGeo = new THREE.BufferGeometry();
    this.birdGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.birdGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    this.birdGeo.setIndex(idx);
    l.dispose();
    r.dispose();
  }

  /** The effects to show (cheap when nothing changed). */
  set(specs: EffectSpec[]): void {
    const key = JSON.stringify(specs);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    const factor = this.reduced ? 0.25 : 1;
    const counts = fitToCap(
      specs.map((s) => Math.max(1, Math.round(countFor(s.kind, s.box, s.amount) * factor))),
      Math.round(PARTICLE_CAP[this.quality] * factor),
    );
    specs.forEach((s, i) => {
      if (counts[i] <= 0) return;
      const sys = new System(s, counts[i], this.reduced ? 0.4 : 1, hashKey(s.key), this.cubeGeo, this.birdGeo);
      sys.obj.userData.effect = s.key;
      this.systems.push(sys);
      this.group.add(sys.obj);
    });
  }

  update(dt: number, t: number, place: EffectPlace, wind: [number, number, number], pxPerUnit: number): void {
    for (const s of this.systems) {
      const m = place(s.spec.key);
      s.obj.visible = !!m;
      if (!m) continue;
      s.obj.matrixAutoUpdate = false;
      s.obj.matrix.copy(m);
      s.obj.matrixWorldNeedsUpdate = true;
      s.update(dt, t, wind, pxPerUnit);
    }
  }

  private clear(): void {
    for (const s of this.systems) {
      this.group.remove(s.obj);
      s.dispose();
    }
    this.systems = [];
  }

  dispose(): void {
    this.clear();
    this.cubeGeo.dispose();
    this.birdGeo.dispose();
  }
}

function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
