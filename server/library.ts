// Agent library: The Agency (msitarzewski/agency-agents, bundled in library/agency-agents), your Hermes profiles and your Claude Code subagents.
// Plus creating, hiring and exporting agents.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, ROOT, exists, listDirs, listFiles, parseFrontmatter, readJSON, slugify, uid, ensureDir } from './util.ts';
import { agents, getSettings, log } from './store.ts';
import { listProfiles } from './engines/hermes.ts';
import { isEffort } from '../shared/effort.ts';
import type { Agent } from '../shared/types.ts';

/** An agent in The Agency library (not hired yet). */
export interface AgencyAgent {
  slug: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  vibe: string;
  division: string;
  divisionLabel: string;
  file: string;
}

/** A Claude Code subagent (~/.claude/agents/<slug>.md). */
export interface ClaudeSubagent {
  slug: string;
  name: string;
  description: string;
  model: string;
  file: string;
}

/** A ready-made agent you can add in one click. */
export type Starter = Pick<Agent, 'name' | 'emoji' | 'specialty' | 'systemPrompt' | 'toolGroups'> & Partial<Pick<Agent, 'engine' | 'skills'>>;

type DivisionInfo = { id?: string; slug?: string; dir?: string; label?: string };

// The Agency comes with the dashboard: library/agency-agents/ in this repo is a copy of the divisions of
// msitarzewski/agency-agents (its README.md says which commit), so the Library works with no download.
const AGENCY_DIR = path.join(ROOT, 'library', 'agency-agents');
const SKIP_DIRS = new Set(['scripts', 'examples', 'integrations', '.github', 'node_modules']);
// The repo's own notes (README.md, README_zh.md, CONTRIBUTING.md, SECURITY.md). Matched whole: the security
// division's agents are named security-*.md.
const NOT_AGENT = /^(?:(?:README|CONTRIBUTING)(?:[._-].*)?|SECURITY|LICENSE)\.md$/i;

let agencyCache: AgencyAgent[] | null = null;
export function agencyAgents(): AgencyAgent[] {
  if (agencyCache) return agencyCache;
  if (!exists(AGENCY_DIR)) return [];
  const divisions = readJSON<{ divisions?: DivisionInfo[] | Record<string, DivisionInfo> }>(path.join(AGENCY_DIR, 'divisions.json'), {});
  const raw = divisions.divisions || {};
  const labels: Record<string, DivisionInfo> = Array.isArray(raw) ? Object.fromEntries(raw.map((d) => [d.id || d.slug || d.dir, d] as [string, DivisionInfo])) : raw;
  const known = new Set(Object.keys(labels));
  const out: AgencyAgent[] = [];
  const visit = (dir: string, division: string) => {
    for (const f of listFiles(dir, (n) => n.endsWith('.md') && !NOT_AGENT.test(n))) {
      const file = path.join(dir, f);
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const { meta } = parseFrontmatter(text);
      if (!meta.name) continue;
      out.push({
        slug: f.replace(/\.md$/, ''),
        name: meta.name,
        description: meta.description || '',
        emoji: meta.emoji || '🤖',
        color: meta.color || '',
        vibe: meta.vibe || '',
        division,
        divisionLabel: labels[division]?.label || division.replace(/-/g, ' '),
        file,
      });
    }
    for (const sub of listDirs(dir)) if (!SKIP_DIRS.has(sub) && !sub.startsWith('.')) visit(path.join(dir, sub), division);
  };
  for (const d of listDirs(AGENCY_DIR)) if (!SKIP_DIRS.has(d) && !d.startsWith('.') && (!known.size || known.has(d))) visit(path.join(AGENCY_DIR, d), d);
  agencyCache = out.sort((a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name));
  return agencyCache;
}

export function claudeSubagents(): ClaudeSubagent[] {
  const dir = path.join(HOME, '.claude', 'agents');
  return listFiles(dir, (n) => n.endsWith('.md')).map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const { meta } = parseFrontmatter(text);
    return { slug: f.replace(/\.md$/, ''), name: meta.name || f.replace(/\.md$/, ''), description: meta.description || '', model: meta.model || '', file: path.join(dir, f) };
  });
}

export async function libraryIndex() {
  return {
    agency: { agents: agencyAgents().map(({ file, ...a }) => a) },
    hermes: await listProfiles().catch(() => []),
    claude: claudeSubagents().map(({ file, ...a }) => a),
  };
}

// ---------- agents ----------
const COLORS = ['#c4ff3d', '#a9d3e2', '#f0b04a', '#ff7a90', '#b69cff', '#5fe3c0', '#ffd36e', '#7ab8ff'];

export function newAgent(fields: Partial<Agent> = {}): Agent {
  const d = getSettings().defaults;
  const engine = fields.engine || d.engine;
  const a: Agent = {
    id: fields.id || `${slugify(fields.name || 'agent')}-${uid().slice(-4)}`,
    name: fields.name || 'New agent',
    emoji: fields.emoji || '🤖',
    color: fields.color || COLORS[Math.floor(Math.random() * COLORS.length)],
    specialty: fields.specialty || '',
    description: fields.description || '',
    systemPrompt: fields.systemPrompt || '',
    engine,
    model: fields.model ?? (engine === 'claude-code' ? d.claudeModel : engine === 'openai' ? d.openrouterModel : ''),
    provider: fields.provider || 'openrouter',
    claudeAuth: fields.claudeAuth || 'login',
    hermesProfile: fields.hermesProfile ?? d.hermesProfile ?? '',
    ...(fields.openclawAgent ? { openclawAgent: fields.openclawAgent } : {}),
    autonomy: fields.autonomy || d.autonomy || 'auto',
    toolGroups: fields.toolGroups || ['programs', 'browser', 'agents', 'files'],
    mcpServers: fields.mcpServers || [],
    knowledge: { folders: fields.knowledge?.folders || [] },
    workspace: fields.workspace || '',
    temperature: fields.temperature ?? '',
    effort: isEffort(fields.effort) ? fields.effort : '',
    alwaysAllow: [], // grants stay with the agent they were given to, never copies
    skills: Array.isArray(fields.skills) ? fields.skills : [],
    source: fields.source || { type: 'custom' },
    pinned: false,
  };
  return agents.save(a);
}

// Guess sensible tools from what the agent does.
function suggestTools(text: string): string[] {
  const t = text.toLowerCase();
  const groups = new Set(['agents', 'files', 'browser']);
  if (/twitter|\bx\b|social|tiktok|reddit|instagram|linkedin|community|growth|content|marketing/.test(t)) groups.add('social');
  if (/image|visual|art|illustrat|comfy|diffusion|prompt engineer/.test(t)) groups.add('comfyui');
  if (/3d|blender|spatial|game|model(l)?ing|render/.test(t)) groups.add('blender');
  if (/\bmaya\b|animator|rigging/.test(t)) groups.add('maya');
  if (/houdini|vfx|simulation|procedural/.test(t)) groups.add('houdini');
  if (/texture|material artist|substance|\bpbr\b/.test(t)) groups.add('substance');
  if (/\bcad\b|3d print|slicer|openscad|g-?code/.test(t)) groups.add('cad');
  if (/texture|\bgpu\b|nvidia/.test(t)) groups.add('nvidia');
  if (/3d|texture|material|hdri|environment art|level design|game/.test(t)) groups.add('assets');
  if (/video|edit|premiere|after effects|motion|photoshop|design/.test(t)) {
    groups.add('adobe');
    groups.add('media');
  }
  if (/engineer|developer|devops|code|software|sre|architect/.test(t)) groups.add('programs');
  return [...groups];
}

export function hireFromAgency(slug: string, overrides: Partial<Agent> = {}): Agent {
  const a = agencyAgents().find((x) => x.slug === slug);
  if (!a) throw new Error('That agent is not in the library.');
  const { body } = parseFrontmatter(fs.readFileSync(a.file, 'utf8'));
  const agent = newAgent({
    name: a.name,
    emoji: a.emoji,
    color: a.color,
    specialty: a.vibe || a.description.split('. ')[0],
    description: a.description,
    systemPrompt: body.trim(),
    toolGroups: suggestTools(`${a.division} ${a.name} ${a.description}`),
    source: { type: 'agency', slug, division: a.division },
    ...overrides,
  });
  log('library', `Hired ${agent.name} from The Agency`, { agentId: agent.id });
  return agent;
}

export function hireHermesProfile(profile: string, overrides: Partial<Agent> = {}): Agent {
  const agent = newAgent({
    name: profile === 'default' ? 'Hermes' : profile.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    emoji: '☤',
    specialty: `Hermes profile "${profile}"`,
    engine: 'hermes',
    hermesProfile: profile,
    model: '',
    toolGroups: ['agents'],
    source: { type: 'hermes', profile },
    ...overrides,
  });
  log('library', `Added Hermes profile ${profile} as an agent`, { agentId: agent.id });
  return agent;
}

export function importClaudeSubagent(slug: string): Agent {
  const s = claudeSubagents().find((x) => x.slug === slug);
  if (!s) throw new Error('No such Claude Code subagent.');
  const { body } = parseFrontmatter(fs.readFileSync(s.file, 'utf8'));
  return newAgent({ name: s.name, emoji: '✳️', specialty: s.description.slice(0, 140), description: s.description, systemPrompt: body.trim(), engine: 'claude-code', source: { type: 'claude', slug } });
}

// Write an agent as a Claude Code subagent (~/.claude/agents/<slug>.md) so you can use it in any Claude session.
export function exportToClaude(agent: Agent): string {
  const dir = ensureDir(path.join(HOME, '.claude', 'agents'));
  const slug = slugify(agent.name);
  const file = path.join(dir, `${slug}.md`);
  // a real YAML string: a backslash (a Windows path) or a quote must not break the frontmatter
  const desc = JSON.stringify((agent.description || agent.specialty || agent.name).replace(/\s+/g, ' ').trim());
  fs.writeFileSync(file, `---\nname: ${slug}\ndescription: ${desc}\n---\n\n${agent.systemPrompt || `You are ${agent.name}.`}\n`);
  log('library', `Installed ${agent.name} into Claude Code as subagent "${slug}"`, { agentId: agent.id });
  return file;
}

export const STARTERS: Starter[] = [
  {
    name: 'Coordinator',
    emoji: '🗂️',
    specialty: 'plans the work and hands pieces to the right teammate',
    systemPrompt:
      'You coordinate the other agents on this dashboard. Break the request into steps, check list_agents, and give each step to the best teammate with ask_agent (be specific about what you need back; independent steps go out together and run in parallel), then collect each answer with await_agent. Combine their answers into one clear result. Do small things yourself.',
    toolGroups: ['agents', 'programs', 'browser', 'files'],
  },
  {
    name: 'X Writer',
    emoji: '🐦',
    specialty: 'writes posts and threads for your X accounts',
    systemPrompt:
      'You write posts for X in the user\'s voice: concrete, specific, no hashtags unless asked, no emoji spam, no em dashes, never invent numbers. Offer 2-3 options when drafting, then save the chosen one with x_draft_post so it waits in the Outbox. Each part under 280 characters. For direct messages use x_draft_dm with their handle; DMs always wait for approval.',
    toolGroups: ['social', 'browser', 'agents'],
  },
  {
    name: 'Mail Assistant',
    emoji: '✉️',
    specialty: 'reads, sorts and drafts your email in Gmail',
    engine: 'claude-code',
    systemPrompt:
      "You handle the user's email through the Gmail connector on their Claude account (and Google Calendar for scheduling). Read and search mail freely. Write replies and new emails as Gmail drafts and always show the full draft (to, subject, body) in the chat. Never send an email, accept an invite or delete anything unless the user explicitly asks for that exact action. Match the user's tone: short, clear, friendly. If the Gmail tools are missing, say the user should sign in to Gmail in Claude Code (/mcp).",
    toolGroups: ['browser', 'files', 'agents'],
  },
  {
    name: 'Image Maker',
    emoji: '🎨',
    specialty: 'turns ideas into images with your ComfyUI workflows',
    systemPrompt:
      'You make images with ComfyUI. Check comfyui_status (start it with comfyui_start if needed), pick a workflow with comfyui_list_workflows, look at its inputs with comfyui_describe_workflow, write a strong detailed prompt, then comfyui_run. Show what you made and offer variations.',
    toolGroups: ['comfyui', 'programs', 'files'],
  },
  {
    name: '3D Artist',
    emoji: '🧊',
    specialty: 'builds and renders scenes in Blender',
    systemPrompt:
      'You work in Blender through Python (bpy) with blender_run_python. Build scenes step by step, save .blend files and renders into your workspace, and report the file paths. Keep scripts self-contained and print useful progress.',
    toolGroups: ['blender', 'programs', 'files', 'media'],
  },
  {
    name: 'Video Editor',
    emoji: '🎬',
    specialty: 'cuts, converts and assembles video with ffmpeg, Premiere and After Effects',
    systemPrompt:
      'You edit video. Inspect files with ffprobe, do cuts, concatenation, resizing, captions burn-in and exports with ffmpeg, open projects in Premiere with premiere_open, and automate After Effects with aftereffects_run_script. Always write outputs to new files, never overwrite originals.',
    toolGroups: ['media', 'adobe', 'programs', 'files'],
  },
  {
    name: 'Researcher',
    emoji: '🔎',
    specialty: 'finds, reads and summarizes sources',
    systemPrompt: 'You research questions on the web. Read primary sources with fetch_url, compare them, and answer with the key findings and links. Say clearly what is uncertain.',
    toolGroups: ['browser', 'files', 'agents'],
  },
  {
    name: 'World Builder',
    emoji: '🧱',
    specialty: 'builds the voxel world around the Station: places, props and the characters in it',
    systemPrompt:
      'You build the voxel world the agents live in, on the Station: a diorama people look at, not a level anyone plays (no navigation, routes or playtesting). Everything in it is made by you and the other builders. Build big to small: the shape of the terrain first, then the buildings, then the props. Read the Voxel building skill and WORLD.md before you build, and world_info to see what is there, which prefabs exist and where your plot is. Build in the style WORLD.md describes. Big pieces (ground, buildings, rivers) are objects; small things there are many of (people, trees, lamps, vehicles, boats) are prefabs you make once at a fine voxel size and then place many times, turned and recoloured. Work in a few calls (ground, big shapes, details, then the prefabs and their copies) and read each answer before going on. When you finish a place or dress a character, update WORLD.md (world_md_section) and add a line to "Story so far". Say what you built and where.',
    toolGroups: ['world', 'files'],
    skills: ['voxel-building'],
  },
];

export function createStarter(name: string, overrides: Partial<Agent> = {}): Agent {
  const s = STARTERS.find((x) => x.name === name);
  if (!s) throw new Error('Unknown starter');
  return newAgent({ ...s, source: { type: 'starter' }, ...overrides });
}
