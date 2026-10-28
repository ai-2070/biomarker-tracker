// ComfyUI: find the running server, list saved workflows, run them with your changes, collect images.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serviceUrl, comfyWorkflowDirs, launchProgram } from './programs.ts';
import { fetchJSON, readJSON, listFiles, dataPath, ensureDir } from './util.ts';
import type { FetchError } from './util.ts';
import type { ServerResponse } from 'node:http';

/** A saved workflow file (ours in data/comfy-workflows, or one from ComfyUI's own folders). */
export interface ComfyWorkflowFile {
  name: string;
  file: string;
  dir: string;
}

/** A node of a workflow in API format (what /prompt takes). Inputs are values or [nodeId, slot] links. */
export interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}
export type ApiWorkflow = Record<string, ApiNode>;

/** A workflow as the ComfyUI editor saves it (only the fields used here). */
interface UiNode {
  id: number | string;
  type: string;
  mode?: number;
  title?: string;
  inputs?: { name: string; link: number | null }[];
  widgets_values?: unknown[] | Record<string, unknown>;
}
type UiLink = [number, number | string, number, ...unknown[]] | { id: number; origin_id: number | string; origin_slot: number };
interface UiWorkflow {
  nodes: UiNode[];
  links?: UiLink[];
}

/** /object_info: every node type's inputs, each [type, options]. */
type InputSpec = [unknown, { forceInput?: boolean; control_after_generate?: unknown }?];
interface NodeDef {
  input?: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> };
  display_name?: string;
}
type ObjectInfo = Record<string, NodeDef>;

/** A file in a /history entry's outputs. */
export interface ComfyOutputFile {
  filename: string;
  subfolder?: string;
  type?: string;
  [k: string]: unknown;
}
interface HistoryEntry {
  status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string }][] };
  outputs?: Record<string, Record<string, ComfyOutputFile[] | undefined>>;
}

/** An output file with its kind ('images', 'gifs', 'videos', 'audio') and a dashboard URL to view it. */
export type ComfyResultFile = ComfyOutputFile & { kind: string; url: string };

export interface RunWorkflowOptions {
  workflow?: string;
  prompt?: string | null;
  negative?: string | null;
  inputs?: Record<string, unknown>;
  randomizeSeed?: boolean;
  wait?: boolean;
  timeoutSec?: number;
  onProgress?: (seconds: number) => void;
  signal?: AbortSignal | null;
}
export interface RunWorkflowQueued {
  promptId: string;
  queued: true;
  warnings: string[];
}
export interface RunWorkflowDone {
  promptId: string;
  workflow: string;
  files: ComfyResultFile[];
  seconds: number;
  warnings: string[];
}

export interface ComfyQueueStatus {
  running: boolean;
  url?: string;
  queueRunning?: number;
  queuePending?: number;
  devices?: { name: string; vramFreeGB: number; vramTotalGB: number }[];
  version?: string | null;
}

const API_DIR = ensureDir(dataPath('comfy-workflows'));

export async function comfyUrl(): Promise<string | null> {
  return serviceUrl('comfyui');
}

async function requireUrl(): Promise<string> {
  const url = await comfyUrl();
  if (!url) throw new Error('ComfyUI is not running. Start it from Programs (or call launch_program "comfyui"), wait for it to load, then try again.');
  return url;
}

export function listWorkflows(): ComfyWorkflowFile[] {
  const out: ComfyWorkflowFile[] = [];
  for (const dir of [API_DIR, ...comfyWorkflowDirs()]) {
    for (const f of listFiles(dir, (n) => n.endsWith('.json'))) {
      out.push({ name: f.replace(/\.json$/, ''), file: path.join(dir, f), dir });
    }
  }
  return out;
}

function findWorkflow(name: string | undefined): ComfyWorkflowFile | null {
  const all = listWorkflows();
  const n = String(name || '').replace(/\.json$/, '').toLowerCase();
  return all.find((w) => w.name.toLowerCase() === n) || all.find((w) => w.name.toLowerCase().includes(n)) || null;
}

const isApiFormat = (wf: Record<string, unknown>): wf is ApiWorkflow => !!wf && !Array.isArray(wf.nodes) && Object.values(wf).every((n) => n && typeof n === 'object' && 'class_type' in n);

let objectInfoCache: { url: string | null; at: number; data: ObjectInfo | null } = { url: null, at: 0, data: null };
async function objectInfo(url: string): Promise<ObjectInfo> {
  if (objectInfoCache.url === url && Date.now() - objectInfoCache.at < 10 * 60_000) return objectInfoCache.data!;
  const data = await fetchJSON<ObjectInfo>(`${url}/object_info`, { timeout: 30000 });
  objectInfoCache = { url, at: Date.now(), data };
  return data;
}

// Turn a workflow saved from the ComfyUI editor into the API format /prompt expects.
function uiToApi(wf: UiWorkflow, info: ObjectInfo): { api: ApiWorkflow; warnings: string[] } {
  const nodes = new Map<number | string, UiNode>(wf.nodes.map((n): [number | string, UiNode] => [n.id, n]));
  type Link = { from: number | string; slot: number };
  const links = new Map<number, Link>((wf.links || []).map((l): [number, Link] => (Array.isArray(l) ? [l[0], { from: l[1], slot: l[2] }] : [l.id, { from: l.origin_id, slot: l.origin_slot }])));
  const warnings: string[] = [];

  // Follow a link back through Reroute nodes to the real producer.
  const resolve = (linkId: number, guard = 0): { value?: unknown; ref?: [string, number] } | null => {
    const l = links.get(linkId);
    if (!l || guard > 50) return null;
    const src = nodes.get(l.from);
    if (!src) return null;
    if (src.type === 'Reroute' || src.mode === 4) {
      const inLink = src.inputs?.find((i) => i.link != null)?.link;
      return inLink != null ? resolve(inLink, guard + 1) : null;
    }
    if (src.type === 'PrimitiveNode') return { value: (src.widgets_values as unknown[] | undefined)?.[0] };
    return { ref: [String(src.id), l.slot] };
  };

  const api: ApiWorkflow = {};
  for (const node of wf.nodes) {
    if (node.mode === 2 || node.mode === 4) continue; // muted or bypassed
    if (['Reroute', 'PrimitiveNode', 'Note', 'MarkdownNote'].includes(node.type)) continue;
    const def = info[node.type];
    if (!def) {
      warnings.push(`Node ${node.id} (${node.type}) is not known to this ComfyUI${/^[0-9a-f-]{36}$/.test(node.type) ? ' (it is a subgraph; export the workflow with "Export (API)" instead)' : ''}.`);
      continue;
    }
    const inputs: Record<string, unknown> = {};
    const order = [...Object.entries(def.input?.required || {}), ...Object.entries(def.input?.optional || {})];
    const linked = new Map<string, number>();
    for (const inp of node.inputs || []) if (inp.link != null) linked.set(inp.name, inp.link);
    const wv = node.widgets_values;
    let wi = 0;
    for (const [name, spec] of order) {
      const type = spec?.[0];
      const opts = spec?.[1] || {};
      const isWidget = Array.isArray(type) || (['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'] as unknown[]).includes(type) || opts.forceInput === false;
      if (linked.has(name)) {
        const r = resolve(linked.get(name)!);
        if (r?.ref) inputs[name] = r.ref;
        else if (r && 'value' in r) inputs[name] = r.value;
        if (isWidget && !opts.forceInput) {
          wi++;
          if (opts.control_after_generate || /^(noise_)?seed$/.test(name)) wi++;
        }
        continue;
      }
      if (!isWidget || opts.forceInput) continue;
      if (wv && !Array.isArray(wv) && typeof wv === 'object') {
        if (name in wv) inputs[name] = wv[name];
        continue;
      }
      if (Array.isArray(wv) && wi < wv.length) inputs[name] = wv[wi];
      wi++;
      if (opts.control_after_generate || ((type === 'INT') && /^(noise_)?seed$/.test(name))) wi++;
    }
    api[String(node.id)] = { class_type: node.type, inputs, _meta: { title: node.title || def.display_name || node.type } };
  }
  return { api, warnings };
}

async function loadApiWorkflow(name: string | undefined, url: string): Promise<{ api: ApiWorkflow; warnings: string[]; workflow: ComfyWorkflowFile }> {
  const w = findWorkflow(name);
  if (!w) throw new Error(`No ComfyUI workflow called "${name}". Available: ${listWorkflows().map((x) => x.name).join(', ') || 'none'}.`);
  const raw = readJSON<Record<string, unknown>>(w.file);
  if (!raw) throw new Error(`Couldn't read ${w.file}.`);
  if (isApiFormat(raw)) return { api: raw, warnings: [], workflow: w };
  if (!Array.isArray(raw.nodes)) throw new Error(`${w.name} is not a ComfyUI workflow file.`);
  const { api, warnings } = uiToApi(raw as unknown as UiWorkflow, await objectInfo(url));
  return { api, warnings, workflow: w };
}

// What can be changed in a workflow: every node's plain inputs, keyed "nodeId.input".
export async function describeWorkflow(name: string | undefined) {
  const url = await requireUrl();
  const { api, warnings, workflow } = await loadApiWorkflow(name, url);
  const editable: Record<string, { node: string; value: unknown }> = {};
  for (const [id, n] of Object.entries(api)) {
    for (const [k, v] of Object.entries(n.inputs)) {
      if (!Array.isArray(v)) editable[`${id}.${k}`] = { node: n._meta?.title || n.class_type, value: typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v };
    }
  }
  return { workflow: workflow.name, file: workflow.file, prompts: findPromptNodes(api), editable, warnings };
}

// Which text nodes feed a sampler's positive and negative inputs.
function findPromptNodes(api: ApiWorkflow): { positive: string | null; negative: string | null } {
  const res: { positive: string | null; negative: string | null } = { positive: null, negative: null };
  for (const n of Object.values(api)) {
    for (const key of ['positive', 'negative'] as const) {
      const ref = n.inputs?.[key] as [string, number] | undefined;
      if (Array.isArray(ref) && !res[key]) {
        let target = api[ref[0]];
        let id = ref[0];
        // walk through conditioning helpers to the text encoder
        for (let i = 0; i < 6 && target && !('text' in (target.inputs || {})); i++) {
          const next = Object.values(target.inputs || {}).find((v): v is [string, number] => Array.isArray(v));
          if (!next) break;
          id = next[0];
          target = api[id];
        }
        if (target && 'text' in target.inputs) res[key] = id;
      }
    }
  }
  return res;
}

export function runWorkflow(opts: RunWorkflowOptions & { wait: false }): Promise<RunWorkflowQueued>;
export function runWorkflow(opts?: RunWorkflowOptions & { wait?: true }): Promise<RunWorkflowDone>;
export function runWorkflow(opts?: RunWorkflowOptions): Promise<RunWorkflowQueued | RunWorkflowDone>;
export async function runWorkflow({ workflow, prompt, negative, inputs = {}, randomizeSeed = true, wait = true, timeoutSec = 600, onProgress, signal }: RunWorkflowOptions = {}): Promise<RunWorkflowQueued | RunWorkflowDone> {
  const url = await requireUrl();
  const { api, warnings, workflow: w } = await loadApiWorkflow(workflow, url);
  const p = findPromptNodes(api);
  if (prompt != null) {
    if (!p.positive) throw new Error('Could not find the positive prompt node; set it with inputs {"<nodeId>.text": "..."} (see comfyui_describe_workflow).');
    api[p.positive]!.inputs.text = prompt;
  }
  if (negative != null && p.negative) api[p.negative].inputs.text = negative;
  for (const [key, value] of Object.entries(inputs || {})) {
    const [id, ...rest] = key.split('.');
    const field = rest.join('.');
    if (!api[id]) throw new Error(`Workflow has no node ${id}.`);
    api[id].inputs[field] = value;
  }
  if (randomizeSeed) {
    for (const [id, n] of Object.entries(api)) {
      for (const k of ['seed', 'noise_seed']) if (typeof n.inputs[k] === 'number' && !(`${id}.${k}` in inputs)) n.inputs[k] = Math.floor(Math.random() * 2 ** 48);
    }
  }
  for (const n of Object.values(api)) delete n._meta;
  const clientId = crypto.randomUUID();
  const res = await fetchJSON<{ prompt_id: string }>(`${url}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: api, client_id: clientId }),
    timeout: 30000,
  }).catch((e: FetchError) => {
    const body = e.body as { node_errors?: unknown } | undefined;
    const err = body?.node_errors ? `${e.message}\n${JSON.stringify(body.node_errors).slice(0, 1500)}` : e.message;
    throw new Error(`ComfyUI rejected the workflow: ${err}`);
  });
  const promptId = res.prompt_id;
  if (!wait) return { promptId, queued: true as const, warnings };
  const started = Date.now();
  while (Date.now() - started < timeoutSec * 1000) {
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) {
      await cancelPrompt(url, promptId);
      throw new Error('Stopped.');
    }
    const hist = await fetchJSON<Record<string, HistoryEntry>>(`${url}/history/${promptId}`, { timeout: 15000 }).catch(() => null);
    const entry = hist?.[promptId];
    if (entry?.status?.status_str === 'error') {
      const msg = entry.status.messages?.find((m) => m[0] === 'execution_error')?.[1];
      throw new Error(`ComfyUI failed: ${msg?.exception_message || 'see the ComfyUI console'}`);
    }
    if (entry?.outputs && (entry.status?.completed || Object.keys(entry.outputs).length)) {
      const files: ComfyResultFile[] = [];
      for (const out of Object.values(entry.outputs)) {
        for (const kind of ['images', 'gifs', 'videos', 'audio']) {
          for (const f of out[kind] || []) {
            const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
            files.push({ ...f, kind, url: `/api/comfyui/view?${q}` });
          }
        }
      }
      return { promptId, workflow: w.name, files, seconds: Math.round((Date.now() - started) / 1000), warnings };
    }
    onProgress?.(Math.round((Date.now() - started) / 1000));
  }
  throw new Error(`Still running after ${timeoutSec}s (prompt ${promptId}). Check ComfyUI.`);
}

/** Takes one job off ComfyUI: out of the queue, and interrupted only when it is the one running now
 *  (an interrupt stops whatever runs, which may be someone else's job). */
export async function cancelPrompt(url: string, promptId: string): Promise<void> {
  const json = { 'content-type': 'application/json' };
  await fetch(`${url}/queue`, { method: 'POST', headers: json, body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
  const q = await fetchJSON<{ queue_running?: unknown[][] }>(`${url}/queue`, { timeout: 10000 }).catch(() => null);
  if (!q?.queue_running?.some((job) => Array.isArray(job) && job[1] === promptId)) return;
  // (newer ComfyUI interrupts only the prompt named; older ones the running one, which is this one)
  await fetch(`${url}/interrupt`, { method: 'POST', headers: json, body: JSON.stringify({ prompt_id: promptId }) }).catch(() => {});
}

export async function queueStatus(): Promise<ComfyQueueStatus> {
  const url = await comfyUrl();
  if (!url) return { running: false };
  const [q, stats] = await Promise.all([
    fetchJSON<{ queue_running?: unknown[]; queue_pending?: unknown[] }>(`${url}/queue`).catch(() => null),
    fetchJSON<{ devices?: { name: string; vram_free: number; vram_total: number }[]; system?: { comfyui_version?: string } }>(`${url}/system_stats`).catch(() => null),
  ]);
  return {
    running: true,
    url,
    queueRunning: q?.queue_running?.length || 0,
    queuePending: q?.queue_pending?.length || 0,
    devices: stats?.devices?.map((d) => ({ name: d.name, vramFreeGB: +(d.vram_free / 1e9).toFixed(1), vramTotalGB: +(d.vram_total / 1e9).toFixed(1) })) || [],
    version: stats?.system?.comfyui_version || null,
  };
}

export async function proxyView(query: Record<string, string>, res: ServerResponse): Promise<void> {
  const url = await requireUrl();
  const r = await fetch(`${url}/view?${new URLSearchParams(query)}`);
  const type = r.headers.get('content-type') || 'application/octet-stream';
  const inline = /^(image\/(png|jpeg|webp|gif)|video\/|audio\/)/.test(type);
  res.writeHead(r.status, { 'content-type': type, 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox; default-src none', ...(inline ? {} : { 'content-disposition': 'attachment' }) });
  res.end(Buffer.from(await r.arrayBuffer()));
}

/** A result picture's bytes (a /api/comfyui/view link's filename, subfolder and type), for a model to see.
 *  Only PNG, JPEG, WebP or GIF up to max bytes; else null. */
export async function viewImage(link: string, max: number): Promise<{ mime: string; bytes: Buffer } | null> {
  const m = /^\/api\/comfyui\/view\?(.*)$/s.exec(link);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const url = await comfyUrl();
  if (!url || !q.get('filename')) return null;
  const r = await fetch(`${url}/view?${new URLSearchParams({ filename: q.get('filename') || '', subfolder: q.get('subfolder') || '', type: q.get('type') || 'output' })}`, { signal: AbortSignal.timeout(30000) });
  const mime = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!r.ok || !/^image\/(png|jpeg|webp|gif)$/.test(mime) || Number(r.headers.get('content-length') || 0) > max) return null;
  const bytes = Buffer.from(await r.arrayBuffer());
  return bytes.length && bytes.length <= max ? { mime, bytes } : null;
}

export async function startComfy(): Promise<string> {
  return launchProgram('comfyui');
}

export function saveApiWorkflow(name: string, json: unknown): string {
  const file = path.join(API_DIR, `${name.replace(/[^\w.-]+/g, '_')}.json`);
  fs.writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json, null, 2));
  return file;
}
