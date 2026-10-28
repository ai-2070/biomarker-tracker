// The 3D, texture, CAD, 3D printing and NVIDIA tools: their scripts and command lines, and the
// folders they may read and write. The programs themselves are not needed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mayaScript, houdiniScript, sbsrenderArgs, openscadArgs, prusaSlicerArgs, nvttArgs, handbrakeArgs, formatGpus, sizeLog2 } from '../../server/dcc.ts';
import { TOOL_GROUPS, allTools, callTool } from '../../server/tools.ts';
import { discoverPrograms } from '../../server/programs.ts';
import { saveSettings } from '../../server/store.ts';
import type { ToolAgent } from '../../server/tools.ts';

describe('Maya and Houdini scripts', () => {
  it('start Maya without a window, open the scene, run the code and save', () => {
    const s = mayaScript({ code: 'cmds.polyCube()', scene: 'C:\\in\\shot.mb', saveAs: 'C:\\out\\shot.mb' });
    const lines = s.split('\n');
    expect(lines[0]).toBe('import maya.standalone');
    expect(s).toContain('cmds.file("C:\\\\in\\\\shot.mb", open=True, force=True)');
    expect(s.indexOf('cmds.polyCube()')).toBeGreaterThan(s.indexOf('open=True'));
    expect(s).toContain("type='mayaBinary'");
    expect(lines.at(-1)).toBe('maya.standalone.uninitialize()');
    expect(mayaScript({ code: 'x = 1', saveAs: 'a.ma' })).toContain("type='mayaAscii'");
    expect(mayaScript({ code: 'x = 1' })).not.toContain('cmds.file(');
  });

  it('load a .hip file in hython and save it afterwards', () => {
    const s = houdiniScript({ code: 'hou.node("/obj").createNode("geo")', hip: '/p/a.hip', saveAs: '/p/b.hip' });
    expect(s.split('\n')[0]).toBe('import hou');
    expect(s).toContain('hou.hipFile.load("/p/a.hip"');
    expect(s).toContain('hou.hipFile.save("/p/b.hip")');
  });
});

describe('command lines', () => {
  it('sbsrender: size as a power of two, parameters by name', () => {
    const a = sbsrenderArgs({ input: 'wood.sbsar', outputDir: 'out', size: 2048, values: { roughness: 0.4 } });
    expect(a.slice(0, 3)).toEqual(['render', '--input', 'wood.sbsar']);
    expect(a).toContain('$outputsize@11,11');
    expect(a).toContain('roughness@0.4');
    expect(a[a.indexOf('--output-format') + 1]).toBe('png');
    expect(sizeLog2(4096)).toBe(12);
    expect(() => sizeLog2(1000)).toThrow(/power of two/);
    expect(() => sbsrenderArgs({ input: 'a', outputDir: 'b', format: 'exe' })).toThrow(/format/);
    expect(() => sbsrenderArgs({ input: 'a', outputDir: 'b', values: { 'a b': 1 } })).toThrow(/parameter name/);
  });

  it('openscad: output type from the extension, text variables quoted', () => {
    expect(openscadArgs({ input: 'box.scad', output: 'box.stl', defines: { width: 40, label: 'A', on: true, size: '[1,2]' } })).toEqual([
      '-o', 'box.stl', '-D', 'width=40', '-D', 'label="A"', '-D', 'on=true', '-D', 'size=[1,2]', 'box.scad',
    ]);
    expect(() => openscadArgs({ input: 'a.scad', output: 'a.exe' })).toThrow(/output/);
    expect(() => openscadArgs({ input: 'a.scad', output: 'a.stl', defines: { 'x;y': 1 } })).toThrow(/variable name/);
  });

  it('PrusaSlicer: profiles, settings and on/off switches', () => {
    const a = prusaSlicerArgs({ input: 'part.stl', output: 'part.gcode', profiles: ['printer.ini'], settings: { layer_height: 0.2, 'fill-density': '20%', 'support-material': true, brim: false } });
    expect(a).toEqual(['--export-gcode', '--load', 'printer.ini', '--layer-height', '0.2', '--fill-density', '20%', '--support-material', '--no-brim', '--output', 'part.gcode', 'part.stl']);
    expect(prusaSlicerArgs({ input: 'a.stl', output: 'a.bgcode' })).toContain('--binary-gcode');
    expect(() => prusaSlicerArgs({ input: 'a.stl', output: 'a.txt' })).toThrow(/gcode/);
    expect(() => prusaSlicerArgs({ input: 'a.stl', output: 'a.gcode', settings: { 'x y': 1 } })).toThrow(/setting name/);
    // files only through profiles, input and output (those are checked), and nothing that runs a program
    for (const k of ['load', 'LOAD', 'output', 'o', 'datadir', 'post_process', 'export-3mf', 'save', 'loadconfig']) expect(() => prusaSlicerArgs({ input: 'a.stl', output: 'a.gcode', settings: { [k]: 'C:/outside/x.ini' } }), k).toThrow(/can't be set here/);
  });

  it('nvtt_export: BC7 by default, one mip level when mips are off', () => {
    expect(nvttArgs({ input: 'a.png', output: 'a.dds' })).toEqual(['a.png', '--format', 'bc7', '--output', 'a.dds']);
    expect(nvttArgs({ input: 'n.png', output: 'n.dds', format: 'BC5', mips: false })).toEqual(['n.png', '--format', 'bc5', '--no-mips', '--max-mip-count', '1', '--output', 'n.dds']);
    expect(() => nvttArgs({ input: 'a.png', output: 'a.png' })).toThrow(/dds/);
    expect(() => nvttArgs({ input: 'a.png', output: 'a.dds', format: 'bc7 --x' })).toThrow(/compression name/);
  });

  it('HandBrakeCLI: a preset, with quality and encoder only when asked', () => {
    expect(handbrakeArgs({ input: 'in.mov', output: 'out.mp4' })).toEqual(['-i', 'in.mov', '-o', 'out.mp4', '--preset', 'Fast 1080p30']);
    expect(handbrakeArgs({ input: 'in.mov', output: 'out.mkv', preset: 'Fast 2160p60 4K HEVC', quality: 20, encoder: 'nvenc_h265' })).toEqual([
      '-i', 'in.mov', '-o', 'out.mkv', '--preset', 'Fast 2160p60 4K HEVC', '-q', '20', '-e', 'nvenc_h265',
    ]);
    expect(() => handbrakeArgs({ input: 'a', output: 'a.exe' })).toThrow(/output/);
    expect(() => handbrakeArgs({ input: 'a', output: 'a.mp4', preset: 'x"; rm' })).toThrow(/preset/);
    expect(() => handbrakeArgs({ input: 'a', output: 'a.mp4', encoder: 'x264 --y' })).toThrow(/encoder/);
  });

  it('nvidia-smi output reads as plain lines', () => {
    const t = formatGpus('NVIDIA GeForce RTX 4090, 581.15, 45, 12, 2048, 24564, 61.30\nNVIDIA RTX A4000, 581.15, 50, [N/A], [N/A], 16376, [N/A]\n');
    expect(t).toContain('GPU 0: NVIDIA GeForce RTX 4090 (driver 581.15): 12% busy, 45°C, 2.0 of 24.0 GB memory used, 61.30 W');
    expect(t).toContain('GPU 1: NVIDIA RTX A4000 (driver 581.15): n/a busy, 50°C, memory n/a, n/a');
    expect(formatGpus('')).toMatch(/No NVIDIA/);
  });
});

describe('tool groups', () => {
  it('every new tool is in a listed group, and running code asks first', () => {
    const groups = new Set(TOOL_GROUPS.map((g) => g.id));
    for (const g of ['maya', 'houdini', 'substance', 'cad', 'nvidia']) expect(groups).toContain(g);
    const tools = allTools();
    const fresh = tools.filter((t) => /^(maya_|houdini_|substance_|nvidia_)|^(openscad_render|slice_model)$/.test(t.name));
    expect(fresh.length).toBe(10);
    for (const t of fresh) expect(groups, t.name).toContain(t.group);
    const risk = (n: string) => tools.find((t) => t.name === n)?.risk;
    expect(risk('maya_run_python')).toBe('high');
    expect(risk('houdini_run_python')).toBe('high');
    expect(risk('nvidia_gpu_status')).toBe('none');
    for (const n of ['substance_render', 'openscad_render', 'slice_model', 'nvidia_texture_export', 'handbrake_encode']) expect(risk(n), n).toBe('low');
    expect(risk('imagemagick')).toBe('high');
  });

  it('file tools for models and textures stay inside the allowed folders', async () => {
    // any real file stands in for the programs: the folder check comes before they run
    saveSettings({ paths: { openscad: process.execPath, prusaslicer: process.execPath, nvtt: process.execPath } });
    const base = fs.mkdtempSync(path.join(os.homedir(), 'dcc-'));
    const workspace = path.join(base, 'workspace');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(workspace, 'part.stl'), 'solid x');
    fs.writeFileSync(path.join(outside, 'secret.png'), 'x');
    const agent: ToolAgent = { id: 'cad-agent', name: 'CAD', toolGroups: ['cad', 'nvidia'], autonomy: 'full', workspace, knowledge: { folders: [] } };
    const outsideWrite = await callTool(agent, 'openscad_render', { code: 'cube(1);', output: path.join(outside, 'cube.stl') });
    expect(outsideWrite.text).toMatch(/outside the folders/);
    const outsideSlice = await callTool(agent, 'slice_model', { input: 'part.stl', output: path.join(outside, 'part.gcode') });
    expect(outsideSlice.text).toMatch(/outside the folders/);
    const outsideRead = await callTool(agent, 'nvidia_texture_export', { input: path.join(outside, 'secret.png'), output: 'secret.dds' });
    expect(outsideRead.text).toMatch(/outside the folders/);
    expect(fs.readdirSync(outside).sort()).toEqual(['secret.png']);
    saveSettings({ paths: { openscad: '', prusaslicer: '', nvtt: '' } });
  });
});

describe('program catalog', () => {
  it('knows the 3D, video, CAD, 3D printing and NVIDIA programs, each in a shown section', async () => {
    const progs = await discoverPrograms(true);
    const ids = new Set(progs.map((p) => p.id));
    for (const id of ['maya', 'houdini', 'painter', 'designer', 'resolve', 'capcut', 'kdenlive', 'freecad', 'openscad', 'prusaslicer', 'orcaslicer', 'bambustudio', 'cura', 'nvtt', 'indesign', 'animate', 'krita', 'inkscape', 'audacity', 'luminar', 'gigapixel', 'canva', 'vlc', 'imagemagick']) expect(ids, id).toContain(id);
    expect(progs.length).toBe(ids.size);
    for (const p of progs) expect(['ai', '3d', 'creative', 'video', 'audio', 'cad', 'print', 'nvidia', 'browser', 'dev', 'office'], p.id).toContain(p.category);
  });
});
