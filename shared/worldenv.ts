// Times of day for the voxel world (used by the server for new worlds and by the page to light them): sky, fog, sun, sky light and the finishing touches, as data.
// "station" is the default when a world has none set: night-dark like the classic map, so turning the
// voxel look on doesn't change the mood, only the light.
// The camera looks from azimuth 45°, so suns come from the side: shadows fall across the view, not away from it.
import type { WorldEnvPreset, WorldEnvironment } from './types.ts';

export const ENV_PRESETS: Record<WorldEnvPreset, WorldEnvironment> = {
  station: {
    preset: 'station',
    sky: { top: '#0b100d', horizon: '#18211b', bottom: '#070807' },
    fog: { color: '#0e140f', density: 0.25 },
    sun: { color: '#e4ecff', intensity: 1.8, azimuth: -20, elevation: 55 },
    ambient: { sky: '#a6b8d8', ground: '#1a1f17', intensity: 0.9 },
    bloom: 0.6,
    tiltShift: 0.35,
    exposure: 1,
  },
  day: {
    preset: 'day',
    sky: { top: '#4f8fd6', horizon: '#cfe6f7', bottom: '#9fc2de' },
    fog: { color: '#c4dcef', density: 0.2 },
    sun: { color: '#fff4e0', intensity: 2.3, azimuth: 0, elevation: 55 },
    ambient: { sky: '#bcd8ff', ground: '#6b5a45', intensity: 0.85 },
    bloom: 0.3,
    tiltShift: 0.5,
    exposure: 0.9,
  },
  golden: {
    preset: 'golden',
    sky: { top: '#6c68a0', horizon: '#f2c79a', bottom: '#b998b8' },
    fog: { color: '#d6b4b4', density: 0.3 },
    sun: { color: '#ffcf8a', intensity: 3.2, azimuth: -30, elevation: 24 },
    ambient: { sky: '#c9b6e0', ground: '#5a4a3a', intensity: 1 },
    bloom: 0.8,
    tiltShift: 0.6,
    exposure: 1.05,
  },
  dusk: {
    preset: 'dusk',
    sky: { top: '#1f2547', horizon: '#e0806a', bottom: '#3a2a40' },
    fog: { color: '#5a3a4a', density: 0.35 },
    sun: { color: '#ff9a6a', intensity: 1.8, azimuth: -40, elevation: 10 },
    ambient: { sky: '#6a6ea8', ground: '#2a2030', intensity: 0.8 },
    bloom: 1,
    tiltShift: 0.55,
    exposure: 1.1,
  },
  night: {
    preset: 'night',
    sky: { top: '#05070f', horizon: '#121a2e', bottom: '#06080c' },
    fog: { color: '#0c1220', density: 0.35 },
    sun: { color: '#9fb4ff', intensity: 0.6, azimuth: 200, elevation: 40 },
    ambient: { sky: '#2e3a60', ground: '#0a0a12', intensity: 0.6 },
    bloom: 1.2,
    tiltShift: 0.45,
    exposure: 1.15,
  },
  overcast: {
    preset: 'overcast',
    sky: { top: '#868d97', horizon: '#c4c8cc', bottom: '#9a9fa5' },
    fog: { color: '#b4b9bf', density: 0.4 },
    sun: { color: '#e8ecf0', intensity: 1, azimuth: 10, elevation: 60 },
    ambient: { sky: '#c0c6cf', ground: '#5a5a55', intensity: 1.5 },
    bloom: 0.3,
    tiltShift: 0.45,
    exposure: 1,
  },
  snow: {
    preset: 'snow',
    sky: { top: '#363e4c', horizon: '#9aa3ad', bottom: '#646b74' },
    fog: { color: '#8a929c', density: 0.4 },
    sun: { color: '#ffd7a8', intensity: 1.3, azimuth: -35, elevation: 16 },
    ambient: { sky: '#a6b6cc', ground: '#45454f', intensity: 1.1 },
    bloom: 0.9,
    tiltShift: 0.55,
    exposure: 1.05,
  },
};

export const envPreset = (p: WorldEnvPreset | string): WorldEnvironment => JSON.parse(JSON.stringify(ENV_PRESETS[p as WorldEnvPreset] || ENV_PRESETS.station)) as WorldEnvironment;

/** The sun's direction (towards the sun) from its azimuth and elevation in degrees. */
export function sunDirection(azimuth: number, elevation: number): [number, number, number] {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}
