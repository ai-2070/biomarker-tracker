// MCP servers: ready-made medical ones (src/core/mcpPresets.ts) or the user's own.
// Started on first use; their tools are handed to the assistant.
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolSet } from "ai";
import crypto from "node:crypto";
import { mcpPreset, presetArgs, toolName } from "../src/core/mcpPresets";
import { getSecrets, getSettings, updateSecrets, updateSettings, type McpServerConfig } from "./store";

type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

interface Live {
  client: McpClient;
  tools: ToolSet;
}

const live = new Map<string, Promise<Live>>();
const lastError = new Map<string, string>();

const IS_WIN = process.platform === "win32";

/** Windows can't start npx/uvx (.cmd files) directly. */
export function resolveCommand(command: string, args: string[], win = IS_WIN): { command: string; args: string[] } {
  if (!win || /\.exe$/i.test(command)) return { command, args };
  return { command: process.env.ComSpec || "cmd.exe", args: ["/c", command, ...args] };
}

/**
 * The environment a server gets: the MCP SDK's minimal defaults (PATH, home, temp…),
 * the preset's fixed values and the user's settings. Not the whole environment,
 * so keys the user has set for other programs don't reach third-party servers.
 */
export function serverEnv(cfg: McpServerConfig, secrets: Record<string, string>): Record<string, string> {
  const presetFixed = cfg.presetId ? mcpPreset(cfg.presetId)?.fixedEnv ?? {} : {};
  return { ...getDefaultEnvironment(), ...presetFixed, ...cfg.env, ...secrets };
}

async function connect(cfg: McpServerConfig): Promise<Live> {
  const { command, args } = resolveCommand(cfg.command, cfg.args);
  const env = serverEnv(cfg, getSecrets().mcpEnv[cfg.id] ?? {});
  // stderr ignored: an unread pipe fills up and freezes the server.
  const client = await createMCPClient({ transport: new StdioClientTransport({ command, args, env, stderr: "ignore" }) });
  const tools = await client.tools();
  return { client, tools };
}

function liveFor(cfg: McpServerConfig): Promise<Live> {
  let p = live.get(cfg.id);
  if (!p) {
    p = connect(cfg).then(
      (l) => {
        lastError.delete(cfg.id);
        return l;
      },
      (e: unknown) => {
        live.delete(cfg.id); // try again fresh next time
        lastError.set(cfg.id, e instanceof Error ? e.message : String(e));
        throw e;
      },
    );
    live.set(cfg.id, p);
  }
  return p;
}

export async function stop(id: string): Promise<void> {
  const p = live.get(id);
  live.delete(id);
  if (p) await p.then((l) => l.client.close()).catch(() => undefined);
}

export async function stopAll(): Promise<void> {
  await Promise.all([...live.keys()].map(stop));
}

/** Tools of every switched-on server, named server__tool. Servers that fail are skipped and reported. */
export async function assistantTools(): Promise<{ tools: ToolSet; failed: { name: string; error: string }[] }> {
  const tools: ToolSet = {};
  const failed: { name: string; error: string }[] = [];
  for (const cfg of getSettings().mcp.filter((s) => s.enabled)) {
    try {
      const l = await liveFor(cfg);
      for (const [name, t] of Object.entries(l.tools)) tools[toolName(cfg.id, name)] = t;
    } catch (e) {
      failed.push({ name: cfg.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { tools, failed };
}

export interface ServerListing {
  id: string;
  name: string;
  presetId?: string;
  command: string;
  args: string[];
  enabled: boolean;
  running: boolean;
  error?: string;
  /** Which secret values are set (never the values). */
  secretsSet: string[];
  env: Record<string, string>;
}

export function listServers(): ServerListing[] {
  const secrets = getSecrets().mcpEnv;
  return getSettings().mcp.map((s) => {
    const err = lastError.get(s.id);
    return {
      id: s.id,
      name: s.name,
      ...(s.presetId ? { presetId: s.presetId } : {}),
      command: s.command,
      args: s.args,
      enabled: s.enabled,
      running: live.has(s.id),
      ...(err ? { error: err } : {}),
      secretsSet: Object.keys(secrets[s.id] ?? {}),
      env: s.env,
    };
  });
}

export function addPreset(presetId: string): McpServerConfig {
  const p = mcpPreset(presetId);
  if (!p) throw new Error("Unknown ready-made server.");
  if (getSettings().mcp.some((s) => s.presetId === presetId)) throw new Error(`${p.name} is already added.`);
  const cfg: McpServerConfig = { id: p.id, name: p.name, presetId: p.id, command: "npx", args: presetArgs(p), env: {}, enabled: true };
  updateSettings((s) => s.mcp.push(cfg));
  return cfg;
}

export function addCustom(input: { name: string; command: string; args: string[] }): McpServerConfig {
  const name = input.name.trim().slice(0, 60);
  const command = input.command.trim();
  if (!name || !command) throw new Error("Give the server a name and the command that starts it.");
  if (/[\r\n]/.test(command) || input.args.some((a) => /[\r\n]/.test(a))) throw new Error("The command can't contain line breaks.");
  const id = `custom-${crypto.randomBytes(4).toString("hex")}`;
  const cfg: McpServerConfig = { id, name, command, args: input.args.map((a) => a.trim()).filter(Boolean), env: {}, enabled: true };
  updateSettings((s) => s.mcp.push(cfg));
  return cfg;
}

export async function updateServer(id: string, patch: { enabled?: boolean; env?: Record<string, string | null> }): Promise<void> {
  const cfg = getSettings().mcp.find((s) => s.id === id);
  if (!cfg) throw new Error("No such server.");
  const preset = cfg.presetId ? mcpPreset(cfg.presetId) : undefined;
  if (patch.env) {
    const secretNames = new Set(preset?.env.filter((e) => e.secret).map((e) => e.name) ?? []);
    const plain: Record<string, string | null> = {};
    const secret: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(patch.env)) {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(k)) throw new Error(`"${k}" isn't a valid setting name.`);
      // For your own servers every value is treated as secret.
      (secretNames.has(k) || !preset ? secret : plain)[k] = v;
    }
    updateSecrets((s) => {
      const cur = { ...(s.mcpEnv[id] ?? {}) };
      for (const [k, v] of Object.entries(secret)) {
        if (v === null || v === "") delete cur[k];
        else cur[k] = v;
      }
      s.mcpEnv[id] = cur;
    });
    updateSettings((s) => {
      const c = s.mcp.find((x) => x.id === id)!;
      for (const [k, v] of Object.entries(plain)) {
        if (v === null || v === "") delete c.env[k];
        else c.env[k] = v;
      }
    });
  }
  if (patch.enabled !== undefined) updateSettings((s) => (s.mcp.find((x) => x.id === id)!.enabled = patch.enabled!));
  await stop(id); // new settings take effect on the next start
}

export async function removeServer(id: string): Promise<void> {
  await stop(id);
  updateSettings((s) => (s.mcp = s.mcp.filter((x) => x.id !== id)));
  updateSecrets((s) => delete s.mcpEnv[id]);
  lastError.delete(id);
}

/** Start a server and list its tools (the Test button). */
export async function testServer(id: string): Promise<{ tools: { name: string; description: string }[] }> {
  const cfg = getSettings().mcp.find((s) => s.id === id);
  if (!cfg) throw new Error("No such server.");
  await stop(id);
  const l = await liveFor(cfg);
  return { tools: Object.entries(l.tools).map(([name, t]) => ({ name, description: typeof t.description === "string" ? t.description.slice(0, 200) : "" })) };
}
