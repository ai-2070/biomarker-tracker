// Files and folders you attach: dropped on a chat, the team builder, a new project or the Brain on
// the map, or picked with the paperclip. They are saved in the project's Brain folder
// (uploads/<batch>/…), so every agent can open them, and messages carry their paths.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type http from 'node:http';
import { ensureDir, exists, isInside, realTarget } from './util.ts';
import { ensureBrain } from './projects.ts';
import type { Project, UploadedFile } from '../shared/types.ts';

export const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_ATTACHMENTS = 50;
const MAX_DEPTH = 16;
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const TEXT_EXT = /\.(md|markdown|txt|json|jsonl|ya?ml|csv|tsv|html?|xml|svg|js|mjs|cjs|ts|tsx|jsx|py|rb|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|php|lua|css|scss|less|sql|sh|bash|zsh|ps1|bat|toml|ini|cfg|conf|env|log|srt|vtt|rtf|tex|gitignore|dockerfile)$/i;
// Windows can't have these as file names
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

class UploadError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

export const uploadsRoot = (p?: Project): string => path.join(ensureBrain(p), 'uploads');

// uploads/ only while it really is a folder in the Brain folder: a crafted project could make it a link
// to anywhere on the PC, and agents may read everything under it. Null when it points out.
export function safeUploadsRoot(p?: Project): string | null {
  const brain = ensureBrain(p);
  const root = path.join(brain, 'uploads');
  const r = realTarget(brain);
  const q = realTarget(root);
  return r && q && isInside(r, q) ? root : null;
}
const checkedRoot = (): string => {
  const root = safeUploadsRoot();
  if (!root) throw new UploadError(400, "The project's uploads folder is a link out of its Brain folder, so it isn't used.");
  return root;
};

// A new folder for one drop: uploads/2026-10-26_143012-ab12
export function newBatch(): { batch: string; dir: string } {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const batch = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
  const root = checkedRoot();
  const dir = ensureDir(path.join(root, batch));
  // a Git project: keep dropped files out of commits (an agent's `git add -A` would take them all)
  const ignore = path.join(root, '.gitignore');
  if (exists(path.join(ensureBrain(), '.git')) && !exists(ignore)) fs.writeFileSync(ignore, '# Files attached in the dashboard. Move a file out of uploads/ to commit it.\n*\n');
  return { batch, dir };
}

// One part of a path, made safe for every OS: no separators, control or reserved characters, no "..".
export function cleanName(s: string): string {
  let n = String(s || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f<>:"|?*\\/]/g, '_')
    .trim()
    .replace(/[. ]+$/, '');
  if (!n) return '';
  if (RESERVED.test(n)) n = `_${n}`;
  return n.slice(0, 150);
}

// "docs/sub/a.md" (as the browser sends it) → ['docs', 'sub', 'a.md']; '..' and empty parts are dropped.
export function safeParts(rel: string): string[] {
  return String(rel || '')
    .split(/[\\/]+/)
    .map(cleanName)
    .filter(Boolean);
}

// Claim a free name (a.png, else a (2).png…) by creating it, so two uploads of the same name at once can't both get it.
export function reserveName(file: string): string {
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  for (let i = 1; ; i++) {
    const name = i === 1 ? file : `${base} (${i})${ext}`;
    try {
      fs.closeSync(fs.openSync(name, 'wx'));
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

// Save one file of a batch from the raw request body (streamed, never held in memory).
export async function receive(req: http.IncomingMessage, batch: string, rel: string): Promise<UploadedFile> {
  if (!/^[\w-]{1,64}$/.test(batch)) throw new UploadError(400, 'Bad upload batch.');
  const root = checkedRoot();
  const dir = path.join(root, batch);
  if (!exists(dir) || !inside(root, dir)) throw new UploadError(400, 'That upload batch is gone. Attach the files again.');
  const parts = safeParts(rel);
  if (!parts.length) throw new UploadError(400, 'The file needs a name.');
  if (parts.length > MAX_DEPTH) throw new UploadError(400, 'That folder is nested too deep.');
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_FILE_BYTES) throw new UploadError(413, `${parts[parts.length - 1]} is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  ensureDir(path.dirname(path.join(dir, ...parts)));
  // a folder in the path that is a link out of uploads/
  if (!inside(root, path.dirname(path.join(dir, ...parts)))) throw new UploadError(400, 'Bad upload path.');
  const target = reserveName(path.join(dir, ...parts));
  const tmp = `${target}.${crypto.randomBytes(3).toString('hex')}.part`;
  let size = 0;
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) done(new UploadError(413, `${parts[parts.length - 1]} is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(req, count, fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(target, { force: true });
    throw e;
  }
  const folder = parts.length > 1;
  // a folder ends with a separator, so it can be told from a file anywhere it is shown
  return { path: target, top: folder ? path.join(dir, parts[0]) + path.sep : target, kind: folder ? 'folder' : 'file', name: path.basename(target), size };
}

// Strictly inside root once links are followed (case only ignored on Windows). A link that can't be
// followed safely counts as outside.
const inside = (root: string, p: string) => {
  const r = realTarget(root);
  const q = realTarget(p);
  return !!r && !!q && isInside(r, q);
};

// The attachments a request names, keeping only uploads of this project that still exist.
// Folders end with a separator.
export function cleanAttachments(list: unknown): string[] {
  const root = safeUploadsRoot();
  if (!Array.isArray(list) || !root) return [];
  const out = new Set<string>();
  for (const x of list) {
    if (typeof x !== 'string' || !x) continue;
    const p = path.resolve(x);
    if (inside(root, p) && exists(p)) out.add(isDir(p) ? p + path.sep : p);
    if (out.size >= MAX_ATTACHMENTS) break;
  }
  return [...out];
}

// Take back something you attached (✕ on its chip): only inside uploads/.
export function removeUpload(p: string): boolean {
  const root = checkedRoot();
  const abs = path.resolve(String(p || ''));
  if (!inside(root, abs)) throw new UploadError(403, 'Only uploaded files can be removed.');
  if (!exists(abs)) return false;
  fs.rmSync(abs, { recursive: true, force: true });
  // and its batch folder once it is empty
  const batch = path.join(root, path.relative(root, abs).split(path.sep)[0]);
  try {
    if (batch !== abs && !fs.readdirSync(batch).length) fs.rmdirSync(batch);
  } catch {
    /* already gone */
  }
  return true;
}

// ---------- telling agents about them ----------
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

interface FolderFile {
  rel: string;
  abs: string;
  size: number;
}
function folderFiles(dir: string, limit = 2000): FolderFile[] {
  const out: FolderFile[] = [];
  const walk = (d: string) => {
    let list: fs.Dirent[] = [];
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of list) {
      if (out.length >= limit) return;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(abs).size;
        } catch {
          /* gone */
        }
        out.push({ rel: path.relative(path.dirname(dir), abs).split(path.sep).join('/'), abs, size });
      }
    }
  };
  walk(dir);
  return out;
}

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const kindOf = (name: string) => (IMAGE_EXT.test(name) ? 'image' : TEXT_EXT.test(name) ? 'text' : 'file');

/** The images among the attachments (top-level files only): what vision models get to see. */
export const attachedImages = (paths: string[]): string[] => paths.filter((p) => IMAGE_EXT.test(p) && !isDir(p));

// "photo.png, docs/" — for short mentions (history, logs).
export function attachmentNames(paths: string[] | undefined): string {
  return (paths || []).map((p) => `${path.basename(p)}${isDir(p) ? '/' : ''}`).join(', ');
}

// The block added to a message: where each attached file or folder is, and (with inline > 0)
// the text of small text files, for models that can't open files themselves.
export function describeAttachments(paths: string[] | undefined, { inline = 0, heading = 'Attached files' }: { inline?: number; heading?: string } = {}): string {
  if (!paths?.length) return '';
  const lines: string[] = [];
  const texts: { label: string; abs: string; size: number }[] = [];
  for (const p of paths) {
    if (isDir(p)) {
      const files = folderFiles(p);
      const total = files.reduce((n, f) => n + f.size, 0);
      lines.push(`- ${p.replace(/[\\/]+$/, '')}${path.sep} (folder, ${files.length}${files.length >= 2000 ? '+' : ''} file${files.length === 1 ? '' : 's'}, ${kb(total)})`);
      for (const f of files.slice(0, 40)) lines.push(`    - ${f.rel} (${kb(f.size)})`);
      if (files.length > 40) lines.push(`    - …and ${files.length - 40} more`);
      for (const f of files) if (kindOf(f.rel) === 'text') texts.push({ label: f.rel, abs: f.abs, size: f.size });
    } else {
      let size = 0;
      try {
        size = fs.statSync(p).size;
      } catch {
        continue;
      }
      const k = kindOf(p);
      lines.push(`- ${p} (${k === 'file' ? path.extname(p).slice(1).toUpperCase() || 'file' : k}, ${kb(size)})`);
      if (k === 'text') texts.push({ label: path.basename(p), abs: p, size });
    }
  }
  if (!lines.length) return '';
  let out = `[${heading}: saved in the project's Brain folder. Open them with your file tools when you need them.]\n${lines.join('\n')}`;
  let left = inline;
  for (const t of texts) {
    if (left < 300) break;
    if (t.size > 2_000_000) continue;
    let body = '';
    try {
      body = fs.readFileSync(t.abs, 'utf8');
    } catch {
      continue;
    }
    // binary that only looks like text
    if (body.includes('\u0000')) continue;
    const part = body.slice(0, left);
    out += `\n\n--- ${t.label}${part.length < body.length ? ' (start)' : ''} ---\n${part}`;
    left -= part.length;
  }
  return out;
}

// The text an agent gets: what you wrote plus where the attachments are.
export function withAttachments(text: string, paths: string[] | undefined, opts: { inline?: number } = {}): string {
  const note = describeAttachments(paths, opts);
  if (!note) return text;
  return text.trim() ? `${text}\n\n${note}` : `Have a look at what I attached.\n\n${note}`;
}
