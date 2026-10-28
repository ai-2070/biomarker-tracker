// Animations builders design for their characters: keys per part (turn, move, scale) eased in time, looped
// or played once, and a short crossfade when the clip changes (an agent starts working, needs you, goes idle).
// Pure (no three.js), so it is tested without WebGL; rig.ts puts the poses on the part groups.
import type { AnimKey, AnimationClip } from '../../shared/types.ts';

/** A part's pose on top of its rest: degrees around its pivot, map units, a scale factor. */
export interface PartPose {
  turn: [number, number, number];
  move: [number, number, number];
  scale: number;
}
/** Poses by part name ("self" is the whole character). */
export type Pose = Map<string, PartPose>;

export const CROSSFADE_S = 0.25;
export const restPose = (): PartPose => ({ turn: [0, 0, 0], move: [0, 0, 0], scale: 1 });

/** How a value eases into a key (x from 0 to 1). */
export function ease(kind: AnimKey['ease'], x: number): number {
  const t = Math.max(0, Math.min(1, x));
  switch (kind) {
    case 'linear':
      return t;
    case 'step':
      return t < 1 ? 0 : 1;
    case 'bounce': {
      // overshoots a little and settles
      const s = 1.70158;
      const u = t - 1;
      return 1 + (s + 1) * u * u * u + s * u * u;
    }
    default:
      // smooth (also when not given)
      return t * t * (3 - 2 * t);
  }
}

type Channel = 'turn' | 'move' | 'scale';
const isVec = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));

/** Keys sorted by time, with t clamped to 0..1 (sorted once per clip; keys of bad shape dropped). */
export function cleanKeys(keys: AnimKey[] | undefined): AnimKey[] {
  return (Array.isArray(keys) ? keys : [])
    .filter((k) => k && Number.isFinite(k.t))
    .map((k) => ({ ...k, t: Math.max(0, Math.min(1, k.t)) }))
    .sort((a, b) => a.t - b.t);
}

/** One channel of a part at time t (0..1): held before the first key with it and after the last. */
function sampleChannel(keys: AnimKey[], ch: Channel, t: number, out: number[]): boolean {
  let prev: AnimKey | null = null;
  let next: AnimKey | null = null;
  for (const k of keys) {
    const has = ch === 'scale' ? Number.isFinite(k.scale) : isVec(k[ch]);
    if (!has) continue;
    if (k.t <= t) prev = k;
    else {
      next = k;
      break;
    }
  }
  const val = (k: AnimKey): number[] => (ch === 'scale' ? [k.scale as number] : (k[ch] as number[]));
  if (!prev && !next) return false;
  if (!prev || !next) {
    const v = val((prev || next)!);
    for (let i = 0; i < v.length; i++) out[i] = v[i];
    return true;
  }
  const a = val(prev);
  const b = val(next);
  const e = ease(next.ease, (t - prev.t) / Math.max(1e-6, next.t - prev.t));
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * e;
  return true;
}

const scratch = [0, 0, 0];
const VEC_CHANNELS = ['turn', 'move'] as const;
/** A part's pose at time t (0..1) into `out` (rest where the part has no keys for a channel). */
export function samplePart(keys: AnimKey[], t: number, out: PartPose): PartPose {
  for (const ch of VEC_CHANNELS) {
    const hit = sampleChannel(keys, ch, t, scratch);
    for (let i = 0; i < 3; i++) out[ch][i] = hit ? scratch[i] : 0;
  }
  out.scale = sampleChannel(keys, 'scale', t, scratch) ? scratch[0] : 1;
  return out;
}

/** Where in a clip `elapsed` seconds are (0..1), and whether a play-once clip has ended. */
export function clipTime(clip: Pick<AnimationClip, 'duration' | 'loop'>, elapsed: number): { t: number; done: boolean } {
  const d = clip.duration > 0 ? clip.duration : 1;
  if (clip.loop) return { t: ((elapsed % d) + d) % d / d, done: false };
  return { t: Math.min(1, Math.max(0, elapsed / d)), done: elapsed >= d };
}

/** A clip ready to sample: its tracks' keys sorted. */
export interface PreparedClip {
  duration: number;
  loop: boolean;
  tracks: Map<string, AnimKey[]>;
}
export function prepareClip(clip: AnimationClip): PreparedClip {
  return { duration: clip.duration > 0 ? clip.duration : 1, loop: !!clip.loop, tracks: new Map(Object.entries(clip.tracks || {}).map(([k, v]) => [k.trim().toLowerCase(), cleanKeys(v)])) };
}

/** Samples every track of a clip into `pose` (entries reused). */
export function sampleClip(clip: PreparedClip, t: number, pose: Pose): Pose {
  for (const [name, keys] of clip.tracks) {
    let p = pose.get(name);
    if (!p) pose.set(name, (p = restPose()));
    samplePart(keys, t, p);
  }
  return pose;
}

/** a → b by w (0 = a, 1 = b); a part missing from one side counts as rest. Into `out`. */
const REST: PartPose = restPose();
export function blendPoses(a: Pose, b: Pose, w: number, out: Pose): Pose {
  for (const k of out.keys()) if (!a.has(k) && !b.has(k)) out.delete(k);
  const mix = (name: string) => {
    const pa = a.get(name) || REST;
    const pb = b.get(name) || REST;
    let o = out.get(name);
    if (!o) out.set(name, (o = restPose()));
    for (let i = 0; i < 3; i++) {
      o.turn[i] = pa.turn[i] + (pb.turn[i] - pa.turn[i]) * w;
      o.move[i] = pa.move[i] + (pb.move[i] - pa.move[i]) * w;
    }
    o.scale = pa.scale + (pb.scale - pa.scale) * w;
  };
  for (const name of a.keys()) mix(name);
  for (const name of b.keys()) if (!a.has(name)) mix(name);
  return out;
}

/** The weight of the new clip during a crossfade that started `since` seconds ago. */
export const fadeWeight = (since: number, fade = CROSSFADE_S): number => (fade <= 0 ? 1 : Math.max(0, Math.min(1, since / fade)));

/**
 * Plays a character's clips: the clip of its state, looped, with a play-once clip on top when asked
 * (then back to the state's clip), crossfading between them.
 */
export class Animator {
  private clips: Map<string, PreparedClip>;
  private current: string | null = null;
  private started = 0;
  private prev: string | null = null;
  private prevStarted = 0;
  private fadeFrom = 0;
  private once: { clip: string; times: number } | null = null;
  private stateClip: string | null = null;
  private poseA: Pose = new Map();
  private poseB: Pose = new Map();
  readonly pose: Pose = new Map();

  constructor(clips: Record<string, AnimationClip> | undefined) {
    this.clips = new Map(Object.entries(clips || {}).map(([k, c]) => [k.trim().toLowerCase(), prepareClip(c)]));
  }

  /** (clip names match without case) */
  has(name: string | null | undefined): boolean {
    return !!name && this.clips.has(name.trim().toLowerCase());
  }

  /** The clip for the character's state (looped unless the clip says not); null: stand still. */
  setState(name: string | null, now: number): void {
    const want = name && this.has(name) ? name.trim().toLowerCase() : null;
    if (want === this.stateClip) return;
    this.stateClip = want;
    if (!this.once) this.switchTo(want, now);
  }

  /** Plays a clip `times` times, then goes back to the state's clip. */
  play(name: string, now: number, times = 1): boolean {
    if (!this.has(name)) return false;
    const clip = name.trim().toLowerCase();
    this.once = { clip, times: Math.max(1, Math.min(20, Math.round(times))) };
    this.switchTo(clip, now);
    return true;
  }

  private switchTo(name: string | null, now: number): void {
    if (name === this.current && !this.once) return;
    this.prev = this.current;
    this.prevStarted = this.started;
    this.fadeFrom = now;
    this.current = name;
    this.started = now;
  }

  /** The pose at `now` (seconds): into this.pose. */
  update(now: number): Pose {
    // a play-once clip that has run its times hands back to the state's clip
    if (this.once && this.current === this.once.clip) {
      const c = this.clips.get(this.once.clip)!;
      if (now - this.started >= c.duration * this.once.times) {
        this.once = null;
        this.switchTo(this.stateClip, now);
      }
    }
    const w = fadeWeight(now - this.fadeFrom);
    this.sample(this.current, now - this.started, this.poseB);
    if (w < 1) {
      this.sample(this.prev, now - this.prevStarted, this.poseA);
      return blendPoses(this.poseA, this.poseB, w, this.pose);
    }
    return blendPoses(this.poseB, this.poseB, 1, this.pose);
  }

  private sample(name: string | null, elapsed: number, into: Pose): Pose {
    for (const p of into.values()) {
      p.turn[0] = p.turn[1] = p.turn[2] = 0;
      p.move[0] = p.move[1] = p.move[2] = 0;
      p.scale = 1;
    }
    const c = name ? this.clips.get(name) : null;
    if (!c) return into;
    // (a play-once clip asked to run several times loops for that long)
    const looping = c.loop || (this.once?.clip === name && this.once.times > 1);
    const t = looping ? (((elapsed % c.duration) + c.duration) % c.duration) / c.duration : Math.min(1, Math.max(0, elapsed / c.duration));
    return sampleClip(c, t, into);
  }
}
