// Built-in tools. Every agent gets the groups switched on in its settings.
// Risk decides when you're asked first: autonomy "ask" checks low + high, "auto" checks high only, "full" never asks.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ROOT, IS_WIN, dataPath, ensureDir, run, truncate, tmpFile, openWithShell, launchDetached, exists, which, insideRoots } from './util.ts';
import * as assetLib from './assets.ts';
import type { AssetSource, AssetKind } from './assets.ts';
import { mayaScript, houdiniScript, sibling, sbsrenderArgs, openscadArgs, prusaSlicerArgs, nvttArgs, handbrakeArgs, GPU_FIELDS, formatGpus } from './dcc.ts';
import { agents as agentStore, chats, getSettings, emit, log } from './store.ts';
import { startHandoff, awaitHandoff, listHandoffs, DEFAULT_WAIT_S, MAX_WAIT_S } from './handoffs.ts';

/** Hermes' own MCP tool timeout is 300 s: await_agent answers it well within that. */
const HERMES_WAIT_S = 240;
import { requestApproval } from './approvals.ts';
import { agentFetch } from './agentfetch.ts';
import { accountOf } from './mcp.ts';
import { knownPrograms, launchProgram, launchTarget, programExe, startMenuApps } from './programs.ts';
import * as comfy from './comfyui.ts';
import * as social from './social.ts';
import * as reddit from './reddit.ts';
import * as kb from './knowledge.ts';
import * as memory from './memory.ts';
import { withActor } from './versions.ts';
import { ensureBrain } from './projects.ts';
import { safeUploadsRoot } from './uploads.ts';
import * as skills from './skills.ts';
import { findAgent } from '../shared/agentref.ts';
import * as voxel from './voxel/tools.ts';
import type { Agent, ToolGroup } from '../shared/types.ts';

/** none: never asks. low: asks when autonomy is "ask". high: asks unless autonomy is "full". */
export type Risk = 'none' | 'low' | 'high';

/** The JSON Schema of a tool's arguments (what the model sees). */
export interface JSONSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  [k: string]: unknown;
}

/** Arguments as the model sent them (parsed JSON, not checked against the schema). */
export type ToolArgs = Record<string, unknown>;

export interface ToolResult {
  text: string;
  isError?: boolean;
  images?: string[];
  /** Set by gate() when the user said no. */
  denied?: boolean;
}

/** The part of an agent the tools use. Dashboard agents fit; so do stand-ins (workflows, external MCP clients). */
export type ToolAgent = Pick<Agent, 'id' | 'name'> & Partial<Pick<Agent, 'toolGroups' | 'autonomy' | 'alwaysAllow' | 'workspace' | 'knowledge'>>;

/** Which run a tool call belongs to: approvals, the Stop button and delegation depth come from here. */
export interface ToolRunInfo {
  runId?: string | null;
  depth?: number;
  signal?: AbortSignal;
  /** Shows a status line while a slow tool works. */
  progress?: (text: string) => void;
  /** The MCP server an API-model agent's tool call goes to: its approval names the account. */
  mcpServer?: string;
}

export interface ToolContext extends ToolRunInfo {
  agent: ToolAgent;
}

// Declared as methods so each tool can name the arguments it expects (the model's JSON is taken as that shape).
type RiskOf = { bivarianceHack(args: ToolArgs): Risk }['bivarianceHack'];

export interface ToolDef {
  name: string;
  group: string;
  risk: Risk | RiskOf;
  description: string;
  parameters: JSONSchema;
  run(args: ToolArgs, ctx: ToolContext): Promise<ToolResult>;
}

/** What the engines and the MCP bridge tell the model about a tool. */
export type ToolSpec = Pick<ToolDef, 'name' | 'description' | 'parameters'>;

export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'programs', label: 'Programs', description: 'See what is installed and start programs, files and folders.' },
  { id: 'browser', label: 'Browser', description: 'Open pages in your browser and read web pages.' },
  { id: 'comfyui', label: 'ComfyUI', description: 'Run your ComfyUI workflows and get the images back.' },
  { id: 'blender', label: 'Blender', description: 'Run Blender Python (modeling, rendering, exports).' },
  { id: 'adobe', label: 'Adobe', description: 'Photoshop and After Effects scripts, open Premiere projects.' },
  { id: 'maya', label: 'Maya', description: 'Run Maya Python (scenes, rigging, animation, renders, exports).' },
  { id: 'houdini', label: 'Houdini', description: 'Run Houdini Python (node networks, simulations, renders, exports).' },
  { id: 'substance', label: 'Substance 3D', description: 'Render Substance materials to texture maps, open Painter, Designer and Sampler.' },
  { id: 'cad', label: 'CAD and 3D printing', description: 'Turn OpenSCAD models into STL and other files, slice models into G-code.' },
  { id: 'nvidia', label: 'NVIDIA', description: 'See how busy the graphics cards are, convert textures to DDS.' },
  { id: 'assets', label: 'Free asset libraries', description: 'Search and download free CC0 HDRIs, PBR textures and models from Poly Haven and ambientCG.' },
  { id: 'media', label: 'FFmpeg, HandBrake and ImageMagick', description: 'Convert, cut and inspect audio and video, shrink videos with HandBrake presets, edit images in bulk with ImageMagick.' },
  { id: 'social', label: 'Social', description: 'Draft X and Reddit posts (they wait in the Outbox unless auto-post is on), read posts, mentions and subreddits, Telegram, Discord.' },
  { id: 'agents', label: 'Delegate', description: 'Ask other agents and Hermes profiles for help.' },
  { id: 'files', label: 'Files', description: 'Read and write files in its workspace and folders you allow.' },
  { id: 'orca', label: 'Orca', description: 'Run Orca CLI commands (worktrees, terminals, its browser).' },
  { id: 'world', label: 'Voxel world', description: 'Build the voxel world around the Station (places, props, prefabs to place many times) and keep its WORLD.md up to date.' },
  { id: 'shell', label: 'Shell', description: 'Run any PowerShell command. Powerful: you are asked each time unless autonomy is Full.' },
];

export function workspaceOf(agent: { workspace?: string }): string {
  // By default every agent works in the project's Brain folder.
  return ensureDir(agent.workspace && path.isAbsolute(agent.workspace) ? agent.workspace : ensureBrain());
}

// Reading: workspace, outputs, knowledge, allowed folders. Writing: not linked knowledge folders.
function allowedRoots(agent: ToolAgent, write = false): string[] {
  const s = getSettings();
  // attached files (the Brain folder's uploads/) can be read even by an agent with its own workspace
  // (not when uploads/ is a link out of the Brain folder)
  const uploads = write ? null : safeUploadsRoot();
  return [workspaceOf(agent), dataPath('outputs'), ...(write ? [] : kb.knowledgeRoots(agent)), ...(uploads ? [uploads] : []), ...(s.allowedFolders || [])];
}

// abs: the path as asked (for messages). real: where it really is, links followed; use it for the file
// operation. ok only when the real location is inside an allowed folder, so a link in the workspace
// can't reach the rest of the disk.
function resolveInside(agent: ToolAgent, p: string | undefined, { write = false } = {}): { abs: string; real: string; ok: boolean } {
  const abs = path.resolve(workspaceOf(agent), String(p || '.'));
  const real = insideRoots(abs, allowedRoots(agent, write));
  return { abs, real: real || abs, ok: !!real };
}

// Files that run code when opened (Adobe apps run the .jsx / .jsxbin scripts they are handed).
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|jsx|jsxbin|wsf|wsh|hta|msi|msp|scr|cpl|lnk|url|reg|jar|py|pyw|sh|command|scpt|applescript|appref-ms|application|gadget|inf|pif|scf)$/i;
// Programs that run whatever they are given.
const INTERPRETERS = /^(cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32|python\d*|py|node|bun|deno|ruby|perl|php|java|javaw|osascript|bash|sh|zsh|wsl|msiexec|reg|schtasks|certutil|bitsadmin|curl|wget)(\.exe)?$/i;
// A name as Windows opens it: trailing spaces and dots don't count ("x.py. " opens x.py), nor a ::$DATA stream.
const asOpened = (p: unknown): string => String(p ?? '').trim().replace(/::\$data$/i, '').replace(/[\s.]+$/, '');
const runnable = (p: unknown): boolean => RUNNABLE.test(asOpened(p));

/** The chat a tool call runs in (to tell which team it is for). */
const chatOf = async (ctx: ToolContext): Promise<string | null> => (await import('./engines/index.ts')).runInfo(ctx.runId)?.chatId ?? null;
const str = (description: string): JSONSchema => ({ type: 'string', description });
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({ type: 'object', properties, required });

const TOOLS: ToolDef[] = [
  // ---------- skills (every agent; the list it has is in its instructions) ----------
  {
    name: 'read_skill',
    group: 'core',
    risk: 'none',
    description: 'Open one of your skills (listed under "Your skills" in your instructions) and get its full instructions. Pass file to read one of the extra files that come with the skill (long ones in parts, with from), or find to search the skill\'s files (like grep).',
    parameters: obj(
      {
        name: str('The skill id as listed (or its name)'),
        file: str('Optional: a file that belongs to the skill, e.g. references/commands.md'),
        find: str("Optional: search for lines that match (words or a regular expression, any case), in file or else in all the skill's files. Use it for long reference files instead of reading them whole."),
        from: { type: 'number', description: 'Optional: with file, the line to start reading from (for a file too long to read in one go)' },
      },
      ['name'],
    ),
    run: async ({ name, file, find, from }: { name: string; file?: string; find?: string; from?: number }) => {
      const s = skills.findSkill(name);
      if (!s) return { text: `There is no skill called "${name}". Your skills are listed in your instructions.`, isError: true };
      if (find) return { text: `# ${s.name}: lines matching "${find}"\n\n${skills.searchSkill(s.slug, find, file)}` };
      if (file) return { text: `# ${s.name} / ${file}\n\n${skills.readSkillFile(s.slug, file, from)}` };
      // Hermes skills name their folder ${HERMES_SKILL_DIR}, or write out where Hermes keeps it
      // (~/.hermes/skills/<category>/<id>): point both at this one, so agents with a shell can use the files directly
      const dir = skills.skillDir(s.slug).split(path.sep).join('/');
      const inHermes = new RegExp(`(?:~|\\$HOME|\\$\\{HOME\\})/\\.hermes/skills/(?:[\\w.-]+/)*?${s.slug.replaceAll('.', '\\.')}(?![\\w.-])`, 'g');
      const body = s.body.replaceAll('${HERMES_SKILL_DIR}', dir).replace(inHermes, dir);
      const files = s.files.length ? `\n\n---\nFiles with this skill, in its folder ${dir} (read with read_skill name="${s.slug}" file="...", or search them with find="..."; with a shell, run its scripts from that folder): ${s.files.map((f) => f.path).join(', ')}` : '';
      return { text: `# Skill: ${s.name}\n${s.description}\n\n${body}${files}` };
    },
  },
  // ---------- chat history (every agent; what a compaction left out) ----------
  {
    name: 'recall_history',
    group: 'core',
    risk: 'none',
    description: 'Read earlier parts of this chat word for word. After a chat is compacted you see its older history as "[seq N]" entries with long messages cut and tool results left out: pass seq=N for one entry in full (a message, or a tool call with its whole result), from/to for a range (up to 40), or query to search the whole chat.',
    parameters: obj({ seq: { type: 'number', description: 'One entry, by its seq' }, from: { type: 'number', description: 'First seq of a range' }, to: { type: 'number', description: 'Last seq of a range' }, query: str('Words to search for') }),
    run: async (args, ctx) => {
      const { runInfo, liveChat } = await import('./engines/index.ts');
      const { recall } = await import('./compaction.ts');
      const run = runInfo(ctx.runId);
      const chat = run ? liveChat(run.chatId, run.projectId) || chats.get(run.agentId, run.chatId) : null;
      if (!chat) return { text: 'recall_history only works inside a dashboard chat.', isError: true };
      return recall(chat.items, args);
    },
  },
  {
    name: 'save_artifact',
    group: 'core',
    risk: 'none',
    description: 'Hand in a finished result that is not an outgoing post or email: a written answer, a file or a folder (a render, a report, a cut video). It appears in the Outbox page under Artifacts with who made it, which team it was for and when. Give either path (full path of a file or folder inside the project) or text (the result, in Markdown). Posts and emails go to the Outbox instead.',
    parameters: obj({ title: str('Short name for the result'), path: str('Full path of the file or folder'), text: str('The result itself, when it is text'), note: str('One line: what it is or how to use it') }, ['title']),
    run: async ({ title, path: target, text, note }: { title: string; path?: string; text?: string; note?: string }, ctx) => {
      const { addArtifact } = await import('./artifacts.ts');
      const a = addArtifact({ title, path: target, text, note, agentId: ctx.agent.id, chatId: await chatOf(ctx) });
      return { text: `Saved to Artifacts${a.teamName ? ` (team ${a.teamName})` : ''}: ${a.title}.` };
    },
  },
  // ---------- asking the user (every agent) ----------
  {
    name: 'ask_user',
    group: 'core',
    risk: 'none',
    description:
      "Ask the user when you need them: a decision or a choice between options, something only they know or can do (a login, a key, a file, an OK), or when you are stuck. It goes to their Outbox with your choices as buttons and a box for an answer in their own words, and you get their answer back. Use this instead of asking in your reply (they may not be watching this chat). Give 2-6 short choices whenever there are options; leave choices out only for an open question. One question per call. If no answer comes in time, end your turn and say you are waiting: the answer comes to you later as a new message.",
    parameters: obj(
      {
        question: str('The question, short and plain, e.g. "Which style should the logo use?"'),
        choices: { type: 'array', items: { type: 'string' }, description: 'The answers the user can click, each a few words, e.g. ["Flat", "3D", "Hand-drawn"]. They can always write their own answer instead.' },
        detail: str('Optional: what they need to know to decide (what you tried, what each choice means). Markdown, a few lines.'),
      },
      ['question'],
    ),
    run: async ({ question, choices, detail }: { question: string; choices?: unknown; detail?: string }, ctx) => {
      const q = await import('./questions.ts');
      // Hermes gives up on an MCP call after 5 minutes: wait less there, and the answer comes as a message
      const hermes = agentStore.get(ctx.agent.id)?.engine === 'hermes';
      const waitMs = hermes ? HERMES_WAIT_S * 1000 : q.WAIT_MS;
      const asker = agentStore.get(ctx.agent.id) ? ctx.agent.id : null;
      const { question: asked, outcome } = await q.ask({ question, detail, choices, agentId: asker, chatId: await chatOf(ctx), runId: ctx.runId || null }, { signal: ctx.signal, waitMs });
      if (outcome.kind === 'answer') return { text: q.answerResult(outcome) };
      if (outcome.kind === 'dismissed') return { text: "The user dismissed the question without answering. Don't ask it again: carry on with what you can, or say in your reply what is blocking you." };
      if (outcome.kind === 'stopped') return { text: 'Stopped.', isError: true };
      const where = asked.teamId ? 'in the team chat' : asked.chatId ? 'in this chat' : null;
      return { text: `No answer yet (waited ${Math.round(waitMs / 60_000)} minutes). The question stays in the user's Outbox${where ? `, and their answer will come to you as a new message ${where}` : ''}. End your turn now: say in one line that you are waiting for their answer, and don't guess it.` };
    },
  },
  // ---------- programs ----------
  {
    name: 'list_programs',
    group: 'programs',
    risk: 'none',
    description: 'List the programs and local AI services found on this PC, whether each is running, and what it can do. Pass all=true to also list every Start Menu app.',
    parameters: obj({ all: { type: 'boolean', description: 'Include every Start Menu shortcut' } }),
    run: async ({ all }: { all?: boolean }) => {
      // what the hourly background scan found: an agent never waits for a scan
      const progs = knownPrograms();
      const lines = progs
        .filter((p) => p.installed)
        .map((p) => `- ${p.name} [${p.id}]${p.version ? ` v${p.version}` : ''}${p.running ? ' (running' + (p.serviceUrl ? ` at ${p.serviceUrl}` : '') + ')' : ''}`);
      let text = `Installed programs:\n${lines.join('\n')}`;
      if (all) text += `\n\nStart Menu apps:\n${startMenuApps().map((a) => `- ${a.name}`).join('\n')}`;
      return { text };
    },
  },
  {
    name: 'launch_program',
    group: 'programs',
    // Plain launches are low risk; extra arguments, runnable files or shells need a yes.
    // Judged on the program it really starts: the same one launchProgram picks.
    risk: ({ program, file, args }: LaunchArgs) => {
      if ((args && args.length) || (file && runnable(file))) return 'high';
      const target = launchTarget(program, !!file);
      const exe = target ? target.exe || target.shortcut : '';
      return [asOpened(program), asOpened(exe)].some((p) => INTERPRETERS.test(path.basename(p))) ? 'high' : 'low';
    },
    description: 'Start a program by name or id (e.g. "blender", "premiere", "comfyui", "LM Studio", any Start Menu app). Optionally open a file with it.',
    parameters: obj({ program: str('Program name or id'), file: str('Optional file to open with it'), args: { type: 'array', items: { type: 'string' } } }, ['program']),
    run: async ({ program, file, args }: LaunchArgs) => ({ text: await launchProgram(program, { file, args }) }),
  },
  {
    name: 'open_path',
    group: 'programs',
    risk: ({ path: p }: { path: string }) => (runnable(p) ? 'high' : 'low'),
    description: 'Open a file or folder with its default program (Explorer for folders).',
    parameters: obj({ path: str('Absolute path') }, ['path']),
    run: async ({ path: p }: { path: string }) => {
      if (!exists(p)) throw new Error(`${p} does not exist.`);
      openWithShell(p);
      return { text: `Opened ${p}` };
    },
  },
  // ---------- browser ----------
  {
    name: 'open_url',
    group: 'browser',
    risk: 'low',
    description: 'Open a web page for the user in their browser (default browser, or chrome/edge/opera).',
    parameters: obj({ url: str('http(s) URL'), browser: str('Optional: chrome, edge or opera') }, ['url']),
    run: async ({ url, browser }: { url: string; browser?: string }) => {
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened.');
      const exe = browser ? programExe(browser.toLowerCase()) : null;
      if (exe) launchDetached(exe, [url]);
      else openWithShell(url);
      return { text: `Opened ${url}${exe ? ` in ${browser}` : ''}.` };
    },
  },
  {
    name: 'fetch_url',
    group: 'browser',
    risk: 'none',
    description: 'Download a web page or API response and return its readable text (scripts and styles removed). For interactive browsing add the Playwright MCP server.',
    parameters: obj({ url: str('http(s) URL'), max_chars: { type: 'number' } }, ['url']),
    run: async ({ url, max_chars = 20000 }: { url: string; max_chars?: number }) => {
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs.');
      // (never the dashboard itself, not even through a redirect)
      const { res, url: final } = await agentFetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) blacksite/0.1.0' }, signal: AbortSignal.timeout(30000) });
      const type = res.headers.get('content-type') || '';
      let body = await res.text();
      if (/html/i.test(type)) body = htmlToText(body);
      return { text: `HTTP ${res.status} ${final}\n\n${truncate(body, max_chars)}` };
    },
  },
  // ---------- ComfyUI ----------
  {
    name: 'comfyui_status',
    group: 'comfyui',
    risk: 'none',
    description: 'Is ComfyUI running, its queue and GPU memory.',
    parameters: obj({}),
    run: async () => ({ text: JSON.stringify(await comfy.queueStatus(), null, 2) }),
  },
  {
    name: 'comfyui_start',
    group: 'comfyui',
    risk: 'low',
    description: 'Start ComfyUI (the desktop app). It takes a little while before it accepts jobs; check with comfyui_status.',
    parameters: obj({}),
    run: async () => ({ text: await comfy.startComfy() }),
  },
  {
    name: 'comfyui_list_workflows',
    group: 'comfyui',
    risk: 'none',
    description: 'List the saved ComfyUI workflows that can be run.',
    parameters: obj({}),
    run: async () => ({ text: comfy.listWorkflows().map((w) => `- ${w.name}`).join('\n') || 'No workflows found. Save one in ComfyUI first.' }),
  },
  {
    name: 'comfyui_describe_workflow',
    group: 'comfyui',
    risk: 'none',
    description: 'Show which inputs a workflow has (keyed "nodeId.input") and which nodes hold the positive/negative prompt.',
    parameters: obj({ workflow: str('Workflow name') }, ['workflow']),
    run: async ({ workflow }: { workflow: string }) => ({ text: JSON.stringify(await comfy.describeWorkflow(workflow), null, 2) }),
  },
  {
    name: 'comfyui_run',
    group: 'comfyui',
    risk: 'low',
    description: 'Run a ComfyUI workflow and wait for the results. Set prompt/negative to replace the prompt text, inputs to change anything else ({"3.steps": 30, "5.width": 1024}). Seeds are randomized unless you set them.',
    parameters: obj(
      {
        workflow: str('Workflow name'),
        prompt: str('Positive prompt text'),
        negative: str('Negative prompt text'),
        inputs: { type: 'object', description: 'Other changes as {"nodeId.input": value}' },
        randomize_seed: { type: 'boolean' },
      },
      ['workflow'],
    ),
    run: async ({ workflow, prompt, negative, inputs, randomize_seed = true }: ComfyRunArgs, ctx) => {
      const r = await comfy.runWorkflow({ workflow, prompt, negative, inputs, randomizeSeed: randomize_seed, signal: ctx.signal, onProgress: (s: number) => ctx.progress?.(`ComfyUI working… ${s}s`) });
      const imgs = r.files.filter((f) => f.kind === 'images').map((f) => f.url);
      return {
        text: `Done in ${r.seconds}s. Files:\n${r.files.map((f) => `- ${f.filename} (${f.kind}, ${f.type}${f.subfolder ? `/${f.subfolder}` : ''})`).join('\n')}${r.warnings.length ? `\nWarnings:\n${r.warnings.join('\n')}` : ''}`,
        images: imgs,
      };
    },
  },
  // ---------- Blender ----------
  {
    name: 'blender_run_python',
    group: 'blender',
    risk: 'high', // Python can do anything; "Always allow" it for agents you trust with Blender

    description: 'Run a Python script in Blender (bpy) without opening its window, optionally on a .blend file, and return what it prints. Use it to build scenes, render (bpy.ops.render.render(write_still=True)), import/export models. Save outputs to absolute paths.',
    parameters: obj({ code: str('Python code using bpy'), blend_file: str('Optional .blend to open first'), save_as: str('Optional path to save the .blend afterwards') }, ['code']),
    run: async ({ code, blend_file, save_as }: { code: string; blend_file?: string; save_as?: string }, ctx) => {
      const exe = programExe('blender');
      if (!exe) throw new Error('Blender was not found. Set its path in Settings.');
      const script = tmpFile('blender.py');
      const footer = save_as ? `\nimport bpy as __b\n__b.ops.wm.save_as_mainfile(filepath=${JSON.stringify(save_as)})\nprint("Saved", ${JSON.stringify(save_as)})\n` : '';
      fs.writeFileSync(script, `${code}\n${footer}`);
      const args = ['-b', ...(blend_file ? [blend_file] : ['--factory-startup']), '--python', script, '--python-exit-code', '1'];
      const r = await run(exe, args, { timeout: 15 * 60_000, signal: ctx.signal });
      const out = (r.stdout + '\n' + r.stderr)
        .split(/\r?\n/)
        .filter((l) => !/^(Blender \d|Read prefs|Warning: \(|Color management|found bundled python|Fra:\d+ Mem:)/.test(l))
        .join('\n');
      return { text: `${r.code === 0 ? 'Finished' : `Failed (exit ${r.code})`}\n${truncate(out.trim(), 12000)}`, isError: r.code !== 0 };
    },
  },
  {
    name: 'blender_open',
    group: 'blender',
    risk: 'low',
    description: 'Open Blender with its window, optionally loading a .blend file.',
    parameters: obj({ file: str('Optional .blend file') }),
    run: async ({ file }: { file?: string }) => ({ text: await launchProgram('blender', { file }) }),
  },
  // ---------- Adobe ----------
  {
    name: 'photoshop_run_script',
    group: 'adobe',
    risk: 'high',
    description: 'Run ExtendScript (JavaScript) in Photoshop, starting it if needed. Use log(value) to send text back; a returned value is sent back too. Example: app.documents.add(1920,1080); return app.activeDocument.name;',
    parameters: obj({ code: str('ExtendScript code (body of a function)') }, ['code']),
    run: async ({ code }: { code: string }) => runJsx('photoshop', code),
  },
  {
    name: 'aftereffects_run_script',
    group: 'adobe',
    risk: 'high',
    description: 'Run ExtendScript in After Effects (starting it if needed). log(value) and return values come back. After Effects needs "Allow Scripts to Write Files and Access Network" turned on in Preferences > Scripting & Expressions.',
    parameters: obj({ code: str('ExtendScript code (body of a function)') }, ['code']),
    run: async ({ code }: { code: string }) => runJsx('aftereffects', code),
  },
  {
    name: 'premiere_open',
    group: 'adobe',
    risk: 'low',
    description: 'Open Premiere Pro, optionally with a project (.prproj) or media file. For timeline editing use ffmpeg, or add a Premiere MCP server.',
    parameters: obj({ file: str('Optional .prproj or media file') }),
    run: async ({ file }: { file?: string }) => ({ text: await launchProgram('premiere', { file }) }),
  },
  // ---------- Maya ----------
  {
    name: 'maya_run_python',
    group: 'maya',
    risk: 'high', // Python can do anything
    description: 'Run Python in Maya without opening its window (mayapy, maya.cmds is imported as cmds), optionally on a scene, and return what it prints. Use it to build and rig scenes, key animation, bake, render and export (FBX, Alembic, OBJ). Save outputs to absolute paths.',
    parameters: obj({ code: str('Python code using maya.cmds (as cmds)'), scene: str('Optional .ma/.mb scene to open first'), save_as: str('Optional .ma or .mb path to save the scene afterwards') }, ['code']),
    run: async ({ code, scene, save_as }: { code: string; scene?: string; save_as?: string }, ctx) => {
      const exe = programExe('maya');
      if (!exe) throw new Error('Maya was not found. Set its path in Settings.');
      return runPython(sibling(exe, IS_WIN ? 'mayapy.exe' : 'mayapy'), mayaScript({ code, scene, saveAs: save_as }), ctx);
    },
  },
  {
    name: 'maya_open',
    group: 'maya',
    risk: 'low',
    description: 'Open Maya with its window, optionally loading a scene (.ma/.mb) or model file.',
    parameters: obj({ file: str('Optional scene or model file') }),
    run: async ({ file }: { file?: string }) => ({ text: await launchProgram('maya', { file }) }),
  },
  // ---------- Houdini ----------
  {
    name: 'houdini_run_python',
    group: 'houdini',
    risk: 'high', // Python can do anything
    description: 'Run Python in Houdini without opening its window (hython, hou is imported), optionally on a .hip file, and return what it prints. Use it to build node networks, simulate, cook and render ROPs, and export geometry (bgeo, USD, Alembic, FBX). Save outputs to absolute paths.',
    parameters: obj({ code: str('Python code using hou'), hip: str('Optional .hip/.hipnc file to open first'), save_as: str('Optional .hip path to save afterwards') }, ['code']),
    run: async ({ code, hip, save_as }: { code: string; hip?: string; save_as?: string }, ctx) => {
      const exe = programExe('houdini');
      if (!exe) throw new Error('Houdini was not found. Set its path in Settings.');
      return runPython(sibling(exe, IS_WIN ? 'hython.exe' : 'hython'), houdiniScript({ code, hip, saveAs: save_as }), ctx);
    },
  },
  {
    name: 'houdini_open',
    group: 'houdini',
    risk: 'low',
    description: 'Open Houdini with its window, optionally loading a .hip file.',
    parameters: obj({ file: str('Optional .hip file') }),
    run: async ({ file }: { file?: string }) => ({ text: await launchProgram('houdini', { file }) }),
  },
  // ---------- Substance 3D ----------
  {
    name: 'substance_render',
    group: 'substance',
    risk: 'low',
    description: 'Render a Substance material (.sbsar) to texture maps (base color, normal, roughness and so on, one file per output) with sbsrender from Substance 3D Designer. Set the size (1024, 2048, 4096…) and any exposed parameters by name.',
    parameters: obj(
      {
        input: str('The .sbsar file'),
        output_dir: str('Folder for the texture files (relative = workspace)'),
        format: str('png (default), jpg, tga, tif, exr, hdr, bmp, psd or dds'),
        size: { type: 'number', description: 'Texture size in pixels, a power of two (e.g. 2048)' },
        graph: str('Optional graph inside the .sbsar, when it has several'),
        values: { type: 'object', description: 'Optional exposed parameters, name to value, e.g. {"$randomseed": 7, "roughness": 0.4}' },
      },
      ['input', 'output_dir'],
    ),
    run: async ({ input, output_dir, format, size, graph, values }: { input: string; output_dir: string; format?: string; size?: number; graph?: string; values?: Record<string, string | number> }, ctx) => {
      const designer = programExe('designer');
      const exe = (designer && [sibling(designer, 'sbsrender.exe')].find(exists)) || which('sbsrender');
      if (!exe) throw new Error('sbsrender was not found. It comes with Substance 3D Designer; set Designer\'s path in Settings.');
      const src = readablePath(ctx, input);
      const out = writableDir(ctx, output_dir);
      const r = await run(exe, sbsrenderArgs({ input: src, outputDir: out, format, size, graph, values }), { timeout: 30 * 60_000, signal: ctx.signal });
      const made = fs.readdirSync(out).filter((f) => !f.startsWith('.'));
      return { text: `${r.code === 0 ? `Rendered into ${out}` : `sbsrender failed (exit ${r.code})`}\n${truncate((r.stdout + '\n' + r.stderr).trim(), 4000)}\nFiles there now: ${made.join(', ') || 'none'}`, isError: r.code !== 0 };
    },
  },
  {
    name: 'substance_open',
    group: 'substance',
    risk: 'low',
    description: 'Open Substance 3D Painter, Designer or Sampler, optionally with a file. Painter starts with remote scripting on, so a Substance Painter MCP server can drive it.',
    parameters: obj({ app: { type: 'string', enum: ['painter', 'designer', 'sampler'], description: 'Which app' }, file: str('Optional project or file to open') }, ['app']),
    run: async ({ app, file }: { app: string; file?: string }) => {
      if (!['painter', 'designer', 'sampler'].includes(app)) throw new Error('app must be painter, designer or sampler.');
      return { text: await launchProgram(app, { file, args: app === 'painter' ? ['--enable-remote-scripting'] : [] }) };
    },
  },
  // ---------- CAD and 3D printing ----------
  {
    name: 'openscad_render',
    group: 'cad',
    risk: 'low',
    description: 'Turn an OpenSCAD model (a .scad file, or OpenSCAD code you write) into an STL, 3MF, OBJ, DXF, SVG or PNG. Set model variables with defines, e.g. {"width": 40, "label": "A"}.',
    parameters: obj(
      {
        input: str('A .scad file (or use code)'),
        code: str('OpenSCAD code to render instead of a file'),
        output: str('Output file; its extension picks the format (.stl, .3mf, .obj, .off, .amf, .dxf, .svg, .png, .pdf)'),
        defines: { type: 'object', description: 'Optional variables to set, name to value' },
      },
      ['output'],
    ),
    run: async ({ input, code, output, defines }: { input?: string; code?: string; output: string; defines?: Record<string, string | number | boolean> }, ctx) => {
      const main = programExe('openscad');
      if (!main) throw new Error('OpenSCAD was not found. Install it or set its path in Settings.');
      // on Windows openscad.com is the console version, so its messages come back
      const exe = [sibling(main, 'openscad.com')].find(exists) || main;
      if (!input && !code) throw new Error('Give a .scad file (input) or OpenSCAD code (code).');
      let src: string;
      if (code) {
        src = tmpFile('model.scad');
        fs.writeFileSync(src, code);
      } else src = readablePath(ctx, input);
      const out = writablePath(ctx, output);
      const r = await run(exe, openscadArgs({ input: src, output: out, defines }), { timeout: 15 * 60_000, signal: ctx.signal });
      const ok = r.code === 0 && exists(out);
      return { text: `${ok ? `Saved ${out}` : `OpenSCAD failed (exit ${r.code})`}\n${truncate(r.stderr.trim(), 6000)}`, isError: !ok };
    },
  },
  {
    name: 'slice_model',
    group: 'cad',
    risk: 'low',
    description: 'Slice a 3D model (STL, 3MF, OBJ, STEP) into G-code for a 3D printer with PrusaSlicer. Load printer, filament and print profiles exported from PrusaSlicer (.ini), and change single settings such as {"layer-height": 0.2, "fill-density": "20%", "support-material": true}. It does not start a print.',
    parameters: obj(
      {
        input: str('The model file'),
        output: str('The .gcode (or .bgcode) file to write'),
        profiles: { type: 'array', items: { type: 'string' }, description: 'Optional .ini profile files to load, in order' },
        settings: { type: 'object', description: 'Optional PrusaSlicer settings, name to value' },
      },
      ['input', 'output'],
    ),
    run: async ({ input, output, profiles, settings }: { input: string; output: string; profiles?: string[]; settings?: Record<string, string | number | boolean> }, ctx) => {
      const main = programExe('prusaslicer');
      const exe = (main && [sibling(main, 'prusa-slicer-console.exe')].find(exists)) || which('prusa-slicer-console') || main;
      if (!exe) throw new Error('PrusaSlicer was not found. Install it or set its path in Settings.');
      const out = writablePath(ctx, output);
      const args = prusaSlicerArgs({ input: readablePath(ctx, input), output: out, profiles: (profiles || []).map((p) => readablePath(ctx, p)), settings });
      const r = await run(exe, args, { timeout: 30 * 60_000, signal: ctx.signal });
      const ok = r.code === 0 && exists(out);
      return { text: `${ok ? `Saved ${out}` : `PrusaSlicer failed (exit ${r.code})`}\n${truncate((r.stdout + '\n' + r.stderr).trim().split(/\r?\n/).slice(-30).join('\n'), 6000)}`, isError: !ok };
    },
  },
  // ---------- free asset libraries ----------
  {
    name: 'asset_search',
    group: 'assets',
    risk: 'none',
    description: 'Search free CC0 asset libraries: Poly Haven (HDRIs, PBR textures, models) and ambientCG (PBR materials, HDRIs, models). Free for any use, no credit needed. Returns ids for asset_download.',
    parameters: obj(
      {
        source: { type: 'string', enum: ['polyhaven', 'ambientcg'], description: 'Which library' },
        kind: { type: 'string', enum: ['hdri', 'texture', 'model'], description: 'Optional: only this kind' },
        query: str('Words to look for, e.g. "worn brick" or "forest sunset"'),
        category: str('Optional Poly Haven category, e.g. "outdoor", "wood"'),
        limit: { type: 'number', description: 'How many (default 20)' },
      },
      ['source'],
    ),
    run: async ({ source, kind, query, category, limit }: { source: AssetSource; kind?: AssetKind; query?: string; category?: string; limit?: number }) => {
      const hits = source === 'ambientcg' ? await assetLib.ambientcgSearch({ kind, query, limit }) : await assetLib.polyhavenSearch({ kind, query, category, limit });
      if (!hits.length) return { text: 'Nothing found. Try fewer or other words.' };
      return { text: hits.map((a) => `${a.id}: ${a.name} (${a.kind}${a.categories.length ? `; ${a.categories.join(', ')}` : ''}${a.maxSize ? `; up to ${a.maxSize}` : ''})${a.tags.length ? ` tags: ${a.tags.join(', ')}` : ''}`).join('\n') + (source === 'ambientcg' ? '\nFrom ambientCG.' : '\nPowered by Poly Haven.') };
    },
  },
  {
    name: 'asset_download',
    group: 'assets',
    risk: 'low',
    description: 'Download a free asset from Poly Haven or ambientCG into a folder (relative = workspace). Textures come as one file per map (color, normal, roughness, AO, displacement…). Poly Haven: resolution 1k/2k/4k/8k, format jpg/png/exr for texture maps, hdr/exr for HDRIs, gltf/fbx/blend for models (with their textures). ambientCG: resolution 1K/2K/4K/8K, format JPG or PNG (EXR for HDRIs).',
    parameters: obj(
      {
        source: { type: 'string', enum: ['polyhaven', 'ambientcg'], description: 'Which library' },
        id: str('The asset id from asset_search'),
        folder: str('Folder to save into (a folder named after the asset is made inside)'),
        resolution: str('Size, e.g. 2k (default)'),
        format: str('File format, see above'),
      },
      ['source', 'id', 'folder'],
    ),
    run: async ({ source, id, folder, resolution, format }: { source: AssetSource; id: string; folder: string; resolution?: string; format?: string }, ctx) => {
      if (source !== 'polyhaven' && source !== 'ambientcg') throw new Error('source must be polyhaven or ambientcg.');
      if (!/^[\w-]+$/.test(String(id))) throw new Error('That is not an asset id.');
      // (the asset's own folder too: one already there could be a link out of the allowed folders)
      const dir = writableDir(ctx, path.join(String(folder || '.'), id));
      ctx.progress?.(`Downloading ${id}…`);
      const files = await assetLib.downloadAsset(source, id, dir, { resolution, format, signal: ctx.signal });
      return { text: `Saved ${files.length} file${files.length === 1 ? '' : 's'} in ${dir}:\n${files.join('\n')}\nLicence: CC0 (free for any use, no credit needed). ${source === 'polyhaven' ? 'Powered by Poly Haven (polyhaven.com).' : 'From ambientCG (ambientcg.com).'}` };
    },
  },
  // ---------- NVIDIA ----------
  {
    name: 'nvidia_gpu_status',
    group: 'nvidia',
    risk: 'none',
    description: 'How busy the NVIDIA graphics cards are: name, driver, load, temperature, memory and power. Check it before a big render or AI job.',
    parameters: obj({}),
    run: async () => {
      const exe = which('nvidia-smi');
      if (!exe) throw new Error('nvidia-smi was not found. It comes with the NVIDIA graphics driver.');
      const r = await run(exe, [`--query-gpu=${GPU_FIELDS.join(',')}`, '--format=csv,noheader,nounits'], { timeout: 20000 });
      if (r.code !== 0) return { text: `nvidia-smi failed (exit ${r.code})\n${truncate(r.stderr || r.stdout, 2000)}`, isError: true };
      return { text: formatGpus(r.stdout) };
    },
  },
  {
    name: 'nvidia_texture_export',
    group: 'nvidia',
    risk: 'low',
    description: 'Compress an image (PNG, TGA, JPG, EXR…) into a DDS or KTX texture for games with the NVIDIA Texture Tools Exporter. Formats: bc7 (default, color), bc1 (color, smallest), bc3 (color with alpha), bc4 (one channel, e.g. roughness), bc5 (normal maps), rgba8 (no compression).',
    parameters: obj(
      {
        input: str('The image file'),
        output: str('The .dds, .ktx or .ktx2 file to write'),
        format: str('Compression format, e.g. bc7, bc1, bc3, bc4, bc5, rgba8'),
        mips: { type: 'boolean', description: 'Make mipmaps (default true)' },
      },
      ['input', 'output'],
    ),
    run: async ({ input, output, format, mips }: { input: string; output: string; format?: string; mips?: boolean }, ctx) => {
      const exe = programExe('nvtt') || which('nvtt_export');
      if (!exe) throw new Error('The NVIDIA Texture Tools Exporter was not found. Install it from developer.nvidia.com/texture-tools-exporter or set its path in Settings.');
      const out = writablePath(ctx, output);
      const r = await run(exe, nvttArgs({ input: readablePath(ctx, input), output: out, format, mips: mips !== false }), { timeout: 15 * 60_000, signal: ctx.signal });
      const ok = r.code === 0 && exists(out);
      return { text: `${ok ? `Saved ${out}` : `nvtt_export failed (exit ${r.code})`}\n${truncate((r.stdout + '\n' + r.stderr).trim(), 4000)}`, isError: !ok };
    },
  },
  // ---------- media ----------
  {
    name: 'ffmpeg',
    group: 'media',
    risk: 'high', // it can overwrite any file; "Always allow" it for your video agents
    description: 'Run ffmpeg with the given arguments (no shell). Always pass -y and absolute output paths. Example args: ["-y","-i","C:/in.mp4","-ss","5","-t","10","C:/out.mp4"].',
    parameters: obj({ args: { type: 'array', items: { type: 'string' } } }, ['args']),
    run: async ({ args }: { args: string[] }, ctx) => {
      if (!which('ffmpeg')) throw new Error('ffmpeg is not installed.');
      const r = await run('ffmpeg', ['-hide_banner', ...args], { timeout: 60 * 60_000, signal: ctx.signal });
      return { text: `${r.code === 0 ? 'Done' : `ffmpeg failed (exit ${r.code})`}\n${truncate(r.stderr.split(/\r?\n/).slice(-40).join('\n'), 6000)}`, isError: r.code !== 0 };
    },
  },
  {
    name: 'handbrake_encode',
    group: 'media',
    risk: 'low',
    description: 'Convert or shrink a video with HandBrake (HandBrakeCLI) using one of its presets, e.g. "Fast 1080p30" (default), "Fast 720p30", "HQ 1080p30 Surround", "Fast 2160p60 4K HEVC". Optional quality (RF, lower is better, 18–28 is usual) and encoder (x264, x265, svt_av1, or nvenc_h264 / nvenc_h265 on NVIDIA cards). Set list_presets to see every preset.',
    parameters: obj({
      input: str('The video file'),
      output: str('The .mp4, .mkv or .webm file to write'),
      preset: str('HandBrake preset name'),
      quality: { type: 'number', description: 'Optional constant quality (RF)' },
      encoder: str('Optional video encoder'),
      list_presets: { type: 'boolean', description: 'Only list the presets' },
    }),
    run: async ({ input, output, preset, quality, encoder, list_presets }: { input?: string; output?: string; preset?: string; quality?: number; encoder?: string; list_presets?: boolean }, ctx) => {
      const exe = programExe('handbrakecli') || which('HandBrakeCLI');
      if (!exe) throw new Error('HandBrakeCLI was not found. It is a separate free download from handbrake.fr/downloads2.php (the HandBrake window app is not enough); then set its path in Settings or put it on PATH.');
      if (list_presets) {
        const r = await run(exe, ['--preset-list'], { timeout: 60000 });
        return { text: truncate((r.stdout + '\n' + r.stderr).trim(), 10000) };
      }
      if (!input || !output) throw new Error('Give input and output.');
      const out = writablePath(ctx, output);
      ctx.progress?.('HandBrake is encoding…');
      const r = await run(exe, handbrakeArgs({ input: readablePath(ctx, input), output: out, preset, quality, encoder }), { timeout: 4 * 60 * 60_000, signal: ctx.signal });
      const ok = r.code === 0 && exists(out);
      return { text: `${ok ? `Saved ${out}` : `HandBrake failed (exit ${r.code})`}\n${truncate(r.stderr.split(/\r?\n/).filter((l) => l.trim() && !/^Encoding: task/.test(l)).slice(-25).join('\n'), 5000)}`, isError: !ok };
    },
  },
  {
    name: 'imagemagick',
    group: 'media',
    risk: 'high', // it can read and overwrite any file; "Always allow" it for your image agents
    description: 'Run ImageMagick (magick) with the given arguments (no shell) to resize, crop, convert, combine, add text or batch-edit images. Use absolute paths and write to new files. Example args: ["C:/in.png","-resize","50%","C:/out.webp"]. For many files use ["mogrify","-path","C:/out","-resize","1024x1024","C:/in/*.png"].',
    parameters: obj({ args: { type: 'array', items: { type: 'string' } } }, ['args']),
    run: async ({ args }: { args: string[] }, ctx) => {
      const exe = programExe('imagemagick');
      if (!exe) throw new Error('ImageMagick is not installed (imagemagick.org/script/download.php), or set its path in Settings.');
      if (!Array.isArray(args) || !args.length) throw new Error('Give the arguments as a list.');
      const r = await run(exe, args.map(String), { timeout: 30 * 60_000, signal: ctx.signal });
      return { text: `${r.code === 0 ? 'Done' : `ImageMagick failed (exit ${r.code})`}\n${truncate((r.stdout + '\n' + r.stderr).trim(), 6000)}`, isError: r.code !== 0 };
    },
  },
  {
    name: 'ffprobe',
    group: 'media',
    risk: 'none',
    description: 'Show duration, streams and format of an audio or video file.',
    parameters: obj({ file: str('Absolute path') }, ['file']),
    run: async ({ file }: { file: string }) => {
      const r = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { timeout: 60000 });
      return { text: truncate(r.stdout || r.stderr, 8000) };
    },
  },
  // ---------- social ----------
  {
    name: 'social_accounts',
    group: 'social',
    risk: 'none',
    description: 'List connected social accounts.',
    parameters: obj({}),
    run: async () => {
      const a = social.listAccounts();
      return {
        text: `X: ${a.x.map((x) => `@${x.username}${x.autopost ? ' (auto-post on)' : ' (approve first)'}`).join(', ') || 'none connected'}\nReddit: ${a.reddit.map((x) => `u/${x.username}`).join(', ') || 'none connected'}\nTelegram: ${a.telegram.configured ? 'ready' : 'not set up'}\nDiscord: ${a.discord.configured ? 'ready' : 'not set up'}`,
      };
    },
  },
  {
    name: 'x_draft_post',
    group: 'social',
    risk: 'none',
    description: 'Write a post (or thread) for X. It goes to the Outbox where the user approves, edits or rejects it; it is only published straight away if that account has auto-post on. Each part max 280 characters. Attach up to 4 images (full paths of PNG/JPEG/WebP files in the project, e.g. ones you rendered) with images; they go on the first post.',
    parameters: obj(
      {
        text: str('The post'),
        thread: { type: 'array', items: { type: 'string' }, description: 'For a thread: every part in order (instead of text)' },
        images: { type: 'array', items: { type: 'string' }, description: 'Full paths of up to 4 image files (PNG, JPEG, WebP, max 5 MB each) to attach to the first post' },
        account: str('Handle to post as (default: first connected)'),
        reply_to: str('Tweet ID to reply to'),
        note: str('Why this post, for the reviewer'),
      },
    ),
    run: async ({ text, thread, images, account, reply_to, note }: { text?: string; thread?: string[]; images?: string[]; account?: string; reply_to?: string; note?: string }, ctx) => {
      // images only from the folders this agent may read, not every agent's workspace
      const r = await social.draftPost({ platform: 'x', text, thread, images, imageRoots: allowedRoots(ctx.agent), account, replyTo: reply_to, note, agentId: ctx.agent.id, chatId: await chatOf(ctx), agentName: ctx.agent.name });
      return { text: r.status === 'posted' ? `Posted: ${r.url}` : r.status === 'failed' ? `Auto-post failed: ${r.error}` : `Saved to the Outbox for approval (id ${r.id}).` };
    },
  },
  {
    name: 'x_draft_dm',
    group: 'social',
    risk: 'none',
    description: 'Write a direct message on X to someone. It always waits in the Outbox for the user to approve, edit or reject; it is never sent on its own.',
    parameters: obj({ to: str('Their X handle, e.g. @someone'), text: str('The message'), account: str('Which of your handles to send from (default: first connected)'), note: str('Why, for the reviewer') }, ['to', 'text']),
    run: async ({ to, text, account, note }: { to: string; text: string; account?: string; note?: string }, ctx) => {
      const r = await social.draftPost({ platform: 'x_dm', to, text, account, note, agentId: ctx.agent.id, chatId: await chatOf(ctx), agentName: ctx.agent.name });
      return { text: `Saved the DM to @${r.to} in the Outbox for approval (id ${r.id}).` };
    },
  },
  {
    name: 'x_recent_posts',
    group: 'social',
    risk: 'none',
    description: "Read a connected account's recent posts with likes, reposts and replies. (Each X read is billed by X.)",
    parameters: obj({ account: str('Handle'), limit: { type: 'number' } }),
    run: async ({ account, limit = 10 }: { account?: string; limit?: number }) => ({ text: JSON.stringify(await social.xRecentPosts(account, limit), null, 2) }),
  },
  {
    name: 'x_mentions',
    group: 'social',
    risk: 'none',
    description: 'Read recent mentions of a connected account. (Each X read is billed by X.)',
    parameters: obj({ account: str('Handle'), limit: { type: 'number' } }),
    run: async ({ account, limit = 10 }: { account?: string; limit?: number }) => ({ text: JSON.stringify(await social.xMentions(account, limit), null, 2) }),
  },
  {
    name: 'reddit_read',
    group: 'social',
    risk: 'none',
    description: 'Read posts from a subreddit (hot, new, top this week, rising): titles, scores, comment counts, links.',
    parameters: obj({ subreddit: str('e.g. LocalLLaMA'), sort: str('hot, new, top or rising'), limit: { type: 'number' } }, ['subreddit']),
    run: async ({ subreddit, sort = 'hot', limit = 10 }: { subreddit: string; sort?: string; limit?: number }) => ({ text: JSON.stringify(await reddit.readSubreddit(subreddit, sort, limit), null, 2) }),
  },
  {
    name: 'reddit_search',
    group: 'social',
    risk: 'none',
    description: 'Search Reddit (optionally inside one subreddit) for posts from the last month.',
    parameters: obj({ query: str('What to look for'), subreddit: str('Optional subreddit'), limit: { type: 'number' } }, ['query']),
    run: async ({ query, subreddit = '', limit = 10 }: { query: string; subreddit?: string; limit?: number }) => ({ text: JSON.stringify(await reddit.searchReddit(query, subreddit, limit), null, 2) }),
  },
  {
    name: 'reddit_comments',
    group: 'social',
    risk: 'none',
    description: "Read a Reddit post and its top comments (give the post URL or id).",
    parameters: obj({ post: str('Post URL or id') }, ['post']),
    run: async ({ post }: { post: string }) => ({ text: JSON.stringify(await reddit.postComments(post), null, 2) }),
  },
  {
    name: 'reddit_draft_post',
    group: 'social',
    risk: 'none',
    description: 'Write a Reddit post. It waits in the Outbox for the user to approve or edit, unless that account has auto-post on, in which case it is published straight away. Follow the subreddit rules; no spam or self-promotion where it is not allowed.',
    parameters: obj({ subreddit: str('Subreddit, e.g. LocalLLaMA'), title: str('Post title'), text: str('Post body (markdown)'), link: str('Or a link to share instead of text'), account: str('Which of your Reddit accounts') }, ['subreddit', 'title']),
    run: async ({ subreddit, title, text, link, account, note }: { subreddit: string; title: string; text?: string; link?: string; account?: string; note?: string }, ctx) => {
      const r = await social.draftPost({ platform: 'reddit', subreddit, title, text, link, account, note, agentId: ctx.agent.id, chatId: await chatOf(ctx), agentName: ctx.agent.name });
      return { text: r.status === 'posted' ? `Posted: ${r.url}` : `Saved to the Outbox for approval (id ${r.id}).` };
    },
  },
  {
    name: 'reddit_draft_comment',
    group: 'social',
    risk: 'none',
    description: 'Write a Reddit comment replying to a post or comment (give its URL or id). It waits in the Outbox for the user to approve, unless that account has auto-post on, in which case it is published straight away.',
    parameters: obj({ reply_to: str('Post or comment URL, or id like t3_abc / t1_abc'), text: str('The comment (markdown)'), account: str('Which of your Reddit accounts') }, ['reply_to', 'text']),
    run: async ({ reply_to, text, account }: { reply_to: string; text: string; account?: string }, ctx) => {
      const r = await social.draftPost({ platform: 'reddit', parent: reply_to, text, account, agentId: ctx.agent.id, chatId: await chatOf(ctx), agentName: ctx.agent.name });
      return { text: r.status === 'posted' ? `Posted: ${r.url}` : `Saved to the Outbox for approval (id ${r.id}).` };
    },
  },
  {
    name: 'telegram_send',
    group: 'social',
    risk: 'high',
    description: 'Send a Telegram message to the configured chat.',
    parameters: obj({ text: str('Message') }, ['text']),
    run: async ({ text }: { text: string }) => ({ text: await social.sendTelegram(text) }),
  },
  {
    name: 'discord_send',
    group: 'social',
    risk: 'high',
    description: 'Post a message to the configured Discord channel webhook.',
    parameters: obj({ text: str('Message') }, ['text']),
    run: async ({ text }: { text: string }) => ({ text: await social.sendDiscord(text) }),
  },
  // ---------- team ----------
  {
    name: 'list_agents',
    group: 'agents',
    risk: 'none',
    description: 'List the other agents on this dashboard and what each is good at.',
    parameters: obj({}),
    run: async (_a, ctx) => ({
      text: agentStore
        .list()
        .filter((a) => a.id !== ctx.agent.id)
        .map((a) => `- ${a.name} [${a.id}]: ${a.specialty || a.description || ''}`)
        .join('\n') || 'No other agents yet.',
    }),
  },
  {
    name: 'ask_agent',
    group: 'agents',
    risk: 'none',
    description:
      'Give a task to another agent. It starts at once and you get a handle back right away (the answer is not in it): keep working, then get the answer with await_agent. To run several tasks in parallel, send them all first, then await each. Say exactly what you need back. A task you hand off is theirs: don\'t also do it yourself.',
    parameters: obj({ agent: str('Agent name, id, or "Name [id]" as list_agents shows it'), message: str('The task or question') }, ['agent', 'message']),
    run: async ({ agent, message }: { agent: string; message: string }, ctx) => {
      if ((ctx.depth || 0) >= 3) throw new Error('Too many agents deep; answer this yourself.');
      const found = findAgent(agentStore.list(), agent);
      if ('error' in found) throw new Error(found.error);
      const target = found.agent;
      if (target.id === ctx.agent.id) throw new Error("That's you.");
      const h = await startHandoff(ctx.agent, target, String(message || ''), { depth: (ctx.depth || 0) + 1, parentRunId: ctx.runId, signal: ctx.signal });
      return { text: `Sent to ${target.name} (handle ${h.id}). They are working on it now. Get the answer with await_agent and handle "${h.id}".` };
    },
  },
  {
    name: 'await_agent',
    group: 'agents',
    risk: 'none',
    description: `Get the answer to a task you gave with ask_agent. Waits up to wait_seconds (default ${DEFAULT_WAIT_S}, at most ${MAX_WAIT_S}); if they are still working, call it again with the same handle until they finish. When their answer is a question, a blocker or something only the user can decide, that is the outcome: pass it on instead of waiting for more. Without a handle: lists your handoffs.`,
    parameters: obj({ handle: str('The handle ask_agent gave you'), wait_seconds: { type: 'number', description: `How long to wait for the answer this time (1-${MAX_WAIT_S})` } }),
    run: async ({ handle, wait_seconds }: { handle?: string; wait_seconds?: number }, ctx) => {
      if (!handle) return { text: listHandoffs(ctx.agent.id) };
      // Hermes gives up on an MCP call after 5 minutes: wait less, and it calls again
      const hermes = agentStore.get(ctx.agent.id)?.engine === 'hermes';
      const wait = hermes ? Math.min(HERMES_WAIT_S, Number(wait_seconds) || HERMES_WAIT_S) : wait_seconds;
      return awaitHandoff(handle, ctx.agent.id, wait, ctx.signal);
    },
  },
  {
    name: 'hermes_ask',
    group: 'agents',
    risk: 'none',
    description: 'Ask one of your Hermes profiles (e.g. net-researcher) a question and get its answer.',
    parameters: obj({ profile: str('Hermes profile name (default profile when empty)'), message: str('Question or task') }, ['message']),
    run: async ({ profile, message }: { profile?: string; message: string }, ctx) => {
      if (profile && !/^[\w.-]+$/.test(profile)) throw new Error('Invalid Hermes profile name.');
      const args = [...(profile ? ['-p', profile] : []), 'chat', '--query-file', '-', '--format', 'text', '-Q'];
      const r = await run('hermes', args, { input: message, timeout: 20 * 60_000, signal: ctx.signal });
      return { text: truncate((r.stdout || r.stderr).replace(/\n?session_id: \S+\s*$/, '').trim(), 20000), isError: r.code !== 0 };
    },
  },
  // ---------- knowledge (added automatically when an agent has knowledge) ----------
  {
    name: 'knowledge_search',
    group: 'knowledge',
    risk: 'none',
    description: 'Search your knowledge files. Returns the best matching passages with file and line.',
    parameters: obj({ query: str('What to look for') }, ['query']),
    run: async ({ query }: { query: string }, ctx) => {
      const hits = kb.searchKnowledge(ctx.agent, query);
      return { text: hits.length ? hits.map((h) => `### ${h.file}:${h.line}\n${h.text}`).join('\n\n') : 'Nothing matched.' };
    },
  },
  {
    name: 'knowledge_read',
    group: 'knowledge',
    risk: 'none',
    description: 'Read one of your knowledge files (400 lines at a time).',
    parameters: obj({ file: str('File name as listed'), from_line: { type: 'number' } }, ['file']),
    run: async ({ file, from_line = 1 }: { file: string; from_line?: number }, ctx) => {
      const r = kb.readKnowledge(ctx.agent, file, from_line);
      return { text: `${r.file} lines ${r.from}-${r.to} of ${r.total}\n\n${r.text}` };
    },
  },
  // ---------- memory (every agent of its own: its MEMORY.md, also in its instructions) ----------
  {
    name: 'memory_read',
    group: 'memory',
    risk: 'none',
    description: 'Read your whole MEMORY.md as it is now (your instructions have it as it was when this chat started).',
    parameters: obj({}),
    run: async (_args, ctx) => ({ text: memory.readMemory(ctx.agent.id).trim() || '(empty: nothing remembered yet)' }),
  },
  {
    name: 'memory_add',
    group: 'memory',
    // (it only adds to the agent's own notes, and every change can be undone in its History)
    risk: 'low',
    description: 'Add one short note to your MEMORY.md, so you still know it in later chats: how the user likes things done, a decision, a fact about the project, a pitfall. Never secrets.',
    parameters: obj({ note: str('The note, one line') }, ['note']),
    run: async ({ note }: { note: string }, ctx) => {
      const m = withActor('agent', () => memory.addToMemory(ctx.agent.id, note));
      return { text: `Remembered. MEMORY.md is now ${m.text.length} characters.` };
    },
  },
  {
    name: 'memory_write',
    group: 'memory',
    risk: 'low',
    description: 'Replace your whole MEMORY.md (markdown), to correct notes, drop outdated ones or tidy it up. Read it first with memory_read so nothing is lost. The earlier version is kept.',
    parameters: obj({ content: str('The whole new MEMORY.md') }, ['content']),
    run: async ({ content }: { content: string }, ctx) => {
      const m = withActor('agent', () => memory.writeMemory(ctx.agent.id, content));
      return { text: `Saved MEMORY.md (${m.text.length} characters).` };
    },
  },
  // ---------- the voxel world (server/voxel/tools.ts) ----------
  ...voxel.worldTools(gate, { readable: readablePath, writableDir }),
  // ---------- files ----------
  {
    name: 'list_files',
    group: 'files',
    risk: 'none',
    description: 'List a folder (relative paths start in your workspace).',
    parameters: obj({ path: str('Folder (default: workspace)') }),
    run: async ({ path: p = '.' }: { path?: string }, ctx) => {
      const { abs, real, ok } = resolveInside(ctx.agent, p);
      if (!ok) throw new Error(`${abs} is outside the folders this agent may use. Add it in Settings > Allowed folders.`);
      const items = fs.readdirSync(real, { withFileTypes: true }).slice(0, 500);
      return { text: `${abs}\n${items.map((d) => `${d.isDirectory() ? '[dir] ' : ''}${d.name}`).join('\n')}` };
    },
  },
  {
    name: 'read_file',
    group: 'files',
    risk: 'none',
    description: 'Read a text file (workspace, knowledge, outputs or allowed folders).',
    parameters: obj({ path: str('File path') }, ['path']),
    run: async ({ path: p }: { path: string }, ctx) => {
      const { abs, real, ok } = resolveInside(ctx.agent, p);
      if (!ok) throw new Error(`${abs} is outside the folders this agent may use.`);
      return { text: truncate(fs.readFileSync(real, 'utf8'), 60000) };
    },
  },
  {
    name: 'write_file',
    group: 'files',
    risk: 'low',
    description: 'Create or overwrite a text file in your workspace or an allowed folder. Returns the full path.',
    parameters: obj({ path: str('File path (relative = workspace)'), content: str('File contents') }, ['path', 'content']),
    run: async ({ path: p, content }: { path: string; content: string }, ctx) => {
      const { abs, real, ok } = resolveInside(ctx.agent, p, { write: true });
      if (!ok) throw new Error(`${abs} is outside the folders this agent may write to.`);
      ensureDir(path.dirname(real));
      fs.writeFileSync(real, content);
      return { text: `Wrote ${abs} (${Buffer.byteLength(content)} bytes)` };
    },
  },
  // ---------- orca ----------
  {
    name: 'orca',
    group: 'orca',
    // Reading state is safe; anything else (spawning agents, terminals) needs a yes.
    risk: ({ args = [] }: { args?: string[] }) => (['status', 'agent-context', 'search'].includes(args[0]) || (args[0] === 'skills' && args[1] === 'list') || (args[0] === 'reference' && ['list', 'find'].includes(args[1])) ? 'none' : 'high'),
    description: 'Run the Orca CLI with these arguments, e.g. ["status"], ["agent-context"] (prints every command), ["skills","list"].',
    parameters: obj({ args: { type: 'array', items: { type: 'string' } } }, ['args']),
    run: async ({ args }: { args: string[] }, ctx) => {
      const r = await run('orca', args, { timeout: 5 * 60_000, signal: ctx.signal });
      return { text: truncate((r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || `(exit ${r.code})`, 20000), isError: r.code !== 0 };
    },
  },
  // ---------- shell ----------
  {
    name: 'run_command',
    group: 'shell',
    risk: 'high',
    description: 'Run a PowerShell command on this PC and return its output. Starts in your workspace.',
    parameters: obj({ command: str('PowerShell command'), cwd: str('Working folder'), timeout_sec: { type: 'number' } }, ['command']),
    run: async ({ command, cwd, timeout_sec = 300 }: { command: string; cwd?: string; timeout_sec?: number }, ctx) => {
      const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: cwd || workspaceOf(ctx.agent), timeout: timeout_sec * 1000, signal: ctx.signal });
      return { text: truncate(`exit ${r.code}\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`, 20000), isError: r.code !== 0 };
    },
  },
  // ---------- always on ----------
  {
    name: 'notify_user',
    group: 'core',
    risk: 'none',
    description: 'Show the user a notification in the dashboard (and on Telegram when telegram=true and it is set up).',
    parameters: obj({ text: str('Message'), telegram: { type: 'boolean' } }, ['text']),
    run: async ({ text, telegram }: { text: string; telegram?: boolean }, ctx) => {
      emit('toast', { text: `${ctx.agent.name}: ${text}` });
      log('notify', `${ctx.agent.name}: ${text}`, { agentId: ctx.agent.id });
      if (telegram) await social.sendTelegram(`${ctx.agent.name}: ${text}`).catch(() => {});
      return { text: 'The user has been notified.' };
    },
  },
];

type LaunchArgs = { program: string; file?: string; args?: string[] };
type ComfyRunArgs = { workflow: string; prompt?: string; negative?: string; inputs?: Record<string, unknown>; randomize_seed?: boolean };

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolsForAgent(agent: ToolAgent): ToolDef[] {
  const groups = new Set(['core', ...(agent.toolGroups || [])]);
  if (kb.knowledgeFiles(agent).length) groups.add('knowledge');
  // a memory of its own: real agents only (not stand-ins like workflows or outside MCP clients)
  if (memory.hasMemory(agent)) groups.add('memory');
  return TOOLS.filter((t) => groups.has(t.group));
}

export function toolDefs(agent: ToolAgent): ToolSpec[] {
  return toolsForAgent(agent).map(({ name, description, parameters }) => ({ name, description, parameters }));
}

export const allTools = (): { name: string; group: string; risk: Risk | 'varies'; description: string }[] =>
  TOOLS.map(({ name, group, risk, description }) => ({ name, group, risk: typeof risk === 'function' ? 'varies' : risk, description }));

export function needsApproval(agent: ToolAgent, risk: Risk, toolName: string): boolean {
  // "Always allow" never covers high-risk calls of tools whose risk depends on the arguments.
  if ((agent.alwaysAllow || []).includes(toolName)) return false;
  const mode = agent.autonomy || 'auto';
  if (mode === 'full') return false;
  if (mode === 'auto') return risk === 'high';
  return risk === 'low' || risk === 'high';
}

// Ask the user when the agent's autonomy says so. Returns null when it may go ahead, else a refusal result.
export async function gate(agent: ToolAgent, name: string, risk: Risk, args: ToolArgs, ctx: ToolRunInfo = {}, detail: string | null | undefined = null): Promise<ToolResult | null> {
  if (!needsApproval(agent, risk, name)) return null;
  // an MCP tool of one account of several says which account: "… wants to use oomol-work__send on OOMOL: Work"
  const account = ctx.mcpServer ? accountOf(ctx.mcpServer) : '';
  const d = await requestApproval({
    kind: 'tool',
    title: `${agent.name} wants to use ${name}${account ? ` on ${account}` : ''}`,
    detail: detail ?? describeCall(name, args),
    agentId: agent.id,
    agentName: agent.name,
    data: { tool: name, args, runId: ctx.runId },
  });
  if (!d.approved) return { text: `The user said no${d.message ? `: ${d.message}` : ''}. Don't retry the same thing; ask what they want instead.`, isError: true, denied: true };
  if (d.always && agent.id && !agent.id.startsWith('_')) {
    // the run asking keeps going with this same agent: the yes counts for the rest of it too
    agent.alwaysAllow = [...new Set([...(agent.alwaysAllow || []), name])];
    const fresh = agentStore.get(agent.id);
    if (fresh) {
      fresh.alwaysAllow = [...new Set([...(fresh.alwaysAllow || []), name])];
      agentStore.save(fresh);
    }
  }
  return null;
}

/** How risky one call of a tool is (a tool given by name: unknown ones are high). */
export function riskOf(tool: ToolDef | string, args: ToolArgs = {}): Risk {
  const t = typeof tool === 'string' ? BY_NAME.get(tool) : tool;
  if (!t) return 'high';
  try {
    return typeof t.risk === 'function' ? t.risk(args) : t.risk;
  } catch {
    return 'high';
  }
}

// Run a tool for an agent, asking the user first when its settings say so.
export async function callTool(agent: ToolAgent, name: string, args: ToolArgs = {}, ctx: ToolRunInfo = {}): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  if (!toolsForAgent(agent).includes(tool)) throw new Error(`${agent.name} isn't allowed to use ${name}. Turn on the "${tool.group}" tools for it.`);
  args = args && typeof args === 'object' ? args : {};
  const risk = riskOf(tool, args);
  // For tools whose risk depends on arguments, "Always allow" only skips the low-risk form.
  const allowName = typeof tool.risk === 'function' && risk === 'high' ? `${name}:high` : name;
  const refused = await gate(agent, allowName, risk, args, ctx, describeCall(name, args));
  if (refused) return refused;
  if (ctx.signal?.aborted) return { text: 'Stopped.', isError: true };
  try {
    const r = await tool.run(args, { ...ctx, agent });
    return { text: String(r?.text ?? ''), images: r?.images || [], isError: !!r?.isError };
  } catch (e) {
    return { text: `Error: ${(e as Error).message}`, isError: true };
  }
}

function describeCall(name: string, args: ToolArgs): string | undefined {
  if (name === 'run_command') return args.command as string | undefined;
  if (name.endsWith('_run_script') || name.endsWith('_run_python')) return args.code as string | undefined;
  if (name === 'write_file') return `${args.path}\n\n${String(args.content || '').slice(0, 1500)}`;
  if (name === 'ffmpeg' || name === 'orca' || name === 'imagemagick') return `${name} ${((args.args as string[] | undefined) || []).join(' ')}`;
  return JSON.stringify(args, null, 2);
}

// ---------- helpers ----------
function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  return (title ? `Title: ${title}\n\n` : '') + html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

// Run a Python script with a program's own Python (mayapy, hython) and return what it printed.
async function runPython(exe: string, script: string, ctx: ToolContext): Promise<ToolResult> {
  if (!exists(exe)) throw new Error(`${path.basename(exe)} was not found next to the program.`);
  const file = tmpFile('script.py');
  fs.writeFileSync(file, script);
  const r = await run(exe, [file], { timeout: 30 * 60_000, signal: ctx.signal });
  return { text: `${r.code === 0 ? 'Finished' : `Failed (exit ${r.code})`}\n${truncate((r.stdout + '\n' + r.stderr).trim(), 12000)}`, isError: r.code !== 0 };
}

// A file an agent may read, as its real path.
function readablePath(ctx: ToolContext, p: string | undefined): string {
  const r = resolveInside(ctx.agent, p);
  if (!r.ok) throw new Error(`${r.abs} is outside the folders this agent may read.`);
  if (!exists(r.real)) throw new Error(`${r.abs} does not exist.`);
  return r.real;
}
// A file an agent may write (its folder is made), as its real path.
function writablePath(ctx: ToolContext, p: string | undefined): string {
  const r = resolveInside(ctx.agent, p, { write: true });
  if (!r.ok) throw new Error(`${r.abs} is outside the folders this agent may write to.`);
  ensureDir(path.dirname(r.real));
  return r.real;
}
function writableDir(ctx: ToolContext, p: string | undefined): string {
  const r = resolveInside(ctx.agent, p, { write: true });
  if (!r.ok) throw new Error(`${r.abs} is outside the folders this agent may write to.`);
  return ensureDir(r.real);
}

async function runJsx(appId: 'photoshop' | 'aftereffects', code: string): Promise<ToolResult> {
  const exe = programExe(appId);
  if (!exe) throw new Error(`${appId === 'photoshop' ? 'Photoshop' : 'After Effects'} was not found. Set its path in Settings.`);
  const outFile = tmpFile('jsx-out.txt').replace(/\\/g, '/');
  const script = tmpFile('script.jsx');
  const wrapped = `#target ${appId === 'photoshop' ? 'photoshop' : 'aftereffects'}
(function(){
  var __f = new File(${JSON.stringify(outFile)});
  function log(v){ __f.encoding = "UTF-8"; __f.open("a"); __f.writeln(String(v)); __f.close(); }
  try {
    var __r = (function(){ ${code}
    })();
    if (__r !== undefined) log(__r);
  } catch (e) { log("ERROR: " + e + (e.line ? " (line " + e.line + ")" : "")); }
  log("__DONE__");
})();`;
  fs.writeFileSync(script, wrapped);
  if (appId === 'photoshop') launchDetached(exe, [script]);
  else launchDetached(exe, ['-r', script]);
  const started = Date.now();
  while (Date.now() - started < 5 * 60_000) {
    await new Promise((r) => setTimeout(r, 1000));
    if (exists(outFile)) {
      const t = fs.readFileSync(outFile, 'utf8');
      if (t.includes('__DONE__')) {
        const text = t.replace(/__DONE__\s*$/, '').trim();
        return { text: text || 'Script finished.', isError: /^ERROR:/m.test(text) };
      }
    }
  }
  return { text: 'The script was sent, but no answer came back within 5 minutes (the app may still be starting, or a dialog is open).', isError: true };
}

export const TOOL_ROOT = ROOT;
export const HOME_DIR = HOME;
