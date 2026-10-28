// Finds the programs on this PC (a known catalog plus everything in the Start Menu),
// checks which local services are up, and launches things.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, IS_WIN, exists, listDirs, walk, which, run, ping, launchDetached, openWithShell, readJSON } from './util.ts';
import { getSettings, emit } from './store.ts';

/** A Start Menu shortcut. folder is relative to the Start Menu's Programs folder. */
export interface StartMenuApp {
  name: string;
  shortcut: string;
  folder: string;
}

/** What a catalog entry's detect() finds. */
interface Detected {
  exe?: string | null;
  cli?: string | null;
  shortcut?: string | null;
  version?: string;
  all?: string[];
  optional?: boolean;
}

interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  icon: string;
  detect: () => Detected;
  /** Resolves to the URL of the program's local server when it is up. */
  service?: () => Promise<string | null>;
  cli?: boolean;
  actions: string[];
}

/** A known program as discoverPrograms() reports it. */
export interface Program {
  id: string;
  name: string;
  category: string;
  icon: string;
  installed: boolean;
  optional: boolean;
  exe: string | null;
  shortcut: string | null;
  version: string | null;
  versions: string[] | null;
  cli: boolean;
  running: boolean;
  serviceUrl: string | null;
  actions: string[];
}

interface ComfyConfig {
  basePath?: string;
}

const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const PROGDATA = process.env.ProgramData || 'C:\\ProgramData';

const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// Newest "<prefix><version>" folder under base that contains exeRel.
function newestVersioned(base: string, prefix: string, exeRel: string): { exe: string; version: string; all: string[] } | null {
  const dirs = listDirs(base)
    .filter((d) => d.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort(natural)
    .reverse();
  for (const d of dirs) {
    const exe = path.join(base, d, exeRel);
    if (exists(exe)) return { exe, version: d.slice(prefix.length).trim() || d, all: dirs.filter((x) => exists(path.join(base, x, exeRel))) };
  }
  return null;
}

const first = (...paths: (string | null | undefined)[]): string | null => paths.find((p) => p && exists(p)) || null;
const localProgram = (dir: string, exe: string): string | null => first(path.join(LOCAL, 'Programs', dir, exe));

// ---------- Start Menu ----------
let startMenuCache: { at: number; items: StartMenuApp[] } = { at: 0, items: [] };
export function startMenuApps(force = false): StartMenuApp[] {
  if (!IS_WIN) return [];
  if (!force && Date.now() - startMenuCache.at < 5 * 60_000) return startMenuCache.items;
  const roots = [path.join(ROAMING, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(PROGDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
  const seen = new Map<string, StartMenuApp>();
  for (const root of roots) {
    for (const file of walk(root, { maxDepth: 4, filter: (p) => /\.(lnk|url)$/i.test(p) })) {
      const name = path.basename(file).replace(/\.(lnk|url)$/i, '');
      if (/uninstall|readme|release notes|help|website|documentation|license|manual/i.test(name)) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, { name, shortcut: file, folder: path.relative(root, path.dirname(file)) || '' });
    }
  }
  const items = [...seen.values()].sort((a, b) => natural(a.name, b.name));
  startMenuCache = { at: Date.now(), items };
  return items;
}

const startMenuFind = (re: RegExp): StartMenuApp | null => startMenuApps().find((a) => re.test(a.name)) || null;

// A path the user set in Settings, when it is there.
const chosen = (key: string): string | null => {
  const p = getSettings().paths[key];
  return p && exists(p) ? p : null;
};
// A program in one of a few usual places, else its Start Menu shortcut (Store apps, odd installs).
const placed = (menu: RegExp, ...paths: string[]): Detected => {
  const exe = first(...paths);
  return exe ? { exe } : { exe: null, shortcut: startMenuFind(menu)?.shortcut || null };
};
const substance = (app: string): string | null => first(path.join(PF, 'Adobe', `Adobe Substance 3D ${app}`, `Adobe Substance 3D ${app}.exe`));
const nvidia = (...rel: string[]): string => path.join(PF, 'NVIDIA Corporation', ...rel);
// Topaz apps live in version-numbered folders ("Topaz Gigapixel AI 712"), under Topaz Labs LLC or right in Program Files.
function topaz(folder: RegExp, exes: string[]): Detected {
  for (const base of [path.join(PF, 'Topaz Labs LLC'), PF]) {
    const dirs = listDirs(base).filter((d) => /topaz/i.test(d) && folder.test(d)).sort(natural).reverse();
    for (const d of dirs) {
      const exe = first(...exes.map((e) => path.join(base, d, e)));
      if (exe) return { exe };
    }
  }
  return { exe: null, shortcut: startMenuFind(new RegExp(`^topaz.*${folder.source}`, 'i'))?.shortcut || null };
}

// ---------- known programs ----------
function comfyWorkflowDirs(): string[] {
  const s = getSettings();
  const dirs = [...(s.comfyui.workflowDirs || [])];
  const cfg = readJSON<ComfyConfig>(path.join(ROAMING, 'ComfyUI', 'config.json'), null);
  if (cfg?.basePath) dirs.push(path.join(cfg.basePath, 'user', 'default', 'workflows'));
  dirs.push(path.join(HOME, 'ComfyUI-Installs', 'ComfyUI', 'ComfyUI', 'user', 'default', 'workflows'));
  dirs.push(path.join(HOME, 'ComfyUI', 'user', 'default', 'workflows'));
  return [...new Set(dirs)].filter(exists);
}
export function comfyOutputDirs(): string[] {
  const cfg = readJSON<ComfyConfig>(path.join(ROAMING, 'ComfyUI', 'config.json'), null);
  return [cfg?.basePath && path.join(cfg.basePath, 'output'), path.join(HOME, 'ComfyUI-Shared', 'output'), path.join(HOME, 'ComfyUI-Installs', 'ComfyUI', 'ComfyUI', 'output')].filter(
    (p): p is string => !!p && exists(p),
  );
}
export { comfyWorkflowDirs };

const CATALOG: CatalogEntry[] = [
  // AI tools
  { id: 'claude', name: 'Claude Code', category: 'ai', icon: '✳️', detect: () => ({ exe: which('claude') }), cli: true, actions: ['terminal'] },
  { id: 'hermes', name: 'Hermes Agent', category: 'ai', icon: '☤', detect: () => ({ exe: which('hermes') }), cli: true, actions: ['terminal'] },
  { id: 'pi', name: 'pi', category: 'ai', icon: 'π', detect: () => ({ exe: which('pi') }), cli: true, actions: ['terminal'] },
  { id: 'omp', name: 'oh-my-pi', category: 'ai', icon: 'Ω', detect: () => ({ exe: which('omp') }), cli: true, actions: ['terminal'] },
  { id: 'openclaw', name: 'OpenClaw', category: 'ai', icon: '🦞', detect: () => ({ exe: which('openclaw') }), cli: true, actions: ['terminal'] },
  {
    id: 'orca',
    name: 'Orca',
    category: 'ai',
    icon: '🐋',
    detect: () => ({ exe: localProgram('orca', 'Orca.exe'), cli: which('orca') }),
    actions: ['launch', 'terminal'],
  },
  {
    id: 'comfyui',
    name: 'ComfyUI',
    category: 'ai',
    icon: '🧩',
    detect: () => {
      const s = getSettings();
      const lnk = startMenuFind(/^comfy/i);
      return { exe: s.paths.comfyui || null, shortcut: lnk?.shortcut || null };
    },
    service: async () => {
      const s = getSettings();
      for (const url of [s.comfyui.url, 'http://127.0.0.1:8188', 'http://127.0.0.1:8000'].filter(Boolean)) {
        if (await ping(`${url.replace(/\/$/, '')}/system_stats`, 1200)) return url.replace(/\/$/, '');
      }
      return null;
    },
    actions: ['launch', 'open-ui'],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    category: 'ai',
    icon: '🧠',
    detect: () => ({ exe: localProgram('LM Studio', 'LM Studio.exe') }),
    service: async () => ((await ping('http://127.0.0.1:1234/v1/models')) ? 'http://127.0.0.1:1234' : null),
    actions: ['launch'],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'ai',
    icon: '🦙',
    detect: () => ({ exe: which('ollama') || localProgram('Ollama', 'ollama app.exe') }),
    service: async () => ((await ping('http://127.0.0.1:11434/api/tags')) ? 'http://127.0.0.1:11434' : null),
    actions: ['launch'],
  },
  {
    id: 'netdesk',
    name: 'Net Desk',
    category: 'ai',
    icon: '🛰️',
    detect: () => ({ exe: null, optional: true }),
    service: async () => ((await ping('http://localhost:8770', 1000)) ? 'http://localhost:8770' : null),
    actions: ['open-ui'],
  },
  { id: 'opendesign', name: 'Open Design', category: 'ai', icon: '📐', detect: () => ({ exe: localProgram('Open Design', 'Open Design.exe') }), actions: ['launch'] },
  // 3D and animation
  {
    id: 'blender',
    name: 'Blender',
    category: '3d',
    icon: '🟠',
    detect: () => {
      const s = getSettings();
      if (s.paths.blender && exists(s.paths.blender)) return { exe: s.paths.blender };
      return newestVersioned(path.join(PF, 'Blender Foundation'), 'Blender ', 'blender.exe') || { exe: which('blender') };
    },
    actions: ['launch', 'open', 'python'],
  },
  {
    id: 'maya',
    name: 'Maya',
    category: '3d',
    icon: '🔷',
    detect: () => (chosen('maya') ? { exe: chosen('maya') } : newestVersioned(path.join(PF, 'Autodesk'), 'Maya', path.join('bin', 'maya.exe')) || { exe: null }),
    actions: ['launch', 'open', 'python'],
  },
  {
    id: 'houdini',
    name: 'Houdini',
    category: '3d',
    icon: '🌀',
    detect: () => (chosen('houdini') ? { exe: chosen('houdini') } : newestVersioned(path.join(PF, 'Side Effects Software'), 'Houdini ', path.join('bin', 'houdini.exe')) || { exe: null }),
    actions: ['launch', 'open', 'python'],
  },
  { id: 'painter', name: 'Substance 3D Painter', category: '3d', icon: '🖌️', detect: () => ({ exe: chosen('painter') || substance('Painter') }), actions: ['launch', 'open'] },
  { id: 'designer', name: 'Substance 3D Designer', category: '3d', icon: '🧪', detect: () => ({ exe: chosen('designer') || substance('Designer') }), actions: ['launch', 'open', 'render'] },
  { id: 'sampler', name: 'Substance 3D Sampler', category: '3d', icon: '📷', detect: () => ({ exe: substance('Sampler') }), actions: ['launch', 'open'] },
  { id: 'stager', name: 'Substance 3D Stager', category: '3d', icon: '🎭', detect: () => ({ exe: substance('Stager'), optional: true }), actions: ['launch', 'open'] },
  { id: 'modeler', name: 'Substance 3D Modeler', category: '3d', icon: '🗿', detect: () => ({ exe: substance('Modeler'), optional: true }), actions: ['launch', 'open'] },
  { id: 'animate', name: 'Animate', category: '3d', icon: '🎞', detect: () => adobe(null, 'Adobe Animate ', 'Animate.exe'), actions: ['launch', 'open'] },
  {
    id: 'characteranimator',
    name: 'Character Animator',
    category: '3d',
    icon: '🙂',
    detect: () => adobe(null, 'Adobe Character Animator ', path.join('Support Files', 'Character Animator.exe')),
    actions: ['launch', 'open'],
  },
  // auto-rigging and animation; mostly used at mesh2motion.org, this is its desktop app
  { id: 'mesh2motion', name: 'Mesh2Motion', category: '3d', icon: '🦴', detect: () => ({ ...placed(/mesh2motion/i, path.join(LOCAL, 'Programs', 'mesh2motion', 'Mesh2Motion.exe')), optional: true }), actions: ['launch'] },
  // Game engines (their MCP servers are suggested once one is found)
  {
    id: 'unity',
    name: 'Unity',
    category: '3d',
    icon: '🎮',
    // the newest editor Unity Hub installed, else Unity Hub itself
    detect: () => newestVersioned(path.join(PF, 'Unity', 'Hub', 'Editor'), '', path.join('Editor', 'Unity.exe')) || placed(/^unity hub/i, path.join(PF, 'Unity Hub', 'Unity Hub.exe')),
    actions: ['launch', 'open'],
  },
  {
    id: 'unreal',
    name: 'Unreal Engine',
    category: '3d',
    icon: '🕹️',
    detect: () => newestVersioned(path.join(PF, 'Epic Games'), 'UE_', path.join('Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')) || placed(/^unreal engine/i),
    actions: ['launch', 'open'],
  },
  { id: 'godot', name: 'Godot', category: '3d', icon: '🤖', detect: () => ({ exe: which('godot') || null, shortcut: startMenuFind(/^godot/i)?.shortcut || null }), actions: ['launch', 'open'] },
  // Images and design
  { id: 'photoshop', name: 'Photoshop', category: 'creative', icon: '🖼️', detect: () => adobe('photoshop', 'Adobe Photoshop ', 'Photoshop.exe'), actions: ['launch', 'open', 'jsx'] },
  {
    id: 'illustrator',
    name: 'Illustrator',
    category: 'creative',
    icon: '✒️',
    detect: () => adobe(null, 'Adobe Illustrator ', path.join('Support Files', 'Contents', 'Windows', 'Illustrator.exe')),
    actions: ['launch', 'open'],
  },
  { id: 'indesign', name: 'InDesign', category: 'creative', icon: '📰', detect: () => adobe(null, 'Adobe InDesign ', 'InDesign.exe'), actions: ['launch', 'open'] },
  {
    id: 'lightroomclassic',
    name: 'Lightroom Classic',
    category: 'creative',
    icon: '🌅',
    detect: () => placed(/^adobe lightroom classic/i, path.join(PF, 'Adobe', 'Adobe Lightroom Classic', 'Lightroom.exe')),
    actions: ['launch', 'open'],
  },
  { id: 'lightroom', name: 'Lightroom', category: 'creative', icon: '☀️', detect: () => placed(/^adobe lightroom$/i, path.join(PF, 'Adobe', 'Adobe Lightroom CC', 'lightroom.exe')), actions: ['launch', 'open'] },
  { id: 'bridge', name: 'Bridge', category: 'creative', icon: '🗂️', detect: () => adobe(null, 'Adobe Bridge ', 'Adobe Bridge.exe'), actions: ['launch', 'open'] },
  { id: 'fresco', name: 'Fresco', category: 'creative', icon: '🎨', detect: () => ({ ...placed(/^adobe fresco/i), optional: true }), actions: ['launch'] },
  {
    id: 'acrobat',
    name: 'Acrobat',
    category: 'creative',
    icon: '📄',
    detect: () => placed(/^(adobe )?acrobat/i, path.join(PF, 'Adobe', 'Acrobat DC', 'Acrobat', 'Acrobat.exe'), path.join(PF, 'Adobe', 'Acrobat', 'Acrobat', 'Acrobat.exe')),
    actions: ['launch', 'open'],
  },
  { id: 'dreamweaver', name: 'Dreamweaver', category: 'creative', icon: '🕸️', detect: () => ({ ...adobe(null, 'Adobe Dreamweaver ', 'Dreamweaver.exe'), optional: true }), actions: ['launch', 'open'] },
  { id: 'incopy', name: 'InCopy', category: 'creative', icon: '📝', detect: () => ({ ...adobe(null, 'Adobe InCopy ', 'InCopy.exe'), optional: true }), actions: ['launch', 'open'] },
  { id: 'audition', name: 'Audition', category: 'audio', icon: '🎧', detect: () => adobe(null, 'Adobe Audition ', 'Adobe Audition.exe'), actions: ['launch', 'open'] },
  {
    id: 'gimp',
    name: 'GIMP',
    category: 'creative',
    icon: '🦊',
    detect: () => {
      const lnk = startMenuFind(/^gimp/i);
      return { exe: first(path.join(LOCAL, 'Programs', 'GIMP 3', 'bin', 'gimp-3.exe'), path.join(PF, 'GIMP 3', 'bin', 'gimp-3.exe')), shortcut: lnk?.shortcut };
    },
    actions: ['launch', 'open'],
  },
  // More images and design (free and popular ones first)
  { id: 'krita', name: 'Krita', category: 'creative', icon: '🖍️', detect: () => placed(/^krita/i, path.join(PF, 'Krita (x64)', 'bin', 'krita.exe')), actions: ['launch', 'open'] },
  { id: 'inkscape', name: 'Inkscape', category: 'creative', icon: '✒️', detect: () => placed(/^inkscape/i, path.join(PF, 'Inkscape', 'bin', 'inkscape.exe')), actions: ['launch', 'open'] },
  { id: 'paintnet', name: 'Paint.NET', category: 'creative', icon: '🎨', detect: () => placed(/^paint\.net/i, path.join(PF, 'paint.net', 'paintdotnet.exe')), actions: ['launch', 'open'] },
  { id: 'darktable', name: 'darktable', category: 'creative', icon: '📸', detect: () => placed(/^darktable/i, path.join(PF, 'darktable', 'bin', 'darktable.exe')), actions: ['launch', 'open'] },
  { id: 'rawtherapee', name: 'RawTherapee', category: 'creative', icon: '🌄', detect: () => ({ ...(newestVersioned(path.join(PF, 'RawTherapee'), '', 'rawtherapee.exe') || placed(/^rawtherapee/i)), optional: true }), actions: ['launch', 'open'] },
  { id: 'luminar', name: 'Luminar Neo', category: 'creative', icon: '🌇', detect: () => placed(/^luminar neo/i, path.join(PF, 'Skylum', 'Luminar Neo', 'Luminar Neo.exe')), actions: ['launch', 'open'] },
  { id: 'gigapixel', name: 'Topaz Gigapixel', category: 'creative', icon: '🔍', detect: () => topaz(/gigapixel/i, ['Topaz Gigapixel AI.exe', 'Topaz Gigapixel.exe']), actions: ['launch', 'open'] },
  { id: 'canva', name: 'Canva', category: 'creative', icon: '🟣', detect: () => placed(/^canva$/i, path.join(LOCAL, 'Programs', 'Canva', 'Canva.exe')), actions: ['launch'] },
  { id: 'affinity', name: 'Affinity', category: 'creative', icon: '🔺', detect: () => ({ ...placed(/^affinity/i), optional: true }), actions: ['launch'] },
  { id: 'irfanview', name: 'IrfanView', category: 'creative', icon: '🐮', detect: () => placed(/^irfanview/i, path.join(PF, 'IrfanView', 'i_view64.exe')), actions: ['launch', 'open'] },
  { id: 'xnview', name: 'XnView MP', category: 'creative', icon: '🖼', detect: () => ({ ...placed(/^xnview/i, path.join(PF, 'XnViewMP', 'xnviewmp.exe')), optional: true }), actions: ['launch', 'open'] },
  { id: 'sharex', name: 'ShareX', category: 'creative', icon: '📸', detect: () => ({ ...placed(/^sharex/i, path.join(PF, 'ShareX', 'ShareX.exe')), optional: true }), actions: ['launch'] },
  {
    id: 'imagemagick',
    name: 'ImageMagick',
    category: 'creative',
    icon: '🪄',
    detect: () => ({ exe: chosen('imagemagick') || which('magick') || newestVersioned(PF, 'ImageMagick-', 'magick.exe')?.exe || null }),
    cli: true,
    actions: [],
  },
  // More animation, 2D and 3D (free and popular)
  { id: 'opentoonz', name: 'OpenToonz', category: '3d', icon: '🦝', detect: () => placed(/^opentoonz/i, path.join(PF, 'OpenToonz', 'OpenToonz.exe')), actions: ['launch', 'open'] },
  { id: 'pencil2d', name: 'Pencil2D', category: '3d', icon: '✏️', detect: () => placed(/^pencil2d/i, path.join(PF, 'Pencil2D', 'pencil2d.exe')), actions: ['launch', 'open'] },
  { id: 'synfig', name: 'Synfig Studio', category: '3d', icon: '🌀', detect: () => ({ ...placed(/^synfig/i, path.join(PF, 'Synfig', 'bin', 'synfigstudio.exe')), optional: true }), actions: ['launch', 'open'] },
  { id: 'aseprite', name: 'Aseprite', category: '3d', icon: '👾', detect: () => ({ ...placed(/^aseprite/i, path.join(PF86, 'Steam', 'steamapps', 'common', 'Aseprite', 'Aseprite.exe'), path.join(PF, 'Aseprite', 'Aseprite.exe')), optional: true }), actions: ['launch', 'open'] },
  { id: 'materialmaker', name: 'Material Maker', category: '3d', icon: '🧫', detect: () => ({ ...placed(/^material ?maker/i), optional: true }), actions: ['launch'] },
  { id: 'armorpaint', name: 'ArmorPaint', category: '3d', icon: '🛡️', detect: () => ({ ...placed(/^armorpaint/i), optional: true }), actions: ['launch'] },
  { id: 'magicavoxel', name: 'MagicaVoxel', category: '3d', icon: '🧊', detect: () => ({ ...placed(/^magicavoxel/i), optional: true }), actions: ['launch'] },
  { id: 'meshroom', name: 'Meshroom', category: '3d', icon: '📷', detect: () => ({ ...placed(/^meshroom/i), optional: true }), actions: ['launch'] },
  // Audio and music
  {
    id: 'audacity',
    name: 'Audacity',
    category: 'audio',
    icon: '🎙️',
    detect: () => placed(/^audacity/i, path.join(PF, 'Audacity 4', 'bin', 'Audacity4.exe'), path.join(PF, 'Audacity', 'Audacity.exe')),
    actions: ['launch', 'open'],
  },
  { id: 'reaper', name: 'REAPER', category: 'audio', icon: '🎚️', detect: () => placed(/^reaper/i, path.join(PF, 'REAPER (x64)', 'reaper.exe')), actions: ['launch', 'open'] },
  { id: 'musescore', name: 'MuseScore', category: 'audio', icon: '🎼', detect: () => placed(/^musescore/i, path.join(PF, 'MuseScore 4', 'bin', 'MuseScore4.exe')), actions: ['launch', 'open'] },
  { id: 'lmms', name: 'LMMS', category: 'audio', icon: '🎹', detect: () => ({ ...placed(/^lmms/i, path.join(PF, 'LMMS', 'lmms.exe')), optional: true }), actions: ['launch', 'open'] },
  // More video
  { id: 'vlc', name: 'VLC', category: 'video', icon: '🔶', detect: () => placed(/^vlc/i, path.join(PF, 'VideoLAN', 'VLC', 'vlc.exe')), actions: ['launch', 'open'] },
  { id: 'topazvideo', name: 'Topaz Video AI', category: 'video', icon: '🎞️', detect: () => topaz(/video/i, ['Topaz Video AI.exe', 'Topaz Video Enhance AI.exe']), actions: ['launch', 'open'] },
  { id: 'natron', name: 'Natron', category: 'video', icon: '🧪', detect: () => ({ ...placed(/^natron/i, path.join(PF, 'Natron', 'bin', 'Natron.exe')), optional: true }), actions: ['launch', 'open'] },
  // Video
  {
    id: 'premiere',
    name: 'Premiere Pro',
    category: 'video',
    icon: '🎬',
    detect: () => adobe('premiere', 'Adobe Premiere Pro ', 'Adobe Premiere Pro.exe'),
    actions: ['launch', 'open'],
  },
  {
    id: 'aftereffects',
    name: 'After Effects',
    category: 'video',
    icon: '✨',
    detect: () => adobe('aftereffects', 'Adobe After Effects ', path.join('Support Files', 'AfterFX.exe')),
    actions: ['launch', 'open', 'jsx'],
  },
  {
    id: 'mediaencoder',
    name: 'Media Encoder',
    category: 'video',
    icon: '📼',
    detect: () => adobe(null, 'Adobe Media Encoder ', 'Adobe Media Encoder.exe'),
    actions: ['launch', 'open'],
  },
  {
    id: 'resolve',
    name: 'DaVinci Resolve',
    category: 'video',
    icon: '🎚️',
    detect: () => ({ exe: chosen('resolve') || first(path.join(PF, 'Blackmagic Design', 'DaVinci Resolve', 'Resolve.exe')) }),
    actions: ['launch', 'open'],
  },
  {
    id: 'bmdfusion',
    name: 'Fusion (Blackmagic)',
    category: 'video',
    icon: '🧬',
    detect: () => ({ ...(newestVersioned(path.join(PF, 'Blackmagic Design'), 'Fusion ', 'Fusion.exe') || { exe: null }), optional: true }),
    actions: ['launch', 'open'],
  },
  { id: 'capcut', name: 'CapCut', category: 'video', icon: '✂️', detect: () => placed(/^capcut/i, path.join(LOCAL, 'CapCut', 'Apps', 'CapCut.exe')), actions: ['launch', 'open'] },
  { id: 'kdenlive', name: 'Kdenlive', category: 'video', icon: '🎥', detect: () => placed(/^kdenlive/i, path.join(PF, 'kdenlive', 'bin', 'kdenlive.exe')), actions: ['launch', 'open'] },
  { id: 'shotcut', name: 'Shotcut', category: 'video', icon: '🎦', detect: () => placed(/^shotcut/i, path.join(PF, 'Shotcut', 'shotcut.exe')), actions: ['launch', 'open'] },
  { id: 'openshot', name: 'OpenShot', category: 'video', icon: '📹', detect: () => placed(/^openshot/i, path.join(PF, 'OpenShot Video Editor', 'openshot-qt.exe')), actions: ['launch', 'open'] },
  { id: 'vegas', name: 'VEGAS Pro', category: 'video', icon: '🎞️', detect: () => placed(/^vegas pro/i), actions: ['launch', 'open'] },
  { id: 'filmora', name: 'Filmora', category: 'video', icon: '🟢', detect: () => placed(/filmora/i), actions: ['launch', 'open'] },
  {
    id: 'mediacomposer',
    name: 'Avid Media Composer',
    category: 'video',
    icon: '🅰️',
    detect: () => ({ ...placed(/^(avid )?media composer/i, path.join(PF, 'Avid', 'Media Composer', 'AvidMediaComposer.exe')), optional: true }),
    actions: ['launch', 'open'],
  },
  { id: 'clipchamp', name: 'Clipchamp', category: 'video', icon: '📎', detect: () => ({ ...placed(/^clipchamp/i), optional: true }), actions: ['launch'] },
  { id: 'handbrake', name: 'HandBrake', category: 'video', icon: '🍍', detect: () => placed(/^handbrake/i, path.join(PF, 'HandBrake', 'HandBrake.exe')), actions: ['launch', 'open'] },
  {
    id: 'handbrakecli',
    name: 'HandBrakeCLI',
    category: 'video',
    icon: '🍍',
    // a separate download, often just unzipped somewhere: Settings path, next to HandBrake, or on PATH
    detect: () => ({ exe: chosen('handbrakecli') || first(path.join(PF, 'HandBrake', 'HandBrakeCLI.exe'), path.join(PF, 'HandBrakeCLI', 'HandBrakeCLI.exe')) || which('HandBrakeCLI'), optional: true }),
    cli: true,
    actions: ['encode'],
  },
  { id: 'obs', name: 'OBS Studio', category: 'video', icon: '⏺️', detect: () => placed(/^obs studio/i, path.join(PF, 'obs-studio', 'bin', '64bit', 'obs64.exe')), actions: ['launch'] },
  { id: 'ffmpeg', name: 'FFmpeg', category: 'video', icon: '🎞️', detect: () => ({ exe: which('ffmpeg') }), cli: true, actions: [] },
  // CAD
  {
    id: 'freecad',
    name: 'FreeCAD',
    category: 'cad',
    icon: '⚙️',
    detect: () => newestVersioned(PF, 'FreeCAD ', path.join('bin', 'FreeCAD.exe')) || newestVersioned(path.join(LOCAL, 'Programs'), 'FreeCAD ', path.join('bin', 'FreeCAD.exe')) || placed(/^freecad/i),
    actions: ['launch', 'open'],
  },
  { id: 'fusion360', name: 'Autodesk Fusion', category: 'cad', icon: '🟧', detect: () => placed(/^(autodesk fusion|fusion 360)/i), actions: ['launch'] },
  { id: 'autocad', name: 'AutoCAD', category: 'cad', icon: '📐', detect: () => newestVersioned(path.join(PF, 'Autodesk'), 'AutoCAD ', 'acad.exe') || placed(/^autocad/i), actions: ['launch', 'open'] },
  { id: 'inventor', name: 'Inventor', category: 'cad', icon: '🔩', detect: () => ({ ...(newestVersioned(path.join(PF, 'Autodesk'), 'Inventor ', path.join('Bin', 'Inventor.exe')) || placed(/^autodesk inventor/i)), optional: true }), actions: ['launch', 'open'] },
  { id: 'revit', name: 'Revit', category: 'cad', icon: '🏢', detect: () => ({ ...(newestVersioned(path.join(PF, 'Autodesk'), 'Revit ', 'Revit.exe') || placed(/^revit/i)), optional: true }), actions: ['launch', 'open'] },
  { id: 'solidworks', name: 'SOLIDWORKS', category: 'cad', icon: '🧊', detect: () => placed(/^solidworks 20/i, path.join(PF, 'SOLIDWORKS Corp', 'SOLIDWORKS', 'SLDWORKS.exe')), actions: ['launch', 'open'] },
  { id: 'rhino', name: 'Rhino', category: 'cad', icon: '🦏', detect: () => newestVersioned(PF, 'Rhino ', path.join('System', 'Rhino.exe')) || placed(/^rhino \d/i), actions: ['launch', 'open'] },
  { id: 'sketchup', name: 'SketchUp', category: 'cad', icon: '🏠', detect: () => newestVersioned(path.join(PF, 'SketchUp'), 'SketchUp ', path.join('SketchUp', 'SketchUp.exe')) || placed(/^sketchup 20/i), actions: ['launch', 'open'] },
  { id: 'openscad', name: 'OpenSCAD', category: 'cad', icon: '🧮', detect: () => ({ exe: chosen('openscad') || first(path.join(PF, 'OpenSCAD', 'openscad.exe')) || which('openscad') }), actions: ['launch', 'open', 'render'] },
  { id: 'plasticity', name: 'Plasticity', category: 'cad', icon: '🫧', detect: () => placed(/^plasticity/i, path.join(LOCAL, 'Programs', 'plasticity', 'Plasticity.exe')), actions: ['launch', 'open'] },
  { id: 'shapr3d', name: 'Shapr3D', category: 'cad', icon: '✏️', detect: () => ({ ...placed(/^shapr3d/i), optional: true }), actions: ['launch'] },
  { id: 'kicad', name: 'KiCad', category: 'cad', icon: '🔌', detect: () => newestVersioned(path.join(PF, 'KiCad'), '', path.join('bin', 'kicad.exe')) || { ...placed(/^kicad/i), optional: true }, actions: ['launch', 'open'] },
  { id: 'librecad', name: 'LibreCAD', category: 'cad', icon: '📏', detect: () => ({ ...placed(/^librecad/i, path.join(PF, 'LibreCAD', 'LibreCAD.exe')), optional: true }), actions: ['launch', 'open'] },
  // 3D printing
  {
    id: 'prusaslicer',
    name: 'PrusaSlicer',
    category: 'print',
    icon: '🟠',
    detect: () => ({ exe: chosen('prusaslicer') || first(path.join(PF, 'Prusa3D', 'PrusaSlicer', 'prusa-slicer.exe')), shortcut: startMenuFind(/^prusaslicer/i)?.shortcut || null }),
    actions: ['launch', 'open', 'slice'],
  },
  {
    id: 'orcaslicer',
    name: 'OrcaSlicer',
    category: 'print',
    icon: '🐳',
    detect: () => ({ exe: chosen('orcaslicer') || first(path.join(PF, 'OrcaSlicer', 'orca-slicer.exe')), shortcut: startMenuFind(/^orcaslicer/i)?.shortcut || null }),
    actions: ['launch', 'open', 'slice'],
  },
  { id: 'bambustudio', name: 'Bambu Studio', category: 'print', icon: '🎋', detect: () => placed(/^bambu ?studio/i, path.join(PF, 'Bambu Studio', 'bambu-studio.exe')), actions: ['launch', 'open'] },
  { id: 'cura', name: 'UltiMaker Cura', category: 'print', icon: '🔵', detect: () => newestVersioned(PF, 'UltiMaker Cura ', 'UltiMaker-Cura.exe') || placed(/^(ultimaker )?cura/i), actions: ['launch', 'open'] },
  { id: 'crealityprint', name: 'Creality Print', category: 'print', icon: '🖨️', detect: () => placed(/^creality ?print/i), actions: ['launch', 'open'] },
  { id: 'lychee', name: 'Lychee Slicer', category: 'print', icon: '🍒', detect: () => ({ ...placed(/^lychee/i), optional: true }), actions: ['launch', 'open'] },
  { id: 'chitubox', name: 'CHITUBOX', category: 'print', icon: '💧', detect: () => ({ ...placed(/^chitubox/i), optional: true }), actions: ['launch', 'open'] },
  { id: 'simplify3d', name: 'Simplify3D', category: 'print', icon: '🔺', detect: () => ({ ...placed(/^simplify3d/i), optional: true }), actions: ['launch', 'open'] },
  { id: 'meshmixer', name: 'Meshmixer', category: 'print', icon: '🧶', detect: () => ({ ...placed(/meshmixer/i, path.join(PF, 'Autodesk', 'Meshmixer', 'meshmixer.exe')), optional: true }), actions: ['launch', 'open'] },
  // NVIDIA
  { id: 'nvidiasmi', name: 'NVIDIA GPU (nvidia-smi)', category: 'nvidia', icon: '🟩', detect: () => ({ exe: which('nvidia-smi'), optional: true }), cli: true, actions: [] },
  { id: 'nvidiaapp', name: 'NVIDIA App', category: 'nvidia', icon: '🟢', detect: () => ({ ...placed(/^nvidia app$/i, nvidia('NVIDIA app', 'CEF', 'NVIDIA app.exe')), optional: true }), actions: ['launch'] },
  {
    id: 'nvtt',
    name: 'NVIDIA Texture Tools',
    category: 'nvidia',
    icon: '🧱',
    detect: () => ({ exe: chosen('nvtt') || first(nvidia('NVIDIA Texture Tools', 'nvtt_export.exe'), nvidia('NVIDIA Texture Tools Exporter', 'nvtt_export.exe')) }),
    actions: ['launch', 'open', 'export'],
  },
  { id: 'broadcast', name: 'NVIDIA Broadcast', category: 'nvidia', icon: '🎙️', detect: () => ({ ...placed(/^nvidia broadcast/i, nvidia('NVIDIA Broadcast', 'NVIDIA Broadcast.exe')), optional: true }), actions: ['launch'] },
  { id: 'rtxremix', name: 'RTX Remix', category: 'nvidia', icon: '🕹️', detect: () => ({ exe: null, shortcut: first(nvidia('RTX Remix', 'lightspeed.app.trex.bat')) || startMenuFind(/rtx remix/i)?.shortcut || null, optional: true }), actions: ['launch'] },
  { id: 'canvas', name: 'NVIDIA Canvas', category: 'nvidia', icon: '🖍️', detect: () => ({ ...placed(/^nvidia canvas/i, nvidia('NVIDIA Canvas', 'Canvas.exe')), optional: true }), actions: ['launch'] },
  { id: 'nsight', name: 'Nsight Graphics', category: 'nvidia', icon: '🔬', detect: () => ({ ...placed(/^nsight graphics/i), optional: true }), actions: ['launch'] },
  // Browsers
  {
    id: 'chrome',
    name: 'Chrome',
    category: 'browser',
    icon: '🌐',
    detect: () => ({ exe: first(path.join(PF, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe')) }),
    actions: ['launch', 'url'],
  },
  {
    id: 'edge',
    name: 'Edge',
    category: 'browser',
    icon: '🌊',
    detect: () => ({ exe: first(path.join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(PF, 'Microsoft', 'Edge', 'Application', 'msedge.exe')) }),
    actions: ['launch', 'url'],
  },
  {
    id: 'opera',
    name: 'Opera',
    category: 'browser',
    icon: '⭕',
    detect: () => ({ exe: first(path.join(LOCAL, 'Programs', 'Opera', 'opera.exe'), path.join(LOCAL, 'Programs', 'Opera GX', 'opera.exe')) }),
    actions: ['launch', 'url'],
  },
  // Dev
  { id: 'vscode', name: 'VS Code', category: 'dev', icon: '🧑‍💻', detect: () => ({ exe: localProgram('Microsoft VS Code', 'Code.exe') || which('code') }), actions: ['launch', 'open'] },
  { id: 'zed', name: 'Zed', category: 'dev', icon: '⚡', detect: () => ({ exe: localProgram('Zed', 'Zed.exe') }), actions: ['launch', 'open'] },
  { id: 'gh', name: 'GitHub CLI', category: 'dev', icon: '🐙', detect: () => ({ exe: which('gh') }), cli: true, actions: ['terminal'] },
  { id: 'git', name: 'Git', category: 'dev', icon: '🌿', detect: () => ({ exe: which('git') }), cli: true, actions: [] },
  { id: 'python', name: 'Python', category: 'dev', icon: '🐍', detect: () => ({ exe: which('python') || which('python3') }), cli: true, actions: ['terminal'] },
  { id: 'uv', name: 'uv / uvx', category: 'dev', icon: '📦', detect: () => ({ exe: which('uvx') || which('uv') }), cli: true, actions: [] },
  { id: 'docker', name: 'Docker', category: 'dev', icon: '🐳', detect: () => ({ exe: which('docker') }), cli: true, actions: [] },
  // Other
  { id: 'notion', name: 'Notion', category: 'office', icon: '📓', detect: () => ({ exe: localProgram('Notion', 'Notion.exe') }), actions: ['launch'] },
];

function adobe(key: string | null, prefix: string, exeRel: string): Detected {
  const s = getSettings();
  if (key && s.paths[key] && exists(s.paths[key])) return { exe: s.paths[key] };
  return newestVersioned(path.join(PF, 'Adobe'), prefix, exeRel) || { exe: null };
}

async function runningExes(): Promise<Set<string>> {
  if (!IS_WIN) return new Set();
  const r = await run('tasklist', ['/fo', 'csv', '/nh'], { timeout: 8000 });
  const set = new Set<string>();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line);
    if (m) set.add(m[1].toLowerCase());
  }
  return set;
}

let cache: { at: number; list: Program[] } = { at: 0, list: [] };
// Finding the programs on this PC (process lists, service checks, folders) is slow, so it runs in the
// background: once when the server starts, then at most once an hour. Nothing that thinks or works (the
// Brain, agents' tools) waits for it; they read what the last scan found.
const SCAN_EVERY = 60 * 60_000;
let scanning: Promise<Program[]> | null = null;
const scanNow = (): Promise<Program[]> => (scanning ??= scanPrograms().finally(() => (scanning = null)));
const scanIfOld = () => {
  if (!scanning && Date.now() - cache.at >= SCAN_EVERY) scanNow().catch(() => {});
};

/** What the last scan found, right away (an hour-old list starts the next scan in the background). */
export function knownPrograms(): Program[] {
  scanIfOld();
  return cache.list;
}

/** For the page: the same list, but it waits for the very first scan; force (Rescan on the Programs page) scans now. */
export async function discoverPrograms(force = false): Promise<Program[]> {
  if (force) return scanNow();
  if (!cache.at) return scanNow();
  scanIfOld();
  return cache.list;
}

/** The first scan at start, then one an hour. */
export function startProgramScan() {
  scanNow().catch(() => {});
  setInterval(scanIfOld, SCAN_EVERY).unref?.();
}

async function scanPrograms(): Promise<Program[]> {
  const procs = await runningExes();
  const list = await Promise.all(
    CATALOG.map(async (p): Promise<Program> => {
      let d: Detected = {};
      try {
        d = p.detect() || {};
      } catch {
        d = {};
      }
      const serviceUrl = p.service ? await p.service().catch(() => null) : null;
      const exe = d.exe || d.cli || null;
      const installed = !!(exe || d.shortcut || serviceUrl);
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        icon: p.icon,
        installed,
        optional: !!d.optional,
        exe,
        shortcut: d.shortcut || null,
        version: d.version || null,
        versions: d.all || null,
        cli: !!p.cli,
        running: !!(serviceUrl || (exe && procs.has(path.basename(exe).toLowerCase()))),
        serviceUrl,
        actions: p.actions,
      };
    }),
  );
  cache = { at: Date.now(), list: list.filter((p) => p.installed || !p.optional) };
  return cache.list;
}

// Which known programs are open right now. Checked every few seconds; when that changes the
// page is told ('programs' event), so "running" shows up (and goes away) without a rescan.
let lastRunning: string | null = null;
const isRunning = (p: Program, procs: Set<string>): boolean => !!(p.serviceUrl || (p.exe && procs.has(path.basename(p.exe).toLowerCase())));
export async function refreshRunning() {
  if (!cache.list.length) return;
  const procs = await runningExes();
  // services (ComfyUI, LM Studio, Ollama...) are asked again, so starting or stopping one shows up
  await Promise.all(
    cache.list.map(async (p) => {
      const service = CATALOG.find((c) => c.id === p.id)?.service;
      if (service) p.serviceUrl = await service().catch(() => null);
    }),
  );
  for (const p of cache.list) p.running = isRunning(p, procs);
  const now = cache.list.filter((p) => p.running).map((p) => p.id).join(',');
  if (lastRunning !== null && now !== lastRunning) emit('programs', { running: now ? now.split(',') : [] });
  lastRunning = now;
}
export function startRunningWatch() {
  if (!IS_WIN) return;
  refreshRunning().catch(() => {});
  setInterval(() => refreshRunning().catch(() => {}), 5000).unref?.();
}
// Right after a start, look a few times so it shows up quickly.
function checkSoon() {
  for (const ms of [1500, 4000, 8000, 15000]) setTimeout(() => refreshRunning().catch(() => {}), ms);
}

/** Where a local service (ComfyUI, LM Studio…) answers right now: asks it, without a scan. */
export async function serviceUrl(id: string): Promise<string | null> {
  const service = CATALOG.find((c) => c.id === id)?.service;
  return service ? service().catch(() => null) : null;
}

/** What launchProgram starts for a name: a program file (given the file and arguments), or a shortcut opened as is. */
export type LaunchTarget = { exe: string; name: string; onPath: boolean; shortcut?: undefined } | { shortcut: string; name: string; startMenu: boolean; exe?: undefined };

// Which program a name means. The approval check and the launch both use this, so a name can't be
// judged as one program and then start another (a trailing space, a different case).
export function launchTarget(nameOrId: unknown, withExtra: boolean): LaunchTarget | null {
  const key = String(nameOrId || '').trim();
  if (!key) return null;
  const progs = knownPrograms();
  const lower = key.toLowerCase();
  const known = progs.find((p) => p.id === lower || p.name.toLowerCase() === lower) || progs.find((p) => p.name.toLowerCase().includes(lower));
  if (known?.exe && !known.cli) return { exe: known.exe, name: known.name, onPath: false };
  if (known?.shortcut && !withExtra) return { shortcut: known.shortcut, name: known.name, startMenu: false };
  const lnk = startMenuApps().find((a) => a.name.toLowerCase() === lower) || startMenuApps().find((a) => a.name.toLowerCase().includes(lower));
  if (lnk) return { shortcut: lnk.shortcut, name: lnk.name, startMenu: true };
  const exe = which(key);
  return exe ? { exe, name: path.basename(exe), onPath: true } : null;
}

// Launch a known program, a Start Menu entry, or anything on PATH. Optionally open a file/URL with it.
// nameOrId and args can come straight from a tool call or request body, so they are checked here.
export async function launchProgram(nameOrId: unknown, { file = null, args = [] }: { file?: string | null; args?: unknown } = {}): Promise<string> {
  const key = String(nameOrId || '').trim();
  if (!key) throw new Error('Which program? Give its name.');
  const extra: string[] = [...(file ? [file] : []), ...(Array.isArray(args) ? (args as string[]) : [])];
  const target = launchTarget(key, extra.length > 0);
  if (!target) throw new Error(`Couldn't find a program called "${key}". Use list_programs to see what's installed.`);
  if (target.exe !== undefined) {
    launchDetached(target.exe, extra);
    if (target.onPath) return `Started ${target.name}.`;
    checkSoon();
    return `Started ${target.name}${file ? ` with ${file}` : ''}.`;
  }
  openWithShell(target.shortcut);
  if (target.startMenu) return `Started ${target.name} (from the Start Menu).`;
  checkSoon();
  return `Started ${target.name}.`;
}

export function programExe(id: string): string | null {
  const p = CATALOG.find((c) => c.id === id);
  if (!p) return null;
  try {
    return p.detect()?.exe || null;
  } catch {
    return null;
  }
}

/** Is Orca on this PC: its app, or its command line tool (`orca`; `orca-ide` on Linux, where bare `orca` is
 *  usually the screen reader; or the command in ORCA_CLI_COMMAND). */
export function orcaInstalled(): boolean {
  const cmd = process.env.ORCA_CLI_COMMAND?.trim();
  if (cmd && which(cmd)) return true;
  if (which(process.platform === 'linux' ? 'orca-ide' : 'orca')) return true;
  if (IS_WIN) return !!programExe('orca');
  if (process.platform === 'darwin') return !!first('/Applications/Orca.app', path.join(HOME, 'Applications', 'Orca.app'));
  return false;
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
