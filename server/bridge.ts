// The app's tools for agent programs (Claude Code, Codex, Hermes) as an MCP server over HTTP at /mcp.
// Each question opens a run with its own random token; the agent gets that token and can call the
// tools (results, research, skills, MCP servers) only until the answer is done. Every call is recorded,
// and the studies tools returned are the only ones the answer may cite.
import crypto from "node:crypto";
import type http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { asSchema, type ToolSet } from "ai";
import { studyIdsFromTool, toolStep, type ToolStep } from "./steps";
import { getSecrets, updateSecrets } from "./store";

export const BRIDGE_NAME = "biomarker-tracker";

export interface BridgeRun {
  token: string;
  tools: ToolSet;
  steps: ToolStep[];
  ids: Set<string>;
}

const runs = new Map<string, BridgeRun>();
/** The run an agent registered with the stable token (Hermes) should use: the one answering now. */
const current = new Map<string, BridgeRun>();

let port = 4820;
export const setBridgePort = (p: number) => (port = p);
export const bridgeUrl = () => `http://127.0.0.1:${port}/mcp`;

export function openRun(tools: ToolSet, engine?: string): BridgeRun {
  // Hermes stores one stable token: overlapping runs must never retarget it to another scope.
  if (engine === "hermes" && current.has(engine)) throw new Error("Hermes is still answering another question. Wait for it to finish or choose another model.");
  const run: BridgeRun = { token: crypto.randomBytes(32).toString("hex"), tools, steps: [], ids: new Set() };
  runs.set(run.token, run);
  if (engine) current.set(engine, run);
  return run;
}

export function closeRun(run: BridgeRun): void {
  runs.delete(run.token);
  for (const [k, v] of current) if (v === run) current.delete(k);
}

/** A token that doesn't change, for agents that store the server address in their own settings. */
export function stableToken(): string {
  const t = getSecrets().bridgeToken;
  if (t) return t;
  const fresh = crypto.randomBytes(32).toString("hex");
  updateSecrets((s) => (s.bridgeToken = fresh));
  return fresh;
}

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Which run a token belongs to; "idle" for the stable token when no question is being answered. */
export function runFor(token: string): BridgeRun | "idle" | undefined {
  if (!token) return undefined;
  const run = runs.get(token);
  if (run) return run;
  const stable = getSecrets().bridgeToken;
  if (stable && same(token, stable)) return current.get("hermes") ?? "idle";
  return undefined;
}

function tokenOf(req: http.IncomingMessage, url: URL): string {
  const auth = req.headers.authorization ?? "";
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(auth);
  return m ? m[1]! : (url.searchParams.get("token") ?? "");
}

async function listTools(tools: ToolSet): Promise<Tool[]> {
  const out: Tool[] = [];
  for (const [name, t] of Object.entries(tools)) {
    const schema = (await asSchema(t.inputSchema).jsonSchema) as Tool["inputSchema"];
    out.push({ name, description: typeof t.description === "string" ? t.description : "", inputSchema: { ...schema, type: "object" } });
  }
  return out;
}

/** Runs one tool for a run and records it. */
export async function callTool(run: BridgeRun, name: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const t = run.tools[name];
  if (!t?.execute) return { text: `No tool called ${name}.`, isError: true };
  run.steps.push(toolStep(name, input));
  try {
    const output: unknown = await t.execute(input, { toolCallId: crypto.randomUUID(), messages: [] } as unknown as Parameters<NonNullable<typeof t.execute>>[1]);
    for (const id of studyIdsFromTool(name, output)) run.ids.add(id);
    return { text: typeof output === "string" ? output : JSON.stringify(output), isError: false };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}

/** Handles a request to /mcp. The caller has already checked the Host header. */
export async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse, url: URL, body: unknown): Promise<void> {
  const run = runFor(tokenOf(req, url));
  if (!run) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not allowed." }));
    return;
  }
  const server = new Server({ name: BRIDGE_NAME, version: "1.0.0" }, { capabilities: { tools: {} } });
  // While idle (e.g. Hermes checking the connection), list the tools but don't run them.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools(run === "idle" ? idleTools() : run.tools) }));
  server.setRequestHandler(CallToolRequestSchema, async (r) => {
    if (run === "idle") return { content: [{ type: "text", text: "Ask your question in the Biomarker Tracker app; its tools only work while it is answering." }], isError: true };
    const out = await callTool(run, r.params.name, r.params.arguments ?? {});
    return { content: [{ type: "text", text: out.text }], isError: out.isError };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

let idle: () => ToolSet = () => ({});
/** The tool list shown while no question is being answered (set by the assistant module). */
export const setIdleTools = (fn: () => ToolSet) => (idle = fn);
const idleTools = () => idle();
