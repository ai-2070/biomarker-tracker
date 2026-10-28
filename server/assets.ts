// Free asset libraries agents can search and download from without a key:
// Poly Haven (HDRIs, textures, models) and ambientCG (materials, HDRIs, models). Both are CC0.
import fs from 'node:fs';
import path from 'node:path';
import { fetchJSON } from './util.ts';
import { extractZip, safeEntryName, writeInside } from './unzip.ts';

// Poly Haven asks API users to send their own User-Agent.
const UA = 'Blacksite (local AI agent dashboard)';
const HEADERS = { 'User-Agent': UA };
// Downloads only come from the libraries' own file hosts, whatever an API answer says.
const FILE_HOSTS = new Set(['dl.polyhaven.org', 'ambientcg.com', 'acg-download.struffelproductions.com']);
const MAX_FILE = 2 * 1024 ** 3;

export type AssetSource = 'polyhaven' | 'ambientcg';
export type AssetKind = 'hdri' | 'texture' | 'model';

export interface AssetHit {
  id: string;
  name: string;
  kind: string;
  categories: string[];
  tags: string[];
  /** Largest size, e.g. "8k" or "8192x8192". */
  maxSize?: string;
}

/** A file to download: where it goes (relative to the asset's folder) and from where. */
export interface AssetFile {
  rel: string;
  url: string;
  size?: number;
}

// ---------- Poly Haven ----------
interface PhAsset {
  name: string;
  type: number;
  categories?: string[];
  tags?: string[];
  max_resolution?: number[];
}
interface PhFile {
  url: string;
  size?: number;
  include?: Record<string, { url: string; size?: number }>;
}
/** /files/{id}: map → resolution → format → file. */
export type PhFiles = Record<string, Record<string, Record<string, PhFile>>>;

const PH_TYPE: Record<AssetKind, string> = { hdri: 'hdris', texture: 'textures', model: 'models' };
const PH_KIND = ['hdri', 'texture', 'model'];

const words = (q: string): string[] => q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const matches = (q: string, hay: string[]): boolean => words(q).every((w) => hay.some((h) => h.toLowerCase().includes(w)));

let phCache: { at: number; key: string; list: Record<string, PhAsset> } | null = null;

export async function polyhavenSearch({ kind, query = '', category, limit = 20 }: { kind?: AssetKind; query?: string; category?: string; limit?: number }): Promise<AssetHit[]> {
  const params = new URLSearchParams();
  if (kind) params.set('t', PH_TYPE[kind]);
  if (category) params.set('c', category);
  const key = params.toString();
  if (!phCache || phCache.key !== key || Date.now() - phCache.at > 10 * 60_000) {
    phCache = { at: Date.now(), key, list: await fetchJSON<Record<string, PhAsset>>(`https://api.polyhaven.com/assets?${key}`, { headers: HEADERS, timeout: 30000 }) };
  }
  return Object.entries(phCache.list)
    .filter(([id, a]) => !query || matches(query, [id, a.name, ...(a.categories || []), ...(a.tags || [])]))
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map(([id, a]) => ({
      id,
      name: a.name,
      kind: PH_KIND[a.type] || String(a.type),
      categories: a.categories || [],
      tags: (a.tags || []).slice(0, 8),
      maxSize: a.max_resolution ? a.max_resolution.join('x') : undefined,
    }));
}

/**
 * The files of one Poly Haven asset at a size and format. HDRIs: the hdr/exr file. Textures: every
 * map (color, normal, roughness…) as jpg/png/exr, or a ready .blend/.gltf with its maps. Models: the
 * gltf/fbx/blend file with the textures it needs.
 */
export function pickPolyhavenFiles(files: PhFiles, resolution: string, format?: string): AssetFile[] {
  const res = resolution.toLowerCase();
  const bundle = (map: string, fmt: string): AssetFile[] => {
    const f = files[map]?.[res]?.[fmt];
    if (!f) return [];
    return [{ rel: path.posix.basename(new URL(f.url).pathname), url: f.url, size: f.size }, ...Object.entries(f.include || {}).map(([rel, x]) => ({ rel, url: x.url, size: x.size }))];
  };
  if (files.hdri) return bundle('hdri', (format || 'hdr').toLowerCase());
  const packaged = ['gltf', 'fbx', 'blend', 'usd', 'mtlx'];
  const fmt = (format || (files.Diffuse || files.nor_gl ? 'jpg' : 'gltf')).toLowerCase();
  if (packaged.includes(fmt)) return bundle(fmt, fmt);
  return Object.keys(files)
    .filter((m) => !packaged.includes(m))
    .flatMap((m) => bundle(m, fmt));
}

export async function polyhavenFiles(id: string, resolution = '2k', format?: string): Promise<AssetFile[]> {
  if (!/^[\w-]+$/.test(id)) throw new Error('That is not a Poly Haven asset id.');
  const files = await fetchJSON<PhFiles>(`https://api.polyhaven.com/files/${id}`, { headers: HEADERS, timeout: 30000 });
  const list = pickPolyhavenFiles(files, resolution, format);
  if (!list.length) {
    const sizes = [...new Set(Object.values(files).flatMap((r) => Object.keys(r)))].join(', ');
    throw new Error(`Nothing at ${resolution}${format ? ` in ${format}` : ''} for ${id}. Sizes it has: ${sizes}.`);
  }
  return list;
}

// ---------- ambientCG ----------
interface AcgDownload {
  downloadLink: string;
  fileName: string;
  size?: number;
  attribute: string;
}
interface AcgAsset {
  assetId: string;
  displayName?: string;
  dataType?: string;
  displayCategory?: string;
  tags?: string[];
  downloadFolders?: Record<string, { downloadFiletypeCategories?: Record<string, { downloads?: AcgDownload[] }> }>;
}

const ACG_TYPE: Record<AssetKind, string> = { hdri: 'HDRI', texture: 'Material', model: '3DModel' };

export async function ambientcgSearch({ kind, query = '', limit = 20 }: { kind?: AssetKind; query?: string; limit?: number }): Promise<AssetHit[]> {
  const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(limit, 100))), include: 'tagData,displayData' });
  if (kind) params.set('type', ACG_TYPE[kind]);
  if (query) params.set('q', query);
  const r = await fetchJSON<{ foundAssets?: AcgAsset[] }>(`https://ambientcg.com/api/v2/full_json?${params}`, { headers: HEADERS, timeout: 30000 });
  return (r.foundAssets || []).map((a) => ({ id: a.assetId, name: a.displayName || a.assetId, kind: a.dataType || '', categories: a.displayCategory ? [a.displayCategory] : [], tags: (a.tags || []).slice(0, 8) }));
}

/** The download of an ambientCG asset that fits, e.g. "2K-JPG" (size and format). */
export function pickAmbientcgDownload(asset: AcgAsset, resolution: string, format?: string): AcgDownload | null {
  const all = Object.values(asset.downloadFolders || {}).flatMap((f) => Object.values(f.downloadFiletypeCategories || {}).flatMap((c) => c.downloads || []));
  const want = `${resolution}${format ? `-${format}` : ''}`.toUpperCase();
  return all.find((d) => d.attribute.toUpperCase() === want) || all.find((d) => d.attribute.toUpperCase().startsWith(want)) || null;
}

export async function ambientcgFile(id: string, resolution = '2K', format = 'JPG'): Promise<{ download: AcgDownload; options: string[] }> {
  if (!/^[\w-]+$/.test(id)) throw new Error('That is not an ambientCG asset id.');
  const r = await fetchJSON<{ foundAssets?: AcgAsset[] }>(`https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData`, { headers: HEADERS, timeout: 30000 });
  const asset = (r.foundAssets || []).find((a) => a.assetId === id);
  if (!asset) throw new Error(`No ambientCG asset called ${id}.`);
  const options = Object.values(asset.downloadFolders || {}).flatMap((f) => Object.values(f.downloadFiletypeCategories || {}).flatMap((c) => (c.downloads || []).map((d) => d.attribute)));
  const download = pickAmbientcgDownload(asset, resolution, format);
  if (!download) throw new Error(`No ${resolution}-${format} download for ${id}. It has: ${options.join(', ')}.`);
  return { download, options };
}

// ---------- downloading ----------
async function fetchFile(url: string, signal?: AbortSignal): Promise<Buffer> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !FILE_HOSTS.has(u.hostname)) throw new Error(`Refused a download from ${u.hostname}.`);
  const res = await fetch(u, { headers: HEADERS, signal: signal || AbortSignal.timeout(10 * 60_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} downloading ${path.posix.basename(u.pathname)}`);
  const finalHost = new URL(res.url || url).hostname;
  if (res.url && !FILE_HOSTS.has(finalHost)) throw new Error(`Refused a download redirected to ${finalHost}.`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_FILE) throw new Error('That file is over 2 GB.');
  return Buffer.from(await res.arrayBuffer());
}

/** Download an asset's files into dir (made if needed). Returns the files written. */
export async function downloadAsset(source: AssetSource, id: string, dir: string, { resolution, format, signal }: { resolution?: string; format?: string; signal?: AbortSignal } = {}): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  if (source === 'polyhaven') {
    const files = await polyhavenFiles(id, resolution || '2k', format);
    const out: string[] = [];
    for (const f of files) {
      const rel = safeEntryName(f.rel);
      if (!rel) continue;
      if (writeInside(dir, rel, await fetchFile(f.url, signal))) out.push(rel);
    }
    return out;
  }
  const { download } = await ambientcgFile(id, resolution || '2K', format || 'JPG');
  const buf = await fetchFile(download.downloadLink, signal);
  if (/\.zip$/i.test(download.fileName)) return extractZip(buf, dir);
  const name = safeEntryName(download.fileName) || `${id}.bin`;
  return writeInside(dir, name, buf) ? [name] : [];
}
