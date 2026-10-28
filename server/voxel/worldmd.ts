// WORLD.md: what a world is (its theme and meaning, look, feel, places, characters, story, rules), so
// builds by different agents on different days feel like one place. Kept with the world
// (data/worlds/<id>/WORLD.md); every change keeps the version before it (versions.ts).
// Builders read it before building and update one section at a time; a whole rewrite needs a fresh read.
import { BUILD_ORDER, DIORAMA } from './diorama.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { emit } from '../store.ts';
import { ensureDir } from '../util.ts';
import { keepVersion } from '../versions.ts';
import { getWorld, worldDir } from './store.ts';
import type { WorldMdInfo } from '../../shared/types.ts';

export const WORLD_MD = 'WORLD.md';
export const WORLD_MD_MAX = 50_000;
/** How much of it goes into a builder's instructions (the rest: world_md_read). */
export const WORLD_MD_SHOWN = 8_000;

interface WorldMdVersionItem {
  name: string;
  text: string;
}

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
export const worldMdVersionsDir = (worldId: string): string => worldDir(worldId, 'versions', 'world-md');

/** What a new world's WORLD.md says until someone fills it in. */
export function worldMdTemplate(name: string): string {
  return `# ${name}

## Theme and meaning
What this world is, why it looks this way, and what it stands for in this project.

## Look
Era and style. Palette (by material names). Voxel sizes (terrain 0.5, buildings 0.25, characters 0.1). Light and time of day. Weather.

## Feel
Mood and pace. What should never appear.

## Places

## Characters

## Story so far

## Rules
Build near your own team's platform unless asked otherwise. Keep the middle around the Brain and the paths between platforms clear.
`;
}

function fileOf(worldId: string): string {
  return worldDir(worldId, WORLD_MD);
}

function plainFile(file: string): fs.Stats | null {
  try {
    const st = fs.lstatSync(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/** The text (the template when nothing was written yet). */
export function readWorldMd(worldId: string): string {
  const file = fileOf(worldId);
  if (plainFile(file)) {
    try {
      return fs.readFileSync(file, 'utf8').slice(0, WORLD_MD_MAX * 2);
    } catch {
      /* fall through */
    }
  }
  return worldMdTemplate(getWorld(worldId)?.name || 'World');
}

/** When it last changed (0: never written). */
export const worldMdStamp = (worldId: string): number => Math.round(plainFile(fileOf(worldId))?.mtimeMs || 0);

export function worldMdInfo(worldId: string): WorldMdInfo {
  return { worldId, text: readWorldMd(worldId), updatedAt: worldMdStamp(worldId), max: WORLD_MD_MAX };
}

const tidy = (text: string): string => {
  const t = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return t ? `${t}\n` : '';
};

/** Replace the whole WORLD.md. The version from before is kept (who changed it: see withActor). */
export function writeWorldMd(worldId: string, text: unknown): WorldMdInfo {
  if (!getWorld(worldId)) throw bad('No such world.', 404);
  const next = tidy(String(text ?? ''));
  if (!next) throw bad('WORLD.md would be empty. Write what the world is, or keep the template.');
  if (next.length > WORLD_MD_MAX) throw bad(`WORLD.md can hold up to ${WORLD_MD_MAX.toLocaleString('en-US')} characters (this is ${next.length.toLocaleString('en-US')}). Shorten it.`);
  const file = fileOf(worldId);
  const before = readWorldMd(worldId);
  if (before === next && worldMdStamp(worldId)) return worldMdInfo(worldId);
  const dir = ensureDir(path.dirname(file));
  if (fs.lstatSync(dir).isSymbolicLink() || (plainFile(file) === null && fs.existsSync(file))) throw bad('WORLD.md is not a plain file; not writing through it.');
  if (worldMdStamp(worldId)) keepVersion<WorldMdVersionItem>(worldMdVersionsDir(worldId), { name: WORLD_MD, text: before }, { name: WORLD_MD, text: next }, { ignore: ['name'] });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  emit('world-md', { world: worldId });
  return worldMdInfo(worldId);
}

// ---------- one section at a time ----------
interface Heading {
  line: number;
  level: number;
  text: string;
}

function headings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ line: i, level: m[1].length, text: m[2].trim() });
  });
  return out;
}

const norm = (s: string) => s.replace(/^#+\s*/, '').trim().toLowerCase();

/** Where a section ends: the next heading at its level or above (or the end). */
const endOf = (hs: Heading[], h: Heading, total: number) => hs.find((x) => x.line > h.line && x.level <= h.level)?.line ?? total;

/**
 * `section` names a heading, or a path of them: "Places › Koi pond" (also "Places > Koi pond" or
 * "## Places › ### Koi pond"). Its whole body (subsections too) becomes `content`, or with append the
 * content is added at its end. A heading that isn't there yet is added (under its parent, or at the end).
 */
export function editSection(text: string, section: string, content: string, append = false): string {
  const path = section.split(/\s*(?:›|>)\s*/).filter(Boolean);
  if (!path.length) throw bad('Name the section, e.g. "Places › Koi pond".');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let body = content.replace(/\r\n/g, '\n').trim();
  let scope: { from: number; to: number; level: number } = { from: -1, to: lines.length, level: 0 };
  let target: Heading | null = null;
  for (let i = 0; i < path.length; i++) {
    const want = norm(path[i]);
    const hs = headings(lines);
    const found = hs.find((h) => h.line > scope.from && h.line < scope.to && h.level > scope.level && norm(h.text) === want);
    if (found) {
      target = found;
      scope = { from: found.line, to: endOf(hs, found, lines.length), level: found.level };
      continue;
    }
    // not there: add it (and anything after it in the path) at the end of where it belongs
    const explicit = /^(#+)\s/.exec(path[i].trim());
    const level = explicit ? explicit[1].length : Math.min(6, Math.max(2, scope.level + 1));
    let at = scope.to;
    while (at > scope.from + 1 && !lines[at - 1].trim()) at--;
    const added = [`${'#'.repeat(level)} ${path[i].replace(/^#+\s*/, '').trim()}`];
    lines.splice(at, 0, '', ...added, '');
    const hs2 = headings(lines);
    target = hs2.find((h) => h.line === at + 1)!;
    scope = { from: target.line, to: endOf(hs2, target, lines.length), level: target.level };
  }
  const h = target!;
  // a body that repeats the heading it goes under: drop that line
  const first = body.split('\n')[0];
  if (/^#+\s/.test(first) && norm(first) === norm(h.text)) body = body.split('\n').slice(1).join('\n').trim();
  const end = scope.to;
  let bodyEnd = end;
  while (bodyEnd > h.line + 1 && !lines[bodyEnd - 1].trim()) bodyEnd--;
  if (append) {
    const old = lines.slice(h.line + 1, bodyEnd);
    lines.splice(h.line + 1, bodyEnd - (h.line + 1), ...old, ...(old.length && old[old.length - 1].trim() && !/^[-*+]\s|^\d+\.\s/.test(body) ? [''] : []), ...body.split('\n'));
  } else lines.splice(h.line + 1, bodyEnd - (h.line + 1), ...(body ? ['', ...body.split('\n')] : []));
  return tidy(lines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

export function writeWorldMdSection(worldId: string, section: string, content: unknown, append = false): WorldMdInfo {
  const text = String(content ?? '');
  if (!text.trim() && append) throw bad('Nothing to add.');
  return writeWorldMd(worldId, editSection(readWorldMd(worldId), section, text, append));
}

/** WORLD.md for a builder's instructions: cut to WORLD_MD_SHOWN. */
export function worldMdContext(worldId: string, worldName: string): string {
  const text = readWorldMd(worldId).trim();
  const cut = text.length > WORLD_MD_SHOWN;
  return `\n# The voxel world: ${worldName}
${DIORAMA}
${BUILD_ORDER}
WORLD.md says what this world is. Read it before you build, build in its style, and keep it up to date: after you build a place or dress a character, update its section with world_md_section and add one line to "Story so far".
<world-md>
${cut ? `${text.slice(0, WORLD_MD_SHOWN)}\n… (${(text.length - WORLD_MD_SHOWN).toLocaleString('en-US')} more characters: read it all with world_md_read)` : text}
</world-md>`;
}
