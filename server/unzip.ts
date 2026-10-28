// A small zip reader for downloaded asset packs (stored and deflated entries, no zip64).
// Entry names that climb out of the target folder, absolute paths and links are refused.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { insideRoots } from './util.ts';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const MAX_TOTAL = 4 * 1024 ** 3; // 4 GB unpacked, so a tiny zip can't fill the disk

/** A safe relative name inside a zip, or null. */
export function safeEntryName(name: string): string | null {
  const n = name.replace(/\\/g, '/');
  if (!n || n.startsWith('/') || /^[a-z]:/i.test(n) || n.includes('\0')) return null;
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

/** Every file in a zip (folders skipped). Throws on a damaged or unsupported zip. */
export function readZip(buf: Buffer): ZipEntry[] {
  // the end-of-central-directory record is in the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip is damaged.');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const external = buf.readUInt32LE(p + 38);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (((external >>> 16) & 0o170000) === 0o120000) continue; // a symlink
    if (size === 0xffffffff || compressed === 0xffffffff || local === 0xffffffff) throw new Error('Zip files over 4 GB are not supported.');
    total += size;
    if (total > MAX_TOTAL) throw new Error('The zip unpacks to more than 4 GB.');
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('The zip is damaged.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else throw new Error(`"${name}" uses a zip compression that is not supported.`);
    out.push({ name, data });
  }
  return out;
}

/** Write data to dir/rel (a safe relative name) only when it really lands inside dir: a folder or file
 * already there could be a link to elsewhere on the PC. False when it doesn't. */
export function writeInside(dir: string, rel: string, data: Buffer): boolean {
  const dest = path.join(dir, ...rel.split('/'));
  if (!insideRoots(dest, [dir])) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // (checked again once the folders are made, and written where it really is)
  const real = insideRoots(dest, [dir]);
  if (!real) return false;
  fs.writeFileSync(real, data);
  return true;
}

/** Unpack a zip into dir. Returns the files written (relative names); unsafe names, and entries that
 * would land outside dir through a link already there, are skipped. */
export function extractZip(buf: Buffer, dir: string): string[] {
  const written: string[] = [];
  for (const e of readZip(buf)) {
    const rel = safeEntryName(e.name);
    if (rel && writeInside(dir, rel, e.data)) written.push(rel);
  }
  return written;
}
