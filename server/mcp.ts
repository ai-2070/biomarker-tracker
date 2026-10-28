// MCP servers: the dashboard connects to them for API-model agents and hands them to Claude Code agents.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { HOME, IS_WIN, BRIDGE_SCRIPT, PORT, dataPath, readJSON, writeJSON, which, exists } from './util.ts';
import { emit, log, internalToken, agents, workflows, listProjects, withProject } from './store.ts';
import type { McpServerInfo, McpSuggestion } from '../shared/types.ts';

/** One saved MCP server (data/mcp.json). */
export interface McpServerConfig {
  type: 'stdio' | 'http' | string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  description: string;
  enabled: boolean;
  /** This copy's own name ("Work", "Client A"), for a service added more than once (several accounts). */
  label?: string;
  /** The service it is, when not worked out on its own (see kindOf): a ready-made server's name, or another server's kind. */
  kind?: string;
  /** When to pick this copy over the service's other ones: for the Brain, and the agent that has it. */
  useFor?: string;
}
export type McpServers = Record<string, McpServerConfig>;

/** What saveServer() accepts: a form body, a preset or an importable server. args may be one string. */
export interface McpServerInput {
  type?: string;
  command?: string;
  args?: string[] | string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  description?: string;
  enabled?: boolean;
  label?: string;
  kind?: string;
  useFor?: string;
}

export type McpPreset = {
  name: string;
  title: string;
  description: string;
  /** What to do outside the dashboard before it works (an editor plugin, a program), for the Brain to pass on. */
  setup?: string;
  /** The host every link of this service is on, when each account gets its own link (Composio) */
  host?: string;
} & (
  | { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers: Record<string, string> }
);

export interface ImportableServer {
  source: string;
  name: string;
  type: 'http' | 'stdio';
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
}

export type McpTool = Tool;
export interface McpToolResult {
  text: string;
  images: string[];
}

/** How Claude Code is told to start one MCP server (--mcp-config). */
export type ClaudeMcpServer = { command: string; args: string[]; env: Record<string, string> } | { type: 'http'; url: string; headers: Record<string, string> };

/** A server entry in someone else's config (~/.claude.json, Claude Desktop): anything goes. */
interface ForeignServer {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}
interface ClaudeJson {
  mcpServers?: Record<string, ForeignServer>;
  projects?: Record<string, { mcpServers?: Record<string, ForeignServer> }>;
}

const FILE = dataPath('mcp.json');

// A service's own hosted server that needs no key at all.
const open = (name: string, title: string, url: string, description: string): McpPreset => ({ name, title, description: `${description} No key needed.`, type: 'http', url, headers: {} });

// A service's own hosted server that signs in through the browser (OAuth). mcp-remote does the sign-in the
// first time it runs and keeps the login, so there is nothing to paste. `service` is whose sign-in page opens.
const signIn = (name: string, title: string, service: string, url: string, description: string): McpPreset => ({
  name,
  title,
  description: `${description} The first time it runs, a browser window opens to sign in to ${service}.`,
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'mcp-remote', url],
  setup: `sign in to ${service} in the browser window that opens the first time it runs`,
});

/** The hosted server's link of a ready-made server that runs through mcp-remote ('' for others). */
export const remoteUrl = (p: McpPreset): string => (p.type === 'stdio' && p.args.includes('mcp-remote') ? p.args[p.args.indexOf('mcp-remote') + 1] || '' : '');
/** A ready-made server that signs in through the browser the first time it runs: no key to paste. */
export const signsInByBrowser = (p: McpPreset): boolean => !!remoteUrl(p);

/** Another account of a service that signs in through the browser keeps its own login. mcp-remote keeps one
 *  login per link, so a second account would quietly be the first. Its folder sits next to mcp-remote's own
 *  (~/.mcp-auth), not in the data folder, so the tokens stay out of backups. The folder gets a random part
 *  of its own: a copy keeps it when renamed, so a new copy given the old name must not land in it. (A copy
 *  that has a folder already keeps it, so it stays signed in.) */
export function withOwnLogin<T extends { args?: string[] | string; env?: Record<string, string> }>(name: string, cfg: T): T {
  if (!Array.isArray(cfg.args) || !cfg.args.includes('mcp-remote') || cfg.env?.MCP_REMOTE_CONFIG_DIR) return cfg;
  return { ...cfg, env: { ...cfg.env, MCP_REMOTE_CONFIG_DIR: path.join(HOME, '.mcp-auth', `dashboard-${serverName(name)}-${crypto.randomBytes(4).toString('hex')}`) } };
}

export const PRESETS: McpPreset[] = [
  {
    name: 'playwright',
    title: 'Browser control (Playwright)',
    description: 'Open pages, click, type, fill forms, read and screenshot sites in a real browser.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
  },
  {
    name: 'chrome-devtools',
    title: 'Chrome DevTools',
    description: 'Drive Chrome through DevTools: navigate, inspect, network, performance traces.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
  },
  {
    name: 'filesystem',
    title: 'Files (Desktop)',
    description: 'Read and write files under your Desktop folder.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', path.join(HOME, 'Desktop')],
  },
  { name: 'fetch', title: 'Web fetch', description: 'Fetch any URL and convert it to markdown.', type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
  { name: 'memory', title: 'Memory graph', description: 'A persistent knowledge graph agents can write to and recall.', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  {
    name: 'sequential-thinking',
    title: 'Sequential thinking',
    description: 'Step-by-step reasoning scratchpad for hard problems.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    name: 'blender',
    title: 'Blender (live)',
    description: 'Control a running Blender scene. Its Blender add-on can also bring in Poly Haven, Sketchfab and Poly Pizza assets and make models with Tripo, Meshy, Hyper3D Rodin or Hunyuan3D: tick them in the add-on\'s panel (N key > MCP for Blender). Needs the add-on from github.com/ahujasid/mcp-for-blender installed and connected inside Blender.',
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-for-blender'],
    env: { DISABLE_TELEMETRY: 'true' },
    setup: 'install the add-on from github.com/ahujasid/mcp-for-blender in Blender, then click Connect in its panel (N key > MCP for Blender)',
  },
  {
    name: 'hermes',
    title: 'Hermes conversations',
    description: 'Lets other agents read and talk to your Hermes conversations (hermes mcp serve).',
    type: 'stdio',
    command: 'hermes',
    args: ['mcp', 'serve'],
  },
  {
    name: 'github',
    title: 'GitHub (remote)',
    description: 'Issues, PRs, code search. Put a GitHub token in the Authorization header.',
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer YOUR_GITHUB_TOKEN' },
  },
  // Docs and web search
  {
    name: 'context7',
    title: 'Library docs (Context7)',
    description: 'Up-to-date documentation and code examples for the libraries and frameworks you use, so agents stop guessing at old APIs. No key needed.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
  },
  {
    name: 'brave-search',
    title: 'Web search (Brave)',
    description: 'Search the web, news, images and videos. Needs a free Brave Search API key: add it as BRAVE_API_KEY after adding.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@brave/brave-search-mcp-server'],
    env: { BRAVE_API_KEY: 'YOUR_API_KEY' },
  },
  {
    name: 'firecrawl',
    title: 'Web scraping (Firecrawl)',
    description: 'Turn whole sites and pages into clean text, and crawl or search them. Needs a Firecrawl key: add it as FIRECRAWL_API_KEY after adding.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'firecrawl-mcp'],
    env: { FIRECRAWL_API_KEY: 'YOUR_API_KEY' },
  },
  open('deepwiki', 'Ask about any GitHub repo (DeepWiki)', 'https://mcp.deepwiki.com/mcp', 'Ask questions about any public GitHub repo and read its write-up (Devin\'s DeepWiki).'),
  open('microsoft-learn', 'Microsoft docs', 'https://learn.microsoft.com/api/mcp', 'Official Microsoft, Azure, .NET and Windows docs and code samples (Microsoft\'s own server).'),
  open('aws-knowledge', 'AWS docs', 'https://knowledge-mcp.global.api.aws', 'Official AWS docs, API references and best practices (Amazon\'s own server).'),
  open('twilio-docs', 'Twilio docs', 'https://mcp.twilio.com/docs', 'Search Twilio\'s developer docs (Twilio\'s own server, read-only).'),
  open('wolfram', 'Wolfram|Alpha', 'https://agenttools.wolfram.com/mcp', 'Exact math, unit conversions, and facts about science, places and data from Wolfram|Alpha (Wolfram\'s own server).'),
  // Travel
  open('kiwi', 'Flights (Kiwi.com)', 'https://mcp.kiwi.com', 'Search flights and get booking links (Kiwi.com\'s own server). Booking and paying happen on kiwi.com, never in the chat.'),
  open('trivago', 'Hotels (trivago)', 'https://mcp.trivago.com/mcp', 'Compare hotel prices by city and dates (trivago\'s own server). Booking happens on the linked sites.'),
  // Work tools
  signIn('notion', 'Notion', 'Notion', 'https://mcp.notion.com/mcp', 'Read and write your Notion pages and databases (Notion\'s own server).'),
  signIn('linear', 'Linear', 'Linear', 'https://mcp.linear.app/mcp', 'Find, create and update Linear issues, projects and comments (Linear\'s own server).'),
  signIn('atlassian', 'Jira and Confluence', 'Atlassian', 'https://mcp.atlassian.com/v1/mcp/authv2', 'Jira issues and Confluence pages (Atlassian\'s own server).'),
  signIn('clickup', 'ClickUp', 'ClickUp', 'https://mcp.clickup.com/mcp', 'Tasks, docs and spaces in ClickUp (ClickUp\'s own server).'),
  signIn('monday', 'monday.com', 'monday.com', 'https://mcp.monday.com/mcp', 'Boards, items, docs and workflows in monday.com (monday.com\'s own server).'),
  signIn('todoist', 'Todoist', 'Todoist', 'https://ai.todoist.net/mcp', 'Your Todoist tasks and projects (Todoist\'s own server).'),
  signIn('airtable', 'Airtable', 'Airtable', 'https://mcp.airtable.com/mcp', 'Bases, tables and records in your Airtable (Airtable\'s own server).'),
  signIn('craft', 'Craft', 'Craft', 'https://mcp.craft.do/my/mcp', 'Your Craft documents, tasks and notes (Craft\'s own server).'),
  signIn('miro', 'Miro', 'Miro', 'https://mcp.miro.com/', 'Read and edit Miro boards, diagrams and frames (Miro\'s own server).'),
  signIn('dropbox', 'Dropbox', 'Dropbox', 'https://mcp.dropbox.com/mcp', 'Search, read and manage your Dropbox files (Dropbox\'s own server).'),
  signIn('calendly', 'Calendly', 'Calendly', 'https://mcp.calendly.com', 'Scheduling links, booked events and invitees in Calendly (Calendly\'s own server).'),
  signIn('fireflies', 'Fireflies (meeting notes)', 'Fireflies', 'https://api.fireflies.ai/mcp', 'Meeting transcripts, summaries and action items from Fireflies (Fireflies\' own server).'),
  signIn('gamma', 'Gamma', 'Gamma', 'https://mcp.gamma.app/mcp', 'Make and edit presentations, documents and web pages with Gamma\'s AI (Gamma\'s own server).'),
  signIn('intercom', 'Intercom', 'Intercom', 'https://mcp.intercom.com/mcp', 'Customer conversations, tickets and contacts in Intercom (Intercom\'s own server).'),
  signIn('strava', 'Strava', 'Strava', 'https://mcp.strava.com/mcp', 'Your Strava activities, fitness trends and training load (Strava\'s own server, read-only). Needs a Strava subscription.'),
  {
    name: 'oomol',
    title: 'OOMOL (remote)',
    description: 'Your OOMOL connected apps (mail, calendar, drive, chat, issue trackers…) and OOMOL\'s hosted AI tools, OOMOL\'s own server. Make an MCP API key at oomol.com/install/mcp, then put it in the Authorization header and your OOMOL team name in the x-oo-team-name header after adding.',
    type: 'http',
    url: 'https://connector.oomol.com/v1/mcp',
    headers: { Authorization: 'Bearer YOUR_MCP_API_KEY', 'x-oo-team-name': 'YOUR_TEAM_NAME' },
  },
  {
    name: 'composio',
    title: 'Composio (remote)',
    description: 'Hundreds of apps (Gmail, Slack, GitHub, Notion, Drive, CRMs…) through your Composio account. In Composio (platform.composio.dev) make an MCP session for the account, then after adding put its link in the URL and your Composio API key in the x-api-key header.',
    type: 'http',
    url: 'https://mcp.composio.dev/session/YOUR_SESSION_ID',
    headers: { 'x-api-key': 'YOUR_COMPOSIO_API_KEY' },
    host: 'composio.dev',
  },
  // Building and running software
  signIn('gitlab', 'GitLab', 'GitLab', 'https://gitlab.com/api/v4/mcp', 'Issues, merge requests, pipelines and code on gitlab.com (GitLab\'s own server).'),
  signIn('sentry', 'Sentry', 'Sentry', 'https://mcp.sentry.dev/mcp', 'Errors, stack traces and issues from Sentry (Sentry\'s own server).'),
  signIn('vercel', 'Vercel', 'Vercel', 'https://mcp.vercel.com', 'Your Vercel projects, deployments and logs (Vercel\'s own server).'),
  signIn('netlify', 'Netlify', 'Netlify', 'https://netlify-mcp.netlify.app/mcp', 'Your Netlify sites, deploys and settings (Netlify\'s own server).'),
  signIn('cloudflare', 'Cloudflare', 'Cloudflare', 'https://mcp.cloudflare.com/mcp', 'The whole Cloudflare API: DNS, Workers, R2, KV, D1, Pages and more (Cloudflare\'s own server). When you sign in you pick which account and permissions the agent gets.'),
  signIn('railway', 'Railway', 'Railway', 'https://mcp.railway.com', 'Your Railway projects, services, deployments and environments (Railway\'s own server).'),
  signIn('supabase', 'Supabase', 'Supabase', 'https://mcp.supabase.com/mcp', 'Databases, sign-in and storage of your Supabase projects (Supabase\'s own server).'),
  signIn('neon', 'Neon (Postgres)', 'Neon', 'https://mcp.neon.tech/mcp', 'Neon Postgres databases: projects, branches and SQL (Neon\'s own server).'),
  signIn('prisma-postgres', 'Prisma Postgres', 'Prisma', 'https://mcp.prisma.io/mcp', 'Make and manage Prisma Postgres databases (Prisma\'s own server).'),
  signIn('motherduck', 'MotherDuck (DuckDB)', 'MotherDuck', 'https://api.motherduck.com/mcp', 'Ask your MotherDuck DuckDB warehouses with SQL (MotherDuck\'s own server).'),
  signIn('circleci', 'CircleCI', 'CircleCI', 'https://mcp.circleci.com/v1/mcp', 'Find out why a CircleCI build failed, read its logs and run it again (CircleCI\'s own server).'),
  signIn('buildkite', 'Buildkite', 'Buildkite', 'https://mcp.buildkite.com/mcp', 'Buildkite pipelines, builds and test results (Buildkite\'s own server).'),
  signIn('postman', 'Postman', 'Postman', 'https://mcp.postman.com/minimal', 'Your Postman workspaces, collections, environments and APIs (Postman\'s own server).'),
  signIn('semgrep', 'Semgrep (code security)', 'Semgrep', 'https://mcp.semgrep.ai/mcp', 'Scan code for security problems with Semgrep (Semgrep\'s own server).'),
  signIn('datadog', 'Datadog', 'Datadog', 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp', 'Logs, monitors, dashboards and incidents from Datadog (Datadog\'s own server).'),
  signIn('grafana', 'Grafana Cloud', 'Grafana', 'https://mcp.grafana.com/mcp', 'Metrics, logs, dashboards and alerts from Grafana Cloud (Grafana\'s own server). Needs a Grafana Cloud stack, not a self-hosted Grafana: you give its address when you sign in.'),
  signIn('betterstack', 'Better Stack', 'Better Stack', 'https://mcp.betterstack.com', 'Logs, uptime monitors, incidents and status pages in Better Stack (Better Stack\'s own server). It has a lot of tools (about 100).'),
  signIn('globalping', 'Globalping (network tests)', 'Globalping', 'https://mcp.globalping.dev/mcp', 'Ping, traceroute, DNS and website checks from probes around the world (Globalping\'s own server).'),
  signIn('huggingface', 'Hugging Face', 'Hugging Face', 'https://huggingface.co/mcp', 'Models, datasets, Spaces and papers on the Hugging Face Hub (Hugging Face\'s own server).'),
  signIn('comfy-cloud', 'Comfy Cloud', 'Comfy', 'https://cloud.comfy.org/mcp', 'Make images, video, audio and 3D with ComfyUI workflows on Comfy Cloud (Comfy\'s own server). Making things uses your Comfy credits.'),
  signIn('cloudinary', 'Cloudinary', 'Cloudinary', 'https://asset-management.mcp.cloudinary.com/mcp', 'Upload, find and transform images and videos in Cloudinary (Cloudinary\'s own server).'),
  signIn('webflow', 'Webflow', 'Webflow', 'https://mcp.webflow.com/mcp', 'Your Webflow sites, pages and CMS collections (Webflow\'s own server).'),
  signIn('wordpress-com', 'WordPress.com', 'WordPress.com', 'https://public-api.wordpress.com/wpcom/v2/mcp/v1', 'Posts, pages, drafts, comments and stats of your WordPress.com sites (WordPress.com\'s own server).'),
  // Data, sales and marketing
  signIn('amplitude', 'Amplitude', 'Amplitude', 'https://mcp.amplitude.com/mcp', 'Amplitude charts, dashboards, experiments and feature flags (Amplitude\'s own server). Accounts in the EU: change the link to https://mcp.eu.amplitude.com/mcp after adding.'),
  signIn('mixpanel', 'Mixpanel', 'Mixpanel', 'https://mcp.mixpanel.com/mcp', 'Mixpanel events, funnels, retention and dashboards (Mixpanel\'s own server).'),
  signIn('algolia', 'Algolia', 'Algolia', 'https://mcp.algolia.com/mcp', 'Algolia search indices, analytics and settings (Algolia\'s own server, read-only).'),
  signIn('twelve-data', 'Market data (Twelve Data)', 'Twelve Data', 'https://mcp.twelvedata.com/mcp', 'Stock, currency and crypto prices and history from Twelve Data (Twelve Data\'s own server).'),
  signIn('attio', 'Attio', 'Attio', 'https://mcp.attio.com/mcp', 'Records, lists and notes in your Attio CRM (Attio\'s own server).'),
  signIn('close', 'Close (CRM)', 'Close', 'https://mcp.close.com/mcp', 'Leads, opportunities, calls and emails in Close (Close\'s own server).'),
  signIn('klaviyo', 'Klaviyo', 'Klaviyo', 'https://mcp.klaviyo.com/mcp?core-tools-only=true&disable-tools-with-user-generated-content=true', 'Klaviyo campaigns, flows, segments and reports (Klaviyo\'s own server). Needs an Owner, Admin or Manager role. Only the core tools are on, and tools that read what customers wrote are off.'),
  // Games and audio
  {
    name: 'unity',
    title: 'Unity (live editor)',
    description: 'Control a running Unity editor: scenes, objects, assets, scripts. Needs the "MCP for Unity" package installed in your Unity project (Window > MCP for Unity) and its bridge started there.',
    type: 'stdio',
    command: 'uvx',
    args: ['--from', 'mcpforunityserver', 'mcp-for-unity', '--transport', 'stdio'],
    setup: 'install the "MCP for Unity" package in the Unity project (Window > MCP for Unity) and start its bridge there',
  },
  {
    name: 'unreal',
    title: 'Unreal Engine (live editor)',
    description: 'Control a running Unreal Engine 5 editor (third-party, no plugin to compile). In Unreal turn on the Python Editor Script Plugin and Remote Execution, then restart the editor. Unreal 5.8 also has an experimental official MCP plugin.',
    type: 'stdio',
    command: 'uvx',
    args: ['uemcp'],
    setup: 'in Unreal Engine 5 turn on the Python Editor Script Plugin and Remote Execution, then restart the editor',
  },
  {
    name: 'godot',
    title: 'Godot',
    description: 'Launch the Godot editor, run projects, read debug output and edit scenes. If Godot is not found on its own, add GODOT_PATH (the full path to the Godot program) after adding.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@coding-solo/godot-mcp'],
    setup: 'Godot has to be installed; if it is not found on its own, set GODOT_PATH to the full path of the Godot program',
  },
  {
    name: 'elevenlabs',
    title: 'ElevenLabs voices and sound',
    description: 'Text to speech, voice cloning, sound effects and audio transcription. Needs an ElevenLabs API key: add it as ELEVENLABS_API_KEY after adding. Generating audio uses your ElevenLabs credits.',
    type: 'stdio',
    command: 'uvx',
    args: ['elevenlabs-mcp'],
    env: { ELEVENLABS_API_KEY: 'YOUR_API_KEY' },
  },
  // 3D, textures and animation
  {
    name: 'maya',
    title: 'Maya (live)',
    description: 'Control a running Maya: scenes, objects, selection, animation keys, cameras, renders (third-party, github.com/GimbalGoats/GG_MayaMCP). In Maya open a command port first. Running your own scripts through it stays off unless you add MAYA_MCP_ENABLE_RAW_EXECUTION=true.',
    type: 'stdio',
    command: 'uvx',
    args: ['maya-mcp'],
    setup: "in Maya's Script Editor (Python) run cmds.commandPort(name=':7001', sourceType='python') each session",
  },
  {
    name: 'houdini',
    title: 'Houdini (live)',
    description: 'Control a running Houdini: nodes and networks, parameters, simulations, renders, USD and Solaris (third-party, github.com/healkeiser/fxhoudinimcp). Install its Houdini side once, then restart Houdini; it listens on port 8100.',
    type: 'stdio',
    command: 'uvx',
    args: ['fxhoudinimcp'],
    setup: 'install the Houdini side once (pip install fxhoudinimcp, then python -m fxhoudinimcp install) and restart Houdini',
  },
  {
    name: 'substance-painter',
    title: 'Substance 3D Painter (live)',
    description: 'Control a running Substance 3D Painter: texture sets, layers, fill and paint, bake maps, export textures (third-party, github.com/elliezu/SubstancePainterMCP). Painter has to be started with remote scripting on (the substance_open tool does that).',
    type: 'stdio',
    command: 'uvx',
    args: ['--from', 'git+https://github.com/elliezu/SubstancePainterMCP', 'substance-painter-mcp'],
    setup: 'start Painter with --enable-remote-scripting (the dashboard does this when an agent opens it with substance_open)',
  },
  {
    name: 'tripo',
    title: 'Tripo 3D (AI models)',
    description: 'Turn a prompt or an image into a 3D model (GLB, FBX…), then texture, rig, animate or convert it (Tripo\'s own command-line tool, tripo-cli). Needs a Tripo API key (developers.tripo3d.ai): add it as TRIPO_API_KEY after adding. Uses your Tripo credits.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'tripo-cli', 'mcp'],
    env: { TRIPO_API_KEY: 'YOUR_API_KEY', TRIPO_ANALYTICS_ENABLED: '0' },
  },
  {
    name: 'meshy',
    title: 'Meshy (AI models and textures)',
    description: 'Make 3D models from text or images, retexture, remesh and rig them (Meshy\'s own server). Needs a Meshy API key from a Pro plan or above (meshy.ai/developers/keys): add it as MESHY_API_KEY after adding. Uses your Meshy credits.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@meshy-ai/meshy-mcp-server'],
    env: { MESHY_API_KEY: 'YOUR_API_KEY' },
  },
  {
    name: 'sketchfab',
    title: 'Sketchfab models',
    description: 'Search Sketchfab for 3D models, see their details and licences, and download the downloadable ones (third-party, github.com/gregkop/sketchfab-mcp-server). Needs your Sketchfab API token (sketchfab.com/settings/password, free account): add it as SKETCHFAB_API_KEY after adding. Check each model\'s licence before using it.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'sketchfab-mcp-server'],
    env: { SKETCHFAB_API_KEY: 'YOUR_API_TOKEN' },
  },
  // CAD and 3D printing
  {
    name: 'freecad',
    title: 'FreeCAD (live)',
    description: 'Build and change parts in a running FreeCAD: sketches, solids, documents, screenshots of the view (third-party, github.com/neka-nat/freecad-mcp). Needs its FreeCAD add-on and Python 3.12 or newer.',
    type: 'stdio',
    command: 'uvx',
    args: ['freecad-mcp'],
    setup: 'copy the addon/FreeCADMCP folder from github.com/neka-nat/freecad-mcp into FreeCAD\'s Mod folder, then in FreeCAD pick the "MCP Addon" workbench and click Start RPC Server',
  },
  {
    name: 'rhino',
    title: 'Rhino and Grasshopper (live)',
    description: 'Create and change objects, layers and Grasshopper definitions in a running Rhino (third-party, github.com/jingcheng-chen/rhinomcp).',
    type: 'stdio',
    command: 'uvx',
    args: ['rhinomcp'],
    setup: 'in Rhino install "rhinomcp" from the Package Manager, then type the mcpstart command',
  },
  {
    name: 'openscad',
    title: 'OpenSCAD',
    description: 'Write OpenSCAD models, render them to STL and preview images (third-party, github.com/robertcoop/openscad-mcp). If OpenSCAD is not found on its own, add OPENSCAD_PATH (the full path to openscad) after adding.',
    type: 'stdio',
    command: 'uvx',
    args: ['openscad-mcp'],
    setup: 'OpenSCAD has to be installed',
  },
  {
    name: '3d-printer',
    title: '3D printer (OctoPrint, Klipper, Bambu, Prusa…)',
    description: 'Check a 3D printer, upload files, start and cancel prints, set temperatures (third-party, github.com/DMontgomery40/mcp-3D-printer-server). Add PRINTER_TYPE (octoprint, klipper, bambu, prusa, duet, repetier or creality), PRINTER_HOST (its address) and API_KEY after adding; Bambu printers use BAMBU_SERIAL, BAMBU_TOKEN (the LAN access code) and BAMBU_MODEL instead of API_KEY. It asks before it prints.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-3d-printer-server'],
    env: { PRINTER_TYPE: 'YOUR_PRINTER_TYPE', PRINTER_HOST: 'YOUR_PRINTER_ADDRESS', API_KEY: 'YOUR_API_KEY' },
  },
  // Stock images, design and fonts
  {
    name: 'unsplash',
    title: 'Unsplash photos',
    description: 'Search free Unsplash photos and get their links, credits and download counts (third-party, github.com/hanoak/unsplash-mcp-server). Needs a free Unsplash access key (unsplash.com/developers): add it as UNSPLASH_ACCESS_KEY after adding. Unsplash asks you to credit the photographer.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@hanoak/unsplash-mcp-server'],
    env: { UNSPLASH_ACCESS_KEY: 'YOUR_ACCESS_KEY' },
  },
  {
    name: 'pixabay',
    title: 'Pixabay photos and videos',
    description: 'Search free Pixabay images, illustrations, vectors and videos (third-party, github.com/hanoak/pixabay-mcp-server). Needs a free Pixabay key (pixabay.com/api/docs, shown after you log in): add it as PIXABAY_API_KEY after adding.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@hanoak/pixabay-mcp-server'],
    env: { PIXABAY_API_KEY: 'YOUR_API_KEY' },
  },
  {
    name: 'pexels',
    title: 'Pexels photos and videos',
    description: 'Search free Pexels photos, videos and collections (third-party, github.com/hanoak/pexels-mcp-server). Needs a free Pexels key (pexels.com/api): add it as PEXELS_API_KEY after adding.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@hanoak/pexels-mcp-server'],
    env: { PEXELS_API_KEY: 'YOUR_API_KEY' },
  },
  {
    name: 'canva',
    title: 'Canva',
    description: 'Search, create and edit your Canva designs, export them, use your brand kits (Canva\'s own server). The first time it runs, a browser window opens to sign in to Canva.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-remote', 'https://mcp.canva.com/mcp'],
    setup: 'sign in to Canva in the browser window that opens the first time it runs',
  },
  {
    name: 'freepik',
    title: 'Freepik / Magnific',
    description: 'Search and download Freepik stock photos, vectors and icons, and make AI images and videos (Freepik\'s own server; Freepik is now called Magnific). The first time it runs, a browser window opens to sign in. Downloads and AI use your account\'s credits.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-remote', 'https://mcp.magnific.com'],
    setup: 'sign in to Magnific (Freepik) in the browser window that opens the first time it runs',
  },
  {
    name: 'google-design',
    title: 'Google Fonts and Material icons',
    description: 'Find Google Fonts, describe a font, search Material Symbols icons and make colour schemes (Google\'s own server). No key needed.',
    type: 'http',
    url: 'https://design.googleapis.com/mcp',
    headers: {},
  },
  // Free creative programs, live
  {
    name: 'gimp',
    title: 'GIMP (live)',
    description: 'Edit images in a running GIMP 3: layers, selections, filters, export (third-party, github.com/maorcc/gimp-mcp). Needs its GIMP plug-in, started from Tools > MCP > Start MCP Server.',
    type: 'stdio',
    command: 'uvx',
    args: ['--from', 'git+https://github.com/maorcc/gimp-mcp', 'gimp-mcp-server'],
    setup: 'copy gimp-mcp-plugin.py from github.com/maorcc/gimp-mcp into %APPDATA%\\GIMP\\<version, e.g. 3.2>\\plug-ins\\gimp-mcp-plugin\\, restart GIMP, then Tools > MCP > Start MCP Server',
  },
  {
    name: 'krita',
    title: 'Krita (live)',
    description: 'Paint and edit in a running Krita: documents, layers, filters, export (third-party, github.com/dcc-mcp/dcc-mcp-krita; new and little used so far). Needs its Krita plug-in.',
    type: 'stdio',
    command: 'uvx',
    args: ['--from', 'dcc-mcp-krita', 'dcc-mcp-krita'],
    setup: 'run uvx --from dcc-mcp-krita dcc-mcp-krita install --dcc-path "<your Krita folder>" --yes once, restart Krita and turn on "DCC MCP Krita" under Settings > Configure Krita > Python Plugin Manager',
  },
  {
    name: 'inkscape',
    title: 'Inkscape (vector graphics)',
    description: 'Make and edit SVG drawings with Inkscape, convert and export them to PNG or PDF (third-party, github.com/aravindev/inkscape_mcp). Works without opening Inkscape. If Inkscape is not found on its own, add INKSCAPE_BIN (the full path to inkscape.exe) after adding.',
    type: 'stdio',
    command: 'uvx',
    args: ['inkscape-mcp'],
    setup: 'Inkscape has to be installed',
  },
  {
    name: 'audacity',
    title: 'Audacity (live)',
    description: 'Record, cut, apply effects to and export audio in a running Audacity (third-party, github.com/xDarkzx/Audacity-MCP). Works with Audacity 3 only: Audacity 4 has no scripting yet.',
    type: 'stdio',
    command: 'uvx',
    args: ['--from', 'audacity-mcp-server', 'audacity-mcp'],
    setup: 'use Audacity 3: in Preferences > Modules set mod-script-pipe to Enabled, then restart Audacity',
  },
  {
    name: 'reaper',
    title: 'REAPER (live)',
    description: 'Make music in a running REAPER: tracks, items, FX, MIDI, mixing and rendering (third-party, github.com/TwelveTake-Studios/reaper-mcp).',
    type: 'stdio',
    command: 'uvx',
    args: ['twelvetake-reaper-mcp'],
    setup: 'run uvx twelvetake-reaper-mcp --install-bridge once, then in REAPER load and run reaper_mcp_bridge.lua (Actions > Show action list > New action > Load ReaScript)',
  },
  {
    name: 'musescore',
    title: 'MuseScore (live)',
    description: 'Write and change sheet music in a running MuseScore 4.4 or newer (third-party, github.com/tskovlund/mcp-score).',
    type: 'stdio',
    command: 'uvx',
    args: ['--from', 'mcp-score-server', 'mcp-score', 'serve'],
    setup: 'run uvx --from mcp-score-server mcp-score install-plugin once, then in MuseScore enable MCP Score Bridge (Plugins > Manage plugins) and open it from the Plugins menu, keeping its window open',
  },
  {
    name: 'obs',
    title: 'OBS Studio (live)',
    description: 'Control OBS: scenes, sources, recording and streaming (third-party, github.com/royshil/obs-mcp). In OBS turn on Tools > WebSocket Server Settings, then add its password as OBS_WEBSOCKET_PASSWORD after adding.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'obs-mcp'],
    env: { OBS_WEBSOCKET_PASSWORD: 'YOUR_PASSWORD' },
    setup: 'in OBS turn on Tools > WebSocket Server Settings (port 4455)',
  },
  {
    name: 'topaz',
    title: 'Topaz (AI upscale, Gigapixel)',
    description: 'Upscale, sharpen and clean up images with Topaz\'s cloud service, the same AI as Gigapixel (Topaz\'s own server). It does not use the Gigapixel app on your PC. Needs a paid Topaz API key: add it as TOPAZ_API_KEY after adding.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@topazlabs/mcp'],
    env: { TOPAZ_API_KEY: 'YOUR_API_KEY' },
  },
];

/** What a ready-made server needs from the user before it works, in a few words ('' when nothing). */
export function presetNeeds(p: McpPreset): string {
  const keys = Object.entries(p.type === 'stdio' ? p.env || {} : p.headers).filter(([, v]) => /YOUR_/.test(v));
  // a header that isn't Authorization holds something else than a key (OOMOL's team name)
  const need = keys.map(([k]) => (p.type === 'stdio' ? k : /^(authorization|x-api-key)$/i.test(k) ? `a key in the ${k} header` : `a value in the ${k} header`));
  if (p.type === 'http' && /YOUR_/.test(p.url)) need.unshift('its own link in the URL');
  return [need.length ? `needs ${need.join(' and ')}` : '', p.setup ? `setup: ${p.setup}` : ''].filter(Boolean).join('; ');
}

// ---------- suggestions ----------
// Ready-made servers that drive a program (its id on the Programs page): suggested once that program is installed.
// Nothing is added on its own: these servers run other people's code, so the user clicks Add (or says yes to the Brain).
export const PRESET_PROGRAMS: Readonly<Record<string, string>> = {
  blender: 'blender',
  maya: 'maya',
  houdini: 'houdini',
  'substance-painter': 'painter',
  unity: 'unity',
  unreal: 'unreal',
  godot: 'godot',
  freecad: 'freecad',
  rhino: 'rhino',
  openscad: 'openscad',
  gimp: 'gimp',
  krita: 'krita',
  inkscape: 'inkscape',
  audacity: 'audacity',
  reaper: 'reaper',
  musescore: 'musescore',
  obs: 'obs',
  canva: 'canva',
  topaz: 'gigapixel',
  'chrome-devtools': 'chrome',
};
// Worth suggesting on any PC: no key, no setup, useful to most agents.
export const BASIC_PRESETS: readonly string[] = ['fetch', 'context7'];

/** The part of a found program a suggestion needs (server/programs.ts Program). */
interface FoundProgram {
  id: string;
  name: string;
  installed: boolean;
  exe?: string | null;
}

// A version of the program its server can't drive: Audacity 4 has no scripting pipe (the server needs Audacity 3).
const cantDrive = (preset: string, prog: FoundProgram): boolean => preset === 'audacity' && /audacity ?4/i.test(prog.exe || '');

// A link on a host or one of its subdomains.
const onHost = (url: string, host: string): boolean => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === host || h.endsWith(`.${host}`);
  } catch {
    return false;
  }
};
// The same server, whatever name it was saved under (an import, or one added by hand).
// A browser sign-in one also matches its hosted link added straight (an app that does the sign-in itself).
const sameServer = (p: McpPreset, s: McpServerConfig): boolean =>
  p.type === 'http'
    ? s.url === p.url || (!!p.host && onHost(s.url || '', p.host))
    : (s.command === p.command && (s.args || []).join(' ') === p.args.join(' ')) || (!!remoteUrl(p) && !!s.url && s.url === remoteUrl(p));

/** The ready-made servers worth adding on this PC that aren't added yet, each with why. */
export function suggestPresets(programs: readonly FoundProgram[], servers: McpServers = listServers()): McpSuggestion[] {
  const added = addedKinds(servers);
  const out: McpSuggestion[] = [];
  for (const p of PRESETS) {
    if (added.has(p.name)) continue;
    const prog = PRESET_PROGRAMS[p.name] ? programs.find((x) => x.id === PRESET_PROGRAMS[p.name] && x.installed && !cantDrive(p.name, x)) : undefined;
    const reason = prog ? `${prog.name} is installed` : BASIC_PRESETS.includes(p.name) ? 'useful to most agents, no key or setup' : '';
    if (reason) out.push({ name: p.name, title: p.title, description: p.description, reason, needs: presetNeeds(p), program: prog?.id || null });
  }
  // a program's own server first, then the basics
  return out.sort((a, b) => +!a.program - +!b.program);
}

export function listServers(): McpServers {
  return readJSON<{ servers?: McpServers }>(FILE, { servers: {} }).servers || {};
}

// ---------- keys kept out of listings ----------
// GET /api/mcp shows keys as this mark; saving a server with the mark keeps the key it has.
export const HIDDEN = '••••••••';
const SECRET_NAME = /key|token|secret|pass|auth|cred|cookie|session|signature|sig$|pat$/i;
// a link split into its pieces, the separators kept, so a hidden piece can be put back in place
const urlParts = (url: string): string[] => url.split(/([/?&=#])/);

/** A link with its key-looking parts hidden: query values named like keys, and the parts a ready-made one has YOUR_... in. */
function hideUrl(url: string, kind: string | undefined): string {
  if (!url) return url;
  const parts = urlParts(url);
  const preset = PRESETS.find((p) => p.name === kind && p.type === 'http');
  const model = preset && preset.type === 'http' && /YOUR_/.test(preset.url) ? urlParts(preset.url) : [];
  return parts.map((s, i) => (s && ((parts[i - 1] === '=' && SECRET_NAME.test(parts[i - 2] || '')) || /YOUR_/.test(model[i] || '')) ? HIDDEN : s)).join('');
}

const hideValues = (m: Record<string, string> | undefined, all: boolean): Record<string, string> =>
  Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, v && (all || SECRET_NAME.test(k)) && !/YOUR_/.test(v) ? HIDDEN : v]));

/** A server as the page may see it: environment keys, header values and keys in the link hidden. */
export function hideSecrets<T extends { env?: Record<string, string>; headers?: Record<string, string>; url?: string }>(cfg: T, kind?: string): T {
  return { ...cfg, env: hideValues(cfg.env, false), headers: hideValues(cfg.headers, true), ...(cfg.url ? { url: hideUrl(cfg.url, kind) } : {}) };
}

/** Every saved server with its keys hidden (see hideSecrets). */
export const hiddenServers = (servers: McpServers): McpServers => Object.fromEntries(Object.entries(servers).map(([n, s]) => [n, hideSecrets(s, kindOf(n, s))]));

/** Puts back the keys a form sent as HIDDEN, from the server as saved. */
function keepHidden(cfg: McpServerInput, was: McpServerConfig | undefined): McpServerInput {
  if (!was) return cfg;
  const keep = (m: Record<string, string> | undefined, old: Record<string, string>) => (m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === HIDDEN && k in old ? old[k] : v])) : m);
  let url = cfg.url;
  if (url && url.includes(HIDDEN)) {
    const now = urlParts(url);
    const old = urlParts(was.url || '');
    url = now.length === old.length ? now.map((s, i) => (s === HIDDEN ? old[i] : s)).join('') : url;
  }
  return { ...cfg, env: keep(cfg.env, was.env || {}), headers: keep(cfg.headers, was.headers || {}), url };
}

function saveAll(servers: McpServers) {
  writeJSON(FILE, { servers });
  emit('mcp');
}

/** A server's name as it is saved: letters, digits, _ and - only. */
export const serverName = (name: unknown): string => String(name ?? '').trim().replace(/[^\w-]/g, '-');

export function saveServer(name: string, input: McpServerInput): McpServerConfig {
  const clean = serverName(name);
  if (!clean) throw new Error('Give the server a name.');
  if (clean === 'dashboard') throw new Error('"dashboard" is reserved for the built-in tools.');
  const servers = listServers();
  // (the page only ever saw hidden keys: keep the real ones)
  const cfg = keepHidden(input, servers[clean]);
  const label = cleanLabel(String(cfg.label ?? ''));
  const useFor = cleanUseFor(String(cfg.useFor ?? ''));
  const kind = resolveKind(cfg.kind, servers);
  const next: McpServerConfig = {
    type: cfg.type || (cfg.url ? 'http' : 'stdio'),
    command: cfg.command || '',
    args: Array.isArray(cfg.args) ? cfg.args : String(cfg.args || '').split(/\s+/).filter(Boolean),
    env: cfg.env || {},
    url: cfg.url || '',
    headers: cfg.headers || {},
    description: cfg.description || '',
    enabled: cfg.enabled !== false,
    ...(label ? { label } : {}),
    ...(useFor ? { useFor } : {}),
  };
  // The service is kept unless it is the server's own name and the server would be that anyway. So "Its own
  // service" sticks for a server that would otherwise be worked out as a ready-made one.
  if (kind && !(kind === clean && kindOf(clean, next) === clean)) next.kind = kind;
  servers[clean] = next;
  saveAll(servers);
  disconnect(clean);
  log('mcp', `Saved MCP server "${clean}"`);
  return servers[clean];
}

export function removeServer(name: string) {
  const servers = listServers();
  delete servers[name];
  saveAll(servers);
  disconnect(name);
}

// ---------- copies: one service added more than once (several accounts) ----------
/** The service a server is. Copies of one service (accounts) share it; a server like no other is its own. */
export function kindOf(name: string, cfg: McpServerConfig | undefined): string {
  if (cfg?.kind) return cfg.kind;
  const p = PRESETS.find((x) => x.name === name) || (cfg ? PRESETS.find((x) => sameServer(x, cfg)) : undefined);
  return p?.name || name;
}

/** The service each server is, worked out once. */
export function kindsOf(servers: McpServers = listServers()): Map<string, string> {
  return new Map(Object.entries(servers).map(([n, s]) => [n, kindOf(n, s)]));
}

/** The services that are added (as any server, under any name). */
export const addedKinds = (servers: McpServers = listServers()): Set<string> => new Set(kindsOf(servers).values());

/** A service as someone named it ("OOMOL", "MyMail") -> the service as saved: a ready-made one's name, or the
 *  service of a server there, whatever the case; else the name as given. '' for none. */
export function resolveKind(ref: unknown, servers: McpServers = listServers()): string {
  const k = serverName(ref);
  if (!k) return '';
  const known = [...PRESETS.map((p) => p.name), ...kindsOf(servers).values()];
  return known.find((x) => x === k) || known.find((x) => x.toLowerCase() === k.toLowerCase()) || k;
}

/** A service's name for people: the ready-made server's title without "(remote)" and the like. */
export const serviceTitle = (kind: string): string => PRESETS.find((p) => p.name === kind)?.title.replace(/\s*\((remote|live|live editor)\)$/i, '') || kind;

/** A server as people see it: "OOMOL: Work" for a copy with a label, its name otherwise. */
export const copyTitle = (name: string, cfg: McpServerConfig | undefined): string => (cfg?.label ? `${serviceTitle(kindOf(name, cfg))}: ${cfg.label}` : name);

/** The servers of each service that is in the list more than once. */
export function copiesByKind(servers: McpServers = listServers(), names: readonly string[] = Object.keys(servers)): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of new Set(names)) {
    if (!servers[n]) continue;
    const k = kindOf(n, servers[n]);
    out.set(k, [...(out.get(k) || []), n]);
  }
  for (const [k, list] of out) if (list.length < 2) out.delete(k);
  return out;
}

/** Each server's label, service and "use for", for the page (GET /api/state). */
export function serverInfo(servers: McpServers = listServers()): Record<string, McpServerInfo> {
  const copies = copiesByKind(servers);
  return Object.fromEntries(
    Object.entries(servers).map(([n, s]): [string, McpServerInfo] => {
      const kind = kindOf(n, s);
      return [n, { title: copyTitle(n, s), label: s.label || '', kind, service: serviceTitle(kind), useFor: s.useFor || '', copies: copies.get(kind)?.length || 1 }];
    }),
  );
}

/** The copies in a list that share their service with another one in it and have no "use for": the agent couldn't tell them apart. */
export function copiesWithoutUseFor(names: readonly string[], servers: McpServers = listServers()): string[] {
  return [...copiesByKind(servers, names).values()].flat().filter((n) => !servers[n]?.useFor);
}

/** An agent's MCP servers while it works for a team: the team's copy of a service replaces the agent's own copies of it. */
export function teamWorkServers(own: readonly string[], team: readonly string[], servers: McpServers = listServers()): string[] {
  const teamKinds = new Set(team.map((n) => kindOf(n, servers[n])));
  return [...new Set([...own.filter((n) => team.includes(n) || !teamKinds.has(kindOf(n, servers[n]))), ...team])];
}

/** What an agent is told about the accounts among its MCP servers: which is which and when to use each ('' when none has a label or a "use for"). */
export function accountsPrompt(names: readonly string[], servers: McpServers = listServers()): string {
  const held = [...new Set(names)].filter((n) => servers[n] && servers[n].enabled !== false);
  // every copy of a service held more than once is listed, the ones without a label or "use for" too
  const copies = new Set([...copiesByKind(servers, held).values()].flat());
  const title = (n: string) => (servers[n].label || !copies.has(n) ? copyTitle(n, servers[n]) : `${serviceTitle(kindOf(n, servers[n]))} (no label)`);
  const lines = held
    .filter((n) => servers[n].label || servers[n].useFor || copies.has(n))
    .map((n) => `- ${title(n)} (the MCP server "${n}": its tools have "${n}" in their names)${servers[n].useFor ? `. Use it for: ${servers[n].useFor}` : copies.has(n) ? '. Nobody said what it is for: ask before you use it' : ''}`);
  if (!lines.length) return '';
  const several = copies.size > 0;
  return [
    '\n# Accounts',
    several
      ? 'Some of your MCP servers are separate accounts of the same service. For each task pick the account whose use fits it; when it is unclear which one, ask before you act. Say which account you used.'
      : 'These MCP servers are accounts: act as that account, and say which one you used.',
    ...lines,
  ].join('\n');
}

/** The account a server is, for an approval or a tool's description: "OOMOL: Work".
 *  '' for a server whose service was added only once and has no label. */
export function accountOf(server: string, servers: McpServers = listServers()): string {
  const s = servers[server];
  if (!s) return '';
  return s.label || copiesByKind(servers).has(kindOf(server, s)) ? copyTitle(server, s) : '';
}

/** The account a Claude Code tool goes through (mcp__<server>__<tool>), for an approval. '' for its own tools. */
export function accountOfTool(tool: string, servers: McpServers = listServers()): string {
  if (!tool.startsWith('mcp__')) return '';
  // the longest server name that fits: "mcp__a-b__x" is a-b's x
  const name = Object.keys(servers)
    .filter((n) => tool.startsWith(`mcp__${n}__`))
    .sort((a, b) => b.length - a.length)[0];
  return name ? accountOf(name, servers) : '';
}

/** The servers for a prompt: "oomol-work (OOMOL: Work; use for: …)" for a copy of a service, the bare name otherwise. */
export function serversForPrompt(servers: McpServers = listServers()): string {
  const copies = copiesByKind(servers);
  return Object.entries(servers)
    .map(([n, s]) => (s.label || copies.has(kindOf(n, s)) ? `${n} (${copyTitle(n, s)}${s.useFor ? `; use for: ${s.useFor.slice(0, 160)}` : ''})` : n))
    .join(', ');
}

// A name nobody has yet: base, base-2, base-3…
function freeName(base: string, servers: McpServers): string {
  let n = base;
  for (let i = 2; servers[n] || n === 'dashboard'; i++) n = `${base}-${i}`;
  return n;
}

// A copy's name stays short: its tools are named <server>__<tool>, and a tool name can't be longer than 64.
const COPY_NAME_MAX = 32;

/** The name another copy of a service gets: "<service>-<label>", or with a number when that is taken. */
export function copyName(kind: string, label: string, servers: McpServers = listServers()): string {
  const room = Math.max(0, COPY_NAME_MAX - kind.length - 1);
  const slug = serverName(label).toLowerCase().replace(/[-_]+/g, '-').replace(/^-+/, '').slice(0, room).replace(/-+$/, '');
  return freeName(slug ? `${kind}-${slug}` : kind, servers);
}

/** Where a new server of a service goes, for the page and the Brain alike: the servers of that service already
 *  there (when there are some, the new one is another account and needs a label), and the name it gets: the one
 *  asked for, else "<service>-<label>" next to other accounts, else its own. */
export function placeNew(kind: string, { name = '', base = kind, label = '' }: { name?: string; base?: string; label?: string }, servers: McpServers = listServers()): { name: string; others: string[] } {
  const others = kind ? [...kindsOf(servers)].filter(([, k]) => k === kind).map(([n]) => n) : [];
  return { name: serverName(name) || (others.length ? copyName(kind, label, servers) : serverName(base)), others };
}

const cleanLabel = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 60);
const cleanUseFor = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 300);

/** Add a ready-made server. When the service is added already this is another copy (another account): it needs
 *  a label, and is saved as "<preset>-<label>". Returns the name it got. */
export function addPreset(preset: string, { label = '', useFor = '' }: { label?: string; useFor?: string } = {}): { name: string; server: McpServerConfig } {
  const pr = PRESETS.find((x) => x.name === preset);
  if (!pr) throw new Error('Unknown preset');
  const servers = listServers();
  const clean = cleanLabel(label);
  const { name, others } = placeNew(pr.name, { label: clean }, servers);
  if (others.length && !clean) throw new Error(`${serviceTitle(pr.name)} is added already. Give this one a label (like "Work" or "Personal") to add another account.`);
  if (servers[name]) throw new Error(`There already is an MCP server named "${name}".`);
  const cfg: McpServerInput = { ...pr, description: pr.description, kind: pr.name, label: clean, useFor };
  const server = saveServer(name, others.length ? withOwnLogin(name, cfg) : cfg);
  return { name, server };
}

/** Change only a server's label and "use for" (undefined leaves one as it is). Its connection stays open:
 *  neither changes how it starts. */
export function describeCopy(name: string, { label, useFor }: { label?: string; useFor?: string }): McpServerConfig {
  const servers = listServers();
  const was = servers[name];
  if (!was) throw new Error(`No MCP server named "${name}".`);
  const next: McpServerConfig = { ...was };
  if (label !== undefined) {
    if (cleanLabel(label)) next.label = cleanLabel(label);
    else delete next.label;
  }
  if (useFor !== undefined) {
    if (cleanUseFor(useFor)) next.useFor = cleanUseFor(useFor);
    else delete next.useFor;
  }
  if ((next.label || '') === (was.label || '') && (next.useFor || '') === (was.useFor || '')) return was;
  servers[name] = next;
  saveAll(servers);
  log('mcp', `Changed the label or "use for" of MCP server "${name}"`);
  return next;
}

// An always-allowed tool of a server, after the server is renamed (or null when it is removed). Claude Code
// names a server's tools mcp__<server>__<tool>; API-model agents name them <server>__<tool>.
export function renamedGrant(grant: string, from: string, to: string | null, engine: string): string {
  const forms: [string, string][] = [[`mcp__${from}__`, `mcp__${to}__`]];
  if (engine === 'openai') forms.push([`${from}__`, `${to}__`]);
  if (grant === `mcp__${from}`) return to ? `mcp__${to}` : '';
  for (const [was, now] of forms) if (grant.startsWith(was)) return to ? now + grant.slice(was.length) : '';
  return grant;
}

// Agents and teams name their servers, so a removed or renamed server changes on all of them, in every
// project. Always-allowed tools go too: a new server with the old name mustn't inherit them.
function renameOnEveryone(from: string, to: string | null) {
  const swap = (list: string[] | undefined): string[] | null => (list || []).includes(from) ? [...new Set((list || []).map((x) => (x === from ? to : x)).filter((x): x is string => Boolean(x)))] : null;
  for (const p of listProjects()) {
    withProject(p, () => {
      for (const a of agents.list()) {
        const servers = swap(a.mcpServers);
        const had = a.alwaysAllow || [];
        const grants = had.map((g) => renamedGrant(g, from, to, a.engine));
        const grantsChanged = grants.some((g, i) => g !== had[i]);
        if (servers || grantsChanged) agents.save({ ...a, ...(servers ? { mcpServers: servers } : {}), ...(grantsChanged ? { alwaysAllow: [...new Set(grants.filter(Boolean))] } : {}) });
      }
      for (const w of workflows.list()) {
        const next = swap(w.access?.mcpServers);
        if (next) workflows.save({ ...w, access: { toolGroups: w.access?.toolGroups || [], mcpServers: next } });
      }
    });
  }
}

/** Remove a server and take it off every agent and team that had it. */
export function removeServerEverywhere(name: string) {
  removeServer(name);
  renameOnEveryone(name, null);
  log('mcp', `Removed MCP server "${name}"`);
}

/** Give a server a new name, on every agent and team that has it too, and optionally new settings in the
 *  same step (so a refused name changes nothing). Returns the name it got. */
export function renameServer(from: string, to: string, cfg?: McpServerInput): string {
  const servers = listServers();
  const was = servers[from];
  if (!was) throw new Error(`No MCP server named "${from}".`);
  const clean = serverName(to);
  if (clean === from) {
    if (cfg) saveServer(from, cfg);
    return from;
  }
  if (servers[clean]) throw new Error(`There already is an MCP server named "${clean}".`);
  // The service it is goes with it: worked out from the old name it would be lost (a first GitHub with its own
  // arguments). A server that is its own service (one added by hand) takes its new name along, and so do the
  // other accounts of it.
  const had = kindOf(from, was);
  const asked = cfg?.kind ? resolveKind(cfg.kind, servers) : '';
  const own = asked ? asked === from : had === from && !PRESETS.some((p) => p.name === from);
  saveServer(clean, { ...(cfg || was), kind: own ? clean : asked || had });
  removeServer(from);
  if (own) {
    const now = listServers();
    const moved = Object.keys(now).filter((n) => now[n].kind === from);
    for (const n of moved) now[n] = { ...now[n], kind: clean };
    if (moved.length) saveAll(now);
  }
  renameOnEveryone(from, clean);
  log('mcp', `Renamed MCP server "${from}" to "${clean}"`);
  return clean;
}

// Windows can't spawn npx/uvx .cmd shims directly; resolve or wrap them.
function resolveCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (!IS_WIN) return { command, args };
  const found = which(command);
  if (found && /\.exe$/i.test(found)) return { command: found, args };
  return { command: process.env.ComSpec || 'cmd.exe', args: ['/c', command, ...args] };
}

// ---------- live connections ----------
const clients = new Map<string, Promise<Client>>();

// test: the Test button may start a server that is turned off; agents may not
async function connect(name: string, { test = false } = {}): Promise<Client> {
  const cfg = name === 'dashboard' ? null : listServers()[name];
  if (!cfg) throw new Error(`No MCP server named "${name}".`);
  if (cfg.enabled === false && !test) throw new Error(`The MCP server "${name}" is turned off.`);
  if (clients.has(name)) return clients.get(name)!;
  const job = (async () => {
    const client = new Client({ name: 'blacksite', version: '0.1.0' });
    if (cfg.type === 'stdio') {
      const { command, args } = resolveCommand(cfg.command, cfg.args || []);
      // stderr ignored: an unread pipe fills up and freezes the server process.
      const transport = new StdioClientTransport({ command, args, env: { ...process.env, ...(cfg.env || {}) } as Record<string, string>, stderr: 'ignore' });
      await client.connect(transport);
    } else {
      const url = new URL(cfg.url);
      const requestInit = { headers: cfg.headers || {} };
      try {
        await client.connect(new StreamableHTTPClientTransport(url, { requestInit }));
      } catch (e) {
        // Older servers only speak SSE.
        const c2 = new Client({ name: 'blacksite', version: '0.1.0' });
        await c2.connect(new SSEClientTransport(url, { requestInit }));
        c2.onclose = () => clients.delete(name);
        return c2;
      }
    }
    // A server that crashed is started fresh next time.
    client.onclose = () => clients.delete(name);
    return client;
  })();
  clients.set(name, job);
  try {
    return await job;
  } catch (e) {
    clients.delete(name);
    throw new Error(`Couldn't start MCP server "${name}": ${(e as Error).message}`);
  }
}

export async function disconnect(name: string) {
  const job = clients.get(name);
  clients.delete(name);
  if (job) {
    try {
      (await job).close();
    } catch {
      /* already closed */
    }
  }
}

export async function listTools(name: string, { test = false } = {}): Promise<McpTool[]> {
  const client = await connect(name, { test });
  const r = await withTimeout(client.listTools(), 60000, `${name} took too long to list its tools`);
  return r.tools || [];
}

/** Whether a server is there and switched on (agents only get those). */
export const isEnabled = (name: string, servers: McpServers = listServers()): boolean => !!servers[name] && servers[name].enabled !== false;

/** How risky calling an MCP tool is: only one that says it just reads (readOnlyHint) skips the question on Auto. */
export const mcpToolRisk = (tool: Pick<McpTool, 'annotations'>): 'low' | 'high' => (tool.annotations?.readOnlyHint === true ? 'low' : 'high');

// Stop (signal) cancels the call: while the server is still starting, and the request itself.
export async function callTool(server: string, tool: string, args?: Record<string, unknown> | null, { signal }: { signal?: AbortSignal } = {}): Promise<McpToolResult> {
  const stopped = () => new Error('Stopped before the tool ran.');
  if (signal?.aborted) throw stopped();
  const client = await untilStopped(connect(server), signal, stopped);
  // (stopped while it connected: the call is never sent)
  if (signal?.aborted) throw stopped();
  // The SDK's return type also covers the old { toolResult } shape; servers today send CallToolResult.
  const r = (await withTimeout(client.callTool({ name: tool, arguments: args || {} }, undefined, { timeout: 10 * 60_000, resetTimeoutOnProgress: true, ...(signal ? { signal } : {}) }), 10 * 60_000, `${server}.${tool} took over 10 minutes`)) as CallToolResult;
  const texts: string[] = [];
  const images: string[] = [];
  for (const c of r.content || []) {
    if (c.type === 'text') texts.push(c.text);
    else if (c.type === 'image') images.push(`data:${c.mimeType};base64,${c.data}`);
    else if (c.type === 'resource') {
      const res = c.resource as { text?: string; uri?: string } | undefined;
      texts.push(res?.text || `[resource ${res?.uri}]`);
    }
    else texts.push(JSON.stringify(c).slice(0, 2000));
  }
  if (r.structuredContent && !texts.length) texts.push(JSON.stringify(r.structuredContent, null, 2));
  return { text: (r.isError ? 'ERROR: ' : '') + texts.join('\n'), images };
}

/** p, or fail as soon as the signal stops (p itself goes on: a server that is starting stays for next time). */
function untilStopped<T>(p: Promise<T>, signal: AbortSignal | undefined, err: () => Error): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onStop = () => reject(err());
    signal.addEventListener('abort', onStop, { once: true });
    p.then(
      (v) => (signal.removeEventListener('abort', onStop), resolve(v)),
      (e: unknown) => (signal.removeEventListener('abort', onStop), reject(e)),
    );
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

export async function testServer(name: string): Promise<{ name: string; description: string }[]> {
  const tools = await listTools(name, { test: true });
  return tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 300) }));
}

// ---------- import from Claude configs ----------
// ~/.claude.json can be many MB and the Brain looks every turn: read the configs again only when they change.
const CLAUDE_JSON = () => path.join(HOME, '.claude.json');
const DESKTOP_JSON = () => path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
let importCache: { key: string; found: ImportableServer[] } | null = null;
const fileKey = (file: string): string => {
  try {
    const st = fs.statSync(file);
    return `${file}:${st.size}:${st.mtimeMs}`;
  } catch {
    return `${file}:-`;
  }
};

export function importableServers(): ImportableServer[] {
  const key = [CLAUDE_JSON(), DESKTOP_JSON()].map(fileKey).join('|');
  if (importCache?.key !== key) importCache = { key, found: readImportable() };
  return importCache.found.map((x) => ({ ...x, args: [...x.args], env: { ...x.env }, headers: { ...x.headers } }));
}

function readImportable(): ImportableServer[] {
  const found: ImportableServer[] = [];
  const add = (source: string, servers: Record<string, ForeignServer> | undefined) => {
    for (const [name, cfg] of Object.entries(servers || {})) {
      found.push({ source, name, type: cfg.type === 'http' || cfg.type === 'sse' || cfg.url ? 'http' : 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env || {}, url: cfg.url, headers: cfg.headers || {} });
    }
  };
  const claudeJson = readJSON<ClaudeJson>(CLAUDE_JSON(), null);
  if (claudeJson) {
    add('Claude Code (user)', claudeJson.mcpServers);
    for (const [proj, p] of Object.entries(claudeJson.projects || {})) add(`Claude Code (${path.basename(proj)})`, p.mcpServers);
  }
  const desktop = readJSON<ClaudeJson>(DESKTOP_JSON(), null);
  if (desktop) add('Claude Desktop', desktop.mcpServers);
  return found;
}

// ---------- config handed to Claude Code agents ----------
export interface BridgeServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}
export function bridgeServerConfig(agentId: string | null | undefined, runId = ''): BridgeServerConfig {
  return {
    command: process.execPath,
    args: [BRIDGE_SCRIPT],
    env: { DASH_PORT: String(PORT), DASH_TOKEN: internalToken(), DASH_AGENT: agentId || '', ...(runId ? { DASH_RUN: runId } : {}) },
  };
}

export function claudeMcpConfig(agentId: string | null | undefined, serverNames: string[] = [], runId = ''): { mcpServers: Record<string, ClaudeMcpServer> } {
  const all = listServers();
  const mcpServers: Record<string, ClaudeMcpServer> = { dashboard: bridgeServerConfig(agentId, runId) };
  for (const n of serverNames) {
    const cfg = all[n];
    if (!cfg || cfg.enabled === false) continue;
    if (cfg.type === 'stdio') {
      const { command, args } = resolveCommand(cfg.command, cfg.args || []);
      mcpServers[n] = { command, args, env: cfg.env || {} };
    } else mcpServers[n] = { type: 'http', url: cfg.url, headers: cfg.headers || {} };
  }
  return { mcpServers };
}

export function presetAvailability(servers: McpServers = listServers()) {
  const kinds = [...kindsOf(servers)];
  return PRESETS.map((p) => {
    const copies = kinds.filter(([, k]) => k === p.name).map(([n]) => n);
    return { ...p, service: serviceTitle(p.name), ready: p.type === 'http' || !!which(p.command), installed: copies.length > 0, copies };
  });
}

export const hasBridge = () => exists(BRIDGE_SCRIPT);
