// MEMORY.md: notes an agent (or the Brain) keeps across all its chats in a project. It is read into
// its instructions every turn; it adds to it with memory tools (the Brain with actions) and you can
// read and edit it on the page. data/projects/<id>/memory/<agent id or "brain">/MEMORY.md
// Each change keeps the version from before it (see versions.ts), so a bad rewrite can be undone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { agents, activeProject, emit } from './store.ts';
import { dataPath, ensureDir } from './util.ts';
import { keepVersion } from './versions.ts';
import type { MemoryInfo } from '../shared/types.ts';

/** The Brain's memory goes by this name (an agent can't have it as its id). */
export const BRAIN = 'brain';
export const MEMORY_FILE = 'MEMORY.md';
/** The most a MEMORY.md may hold. */
export const MEMORY_MAX = 50_000;
/** How much of it goes into the instructions (the rest: memory_read). */
export const MEMORY_SHOWN = 12_000;

/** What a memory version keeps (versions/memory/<owner>/). */
export interface MemoryVersionItem {
  name: string;
  text: string;
}

const notFound = (msg: string) => Object.assign(new Error(msg), { status: 404 });

/** An owner that can have a memory: the Brain, or an id an agent could have (no paths). */
export const isMemoryOwner = (owner: unknown): owner is string => typeof owner === 'string' && /^[\w.-]{1,80}$/.test(owner) && !owner.startsWith('.');

const pidOf = (pid?: string) => pid || activeProject().id;
export const memoryRoot = (pid?: string): string => dataPath('projects', pidOf(pid), 'memory');
export const memoryVersionsDir = (owner = '', pid?: string): string => dataPath('projects', pidOf(pid), 'versions', 'memory', owner);

function fileOf(owner: string, pid?: string): string {
  if (!isMemoryOwner(owner)) throw Object.assign(new Error('Invalid memory owner'), { status: 400 });
  return path.join(memoryRoot(pid), owner, MEMORY_FILE);
}

/** Whose memory it is, for the page and its history. */
export function memoryName(owner: string): string {
  if (owner === BRAIN) return 'The Brain';
  return agents.get(owner)?.name || `(deleted agent ${owner})`;
}
/** "Writer's MEMORY.md", "The Brain's MEMORY.md" */
export const memoryTitle = (owner: string): string => `${memoryName(owner)}'s ${MEMORY_FILE}`;

// A plain file only: a link could point at data/secrets.json or anywhere else on the PC.
function plainFile(file: string): fs.Stats | null {
  try {
    const st = fs.lstatSync(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

export function readMemory(owner: string, pid?: string): string {
  const file = fileOf(owner, pid);
  if (!plainFile(file)) return '';
  try {
    return fs.readFileSync(file, 'utf8').slice(0, MEMORY_MAX * 2);
  } catch {
    return '';
  }
}

/** When it last changed (0: there is none yet). */
export function memoryStamp(owner: string, pid?: string): number {
  return plainFile(fileOf(owner, pid))?.mtimeMs || 0;
}

export function memoryInfo(owner: string, pid?: string): MemoryInfo {
  if (owner !== BRAIN && !agents.get(owner) && !memoryStamp(owner, pid)) throw notFound('No agent by that id.');
  return { owner, name: memoryName(owner), text: readMemory(owner, pid), updatedAt: Math.round(memoryStamp(owner, pid)), max: MEMORY_MAX };
}

// Line endings as written, trailing spaces trimmed, one newline at the end (an empty memory stays empty).
const tidy = (text: string): string => {
  const t = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return t ? `${t}\n` : '';
};

/** Replace the whole MEMORY.md. The version from before is kept (who changed it: see withActor). */
export function writeMemory(owner: string, text: unknown, pid?: string): MemoryInfo {
  const file = fileOf(owner, pid);
  const next = tidy(String(text ?? ''));
  if (next.length > MEMORY_MAX) throw Object.assign(new Error(`MEMORY.md can hold up to ${MEMORY_MAX.toLocaleString('en-US')} characters (this is ${next.length.toLocaleString('en-US')}). Shorten it.`), { status: 400 });
  const before = readMemory(owner, pid);
  if (before === next) return memoryInfo(owner, pid);
  const dir = ensureDir(path.dirname(file));
  // never write through a link (see plainFile)
  try {
    if (fs.lstatSync(dir).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink()) throw new Error('MEMORY.md is a link; not writing through it.');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const name = memoryTitle(owner);
  if (before) keepVersion<MemoryVersionItem>(memoryVersionsDir(owner, pid), { name, text: before }, { name, text: next }, { ignore: ['name'] });
  // to a temp file first, then renamed, so a crash never leaves half a memory
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, file);
  emit('memory', { owner, project: pidOf(pid) });
  return memoryInfo(owner, pid);
}

/** Add one note at the end (as a list item, unless it already is one or a heading). */
export function addToMemory(owner: string, note: unknown, pid?: string): MemoryInfo {
  const t = String(note ?? '').replace(/\r\n/g, '\n').trim();
  if (!t) throw new Error('Nothing to remember: the note is empty.');
  const line = /^([-*+]|\d+\.|#+)\s/.test(t) ? t : `- ${t.replace(/\n+/g, ' ')}`;
  const before = readMemory(owner, pid).trimEnd();
  return writeMemory(owner, before ? `${before}\n${line}` : line, pid);
}

// ---------- from a project folder or a backup ----------
/** A memory version made elsewhere (a project folder, a backup), or null when it isn't one. */
export function cleanMemoryVersion(item: Record<string, unknown>, owner: string): MemoryVersionItem | null {
  if (typeof item.text !== 'string' || item.text.length > MEMORY_MAX * 2) return null;
  return { name: typeof item.name === 'string' ? item.name.slice(0, 200) : `${owner}'s ${MEMORY_FILE}`, text: item.text };
}

/** Put a MEMORY.md from elsewhere (a project folder, a backup) into a project, as it is (no version kept). */
export function putMemory(pid: string, owner: string, text: string): boolean {
  if (!isMemoryOwner(owner) || text.length > MEMORY_MAX * 2) return false;
  const file = fileOf(owner, pid);
  ensureDir(path.dirname(file));
  if (fs.lstatSync(path.dirname(file)).isSymbolicLink()) return false;
  fs.writeFileSync(file, tidy(text));
  return true;
}

// What goes into the instructions: the memory itself (up to MEMORY_SHOWN) and how to keep it.
// tooLong: what to do when it doesn't fit
function shown(text: string, tooLong: string): string {
  const t = text.trim();
  if (!t) return '(empty: nothing remembered yet)';
  if (t.length <= MEMORY_SHOWN) return t;
  return `${t.slice(0, MEMORY_SHOWN)}\n…(cut here: ${(t.length - MEMORY_SHOWN).toLocaleString('en-US')} more characters. ${tooLong})`;
}

/** Real agents have a memory; stand-ins (workflows, outside MCP clients: ids starting with _) don't. */
export const hasMemory = (agent: { id: string }): boolean => isMemoryOwner(agent.id) && !agent.id.startsWith('_') && agent.id !== BRAIN;

/** The "Your memory" part of an agent's instructions. */
export function memoryContext(agent: { id: string }, pid?: string): string {
  if (!hasMemory(agent)) return '';
  return `\n\n# Your memory (MEMORY.md)
Notes you keep across all your chats in this project, written by you or the user. Rely on them.
<memory>
${shown(readMemory(agent.id, pid), 'Read all of it with memory_read, and tidy it with memory_write so it fits.')}
</memory>
Keep it useful. When you learn something that will matter in later chats (how the user likes things done, decisions they made, facts about this project or its tools, what worked and what to avoid), add it with memory_add as one short line. Correct or drop notes that are wrong or outdated with memory_write (the whole new file). Don't save secrets (keys, passwords, tokens, personal data), details only this task needs, or what your instructions, knowledge or PROJECT.md already say.`;
}

/** The Brain's own memory, for its instructions. */
export function brainMemoryContext(pid?: string): string {
  return `\n\n# Your memory (MEMORY.md)
Your own notes, kept across conversations in this project. The user can read and edit them.
<memory>
${shown(readMemory(BRAIN, pid), 'Tidy it with write_memory so it fits.')}
</memory>
When you learn something that should outlast this conversation (how the user likes you to work, decisions they made, what worked or didn't), add it with the remember action as one short line. Rewrite it with write_memory to correct it or drop what's outdated. Facts about the project itself belong in PROJECT.md (every agent reads it); MEMORY.md is only yours. Never put secrets in it.`;
}
