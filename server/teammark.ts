// A team's symbol in the middle of its pod on the Station map: an emoji (the default), or a picture or a 3D model instead.
// The emoji is a field of the team; a picture or model is a file in the project's team-marks folder, named after the team.
import fs from 'node:fs';
import path from 'node:path';
import { workflows, projectData, log } from './store.ts';
import { sniffImage, looksLikeModel, MODEL_EXT, MODEL_MAX } from './projects.ts';
import { ensureDir, exists } from './util.ts';
import type { Team } from '../shared/types.ts';

export const DEFAULT_MARK = '💬';
const IMAGE_MAX = 3 * 1024 * 1024;
const IMAGE_EXT = ['png', 'jpg', 'webp', 'gif'] as const;
const ALL_EXT: readonly string[] = [...IMAGE_EXT, 'jpeg', ...MODEL_EXT];

/** What a team's emoji field may hold: an emoji (or a few), or '' for the default. Anything else is dropped. */
export function cleanMark(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 16 && /\p{Extended_Pictographic}/u.test(s) ? s : '';
}

const dir = (): string => ensureDir(projectData('team-marks'));
const safeId = (id: string): string => {
  if (!id || /[\\/]/.test(id)) throw new Error('No such team.');
  return id;
};

/** The team's picture or model file, or null. */
export function markFile(team: Pick<Team, 'id' | 'markFile'>): string | null {
  const m = team.markFile;
  if (!m || !ALL_EXT.includes(m.ext)) return null;
  const f = path.join(dir(), `${safeId(team.id)}.${m.ext}`);
  return exists(f) ? f : null;
}

function removeFiles(teamId: string): void {
  for (const e of ALL_EXT) fs.rmSync(path.join(dir(), `${safeId(teamId)}.${e}`), { force: true });
}

/** Saves a picture (PNG, JPG, WebP, GIF) or a 3D model (see MODEL_EXT) as the team's symbol. Returns the team. */
export function setMarkFile(teamId: string, name: unknown, dataUrl: unknown): Team {
  const team = workflows.get(teamId);
  if (!team) throw new Error('No such team.');
  const raw = path.extname(String(name || '')).slice(1).toLowerCase();
  const ext = raw === 'jpeg' ? 'jpg' : raw;
  const isModel = (MODEL_EXT as readonly string[]).includes(ext);
  if (!isModel && !(IMAGE_EXT as readonly string[]).includes(ext)) throw new Error(`Pick a picture (PNG, JPG, WebP, GIF) or a 3D model (${MODEL_EXT.map((e) => `.${e}`).join(', ')}).`);
  const m = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error("Couldn't read that file.");
  const buf = Buffer.from(m[1], 'base64');
  const max = isModel ? MODEL_MAX : IMAGE_MAX;
  if (buf.length > max) throw new Error(`That file is too big (${max / 1048576} MB at most).`);
  // the bytes have to be what the name says (an SVG could carry scripts)
  if (isModel ? !looksLikeModel(ext, buf) : sniffImage(buf) !== ext) throw new Error(`That file isn't a real .${ext}.`);
  removeFiles(teamId);
  fs.writeFileSync(path.join(dir(), `${safeId(teamId)}.${ext}`), buf);
  log('team', `New ${isModel ? '3D model' : 'picture'} for the team ${team.name}`);
  return workflows.save({ ...team, markFile: { kind: isModel ? 'model' : 'image', ext, at: Date.now() } });
}

/** Back to the emoji. */
export function removeMarkFile(teamId: string): Team {
  const team = workflows.get(teamId);
  if (!team) throw new Error('No such team.');
  removeFiles(teamId);
  return workflows.save({ ...team, markFile: null });
}

/** A deleted team takes its picture or model with it. */
export function dropMarkFiles(teamId: string): void {
  try {
    removeFiles(teamId);
  } catch {
    /* nothing to remove */
  }
}
