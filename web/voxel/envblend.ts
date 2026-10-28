// Changing the time of day eases from one look to the other (sky, fog, sun, sky light, glow, blur,
// exposure) instead of jumping. Pure: tested without WebGL.
import type { WorldEnvironment } from '../../shared/types.ts';

/** How long a change of time of day takes, ms. */
export const BLEND_MS = 2500;

const hex = (h: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function lerpColor(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return toHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}

/** The shortest way round between two angles in degrees. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

/** Eases in and out. */
export const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The look part way from a to b (t from 0 to 1, not eased). Weather and the preset's name are b's. */
export function lerpEnv(a: WorldEnvironment, b: WorldEnvironment, t: number): WorldEnvironment {
  if (t >= 1) return b;
  const c = (x: string, y: string) => lerpColor(x, y, t);
  const n = (x: number, y: number) => lerp(x, y, t);
  return {
    ...b,
    sky: { top: c(a.sky.top, b.sky.top), horizon: c(a.sky.horizon, b.sky.horizon), bottom: c(a.sky.bottom, b.sky.bottom) },
    fog: { color: c(a.fog.color, b.fog.color), density: n(a.fog.density, b.fog.density) },
    sun: { color: c(a.sun.color, b.sun.color), intensity: n(a.sun.intensity, b.sun.intensity), azimuth: lerpAngle(a.sun.azimuth, b.sun.azimuth, t), elevation: n(a.sun.elevation, b.sun.elevation) },
    ambient: { sky: c(a.ambient.sky, b.ambient.sky), ground: c(a.ambient.ground, b.ambient.ground), intensity: n(a.ambient.intensity, b.ambient.intensity) },
    bloom: n(a.bloom, b.bloom),
    tiltShift: n(a.tiltShift, b.tiltShift),
    exposure: n(a.exposure, b.exposure),
    wind: a.wind || b.wind ? [n(a.wind?.[0] ?? 0, b.wind?.[0] ?? 0), n(a.wind?.[1] ?? 0, b.wind?.[1] ?? 0), n(a.wind?.[2] ?? 0, b.wind?.[2] ?? 0)] : undefined,
  };
}
