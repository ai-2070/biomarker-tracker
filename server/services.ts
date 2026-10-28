// Services a message asks for (GitHub, Blender, a post on X…) and who in a team can reach them: a
// message nobody is named in goes to the only member with the service it needs (see teams.ts).
// Deterministic: words in the message against the agents' tool groups and MCP servers.
import type { Agent } from '../shared/types.ts';

interface Service {
  label: string;
  /** whole words or phrases that name it in a message */
  words: RegExp;
  /** an agent has it with this tool group… */
  group?: string;
  /** …or with this MCP server */
  server?: string;
}

// Tool groups that are a service of their own (files, shell, browser, programs and delegate are not).
const GROUP_SERVICES: Service[] = [
  { label: 'ComfyUI', words: /\bcomfy(ui)?\b/i, group: 'comfyui' },
  { label: 'Blender', words: /\bblender\b/i, group: 'blender' },
  { label: 'Adobe', words: /\b(adobe|photoshop|after effects|premiere)\b/i, group: 'adobe' },
  { label: 'FFmpeg', words: /\bffmpeg\b/i, group: 'media' },
  // Maya is also a name, so only "in Maya", "Autodesk Maya" and the like
  { label: 'Maya', words: /\b((in|with|using|open|into|from) maya|autodesk maya|maya (scene|python|rig|file)s?|mayapy)\b/i, group: 'maya' },
  { label: 'Houdini', words: /\b(houdini|hython)\b/i, group: 'houdini' },
  { label: 'Substance 3D', words: /\bsubstance (3d|painter|designer|sampler)\b|\.sbsar\b|\bsbsar\b/i, group: 'substance' },
  { label: 'CAD and 3D printing', words: /\b(openscad|prusaslicer|g-?code|slic(e|ing) (the |a |this )?(model|stl))\b/i, group: 'cad' },
  { label: 'NVIDIA', words: /\b(nvidia-smi|nvtt|dds textures?)\b/i, group: 'nvidia' },
  { label: 'Free asset libraries', words: /\b(poly ?haven|ambient ?cg|hdris?)\b/i, group: 'assets' },
  { label: 'social posts', words: /\b(tweets?|tweet(ed|ing)|post(ed|ing)? (it )?(on|to) x|x (post|thread|dm)s?|reddit|subreddits?|telegram|discord)\b/i, group: 'social' },
  { label: 'Orca', words: /\borca\b/i, group: 'orca' },
];

// MCP server names too common as words to mean the server ("fetch the data", "from memory")
const GENERIC_SERVERS = new Set(['memory', 'fetch', 'filesystem', 'files', 'sequential-thinking', 'git', 'time', 'search', 'browser', 'dashboard']);

/** An MCP server's name as words in a message: "chrome-devtools" also matches "chrome devtools". */
const serverWords = (name: string): RegExp => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_]/g, '[-_ ]?')}\\b`, 'i');

/** The services a message names, given the MCP servers the team's members have. */
export function servicesIn(text: string, servers: readonly string[]): Service[] {
  const mcp = [...new Set(servers)].filter((s) => s && !GENERIC_SERVERS.has(s.toLowerCase())).map((s): Service => ({ label: s, words: serverWords(s), server: s }));
  return [...GROUP_SERVICES, ...mcp].filter((s) => s.words.test(text));
}

/** What an agent can reach that not everyone can (its service tool groups and MCP servers), for the team roster. */
export function servicesOf(a: Agent): string[] {
  const groups = GROUP_SERVICES.filter((s) => (a.toolGroups || []).includes(s.group!)).map((s) => s.label);
  return [...groups, ...(a.mcpServers || []).filter((s) => !GENERIC_SERVERS.has(s.toLowerCase()))];
}

const has = (a: Agent, s: Service): boolean => (s.group ? (a.toolGroups || []).includes(s.group) : (a.mcpServers || []).includes(s.server!));

/** The one member who can reach what the message asks for, when only one can: every service the
 *  message names that only one member has points at that same member. Null when nothing it names is
 *  anyone's alone, or when it would take two members (the lead or the best fit sorts that out). */
export function soleHolder(text: string, members: readonly Agent[]): { id: string; service: string } | null {
  const named = servicesIn(text, members.flatMap((a) => a.mcpServers || []));
  let pick: { id: string; service: string } | null = null;
  for (const s of named) {
    const holders = members.filter((a) => has(a, s));
    if (holders.length !== 1) continue;
    if (pick && pick.id !== holders[0].id) return null;
    pick ??= { id: holders[0].id, service: s.label };
  }
  return pick;
}
