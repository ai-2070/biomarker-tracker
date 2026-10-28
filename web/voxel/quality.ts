// Stepping the voxel look down a quality level when this computer can't keep up: frames slower than
// about 30 a second for a few seconds in a row. Only down, and only for this visit (the setting stays).
// The Station skips frames on purpose (30 a second while nothing moves, fewer in the back): a frame is
// judged against the time it was meant to take, so a fast computer holding back isn't taken for a slow one.
import type { WorldQuality } from '../../shared/types.ts';

/** Average frame time (ms) above which the look is too heavy. */
export const SLOW_MS = 33;
/** How long it has to stay slow, ms (and how long to wait after a start or a change before judging). */
export const SLOW_FOR_MS = 4000;
/** Frames longer than this are a hidden tab or a pause, not slowness. */
const GAP_MS = 250;
/** How much longer than meant a held-back frame may come (a screen draws only on its own beat). */
const AIM_SLACK = 1.25;

export const lowerQuality = (q: WorldQuality): WorldQuality | null => (q === 'high' ? 'medium' : q === 'medium' ? 'low' : null);

/** Watches frame times; says when to step down. */
export class SlowWatch {
  private frames: number[] = [];
  private total = 0;
  /** what the frames in the window may take in all */
  private limits: number[] = [];
  private allowed = 0;
  private settled = 0;
  private done = false;
  private readonly quality: WorldQuality;

  constructor(quality: WorldQuality) {
    this.quality = quality;
  }

  /** One frame took `ms`; `aimMs` is how long it was meant to take when frames are held back (0: as fast
   *  as the screen goes). True (once) when the look should step down. */
  frame(ms: number, aimMs = 0): boolean {
    if (this.done || !lowerQuality(this.quality)) return false;
    if (ms > Math.max(GAP_MS, aimMs * 2)) {
      // a pause: start judging afresh
      this.frames = [];
      this.total = 0;
      this.limits = [];
      this.allowed = 0;
      return false;
    }
    // the first seconds compile shaders and load the world: don't judge them
    if (this.settled < SLOW_FOR_MS) {
      this.settled += ms;
      return false;
    }
    const limit = Math.max(SLOW_MS, aimMs * AIM_SLACK);
    this.frames.push(ms);
    this.total += ms;
    this.limits.push(limit);
    this.allowed += limit;
    while (this.total - this.frames[0] >= SLOW_FOR_MS) {
      this.total -= this.frames.shift()!;
      this.allowed -= this.limits.shift()!;
    }
    if (this.total >= SLOW_FOR_MS && this.total > this.allowed) {
      this.done = true;
      return true;
    }
    return false;
  }
}
