// Files the dashboard may show in the browser (previews in chats) and reveal in Explorer / Finder:
// only inside the project's folders, never anywhere else on the disk.
import fs from 'node:fs';
import path from 'node:path';
import { dataPath, insideRoots, revealInShell } from './util.ts';
import { agents, getSettings, projectData } from './store.ts';
import { ensureBrain } from './projects.ts';
import { comfyOutputDirs } from './programs.ts';

/** The folders files may be shown from: the project's Brain folder, its knowledge, outputs, ComfyUI
 *  outputs, the agents' own workspace folders and the folders allowed in Settings. */
export function viewRoots(): string[] {
  const workspaces = agents
    .list()
    .map((a) => a.workspace)
    .filter((w): w is string => !!w && path.isAbsolute(w));
  return [ensureBrain(), projectData('knowledge'), projectData('tool-images'), dataPath('outputs'), ...comfyOutputDirs(), ...workspaces, ...(getSettings().allowedFolders || [])];
}

/** The real path of p when it is inside one of the folders above (links followed), else null. */
export const viewable = (p: unknown, roots = viewRoots()): string | null => (typeof p === 'string' && p.trim() && path.isAbsolute(p.trim()) ? insideRoots(path.resolve(p.trim()), roots) : null);

export type FileKind = 'image' | 'video' | 'audio' | 'model' | 'file' | 'folder';
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO = /\.(mp4|webm|m4v|mov)$/i;
const AUDIO = /\.(mp3|wav|ogg|oga|m4a)$/i;
// 3D models the page can show (.blend and the like stay plain files)
const MODEL = /\.(glb|gltf|obj|stl|ply|fbx)$/i;

export const kindOf = (p: string, isDir = false): FileKind => (isDir ? 'folder' : IMAGE.test(p) ? 'image' : VIDEO.test(p) ? 'video' : AUDIO.test(p) ? 'audio' : MODEL.test(p) ? 'model' : 'file');

/** What a chat needs to preview a mentioned path. ok: false when it isn't there or isn't allowed. */
export type FileInfo = { path: string; ok: false } | { path: string; ok: true; kind: FileKind; name: string; size: number; modified: number };

/** Looks up the paths a chat mentions (up to 50 at a time). */
export function fileInfo(paths: unknown): FileInfo[] {
  const list = (Array.isArray(paths) ? paths : []).filter((p): p is string => typeof p === 'string').slice(0, 50);
  const roots = viewRoots();
  return list.map((raw): FileInfo => {
    const real = viewable(raw, roots);
    if (!real) return { path: raw, ok: false };
    try {
      const st = fs.statSync(real);
      return { path: raw, ok: true, kind: kindOf(real, st.isDirectory()), name: path.basename(real), size: st.isDirectory() ? 0 : st.size, modified: st.mtimeMs };
    } catch {
      return { path: raw, ok: false };
    }
  });
}

/** Shows the file selected in Explorer / Finder. Throws (status 403/404) for paths outside the folders. */
export function reveal(p: unknown): void {
  const real = viewable(p);
  if (!real) throw Object.assign(new Error('That file is outside the dashboard folders.'), { status: 403 });
  if (!fs.existsSync(real)) throw Object.assign(new Error('That file is no longer there.'), { status: 404 });
  revealInShell(real);
}
