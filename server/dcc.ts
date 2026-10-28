// Scripts and command lines for the 3D, texture, CAD, 3D printing and NVIDIA tools.
// No side effects here, so tests can check them without the programs installed.
import path from 'node:path';

/** A Python string literal for a path or name (JSON strings are valid Python strings). */
const pyStr = (s: string): string => JSON.stringify(s);

/** The mayapy script: start Maya without a window, open a scene, run the code, save. */
export function mayaScript({ code, scene, saveAs }: { code: string; scene?: string; saveAs?: string }): string {
  const type = saveAs && /\.mb$/i.test(saveAs) ? 'mayaBinary' : 'mayaAscii';
  return [
    'import maya.standalone',
    "maya.standalone.initialize(name='python')",
    'import maya.cmds as cmds',
    scene ? `cmds.file(${pyStr(scene)}, open=True, force=True)` : '',
    code,
    saveAs ? `cmds.file(rename=${pyStr(saveAs)})\ncmds.file(save=True, force=True, type='${type}')\nprint('Saved', ${pyStr(saveAs)})` : '',
    'maya.standalone.uninitialize()',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** The hython script: open a .hip file, run the code, save. */
export function houdiniScript({ code, hip, saveAs }: { code: string; hip?: string; saveAs?: string }): string {
  return [
    'import hou',
    hip ? `hou.hipFile.load(${pyStr(hip)}, suppress_save_prompt=True, ignore_load_warnings=True)` : '',
    code,
    saveAs ? `hou.hipFile.save(${pyStr(saveAs)})\nprint('Saved', ${pyStr(saveAs)})` : '',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** The program next to a main one (mayapy next to maya.exe, hython next to houdini.exe). */
export const sibling = (exe: string, name: string): string => path.join(path.dirname(exe), name);

/** Texture sizes Substance takes, as the power of two it wants ($outputsize 11 = 2048). */
export function sizeLog2(size: number): number {
  const n = Math.log2(size);
  if (!Number.isInteger(n) || n < 4 || n > 13) throw new Error('size must be a power of two from 16 to 8192, like 1024, 2048 or 4096.');
  return n;
}

const TEXTURE_FORMATS = ['png', 'jpg', 'tga', 'tif', 'exr', 'hdr', 'bmp', 'psd', 'dds'];

/** sbsrender arguments: render every output of a .sbsar to image files. */
export function sbsrenderArgs({ input, outputDir, format = 'png', size, graph, values = {} }: { input: string; outputDir: string; format?: string; size?: number; graph?: string; values?: Record<string, string | number> }): string[] {
  const fmt = format.toLowerCase().replace(/^\./, '');
  if (!TEXTURE_FORMATS.includes(fmt)) throw new Error(`format must be one of ${TEXTURE_FORMATS.join(', ')}.`);
  const sets = Object.entries(values).map(([k, v]) => {
    if (!/^[\w$][\w$/.-]*$/.test(k)) throw new Error(`"${k}" is not a parameter name.`);
    return ['--set-value', `${k}@${v}`];
  });
  const n = size ? sizeLog2(size) : null;
  return [
    'render',
    '--input', input,
    ...(graph ? ['--input-graph', graph] : []),
    '--output-path', outputDir,
    '--output-name', '{inputGraphUrl}_{outputNodeName}',
    '--output-format', fmt,
    ...(n ? ['--set-value', `$outputsize@${n},${n}`] : []),
    ...sets.flat(),
  ];
}

const MODEL_FORMATS = ['stl', '3mf', 'obj', 'off', 'amf', 'dxf', 'svg', 'png', 'pdf'];

/** openscad arguments: render a .scad file to a model or image, with variables set (-D). */
export function openscadArgs({ input, output, defines = {} }: { input: string; output: string; defines?: Record<string, string | number | boolean> }): string[] {
  const ext = path.extname(output).slice(1).toLowerCase();
  if (!MODEL_FORMATS.includes(ext)) throw new Error(`The output must end in .${MODEL_FORMATS.join(', .')}.`);
  const sets = Object.entries(defines).map(([k, v]) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(k)) throw new Error(`"${k}" is not an OpenSCAD variable name.`);
    return ['-D', `${k}=${typeof v === 'string' && !/^[-\d.]+$|^(true|false|undef)$|^[[("]/.test(v) ? JSON.stringify(v) : v}`];
  });
  return ['-o', output, ...sets.flat(), input];
}

// PrusaSlicer options that take files or folders, do something other than set a print setting, or run programs
const NOT_A_SETTING = /^(no-)?(load|o|output|output-filename-format|save|datadir|loadconfig|config|post-process|export-.*|import-.*|info|help.*|gcodeviewer|single-instance.*|delete-after-load|threads|loglevel|sw-renderer|opengl-.*|app-updater|.*-file|.*-files|.*-path|.*-dir)$/;

/** prusa-slicer-console arguments: slice a model to G-code with saved profiles and a few settings. */
export function prusaSlicerArgs({ input, output, profiles = [], settings = {} }: { input: string; output: string; profiles?: string[]; settings?: Record<string, string | number | boolean> }): string[] {
  if (!/\.(gcode|bgcode)$/i.test(output)) throw new Error('The output must end in .gcode or .bgcode.');
  const opts = Object.entries(settings).flatMap(([k, v]) => {
    const key = k.toLowerCase().replace(/_/g, '-');
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error(`"${k}" is not a PrusaSlicer setting name.`);
    // Files go in profiles, input and output, where they are checked; settings that name files, read or
    // write elsewhere, or run a program (post-process) are refused.
    if (NOT_A_SETTING.test(key)) throw new Error(`"${k}" can't be set here: give profiles in "profiles", and the files in "input" and "output".`);
    if (v === true) return [`--${key}`];
    if (v === false) return [`--no-${key}`];
    return [`--${key}`, String(v)];
  });
  return ['--export-gcode', ...(/\.bgcode$/i.test(output) ? ['--binary-gcode'] : []), ...profiles.flatMap((p) => ['--load', p]), ...opts, '--output', output, input];
}

/** What nvidia-smi --query-gpu is asked for, in this order. */
export const GPU_FIELDS = ['name', 'driver_version', 'temperature.gpu', 'utilization.gpu', 'memory.used', 'memory.total', 'power.draw'];

/** nvidia-smi's CSV (no header, no units) as plain lines, one per graphics card. */
export function formatGpus(csv: string): string {
  const rows = csv
    .split(/\r?\n/)
    .map((l) => l.split(',').map((x) => x.trim()))
    .filter((r) => r.length >= GPU_FIELDS.length && r[0]);
  if (!rows.length) return 'No NVIDIA graphics card answered.';
  const num = (v: string, unit: string): string => (/^[\d.]+$/.test(v) ? `${v}${unit}` : 'n/a');
  return rows
    .map(([name, driver, temp, util, used, total, power], i) => {
      const mem = /^[\d.]+$/.test(used) && /^[\d.]+$/.test(total) ? `${(+used / 1024).toFixed(1)} of ${(+total / 1024).toFixed(1)} GB memory used` : 'memory n/a';
      return `GPU ${i}: ${name} (driver ${driver}): ${num(util, '%')} busy, ${num(temp, '°C')}, ${mem}, ${num(power, ' W')}`;
    })
    .join('\n');
}

/** nvtt_export arguments: compress an image into a DDS (or KTX) texture for games. */
export function nvttArgs({ input, output, format = 'bc7', mips = true }: { input: string; output: string; format?: string; mips?: boolean }): string[] {
  if (!/\.(dds|ktx2?)$/i.test(output)) throw new Error('The output must end in .dds, .ktx or .ktx2.');
  if (!/^[a-z0-9_]+$/i.test(format)) throw new Error('format is a compression name such as bc7, bc1, bc3, bc4, bc5 or rgba8.');
  // since 2024.1 --no-mips only stops reading mips; one mip level is what stops making them
  return [input, '--format', format.toLowerCase(), ...(mips ? [] : ['--no-mips', '--max-mip-count', '1']), '--output', output];
}

/** HandBrakeCLI arguments: convert or shrink a video with a built-in preset, optionally a set quality and encoder. */
export function handbrakeArgs({ input, output, preset = 'Fast 1080p30', quality, encoder }: { input: string; output: string; preset?: string; quality?: number; encoder?: string }): string[] {
  if (!/\.(mp4|m4v|mkv|webm)$/i.test(output)) throw new Error('The output must end in .mp4, .m4v, .mkv or .webm.');
  if (!/^[\w .()/+-]{2,80}$/.test(preset)) throw new Error('That is not a HandBrake preset name.');
  if (quality !== undefined && !(quality >= 0 && quality <= 63)) throw new Error('quality is a number from 0 (best) to 51, 22 is a good default.');
  if (encoder !== undefined && !/^[a-z0-9_]+$/.test(encoder)) throw new Error('encoder is a name such as x264, x265, nvenc_h264, nvenc_h265 or svt_av1.');
  return ['-i', input, '-o', output, '--preset', preset, ...(quality !== undefined ? ['-q', String(quality)] : []), ...(encoder ? ['-e', encoder] : [])];
}
