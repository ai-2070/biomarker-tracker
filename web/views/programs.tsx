// Programs: what's installed and running on this PC, ComfyUI, and every Start Menu app.
import { useCallback, useEffect, useState } from 'react';
import { GET, POST, attempt, lightbox, toast, navigate } from '../core.ts';
import { Field } from '../ui/controls.tsx';
import { reactPage, useServerEvents } from '../ui/react.tsx';
import type { Terminal } from '../../shared/types.ts';
import { appIconUrl } from '../appicons.ts';

/** One known program as GET /api/programs lists it (server/programs.ts discoverPrograms). */
interface ProgramInfo {
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
/** One Start Menu app (GET /api/programs/all). */
interface StartMenuApp {
  name: string;
  shortcut: string;
  folder: string;
}
/** GET /api/comfyui */
interface ComfyInfo {
  status: {
    running: boolean;
    url?: string;
    queueRunning?: number;
    queuePending?: number;
    devices?: { name: string; vramFreeGB: number; vramTotalGB: number }[];
    version?: string | null;
  };
  workflows: { name: string; dir: string }[];
}
/** POST /api/comfyui/run */
interface ComfyRunResult {
  promptId: string;
  workflow: string;
  files: { kind: string; url: string; filename: string; subfolder?: string; type?: string }[];
  seconds: number;
  warnings?: string[];
}

const CATS: [string, string][] = [
  ['ai', 'AI tools'],
  ['3d', '3D and animation'],
  ['creative', 'Images and design'],
  ['video', 'Video'],
  ['audio', 'Audio and music'],
  ['cad', 'CAD'],
  ['print', '3D printing'],
  ['nvidia', 'NVIDIA'],
  ['browser', 'Browsers'],
  ['dev', 'Developer'],
  ['office', 'Other'],
];

const ABOUT: Partial<Record<string, string>> = {
  claude: 'Agents run on it. Open it in a terminal from Terminals.',
  hermes: 'Agents run on your Hermes profiles; hermes_ask lets any agent consult one.',
  pi: 'Agents can run on pi (Agents > Brain > pi).',
  omp: 'Agents can run on oh-my-pi (Agents > Brain > oh-my-pi).',
  openclaw: 'Agents can run on your OpenClaw agents (Agents > Brain > OpenClaw).',
  orca: 'Agents with the Orca tools can run Orca commands.',
  comfyui: 'Agents with ComfyUI tools run your saved workflows.',
  lmstudio: 'Start its local server to use local models (API model > LM Studio).',
  ollama: 'Local models through API model > Ollama.',
  netdesk: 'Your team social desk.',
  blender: 'Agents run Blender Python headless: build, render, export.',
  premiere: 'Agents open projects; edits go through ffmpeg or a Premiere MCP.',
  maya: 'Agents run Maya Python without its window: scenes, animation, renders, exports.',
  houdini: 'Agents run Houdini Python (hython): networks, simulations, renders.',
  painter: 'Agents open it with remote scripting on, for a Substance Painter MCP.',
  designer: 'Agents render .sbsar materials to texture maps with its sbsrender.',
  resolve: 'Add the DaVinci Resolve MCP to let agents edit timelines (Studio only).',
  openscad: 'Agents turn OpenSCAD models into STL, 3MF and other files.',
  prusaslicer: 'Agents slice models into G-code with it.',
  nvidiasmi: 'Agents check how busy the graphics cards are.',
  nvtt: 'Agents compress textures into DDS files.',
  handbrake: 'Agents convert and shrink videos with its presets (needs the free HandBrakeCLI).',
  handbrakecli: 'Agents convert and shrink videos with HandBrake presets.',
  imagemagick: 'Agents resize, convert and batch-edit images with it.',
  gimp: 'Add the GIMP MCP server to let agents edit in GIMP.',
  audacity: 'The Audacity MCP server needs Audacity 3 (Audacity 4 has no scripting yet).',
  gigapixel: 'For AI upscaling by agents, add the Topaz MCP server (uses Topaz cloud credits).',
  photoshop: 'Agents run ExtendScript in it.',
  aftereffects: 'Agents run ExtendScript in it.',
  ffmpeg: 'Agents cut, convert and inspect video and audio.',
  chrome: 'open_url can target it; add the Playwright MCP for full control.',
};
const CLI: Partial<Record<string, string>> = { claude: 'claude', hermes: 'hermes', pi: 'pi', omp: 'omp', openclaw: 'openclaw', orca: 'orca', gh: 'gh', python: 'python' };

/** "v1.2 · running", or "installed · starting…" while it opens. */
export const progState = (p: Pick<ProgramInfo, 'version' | 'cli' | 'running'>, starting = false): string =>
  [p.version ? `v${p.version}` : p.cli && !starting ? 'command line' : 'installed', starting ? ' · starting…' : p.running ? ' · running' : ''].join('');

async function openCli(p: ProgramInfo): Promise<void> {
  const t = await attempt(() => POST<Terminal>('/terminals', { kind: 'command', command: CLI[p.id], args: p.id === 'orca' ? ['status'] : p.id === 'openclaw' ? ['tui'] : [] }));
  if (t) navigate(`#/terminals/${t.id}`);
}

export function ProgramsTab() {
  const [progs, setProgs] = useState<ProgramInfo[] | null>(null);
  const [comfy, setComfy] = useState<ComfyInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // programs asked to start and not seen open yet
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const load = useCallback(
    (force = false) =>
      Promise.all([GET<ProgramInfo[]>(`/programs${force ? '?force=1' : ''}`), GET<ComfyInfo>('/comfyui').catch(() => null)])
        .then(([p, c]) => (setProgs(p), setComfy(c)))
        .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e))),
    [],
  );
  useEffect(() => void load(), [load]);
  // a program opened or closed (the server checks every few seconds)
  useServerEvents((ev) => {
    if (ev.type !== 'programs') return;
    void GET<ProgramInfo[]>('/programs').then((p) => {
      setProgs(p);
      setStarting((s) => new Set([...s].filter((id) => !p.find((x) => x.id === id)?.running)));
    }).catch(() => {});
  });

  if (failed) return <div className="panel"><p className="text-red">Something went wrong: {failed}</p></div>;
  if (!progs) return <p className="text-dim">Looking around this PC…</p>;

  const start = async (p: ProgramInfo) => {
    const r = await attempt(() => POST<{ message: string }>('/programs/launch', { program: p.id }), (x) => x.message);
    // already open: no "programs" event will come to clear "starting…"
    if (r && !p.running) setStarting((s) => new Set(s).add(p.id));
  };
  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5 justify-between">
        <p className="lede m-0">{`Found ${progs.filter((p) => p.installed).length} programs. Agents can use the ones with tools; you can start any of them from here.`}</p>
        <button className="btn ghost small" onClick={() => void load(true)}>Scan again</button>
      </div>
      {comfy ? <ComfyPanel comfy={comfy} rescan={() => void load(true)} /> : null}
      {CATS.map(([cat, label]) => {
        const list = progs.filter((p) => p.category === cat && p.installed);
        if (!list.length) return null;
        return (
          <div key={cat} className="mt-7">
            <h2 className="section">{label}</h2>
            <div className="cards">
              {list.map((p) => {
                const isStarting = starting.has(p.id);
                return (
                  <div key={p.id} className="card" data-prog={p.id}>
                    <div className="card-top">
                      <div className="avatar">{appIconUrl(p.id) ? <img className="inline-block align-middle" src={appIconUrl(p.id)!} width={22} height={22} alt="" /> : p.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="card-title">{p.name}</div>
                        <div className="hint prog-state">{progState(p, isStarting)}</div>
                      </div>
                    </div>
                    <span className="corner">
                      <span className={`dot${p.running ? ' on' : isStarting ? ' busy' : ''}`} />
                    </span>
                    {ABOUT[p.id] ? <div className="card-sub">{ABOUT[p.id]}</div> : null}
                    <div className="card-foot">
                      {p.actions.includes('launch') || (!p.cli && p.exe) ? <button className="btn small" onClick={() => void start(p)}>Start</button> : null}
                      {p.serviceUrl ? <a className="btn ghost small" href={p.serviceUrl} target="_blank" rel="noopener">Open</a> : null}
                      {p.actions.includes('terminal') ? <button className="btn ghost small" onClick={() => void openCli(p)}>Terminal</button> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="mt-7">
        <h2 className="section">Not found</h2>
        <p className="hint">
          {progs.filter((p) => !p.installed).map((p) => p.name).join(', ') || 'Everything in the catalog was found.'} Set custom paths in Settings.
        </p>
      </div>
      <div className="mt-7">
        <h2 className="section">All apps (Start Menu)</h2>
        <AllApps />
      </div>
    </>
  );
}

function AllApps() {
  const [apps, setApps] = useState<StartMenuApp[] | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => void GET<StartMenuApp[]>('/programs/all').then(setApps).catch(() => setApps([])), []);
  if (!apps) return null;
  const ql = query.toLowerCase();
  const shown = apps.filter((a) => !ql || a.name.toLowerCase().includes(ql) || a.folder.toLowerCase().includes(ql)).slice(0, 120);
  return (
    <>
      <div className="mb-3 max-w-[420px]">
        <input placeholder={`Search ${apps.length} apps`} aria-label="Search the Start Menu apps" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="cards prog-apps grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        {shown.map((a) => (
          <div key={a.shortcut || a.name} className="card flex-row items-center px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="prog-app-name text-[14px] font-semibold">{a.name}</div>
              {a.folder ? <div className="hint">{a.folder}</div> : null}
            </div>
            <button className="btn tiny ghost" onClick={() => void attempt(() => POST<{ message: string }>('/programs/launch', { program: a.name }), (r) => r.message)}>Start</button>
          </div>
        ))}
      </div>
    </>
  );
}

function ComfyPanel({ comfy, rescan }: { comfy: ComfyInfo; rescan: () => void }) {
  const st = comfy.status;
  const [workflow, setWorkflow] = useState(comfy.workflows[0]?.name || '');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const run = async () => {
    setRunning(true);
    const r = await attempt(() => POST<ComfyRunResult>('/comfyui/run', { workflow, prompt: prompt || undefined }));
    setRunning(false);
    if (r) {
      setImages(r.files.filter((f) => f.kind === 'images').map((f) => f.url));
      if (r.warnings?.length) toast(r.warnings.join(' '), 'warn', 8000);
    }
  };
  const device = st.devices?.[0];
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="flex items-center gap-2">
          <img className="app-icon" src={appIconUrl('comfyui')!} width={20} height={20} alt="" /> ComfyUI
        </h2>
        <span className={`pill${st.running ? ' ok' : ''}`}>{st.running ? `running · ${st.url}` : 'not running'}</span>
        {device ? <span className="pill">{`${device.name.replace(/^cuda:\d+\s*/, '').slice(0, 40)} · ${device.vramFreeGB}/${device.vramTotalGB} GB free`}</span> : null}
        <div className="actions">
          {!st.running ? (
            <button className="btn small" onClick={() => void attempt(() => POST('/comfyui/start'), 'Starting ComfyUI… give it a minute').then(() => setTimeout(rescan, 20000))}>Start ComfyUI</button>
          ) : (
            <a className="btn ghost small" href={st.url} target="_blank" rel="noopener">Open ComfyUI</a>
          )}
        </div>
      </div>
      {comfy.workflows.length ? (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
            <Field label="Workflow">
              <select value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
                {comfy.workflows.map((w) => (
                  <option key={w.name} value={w.name}>{w.name}</option>
                ))}
              </select>
            </Field>
            <div />
          </div>
          <textarea rows={2} aria-label="Prompt" placeholder="Prompt (replaces the positive prompt in the workflow)" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2.5">
            <button className="btn" disabled={running} onClick={() => void run()}>{running ? 'Running…' : 'Run'}</button>
            <span className="hint">{st.running ? 'Images appear below. Agents with the ComfyUI tools can do the same.' : 'Start ComfyUI first.'}</span>
          </div>
          <div className="tool-images">
            {images.map((url) => (
              <button key={url} type="button" className="img-button" aria-label="Show the image big" onClick={() => lightbox(url)}>
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="hint">No saved workflows found. Save one in ComfyUI (Workflow &gt; Save), or drop an API-format JSON into the dashboard data/comfy-workflows folder.</p>
      )}
    </div>
  );
}

export const title = () => 'Programs';
export const { render, unmount } = reactPage(() => <ProgramsTab />);
