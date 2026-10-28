// Station: the live 3D map of your agent operation.
// The Brain sits in the middle. Every branch is a workflow: its steps stand along the branch in order,
// agents at desks, tools and checkpoints on pedestals. Beams pulse when work moves; dashed lines show
// which programs and services each step can reach. Agents not on any branch wait on the Bench.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { h, mount, state, GET, POST, PUT, DEL, attempt, navigate, onState, ago, toast, promptBox, confirmBox, refreshSoon, modal } from '../core.ts';
import { openTerminal } from './agents.tsx';
import { openBranchBuilder } from '../builder.ts';
import { openDock, attachToBrain } from '../dock.tsx';
import { filesFromDrop, filesFromPaste, hasFiles } from '../attach.ts';
import { currentLook, stationLevel, uiZoom, DEFAULT_LOOK } from '../look.ts';
import { FIRST, benchSpot, teamSpots } from '../../shared/stationlayout.ts';
import type { TeamSpot } from '../../shared/stationlayout.ts';
import { openChat, refreshChatTabs, restoreChats, closeChatsForProject } from '../chatwin.tsx';
import { logoUrl, modelUrl, projectMark } from '../projectlogo.ts';
import { loadModel } from '../modelviewer.ts';
import { teamMarkUrl, DEFAULT_TEAM_MARK } from '../teammark.ts';
import { neighbours, stepIndex, floorDirection, shortName } from '../projectnav.ts';
import { slideIn, slideOut } from '../motion.ts';
import { icon, logo, brandPath } from '../icons.ts';
import { appIconImage } from '../appicons.ts';
import { engineKey } from '../agentstats.ts';
import { openProjectMenu } from '../projects.ts';
import { teamSteps } from '../../shared/teams.ts';
import { wfColor, appLogo, mark, intInfo, availableIntegrations, agentLinks, toolIntegration, stepLinks, connectorLook, setClaudeConnectors } from './stationdata.ts';
import type { AvailableIntegration, Headbar, MapPick, Program, TeamView } from './stationdata.ts';
import { mountStationPanel } from './stationpanel.tsx';
import type { StationPanelApi } from './stationpanel.tsx';
import { mountStationMenu } from './stationmenu.tsx';
import type { MenuEntry, StationMenu } from './stationmenu.tsx';
import type { WorldView } from '../voxel/view.ts';
import type { WorldLayer } from '../voxel/worldlayer.ts';
import type { AgentTarget, SkinHost } from '../voxel/skins.ts';
import type { ActivityEntry, Agent, AppState, Chat, Project, RunEvent, Schedule, ServerEvent, Team, TeamListing, TeamMessage, TeamState, TeamStep, UsageMeter, WorldAnchor, WorldQuality } from '../../shared/types.ts';

// ---------- types ----------
/** A workflow run (GET /api/workflow-runs, /api/workflow-active and the 'workflow-run' event). */
interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: 'running' | 'done' | 'failed' | 'stopped' | string;
  steps: { status: string; label: string; agentId?: string | null }[];
  error?: string | null;
}
/** Where things sit on the map that isn't a team (GET /api/layout). */
interface StationLayout {
  bench?: { x: number; z: number } | null;
}

/** What a tool call means, in words, for the monitor. */
interface ToolDesc {
  app: string;
  action: string;
  detail: string;
  brand: string | null;
  color: string;
}
/** The arguments of a tool call, as describeTool reads them. */
interface ToolArgs {
  blend_file?: string;
  code?: string;
  file?: string;
  workflow?: string;
  prompt?: string;
  args?: string[];
  url?: string;
  query?: string;
  q?: string;
  text?: string;
  thread?: string[];
  to?: string;
  subreddit?: string;
  title?: string;
  post?: string;
  command?: string;
  file_path?: string;
  path?: string;
  pattern?: string;
  agent?: string;
  message?: string;
  profile?: string;
  program?: string;
  [k: string]: unknown;
}
/** What the desk's monitor shows while the agent works. */
type DeskAct = { kind: 'thinking' | 'writing'; since: number } | ({ kind: 'tool'; since: number } & ToolDesc);
type DeskStatus = 'idle' | 'working' | 'needs';
type RunStatus = 'running' | 'needs-you' | 'done' | 'failed';

interface CanvasTex {
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
type Ring = THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
/** Any scene object, as the clean-up walks it. */
type Disposable = THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
type MappedMaterial = THREE.Material & { map?: THREE.Texture | null };

/** An agent's desk: monitor, person, status orb and the ring when its team runs it. */
interface Desk {
  group: THREE.Group;
  agent: Agent;
  color: string;
  stepNo: string | number;
  screen: CanvasTex;
  screenGlow: THREE.Sprite;
  person: THREE.Group;
  orb: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  orbGlow: THREE.Sprite;
  ring: Ring;
  /** lights up when you hover a tile or engine this agent uses */
  focusRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  status: DeskStatus;
  activity: string;
  act?: DeskAct | null;
  lastDraw?: number;
  // set for desks in a team pod
  wfId?: string;
  branchAngle?: number;
  stepIndex?: number;
  podPos?: THREE.Vector3;
}

interface NodeBase {
  obj: THREE.Object3D;
  wfId: string | null;
  index: number;
  links: Set<string>;
  agentId?: string;
  pos?: THREE.Vector3;
  runStatus?: RunStatus | null;
}
/** An agent's desk on the map (in a pod, or on the Bench with wfId null). */
interface AgentNode extends NodeBase {
  kind: 'agent';
  desk: Desk;
  agentId: string;
}
/** An agent's desk in a team pod. */
interface PodNode extends AgentNode {
  wfId: string;
  pos: THREE.Vector3;
}
/** A tool or checkpoint on a pedestal (old step-list teams). */
interface PedestalNode extends NodeBase {
  kind: 'step';
  wfId: string;
  ring: Ring;
}
/** What S.nodes holds: everything on a team. */
type StationNode = PodNode | PedestalNode;
/** Anything a wire can run to: team nodes and Bench desks. */
type MapNode = StationNode | AgentNode;

/** A material whose opacity follows the team's activity. */
interface Rail {
  material: THREE.Material;
  base: number;
}
/** A team pod on the map. */
interface Branch {
  wf: TeamView;
  index: number;
  color: THREE.Color;
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  nodes: PodNode[];
  links: Set<string>;
  card: HTMLDivElement;
  agentCount: number;
  rails: Rail[];
  link: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  hub: { holo: THREE.Object3D; holo2: THREE.Object3D; hubGlow: THREE.Sprite };
  spin: number;
  flash: number;
  home: THREE.Vector3;
  along?: (t: number) => THREE.Vector3;
  moved?: boolean;
}
interface IntNode {
  it: AvailableIntegration;
  glow: THREE.Sprite;
  flash: number;
}
interface Curve {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  base: number;
  flash: number;
}
/** A light running along a path. */
interface ParticleSpec {
  parent?: THREE.Object3D;
  path: (t: number) => THREE.Vector3;
  t: number;
  speed: number;
  color: THREE.Color;
  size: number;
  loop: boolean;
  opacity?: number;
}
interface Particle extends ParticleSpec {
  sprite: THREE.Sprite;
}
type LabelKind = 'brain' | 'agent' | 'branch' | 'bench' | 'step' | 'int';
/** An HTML label that follows a 3D object. */
interface LabelSpec {
  kind: LabelKind;
  id: string;
  wf?: string;
  obj: THREE.Object3D;
  /** Cards pinned by an edge: the side away from this object. */
  from?: THREE.Object3D;
  offset: THREE.Vector3;
  el: HTMLElement;
}
interface Label extends LabelSpec {
  world: THREE.Vector3;
  /** what was last written to its style (written again only when it changes) */
  shown?: { display: string; transform: string; origin: string };
}
type PickType = 'agent' | 'branch' | 'bench' | 'brain' | 'int';
/** A dashed wire from a header tile to a desk. */
interface Link2d {
  intId: string;
  /** a wire to one desk (detailed), or null for a team's / the Bench's combined wire */
  node: MapNode | null;
  /** combined wire: where it ends (the team's hub or the Bench) and the desks it stands for */
  anchor?: THREE.Object3D;
  lift?: number;
  members?: MapNode[];
  flash: number;
  /** how far the dashes have travelled down the wire (they flow from the tile toward the desk), and how fast they go now */
  flow?: number;
  speed?: number;
}
/** A hovered team or agent: the connections it uses and the map nodes its wires run to. */
interface Hover {
  links: Set<string>;
  nodes: Set<MapNode>;
  /** from a header tile or an engine: the agents that use it (their desks and chips light up) */
  agents?: Set<string>;
  /** only the wires to these links stay lit (a tile lights its own wires, not all of each agent's) */
  only?: boolean;
  /** the Brain uses this engine */
  brain?: boolean;
  /** the colour to light desks with */
  color?: string;
}
interface WireDot {
  link: Link2d;
  t: number;
}
interface FeedItem {
  text: string;
  kind: string;
  ts: number;
}
interface DropTarget {
  wfId?: string;
  bench?: boolean;
  at: THREE.Vector3;
  radius: number;
}
interface AgentDrag {
  desk: Desk;
  home: THREE.Vector3;
  marker: Ring;
  hint: HTMLDivElement;
  target: DropTarget | null;
  copy: boolean;
}
interface Cam {
  target: THREE.Vector3;
  az: number;
  el: number;
  zoom: number;
  view: number;
  goal: { target: THREE.Vector3; zoom: number } | null;
}
interface Brain {
  group: THREE.Group;
  cloud: THREE.Points;
  ico: THREE.LineSegments;
  halo: THREE.Sprite;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  star: THREE.Sprite;
  light: THREE.PointLight;
  /** the project's logo, floating inside the globe */
  logo: THREE.Sprite | null;
  /** what is shown in there now (the logo's address, or "model:" and the model's), so a change is noticed */
  logoKey: string;
  /** the project's 3D model: it takes the logo's place in the globe */
  model: THREE.Object3D | null;
  modelLight: THREE.PointLight | null;
}
/** Everything the mounted Station holds. Null between mounts. */
interface StationState {
  root: HTMLDivElement;
  host: HTMLDivElement;
  labels: HTMLDivElement;
  hud: HTMLDivElement;
  panel: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  world: THREE.Group | null;
  desks: Desk[];
  nodes: StationNode[];
  branches: Map<string, Branch>;
  intNodes: Map<string, IntNode>;
  curves: Curve[];
  particles: Particle[];
  /** 3D-model symbols in the pods' hubs: they turn */
  spinners: THREE.Object3D[];
  labelEls: Label[];
  progs: Program[];
  workflows: TeamView[];
  wfRuns: WorkflowRun[];
  active: Map<string, WorkflowRun>;
  signature: string;
  selected: MapPick | null;
  cam: Cam;
  feed: FeedItem[];
  clock: THREE.Clock;
  alive: boolean;
  wires: SVGGElement | null;
  dots: WireDot[];
  links2dAll?: Link2d[];
  links2d: Link2d[];
  // filled in by render(), buildBrain(), setupControls(), resize() and loadData()
  wireDots: SVGGElement;
  brain: Brain;
  w: number;
  h: number;
  layout: StationLayout;
  teamState: Record<string, TeamState>;
  teamLast: Record<string, TeamMessage | null | undefined>;
  onKey: (e: KeyboardEvent) => void;
  onDocDown: (e: PointerEvent) => void;
  onPaste: (e: ClipboardEvent) => void;
  ro?: ResizeObserver;
  offState?: () => void;
  headTimer?: ReturnType<typeof setInterval>;
  clockTimer?: ReturnType<typeof setInterval>;
  usageTimer?: ReturnType<typeof setInterval>;
  progTimer?: ReturnType<typeof setInterval>;
  usageIdx?: number;
  /** when the last frame was drawn, and when you last moved the pointer, scrolled or clicked on the map */
  lastFrame?: number;
  /** how long a frame is meant to take at the frame rate the Station holds to now (0: as fast as it can) */
  frameAim?: number;
  lastInput?: number;
  /** frames drawn so far (for the performance checks) */
  frames?: number;
  /** the soft glows, drawn together (see drawGlows) */
  glows?: GlowBatch;
  /** the parts every desk has (furniture, body, head, status light), each kind drawn together (see drawMeshBatches) */
  meshBatches?: Map<string, MeshBatch>;
  /** the dashed wires, drawn on the map's canvas (see WireBatch) */
  wireBatch?: WireBatch;
  /** the wires drawing up into the tiles or down again while the floor changes (see floorSlide) */
  wireReveal?: { from: number; to: number; at: number; ms: number; delay: number };
  headbar?: Headbar;
  /** What the pointer is over (a team or an agent): only its connections stay lit in the header. */
  hover?: Hover | null;
  /** the hover the chips and team cards were last marked for */
  hoverShown?: Hover | null;
  /** the side panel is sliding out */
  panelClosing?: Promise<void> | null;
  // the map
  benchCenter?: THREE.Vector3 | null;
  bench?: THREE.Group | null;
  benchNodes: AgentNode[];
  radius?: number;
  shape?: string | null;
  opened?: string;
  /** the right-click menu (React) */
  menuView?: StationMenu;
  agentDrag?: AgentDrag | null;
  // the HUD
  hudBuilt?: boolean;
  hudTop: HTMLDivElement;
  feedEl: HTMLDivElement;
  zoomEl: HTMLDivElement;
  emptyEl: HTMLDivElement;
  statsEl: HTMLDivElement;
  clockEl?: HTMLSpanElement;
  usageEl?: HTMLDivElement;
  tileEls: Map<string, HTMLButtonElement>;
  // the side panel (React)
  panelView?: { update: () => void; unmount: () => void };
  /** the classic map's lights and floor dots (hidden in the voxel look) */
  classic: THREE.Object3D[];
  /** the voxel look (web/voxel), while it is on */
  view?: WorldView | null;
  /** the project's voxel world on the map, while the voxel look is on */
  worldLayer?: WorldLayer | null;
  /** the quality the voxel look was set up with, or null for the classic map */
  lookShown?: WorldQuality | null;
  /** the voxel look kept on whatever the setting says (the test island is out) */
  lookForced?: WorldQuality | null;
  /** the best quality this computer kept up with on this visit (it steps down when frames stay slow) */
  lookCap?: WorldQuality | null;
  /** labels a skin took off the map ("agent:<id>", "branch:<id>", "brain:brain") */
  labelHidden?: Set<string>;
  /** goes up each time the map's models are built again (skins dress the new ones) */
  builds?: number;
  /** Files dragged over the map: 'map', or 'brain' when they are over the Brain (it glows). */
  fileDrag?: 'map' | 'brain' | null;
  dropHint?: HTMLDivElement | null;
}

// Live events the Station reads (ServerEvent with its fields).
type TeamEvent =
  | { kind: 'state'; working: string[]; queued: string[] }
  | { kind: 'message'; message: TeamMessage }
  | { kind: 'routed'; to: string[]; why: string }
  | { kind: 'turn'; agentId: string; state: 'start' | 'end' };
interface TeamServerEvent extends ServerEvent {
  type: 'team';
  teamId: string;
  event: TeamEvent;
}
interface WorkflowRunServerEvent extends ServerEvent {
  type: 'workflow-run';
  id: string;
  run?: WorkflowRun;
}
interface AgentRunServerEvent extends ServerEvent {
  type: 'run';
  runId: string;
  agentId: string;
  chatId: string;
  event: RunEvent;
}
interface ActivityServerEvent extends ServerEvent {
  type: 'activity';
  entry?: ActivityEntry;
}
type StationEvent = TeamServerEvent | WorkflowRunServerEvent | AgentRunServerEvent | ActivityServerEvent;
const isEvent = <T extends StationEvent['type']>(ev: ServerEvent, type: T): ev is Extract<StationEvent, { type: T }> => ev.type === type;

/** Globals the Station shares with the chat windows and the UI checks. */
type StationWindow = Window & {
  __stationDebug?: () => unknown;
  __stationStats?: () => unknown;
  __chatsRestored?: boolean;
  __teams?: TeamView[];
  __teamWorking?: Record<string, string[]>;
  /** Phase 0 of the voxel world: a test island and how fast it draws (see voxelBench) */
  __voxelBench?: (opts?: VoxelBenchOptions | null) => Promise<unknown>;
  /** Phase 0: switch the voxel look's time of day ('station', 'golden', 'dusk'…) */
  __voxelEnv?: (preset: string) => void;
};

/** S is set from render() until unmount(), and the map's helpers only run in between. Type-only: no check at runtime. */
function assertMounted(s: StationState | null): asserts s is StationState {}

export const flush = true;
export const station = true;
export const title = () => 'Station';

let S: StationState | null = null;

const STEP_LOOK: Record<string, { glyph: string; label: string; color: string }> = {
  tool: { glyph: '⚙', label: 'Tool', color: '#a9d3e2' },
  approval: { glyph: '✋', label: 'Your OK', color: '#f0b04a' },
  x_post: { glyph: '𝕏', label: 'Post to X', color: '#e6e8e0' },
  notify: { glyph: '✉', label: 'Notify you', color: '#5fe3a0' },
};

// ---------- textures ----------
function canvasTex(w: number, hgt: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTex {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, hgt);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, canvas: c, ctx };
}

let glowTex: THREE.CanvasTexture | null = null;
function glow(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  glowTex = canvasTex(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }).tex;
  return glowTex;
}

const glyphCache = new Map<string, THREE.Texture>();
function glyphTex(glyph: string, color: string): THREE.Texture {
  const key = glyph + color;
  if (glyphCache.has(key)) return glyphCache.get(key)!;
  const t = canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = '#0d100d';
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = color;
    const emoji = /\p{Extended_Pictographic}/u.test(glyph);
    ctx.font = `bold ${glyph.length > 1 && !emoji ? 46 : 58}px "Segoe UI", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 64, 68);
  }).tex;
  glyphCache.set(key, t);
  return t;
}

// What a tool call means, in words, for the monitor: { app, action, detail, brand, color }.
function describeTool(name: unknown, args: ToolArgs = {}): ToolDesc {
  const n = String(name || '');
  const host = (u: string | undefined) => {
    try {
      return new URL(u as string).hostname.replace(/^www\./, '');
    } catch {
      return String(u || '').slice(0, 40);
    }
  };
  const base = (p: unknown) => String(p || '').split(/[\\/]/).pop();
  const A = (app: string, action: string, detail: unknown = '', brand: string | null = null, color = '#c4ff3d'): ToolDesc => ({ app, action, detail: String(detail || '').replace(/\s+/g, ' ').slice(0, 60), brand, color });
  if (n === 'world_build') return A('World', 'building', args.object, null, '#f3b6cf');
  if (n === 'world_object') return A('World', args.delete === true ? 'removing' : 'arranging', args.object, null, '#f3b6cf');
  if (n === 'world_undo') return A('World', 'undoing a change', '', null, '#f3b6cf');
  if (n === 'world_info') return A('World', 'looking around', args.map || '', null, '#f3b6cf');
  if (n.startsWith('world_md_')) return A('World', n === 'world_md_read' ? 'reading WORLD.md' : 'writing WORLD.md', args.section || '', null, '#f3b6cf');
  if (n === 'blender_run_python') return A('Blender', 'running a script', base(args.blend_file) || (args.code || '').split('\n').find((l) => l.trim() && !l.startsWith('import')) || '', 'blender', '#f5792a');
  if (n === 'blender_open') return A('Blender', 'opening', base(args.file), 'blender', '#f5792a');
  if (n.startsWith('comfyui_')) return A('ComfyUI', n === 'comfyui_run' ? `rendering ${args.workflow || ''}` : n.replace('comfyui_', '').replace(/_/g, ' '), args.prompt || '', null, '#f2ff59');
  if (n === 'imagemagick') return A('ImageMagick', 'editing images', base((args.args || []).at(-1)), null, '#5fe3a0');
  if (n === 'handbrake_encode') return A('HandBrake', 'encoding', base(args.input), null, '#5fe3a0');
  if (n === 'ffmpeg') return A('FFmpeg', 'processing video', base((args.args || []).at(-1)), 'ffmpeg', '#5fe3a0');
  if (n === 'ffprobe') return A('FFmpeg', 'inspecting', base(args.file), 'ffmpeg', '#5fe3a0');
  if (n === 'photoshop_run_script') return A('Photoshop', 'running a script', '', 'photoshop', '#31a8ff');
  if (n === 'aftereffects_run_script') return A('After Effects', 'running a script', '', 'aftereffects', '#d291ff');
  if (n === 'maya_run_python') return A('Maya', 'running a script', base(args.scene) || (args.code || '').split('\n').find((l) => l.trim() && !l.startsWith('import')) || '', 'maya', '#37a5cc');
  if (n === 'maya_open') return A('Maya', 'opening', base(args.file), 'maya', '#37a5cc');
  if (n === 'houdini_run_python') return A('Houdini', 'running a script', base(args.hip) || (args.code || '').split('\n').find((l) => l.trim() && !l.startsWith('import')) || '', 'houdini', '#ff4713');
  if (n === 'houdini_open') return A('Houdini', 'opening', base(args.file), 'houdini', '#ff4713');
  if (n === 'substance_render') return A('Substance 3D', 'rendering textures', base(args.input), null, '#ff6b4a');
  if (n === 'substance_open') return A('Substance 3D', `opening ${args.app || ''}`, base(args.file), null, '#ff6b4a');
  if (n === 'openscad_render') return A('OpenSCAD', 'building a model', base(args.output), 'openscad', '#f9d72f');
  if (n === 'slice_model') return A('PrusaSlicer', 'slicing', base(args.input), null, '#fa6831');
  if (n === 'nvidia_gpu_status') return A('NVIDIA', 'checking the GPU', '', 'nvidia', '#76b900');
  if (n === 'nvidia_texture_export') return A('NVIDIA', 'compressing a texture', base(args.output), 'nvidia', '#76b900');
  if (n === 'asset_search') return A(args.source === 'ambientcg' ? 'ambientCG' : 'Poly Haven', 'searching', args.query || args.kind || '', null, '#9fd8ff');
  if (n === 'asset_download') return A(args.source === 'ambientcg' ? 'ambientCG' : 'Poly Haven', 'downloading', args.id || '', null, '#9fd8ff');
  if (n === 'premiere_open') return A('Premiere Pro', 'opening', base(args.file), 'premiere', '#9a9aff');
  if (n === 'fetch_url' || n === 'WebFetch') return A('Browser', 'reading', host(args.url), 'chrome', '#a9d3e2');
  if (n === 'open_url') return A('Browser', 'opening', host(args.url), 'chrome', '#a9d3e2');
  if (n === 'WebSearch') return A('Web search', 'searching', args.query || '', 'chrome', '#a9d3e2');
  if (n === 'x_draft_post') return A('X', 'drafting a post', args.text || (args.thread || [])[0] || '', 'x', '#e6e8e0');
  if (n === 'x_draft_dm') return A('X', `drafting a DM to @${String(args.to || '').replace(/^@/, '')}`, args.text || '', 'x', '#e6e8e0');
  if (n === 'x_recent_posts' || n === 'x_mentions') return A('X', 'reading', n === 'x_mentions' ? 'mentions' : 'recent posts', 'x', '#e6e8e0');
  if (n === 'telegram_send') return A('Telegram', 'sending a message', args.text || '', 'telegram', '#4fb3f6');
  if (n === 'reddit_draft_post') return A('Reddit', `drafting a post for r/${String(args.subreddit || '').replace(/^\/?r\//, '')}`, args.title || '', 'reddit', '#ff4500');
  if (n === 'reddit_draft_comment') return A('Reddit', 'drafting a comment', args.text || '', 'reddit', '#ff4500');
  if (n === 'reddit_read' || n === 'reddit_search' || n === 'reddit_comments') return A('Reddit', n === 'reddit_search' ? 'searching' : 'reading', args.subreddit ? `r/${args.subreddit}` : args.query || args.post || '', 'reddit', '#ff4500');
  if (n === 'discord_send') return A('Discord', 'posting', args.text || '', 'discord', '#7d86ff');
  if (n === 'Bash' || n === 'run_command') return A('Terminal', 'running', args.command || '', null, '#c4ff3d');
  if (['Read', 'read_file', 'knowledge_read'].includes(n)) return A('Files', 'reading', base(args.file_path || args.path || args.file), null, '#a9d3e2');
  if (['Write', 'Edit', 'write_file', 'NotebookEdit'].includes(n)) return A('Files', 'writing', base(args.file_path || args.path), null, '#a9d3e2');
  if (['Glob', 'Grep', 'list_files', 'knowledge_search'].includes(n)) return A('Files', 'searching', args.pattern || args.query || args.path || '', null, '#a9d3e2');
  if (n === 'ask_agent') return A('Team', `asking ${args.agent || 'a teammate'}`, args.message || '', null, '#c4ff3d');
  if (n === 'await_agent') return A('Team', args.handle ? 'waiting for a teammate' : 'checking handoffs', '', null, '#c4ff3d');
  if (n === 'hermes_ask') return A('Hermes', `asking ${args.profile || 'Hermes'}`, args.message || '', null, '#d8c25a');
  if (n === 'launch_program') return A(String(args.program || 'Program'), 'starting', base(args.file), String(args.program || '').toLowerCase(), '#c4ff3d');
  if (n === 'orca') return A('Orca', (args.args || []).join(' '), '', null, '#7ab8ff');
  const m = /^mcp__(.+?)__(.+)$/.exec(n) || /^(.+?)__(.+)$/.exec(n);
  if (m) {
    const server = m[1].replace(/^claude_ai_/, '').replace(/_/g, ' ');
    return A(server.replace(/\b\w/g, (c) => c.toUpperCase()), m[2].replace(/[_-]/g, ' ').slice(0, 40), args.url ? host(args.url) : args.query || args.q || '', server.toLowerCase(), '#a9d3e2');
  }
  return A(n.replace(/_/g, ' '), 'working', '', null, '#c4ff3d');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: unknown, max: number): string {
  let t = String(text || '');
  if (ctx.measureText(t).width <= max) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

// The little monitor on each desk.
function drawScreen(desk: Desk, tick = 0): void {
  const { ctx, canvas } = desk.screen;
  const W = canvas.width;
  const H = canvas.height;
  const st = desk.status;
  const a = desk.agent;
  const act = desk.act;
  ctx.textBaseline = 'middle';
  if (st === 'idle') {
    ctx.fillStyle = '#e4e8dd';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#cdd2c6';
    ctx.fillRect(0, 0, W, 40);
    ['#ff6b6b', '#f0b04a', '#5fe3a0'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(24 + i * 24, 20, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#3a3f37';
    ctx.font = 'bold 20px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(desk.stepNo && desk.stepNo !== '-' ? String(desk.stepNo) : 'BENCH', W - 20, 21);
    ctx.textAlign = 'left';
    ctx.font = '84px "Segoe UI Emoji", sans-serif';
    ctx.fillText(a.emoji || '🤖', 28, 140);
    ctx.fillStyle = '#16190f';
    ctx.font = 'bold 40px "Segoe UI", sans-serif';
    ctx.fillText(fitText(ctx, a.name, W - 160), 140, 118);
    ctx.fillStyle = '#5f6559';
    ctx.font = '26px Consolas, monospace';
    ctx.fillText(fitText(ctx, `○ ready · ${shortModel(a)}`, W - 160), 140, 162);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i === 0 ? desk.color : '#c3c8bc';
      roundRect(ctx, 28, 214 + i * 24, 80 + ((i * 97) % 300), 10, 5);
      ctx.fill();
    }
  } else if (st === 'needs') {
    ctx.fillStyle = '#21180a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = Math.sin(tick * 6) > 0 ? '#f0b04a' : '#7a5a24';
    ctx.font = 'bold 120px "Segoe UI Symbol", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 90, H / 2 + 6);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f0b04a';
    ctx.font = 'bold 40px "Segoe UI", sans-serif';
    ctx.fillText('Waiting for you', 170, 120);
    ctx.fillStyle = '#e6e8e0';
    ctx.font = '24px "Segoe UI", sans-serif';
    const ap = (state.data?.approvals || []).find((x) => x.agentId === a.id);
    // (no approval: it asked you a question, in the Outbox)
    const asks = ap ? null : (state.data?.questions || []).find((x) => x.agentId === a.id);
    ctx.fillText(fitText(ctx, asks ? asks.question : (ap?.title || 'needs your OK').replace(`${a.name} wants to `, ''), W - 190), 170, 168);
    ctx.fillStyle = '#9a8a6a';
    ctx.font = '22px Consolas, monospace';
    ctx.fillText(asks ? 'answer it in the Outbox' : 'open Needs you to answer', 170, 214);
  } else {
    // working
    ctx.fillStyle = '#0b130a';
    ctx.fillRect(0, 0, W, H);
    const isTool = act?.kind === 'tool';
    const color = isTool ? act.color : '#c4ff3d';
    // logo disc
    const cx = 86;
    const cy = 150;
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 90);
    g.addColorStop(0, color + '55');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 50, 200, 200);
    ctx.fillStyle = '#121a11';
    ctx.beginPath();
    ctx.arc(cx, cy, 54, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 54, -Math.PI / 2 + tick * 3, -Math.PI / 2 + tick * 3 + Math.PI * 1.4);
    ctx.stroke();
    const bp = isTool && act.brand ? brandPath(act.brand) : null;
    // a program's own icon (ComfyUI); the monitor is drawn again once it has loaded
    const pic = isTool && !bp ? appIconImage(act.app, () => drawScreen(desk, S?.clock.elapsedTime ?? tick)) : null;
    if (bp) {
      ctx.save();
      ctx.translate(cx - 30, cy - 30);
      ctx.scale(2.5, 2.5);
      ctx.fillStyle = bp.hex;
      ctx.fill(new Path2D(bp.d));
      ctx.restore();
    } else if (pic) {
      ctx.drawImage(pic, cx - 30, cy - 30, 60, 60);
    } else {
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.font = isTool ? 'bold 44px "Segoe UI", sans-serif' : '56px "Segoe UI Emoji", sans-serif';
      ctx.fillText(isTool ? act.app.slice(0, 2).toUpperCase() : a.emoji || '🤖', cx, cy + 3);
      ctx.textAlign = 'left';
    }
    // words
    ctx.fillStyle = '#e6e8e0';
    ctx.font = 'bold 40px "Segoe UI", sans-serif';
    ctx.fillText(fitText(ctx, isTool ? act.app : act?.kind === 'writing' ? 'Writing reply' : 'Thinking', W - 190), 170, 104);
    ctx.fillStyle = color;
    ctx.font = '28px "Segoe UI", sans-serif';
    const dots = '.'.repeat(1 + (Math.floor(tick * 2) % 3));
    ctx.fillText(fitText(ctx, isTool ? act.action : `${dots}`, W - 190), 170, 150);
    if (isTool && act.detail) {
      ctx.fillStyle = '#8f968a';
      ctx.font = '22px Consolas, monospace';
      ctx.fillText(fitText(ctx, act.detail, W - 190), 170, 192);
    }
    // bottom: moving progress + time
    ctx.fillStyle = '#1c2a18';
    roundRect(ctx, 28, 262, W - 160, 10, 5);
    ctx.fill();
    const pw = 120;
    const px = 28 + ((tick * 160) % (W - 160 + pw)) - pw;
    ctx.save();
    roundRect(ctx, 28, 262, W - 160, 10, 5);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(px, 262, pw, 10);
    ctx.restore();
    const secs = act?.since ? Math.max(0, Math.round((Date.now() - act.since) / 1000)) : 0;
    ctx.fillStyle = '#8f968a';
    ctx.font = 'bold 22px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(secs >= 60 ? `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}` : `${secs}s`, W - 22, 268);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5a6455';
    ctx.font = 'bold 18px Consolas, monospace';
    ctx.fillText(fitText(ctx, `${a.name.toUpperCase()} · ${shortModel(a)}`, W - 60), 28, 26);
  }
  desk.screen.tex.needsUpdate = true;
}

// ---------- mount ----------
export async function render(el: HTMLElement): Promise<void> {
  const root = h('div.st-root', { class: 'group/root relative h-screen overflow-hidden bg-[#070807] select-none' });
  const host = h('div', { class: 'absolute inset-0 block [&_canvas]:absolute [&_canvas]:inset-0 [&_canvas]:block' });
  // the labels are moved every frame by script (transform): their classes only change with their state
  const labels = h('div', { class: 'group/labels absolute inset-0 pointer-events-none overflow-hidden *:absolute *:left-0 *:top-0 *:pointer-events-auto *:will-change-transform' });
  const hud = h('div', { class: 'absolute inset-0 pointer-events-none' });
  const panel = h('aside.st-panel.hidden', {
    class: 'absolute top-16 right-3.5 bottom-3.5 w-95 max-w-[calc(100%-28px)] z-5 flex flex-col bg-glass backdrop-blur-[16px] backdrop-saturate-140 border border-line-2 rounded-box shadow-pop select-text max-md:top-auto max-md:left-0 max-md:right-0 max-md:bottom-0 max-md:h-[60vh] max-md:w-auto max-md:max-w-none',
  });
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wires.setAttribute('class', 'st-wires absolute inset-0 w-full h-full pointer-events-none overflow-visible');
  const wireDots = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  wires.append(wireDots);
  root.append(host, wires, labels, hud, panel);
  mount(el, root);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatioFor(stationLevel(currentLook().station).pixelRatio));
  renderer.setClearColor(0x070807, 1);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  // renderStation updates the scene's positions once a frame, before the glows read them
  scene.matrixWorldAutoUpdate = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -600, 1200);
  const ambient = new THREE.AmbientLight(0xbfc8ff, 0.55);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(30, 60, 20);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x7fb6ff, 0.35);
  rim.position.set(-40, 20, -30);
  scene.add(rim);
  const classic: THREE.Object3D[] = [ambient, sun, rim];
  {
    const pts: number[] = [];
    for (let x = -150; x <= 150; x += 3) for (let z = -150; z <= 150; z += 3) pts.push(x, -0.01, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const dots = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x262b24, size: 2, sizeAttenuation: false }));
    scene.add(dots);
    classic.push(dots);
  }

  S = {
    root,
    host,
    labels,
    hud,
    panel,
    renderer,
    scene,
    camera,
    world: null,
    desks: [],
    nodes: [],
    branches: new Map(),
    intNodes: new Map(),
    curves: [],
    particles: [],
    spinners: [],
    labelEls: [],
    progs: [],
    workflows: [],
    wfRuns: [],
    active: new Map(),
    signature: '',
    selected: null,
    cam: { target: new THREE.Vector3(), az: Math.PI / 4, el: Math.atan(1 / Math.SQRT2), zoom: 1, view: 70, goal: null },
    feed: [],
    clock: new THREE.Clock(),
    alive: true,
    wires: null,
    dots: [],
    links2d: [],
    classic,
  } as Partial<StationState> as StationState; // the rest is filled in below
  S.wireDots = wireDots;
  S.panelView = mountStationPanel(panel, panelApi);
  const menuHost = h('div.dom-contents');
  root.append(menuHost);
  S.menuView = mountStationMenu(menuHost);
  buildBrain();
  setupControls();
  // moving around the map gets the full frame rate; a still map fewer (see the loop)
  const moved = () => S && (S.lastInput = performance.now());
  for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'dragover']) root.addEventListener(ev, moved, { passive: true });
  S.ro = new ResizeObserver(resize);
  S.ro.observe(root);
  resize();

  await loadData();
  if (!S) return;
  rebuild();
  drawHud();
  resetView(true);
  void applyStationLook();
  S.offState = onState(() => {
    if (!S) return;
    void applyStationLook();
    if (floorBusy) updateStatuses();
    else if (signature() !== S.signature) rebuild();
    else updateStatuses();
    drawHud();
    if (S.selected && S.selected.type !== 'agent' && S.selected.type !== 'branch') renderPanel();
  });
  const feed = await GET<ActivityEntry[]>('/activity').catch((): ActivityEntry[] => []);
  if (S) {
    S.feed = feed.slice(0, 4).map((a) => ({ text: a.text, kind: a.kind, ts: a.ts }));
    drawFeed();
  }
  loadHeadbar();
  S.headTimer = setInterval(loadHeadbar, 60_000);
  S.clockTimer = setInterval(tickClock, 1000);
  // usage of each connected provider, one after another
  S.usageTimer = setInterval(() => {
    if ((S?.headbar?.usages?.length || 0) > 1) {
      S!.usageIdx = (S!.usageIdx || 0) + 1;
      drawUsage(true);
    }
  }, 6000);
  S.progTimer = setInterval(async () => {
    const p = await GET<Program[]>('/programs').catch(() => null);
    if (S && p) {
      S.progs = p;
      if (!floorBusy && signature() !== S.signature) rebuild();
      drawHud();
    }
  }, 30000);
  loop();
  // read-only: where teams and desks are on screen (used by the automated UI checks)
  (window as StationWindow).__voxelBench = voxelBench;
  (window as StationWindow).__voxelEnv = (preset) => void import('../../shared/worldenv.ts').then(({ envPreset }) => S?.view?.setEnvironment(envPreset(preset)));
  // #/station?voxelbench=90 shows the test island straight away
  const bench = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('voxelbench'));
  if (bench > 0) void voxelBench({ radius: bench });
  (window as StationWindow).__stationDebug = () => {
    if (!S) return null;
    const at = (o: THREE.Object3D) => {
      const p = o.getWorldPosition(new THREE.Vector3()).project(S!.camera);
      const r = S!.renderer.domElement.getBoundingClientRect();
      return { x: Math.round(r.left + ((p.x + 1) / 2) * r.width), y: Math.round(r.top + ((1 - p.y) / 2) * r.height) };
    };
    return [...S.branches.values()].map((b) => ({ name: b.wf.name, ...at(b.group), desks: b.nodes.map((n) => ({ name: n.desk.agent.name, ...at(n.desk.group) })) }));
  };
  // read-only: what the last frame drew (draw calls, triangles, textures) and what moves every frame (performance checks)
  (window as StationWindow).__stationStats = () => {
    if (!S) return null;
    const { render: r, memory: m } = S.renderer.info;
    // what is drawn, by kind of object and where it sits (the parent's name or kind)
    const drawn: Record<string, number> = {};
    S.scene.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Sprite || o instanceof THREE.Line || o instanceof THREE.Points)) return;
      const key = `${o.type}:${(o.material as THREE.Material).type}`;
      drawn[key] = (drawn[key] || 0) + 1;
    });
    return { drawn, frames: S.frames || 0, calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines, geometries: m.geometries, textures: m.textures, pixelRatio: S.renderer.getPixelRatio(), size: [S.w, S.h], desks: S.desks.length, labels: S.labelEls.length, wires: S.wireBatch?.n ?? 0, particles: S.particles.length, objects: S.scene.children.length };
  };
}

// A team's members, as the desk list the map draws.
function teamView(w: TeamListing): TeamView {
  const members = Array.isArray(w.members) ? w.members : [...new Set((w.steps || []).filter((x) => x.type === 'agent' && x.agentId).map((x) => x.agentId!))];
  return { ...w, members, steps: members.map((id) => ({ type: 'agent', agentId: id })), stepList: w.steps || [] };
}

async function loadData(): Promise<void> {
  const [progs, wfs, runs, active, layout] = await Promise.all([GET<Program[]>('/programs').catch((): Program[] => []), GET<TeamListing[]>('/workflows').catch((): TeamListing[] => []), GET<WorkflowRun[]>('/workflow-runs').catch((): WorkflowRun[] => []), GET<WorkflowRun[]>('/workflow-active').catch((): WorkflowRun[] => []), GET<StationLayout>('/layout').catch((): StationLayout => ({}))]);
  if (!S) return;
  S.layout = layout || {};
  S.progs = progs;
  S.workflows = wfs.map(teamView);
  S.teamState = Object.fromEntries(wfs.map((w) => [w.id, w.state || { working: [], queued: [] }]));
  S.teamLast = Object.fromEntries(wfs.filter((w) => w.last).map((w) => [w.id, w.last]));
  S.wfRuns = runs;
  S.active = new Map(active.map((r) => [r.workflowId, r]));
  shareTeams();
  if (!(window as StationWindow).__chatsRestored) {
    (window as StationWindow).__chatsRestored = true;
    restoreChats();
  }
}

function shareTeams(): void {
  assertMounted(S);
  (window as StationWindow).__teams = S.workflows;
  (window as StationWindow).__teamWorking = Object.fromEntries(Object.entries(S.teamState || {}).map(([k, v]) => [k, v.working || []]));
  refreshChatTabs();
}

export function unmount(): void {
  if (!S) return;
  S.alive = false;
  S.offState?.();
  S.ro?.disconnect();
  clearInterval(S.progTimer);
  clearInterval(S.headTimer);
  clearInterval(S.clockTimer);
  clearInterval(S.usageTimer);
  window.removeEventListener('keydown', S.onKey);
  if (floorPick?.timer) clearTimeout(floorPick.timer);
  floorPick = null;
  endFloorOut();
  document.removeEventListener('pointerdown', S.onDocDown, true);
  document.removeEventListener('paste', S.onPaste);
  S.panelView?.unmount();
  S.menuView?.unmount();
  S.worldLayer?.dispose();
  S.worldLayer = null;
  S.view?.dispose();
  S.view = null;
  S.renderer.dispose();
  S.scene.traverse((o: Disposable) => {
    o.geometry?.dispose?.();
    if (o.material) ([] as THREE.Material[]).concat(o.material).forEach((m) => m.dispose?.());
  });
  S = null;
  setClaudeConnectors([]);
}

function resize(): void {
  if (!S) return;
  const r = S.root.getBoundingClientRect();
  S.w = Math.max(1, r.width);
  S.h = Math.max(1, r.height);
  S.renderer.setSize(S.w, S.h, false);
  S.renderer.domElement.style.width = `${S.w}px`;
  S.renderer.domElement.style.height = `${S.h}px`;
  S.view?.setSize(S.w, S.h);
  updateCamera();
}

function updateCamera(): void {
  assertMounted(S);
  const c = S.cam;
  const aspect = S.w / S.h;
  const v = c.view / c.zoom;
  Object.assign(S.camera, { left: (-v * aspect) / 2, right: (v * aspect) / 2, top: v / 2, bottom: -v / 2 });
  const D = 300;
  S.camera.position.set(c.target.x + Math.sin(c.az) * Math.cos(c.el) * D, c.target.y + Math.sin(c.el) * D, c.target.z + Math.cos(c.az) * Math.cos(c.el) * D);
  S.camera.lookAt(c.target);
  S.camera.updateProjectionMatrix();
  for (const d of S.desks) d.group.rotation.y = c.az + (d.branchAngle || 0);
}

function signature(): string {
  assertMounted(S);
  const d = state.data;
  if (!d) return '';
  const ints = availableIntegrations(d, S.progs).map((i) => `${i.id}${i.live ? '+' : ''}`).join(',');
  return JSON.stringify([
    S.workflows.map((w) => [w.id, w.name, w.color, w.angle, w.pos, w.rot, w.access, w.lead, w.members, w.mark, w.markFile?.at]),
    d.agents.map((a) => [a.id, a.name, a.emoji, a.color, a.model, a.engine, [...agentLinks(a)].join('|')]),
    ints,
  ]);
}

// ---------- the voxel look (web/voxel, loaded the first time it is turned on) ----------
/** Turns the voxel look on, off, or to another quality, to match Settings › Look. Cheap when nothing changed. */
async function applyStationLook(): Promise<void> {
  if (!S) return;
  const look = { ...DEFAULT_LOOK, ...(state.data?.settings?.look || {}) };
  const order: WorldQuality[] = ['low', 'medium', 'high'];
  const capped = (q: WorldQuality) => (S?.lookCap && order.indexOf(q) > order.indexOf(S.lookCap) ? S.lookCap : q);
  const want = S.lookForced || (look.stationLook === 'world' ? capped(look.worldQuality) : null);
  if (want === S.lookShown) return;
  S.lookShown = want;
  S.worldLayer?.dispose();
  S.worldLayer = null;
  S.view?.dispose();
  S.view = null;
  if (!want) return;
  const [{ createWorldView }, { createWorldLayer }] = await Promise.all([import('../voxel/view.ts'), import('../voxel/worldlayer.ts')]);
  if (!S || S.lookShown !== want) return;
  S.view = createWorldView({ renderer: S.renderer, scene: S.scene, camera: S.camera, quality: want, classic: S.classic, w: S.w, h: S.h, onSlow: S.lookForced ? undefined : () => void stepLookDown(want) });
  if (S.world) S.view.adopt(S.world, S.radius || 40);
  S.worldLayer = createWorldLayer(S.view, anchorAt, skinHost);
}

// Frames stayed slow: one quality level down for this visit (Settings keep what you chose).
async function stepLookDown(from: WorldQuality): Promise<void> {
  const { lowerQuality } = await import('../voxel/quality.ts');
  const next = lowerQuality(from);
  if (!S || !next || S.lookShown !== from) return;
  S.lookCap = next;
  toast(`The Station was slow here, so the voxel world now draws at ${next === 'low' ? 'Low' : 'Medium'} quality. You can change it in Settings › Look.`);
  await applyStationLook();
}

// What skins dress (web/voxel/skins.ts): the classic models of the Brain, the platforms and the desks, by role.
// Skins only hide them (and show them again), so the classic look is never changed.
const partsTagged = (g: THREE.Object3D, part: string) => g.children.filter((o) => o.userData.part === part);
const skinHost: SkinHost = {
  version: () => S?.builds || 0,
  brain() {
    if (!S?.brain) return null;
    const b = S.brain;
    return { anchor: b.group, base: partsTagged(b.group, 'base'), globe: [b.cloud, b.ico, b.halo, b.beam, b.star], pick: { type: 'brain' } };
  },
  team(id) {
    const b = S?.branches.get(id);
    if (!b) return null;
    const kids = b.group.children;
    const hub = kids.find((o) => o.userData.part === 'hub');
    return {
      anchor: b.group,
      floor: partsTagged(b.group, 'floor'),
      hub: [...(hub ? partsTagged(hub, 'hub-base') : []), ...(b.hub ? [b.hub.holo, b.hub.holo2, b.hub.hubGlow] : [])],
      extras: [...kids.filter((o) => o.userData.part === 'seat' || o.userData.part === 'spoke'), ...(b.link ? [b.link] : [])],
      pick: { type: 'branch', id },
    };
  },
  agents() {
    return (S?.desks || []).map(
      (d): AgentTarget => ({
        agentId: d.agent.id,
        key: `${d.agent.id}@${d.wfId || 'bench'}`,
        anchor: d.group,
        person: d.person,
        // the desk itself; the live screen, the status orb and the rings stay
        furniture: d.group.children.filter((o) => o !== d.person && o !== d.screenGlow && o !== d.orb && o !== d.orbGlow && o !== d.ring && o !== d.focusRing && ((o as THREE.Mesh).material as MappedMaterial | undefined)?.map !== d.screen.tex),
        status: () => d.status,
        pick: d.group.userData.pick,
      }),
    );
  },
  setLabel(kind, id, hidden) {
    if (!S) return;
    S.labelHidden ??= new Set();
    if (hidden) S.labelHidden.add(`${kind}:${id}`);
    else S.labelHidden.delete(`${kind}:${id}`);
  },
};

// Where a world object's anchor is on the map now: the middle, a team's platform, or an agent's desk.
const anchorSpot = new THREE.Vector3();
function anchorAt(a: WorldAnchor): THREE.Vector3 | null {
  if (!S || a.to === 'world' || a.to === 'brain') return anchorSpot.set(0, 0, 0);
  if (a.to === 'team') {
    const b = S.branches.get(a.id);
    return b ? anchorSpot.copy(b.group.position).setY(0) : null;
  }
  const desk = S.desks.find((d) => d.agent.id === a.id);
  return desk ? desk.group.getWorldPosition(anchorSpot).setY(0) : null;
}

interface VoxelBenchOptions {
  /** island radius in voxels (60 ≈ 0.2M voxels, 90 ≈ 0.6M, 130 ≈ 1.7M) */
  radius?: number;
  voxelSize?: number;
  /** voxels per side of one mesh */
  region?: number;
  quality?: WorldQuality;
  env?: string;
  seconds?: number;
}

// Phase 0: puts the test island on the map (in the voxel look, at the quality asked) and measures it.
// null takes it away again. From the console: await __voxelBench({ radius: 90 }).
async function voxelBench(opts: VoxelBenchOptions | null = {}): Promise<unknown> {
  if (!S) return null;
  if (!opts) {
    S.view?.removeVolume('bench');
    S.lookForced = null;
    await applyStationLook();
    return null;
  }
  const quality = opts.quality || S.lookShown || 'medium';
  S.lookForced = quality;
  await applyStationLook();
  const [{ benchIsland, BENCH_PALETTE }, { envPreset }] = await Promise.all([import('../voxel/bench.ts'), import('../../shared/worldenv.ts')]);
  if (!S?.view) return null;
  const t0 = performance.now();
  const vol = benchIsland(opts.radius ?? 90, opts.voxelSize ?? 0.25);
  const genMs = Math.round(performance.now() - t0);
  S.view.setEnvironment(envPreset(opts.env || 'golden'));
  const stats = S.view.addVolume('bench', vol, BENCH_PALETTE, new THREE.Vector3(), opts.region ?? 32);
  S.view.adopt(S.world || S.scene, Math.max(S.radius || 40, (opts.radius ?? 90) * (opts.voxelSize ?? 0.25) + 4));
  const speed = await S.view.measure(opts.seconds ?? 5);
  const out = { quality, ...stats, generateMs: genMs, ...speed, pixelRatio: S.renderer.getPixelRatio(), size: `${S.w}x${S.h}` };
  console.info('voxel bench', out);
  return out;
}

// ---------- the Brain ----------
function buildBrain(): void {
  assertMounted(S);
  const g = new THREE.Group();
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.4, 0.8, 6), new THREE.MeshStandardMaterial({ color: 0x121612, roughness: 0.8, metalness: 0.3 }));
  ped.position.y = 0.4;
  g.add(ped);
  const pedEdges = new THREE.LineSegments(new THREE.EdgesGeometry(ped.geometry), new THREE.LineBasicMaterial({ color: 0x7a9a2c, transparent: true, opacity: 0.6 }));
  pedEdges.position.copy(ped.position);
  ped.userData.part = pedEdges.userData.part = 'base';
  g.add(pedEdges);
  const N = 2200;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const c1 = new THREE.Color(0x7fb6ff);
  const c2 = new THREE.Color(0xe6f2ff);
  for (let i = 0; i < N; i++) {
    const r = 2.6 * Math.pow(Math.random(), 0.35);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.8, r * Math.sin(ph) * Math.sin(th)], i * 3);
    const c = c1.clone().lerp(c2, Math.random());
    col.set([c.r, c.g, c.b], i * 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const cloud = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  cloud.position.y = 3.2;
  g.add(cloud);
  const ico = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.1, 1)), new THREE.LineBasicMaterial({ color: 0xc4ff3d, transparent: true, opacity: 0.18 }));
  ico.position.y = 3.2;
  g.add(ico);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0x6fa8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(11, 11, 1);
  halo.position.y = 3.2;
  g.add(halo);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.7, 16, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 12;
  g.add(beam);
  const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xffcc55, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  star.scale.set(6, 6, 1);
  star.position.y = 7.4;
  g.add(star);
  const light = new THREE.PointLight(0x9fd0ff, 30, 40, 1.6);
  light.position.y = 4;
  g.add(light);
  g.traverse((o) => (o.userData.pick = { type: 'brain' }));
  S.scene.add(g);
  S.brain = { group: g, cloud, ico, halo, beam, star, light, logo: null, logoKey: '', model: null, modelLight: null };
  setBrainLogo();
}

// Put the project's 3D model, or else its logo, inside the globe (or take it out). The logo always faces you and gently
// floats; a model slowly turns. The globe and its particles turn around either one. Cheap to call often: nothing happens
// unless it changed.
function setBrainLogo(): void {
  const b = S?.brain;
  if (!b) return;
  const proj = state.data?.project;
  const mUrl = modelUrl(proj) || '';
  const lUrl = logoUrl(proj) || '';
  const key = mUrl ? `model:${mUrl}` : lUrl;
  if (key === b.logoKey) return;
  b.logoKey = key;
  clearBrainCentre(b);
  if (mUrl) {
    loadModel(mUrl, proj?.modelExt || 'glb')
      .then((obj) => {
        if (!S?.brain || S.brain.logoKey !== key) return disposeObject(obj);
        // fit it inside the globe, centred on it
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const k = 3.4 / (Math.max(size.x, size.y, size.z) || 1);
        const holder = new THREE.Group();
        obj.scale.setScalar(k);
        obj.position.copy(centre.multiplyScalar(-k));
        holder.add(obj);
        holder.position.y = 3.2;
        holder.traverse((o) => (o.userData.pick = { type: 'brain' }));
        // a front light so the model is not just lit from above
        const fill = new THREE.PointLight(0xffffff, 45, 22, 1.4);
        fill.position.set(0, 4.8, 7);
        S.brain.group.add(holder, fill);
        S.brain.model = holder;
        S.brain.modelLight = fill;
      })
      .catch(() => {
        // a model the page can't read: show the logo instead, and say why
        toast("Couldn't read the 3D model, so the logo is shown instead.", 'warn');
        if (S?.brain && S.brain.logoKey === key) {
          S.brain.logoKey = lUrl;
          showBrainLogo(lUrl);
        }
      });
    return;
  }
  showBrainLogo(lUrl);
}

function disposeObject(o: THREE.Object3D): void {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

/** Takes whatever is in the middle of the globe out (the logo or the model, and the model's light). */
function clearBrainCentre(b: Brain): void {
  if (b.logo) {
    b.group.remove(b.logo);
    b.logo.material.map?.dispose();
    b.logo.material.dispose();
    b.logo = null;
  }
  if (b.model) {
    b.group.remove(b.model);
    disposeObject(b.model);
    b.model = null;
  }
  if (b.modelLight) {
    b.group.remove(b.modelLight);
    b.modelLight.dispose();
    b.modelLight = null;
  }
}

function showBrainLogo(url: string): void {
  if (!url) return;
  new THREE.TextureLoader().load(url, (tex) => {
    if (!S?.brain || S.brain.logoKey !== url) return tex.dispose();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const img = tex.image as { width: number; height: number };
    const aspect = img.width && img.height ? img.width / img.height : 1;
    const side = 3.1;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.96 }));
    sp.scale.set(aspect >= 1 ? side : side * aspect, aspect >= 1 ? side / aspect : side, 1);
    sp.position.y = 3.2;
    sp.renderOrder = 5;
    sp.userData.pick = { type: 'brain' };
    sp.userData.base = sp.scale.clone();
    S.brain.group.add(sp);
    S.brain.logo = sp;
  });
}

// ---------- layout ----------
const STEP_GAP = 8;

function rebuild(): void {
  const d = state.data;
  if (!d || !S) return;
  S.signature = signature();
  S.builds = (S.builds || 0) + 1;
  if (S.world) {
    S.scene.remove(S.world);
    S.world.traverse((o: Disposable) => {
      o.geometry?.dispose?.();
      if (o.material) ([] as MappedMaterial[]).concat(o.material).forEach((m) => (m.map && m.map !== glowTex && ![...glyphCache.values()].includes(m.map) && m.map.dispose?.(), m.dispose?.()));
    });
  }
  for (const l of S.labelEls) l.el.remove();
  Object.assign(S, { labelEls: [], desks: [], nodes: [], curves: [], particles: [], spinners: [] });
  S.branches.clear();
  S.benchCenter = null;
  S.bench = null;
  S.benchNodes = [];
  S.intNodes.clear();
  const world = new THREE.Group();
  S.world = world;
  S.scene.add(world);

  const agentsById = new Map(d.agents.map((a) => [a.id, a]));
  const wfs = S.workflows;
  const used = new Set(wfs.flatMap((w) => w.steps.filter((s) => s.type === 'agent').map((s) => s.agentId)));
  const bench = d.agents.filter((a) => !used.has(a.id));
  // Branches spread around the Brain, leaving the front open for the Bench (shared/stationlayout.ts: world_info tells builders the same).
  let maxR = FIRST;
  const spots = teamSpots(
    wfs.map((w) => ({ ...w, members: w.members || [] })),
    { benchCount: bench.length, hasAgent: (id) => agentsById.has(id) },
  );
  wfs.forEach((wf, i) => {
    const end = buildBranch(wf, i, spots[i], agentsById);
    maxR = Math.max(maxR, end);
  });
  if (bench.length) buildBench(bench);
  S.radius = maxR;
  S.view?.adopt(world, maxR);

  // Wires from the header tiles down to every step that can use that connection (drawn in 2D, see drawWires).
  buildWires();

  addLabel({
    kind: 'brain',
    id: 'brain',
    obj: S.brain.group,
    offset: new THREE.Vector3(0, 9.5, 0),
    el: h('div.st-brain-label', { class: BRAIN_LABEL, onclick: () => choose({ type: 'brain' }), title: 'Click for the project Brain · drop files here (or paste them on the Station) to give them to it', ondragenter: brainDragOver, ondragover: brainDragOver, ondrop: brainDrop }, icon('brain', 14), 'THE BRAIN', h('span', { class: 'text-dim font-normal tracking-[0.06em]' }, `${d.project?.name || ''} · ${wfs.length} team${wfs.length === 1 ? '' : 's'} · ${d.agents.length} agent${d.agents.length === 1 ? '' : 's'}`)),
  });
  // A branch added or removed: make sure the whole station still fits.
  const shape = `${wfs.length}:${bench.length}`;
  if (S.shape && S.shape !== shape) fitView();
  S.shape = shape;
  updateCamera();
  updateStatuses();
  // #/station?team=<id> opens that team (e.g. "Show" in the Brain chat)
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('team');
  if (want && S.opened !== want && wfs.some((w) => w.id === want)) {
    S.opened = want;
    return choose({ type: 'branch', id: want });
  }
  if (S.selected) renderPanel();
}

// A team is a group chat, so it's drawn as a round pod: the agents sit around a shared chat hub,
// the lead's desk faces the Brain (★), spokes join every desk to the hub, and handoffs fly
// desk → hub → desk. Teams can sit anywhere (drag) and spin (Shift+drag); wf.pos / wf.rot keep it.

/** A team's own picture or 3D model in its hub, in place of the emoji (which stays if it can't be read). */
function loadTeamMark(wf: TeamView, hub: THREE.Group, mark: THREE.Sprite): void {
  const m = wf.markFile;
  const url = teamMarkUrl(wf);
  const world = S?.world;
  if (!m || !url) return;
  if (m.kind === 'image') {
    new THREE.TextureLoader().load(url, (tex) => {
      if (!S || S.world !== world) return tex.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image as { width: number; height: number };
      const aspect = img.width && img.height ? img.width / img.height : 1;
      mark.material.map = tex;
      mark.material.needsUpdate = true;
      mark.scale.set(aspect >= 1 ? 1.6 : 1.6 * aspect, aspect >= 1 ? 1.6 / aspect : 1.6, 1);
    });
    return;
  }
  loadModel(url, m.ext)
    .then((obj) => {
      if (!S || S.world !== world) return disposeObject(obj);
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const k = 1.5 / (Math.max(size.x, size.y, size.z) || 1);
      obj.scale.setScalar(k);
      obj.position.copy(centre.multiplyScalar(-k));
      const holder = new THREE.Group();
      holder.add(obj);
      holder.position.y = 2.1;
      // a little light of its own so it is not left dark
      const lamp = new THREE.PointLight(0xffffff, 10, 7, 1.4);
      lamp.position.set(0.9, 1.4, 1.6);
      holder.add(lamp);
      holder.traverse((o) => (o.userData.pick = { type: 'branch', id: wf.id }));
      hub.add(holder);
      mark.visible = false;
      S.spinners.push(holder);
    })
    .catch(() => {
      /* the emoji stays */
    });
}

// ---------- label looks ----------
// The map labels move every frame (inline transform), so only their colors animate. The script marks their
// state with classes (sel, hot, live, needs, att-target) and data-status; the parent marks focus and data-zoom.
const CHIP =
  'group/chip flex items-center gap-1.25 py-0.75 px-1.75 whitespace-nowrap cursor-pointer bg-[rgba(10,12,10,0.88)] border border-line-2 rounded-ctl font-mono text-[9.5px] leading-[normal] font-semibold tracking-[0.08em] uppercase text-ink transition-[opacity,box-shadow,border-color] duration-200 ease-[ease] hover:border-accent hover:text-accent [&.sel]:border-accent [&.sel]:text-accent [&:is([data-status=running],[data-status=needs-you],[data-status=working])]:border-accent-dim group-[.focus]/labels:[&:not(.hot)]:opacity-18 group-[.focus]/labels:[&.hot]:border-accent group-[.focus]/labels:[&.hot]:shadow-[0_0_0_1px_var(--color-accent),0_0_18px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]';
const CHIP_DOT =
  'size-1.5 rounded-full bg-faint group-data-[status=working]/chip:bg-accent group-data-[status=running]/chip:bg-accent group-data-[status=working]/chip:shadow-[0_0_6px_var(--color-accent)] group-data-[status=running]/chip:shadow-[0_0_6px_var(--color-accent)] group-data-[status=needs]/chip:bg-red group-data-[status=needs-you]/chip:bg-red group-data-[status=needs]/chip:animate-[pulse_0.8s_infinite] group-data-[status=needs-you]/chip:animate-[pulse_0.8s_infinite]';
// the model shows only when zoomed in
const CHIP_MODEL = "[display:none] ml-0.5 text-faint font-medium normal-case tracking-[0.02em] group-data-[zoom=near]/labels:inline group-data-[zoom=near]/labels:before:content-['·_']";
const CARD =
  'py-2.75 px-3.25 cursor-pointer shadow-[0_10px_30px_rgba(0,0,0,0.45)] bg-glass backdrop-blur-[16px] backdrop-saturate-140 border border-[color-mix(in_srgb,var(--c,#555850)_45%,var(--color-line))] rounded-box transition-[opacity,box-shadow,border-color] duration-200 ease-[ease]';
const BRANCH = `group/card w-53.5 ${CARD} hover:border-(--c) [&.sel]:border-(--c) [&.live]:shadow-[0_0_0_1px_var(--color-accent-dim),0_0_24px_rgba(196,255,61,0.18)] [&.needs]:shadow-[0_0_0_1px_var(--color-amber),0_0_24px_rgba(240,176,74,0.25)] [&:hover]:shadow-[0_0_0_1px_var(--c),0_14px_34px_rgba(0,0,0,0.5)] group-[.focus]/labels:[&:not(.hot)]:opacity-18 group-[.focus]/labels:[&.hot]:shadow-[0_0_0_1px_var(--color-accent),0_0_22px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]`;
const BENCH = `[--c:#555850] w-50 ${CARD} group-[.focus]/labels:opacity-18`;
const BRANCH_NAME = 'flex items-center gap-1.75 font-mono text-[10.5px] leading-[normal] font-bold tracking-[0.16em] text-ink';
const BRAIN_LABEL =
  'flex items-center gap-2 py-1.5 px-2.75 cursor-pointer whitespace-nowrap bg-glass backdrop-blur-[16px] backdrop-saturate-140 border border-accent-dim rounded-box font-mono text-[10.5px] leading-[normal] font-bold tracking-[0.2em] transition-[opacity,box-shadow,border-color] duration-200 ease-[ease] [&.att-target]:border-accent [&.att-target]:text-accent [&.att-target]:shadow-[0_0_0_1px_var(--color-accent),0_0_30px_color-mix(in_srgb,var(--color-accent)_40%,transparent)] group-[.focus]/labels:[&:not(.hot)]:opacity-18 group-[.focus]/labels:[&.hot]:shadow-[0_0_0_1px_var(--color-accent),0_0_22px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]';

function buildBranch(wf: TeamView, i: number, spot: TeamSpot, agentsById: Map<string, Agent>): number {
  assertMounted(S);
  const color = new THREE.Color(wfColor(wf, i));
  const light = color.clone().lerp(new THREE.Color(0xffffff), 0.4);
  const members = (wf.members || []).filter((id) => agentsById.get(id));
  const R = spot.radius;
  const pod = new THREE.Group();
  const home = new THREE.Vector3(spot.home[0], 0, spot.home[1]);
  pod.position.set(spot.center[0], 0, spot.center[1]);
  const spin = spot.spin;
  pod.rotation.y = -spin;
  S.world!.add(pod);
  pod.updateMatrixWorld(true);

  // the round floor
  const floor = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.25, 0.5, 64), new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.42), roughness: 0.55, metalness: 0.15, emissive: color, emissiveIntensity: 0.1 }));
  slab.position.y = 0.25;
  floor.add(slab);
  const top = new THREE.Mesh(new THREE.CircleGeometry(R - 0.15, 64), new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.62), roughness: 0.75, emissive: color, emissiveIntensity: 0.07 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.51;
  floor.add(top);
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry, 30), new THREE.LineBasicMaterial({ color: light, transparent: true, opacity: 0.7 }));
  rim.position.copy(slab.position);
  floor.add(rim);
  // an inner ring where the conversation runs
  const track = new THREE.Mesh(new THREE.RingGeometry(R * 0.42, R * 0.42 + 0.08, 64), new THREE.MeshBasicMaterial({ color: light, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  track.rotation.x = -Math.PI / 2;
  track.position.y = 0.53;
  floor.add(track);
  const under = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }));
  under.scale.set(R * 3, R * 2.2, 1);
  under.position.y = -0.2;
  floor.add(under);
  floor.traverse((o) => (o.userData.pick = { type: 'branch', id: wf.id }));
  floor.userData.part = 'floor';
  pod.add(floor);

  // the chat hub in the middle: everyone talks through it
  const hub = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.2, 0.55, 6), new THREE.MeshStandardMaterial({ color: 0x141714, roughness: 0.5, metalness: 0.3, emissive: color, emissiveIntensity: 0.35 }));
  base.position.y = 0.8;
  base.userData.part = 'hub-base';
  hub.add(base);
  const holo = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: light, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  holo.rotation.x = Math.PI / 2;
  holo.position.y = 2.1;
  hub.add(holo);
  const holo2 = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 8, 40), holo.material.clone());
  holo2.position.y = 2.1;
  hub.add(holo2);
  // the team's symbol: its emoji (💬 unless it chose another), or its own picture or 3D model once that has loaded
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex(wf.mark || DEFAULT_TEAM_MARK, '#' + light.getHexString()), transparent: true, depthWrite: false }));
  mark.scale.set(1.3, 1.3, 1);
  mark.position.y = 2.1;
  hub.add(mark);
  if (wf.markFile) loadTeamMark(wf, hub, mark);
  const hubGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  hubGlow.scale.set(4.5, 4.5, 1);
  hubGlow.position.y = 1.8;
  hub.add(hubGlow);
  hub.traverse((o) => (o.userData.pick = { type: 'branch', id: wf.id }));
  hub.userData.part = 'hub';
  pod.add(hub);
  const HUB = new THREE.Vector3(0, 1.7, 0);

  // where the Brain is, seen from the pod (the lead's desk is on that side: spot.desks are in that order)
  const toBrain = pod.worldToLocal(new THREE.Vector3(0, 0, 0)).setY(0);
  const rails: Rail[] = [{ material: track.material, base: 0.35 }];
  const branchNodes: PodNode[] = [];
  const branchLinks = new Set<string>();
  spot.desks.forEach(({ agentId, local }, k) => {
    const agent = agentsById.get(agentId)!;
    const pos = new THREE.Vector3(local[0], 0, local[1]);
    const isLead = wf.lead === agentId;
    const step: TeamStep = { type: 'agent', agentId };
    const links = stepLinks(step, agentsById, wf);
    links.forEach((l) => branchLinks.add(l));
    const desk = makeDesk(agent, wfColor(wf, i), isLead ? 'LEAD' : 'TEAM');
    desk.group.position.copy(pos).setY(0.5);
    desk.group.traverse((o) => (o.userData.pick = { type: 'agent', id: agent.id, wf: wf.id, step: k }));
    pod.add(desk.group);
    Object.assign(desk, { wfId: wf.id, branchAngle: spin, stepIndex: k, podPos: pos.clone() });
    S!.desks.push(desk);
    // the lead's seat gets a gold ring
    if (isLead) {
      const seat = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.95, 48), new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.75, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      seat.rotation.x = -Math.PI / 2;
      seat.position.copy(pos).setY(0.56);
      seat.userData.part = 'seat';
      pod.add(seat);
    }
    // spoke from the desk to the hub
    const spoke = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([pos.clone().setY(0.6), HUB.clone().setY(0.6)]),
      new THREE.LineBasicMaterial({ color: light, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    spoke.userData.part = 'spoke';
    pod.add(spoke);
    rails.push({ material: spoke.material, base: 0.3 });
    const node: PodNode = { kind: 'agent', pos, obj: desk.group, wfId: wf.id, index: k, links, desk, agentId: agent.id };
    S!.nodes.push(node);
    branchNodes.push(node);
    addLabel({
      kind: 'agent',
      id: agent.id,
      wf: wf.id,
      obj: desk.group,
      offset: new THREE.Vector3(0, 3.3, 0),
      el: h('div', { class: CHIP, onclick: () => choose({ type: 'agent', id: agent.id, wf: wf.id }), title: `${agent.name} · ${agent.model || agent.engine}${isLead ? ' · team lead' : ''}` }, h('span', { class: CHIP_DOT }), isLead ? h('span', { class: 'text-amber', title: 'Team lead' }, '★') : null, h('span', { class: 'max-w-42.5 truncate inline-block align-bottom' }, agent.name), h('span', { class: CHIP_MODEL }, shortModel(agent))),
    });
  });
  // the conversation gently circles the hub
  for (let k = 0; k < 3; k++) spawn({ parent: pod, path: (t: number) => new THREE.Vector3(Math.cos(t * Math.PI * 2) * R * 0.42, 0.62, Math.sin(t * Math.PI * 2) * R * 0.42), t: k / 3, speed: 0.06, color: light, size: 0.45, loop: true, opacity: 0.55 });

  // the team card, on the far side from the Brain
  const away = toBrain.lengthSq() > 0.01 ? toBrain.clone().normalize().multiplyScalar(-(R + 2.6)) : new THREE.Vector3(R + 2.6, 0, 0);
  const anchor = new THREE.Object3D();
  anchor.position.copy(away);
  pod.add(anchor);
  // an invisible box where the card sits, so zoom-to-fit keeps the card on screen
  const fitBox = new THREE.Mesh(new THREE.BoxGeometry(14, 0.1, 8), new THREE.MeshBasicMaterial({ visible: false }));
  fitBox.position.copy(away).addScaledVector(away.clone().normalize(), 7);
  pod.add(fitBox);
  const card = h('div', { class: BRANCH, style: { '--c': wfColor(wf, i) }, onclick: () => choose({ type: 'branch', id: wf.id }) });
  // pinned by its edge, so it grows away from the pod instead of over it
  addLabel({ kind: 'branch', id: wf.id, obj: anchor, from: pod, offset: new THREE.Vector3(0, 0.5, 0), el: card });

  // the link to the Brain (redrawn when the team moves)
  const link = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(33).fill(0).map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: light, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  S.world!.add(link);
  rails.push({ material: link.material, base: 0.45 });
  const b: Branch = { wf, index: i, color, group: pod, center: new THREE.Vector3(), radius: R, nodes: branchNodes, links: branchLinks, card, agentCount: members.length, rails, link, hub: { holo, holo2, hubGlow }, spin, flash: 0, home };
  b.along = (t: number) => linkPoint(b, t);
  S.branches.set(wf.id, b);
  updateLink(b);
  // a slow stream of light from the Brain to the team
  for (let k = 0; k < 2; k++) spawn({ path: (t: number) => linkPoint(b, t), t: k / 2, speed: 0.07 + Math.random() * 0.03, color: light, size: 0.5, loop: true, opacity: 0.45 });
  drawBranchCard(wf.id);
  return pod.position.length() + R + 16; // room for the team card too
}

// Brain edge → the team's hub, as a soft arc (world coordinates; follows the team when it moves).
function linkPoint(b: Branch, t: number): THREE.Vector3 {
  const p2 = b.group.position.clone().setY(1.7);
  const dir = p2.clone().setY(0);
  const len = dir.length() || 1;
  dir.divideScalar(len);
  const p0 = dir.clone().multiplyScalar(4.4).setY(0.9);
  const edge = b.group.position.clone().addScaledVector(dir, -b.radius).setY(0.7);
  const end = t < 0.85 ? edge : p2;
  const tt = t < 0.85 ? t / 0.85 : (t - 0.85) / 0.15;
  const from = t < 0.85 ? p0 : edge;
  const ctrl = from.clone().lerp(end, 0.5).setY(Math.max(from.y, end.y) + (t < 0.85 ? Math.min(6, len * 0.12) : 0.5));
  const u = 1 - tt;
  return from.clone().multiplyScalar(u * u).addScaledVector(ctrl, 2 * u * tt).addScaledVector(end, tt * tt);
}
function updateLink(b: Branch): void {
  const pos = b.link.geometry.attributes.position;
  for (let k = 0; k <= 32; k++) {
    const p = linkPoint(b, (k / 32) * 0.85);
    pos.setXYZ(k, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  b.link.geometry.computeBoundingSphere();
}

// Light between two teammates, through the hub (an @mention handoff).
function pulseHandoff(teamId: string, fromId: string, toId: string, count = 6): void {
  const b = S?.branches.get(teamId);
  if (!b) return;
  const A = b.nodes.find((n) => n.agentId === fromId);
  const B = b.nodes.find((n) => n.agentId === toId);
  if (!A || !B) return;
  const hub = new THREE.Vector3(0, 1.9, 0);
  const path = polyline([A.pos.clone().setY(1.9), hub, B.pos.clone().setY(1.9)]);
  for (let k = 0; k < count; k++) spawn({ parent: b.group, path, t: -k * 0.07, speed: 0.8, color: new THREE.Color(0xfff2b0), size: 0.8, loop: false });
  b.flash = 1;
}
// The hub hands a message to one teammate (they start working on it).
function pulseToDesk(teamId: string, agentId: string, count = 4): void {
  const b = S?.branches.get(teamId);
  const N = b?.nodes.find((n) => n.agentId === agentId);
  if (!N) return;
  const path = polyline([new THREE.Vector3(0, 1.9, 0), N.pos.clone().setY(1.9)]);
  for (let k = 0; k < count; k++) spawn({ parent: b!.group, path, t: -k * 0.08, speed: 0.9, color: new THREE.Color(0xfff2b0), size: 0.7, loop: false });
  b!.flash = Math.max(b!.flash, 0.6);
}

function buildBench(agents: Agent[]): void {
  assertMounted(S);
  const dir = new THREE.Vector3(Math.cos(Math.PI / 4), 0, Math.sin(Math.PI / 4));
  const rows = Math.ceil(agents.length / 4);
  // its saved spot, or in front of the Brain
  const spot = benchSpot(agents.map((a) => a.id), S.layout?.bench)!;
  const center = new THREE.Vector3(spot.center[0], 0, spot.center[1]);
  const bench = new THREE.Group();
  bench.position.copy(center);
  S.world!.add(bench);
  const [w, dd] = spot.size;
  const slabG = new THREE.Group();
  slabG.rotation.y = -Math.PI / 4;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(dd, 0.4, w), new THREE.MeshStandardMaterial({ color: 0x1b1f1b, roughness: 0.8, emissive: 0x2a3028, emissiveIntensity: 0.3 }));
  slab.position.y = 0.2;
  slabG.add(slab);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: 0x555850, transparent: true, opacity: 0.8 }));
  edges.position.copy(slab.position);
  slabG.add(edges);
  slabG.traverse((o) => (o.userData.pick = { type: 'bench' }));
  bench.add(slabG);
  agents.forEach((ag, j) => {
    const desk = makeDesk(ag, ag.color || '#6b7066', 0);
    desk.group.position.set(spot.desks[j].local[0], 0.4, spot.desks[j].local[1]);
    desk.group.traverse((o) => (o.userData.pick = { type: 'agent', id: ag.id }));
    bench.add(desk.group);
    S!.desks.push(desk);
    S!.benchNodes.push({ kind: 'agent', obj: desk.group, links: agentLinks(ag), desk, agentId: ag.id, wfId: null, index: -1 });
    addLabel({ kind: 'agent', id: ag.id, obj: desk.group, offset: new THREE.Vector3(0, 3.2, 0), el: h('div', { class: CHIP, onclick: () => choose({ type: 'agent', id: ag.id }), title: `${ag.name} · ${ag.model || ag.engine}` }, h('span', { class: CHIP_DOT }), ag.name, h('span', { class: CHIP_MODEL }, shortModel(ag))) });
  });
  const anchor = new THREE.Object3D();
  anchor.position.copy(dir).multiplyScalar(rows * 1.6 + 3.2);
  bench.add(anchor);
  S.bench = bench;
  S.benchCenter = center.clone();
  addLabel({
    kind: 'bench',
    id: 'bench',
    obj: anchor,
    offset: new THREE.Vector3(0, 0, 0),
    el: h('div', { class: BENCH, onclick: () => choose({ type: 'bench' }), title: 'Drag the Bench platform to move it' }, h('div', { class: BRANCH_NAME }, icon('move', 12), 'BENCH'), h('div.hint', `${agents.length} agent${agents.length === 1 ? '' : 's'} not on a team yet`)),
  });
}

// "sonnet" → "Sonnet", "anthropic/claude-sonnet-5.5" → "sonnet-5.5", Hermes → its profile.
function shortModel(a: Pick<Agent, 'engine' | 'model' | 'hermesProfile'>): string {
  if (a.engine === 'hermes') return a.model || a.hermesProfile || 'hermes';
  const m = String(a.model || '').split('/').pop()!.replace(/^claude-/, '');
  return m || a.engine;
}

function polyline(points: THREE.Vector3[]): (t: number) => THREE.Vector3 {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const l = points[i].distanceTo(points[i + 1]);
    lens.push(l);
    total += l;
  }
  return (t) => {
    let d = Math.max(0, Math.min(1, t)) * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) return points[i].clone().lerp(points[i + 1], lens[i] ? Math.min(1, d / lens[i]) : 0);
      d -= lens[i];
    }
    return points[0].clone();
  };
}

// The fraction of a branch's path where step j sits.
function stepT(branch: { path: THREE.Vector3[] }, j: number): number {
  const pts = branch.path;
  let total = 0;
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++) cum.push((total += pts[i].distanceTo(pts[i + 1])));
  return total ? cum[Math.min(j + 1, cum.length - 1)] / total : 0;
}

// A box (or any shape) moved into place and painted one colour, to merge with others into one mesh.
function painted(geo: THREE.BufferGeometry, x: number, y: number, z: number, hex: number | THREE.Color): THREE.BufferGeometry {
  geo.translate(x, y, z);
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return geo;
}

// A desk's furniture (top, legs, monitor, stand, chair) is one mesh with one material, made once and shared
// by every desk: a draw call per desk rather than one per part, which is what slows a map with many agents.
let furniture: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } | null = null;
function deskFurniture(): { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } {
  if (furniture) return furniture;
  const dark = 0x1a1e1a;
  const geo = mergeGeometries([
    painted(new THREE.BoxGeometry(2.6, 0.12, 1.3), 0, 0.9, 0, 0x2a2f29),
    painted(new THREE.BoxGeometry(0.1, 0.9, 1.1), -1.15, 0.45, 0, dark),
    painted(new THREE.BoxGeometry(0.1, 0.9, 1.1), 1.15, 0.45, 0, dark),
    painted(new THREE.BoxGeometry(1.7, 1.08, 0.08), 0, 1.68, -0.38, 0x0e100e),
    painted(new THREE.BoxGeometry(0.12, 0.3, 0.12), 0, 1.05, -0.38, dark),
    painted(new THREE.BoxGeometry(0.75, 0.12, 0.7), 0, 0.6, 0.75, dark),
    painted(new THREE.BoxGeometry(0.75, 0.7, 0.1), 0, 0.98, 1.08, dark),
  ]);
  furniture = { geo, mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }) };
  return furniture;
}

// Shapes every desk shares (one copy on the graphics card, and the same shape is what lets them be batched).
const SHAPES = { body: new THREE.CylinderGeometry(0.22, 0.3, 0.65, 12), head: new THREE.SphereGeometry(0.21, 16, 12), orb: new THREE.SphereGeometry(0.13, 12, 10) };

// ---------- desk parts, batched ----------
// Every desk has the same furniture, body, head and status light: each kind is drawn for all desks in one go
// (an instanced mesh), not once per desk. The desk's own meshes stay where they are, for their place, colour,
// the person's bobbing and the light's pulsing, and for clicking and dragging; they just aren't drawn
// themselves. (A desk's screen shows its own picture, so screens are still drawn one by one.)
interface MeshBatch {
  mesh: THREE.InstancedMesh;
  sources: THREE.Mesh[];
  make: () => THREE.Material;
}

function batchMesh(key: string, src: THREE.Mesh, make: () => THREE.Material): void {
  if (!S) return;
  const all = (S.meshBatches ||= new Map());
  let b = all.get(key);
  if (!b) {
    b = { mesh: instanced(src.geometry, make(), 64), sources: [], make };
    all.set(key, b);
  }
  (src.material as THREE.Material).visible = false;
  b.sources.push(src);
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, size: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, size);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.raycast = () => {}; // the desks' own meshes are picked, not this
  mesh.count = 0;
  return mesh;
}

function drawMeshBatches(): void {
  assertMounted(S);
  for (const b of S.meshBatches?.values() || []) {
    // grow when there are more desks than room
    if (b.sources.length > b.mesh.instanceMatrix.count) {
      const old = b.mesh;
      b.mesh = instanced(old.geometry, b.make(), Math.max(b.sources.length, old.instanceMatrix.count * 2));
      old.removeFromParent();
      (old.material as THREE.Material).dispose();
      old.dispose();
    }
    if (!b.mesh.parent) S.scene.add(b.mesh);
    // the desks cast and take shadows in the voxel look, like the rest of the map
    b.mesh.castShadow = b.mesh.receiveShadow = !!S.view;
    const keep: THREE.Mesh[] = [];
    let n = 0;
    for (const src of b.sources) {
      // gone from the map (rebuilt): drop it; hidden, or inside something hidden: skip it this frame
      let shown = true;
      let o: THREE.Object3D | null = src;
      while (o && o !== S.scene) {
        if (!o.visible) shown = false;
        o = o.parent;
      }
      if (!o) continue;
      keep.push(src);
      if (!shown) continue;
      b.mesh.setMatrixAt(n, src.matrixWorld);
      // (the furniture's colours are in its shape, its material is white)
      b.mesh.setColorAt(n, (src.material as THREE.MeshBasicMaterial).color);
      n++;
    }
    b.sources = keep;
    b.mesh.count = n;
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
  }
}

function makeDesk(agent: Agent, colorHex: string, stepNo: string | number): Desk {
  const g = new THREE.Group();
  const color = new THREE.Color(colorHex);
  const { geo, mat } = deskFurniture();
  const furn = new THREE.Mesh(geo, mat);
  g.add(furn);
  batchMesh('furniture', furn, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }));
  const screen = canvasTex(512, 320, () => {});
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.98), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
  scr.position.set(0, 1.68, -0.33);
  g.add(scr);
  const screenGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xdfe3d8, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  screenGlow.scale.set(3.2, 2.4, 1);
  screenGlow.position.set(0, 1.7, -0.2);
  g.add(screenGlow);
  // the person: body in the agent's colour, and head
  const person = new THREE.Group();
  const body = new THREE.Mesh(SHAPES.body, new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.15), roughness: 0.6 }));
  body.position.y = 0.98;
  const head = new THREE.Mesh(SHAPES.head, new THREE.MeshStandardMaterial({ color: 0xe6e8e0, roughness: 0.5 }));
  head.position.y = 1.5;
  person.add(body, head);
  person.position.z = 0.62;
  g.add(person);
  batchMesh('body', body, () => new THREE.MeshStandardMaterial({ roughness: 0.6 }));
  batchMesh('head', head, () => new THREE.MeshStandardMaterial({ roughness: 0.5 }));
  const orb = new THREE.Mesh(SHAPES.orb, new THREE.MeshBasicMaterial({ color: 0x6b7066 }));
  batchMesh('orb', orb, () => new THREE.MeshBasicMaterial());
  orb.position.set(0.95, 2.45, -0.38);
  g.add(orb);
  const orbGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xc4ff3d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  orbGlow.scale.set(1.4, 1.4, 1);
  orbGlow.position.copy(orb.position);
  orbGlow.visible = false;
  g.add(orbGlow);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.07, 8, 48), new THREE.MeshBasicMaterial({ color: 0xc4ff3d, transparent: true, opacity: 0 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  ring.visible = false;
  g.add(ring);
  const focusRing = new THREE.Mesh(new THREE.RingGeometry(1.55, 2.25, 48), new THREE.MeshBasicMaterial({ color: 0xc4ff3d, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  focusRing.rotation.x = -Math.PI / 2;
  focusRing.position.y = 0.06;
  g.add(focusRing);
  const desk: Desk = { group: g, agent, color: colorHex, stepNo: stepNo || '-', screen, screenGlow, person, orb, orbGlow, ring, focusRing, status: 'idle', activity: '' };
  drawScreen(desk);
  return desk;
}

// ---------- glows ----------
// The soft glows (behind screens and status lights, the Brain's halo, the lights running along the links) are
// all the same picture added on top of what's behind, so they can be drawn in one go: one draw call for
// hundreds of them instead of one each, which is most of what made a map with many agents slow. The sprites stay
// in the scene for their place, size, colour, fading and picking; only their drawing moves here. A glow not
// collected yet simply draws itself as before.
interface GlowBatch {
  mesh: THREE.InstancedMesh;
  tint: THREE.InstancedBufferAttribute;
  sprites: THREE.Sprite[];
  scanned: number;
}
const GLOW_VERTEX = `
attribute vec4 tint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vUv = uv;
  vTint = tint;
  // a sprite: faces the camera, sized like the sprite it stands for
  vec4 at = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  at.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  gl_Position = projectionMatrix * at;
}`;
const GLOW_FRAGMENT = `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vTint.rgb * t.rgb, t.a * vTint.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function glowBatch(size: number): GlowBatch {
  const geo = new THREE.PlaneGeometry(1, 1);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(size * 4), 4);
  tint.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('tint', tint);
  const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: glow() } }, vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.InstancedMesh(geo, mat, size);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  // after the other see-through pieces, so a glow lights what's in front of it as before (the Brain's logo, at 5, stays on top)
  mesh.renderOrder = 4;
  mesh.raycast = () => {}; // the sprites are picked, not this
  mesh.count = 0;
  return { mesh, tint, sprites: [], scanned: -1 };
}

/** Takes a glow sprite into the batch (it stops drawing itself). */
function batchGlow(sp: THREE.Sprite): void {
  if (!S?.glows || sp.userData.glowBatched) return;
  sp.userData.glowBatched = true;
  sp.material.visible = false;
  S.glows.sprites.push(sp);
}

const isGlow = (o: THREE.Object3D): o is THREE.Sprite => o instanceof THREE.Sprite && !!glowTex && o.material.map === glowTex && o.material.blending === THREE.AdditiveBlending;

function drawGlows(): void {
  assertMounted(S);
  let b = (S.glows ||= glowBatch(256));
  if (!b.mesh.parent) S.scene.add(b.mesh);
  // look for new glows now and then (a rebuilt map, the Brain); spawn() hands over its own right away
  if (S.frames! - b.scanned >= 30) {
    b.scanned = S.frames!;
    S.scene.traverse((o) => isGlow(o) && batchGlow(o));
  }
  // grow when there are more glows than room
  if (b.sprites.length > b.tint.count) {
    const bigger = glowBatch(Math.max(b.sprites.length, b.tint.count * 2));
    bigger.sprites = b.sprites;
    bigger.scanned = b.scanned;
    S.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    (b.mesh.material as THREE.Material).dispose();
    b.mesh.dispose();
    b = S.glows = bigger;
    S.scene.add(b.mesh);
  }
  const tints = b.tint.array as Float32Array;
  const keep: THREE.Sprite[] = [];
  let n = 0;
  for (const sp of b.sprites) {
    // gone from the map: drop it; hidden (or inside something hidden): skip it this frame
    let shown = true;
    let o: THREE.Object3D | null = sp;
    while (o && o !== S.scene) {
      if (!o.visible) shown = false;
      o = o.parent;
    }
    if (!o) continue;
    keep.push(sp);
    const m = sp.material;
    if (!shown || m.opacity < 0.004) continue;
    b.mesh.setMatrixAt(n, sp.matrixWorld);
    tints.set([m.color.r, m.color.g, m.color.b, m.opacity], n * 4);
    n++;
  }
  b.sprites = keep;
  b.mesh.count = n;
  b.mesh.instanceMatrix.needsUpdate = true;
  b.tint.needsUpdate = true;
}

/** Draws a frame: positions first, then the glows (which read them), then the picture. */
function renderStation(): void {
  assertMounted(S);
  S.scene.updateMatrixWorld();
  drawMeshBatches();
  drawGlows();
  // the voxel look draws through its own passes (shadows, glow, blur)
  if (S.view) S.view.render(S.frameAim || 0);
  else S.renderer.render(S.scene, S.camera);
}

function spawn(p: ParticleSpec): void {
  assertMounted(S);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: p.color, transparent: true, opacity: p.opacity ?? 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.set(p.size, p.size, 1);
  sp.visible = false;
  (p.parent || S.world!).add(sp);
  batchGlow(sp);
  S.particles.push({ ...p, sprite: sp });
}

// Light running along a branch, from one point (0 = Brain) to another (1 = last step).
// Light between the Brain (0) and a team's hub (1).
function pulseAlong(wfId: string, from = 0, to = 1, count = 5): void {
  const b = S?.branches.get(wfId);
  if (!b) return;
  for (let i = 0; i < count; i++) spawn({ path: (t: number) => linkPoint(b, from + (to - from) * t), t: -i * 0.08, speed: 0.7, color: new THREE.Color(0xfff2b0), size: 0.9, loop: false });
  b.flash = Math.max(b.flash || 0, 0.5);
}

function pulseIntegration(intId: string, node: MapNode | null): void {
  if (!S) return;
  const tile = S.tileEls?.get(intId);
  if (tile) {
    tile.classList.remove('flash');
    void tile.offsetWidth;
    tile.classList.add('flash');
  }
  // light both the desk's own wire and its team's combined wire (whichever is showing runs the light)
  for (const l of [...(S.links2d || []), ...(S.links2dAll || [])]) {
    if (l.intId !== intId) continue;
    if (node && (l.node ? l.node !== node : !l.members?.includes(node))) continue;
    l.flash = 1;
    for (let i = 0; i < 3; i++) S.dots.push({ link: l, t: -i * 0.12 });
  }
}


// ---------- statuses ----------
function updateStatuses(): void {
  const d = state.data;
  if (!d || !S) return;
  for (const desk of S.desks) {
    const needs = d.approvals.some((a) => a.agentId === desk.agent.id) || (d.questions || []).some((q) => q.agentId === desk.agent.id);
    const working = d.runs.some((r) => r.agentId === desk.agent.id);
    const st = needs ? 'needs' : working ? 'working' : 'idle';
    if (st !== desk.status) {
      desk.status = st;
      if (st === 'idle') {
        desk.activity = '';
        desk.act = null;
      }
      desk.orb.material.color.set(st === 'needs' ? 0xff5a5a : st === 'working' ? 0xc4ff3d : 0x6b7066);
      desk.orbGlow.material.color.set(st === 'needs' ? 0xff5a5a : 0xc4ff3d);
      desk.screenGlow.material.color.set(st === 'working' ? 0xc4ff3d : st === 'needs' ? 0xf0b04a : 0xdfe3d8);
      drawScreen(desk, S.clock.elapsedTime);
    }
  }
  // the step a running workflow is on gets a ring
  for (const node of S.nodes) {
    const ts = S.teamState?.[node.wfId];
    const st = (ts?.working?.includes(node.agentId!) ? 'running' : ts?.queued?.includes(node.agentId!) ? 'needs-you' : null) as RunStatus | null;
    node.runStatus = st || null;
    const ring = node.kind === 'agent' ? node.desk.ring : node.ring;
    ring.material.color.set(st === 'needs-you' ? 0xf0b04a : st === 'failed' ? 0xff5a5a : st === 'done' ? 0x7a9a2c : 0xc4ff3d);
    ring.material.opacity = st === 'running' || st === 'needs-you' ? 0.9 : st === 'done' ? 0.35 : st === 'failed' ? 0.7 : 0;
    ring.visible = ring.material.opacity > 0;
  }
  for (const l of S.labelEls) {
    if (l.kind === 'agent') {
      l.el.dataset.status = d.approvals.some((a) => a.agentId === l.id) ? 'needs' : d.runs.some((r) => r.agentId === l.id) ? 'working' : 'idle';
      if (l.wf) {
        const node = S.nodes.find((n) => n.kind === 'agent' && n.wfId === l.wf && n.agentId === l.id);
        if (node?.runStatus === 'running' || node?.runStatus === 'needs-you') l.el.dataset.status = node.runStatus === 'needs-you' ? 'needs' : 'working';
      }
    }
    if (l.kind === 'step') {
      const [wfId, j] = l.id.split(':');
      l.el.dataset.status = S.active.get(wfId)?.steps?.[Number(j)]?.status || 'idle';
    }
  }
  for (const id of S.branches.keys()) drawBranchCard(id);
}

function wfStats(wfId: string) {
  assertMounted(S);
  const runs = S.wfRuns.filter((r) => r.workflowId === wfId);
  return { total: runs.length, done: runs.filter((r) => r.status === 'done').length, failed: runs.filter((r) => r.status === 'failed').length, last: runs[0] || null };
}

function scheduleText(s: (Schedule & { minutes?: number }) | undefined): string {
  if (!s || s.type === 'none') return 'manual';
  if (s.type === 'interval') return `every ${s.minutes || 60} min`;
  return `daily ${s.time || '09:00'}`;
}

function drawBranchCard(wfId: string): void {
  assertMounted(S);
  const b = S.branches.get(wfId);
  if (!b) return;
  const wf = b.wf;
  const ts = S.teamState?.[wfId] || { working: [], queued: [] };
  const last = S.teamLast?.[wfId];
  const nameOf = (id: string) => (id === 'user' ? 'You' : id === 'system' ? '' : id === 'brain' ? 'Brain' : state.data?.agents.find((a) => a.id === id)?.name || '');
  const lead = wf.lead ? nameOf(wf.lead) : '';
  b.card.classList.toggle('live', ts.working.length > 0);
  b.card.classList.toggle('needs', false);
  mount(
    b.card,
    h('div', { class: BRANCH_NAME }, h('span.st-dot'), wf.name.toUpperCase()),
    h(
      'div',
      { class: 'flex items-baseline gap-1.5 mt-1.5 mb-0.5' },
      h('b', { class: 'font-sans text-[28px] leading-none font-bold' }, String(wf.members.length)),
      h('span', { class: 'font-mono text-[9.5px] leading-[normal] font-medium tracking-[0.16em] text-dim' }, wf.members.length === 1 ? 'AGENT' : 'AGENTS'),
      lead ? h('span', { class: 'ml-auto font-mono text-[9.5px] leading-[normal] font-medium tracking-[0.06em] normal-case text-dim' }, `★ ${lead}`) : null,
    ),
    wf.description ? h('div', { class: 'text-[12px] leading-[1.4] text-dim mt-1 mb-1.5 line-clamp-2 group-data-[zoom=far]/labels:hidden' }, wf.description) : null,
    b.links.size ? h('div', { class: 'flex gap-1 flex-wrap my-1.5' }, [...b.links].slice(0, 7).map(badge)) : null,
    last ? h('div', { class: 'text-[11.5px] text-dim leading-[1.4] mt-1 mb-0.5 line-clamp-2' }, h('b', { class: 'text-ink font-semibold' }, nameOf(last.from) || 'Team'), ' ', String(last.text).replace(/\s+/g, ' ').slice(0, 90), h('span.hint', ` · ${ago(last.ts)}`)) : null,
    h(
      'div',
      { class: 'mt-1.75 font-mono text-[9.5px] leading-[normal] font-medium tracking-[0.1em] text-dim uppercase' },
      ts.working.length
        ? h('span', { class: 'text-accent group-[.needs]/card:text-amber' }, `● ${ts.working.map(nameOf).join(', ')} working${ts.queued.length ? ` · ${ts.queued.length} next` : ''}`)
        : h('span', wf.enabled && wf.schedule?.type !== 'none' ? `⏱ ${scheduleText(wf.schedule)}` : last ? 'quiet' : 'say hi to the team'),
    ),
  );
}

// ---------- labels ----------
function addLabel(l: LabelSpec & { world?: THREE.Vector3 }): void {
  assertMounted(S);
  S.labels.append(l.el);
  l.el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    openMenu(ev, labelPick(l as Label));
  });
  if (l.kind === 'branch' || l.kind === 'agent') {
    l.el.addEventListener('pointerenter', () => S && (S.hover = hoverFor(labelPick(l as Label))));
    l.el.addEventListener('pointerleave', () => S && (S.hover = null));
  }
  l.world = new THREE.Vector3();
  S.labelEls.push(l as Label);
}

// The connections a team (its card or platform) or an agent (its chip or desk) uses.
function hoverFor(p: MapPick | null): Hover | null {
  if (!S || !p) return null;
  if (p.type === 'branch') {
    const b = S.branches.get(p.id);
    if (!b) return null;
    return { links: b.links, nodes: new Set(S.nodes.filter((n) => n.wfId === p.id)) };
  }
  if (p.type === 'agent') {
    const nodes = (p.wf ? S.nodes : S.benchNodes || []).filter((n): n is AgentNode => n.kind === 'agent' && n.agentId === p.id && (!p.wf || ((n as PodNode).wfId === p.wf && (p.step == null || n.index === p.step))));
    if (!nodes.length) return null;
    const links = new Set<string>();
    for (const n of nodes) n.links.forEach((l) => links.add(l));
    return { links, nodes: new Set(nodes) };
  }
  return null;
}

// A header tile (program, service, MCP server, Claude connector): the agents whose wires run to it.
function hoverForLink(intId: string): Hover | null {
  if (!S) return null;
  const nodes = [...S.nodes, ...(S.benchNodes || [])].filter((n) => n.links.has(intId));
  const agents = new Set(nodes.filter((n): n is AgentNode => n.kind === 'agent').map((n) => n.agentId));
  return { links: new Set([intId]), nodes: new Set(nodes), agents, only: true, color: intInfo(intId)?.color };
}

// An AI engine (top right): the agents that run on it, with their wires to its tile.
const ENGINE_TILES = ['claude', 'codex', 'hermes', 'openrouter', 'lmstudio', 'ollama'];
function hoverForEngine(uses: (a: Agent) => boolean, brain: boolean, color: string): Hover | null {
  if (!S) return null;
  const ids = new Set((state.data?.agents || []).filter(uses).map((a) => a.id));
  const nodes = [...S.nodes, ...(S.benchNodes || [])].filter((n): n is AgentNode => n.kind === 'agent' && ids.has(n.agentId));
  const links = new Set<string>();
  for (const n of nodes) for (const l of n.links) if (ENGINE_TILES.includes(l)) links.add(l);
  return { links, nodes: new Set(nodes), agents: ids, only: true, brain, color };
}

// Mark what the hover lights: agent chips, team cards, the Brain; the rest fades (CSS does the look).
function applyHover(): void {
  if (!S || S.hoverShown === S.hover) return;
  S.hoverShown = S.hover;
  const f = S.hover;
  const lit = f?.agents;
  S.labels.classList.toggle('focus', !!lit);
  const teamsLit = new Set<string>();
  if (lit) for (const w of S.workflows) if ((w.members || []).some((id) => lit.has(id))) teamsLit.add(w.id);
  for (const l of S.labelEls) {
    const on = !!lit && ((l.kind === 'agent' && lit.has(l.id)) || (l.kind === 'branch' && teamsLit.has(l.id)) || (l.kind === 'brain' && !!f?.brain));
    l.el.classList.toggle('hot', on);
  }
  const c = new THREE.Color(f?.color || '#c4ff3d');
  for (const d of S.desks) d.focusRing.material.color.copy(c);
}

const v3 = new THREE.Vector3();
const v3b = new THREE.Vector3();
function placeLabels(): void {
  assertMounted(S);
  const z = S.cam.zoom;
  const pxPerUnit = S.h / (S.cam.view / z);
  for (const l of S.labelEls) {
    l.obj.getWorldPosition(l.world);
    v3.copy(l.world).add(l.offset).project(S.camera);
    const x = (v3.x + 1) * 0.5 * S.w;
    const y = (1 - v3.y) * 0.5 * S.h;
    const off = x < -200 || x > S.w + 200 || y < -200 || y > S.h + 200;
    const hide = !!S.labelHidden?.has(`${l.kind}:${l.id}`) || off || ((l.kind === 'agent' || l.kind === 'step') && z < 0.6) || (l.kind === 'int' && z < 0.5);
    const shown = (l.shown ||= { display: '', transform: '', origin: '' });
    const display = hide ? 'none' : '';
    if (shown.display !== display) l.el.style.display = shown.display = display;
    const sc = l.kind === 'branch' || l.kind === 'bench' ? Math.min(1.1, Math.max(0.5, (16 * pxPerUnit) / 214)) : 1;
    let tx = -50;
    let ty = -50;
    if (l.from && !hide) {
      // which way is the anchor from the pod's centre on screen? the card sits on that side
      l.from.getWorldPosition(v3b);
      v3b.project(S.camera);
      const dx = x - (v3b.x + 1) * 0.5 * S.w;
      const dy = y - (1 - v3b.y) * 0.5 * S.h;
      if (Math.abs(dx) >= Math.abs(dy) * 0.6) tx = dx < 0 ? -100 : 0;
      else ty = dy < 0 ? -100 : 0;
      const origin = `${-tx}% ${-ty}%`;
      if (shown.origin !== origin) l.el.style.transformOrigin = shown.origin = origin;
    }
    if (!hide) {
      const transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${tx}%, ${ty}%) scale(${sc.toFixed(3)})`;
      if (shown.transform !== transform) l.el.style.transform = shown.transform = transform;
    }
  }
  S.labels.dataset.zoom = z > 1.6 ? 'near' : z < 0.75 ? 'far' : 'mid';
}

// ---------- animation ----------
// The most pixels drawn per screen pixel: the quality's limit, never more than the screen has.
const pixelRatioFor = (max: number): number => Math.min(window.devicePixelRatio || 1, max);

function loop(): void {
  if (!S?.alive) return;
  requestAnimationFrame(loop);
  // Station quality (Settings > Look): skip frames to stay at its frame rate. Fewer while nothing moves
  // and while the window is in the back; all of them while you move around the map.
  const level = stationLevel(currentLook().station);
  const now = performance.now();
  const moving = !!S.cam.goal || !!S.fileDrag || now - (S.lastInput || 0) < 1500;
  const fps = !document.hasFocus() ? level.fps.away : moving ? level.fps.moving : level.fps.still;
  // (a frame early by a couple of ms still counts, or 60 a second on a 60 Hz screen would drop to 30)
  if (fps && now - (S.lastFrame || 0) < 1000 / fps - 3) return;
  S.lastFrame = now;
  S.frameAim = fps ? 1000 / fps : 0;
  S.frames = (S.frames || 0) + 1;
  const ratio = pixelRatioFor(level.pixelRatio);
  if (S.renderer.getPixelRatio() !== ratio) {
    S.renderer.setPixelRatio(ratio);
    resize();
  }
  // (longer steps at a low frame rate; a cap so coming back to the tab doesn't jump)
  const dt = Math.min(S.clock.getDelta(), 0.15);
  const t = S.clock.elapsedTime;
  const d = state.data;
  const busy = (d?.runs?.length || 0) + S.active.size;
  // smooth camera moves
  const goal = S.cam.goal;
  if (goal) {
    const k = 1 - Math.pow(0.0015, dt);
    S.cam.target.lerp(goal.target, k);
    S.cam.zoom += (goal.zoom - S.cam.zoom) * k;
    if (S.cam.target.distanceTo(goal.target) < 0.02 && Math.abs(goal.zoom - S.cam.zoom) < 0.002) S.cam.goal = null;
    updateCamera();
  }
  const b = S.brain;
  b.cloud.rotation.y += dt * (0.15 + Math.min(busy, 4) * 0.25);
  b.ico.rotation.y -= dt * 0.1;
  b.ico.rotation.x += dt * 0.05;
  const pulse = 0.5 + 0.5 * Math.sin(t * (busy ? 4 : 1.4));
  b.halo.material.opacity = 0.45 + pulse * (busy ? 0.45 : 0.15);
  b.halo.scale.setScalar(10 + pulse * (busy ? 3 : 1));
  b.beam.material.opacity = 0.1 + (busy ? 0.12 + pulse * 0.12 : 0.04);
  b.star.scale.setScalar(5 + pulse * (busy ? 3 : 0.8));
  b.light.intensity = 25 + pulse * (busy ? 40 : 8);
  // files held over the Brain: it opens up to take them
  if (S.fileDrag === 'brain') {
    const grab = 0.5 + 0.5 * Math.sin(t * 7);
    b.halo.material.opacity = 0.95;
    b.halo.scale.setScalar(15 + grab * 2.5);
    b.light.intensity = 90 + grab * 30;
    b.cloud.rotation.y += dt * 1.6;
  }
  if (b.logo) {
    // floats and breathes inside the globe; a little livelier while agents work
    b.logo.position.y = 3.2 + Math.sin(t * 1.1) * 0.16;
    const base = b.logo.userData.base as THREE.Vector3;
    const k = 1 + Math.sin(t * (busy ? 3.2 : 1.6)) * (busy ? 0.05 : 0.025);
    b.logo.scale.set(base.x * k, base.y * k, 1);
    b.logo.material.rotation = Math.sin(t * 0.5) * 0.06;
  }
  for (const o of S.spinners) o.rotation.y += dt * 0.9;
  if (b.model) {
    // the 3D model turns slowly and floats a little, livelier while agents work
    b.model.rotation.y += dt * (busy ? 0.9 : 0.4);
    b.model.position.y = 3.2 + Math.sin(t * 1.1) * 0.12;
  }

  // desks of the agents a hovered tile or engine lights (fade in and out)
  const lit = S.hover?.agents;
  for (const desk of S.desks) {
    const want = lit?.has(desk.agent.id) ? 0.85 + 0.15 * Math.sin(t * 5) : 0;
    const m = desk.focusRing.material;
    m.opacity += (want - m.opacity) * Math.min(1, dt * 10);
    desk.focusRing.visible = m.opacity > 0.01;
  }
  // a desk's screen animates only when it is on screen and big enough to see
  const screenPx = 1.58 * (S.h / (S.cam.view / S.cam.zoom));
  const screensShow = screenPx >= level.screenPx;
  const onScreen = (desk: Desk) => {
    desk.group.getWorldPosition(v3).project(S!.camera);
    return Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
  };
  for (const desk of S.desks) {
    if (desk.status === 'working') {
      desk.person.position.y = Math.abs(Math.sin(t * 6 + desk.agent.id.length)) * 0.06;
      desk.orb.scale.setScalar(1 + 0.35 * Math.sin(t * 5));
      desk.orbGlow.material.opacity = 0.5 + 0.3 * Math.sin(t * 5);
      desk.orbGlow.visible = true;
      if (screensShow && (!desk.lastDraw || t - desk.lastDraw > 0.35) && onScreen(desk)) {
        desk.lastDraw = t;
        drawScreen(desk, t);
      }
    } else if (desk.status === 'needs') {
      const on = Math.sin(t * 8) > 0;
      if (screensShow && (!desk.lastDraw || t - desk.lastDraw > 0.5) && onScreen(desk)) {
        desk.lastDraw = t;
        drawScreen(desk, t);
      }
      desk.orb.scale.setScalar(on ? 1.5 : 1);
      desk.orbGlow.material.opacity = on ? 0.9 : 0.2;
      desk.orbGlow.visible = true;
      desk.person.position.y = 0;
    } else {
      desk.orb.scale.setScalar(1);
      desk.orbGlow.material.opacity = 0;
      desk.orbGlow.visible = false;
      desk.person.position.y = 0;
    }
  }
  for (const node of S.nodes) {
    if (node.runStatus === 'running' || node.runStatus === 'needs-you') {
      const ring = node.kind === 'agent' ? node.desk.ring : node.ring;
      ring.scale.setScalar(1 + 0.08 * Math.sin(t * 5));
    }
  }
  for (const n of S.intNodes.values()) {
    if (n.flash > 0) n.flash = Math.max(0, n.flash - dt * 0.8);
    n.glow.material.opacity = (n.it.live ? 0.3 : 0.08) + n.flash * 0.6;
    n.glow.scale.setScalar(6 + n.flash * 4);
  }
  for (const c of S.curves) {
    if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 0.6);
    c.line.material.opacity = c.base + c.flash * 0.6;
  }
  for (const [id, br] of S.branches) {
    const live = S.active.has(id) || br.nodes.some((n) => n.kind === 'agent' && n.desk.status !== 'idle') || (S.teamState?.[id]?.working || []).length > 0;
    if (br.flash > 0) br.flash = Math.max(0, br.flash - dt * 0.9);
    for (const r of br.rails) r.material.opacity = live ? Math.min(1, r.base + 0.35 + 0.2 * Math.sin(t * 6)) : r.base + br.flash * 0.4;
    if (br.hub) {
      br.hub.holo.rotation.z += dt * (live ? 1.6 : 0.35);
      br.hub.holo2.rotation.x += dt * (live ? 2.2 : 0.5);
      br.hub.hubGlow.material.opacity = 0.35 + (live ? 0.25 + 0.15 * Math.sin(t * 5) : 0) + br.flash * 0.5;
      br.hub.hubGlow.scale.setScalar(4.5 + br.flash * 3 + (live ? Math.sin(t * 5) * 0.4 : 0));
    }
  }
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i];
    p.t += dt * p.speed;
    if (p.t > 1) {
      if (p.loop) p.t -= 1;
      else {
        (p.parent || S.world!).remove(p.sprite);
        p.sprite.material.dispose();
        S.particles.splice(i, 1);
        continue;
      }
    }
    p.sprite.visible = p.t >= 0;
    if (p.t >= 0) p.sprite.position.copy(p.path(p.t));
  }
  // the wires measure the header tiles before the labels move (measuring after a move makes the
  // browser lay the page out again in the middle of the frame)
  drawWires(dt);
  placeLabels();
  S.worldLayer?.update();
  renderStation();
}

// The dashed wires: header tile (top) to the desk or pedestal (in the map), as SVG curves.
const SVGNS = 'http://www.w3.org/2000/svg';
/** The length of one dash and its gap on a wire (the wire's dash pattern is "3 4"). */
const DASH_PERIOD = 7;
const REDUCED_MOTION = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// The dashed wires are drawn on the map's own canvas, in screen pixels, after the map. They used to be SVG
// paths, and the flowing dashes made the browser paint every dash of every wire again each frame: with a few
// dozen teams that took a whole processor core and halved the frame rate even on a fast PC. Here each wire is
// a strip of triangles and the dashes are worked out per pixel on the graphics card. Same look: dashes 3 px on,
// 4 off, flowing at each wire's own speed, soft edges.
interface WireBatch {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  /** per corner: x, y (CSS px), distance along the wire, flow | colour and opacity | across the wire (px), half the width */
  a0: THREE.BufferAttribute;
  a1: THREE.BufferAttribute;
  a2: THREE.BufferAttribute;
  cap: number;
  n: number;
  dirty1: boolean;
  dirty2: boolean;
}
const WIRE_STEPS = 24;
const WIRE_CORNERS = (WIRE_STEPS + 1) * 2;
const WIRE_VERTEX = `
attribute vec4 a0;
attribute vec4 a1;
attribute vec2 a2;
uniform vec2 size;
varying float vDist;
varying float vY;
varying vec4 vTint;
varying vec2 vEdge;
void main() {
  vDist = a0.z - a0.w;
  vY = a0.y;
  vTint = a1;
  vEdge = a2;
  gl_Position = vec4(a0.x / size.x * 2.0 - 1.0, 1.0 - a0.y / size.y * 2.0, 0.0, 1.0);
}`;
const WIRE_FRAGMENT = `
uniform vec2 size;
uniform float reveal;
varying float vDist;
varying float vY;
varying vec4 vTint;
varying vec2 vEdge;
void main() {
  if (vY > reveal * size.y) discard;
  // the dash: on for 3 px of every 7, with half a pixel of softening at its ends
  float d = mod(vDist, 7.0);
  float dash = max(clamp(min(d + 0.5, 3.5 - d), 0.0, 1.0), clamp(d - 6.5, 0.0, 1.0));
  // and the edges across the wire
  float edge = clamp(vEdge.y + 0.5 - abs(vEdge.x), 0.0, 1.0);
  float a = vTint.a * dash * edge;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vTint.rgb, a);
  #include <colorspace_fragment>
}`;

function wireBatch(cap: number): WireBatch {
  const geo = new THREE.BufferGeometry();
  const attr = (k: number) => new THREE.BufferAttribute(new Float32Array(cap * WIRE_CORNERS * k), k).setUsage(THREE.DynamicDrawUsage);
  const a0 = attr(4);
  const a1 = attr(4);
  const a2 = attr(2);
  geo.setAttribute('a0', a0);
  geo.setAttribute('a1', a1);
  geo.setAttribute('a2', a2);
  // two corners per point along a wire, two triangles per step
  const idx = new Uint32Array(cap * WIRE_STEPS * 6);
  for (let w = 0, i = 0; w < cap; w++)
    for (let k = 0; k < WIRE_STEPS; k++) {
      const v = w * WIRE_CORNERS + k * 2;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i);
      i += 6;
    }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({ uniforms: { size: { value: new THREE.Vector2(1, 1) }, reveal: { value: 1 } }, vertexShader: WIRE_VERTEX, fragmentShader: WIRE_FRAGMENT, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }); // (screen y runs down, so the triangles face away)
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // over the map, like the SVG was
  mesh.raycast = () => {}; // never picked
  return { mesh, geo, a0, a1, a2, cap, n: 0, dirty1: true, dirty2: true };
}

const wireColor = new THREE.Color();

/** Adds one wire: the curve (start, two control points, end), colour, opacity, width and how far its dashes have flowed. */
function addWire(b: WireBatch, c: number[], color: string, opacity: number, width: number, flow: number): void {
  const w = b.n++;
  const p0 = b.a0.array as Float32Array;
  const p1 = b.a1.array as Float32Array;
  const p2 = b.a2.array as Float32Array;
  wireColor.set(color);
  const half = width / 2;
  const pad = half + 1;
  // the points along the curve
  const pts: number[] = [];
  for (let k = 0; k <= WIRE_STEPS; k++) {
    const t = k / WIRE_STEPS;
    const u = 1 - t;
    pts.push(u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6], u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7]);
  }
  let dist = 0;
  for (let k = 0; k <= WIRE_STEPS; k++) {
    const x = pts[k * 2];
    const y = pts[k * 2 + 1];
    if (k > 0) dist += Math.hypot(x - pts[k * 2 - 2], y - pts[k * 2 - 1]);
    // across the wire: square to the curve here (from the points either side)
    const a = Math.max(0, k - 1);
    const z = Math.min(WIRE_STEPS, k + 1);
    let dx = pts[z * 2] - pts[a * 2];
    let dy = pts[z * 2 + 1] - pts[a * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    for (const side of [1, -1]) {
      const v = w * WIRE_CORNERS + k * 2 + (side > 0 ? 0 : 1);
      p0.set([x - dy * pad * side, y + dx * pad * side, dist, flow], v * 4);
      // colour and width are sent again only when they change
      if (p1[v * 4] !== wireColor.r || p1[v * 4 + 1] !== wireColor.g || p1[v * 4 + 2] !== wireColor.b || p1[v * 4 + 3] !== opacity) {
        p1.set([wireColor.r, wireColor.g, wireColor.b, opacity], v * 4);
        b.dirty1 = true;
      }
      if (p2[v * 2] !== pad * side || p2[v * 2 + 1] !== half) {
        p2.set([pad * side, half], v * 2);
        b.dirty2 = true;
      }
    }
  }
}

/** How much of the wires shows while the floor changes, from the top (1: all of them). */
function wireReveal(): number {
  const r = S?.wireReveal;
  if (!r) return 1;
  const k = Math.min(1, Math.max(0, (performance.now() - r.at - r.delay) / r.ms));
  const eased = k * k * (3 - 2 * k);
  // done (or a floor change that never came back in: show them again rather than keep them hidden)
  if ((k >= 1 && r.to === 1) || performance.now() - r.at > 4000) S!.wireReveal = undefined;
  return r.from + (r.to - r.from) * eased;
}

function drawWires(dt: number): void {
  assertMounted(S);
  // nothing hovered: the combined wires (one per team); hovering: every desk's own wire
  const links = (S.hover ? S.links2d : S.links2dAll) || S.links2d || [];
  const rootBox = S.root.getBoundingClientRect();
  const bar = S.hudTop?.querySelector('.st-connected')?.getBoundingClientRect();
  // each tile measured once, before anything below changes the page (many wires share a tile)
  const boxes = new Map<string, DOMRect | undefined>();
  for (const l of links) if (!boxes.has(l.intId)) boxes.set(l.intId, S.tileEls?.get(l.intId)?.getBoundingClientRect());
  // room for every wire (a bigger batch when there are more)
  if (!S.wireBatch || S.wireBatch.cap < links.length) {
    const old = S.wireBatch;
    if (old) {
      S.scene.remove(old.mesh);
      old.geo.dispose();
      (old.mesh.material as THREE.Material).dispose();
    }
    S.wireBatch = wireBatch(Math.max(64, links.length * 2));
  }
  const wb = S.wireBatch;
  if (!wb.mesh.parent) S.scene.add(wb.mesh);
  wb.n = 0;
  // a hovered team or agent: light only its tiles and wires
  const focus = S.hover;
  applyHover();
  S.hudTop?.querySelector('.st-connected')?.classList.toggle('focus', !!focus);
  // hovering a tile or an engine: the other tiles stay readable (only a light dim)
  S.hudTop?.querySelector('.st-connected')?.classList.toggle('soft', !!focus?.only);
  S.tileEls?.forEach((el, id) => el.classList.toggle('hot', !!focus?.links.has(id)));
  const ends: (number[] | null)[] = [];
  const motion = !REDUCED_MOTION();
  const zoom = uiZoom();
  links.forEach((l) => {
    assertMounted(S);
    const tile = S.tileEls?.get(l.intId);
    const r = boxes.get(l.intId);
    const visible = r && r.width && bar && r.left >= bar.left - 2 && r.right <= bar.right + 2;
    if (!visible) {
      ends.push(null);
      return;
    }
    // (the tile's box is measured on screen, already scaled by the interface scale in Settings; the wire is drawn inside the scaled page, so it is scaled again: divide it back out)
    const x1 = (r.left + r.width / 2 - rootBox.left) / zoom;
    const y1 = (r.bottom - rootBox.top) / zoom + 2;
    if (l.node) {
      l.node.obj.getWorldPosition(v3);
      v3.y += l.node.kind === 'agent' ? 2.3 : 1.3;
    } else {
      l.anchor!.getWorldPosition(v3);
      v3.y += l.lift || 1.5;
    }
    v3.project(S.camera);
    const x2 = (v3.x + 1) * 0.5 * S.w;
    const y2 = (1 - v3.y) * 0.5 * S.h;
    const dy = Math.max(60, (y2 - y1) * 0.55);
    const c = [x1, y1, x1, y1 + dy, x2, y2 - dy * 0.6, x2, y2];
    ends.push(c);
    if (l.flash > 0) l.flash = Math.max(0, l.flash - dt * 0.7);
    const info = intInfo(l.intId);
    const mine = !!l.node && !!focus?.nodes.has(l.node) && (!focus.only || focus.links.has(l.intId));
    // a combined wire is a little thicker the more agents it stands for
    const weight = l.members ? Math.min(1.6, (l.members.length - 1) * 0.3) : 0;
    const live = focus && !mine ? 0.03 : tile!.classList.contains('off') ? 0.12 : mine ? 0.7 : 0.32;
    const color = info?.color || '#8f968a';
    const opacity = Math.min(1, live + l.flash * 0.6);
    const width = (mine ? 1.5 : 1) + weight + l.flash * 1.2;
    // the dashes flow down from the program to the agents; faster on the wires you are looking at or that just carried a call,
    // and not at all for a program that is off (nothing flows from it) or when motion is switched off
    const flowing = motion && !tile!.classList.contains('off') && !(focus && !mine);
    const goal = flowing ? 11 + (mine ? 16 : 0) + l.flash * 40 : 0;
    // ease toward the goal speed, so hovering or a call lighting a wire speeds it up and slows it down smoothly
    l.speed = (l.speed ?? goal) + (goal - (l.speed ?? goal)) * Math.min(1, dt * 5);
    l.flow = ((l.flow || 0) + dt * l.speed) % DASH_PERIOD;
    addWire(wb, c, color, opacity, width, l.flow);
  });
  wb.geo.setDrawRange(0, wb.n * WIRE_STEPS * 6);
  wb.a0.needsUpdate = true;
  if (wb.dirty1) wb.a1.needsUpdate = true;
  if (wb.dirty2) wb.a2.needsUpdate = true;
  wb.dirty1 = wb.dirty2 = false;
  const u = (wb.mesh.material as THREE.ShaderMaterial).uniforms;
  (u.size.value as THREE.Vector2).set(S.w, S.h);
  u.reveal.value = wireReveal();
  // light running down a wire
  const dotsLayer = S.wireDots;
  S.dots = S.dots.filter((d) => (d.t += dt * 0.9) <= 1);
  while (dotsLayer.childNodes.length < S.dots.length) {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('r', '3');
    dotsLayer.append(c);
  }
  while (dotsLayer.childNodes.length > S.dots.length) dotsLayer.lastChild!.remove();
  S.dots.forEach((d, i) => {
    const el = dotsLayer.childNodes[i] as SVGCircleElement;
    const c = ends[links.indexOf(d.link)];
    if (!c || d.t < 0) return el.setAttribute('opacity', '0');
    const t = d.t;
    const u = 1 - t;
    const bx = u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6];
    const by = u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7];
    el.setAttribute('cx', bx.toFixed(1));
    el.setAttribute('cy', by.toFixed(1));
    el.setAttribute('fill', intInfo(d.link.intId)?.color || '#fff');
    el.setAttribute('opacity', '0.95');
  });
}

// ---------- controls ----------
type DragMode = 'spin' | 'branch' | 'rotate' | 'agent' | 'pan' | 'bench';
interface Drag {
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  shift: boolean;
  pick: MapPick | null;
  mode: DragMode | null;
  grab?: THREE.Vector3;
}
function setupControls(): void {
  assertMounted(S);
  const elc = S.renderer.domElement;
  let drag: Drag | null = null;
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const setMouse = (e: MouseEvent) => {
    const r = elc.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, S!.camera);
  };
  const pick = (e: MouseEvent): MapPick | null => {
    setMouse(e);
    const hits = ray.intersectObjects(S!.scene.children, true).filter((x) => x.object.userData.pick && shownOnMap(x.object) && !(x.object instanceof THREE.Points) && !(x.object instanceof THREE.Line) && !x.object.userData.dragging);
    return ((hits.find((x) => (x.object.userData.pick as MapPick).type === 'agent') || hits[0])?.object.userData.pick as MapPick | undefined) || null;
  };
  const ground = (e: MouseEvent) => {
    setMouse(e);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  };
  // files dragged in from the desktop: only the Brain takes them
  const onBrain = (e: DragEvent) => pick(e)?.type === 'brain';
  elc.addEventListener('dragenter', (e) => mapDragOver(e, onBrain(e)));
  elc.addEventListener('dragover', (e) => mapDragOver(e, onBrain(e)));
  elc.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (onBrain(e)) brainDrop(e);
    else setFileDrag(null);
  });
  S.root.addEventListener('dragleave', (e) => !S?.root.contains(e.relatedTarget as Node | null) && setFileDrag(null));
  // dropped anywhere on the Station (a panel, the header): the hint goes
  S.root.addEventListener('drop', () => setFileDrag(null), true);
  elc.addEventListener('contextmenu', (e) => e.preventDefault());
  elc.addEventListener('pointerleave', () => S && (S.hover = null));
  elc.addEventListener('pointerdown', (e) => {
    closeMenu();
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, shift: e.shiftKey, pick: pick(e), mode: null };
    S!.cam.goal = null;
    elc.setPointerCapture(e.pointerId);
  });
  elc.addEventListener('pointermove', (e) => {
    assertMounted(S);
    if (!drag) {
      const p = pick(e);
      S.hover = hoverFor(p);
      elc.style.cursor = p ? (p.type === 'agent' || p.type === 'bench' || (p.type === 'branch' && p.step == null) ? 'grab' : 'pointer') : 'default';
      elc.title = p?.type === 'branch' ? 'Drag to move the team · Shift+drag to spin it · right-click for more' : '';
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    // decide what this drag does once the mouse has really moved
    if (!drag.mode && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) {
      const p = drag.pick;
      if (drag.button !== 2 && p?.type === 'branch' && p.step == null && S.branches.get(p.id)) {
        const b = S.branches.get(p.id)!;
        const g = ground(e);
        drag.mode = drag.shift ? 'spin' : 'branch';
        drag.grab = g ? b.group.position.clone().sub(g.setY(0)) : new THREE.Vector3();
      } else if (drag.button === 2 || drag.shift) drag.mode = 'rotate';
      else if (p?.type === 'agent') drag.mode = startAgentDrag(p, e.ctrlKey) ? 'agent' : 'pan';
      else if (p?.type === 'bench' && S.bench) {
        const g = ground(e);
        drag.mode = 'bench';
        drag.grab = g ? S.bench.position.clone().sub(g.setY(0)) : new THREE.Vector3();
      }
      else drag.mode = 'pan';
    }
    if (drag.mode === 'rotate') {
      S.cam.az -= dx * 0.005;
      updateCamera();
    } else if (drag.mode === 'pan') {
      const k = S.cam.view / S.cam.zoom / S.h;
      const right = new THREE.Vector3().setFromMatrixColumn(S.camera.matrix, 0);
      const fwd = new THREE.Vector3(-Math.sin(S.cam.az), 0, -Math.cos(S.cam.az));
      S.cam.target.addScaledVector(right, -dx * k).addScaledVector(fwd, (dy * k) / Math.sin(S.cam.el));
      updateCamera();
    } else if (drag.mode === 'branch') {
      const g = ground(e);
      if (g) moveBranch(drag.pick!.id!, g.setY(0).add(drag.grab!));
    } else if (drag.mode === 'spin') {
      spinBranch(drag.pick!.id!, dx * 0.012);
    } else if (drag.mode === 'agent') {
      const g = ground(e);
      if (g) moveAgentDrag(g, e);
    } else if (drag.mode === 'bench') {
      const g = ground(e);
      if (g) {
        S.bench!.position.copy(g.setY(0).add(drag.grab!));
        S.benchCenter = S.bench!.position.clone();
      }
    }
    if (drag.mode) elc.style.cursor = 'grabbing';
  });
  elc.addEventListener('pointerup', (e) => {
    assertMounted(S);
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.mode) {
      if (d.button === 2) openMenu(e, d.pick);
      else choose(d.pick);
    } else if (d.mode === 'branch' || d.mode === 'spin') saveBranchPlace(d.pick!.id!);
    else if (d.mode === 'agent') dropAgent();
    else if (d.mode === 'bench' && S.bench) saveLayout({ bench: { x: +S.bench.position.x.toFixed(2), z: +S.bench.position.z.toFixed(2) } });
  });
  elc.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e);
    },
    { passive: false },
  );
  S.onKey = (e) => {
    assertMounted(S);
    if ((e.target as Element).closest?.('input, textarea, select')) return;
    // Esc closes the Station's own menu or panel; with nothing open, app.ts opens the big sidebar
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return; // a dialog or the Brain chat took it
      if (S.menuView?.isOpen()) {
        closeMenu();
        e.preventDefault();
      } else if (S.selected) {
        choose(null);
        e.preventDefault();
      }
    }
    // Up / Down: the previous / next project (floor). Only here on the Station, and not while a dialog or menu is open.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.isComposing) {
      const t = e.target as Element;
      if ((t === document.body || t.closest?.('.st-root')) && !document.querySelector('.modal-back, .model-menu, .proj-menu')) {
        e.preventDefault();
        stepFloor(e.key === 'ArrowDown' ? 1 : -1);
      }
    }
    if (e.key === '+' || e.key === '=') zoomAt(1.25);
    if (e.key === '-') zoomAt(0.8);
    if (e.key === '0') resetView();
  };
  window.addEventListener('keydown', S.onKey);
  S.onDocDown = (e) => {
    if (S?.menuView?.isOpen() && !S.menuView.contains(e.target as Node)) closeMenu();
  };
  document.addEventListener('pointerdown', S.onDocDown, true);
  // files pasted on the Station (not into a box, and not taken by a chat): they go to the Brain
  S.onPaste = (e) => {
    if (e.defaultPrevented || document.querySelector('.modal-back') || (e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return;
    const files = filesFromPaste(e.clipboardData);
    if (!files) return;
    e.preventDefault();
    void files.then((picked) => {
      if (!picked.length) return;
      attachToBrain(picked);
      pulseBrain();
    });
  };
  document.addEventListener('paste', S.onPaste);
}

// ---------- files dropped on the Brain ----------
// While files are over the map: a hint says where to drop them, and the Brain glows when they are over it.
function setFileDrag(mode: 'map' | 'brain' | null): void {
  if (!S || S.fileDrag === mode) return;
  S.fileDrag = mode;
  S.labels.querySelector('.st-brain-label')?.classList.toggle('att-target', mode === 'brain');
  if (!mode) {
    S.dropHint?.remove();
    S.dropHint = null;
    return;
  }
  if (!S.dropHint) {
    S.dropHint = h('div', {
      class: 'absolute left-1/2 bottom-21 [transform:translateX(-50%)] z-30 flex items-center gap-2 py-2.25 px-3.5 pointer-events-none bg-glass-strong border border-line-2 rounded-[999px] text-dim font-mono text-[11px] leading-[normal] font-semibold tracking-[0.08em] uppercase animate-[fade_0.15s_ease-out] [&.on]:text-accent [&.on]:border-accent',
    });
    S.root.append(S.dropHint);
  }
  S.dropHint.classList.toggle('on', mode === 'brain');
  mount(S.dropHint, icon(mode === 'brain' ? 'brain' : 'upload', 15), mode === 'brain' ? 'Let go to give these to the Brain' : 'Drop the files on the Brain');
}

function mapDragOver(e: DragEvent, overBrain: boolean): void {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = overBrain ? 'copy' : 'none';
  setFileDrag(overBrain ? 'brain' : 'map');
}

function brainDragOver(e: DragEvent): void {
  if (!hasFiles(e)) return;
  e.stopPropagation();
  mapDragOver(e, true);
}

// They upload into the Brain folder and the Brain chat opens with them attached, ready for what to do with them.
function brainDrop(e: DragEvent): void {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.stopPropagation();
  setFileDrag(null);
  void filesFromDrop(e.dataTransfer!).then((picked) => {
    if (!picked.length) return;
    attachToBrain(picked);
    pulseBrain();
  });
}

// A quick burst of light from the Brain out to every team: it took something in.
function pulseBrain(): void {
  if (!S) return;
  for (const id of S.branches.keys()) pulseAlong(id, 0, 1, 3);
}

// ---------- moving teams ----------
function moveBranch(wfId: string, at: THREE.Vector3): void {
  assertMounted(S);
  const b = S.branches.get(wfId);
  if (!b) return;
  // keep clear of the Brain
  const minR = 6 + b.radius;
  if (at.length() < minR) at.setLength(minR);
  b.group.position.copy(at);
  b.moved = true;
  updateLink(b);
}
function spinBranch(wfId: string, by: number): void {
  assertMounted(S);
  const b = S.branches.get(wfId);
  if (!b) return;
  b.spin = (b.spin || 0) + by;
  b.group.rotation.y = -b.spin;
  b.moved = true;
  for (const d of S.desks) if (d.wfId === wfId) d.branchAngle = b.spin;
  updateCamera();
}
async function saveBranchPlace(wfId: string): Promise<void> {
  assertMounted(S);
  const b = S.branches.get(wfId);
  const wf = S.workflows.find((w) => w.id === wfId);
  if (!b || !wf || !b.moved) return;
  b.moved = false;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  await saveWorkflow({ ...wf, pos: { x: r3(b.group.position.x), z: r3(b.group.position.z) }, rot: r3(b.spin || 0) });
}

async function saveLayout(patch: StationLayout): Promise<void> {
  assertMounted(S);
  S.layout = { ...(S.layout || {}), ...patch };
  await attempt(() => PUT('/layout', patch));
}


// ---------- moving agents ----------
function startAgentDrag(p: MapPick, copy = false): boolean {
  assertMounted(S);
  const desk = S.desks.find((d) => d.agent.id === p.id && (p.wf ? d.wfId === p.wf && d.stepIndex === p.step : !d.wfId));
  if (!desk) return false;
  const marker = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.09, 8, 48), new THREE.MeshBasicMaterial({ color: 0xc4ff3d, transparent: true, opacity: 0 }));
  marker.rotation.x = Math.PI / 2;
  S.world!.add(marker);
  const hint = h('div', { class: 'absolute left-0 top-0 z-20 pointer-events-none py-1.25 px-2.25 whitespace-nowrap bg-[rgba(13,16,13,0.95)] border border-accent-dim font-mono text-[11px] leading-[normal] font-semibold text-accent' });
  S.root.append(hint);
  desk.group.traverse((o) => (o.userData.dragging = true));
  S.agentDrag = { desk, home: desk.group.position.clone(), marker, hint, target: null, copy };
  return true;
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

function moveAgentDrag(g: THREE.Vector3, e: MouseEvent): void {
  assertMounted(S);
  const st = S.agentDrag;
  if (!st) return;
  const local = st.desk.group.parent!.worldToLocal(g.clone());
  st.desk.group.position.set(local.x, 1.4, local.z);
  // which team pod is under the mouse?
  let target: DropTarget | null = null;
  for (const [id, b] of S.branches) {
    const c = b.group.position;
    if (Math.hypot(c.x - g.x, c.z - g.z) < b.radius + 1.2) {
      target = { wfId: id, at: c.clone(), radius: b.radius };
      break;
    }
  }
  if (!target && S.benchCenter && st.desk.wfId && g.distanceTo(S.benchCenter) < 7) target = { bench: true, at: S.benchCenter.clone(), radius: 2 };
  st.target = target;
  if (target) {
    st.marker.position.copy(target.at).setY(0.6);
    st.marker.scale.setScalar((target.radius + 0.6) / 2.1);
    st.marker.material.opacity = 0.9;
    st.marker.material.color.set(target.bench ? 0xf0b04a : 0xc4ff3d);
  } else st.marker.material.opacity = 0;
  const wf = target?.wfId ? S.workflows.find((w) => w.id === target.wfId) : null;
  const from = st.desk.wfId ? S.workflows.find((w) => w.id === st.desk.wfId) : null;
  const name = st.desk.agent.name;
  st.hint.textContent = !target
    ? 'Drop it on a team'
    : target.bench
      ? `Take ${name} off ${from?.name || 'its team'}`
      : wf!.id === from?.id
        ? `Already on ${wf!.name}`
        : (wf!.members || []).includes(st.desk.agent.id)
          ? `Already on ${wf!.name}`
          : from && !st.copy
            ? `Move to ${wf!.name} (hold Ctrl to keep it on ${from.name} too)`
            : `Add to ${wf!.name}`;
  const r = S.root.getBoundingClientRect();
  const z = uiZoom();
  st.hint.style.transform = `translate(${(e.clientX - r.left) / z + 16}px, ${(e.clientY - r.top) / z + 12}px)`;
}

async function dropAgent(): Promise<void> {
  assertMounted(S);
  const st = S.agentDrag;
  S.agentDrag = null;
  if (!st) return;
  st.marker.parent?.remove(st.marker);
  st.marker.geometry.dispose();
  st.hint.remove();
  st.desk.group.traverse((o) => delete o.userData.dragging);
  st.desk.group.position.copy(st.home);
  const t = st.target;
  if (!t) return;
  const agentId = st.desk.agent.id;
  const from = st.desk.wfId ? structuredClone(S.workflows.find((w) => w.id === st.desk.wfId)) : null;
  if (t.bench) {
    if (!from) return;
    setMembers(from, from.members.filter((x) => x !== agentId));
    await saveWorkflow(from);
    toast(`${st.desk.agent.name} left ${from.name}`);
    return;
  }
  if (from && t.wfId === from.id) return;
  const to = structuredClone(S.workflows.find((w) => w.id === t.wfId));
  if (!to || to.members.includes(agentId)) return;
  if (from && !st.copy) {
    setMembers(from, from.members.filter((x) => x !== agentId));
    await attempt(() => PUT(`/workflows/${from.id}`, teamBody(from)));
  }
  setMembers(to, [...to.members, agentId]);
  await saveWorkflow(to);
  toast(`${st.desk.agent.name} → ${to.name}`);
}

// ---------- right-click menu ----------
function closeMenu(): void {
  S?.menuView?.close();
}

function openMenu(e: MouseEvent, p: MapPick | null): void {
  assertMounted(S);
  closeMenu();
  const d = state.data!;
  const items: MenuEntry[] = [];
  const item = (label: string, run: () => unknown, cls = '', ico: string | null = null) => items.push({ kind: 'item', label, run, danger: cls === 'danger', ...(ico ? { icon: ico } : {}) });
  const head = (text: string) => items.push({ kind: 'head', text });
  const sep = () => items.push({ kind: 'sep' });
  const addStep = async (w: TeamView, a: Agent) => {
    const copy = structuredClone(w);
    copy.steps.push({ id: Math.random().toString(36).slice(2), type: 'agent', agentId: a.id, prompt: copy.steps.length ? 'Continue from this:\n{{prev}}' : '{{input}}' });
    await saveWorkflow(copy);
    toast(`${a.name} → ${w.name}`);
  };
  const newAgent = async () => {
    const a = await attempt(() => POST<Agent>('/agents', { name: 'New agent' }));
    if (a) navigate(`#/agents/${a.id}/edit`);
  };
  if (p?.type === 'agent') {
    const a = d.agents.find((x) => x.id === p.id);
    if (!a) return;
    head(`${a.emoji || ''} ${a.name}`);
    item('Chat', () => openChat('agent', a.id), '', 'message-square');
    item('Edit agent', () => navigate(`#/agents/${a.id}/edit`), '', 'pencil');
    if (a.engine !== 'openai') item('Open in terminal', () => openTerminal(a), '', 'terminal');
    item('Clone', () => cloneAgent(a), '', 'copy');
    item('Save as preset', () => presetAgent(a), '', 'bookmark-plus');
    const others = S.workflows.filter((w) => !w.steps.some((s) => s.type === 'agent' && s.agentId === a.id));
    if (others.length) {
      sep();
      for (const w of others.slice(0, 8)) item(`Add to ${w.name}`, () => addStep(w, a), '', 'plus');
    }
    const w = p.wf ? S.workflows.find((x) => x.id === p.wf) : null;
    if (w)
      item(`Remove from ${w.name}`, async () => {
        const copy = structuredClone(w);
        copy.steps = copy.steps.filter((s) => !(s.type === 'agent' && s.agentId === a.id));
        await saveWorkflow(copy);
      });
    sep();
    item(
      'Delete agent',
      async () => {
        if (!(await confirmBox(`Delete ${a.name}? It is also taken off every team.`, { ok: 'Delete', danger: true }))) return;
        await attempt(() => DEL(`/agents/${a.id}`), `Deleted ${a.name}`);
        choose(null);
        refreshSoon(0);
        reloadWorkflows();
      },
      'danger',
      'trash-2',
    );
  } else if (p?.type === 'branch') {
    const w = S.workflows.find((x) => x.id === p.id);
    if (!w) return;
    head(w.name);
    item('Open', () => choose({ type: 'branch', id: w.id }), '', 'maximize-2');
    item('Message the team', () => openChat('team', w.id), '', 'message-square');
    item('Edit in builder', () => openBranchBuilder({ wf: w, onSaved: reloadWorkflows }), '', 'workflow');
    item('Clone team', () => cloneTeam(w, false), '', 'copy');
    item('Clone with copies of its agents', () => cloneTeam(w, true), '', 'copy');
    item('Save as preset', () => presetTeam(w), '', 'bookmark-plus');
    item('Rename', async () => {
      const name = await promptBox('Rename team', { value: w.name });
      if (name?.trim()) await saveWorkflow({ ...w, name: name.trim() });
    });
    const missing = d.agents.filter((a) => !w.steps.some((s) => s.type === 'agent' && s.agentId === a.id));
    if (missing.length) {
      sep();
      for (const a of missing.slice(0, 8)) item(`Add ${a.emoji || ''} ${a.name}`, () => addStep(w, a), '', 'user-plus');
    }
    item('Hire a new agent into it', () => navigate(`#/library?branch=${encodeURIComponent(w.id)}`), '', 'store');
    sep();
    item('Spin 45°', async () => {
      spinBranch(w.id, Math.PI / 4);
      await saveBranchPlace(w.id);
    }, '', 'rotate-cw');
    if (w.pos || typeof w.angle === 'number' || w.rot) item('Put back next to the Brain', () => saveWorkflow({ ...w, angle: null, pos: null, rot: null }), '', 'rotate-ccw');
    item(
      'Delete team',
      async () => {
        if (!(await confirmBox(`Delete the team "${w.name}"? Its agents stay in the project.`, { ok: 'Delete', danger: true }))) return;
        await attempt(() => DEL(`/workflows/${w.id}`));
        choose(null);
        reloadWorkflows();
      },
      'danger',
      'trash-2',
    );
  } else if (p?.type === 'bench') {
    head('Bench');
    item('New agent', newAgent, '', 'bot');
    item('Hire from the library', () => navigate('#/library'), '', 'library-big');
    if (S.layout?.bench) item('Put the Bench back', () => saveLayout({ bench: null }).then(() => rebuild()), '', 'rotate-ccw');
  } else {
    head('Station');
    item('New team', newBranch, '', 'git-branch');
    item('New agent', newAgent, '', 'bot');
    item('Hire from the library', () => navigate('#/library'), '', 'library-big');
    item('Ask the Brain', () => openDock(), '', 'sparkles');
    sep();
    item('Reset view', () => resetView(), '', 'rotate-ccw');
  }
  S.menuView?.open(e.clientX, e.clientY, items);
}

// Right-clicking a label works like right-clicking the thing it names.
function labelPick(l: Label): MapPick | null {
  if (l.kind === 'agent') return { type: 'agent', id: l.id, wf: l.wf };
  if (l.kind === 'step') return { type: 'branch', id: l.id.split(':')[0] };
  if (l.kind === 'branch') return { type: 'branch', id: l.id };
  if (l.kind === 'bench') return { type: 'bench' };
  return null;
}

// Zoom toward the mouse pointer, so what is under it stays under it.
function zoomAt(f: number, e?: MouseEvent): void {
  assertMounted(S);
  const c = S.cam;
  const before = c.zoom;
  const after = Math.min(8, Math.max(0.3, before * f));
  if (e) {
    const r = S.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    const ground = (zoom: number) => {
      c.zoom = zoom;
      updateCamera();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(nx, ny), S!.camera);
      const p = new THREE.Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
    };
    const p1 = ground(before);
    const p2 = ground(after);
    if (p1 && p2) c.target.add(p1.sub(p2));
  }
  c.zoom = after;
  c.goal = null;
  updateCamera();
}

// Size the view so the whole station (branches, cards, connections) fits on screen.
function fitView(): void {
  if (!S?.world) return;
  const box = new THREE.Box3();
  S.world.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.noFit) box.expandByObject(o);
  });
  box.expandByPoint(new THREE.Vector3(-6, 0, -6)).expandByPoint(new THREE.Vector3(6, 8, 6));
  if (box.isEmpty()) return;
  const keep = { ...S.cam, target: S.cam.target.clone() };
  S.cam.view = 100;
  S.cam.zoom = 1;
  S.cam.target.set(0, 0, 0);
  updateCamera();
  let mx = 0;
  let my = 0;
  const v = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    v.set(x, y, z).project(S.camera);
    mx = Math.max(mx, Math.abs(v.x));
    my = Math.max(my, Math.abs(v.y));
  }
  // room for the top bar, the feed and the cards around the edge
  S.cam.view = 100 * Math.max(mx, my * 1.2) * 1.3;
  S.cam.zoom = keep.zoom;
  S.cam.target.copy(keep.target);
  updateCamera();
}

function resetView(instant = false): void {
  if (!S) return;
  fitView();
  S.cam.az = Math.PI / 4;
  if (instant) {
    S.cam.target.set(0, 0, 0);
    S.cam.zoom = 1;
    updateCamera();
  } else S.cam.goal = { target: new THREE.Vector3(), zoom: 1 };
}

// Center something in the part of the screen the side panel doesn't cover.
function flyTo(vec: THREE.Vector3, zoom: number): void {
  assertMounted(S);
  const z = Math.max(S.cam.zoom, zoom);
  const target = vec.clone().setY(0);
  // centre it in the free part of the screen: right of the chat window (if it's on the left), left of the side panel
  let L = 0;
  let R = S.w > 900 ? S.w - 400 : S.w;
  const cw = document.querySelector('.cw:not(.hidden)');
  if (cw) {
    const z0 = uiZoom();
    const rr = S.root.getBoundingClientRect();
    const c = cw.getBoundingClientRect();
    const cl = (c.left - rr.left) / z0;
    const cr = (c.right - rr.left) / z0;
    if (cl + (cr - cl) / 2 < S.w / 2) L = Math.max(L, cr);
    else R = Math.min(R, cl);
  }
  if (R - L < 260) {
    L = 0;
    R = S.w > 900 ? S.w - 400 : S.w;
  }
  const panelPx = S.w / 2 - (L + R) / 2;
  const unitsPerPx = S.cam.view / z / S.h;
  const right = new THREE.Vector3(Math.cos(S.cam.az), 0, -Math.sin(S.cam.az));
  target.addScaledVector(right, panelPx * unitsPerPx);
  S.cam.goal = { target, zoom: z };
}

// ---------- projects as floors ----------
/** The open project's id as far as the Station knows (to tell which way a switch goes). */
let floorId: string | null = null;
/** The floor an arrow key has moved to and not opened yet: it opens a moment after the last press. */
let floorPick: { idx: number; timer: ReturnType<typeof setTimeout> | null } | null = null;
/** The "leaving" slide, kept until the new floor's slide takes over. */
let floorOut: Animation[] = [];
let floorOutDone: Promise<void> | null = null;
/** A project switch is under way: it rebuilds the map once, itself, when the new project has loaded (other updates must not rebuild it meanwhile, on the old project's data). */
let floorBusy = false;
let floorBusyTimer: ReturnType<typeof setTimeout> | null = null;
/** Marks a switch as under way or over. It clears itself after a few seconds, so a switch that never finishes cannot leave the map frozen. */
function setFloorBusy(on: boolean): void {
  floorBusy = on;
  if (floorBusyTimer) clearTimeout(floorBusyTimer);
  floorBusyTimer = on ? setTimeout(() => (floorBusy = false), 8000) : null;
}
/** Lets the browser draw a frame (or a few) before going on, so heavy work lands while the map is hidden. */
const frames = (n = 1): Promise<void> => new Promise((ok) => { const step = (k: number) => (k <= 0 ? ok() : requestAnimationFrame(() => step(k - 1))); step(n); });
const FLOOR_WAIT = 150;

/** The project button (just the open project, or the picked floor while keys are moving), with the floors above and below it in faint type outside its box, each beside its arrow key. Names show at most 13 characters. */
function projectWrapParts(): HTMLElement[] {
  const d = state.data!;
  const list = d.projects || [];
  const open = Math.max(0, list.findIndex((p) => p.id === d.project?.id));
  if (floorPick && list[floorPick.idx]?.id === d.project?.id && !floorPick.timer) floorPick = null; // it opened
  const idx = floorPick ? floorPick.idx : open;
  const shown = (floorPick && list[idx]) || d.project;
  const { above, below } = neighbours(list, idx);
  const ghost = (p: { name: string } | null, where: string) =>
    h(`span.st-project-ghost.${where}`, { class: 'flex-1 min-w-0 h-3 pl-0 truncate font-mono text-[9.5px] leading-[normal] font-semibold tracking-[0.12em] uppercase text-dim opacity-40 transition-opacity duration-200 ease-[ease] pointer-events-none group-hover/proj:opacity-65', 'aria-hidden': 'true' }, p ? shortName(p.name) : '');
  // the arrow keys, drawn as small keys: they show what the keyboard does, and can be clicked too
  const key = (dir: 1 | -1, enabled: boolean) => {
    const k = h(`button.st-floor-key.${dir < 0 ? 'up' : 'down'}`, {
      class: 'flex-none grid place-items-center w-4 h-3.75 p-0 border border-line-2 border-b-2 rounded-[4px] bg-transparent text-dim cursor-pointer opacity-55 transition-[opacity,color,border-color] duration-150 ease-[ease] hover:not-disabled:opacity-100 hover:not-disabled:text-accent hover:not-disabled:border-accent-dim disabled:opacity-18 disabled:cursor-default',
      type: 'button',
      title: dir < 0 ? 'The project above (Up arrow)' : 'The project below (Down arrow)',
      'aria-label': dir < 0 ? 'Previous project' : 'Next project',
      onclick: () => stepFloor(dir),
    }, icon(dir < 0 ? 'arrow-up' : 'arrow-down', 10));
    k.disabled = !enabled;
    return k;
  };
  const name = shown?.name || 'Project';
  const button = h(
    `button.st-project${floorPick ? '.pending' : ''}`,
    {
      class: 'flex items-center gap-2.25 py-1.75 pr-2.75 pl-2.25 flex-none max-w-65 bg-glass border border-line-2 rounded-ctl text-ink cursor-pointer font-mono text-[13px] leading-[normal] font-bold tracking-[0.1em] uppercase hover:border-accent-dim [&.pending]:border-accent-dim [&.pending_.st-project-name]:text-accent [&_.ico-svg]:text-dim',
      title: `${name} · Switch or create a project (the Up and Down keys move between them)`,
      onclick: (e) => openProjectMenu(e.currentTarget),
    },
    projectMarkEl(shown),
    // every project's name sits (unseen) in the same spot, so the button is as wide as the longest one: switching never moves what is next to it
    h(
      'span',
      { class: 'inline-grid min-w-0 overflow-hidden *:[grid-area:1/1] *:min-w-0' },
      h('span.st-project-name', { class: 'truncate' }, shortName(name)),
      ...list.map((p) => h('span', { class: 'invisible h-0 overflow-hidden whitespace-nowrap pointer-events-none', 'aria-hidden': 'true' }, shortName(p.name))),
    ),
    icon('chevron-down', 14),
  );
  // the key and the faint name take the button's width and never set it (width 0, then stretched to the button)
  const row = (...kids: HTMLElement[]) => h('div', { class: 'flex items-center gap-1.5 w-0 min-w-full box-border' }, ...kids);
  // the arrow rows make the bar tall enough on their own; a lone button gets its padding back
  S?.hudTop?.classList.toggle('py-3.5', list.length <= 1);
  return list.length > 1 ? [row(key(-1, !!above), ghost(above, 'above')), button, row(key(1, !!below), ghost(below, 'below'))] : [button];
}

/** The project's logo, or the Station mark, at the start of the project button. */
function projectMarkEl(p: Project | null | undefined): HTMLSpanElement {
  const cls = 'inline-grid place-items-center w-4.5 flex-none text-accent';
  return p?.logoAt ? h('span.st-mark', { class: cls }, projectMark(p, 18)) : h('span.st-mark', { class: cls }, '◢');
}

/** The text in the middle of the roll: one element changes its words by sliding the old ones out and the new ones in from the other side. */
const rolling = new WeakMap<Element, Animation[]>();
function rollText(el: HTMLElement, text: string, dir: 1 | -1 | 0): void {
  if (el.textContent === text) return;
  const running = rolling.get(el);
  running?.forEach((a) => a.cancel());
  rolling.delete(el);
  if (!dir || REDUCED_MOTION() || !el.isConnected || typeof el.animate !== 'function') {
    el.textContent = text;
    return;
  }
  const rest = parseFloat(getComputedStyle(el).opacity) || 1;
  const dy = 9 * dir;
  const slideIn = () => {
    el.textContent = text;
    const inn = el.animate([{ transform: `translateY(${dy}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: rest }], { duration: 140, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    rolling.set(el, [inn]);
    void inn.finished.then(() => rolling.delete(el)).catch(() => undefined);
  };
  // pressed again before the last roll ended: no slide out (it would look like a stutter), just the new words sliding in
  if (running?.length) return slideIn();
  const out = el.animate([{ transform: 'translateY(0)', opacity: rest }, { transform: `translateY(${-dy}px)`, opacity: 0 }], { duration: 70, easing: 'ease-in', fill: 'forwards' });
  rolling.set(el, [out]);
  void out.finished.then(() => (out.cancel(), slideIn())).catch(() => undefined);
}

/** Shows the picked floor: the names change in place (rolling when `dir` says which way), so nothing is rebuilt under your fingers. */
function paintFloorPick(dir: 1 | -1 | 0 = 0): void {
  const wrap = S?.hudTop?.querySelector('.st-project-wrap');
  if (!wrap) return;
  const d = state.data!;
  const list = d.projects || [];
  const open = Math.max(0, list.findIndex((p) => p.id === d.project?.id));
  const idx = floorPick ? floorPick.idx : open;
  const shown = (floorPick && list[idx]) || d.project;
  const { above, below } = neighbours(list, idx);
  const button = wrap.querySelector<HTMLElement>('.st-project');
  const aboveEl = wrap.querySelector<HTMLElement>('.st-project-ghost.above');
  const belowEl = wrap.querySelector<HTMLElement>('.st-project-ghost.below');
  const nameEl = wrap.querySelector<HTMLElement>('.st-project-name');
  if (!button || !nameEl || (list.length > 1) !== !!aboveEl) return wrap.replaceChildren(...projectWrapParts());
  button.classList.toggle('pending', !!floorPick);
  if (aboveEl) rollText(aboveEl, shortName(above?.name || ''), dir);
  rollText(nameEl, shortName(shown?.name || 'Project'), dir);
  if (belowEl) rollText(belowEl, shortName(below?.name || ''), dir);
  const upKey = wrap.querySelector<HTMLButtonElement>('.st-floor-key.up');
  const downKey = wrap.querySelector<HTMLButtonElement>('.st-floor-key.down');
  if (upKey) upKey.disabled = !above;
  if (downKey) downKey.disabled = !below;
  button.title = `${shown?.name || 'Project'} · Switch or create a project (the Up and Down keys move between them)`;
  // the logo changes with the project (no roll: it is small)
  const mark = button.querySelector('.st-mark');
  mark?.replaceWith(projectMarkEl(shown));
}

/** An arrow key: move to the project above (-1) or below (1); it opens a moment after the last press. It stops at the ends. */
function stepFloor(dir: 1 | -1): void {
  const d = state.data;
  const list = d?.projects || [];
  if (!S || !d || list.length < 2) return;
  const from = floorPick ? floorPick.idx : Math.max(0, list.findIndex((p) => p.id === d.project?.id));
  const idx = stepIndex(list.length, from, dir);
  if (idx === from) return;
  if (floorPick?.timer) clearTimeout(floorPick.timer);
  floorPick = { idx, timer: setTimeout(() => void openFloor(), FLOOR_WAIT) };
  paintFloorPick(dir);
}

async function openFloor(): Promise<void> {
  const pick = floorPick;
  const d = state.data;
  const target = pick && d?.projects?.[pick.idx];
  if (!pick || !target || !d) return;
  pick.timer = null;
  if (target.id === d.project?.id) {
    floorPick = null;
    paintFloorPick();
    return;
  }
  // the old floor starts leaving now; the new one comes in when the project has loaded
  setFloorBusy(true);
  void floorSlide('out', floorDirection((d.projects || []).map((p) => p.id), d.project?.id, target.id) || 1);
  const ok = await attempt(() => POST(`/projects/${target.id}/activate`), `Opened ${target.name}`);
  if (!ok) {
    // it did not open: bring the old floor back
    setFloorBusy(false);
    endFloorOut();
    if (floorPick === pick) {
      floorPick = null;
      paintFloorPick();
    }
  }
}

/** Ends the "leaving" slide (put everything back as it was). */
function endFloorOut(): void {
  floorOut.forEach((a) => a.cancel());
  floorOut = [];
  floorOutDone = null;
}

/**
 * The whole map slides and fades out or in, like the elevator changing floors. The wires (programs to agents) go with it: on the way out
 * they draw back up into the program tiles, on the way in they come down again once the new floor has arrived (their ends follow
 * the desks, so they wait until the desks have stopped sliding).
 */
function floorSlide(phase: 'out' | 'in', dir: 1 | -1): Promise<void> {
  if (!S || typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  if (phase === 'out' && floorOutDone) return floorOutDone; // already leaving (it started when the arrow keys came to rest)
  const els = [S.host, S.labels];
  const wires = S.root.querySelector<SVGSVGElement>('.st-wires');
  if (phase === 'in') endFloorOut();
  const gone = dir > 0 ? '-7%' : '7%';
  const from = dir > 0 ? '7%' : '-7%';
  const frames: Keyframe[] =
    phase === 'out'
      ? [{ opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' }, { opacity: 0, transform: `translateY(${gone})`, filter: 'blur(5px)' }]
      : [{ opacity: 0, transform: `translateY(${from})`, filter: 'blur(5px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' }];
  const anims = els.map((el) => el.animate(frames, { duration: phase === 'out' ? 120 : 240, easing: phase === 'out' ? 'ease-in' : 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: phase === 'out' ? 'forwards' : 'none' }));
  if (wires) {
    // (the lights running down the wires are still SVG)
    const up = 'inset(0 0 100% 0)';
    const all = 'inset(0 0 0 0)';
    anims.push(
      phase === 'out'
        ? wires.animate([{ clipPath: all }, { clipPath: up }], { duration: 120, easing: 'ease-in', fill: 'forwards' })
        : wires.animate([{ clipPath: up }, { clipPath: all }], { duration: 380, delay: 150, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'backwards' }),
    );
  }
  // the wires themselves (drawn on the map's canvas) the same way
  S.wireReveal = phase === 'out' ? { from: 1, to: 0, at: performance.now(), ms: 120, delay: 0 } : { from: 0, to: 1, at: performance.now(), ms: 380, delay: 150 };
  const done = Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined);
  if (phase === 'out') {
    floorOut = anims;
    floorOutDone = done;
  }
  return done;
}

// ---------- HUD ----------
// buttons that press in and lift on hover
const TRANSITION = '[transition:transform_0.18s_var(--ease-soft),background-color_0.18s,border-color_0.18s,color_0.18s,box-shadow_0.2s,opacity_0.2s]';
const CONN_LABEL = 'inline-flex items-center gap-1.5 mr-1 whitespace-nowrap font-mono text-[10px] leading-[normal] font-medium tracking-[0.2em] text-dim';
// a header tile; off and missing are marked by class, hot and the row's focus / soft by the script
const INT_TILE = `grid place-items-center flex-none size-6 p-0 cursor-pointer rounded-ctl border border-[color-mix(in_srgb,var(--c)_55%,transparent)] bg-[color-mix(in_srgb,var(--c)_10%,#0d100d)] text-(--c) font-sans text-[10px] leading-[normal] font-bold shadow-[0_0_12px_color-mix(in_srgb,var(--c)_25%,transparent)] ${TRANSITION} [&_.logo-svg]:size-3.5 [&_.craft-icon]:size-5 active:[transform:scale(0.96)] [&:hover]:[transform:translateY(-1px)] [&.off]:bg-transparent [&.off]:text-faint [&.off]:border-line-2 [&.off]:shadow-none [&.off_.logo-svg_path]:fill-[#5d6359] [&.off_.craft-icon]:grayscale [&_.app-icon]:size-3.5 [&.off_.app-icon]:[filter:grayscale(1)_brightness(0.55)] [&.missing]:border-dashed [&.flash]:animate-[st-flash_1.2s_ease-out] group-[.focus]/conn:[&:not(.hot)]:opacity-15 group-[.focus]/conn:[&:not(.hot)]:grayscale group-[.focus]/conn:[&:not(.hot)]:shadow-none group-[.focus.soft]/conn:[&:not(.hot)]:opacity-62 group-[.focus.soft]/conn:[&:not(.hot)]:[filter:none] group-[.focus]/conn:[&.hot]:[transform:translateY(-1px)] group-[.focus]/conn:[&.hot]:bg-[color-mix(in_srgb,var(--c)_18%,#0d100d)] group-[.focus]/conn:[&.hot]:shadow-[0_0_0_1px_var(--c),0_0_16px_color-mix(in_srgb,var(--c)_55%,transparent)]`;
const ENGINE =
  'group/eng relative grid place-items-center size-6 p-0 border-0 bg-transparent rounded-[6px] cursor-pointer text-(--c) font-sans text-[14px] leading-[normal] font-bold text-shadow-[0_0_10px_var(--c)] [transition:transform_0.15s,opacity_0.2s,filter_0.2s] hover:[transform:translateY(-1px)] hover:bg-[color-mix(in_srgb,var(--c)_18%,transparent)] [&.off]:text-[#5b5e57] [&.off]:text-shadow-none [&.off]:grayscale [&.off]:opacity-55 [&.off]:hover:opacity-90 [&.busy]:animate-[st-engine-pulse_1.4s_ease-in-out_infinite] [&_.app-icon]:size-4 [&_.app-icon]:[filter:drop-shadow(0_0_6px_var(--c))]';
const STAT = 'flex items-baseline gap-1.5 px-2.5 py-1.5 border bg-glass backdrop-blur-[16px] backdrop-saturate-140 rounded-ctl font-mono text-[10px] leading-[normal] font-medium tracking-[0.14em] uppercase text-dim';
const STAT_N = 'font-sans text-[15px] leading-[normal] font-bold tracking-normal';
const ZOOM_BTN = `grid place-items-center size-9.5 rounded-full border border-line-2 bg-[rgba(13,16,13,0.9)] text-ink text-[17px] cursor-pointer ${TRANSITION} hover:border-accent hover:text-accent`;
const FEED_ITEM = 'flex gap-2 py-0.75 whitespace-nowrap overflow-hidden text-ellipsis text-shadow-[0_1px_4px_#000]';

function badge(id: string): HTMLSpanElement | null {
  const it = intInfo(id);
  if (!it) return null;
  return h('span.st-badge', { style: { '--c': it.color }, title: it.label }, mark(id, 11));
}

/** A tile in the header's CONNECTED TO row. */
interface HudTile {
  key: string;
  int?: string;
  glyph: SVGSVGElement | HTMLImageElement | string;
  color: string;
  on: boolean;
  missing?: boolean;
  title: string;
  onclick: () => void;
}
function drawHud(): void {
  const d = state.data;
  if (!d || !S) return;
  floorId = d.project?.id ?? floorId;
  setBrainLogo();
  const ints = availableIntegrations(d, S.progs);
  const needs = d.approvals.length + d.outboxPending + (d.questions?.length || 0);
  if (!S.hudBuilt) {
    S.hudBuilt = true;
    S.hudTop = h('div', { class: 'absolute top-0 left-0 right-0 flex items-center gap-3.5 px-4.5 bg-[linear-gradient(#070807_40%,transparent)] pointer-events-auto' });
    S.feedEl = h('div', { class: 'absolute left-4 bottom-4 w-[min(380px,40vw)] font-mono text-[11.5px] leading-[1.45] font-normal pointer-events-auto' });
    // moves left of the side panel while it is open
    S.zoomEl = h(
      'div',
      { class: 'absolute right-4 bottom-4 flex flex-col gap-1.5 pointer-events-auto group-has-[.st-panel:not(.hidden)]/root:right-101.5' },
      // the World panel (voxel look only: shown or hidden on each drawHud)
      h('button.st-world-btn', { class: `${ZOOM_BTN} mb-1.5`, hidden: true, title: 'World: WORLD.md, what is built, the look, which world', 'aria-label': 'World', onclick: () => choose(S?.selected?.type === 'world' ? null : { type: 'world' }) }, icon('globe', 17)),
      h('button', { class: ZOOM_BTN, title: 'Zoom in (+)', onclick: () => zoomAt(1.3) }, icon('zoom-in', 17)),
      h('button', { class: ZOOM_BTN, title: 'Zoom out (−)', onclick: () => zoomAt(0.77) }, icon('zoom-out', 17)),
      h('button', { class: ZOOM_BTN, title: 'Whole station (0)', onclick: () => resetView() }, icon('house', 17)),
    );
    // the empty-state note sits at the side, not over the map
    S.emptyEl = h('div', { class: 'absolute left-4.5 top-18.5 pointer-events-none' });
    S.statsEl = h('div', { class: 'absolute top-14.5 right-4.5 pointer-events-auto group-has-[.st-panel:not(.hidden)]/root:hidden' });
    S.hud.append(S.hudTop, S.statsEl, S.feedEl, S.zoomEl, S.emptyEl);
  }
  // the World button only in the voxel look (the panel closes when the look goes classic)
  const worldLook = d.settings?.look?.stationLook === 'world';
  const worldBtn = S.zoomEl.querySelector<HTMLButtonElement>('.st-world-btn');
  if (worldBtn) worldBtn.hidden = !worldLook;
  if (!worldLook && S.selected?.type === 'world') choose(null);
  // Everything that could be connected: lit when it works, grey when it doesn't (yet).
  const tiles: HudTile[] = [];
  for (const c of S.headbar?.connectors || []) {
    const look = connectorLook(c.name);
    const ok = c.status === 'connected';
    tiles.push({ key: `cc:${c.name}`, int: `cc:${c.name}`, glyph: appLogo(c.name, 14) || look.glyph, color: look.color, on: ok, title: `${c.name} · Claude account connector · ${ok ? 'connected' : c.status === 'needs-auth' ? 'needs sign-in (run /mcp in Claude Code)' : c.detail}`, onclick: () => navigate('#/settings?tab=mcp') });
  }
  // Model engines (Claude, Hermes, OpenRouter, LM Studio) have their own tiles on the right.
  const ENGINE_SIDE = new Set(['claude', 'hermes', 'openrouter', 'lmstudio']);
  for (const it of ints) if (!ENGINE_SIDE.has(it.id)) tiles.push({ key: it.id, int: it.id, glyph: mark(it.id), color: it.color, on: it.live, title: `${it.label} · ${it.live ? 'ready' : 'installed, not running'}`, onclick: () => choose({ type: 'int', id: it.id }) });
  const missing = [
    !d.accounts.x.length && { glyph: logo('x', 13) || '𝕏', title: 'X · not connected (Connections)', href: '#/settings?tab=connections' },
    !d.accounts.telegram.configured && { glyph: logo('telegram', 13) || '✈', title: 'Telegram · not set up (Connections)', href: '#/settings?tab=connections' },
    !(d.accounts.reddit || []).length && { glyph: logo('reddit', 13) || 'r/', title: 'Reddit · not connected (Settings > Connections)', href: '#/settings?tab=connections' },
    !d.accounts.discord.configured && { glyph: logo('discord', 13) || 'D', title: 'Discord · not set up (Connections)', href: '#/settings?tab=connections' },
  ].filter(Boolean) as { glyph: SVGSVGElement | string; title: string; href: string }[];
  for (const m of missing) tiles.push({ key: m.title, glyph: m.glyph, color: '#555850', on: false, missing: true, title: m.title, onclick: () => navigate(m.href) });
  const seen = new Set<string>();
  // Every engine an agent (or the Brain) can run on: lit when ready, grey with a setup link when not.
  const brainP = d.settings?.brain?.provider || 'claude';
  const busyIds = new Set((d.runs || []).map((r) => r.agentId));
  // LM Studio: a tile once it is installed or an agent uses it; lit while its local server is up
  const lm = ints.find((i) => i.id === 'lmstudio');
  const onLmStudio = (a: Agent): boolean => a.engine === 'openai' && a.provider === 'lmstudio';
  const lmStudio = lm || d.agents.some(onLmStudio)
    ? [{ id: 'openai', uses: onLmStudio, brain: '', name: 'LM Studio', glyph: mark('lmstudio', 15), color: '#6a72ed', ready: !!lm?.live, why: lm ? 'its server is not running (LM Studio > Developer > Start server)' : 'not installed', find: 'LM Studio server' }]
    : [];
  const engines = [
    { id: 'claude-code', brain: 'claude', name: 'Claude Code', glyph: logo('claude', 15) || '✳', color: '#d97757', ready: d.engines['claude-code'].installed, why: d.engines['claude-code'].installed ? '' : 'not installed', find: 'Claude Code' },
    { id: 'openai', uses: (a: Agent) => a.engine === 'openai' && !onLmStudio(a), brain: 'openrouter', name: 'OpenRouter', glyph: logo('openrouter', 15) || '◇', color: '#94a3b8', ready: d.secrets.openrouterKey.set, why: d.secrets.openrouterKey.set ? '' : 'no key yet', find: 'OpenRouter key' },
    ...lmStudio,
    { id: 'hermes', brain: 'hermes', name: 'Hermes', glyph: '☤', color: '#d8c25a', ready: d.engines.hermes.installed, why: d.engines.hermes.installed ? '' : 'not installed', find: 'Hermes' },
    { id: 'codex', brain: 'codex', name: 'OpenAI Codex', glyph: logo('openai', 14) || '◎', color: '#e6e8e0', ready: !!(d.engines.codex?.installed && d.engines.codex.loggedIn), why: !d.engines.codex?.installed ? 'not installed' : d.engines.codex.loggedIn ? '' : 'not signed in', find: 'OpenAI Codex' },
    // pi, oh-my-pi and OpenClaw: always shown, like the model picker's tabs (grey with a setup link until installed)
    ...([
      { id: 'pi', name: 'pi', glyph: 'π', color: '#9fd3a8', find: 'pi coding agent' },
      { id: 'omp', name: 'oh-my-pi', glyph: 'Ω', color: '#c8a2f0', find: 'oh-my-pi' },
      { id: 'openclaw', name: 'OpenClaw', glyph: '🦞', color: '#ff6f5e', find: 'OpenClaw' },
    ] as const).map((e) => ({ ...e, brain: '', ready: !!d.engines[e.id]?.installed, why: d.engines[e.id]?.installed ? '' : 'not installed' })),
  ].map((e: { id: string; uses?: (a: Agent) => boolean; brain: string; name: string; glyph: SVGSVGElement | HTMLImageElement | string; color: string; ready: boolean; why: string; find: string }) => {
    const uses = e.uses || ((a: Agent) => a.engine === e.id);
    const users = d.agents.filter(uses);
    const busy = users.some((a) => busyIds.has(a.id));
    const who = [users.length ? `${users.length} agent${users.length === 1 ? '' : 's'}` : '', brainP === e.brain ? 'the Brain' : ''].filter(Boolean).join(' + ');
    // ready and used by agents: a click shows them on the Agents page; otherwise it opens its setup
    const toAgents = e.ready && users.length ? `#/agents?uses=${engineKey(users[0])}` : '';
    return { ...e, uses, n: users.length + (brainP === e.brain ? 1 : 0), busy, toAgents, title: `${e.name} · ${e.ready ? 'ready' : e.why}${who ? ` · used by ${who}` : ''}${toAgents ? ' (click to see its agents)' : e.ready ? '' : ' (click to set up)'}` };
  });
  S.clockEl ||= h('span', { class: 'min-w-23 text-right font-mono text-[17px] leading-[normal] font-medium tracking-[0.02em] text-ink' });
  S.tileEls = new Map();
  mount(
    S.hudTop,
    h('div.st-project-wrap', { class: 'group/proj flex flex-col items-stretch gap-0.75 flex-none' }, ...projectWrapParts()),
    h(
      'div.st-connected',
      { class: 'group/conn flex items-center gap-1 flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' },
      h('span', { class: CONN_LABEL }, h('span.dot.on'), 'CONNECTED TO'),
      tiles
        .filter((t) => !seen.has(t.title.split(' · ')[0].toLowerCase()) && seen.add(t.title.split(' · ')[0].toLowerCase()))
        .sort((a, b) => +b.on - +a.on || +!!a.missing - +!!b.missing)
        .map((t) => {
          const el = h(`button${t.on ? '' : '.off'}${t.missing ? '.missing' : ''}`, { class: INT_TILE, style: { '--c': t.color }, title: t.title, onclick: t.onclick }, t.glyph);
          if (t.int) {
            S!.tileEls.set(t.int, el);
            const id = t.int;
            el.addEventListener('pointerenter', () => S && (S.hover = hoverForLink(id)));
            el.addEventListener('pointerleave', () => S && (S.hover = null));
          }
          return el;
        }),
    ),
    h(
      'div',
      { class: 'flex items-center gap-4 flex-none' },
      h(
        'div',
        { class: 'flex items-center gap-1.5' },
        h('span', { class: `${CONN_LABEL} max-[1501px]:hidden` }, h(`span.dot${engines.some((e) => e.busy) ? '.busy' : '.on'}`), 'AI ENGINES'),
        engines.map((e) =>
          h(
            `button${e.ready ? '' : '.off'}${e.busy ? '.busy' : ''}`,
            {
              class: ENGINE,
              style: { '--c': e.color },
              title: e.title,
              onclick: () => navigate(e.toAgents || `#/settings?tab=general&find=${encodeURIComponent(e.find)}`),
              onpointerenter: () => S && (S.hover = hoverForEngine(e.uses, brainP === e.brain, e.color)),
              onpointerleave: () => S && (S.hover = null),
            },
            e.glyph,
            e.n ? h('span', { class: 'absolute -right-1.25 -bottom-1 min-w-3.25 h-3.25 px-0.75 rounded-[7px] bg-[#141713] border border-[color-mix(in_srgb,var(--c)_55%,#333)] text-ink font-mono text-[8.5px] leading-[11px] font-semibold text-shadow-none group-[.off]/eng:border-[#444] group-[.off]/eng:text-[#888]' }, String(e.n)) : null,
          ),
        ),
      ),
      S.headbar?.usages?.length ? (S.usageEl ||= h('div', { class: 'flex items-center overflow-hidden max-[1201px]:hidden' })) : null,
      S.clockEl,
    ),
  );
  tickClock();
  drawUsage(false);
  drawEmpty(d);
  mount(
    S.statsEl,
    h(
      'div',
      { class: 'ml-auto flex items-center gap-1.5' },
      // on small screens only the buttons stay
      d.runs.length || S.active.size ? h('div', { class: `${STAT} border-line-2 max-md:hidden` }, h('b', { class: `${STAT_N} text-accent` }, String(d.runs.length + S.active.size)), 'working') : null,
      needs ? h('button', { class: `${STAT} border-amber cursor-pointer`, onclick: () => document.getElementById('drawer')!.classList.toggle('hidden') }, icon('bell', 13), h('b', { class: `${STAT_N} text-amber` }, String(needs)), 'needs you') : null,
      d.agents.length
        ? h('button', { class: 'inline-flex items-center gap-1.5 px-3 py-2 border-0 rounded-ctl bg-accent text-on-accent cursor-pointer font-mono text-[10.5px] leading-[normal] font-bold tracking-[0.14em] uppercase hover:bg-accent-hover active:[transform:scale(0.96)]', onclick: newBranch }, icon('git-branch', 14), 'team')
        : null,
    ),
  );
}

// What to do first, when there is nothing on the map yet.
const EMPTY = 'pointer-events-auto w-80 py-4 px-4.5 bg-glass backdrop-blur-[16px] backdrop-saturate-140 border border-accent-dim rounded-box shadow-[0_20px_60px_rgba(0,0,0,0.55)] animate-[in-up_0.45s_var(--ease-soft)]';
const EMPTY_TITLE = 'font-sans text-[15px] leading-[1.3] font-bold mb-1.5';
const EMPTY_P = 'text-dim text-[13px] mb-3';
const EMPTY_BTN = 'h-7.5 px-2.75 text-[10.5px]';
function drawEmpty(d: AppState): void {
  if (!S?.emptyEl) return;
  let card: HTMLDivElement | null = null;
  if (!d.agents.length)
    card = h(
      'div',
      { class: EMPTY },
      h('div', { class: EMPTY_TITLE }, 'Your station is empty'),
      h('p', { class: EMPTY_P }, 'Tell the Brain what you need, e.g. "make me a social media team", and it builds the team from the library. Or hire and create agents yourself.'),
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-2.5' },
        h('button.btn', { class: EMPTY_BTN, onclick: () => openDock('auto', 'Make me a team for ') }, 'Ask the Brain'),
        h('a.btn.ghost', { class: EMPTY_BTN, href: '#/library' }, 'Agent library'),
        h('button.btn.ghost', {
          class: EMPTY_BTN,
          onclick: async () => {
            const a = await attempt(() => POST<Agent>('/agents', { name: 'New agent' }));
            if (a) navigate(`#/agents/${a.id}/edit`);
          },
        }, 'Create your own'),
      ),
    );
  else if (!S.workflows.length)
    card = h(
      'div',
      { class: EMPTY },
      h('div', { class: EMPTY_TITLE }, `${d.agents.length} agent${d.agents.length === 1 ? '' : 's'} ready`),
      h('p', { class: EMPTY_P }, 'Ask any of them something in the Brain chat, or group them into a team: a workflow where each one hands its result to the next.'),
      h('div', { class: 'flex flex-wrap items-center gap-2.5' }, h('button.btn', { class: EMPTY_BTN, onclick: newBranch }, '+ New team'), h('button.btn.ghost', { class: EMPTY_BTN, onclick: () => openDock() }, 'Open Brain chat')),
    );
  mount(S.emptyEl, card);
}

function buildWires(): void {
  assertMounted(S);
  const agentsById = new Map((state.data?.agents || []).map((a) => [a.id, a]));
  S.links2d = [];
  for (const node of [...S.nodes, ...(S.benchNodes || [])]) {
    // refresh agent links (connectors may have loaded since the map was built)
    if (node.kind === 'agent') {
      const wf = node.wfId ? S.workflows.find((w) => w.id === node.wfId) : null;
      node.links = wf ? stepLinks(wf.steps[node.index], agentsById, wf) : agentLinks(agentsById.get(node.agentId));
    }
    for (const id of node.links) S.links2d.push({ intId: id, node, flash: 0 });
  }
  // combined: one wire per connection per team, and one to the Bench
  S.links2dAll = [];
  const bundle = (nodes: MapNode[], anchor: THREE.Object3D, lift: number) => {
    const by = new Map<string, MapNode[]>();
    for (const n of nodes) for (const id of n.links) by.set(id, [...(by.get(id) || []), n]);
    for (const [intId, members] of by) S!.links2dAll!.push({ intId, node: null, anchor, lift, members, flash: 0 });
  };
  for (const [, b] of S.branches) bundle(b.nodes, b.group, 1.9);
  if (S.bench && S.benchNodes?.length) bundle(S.benchNodes, S.bench, 1.4);
}

const USAGE_LOOK: Record<string, { brand?: string; glyph: string; color: string }> = { claude: { brand: 'claude', glyph: '✳', color: '#d97757' }, openrouter: { brand: 'openrouter', glyph: '◇', color: '#94a3b8' }, codex: { brand: 'openai', glyph: '◎', color: '#e6e8e0' } };
function drawUsage(animate: boolean): void {
  const list = S?.headbar?.usages || [];
  if (!S?.usageEl || !list.length) return;
  const u = list[(S.usageIdx || 0) % list.length];
  const look = USAGE_LOOK[u.id] || { glyph: '•', color: '#aaa' };
  const meter = (m: UsageMeter) =>
    h(
      'div',
      {
        class: 'flex items-center gap-1.75 font-mono text-[9.5px] leading-[normal] font-medium tracking-[0.16em] text-dim',
        title: m.resetsAt ? `resets ${new Date(m.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : m.text || '',
      },
      h('span', m.label),
      m.percent != null ? h('div', { class: 'relative w-11.5 h-1 bg-line-2' }, h('i', { class: 'absolute left-0 top-0 bottom-0', style: { width: `${m.percent}%`, background: m.percent >= 80 ? 'var(--color-amber)' : 'var(--color-accent)' } })) : null,
      h('b', { class: 'min-w-7.5 font-sans text-[12px] leading-[normal] font-bold tracking-normal text-ink' }, m.percent != null ? `${m.percent}%` : m.text || '–'),
    );
  mount(
    S.usageEl,
    h(
      'div',
      // slides in when it switches to the next provider
      { class: animate ? 'flex items-center gap-3.5 animate-[st-usage-in_0.55s_cubic-bezier(0.2,0.8,0.2,1)_both]' : 'flex items-center gap-3.5' },
      h('span', { class: 'w-5.5 grid place-items-center text-(--c) text-shadow-[0_0_10px_var(--c)] font-sans text-[14px] leading-[normal] font-bold', style: { '--c': look.color }, title: `${u.name} usage${list.length > 1 ? ' · switches every 6 s' : ''}` }, (look.brand && logo(look.brand, 14)) || look.glyph),
      u.meters.map(meter),
      list.length > 1
        ? h(
            'span',
            { class: 'flex flex-col gap-0.75' },
            list.map((_, i) => h('i', { class: i === (S!.usageIdx || 0) % list.length ? 'size-1 rounded-full transition-[background] duration-300 ease-[ease] bg-accent' : 'size-1 rounded-full transition-[background] duration-300 ease-[ease] bg-[#3a3d37]' })),
          )
        : null,
    ),
  );
}

function tickClock(): void {
  if (S?.clockEl) S.clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function loadHeadbar(): Promise<void> {
  const hb = await GET<Headbar>('/headbar').catch(() => null);
  if (S && hb) {
    S.headbar = hb;
    setClaudeConnectors(hb.connectors || []);
    drawHud();
    if (S.world) buildWires();
  }
}

function feedPush(text: string, kind = 'run'): void {
  if (!S) return;
  S.feed.unshift({ text, kind, ts: Date.now() });
  S.feed = S.feed.slice(0, 4);
  drawFeed();
}

function drawFeed(): void {
  if (!S?.feedEl) return;
  S.feedEl.classList.toggle('hidden', !S.feed.length);
  mount(
    S.feedEl,
    h('div', { class: 'flex items-center gap-1.5 mb-1.5 text-amber tracking-[0.2em] text-[10px]' }, h('span.dot.busy'), 'LIVE'),
    S.feed.map((f, i) => h('div', { style: { opacity: String(1 - i * 0.12) }, class: f.kind === 'error' ? `${FEED_ITEM} text-red` : `${FEED_ITEM} text-ink` }, h('span', { class: 'flex-none w-13.5 text-faint' }, ago(f.ts)), f.text)),
  );
}

async function reloadWorkflows(): Promise<void> {
  if (!S) return;
  const [wfs, runs] = await Promise.all([GET<TeamListing[]>('/workflows').catch(() => S!.workflows), GET<WorkflowRun[]>('/workflow-runs').catch(() => S!.wfRuns)]);
  if (!S) return;
  S.workflows = wfs.map(teamView);
  for (const w of wfs) {
    if (w.state) S.teamState[w.id] = w.state;
    if (w.last) S.teamLast[w.id] = w.last;
  }
  S.wfRuns = runs;
  shareTeams();
  if (!floorBusy && signature() !== S.signature) rebuild();
  else updateStatuses();
  drawHud();
  if (S.selected?.type === 'branch') renderPanel();
}


// What gets saved: a step list keeps its own steps (approvals, posts...), with the members swapped in.
function teamBody(wf: TeamView): Team {
  const { stepList = [], ...team } = wf;
  team.members = [...new Set((wf.steps || []).filter((x) => x.type === 'agent' && x.agentId).map((x) => x.agentId!))];
  if (team.lead && !team.members.includes(team.lead)) team.lead = null;
  return { ...team, steps: teamSteps({ steps: stepList, members: team.members }) } as Team;
}
async function saveWorkflow(wf: TeamView): Promise<Team | undefined> {
  const r = await attempt(() => PUT<Team>(`/workflows/${wf.id}`, teamBody(wf)));
  if (r) await reloadWorkflows();
  return r;
}

// New branch: the builder (name, agents, access, or auto-build).
function newBranch(): void {
  openBranchBuilder({
    onSaved: async (wf: Team) => {
      await reloadWorkflows();
      choose({ type: 'branch', id: wf.id });
    },
  });
}

// ---------- selection & panels ----------
// The side panel (web/views/stationpanel.tsx) reads the map through this.
const panelApi: StationPanelApi = {
  selected: () => S?.selected || null,
  teams: () => S?.workflows || [],
  teamState: (id) => S?.teamState?.[id] || { working: [], queued: [] },
  teamBusy: (id) => !!S?.active.has(id),
  busyTeams: () => S?.active.size || 0,
  programs: () => S?.progs || [],
  teamLinks: (id) => S?.branches.get(id)?.links || new Set(),
  now: (agentId, wfId) => (S ? nowText(agentId, wfId) : { st: 'idle', text: '' }),
  connectors: () => S?.headbar?.connectors || [],
  choose,
  saveTeam: saveWorkflow,
  reloadTeams: reloadWorkflows,
  spinTeam: async (id) => {
    spinBranch(id, Math.PI / 4);
    await saveBranchPlace(id);
  },
  zoomToTeam: (id) => {
    const b = S?.branches.get(id);
    if (b) flyTo(b.group.position.clone(), 1.6);
  },
  newTeam: newBranch,
};
// what is picked may have changed: the panel draws it again
function renderPanel(): void {
  S?.panelView?.update();
}

function choose(p: MapPick | null): void {
  if (!S) return;
  S.selected = p;
  for (const l of S.labelEls) l.el.classList.toggle('sel', !!p && l.kind === p.type && l.id === p.id && (!p.wf || !l.wf || l.wf === p.wf));
  if (!p) {
    // slide out, then hide (unless something was picked meanwhile)
    if (!S.panel.classList.contains('hidden') && !S.panelClosing) {
      const panel = S.panel;
      S.panelClosing = slideOut(panel, { x: 40, duration: 230 }).then(() => {
        if (S && !S.selected) panel.classList.add('hidden');
        if (S) S.panelClosing = null;
      });
    }
    return;
  }
  if (p.type === 'branch') openChat('team', p.id, { focus: false });
  if (p.type === 'agent') openChat('agent', p.id, { focus: false });
  if (p.type === 'agent') {
    const desk = S.desks.find((x) => x.agent.id === p.id && (!p.wf || x.wfId === p.wf)) || S.desks.find((x) => x.agent.id === p.id);
    if (desk) flyTo(desk.group.getWorldPosition(new THREE.Vector3()), 2.2);
  } else if (p.type === 'branch') {
    const b = S.branches.get(p.id);
    if (b) flyTo(b.group.position.clone(), Math.max(0.9, 1.9 - b.radius * 0.08));
  } else if (p.type === 'brain') flyTo(new THREE.Vector3(), 1);
  // open: slide in from the right; already open (another team or agent): a small move, not a jump
  const wasOpen = !S.panel.classList.contains('hidden') && !S.panelClosing;
  S.panel.getAnimations().forEach((a) => a.cancel());
  S.panelClosing = null;
  S.panel.classList.remove('hidden');
  if (wasOpen) slideIn(S.panel, { x: 14, duration: 280 });
  else slideIn(S.panel, { x: 44, duration: 420, blur: 4 });
  renderPanel();
}

// A team with these members (the lead goes if it left).
function setMembers(wf: TeamView, members: string[]): void {
  wf.members = members;
  wf.steps = members.map((id) => ({ type: 'agent', agentId: id }));
  if (wf.lead && !members.includes(wf.lead)) wf.lead = null;
}

// Clone / save as preset, for agents and teams.
async function cloneAgent(a: Agent): Promise<Agent | undefined> {
  const c = await attempt(() => POST<Agent>(`/agents/${a.id}/duplicate`), `Cloned ${a.name}`);
  if (c) refreshSoon(0);
  return c;
}
async function cloneTeam(w: TeamView, withAgents: boolean): Promise<void> {
  const c = await attempt(() => POST<Team>(`/workflows/${w.id}/clone`, { withAgents }), withAgents ? `Cloned ${w.name} with copies of its agents` : `Cloned ${w.name}`);
  if (!c) return;
  if (withAgents) refreshSoon(0);
  await reloadWorkflows();
  choose({ type: 'branch', id: c.id });
}
const presetAgent = (a: Agent) => attempt(() => POST(`/presets/agent/${a.id}`), `Saved ${a.name} as a preset (Agent library › Your presets)`);
const presetTeam = (w: TeamView) => attempt(() => POST(`/presets/team/${w.id}`), `Saved ${w.name} and its agents as a preset (Agent library › Your presets)`);

// What an agent is doing right now, in words ("Blender · rendering the scene", "thinking…").
function nowText(agentId: string, wfId?: string): { st: 'needs' | 'idle' | 'working'; text: string } {
  assertMounted(S);
  const d = state.data!;
  const desk = S.desks.find((x) => x.agent.id === agentId && (!wfId || x.wfId === wfId)) || S.desks.find((x) => x.agent.id === agentId);
  const act = desk?.act;
  if (d.approvals.some((x) => x.agentId === agentId)) return { st: 'needs', text: 'Waiting for your OK' };
  if (!d.runs.some((r) => r.agentId === agentId)) return { st: 'idle', text: '' };
  if (act?.kind === 'tool') return { st: 'working', text: [act.app, act.action].filter(Boolean).join(' · ') + (act.detail ? `: ${act.detail}` : '') };
  return { st: 'working', text: 'Thinking…' };
}

// ---------- live events ----------
/** A builder asked for a picture of the world (world_look). Every tab answers, from any page: with a picture
 *  when it shows that world in the voxel look, else that it can't, so the server needn't wait for it. */
export async function answerLook(ev: ServerEvent): Promise<void> {
  if (typeof ev.request !== 'string') return;
  const drew = S?.worldLayer ? await S.worldLayer.look(ev).catch(() => false) : false;
  if (!drew) await POST(`/world/snapshot/${encodeURIComponent(ev.request)}`, { error: "this tab doesn't show that world in the voxel look" }).catch(() => null);
}

export function onEvent(ev: ServerEvent): void | Promise<void> {
  if (!S) return;
  const d = state.data;
  if (ev.type === 'workflows') return reloadWorkflows();
  // the voxel world changed (a build, a move, WORLD.md, another project's world picked), or another project opened
  if (ev.type === 'world' || ev.type === 'project') S.worldLayer?.refresh(ev.type === 'world' ? ev : undefined);
  // a builder plays an animation on an agent's character
  if (ev.type === 'world-anim' && typeof ev.agent === 'string' && typeof ev.clip === 'string') S.worldLayer?.play(ev.agent, ev.clip, typeof ev.times === 'number' ? ev.times : 1);
  // a program was opened or closed: light its tile and the desks that use it
  if (ev.type === 'programs') {
    GET<Program[]>('/programs')
      .then((p) => {
        if (!S || !p) return;
        S.progs = p;
        if (!floorBusy && signature() !== S.signature) rebuild();
        drawHud();
        if (S.selected) renderPanel();
      })
      .catch(() => {});
    return;
  }
  if (isEvent(ev, 'team')) {
    const e = ev.event;
    const b = S.branches.get(ev.teamId);
    if (e.kind === 'state') {
      S.teamState[ev.teamId] = { working: e.working, queued: e.queued };
      shareTeams();
      updateStatuses();
    } else if (e.kind === 'message') {
      const m = e.message;
      S.teamLast[ev.teamId] = m;
      const nameOf = (id: string) => (id === 'brain' ? 'Brain' : d?.agents.find((a) => a.id === id)?.name || 'Agent');
      // (you and the Brain both write from the middle of the map)
      if (b && (m.from === 'user' || m.from === 'brain')) pulseAlong(ev.teamId, 0, 1, 6);
      if (b && m.from !== 'user' && m.from !== 'system' && m.from !== 'brain') {
        for (const id of m.mentions || []) pulseHandoff(ev.teamId, m.from, id);
        if (!m.mentions?.length) b.flash = Math.max(b.flash || 0, 0.5);
      }
      const tname = S.workflows.find((w) => w.id === ev.teamId)?.name || 'Team';
      if (m.from !== 'system') feedPush(`${tname} · ${m.from === 'user' ? 'You' : nameOf(m.from)}${m.mentions?.length && m.from !== 'user' ? ` → ${m.mentions.map(nameOf).join(', ')}` : ''}: ${String(m.text).slice(0, 60)}`, 'workflow');
      drawBranchCard(ev.teamId);
    }
    return;
  }
  if (ev.type === 'project') {
    closeChatsForProject();
    choose(null);
    S.shape = null;
    // the old floor slides away, the new one comes in from the other side (down the list = it rises from below)
    const to = String(ev.id || '');
    const dir = floorDirection((state.data?.projects || []).map((p) => p.id), floorId, to) || 1;
    floorId = to || floorId;
    setFloorBusy(true);
    Promise.all([loadData(), floorSlide('out', dir)])
      .then(async () => {
        if (!S) return;
        // (the old floor has already slid away, so the heavy part happens while nothing is visible)
        rebuild();
        drawHud();
        resetView();
        // draw the new map once now (it is still hidden): the card uploads every shape and texture on its first draw, and that must not
        // happen on the first frame of the slide-in
        S.renderer.compile(S.scene, S.camera);
        renderStation();
        await frames(1);
        void floorSlide('in', dir);
      })
      .catch(() => {})
      .finally(() => {
        setFloorBusy(false);
        endFloorOut();
        // anything that changed meanwhile (an agent started, a program opened) is picked up now
        if (S && signature() !== S.signature) rebuild();
      });
    return;
  }
  if (isEvent(ev, 'workflow-run') && ev.run) {
    const r = ev.run;
    const prev = S.active.get(r.workflowId);
    const prevIdx = prev ? prev.steps.findIndex((s) => s.status === 'running' || s.status === 'needs-you') : -1;
    const idx = r.steps.findIndex((s) => s.status === 'running' || s.status === 'needs-you');
    const wf = S.workflows.find((w) => w.id === r.workflowId);
    const b = S.branches.get(r.workflowId);
    if (r.status === 'running') {
      S.active.set(r.workflowId, r);
      if (b && idx !== prevIdx && idx >= 0) {
        // the step's own agent (pods seat the lead first, so the step number isn't the desk number)
        const stepAgent = r.steps[idx].agentId;
        if (stepAgent) pulseToDesk(r.workflowId, stepAgent);
        feedPush(`${wf?.name || 'Team'} → step ${idx + 1}: ${r.steps[idx].label}`, 'workflow');
        const node = stepAgent ? b.nodes.find((n) => n.agentId === stepAgent) : undefined;
        if (node) for (const l of node.links) pulseIntegration(l, node);
      }
    } else {
      S.active.delete(r.workflowId);
      if (b) pulseAlong(r.workflowId, 1, 0, 8);
      feedPush(`${wf?.name || 'Team'} ${r.status === 'done' ? 'finished ✓' : r.status}${r.error ? `: ${r.error}` : ''}`, r.status === 'failed' ? 'error' : 'workflow');
      GET<WorkflowRun[]>('/workflow-runs').then((runs) => S && ((S.wfRuns = runs), updateStatuses()));
    }
    updateStatuses();
    drawHud();
    if (S.selected?.type === 'branch' && S.selected.id === r.workflowId) renderPanel();
    return;
  }
  if (isEvent(ev, 'run')) {
    const a = d?.agents.find((x) => x.id === ev.agentId);
    const e = ev.event;
    const desks = S.desks.filter((x) => x.agent.id === ev.agentId);
    if (e.kind === 'start' && a) {
      for (const desk of desks) if (desk.wfId) pulseToDesk(desk.wfId, desk.agent.id);
      for (const desk of desks) desk.act = { kind: 'thinking', since: Date.now() };
      if (!/^(workflow|team)/.test(e.from || '')) feedPush(`${a.emoji || ''} ${a.name}: ${String(e.text || '').slice(0, 70)}`);
    } else if (e.kind === 'tool') {
      for (const desk of desks) {
        desk.activity = e.name;
        desk.act = { kind: 'tool', ...describeTool(e.name, e.args as ToolArgs | undefined), since: Date.now() };
        drawScreen(desk, S.clock.elapsedTime);
      }
      const intId = toolIntegration(e.name);
      if (intId) {
        const nodes = S.nodes.filter((n) => n.agentId === ev.agentId);
        if (nodes.length) nodes.forEach((n) => pulseIntegration(intId, n));
        else pulseIntegration(intId, null);
      }
      if (a) feedPush(`${a.name} → ${e.name}`);
    } else if (e.kind === 'text') {
      for (const desk of desks) if (desk.act?.kind !== 'tool') desk.act = { kind: 'writing', since: desk.act?.since || Date.now() };
    } else if (e.kind === 'tool_result') {
      for (const desk of desks) desk.act = { kind: 'thinking', since: Date.now() };
    } else if (e.kind === 'done' && a) feedPush(`${a.emoji || ''} ${a.name} finished (${e.seconds}s)`);
    else if (e.kind === 'error' && a) feedPush(`${a.name}: ${String(e.text).slice(0, 80)}`, 'error');
  } else if (isEvent(ev, 'activity') && ev.entry && !['run', 'workflow'].includes(ev.entry.kind)) feedPush(ev.entry.text, ev.entry.kind);
}

/** Shown on the map: it and everything it sits in are visible (a skin may have hidden the classic model). */
function shownOnMap(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}
