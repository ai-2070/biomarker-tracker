// A team's symbol in the middle of its pod on the Station: an emoji (the default), or a picture or 3D model of your own.
import { h, POST, DEL, attempt, toast } from './core.ts';
import { readImage } from './projectlogo.ts';
import { apiUrl } from './client/connection.ts';
import type { Team } from '../shared/types.ts';

export const DEFAULT_TEAM_MARK = '💬';
/** The emoji offered as one-click choices (any emoji can be typed in as well). */
export const EMOJI_CHOICES = ['💬', '👥', '🎬', '🎧', '🎨', '🧠', '📣', '✍️', '🛠️', '🚀', '🧪', '📊', '🎮', '🧩', '🔍', '🤖', '📦', '🌍', '🔥', '⭐'];

const MODEL_EXT = /\.(glb|gltf|obj|stl|ply|fbx)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const MODEL_MAX = 15 * 1024 * 1024;

type MarkRef = Pick<Team, 'id'> & Partial<Pick<Team, 'markFile'>>;

/** The picture or model's URL (changes when it does, so a new one shows at once), or null for the emoji. */
export function teamMarkUrl(t: MarkRef | null | undefined): string | null {
  return t?.id && t.markFile ? apiUrl(`/workflows/${encodeURIComponent(t.id)}/mark`, { v: t.markFile.at }) : null;
}

const readDataUrl = (file: File): Promise<string | null> =>
  new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ok(null);
    r.readAsDataURL(file);
  });

/** Ask for a picture or a 3D model and make it the team's symbol. Resolves to true when it was saved. */
export function pickTeamMark(t: Pick<Team, 'id' | 'name'>): Promise<boolean> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,.glb,.gltf,.obj,.stl,.ply,.fbx' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(false);
      const isModel = MODEL_EXT.test(file.name);
      if (!isModel && !IMAGE_EXT.test(file.name)) {
        toast('Pick a picture (PNG, JPG, WebP, GIF) or a 3D model (.glb, .obj, .stl, .ply, .fbx).', 'error');
        return resolve(false);
      }
      if (isModel && file.size > MODEL_MAX) {
        toast(`That model is ${(file.size / 1048576).toFixed(0)} MB; the most is ${MODEL_MAX / 1048576} MB.`, 'error');
        return resolve(false);
      }
      let data: string | null;
      try {
        // a big picture is shrunk first, like a project's logo
        data = isModel || /\.gif$/i.test(file.name) ? await readDataUrl(file) : await readImage(file);
      } catch (e) {
        toast((e as Error).message, 'error');
        return resolve(false);
      }
      if (!data) {
        toast("Couldn't read that file.", 'error');
        return resolve(false);
      }
      // (a shrunk picture is a PNG now, whatever it was called)
      const name = !isModel && data.startsWith('data:image/png') ? file.name.replace(/\.\w+$/, '.png') : file.name;
      const r = await attempt(() => POST<Team>(`/workflows/${encodeURIComponent(t.id)}/mark`, { name, data }), `New symbol for ${t.name}`);
      resolve(!!r);
    });
    input.click();
  });
}

export async function removeTeamMark(t: Pick<Team, 'id'>): Promise<boolean> {
  return !!(await attempt(() => DEL<Team>(`/workflows/${encodeURIComponent(t.id)}/mark`)));
}
