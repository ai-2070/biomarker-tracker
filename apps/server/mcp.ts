// MCP servers: ready-made medical ones (packages/shared/src/core/mcpPresets.ts) or the user's own.
// Started on first use; their tools are handed to the assistant.
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { asSchema, tool, type ToolSet } from "ai";
import { z } from "zod";
import crypto from "node:crypto";
import { MCP_PRESETS, mcpPreset, presetArgs, type McpPreset } from "@bt/shared/core/mcpPresets";
import { getSecrets, getSettings, updateSecrets, updateSettings, type McpServerConfig } from "./store";
import { which } from "./which";
import type { McpServerListing } from "@bt/shared/api/types";

/** How long a question waits for a server that is still starting (it keeps starting in the background). */
const START_WAIT_MS = 45_000;

/** The ready-made servers run with npx, which comes with Node.js. */
export const hasNpx = (): boolean => !!which("npx");

type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

interface Live {
  client: McpClient;
  tools: ToolSet;
}

const live = new Map<string, Promise<Live>>();
/** Each server's connection, kept so a server that is still starting can be stopped. */
const transports = new Map<string, StdioClientTransport>();
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
  const transport = new StdioClientTransport({ command, args, env, stderr: "ignore" });
  transports.set(cfg.id, transport);
  let client: McpClient | undefined;
  try {
    client = await createMCPClient({ transport });
    const tools = await client.tools();
    // stop/remove may have invalidated this start while initialization or discovery awaited.
    if (transports.get(cfg.id) !== transport) throw new Error("The research server was stopped.");
    return { client, tools };
  } catch (e) {
    if (transports.get(cfg.id) === transport) transports.delete(cfg.id);
    await client?.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw e;
  }
}

function liveFor(cfg: McpServerConfig): Promise<Live> {
  if (!getSettings().mcp.some((s) => s.id === cfg.id)) return Promise.reject(new Error("No such server."));
  let p = live.get(cfg.id);
  if (!p) {
    const started: Promise<Live> = connect(cfg).then(
      (l) => {
        lastError.delete(cfg.id);
        return l;
      },
      (e: unknown) => {
        if (live.get(cfg.id) === started) {
          live.delete(cfg.id); // try again fresh next time
          lastError.set(cfg.id, e instanceof Error ? e.message : String(e));
        }
        throw e;
      },
    );
    live.set(cfg.id, started);
    p = started;
  }
  return p;
}

export async function stop(id: string): Promise<void> {
  live.delete(id);
  const t = transports.get(id);
  transports.delete(id);
  // Closing the connection ends the server's process, also while it is still starting.
  if (t) await t.close().catch(() => undefined);
}

export async function stopAll(): Promise<void> {
  await Promise.all([...new Set([...live.keys(), ...transports.keys()])].map(stop));
}

/**
 * Tools of every switched-on server, named server__tool. Servers start in parallel; one that fails, or is
 * still starting after waitMs (e.g. the first download), is skipped for this question and reported.
 */
export async function assistantTools(waitMs = START_WAIT_MS): Promise<{ tools: ToolSet; failed: { name: string; error: string }[]; servers: ServerInfo[] }> {
  const byServer = new Map<string, ToolSet>();
  const admitted = new Map<string, Promise<Live>>();
  const servers: ServerInfo[] = [];
  const failed: { name: string; error: string }[] = [];
  const enabled = getSettings().mcp.filter((s) => s.enabled);
  await Promise.all(
    enabled.map(async (cfg) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("still starting (the first start downloads it); it will be ready for a later question")), waitMs);
      });
      try {
        const pending = liveFor(cfg);
        const l = await Promise.race([pending, slow]);
        if (live.get(cfg.id) !== pending || !getSettings().mcp.some((s) => s.id === cfg.id && s.enabled)) return;
        admitted.set(cfg.id, pending);
        byServer.set(cfg.id, l.tools);
        const preset = cfg.presetId ? mcpPreset(cfg.presetId) : undefined;
        servers.push({ id: cfg.id, name: cfg.name, about: preset?.description ?? "", tools: Object.keys(l.tools).length });
      } catch (e) {
        failed.push({ name: cfg.name, error: e instanceof Error ? e.message : String(e) });
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  // A different server may have kept this question waiting while an earlier one was removed.
  const current = getSettings().mcp;
  for (const id of byServer.keys()) {
    if (live.get(id) !== admitted.get(id) || !current.some((s) => s.id === id && s.enabled)) byServer.delete(id);
  }
  const available = servers.filter((s) => byServer.has(s.id)).sort((a, b) => a.id.localeCompare(b.id));
  return { tools: byServer.size ? researchTools(byServer) : {}, failed, servers: available };
}

export interface ServerInfo {
  id: string;
  name: string;
  about: string;
  tools: number;
}

/**
 * The servers' tools behind two tools: one lists a server's tools, one calls one of them. Together the
 * ready-made servers have well over 100 tools; sending them all with every question would cost a lot,
 * confuse smaller models and break providers that cap the number of tools (OpenAI: 128).
 */
export function researchTools(byServer: Map<string, ToolSet>): ToolSet {
  const serverIds = [...byServer.keys()];
  return {
    research_tools: tool({
      // The ids are in the system prompt's server list; keeping them out of the description keeps the tool
      // definitions the same while servers start or fail (prompt cache).
      description: "List the tools of one connected research server (ids are in the research server list), with what each needs. Call this before use_research_tool.",
      inputSchema: z.object({ server: z.string().describe("Server id") }),
      execute: async ({ server }) => {
        const set = byServer.get(server);
        if (!set) return { error: `No server called "${server}". Connected: ${serverIds.join(", ")}.` };
        const tools = [];
        for (const [name, t] of Object.entries(set)) {
          tools.push({ name, description: typeof t.description === "string" ? t.description.slice(0, 400) : "", input: await asSchema(t.inputSchema).jsonSchema });
        }
        return { server, tools };
      },
    }),
    use_research_tool: tool({
      description: "Call one tool of a connected research server, with the input its research_tools entry describes.",
      inputSchema: z.object({
        server: z.string().describe("Server id"),
        tool: z.string().describe("Tool name from research_tools"),
        input: z.record(z.string(), z.unknown()).describe("The tool's input").default({}),
      }),
      execute: async ({ server, tool: name, input }, options) => {
        const t = byServer.get(server)?.[name];
        if (!t?.execute) return { error: `No tool "${name}" on "${server}". Call research_tools first.` };
        return (await t.execute(input, options)) as unknown;
      },
    }),
  };
}

/** Starts the switched-on servers in the background, so the first question doesn't wait for downloads. */
export function warmUp(): void {
  for (const cfg of getSettings().mcp.filter((s) => s.enabled)) void liveFor(cfg).catch(() => undefined);
}

function presetConfig(p: McpPreset, enabled: boolean): McpServerConfig {
  return { id: p.id, name: p.name, presetId: p.id, command: "npx", args: presetArgs(p), env: {}, enabled };
}

/**
 * First start: add every ready-made server. Those that need no key are switched on when npx is available.
 * Runs once; a server the user removes stays removed.
 */
export function ensureDefaultServers(npx = hasNpx()): void {
  if (getSettings().mcpSeeded) return;
  updateSettings((s) => {
    for (const p of MCP_PRESETS) {
      if (s.mcp.some((x) => x.presetId === p.id)) continue;
      s.mcp.push(presetConfig(p, npx && !p.env.some((v) => v.required)));
    }
    s.mcpSeeded = true;
  });
}


export function listServers(): McpServerListing[] {
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
  const cfg = presetConfig(p, true);
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
  // End admission before the first await so another question cannot start a replacement.
  updateSettings((s) => (s.mcp = s.mcp.filter((x) => x.id !== id)));
  await stop(id);
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
