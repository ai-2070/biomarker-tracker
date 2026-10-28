// A project's logo: its URL, a small logo-or-icon mark for lists and buttons, and picking a new one.
import { h, POST, DEL, attempt, refreshSoon, toast } from './core.ts';
import { icon } from './icons.ts';
import { apiUrl } from './client/connection.ts';
import type { Project } from '../shared/types.ts';

type ProjectRef = Pick<Project, 'id'> & Partial<Pick<Project, 'logoAt' | 'modelAt' | 'modelExt' | 'repo' | 'name'>>;

/** The logo's URL (changes when the logo does, so the new one shows at once), or null. */
export function logoUrl(p: ProjectRef | null | undefined): string | null {
  return p?.id && p.logoAt ? apiUrl(`/projects/${encodeURIComponent(p.id)}/logo`, { v: p.logoAt }) : null;
}

/** The logo, or the project's folder / GitHub icon when it has none. */
export function projectMark(p: ProjectRef | null | undefined, size = 16, fallback: string | null = null): HTMLElement | SVGSVGElement {
  const url = logoUrl(p);
  // (proj-logo: the places that show it can round it differently, [&_.proj-logo]:…)
  if (url) return h('img.proj-logo', { class: 'inline-block flex-none rounded-[5px] object-contain align-middle', src: url, alt: '', width: size, height: size, style: { width: `${size}px`, height: `${size}px` } });
  return icon(fallback || (p?.repo ? 'git-branch' : 'folder'), size);
}

/** The project's 3D model (it replaces the logo in the Brain's globe): its URL, or null. */
export function modelUrl(p: ProjectRef | null | undefined): string | null {
  return p?.id && p.modelAt ? apiUrl(`/projects/${encodeURIComponent(p.id)}/model`, { v: p.modelAt }) : null;
}

const MODEL_ACCEPT = '.glb,.gltf,.obj,.stl,.ply,.fbx';
const MODEL_MAX = 15 * 1024 * 1024;

/** Ask for a 3D model file and make it the project's Brain model. Resolves to true when it was saved. */
export function pickModel(p: Pick<Project, 'id' | 'name'>): Promise<boolean> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: MODEL_ACCEPT });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(false);
      if (!/\.(glb|gltf|obj|stl|ply|fbx)$/i.test(file.name)) {
        toast('Pick a 3D model: .glb, .gltf, .obj, .stl, .ply or .fbx.', 'error');
        return resolve(false);
      }
      if (file.size > MODEL_MAX) {
        toast(`That model is ${(file.size / 1048576).toFixed(0)} MB; the most is ${MODEL_MAX / 1048576} MB.`, 'error');
        return resolve(false);
      }
      const data = await new Promise<string | null>((ok) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => ok(null);
        r.readAsDataURL(file);
      });
      if (!data) {
        toast("Couldn't read that file.", 'error');
        return resolve(false);
      }
      const r = await attempt(() => POST<Project>(`/projects/${encodeURIComponent(p.id)}/model`, { name: file.name, data }), `New 3D model for ${p.name}`);
      refreshSoon(0);
      resolve(!!r);
    });
    input.click();
  });
}

export async function removeModel(p: Pick<Project, 'id' | 'name'>): Promise<boolean> {
  const r = await attempt(() => DEL<Project>(`/projects/${encodeURIComponent(p.id)}/model`), '3D model removed');
  refreshSoon(0);
  return !!r;
}

const MAX_SIDE = 512;

// Big photos are shrunk to 512 px (PNG keeps transparency); small images and GIFs go up as they are.
export async function readImage(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
  if (file.type === 'image/gif') return raw;
  const img = new Image();
  img.src = raw;
  await img.decode().catch(() => {
    throw new Error("That file isn't an image this browser can open.");
  });
  const side = Math.max(img.naturalWidth, img.naturalHeight);
  if (side <= MAX_SIDE && file.size < 600_000) return raw;
  const k = MAX_SIDE / side;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * Math.min(1, k)));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * Math.min(1, k)));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** Ask for an image and make it the project's logo. Resolves to true when it was saved. */
export function pickLogo(p: Pick<Project, 'id' | 'name'>): Promise<boolean> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(false);
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        toast('Pick a PNG, JPG, WebP or GIF image.', 'error');
        return resolve(false);
      }
      let data: string;
      try {
        data = await readImage(file);
      } catch (e) {
        toast((e as Error).message, 'error');
        return resolve(false);
      }
      const r = await attempt(() => POST<Project>(`/projects/${encodeURIComponent(p.id)}/logo`, { data }), `New logo for ${p.name}`);
      refreshSoon(0);
      resolve(!!r);
    });
    input.click();
  });
}

export async function removeLogo(p: Pick<Project, 'id' | 'name'>): Promise<boolean> {
  const r = await attempt(() => DEL<Project>(`/projects/${encodeURIComponent(p.id)}/logo`), 'Logo removed');
  refreshSoon(0);
  return !!r;
}
