// Free asset libraries: picking the right files from Poly Haven and ambientCG answers, and the
// small unzip that unpacks ambientCG downloads without letting a zip write outside its folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pickPolyhavenFiles, pickAmbientcgDownload } from '../../server/assets.ts';
import type { PhFiles } from '../../server/assets.ts';
import { extractZip, readZip, safeEntryName } from '../../server/unzip.ts';
import { allTools, callTool } from '../../server/tools.ts';
import type { ToolAgent } from '../../server/tools.ts';

// A zip with stored or deflated entries, built by hand like any zip program would.
function makeZip(entries: { name: string; data: string; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data);
    const body = e.deflate ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('unzip', () => {
  it('reads stored and deflated files', () => {
    const zip = makeZip([
      { name: 'Wood_Color.jpg', data: 'color' },
      { name: 'maps/Wood_Normal.jpg', data: 'normal '.repeat(50), deflate: true },
      { name: 'maps/', data: '' },
    ]);
    expect(readZip(zip).map((e) => [e.name, e.data.toString()])).toEqual([
      ['Wood_Color.jpg', 'color'],
      ['maps/Wood_Normal.jpg', 'normal '.repeat(50)],
    ]);
  });

  it('never writes outside the target folder', () => {
    expect(safeEntryName('../evil.txt')).toBeNull();
    expect(safeEntryName('a/../../evil.txt')).toBeNull();
    expect(safeEntryName('/etc/evil')).toBeNull();
    expect(safeEntryName('C:\\evil.txt')).toBeNull();
    expect(safeEntryName('a\\b.txt')).toBe('a/b.txt');
    const base = fs.mkdtempSync(path.join(os.homedir(), 'unzip-'));
    const dir = path.join(base, 'asset');
    const written = extractZip(makeZip([{ name: '../outside.txt', data: 'x' }, { name: 'ok/inside.txt', data: 'y' }]), dir);
    expect(written).toEqual(['ok/inside.txt']);
    expect(fs.existsSync(path.join(base, 'outside.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'ok', 'inside.txt'), 'utf8')).toBe('y');
  });

  // (junctions need no admin rights on Windows; elsewhere 'junction' makes a plain folder link)
  it("doesn't write through a folder link already in the target folder", () => {
    const base = fs.mkdtempSync(path.join(os.homedir(), 'unzip-link-'));
    const outside = path.join(base, 'outside');
    const dir = path.join(base, 'asset');
    fs.mkdirSync(outside);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(outside, 'color.jpg'), 'outside sentinel');
    fs.symlinkSync(outside, path.join(dir, 'maps'), 'junction');
    const written = extractZip(makeZip([{ name: 'maps/color.jpg', data: 'outside changed by zip' }, { name: 'ok.jpg', data: 'fine' }]), dir);
    expect(written).toEqual(['ok.jpg']);
    expect(fs.readFileSync(path.join(outside, 'color.jpg'), 'utf8')).toBe('outside sentinel');
  });

  it('refuses something that is not a zip', () => {
    expect(() => readZip(Buffer.from('hello, not a zip at all'))).toThrow(/Not a zip/);
  });
});

const f = (url: string, include?: Record<string, { url: string }>) => ({ url, size: 1, include });

describe('Poly Haven files', () => {
  const texture: PhFiles = {
    Diffuse: { '1k': { jpg: f('https://dl.polyhaven.org/t/wood_diff_1k.jpg'), png: f('https://dl.polyhaven.org/t/wood_diff_1k.png') } },
    nor_gl: { '1k': { jpg: f('https://dl.polyhaven.org/t/wood_nor_gl_1k.jpg') } },
    blend: { '1k': { blend: f('https://dl.polyhaven.org/t/wood_1k.blend', { 'textures/wood_diff_1k.jpg': { url: 'https://dl.polyhaven.org/t/wood_diff_1k.jpg' } }) } },
  };

  it('give every texture map, or a ready .blend with its maps', () => {
    expect(pickPolyhavenFiles(texture, '1k').map((x) => x.rel)).toEqual(['wood_diff_1k.jpg', 'wood_nor_gl_1k.jpg']);
    expect(pickPolyhavenFiles(texture, '1K', 'png').map((x) => x.rel)).toEqual(['wood_diff_1k.png']);
    expect(pickPolyhavenFiles(texture, '1k', 'blend').map((x) => x.rel)).toEqual(['wood_1k.blend', 'textures/wood_diff_1k.jpg']);
    expect(pickPolyhavenFiles(texture, '8k')).toEqual([]);
  });

  it('give an HDRI as .hdr unless asked for .exr, and a model as glTF with its textures', () => {
    const hdri: PhFiles = { hdri: { '2k': { hdr: f('https://dl.polyhaven.org/h/sky_2k.hdr'), exr: f('https://dl.polyhaven.org/h/sky_2k.exr') } } };
    expect(pickPolyhavenFiles(hdri, '2k').map((x) => x.rel)).toEqual(['sky_2k.hdr']);
    expect(pickPolyhavenFiles(hdri, '2k', 'exr').map((x) => x.rel)).toEqual(['sky_2k.exr']);
    const model: PhFiles = { gltf: { '1k': { gltf: f('https://dl.polyhaven.org/m/chair_1k.gltf', { 'textures/chair_diff_1k.jpg': { url: 'https://dl.polyhaven.org/m/chair_diff_1k.jpg' } }) } } };
    expect(pickPolyhavenFiles(model, '1k').map((x) => x.rel)).toEqual(['chair_1k.gltf', 'textures/chair_diff_1k.jpg']);
  });
});

describe('ambientCG downloads', () => {
  const dl = (attribute: string) => ({ attribute, downloadLink: `https://ambientcg.com/get?file=X_${attribute}.zip`, fileName: `X_${attribute}.zip` });
  const asset = { assetId: 'X', downloadFolders: { default: { downloadFiletypeCategories: { zip: { downloads: [dl('1K-JPG'), dl('2K-JPG'), dl('2K-PNG')] } } } } };

  it('pick the size and format asked for', () => {
    expect(pickAmbientcgDownload(asset, '2K', 'PNG')?.attribute).toBe('2K-PNG');
    expect(pickAmbientcgDownload(asset, '1k', 'jpg')?.attribute).toBe('1K-JPG');
    expect(pickAmbientcgDownload(asset, '2K')?.attribute).toBe('2K-JPG');
    expect(pickAmbientcgDownload(asset, '8K', 'JPG')).toBeNull();
  });
});

describe('asset tools', () => {
  it('search without asking, download with a low risk', () => {
    const risk = (n: string) => allTools().find((t) => t.name === n)?.risk;
    expect(risk('asset_search')).toBe('none');
    expect(risk('asset_download')).toBe('low');
  });

  it("won't download into an asset folder that links out of the allowed folders", async () => {
    const base = fs.mkdtempSync(path.join(os.homedir(), 'asset-link-'));
    const workspace = path.join(base, 'workspace');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(workspace, 'wood'), 'junction');
    const agent: ToolAgent = { id: 'asset-agent', name: 'Assets', toolGroups: ['assets'], autonomy: 'auto', workspace, knowledge: { folders: [] } };
    const r = await callTool(agent, 'asset_download', { source: 'polyhaven', id: 'wood', folder: '.' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/outside the folders/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});
