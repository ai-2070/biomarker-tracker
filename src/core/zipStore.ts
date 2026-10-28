/**
 * Packs files into a .zip without compression, in the browser (used to send a chosen profile
 * folder to the local server, which reads it like a backup). Pure; tested against the server's reader.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface StoreEntry {
  name: string;
  data: Uint8Array;
}

export function zipStore(entries: readonly StoreEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, e.data.length, true);
    dir.setUint32(24, e.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), name, e.data);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** The files of a chosen folder that make up a profile (path as the browser gives it, e.g. "anna-1a2b/results.json"). */
const PROFILE_FILE = /^(results|log|experiments|settings|files)\.json$|^README\.txt$/;

/**
 * Groups the files of a chosen folder into profiles: every folder with a profile.json is one profile,
 * with its data files and files/ folder. Works whether a single profile folder or a folder of profiles was chosen.
 */
export function profilesInFolder<T extends { path: string }>(files: readonly T[]): { folder: string; files: { name: string; file: T }[] }[] {
  const roots = files.filter((f) => f.path.split("/").at(-1) === "profile.json").map((f) => f.path.slice(0, -"profile.json".length));
  return roots.map((root) => {
    const own = files.filter((f) => {
      if (!f.path.startsWith(root)) return false;
      const rest = f.path.slice(root.length);
      return rest === "profile.json" || PROFILE_FILE.test(rest) || /^files\/[^/]+$/.test(rest);
    });
    const folder = root.replace(/\/$/, "").split("/").at(-1) || "profile";
    return { folder, files: own.map((f) => ({ name: `${folder}/${f.path.slice(root.length)}`, file: f })) };
  });
}
