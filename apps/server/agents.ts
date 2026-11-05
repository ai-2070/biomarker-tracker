// Agent programs the assistant can run instead of an API model: Claude Code, Codex, Hermes, OpenClaw.
// Each question starts the program once, without its own file, shell or web tools where it allows that.
// Claude Code, Codex and Hermes (once connected) reach the app's tools through the bridge (bridge.ts),
// so their answers can be checked like any other. OpenClaw gets a summary of the data in the prompt.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolSet } from "ai";
import { providerInfo, type Effort, type ProviderId } from "@bt/core/aiProviders";
import { BRIDGE_NAME, bridgeUrl, closeRun, openRun, stableToken, type BridgeRun } from "./bridge";
import { which } from "./which";
import { killTree, spawnTree } from "./processTree";

export { which } from "./which";
import type { ToolStep } from "./steps";
import type { OnEvent } from "./brain/events";

export type AgentId = Extract<ProviderId, "claude-code" | "codex" | "hermes" | "openclaw">;
export const isAgent = (id: string): id is AgentId => providerInfo(id)?.kind === "agent";

const IS_WIN = process.platform === "win32";
/** Same as the assistant's limit (brain/ask.ts): no step or turn limit, 10 minutes per question. */
const TIMEOUT_MS = 10 * 60_000;

export function agentInstalled(id: string): boolean {
  const cmd = providerInfo(id)?.command;
  return !!cmd && !!which(cmd);
}

interface Done {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a program to the end: input on stdin, stops on abort or after the time limit. The program runs in its
 * own process group, so stopping it also stops anything it started; whatever it leaves running when it exits
 * on its own is stopped too (a leftover helper would otherwise hold the output pipe open).
 */
export function runProgram(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; input?: string; signal?: AbortSignal; timeoutMs?: number; onLine?: (line: string) => void; graceMs?: number }): Promise<Done> {
  const exe = which(cmd);
  if (!exe) return Promise.resolve({ code: -1, stdout: "", stderr: `The \`${cmd}\` command wasn't found.` });
  if (opts.signal?.aborted) return Promise.resolve({ code: null, stdout: "", stderr: "Stopped." });
  // .cmd/.bat (npm installs on Windows) only run through cmd.exe. Our arguments contain no quotes or spaces
  // except file paths, which Node quotes.
  const viaCmd = IS_WIN && /\.(cmd|bat)$/i.test(exe);
  const child = spawnTree(viaCmd ? "cmd.exe" : exe, viaCmd ? ["/d", "/c", exe, ...args] : args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, PYTHONIOENCODING: "utf-8" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let partial = "";
  child.stdout!.setEncoding("utf8").on("data", (d: string) => {
    if (stdout.length < 5_000_000) stdout += d;
    if (!opts.onLine) return;
    partial += d;
    const lines = partial.split(/\r?\n/);
    partial = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) opts.onLine(line);
  });
  child.stderr!.setEncoding("utf8").on("data", (d: string) => stderr.length < 200_000 && (stderr += d));
  child.stdin!.on("error", () => {});
  child.stdin!.end(opts.input ?? "");
  const stop = () => void killTree(child, opts.graceMs);
  opts.signal?.addEventListener("abort", stop);
  const timer = setTimeout(stop, opts.timeoutMs ?? TIMEOUT_MS);
  // Its own work is done: stop anything it left behind, so the pipes close.
  child.once("exit", () => void killTree(child, opts.graceMs));
  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", stop);
      if (opts.onLine && partial.trim()) opts.onLine(partial);
      resolve({ code, stdout, stderr });
    };
    child.on("close", finish);
    child.on("error", (e) => {
      stderr += e.message;
      finish(-1);
    });
  });
}

const jsonLines = (out: string): Record<string, unknown>[] =>
  out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Record<string, unknown>];
      } catch {
        return [];
      }
    });

const lastLines = (s: string, n = 600) => s.trim().slice(-n);

type Parsed = { ok: true; text: string; tools?: string[]; model?: string; truncated?: boolean } | { ok: false; error: string };

// ---- The prompt -------------------------------------------------------------------------------

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

/** The conversation as one message (each question starts the agent fresh). */
export function conversationText(messages: AgentMessage[]): string {
  const last = messages[messages.length - 1]?.content ?? "";
  if (messages.length <= 1) return last;
  const earlier = messages
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "You (earlier answer)"}: ${m.content}`)
    .join("\n\n");
  return `Earlier in this conversation:\n\n${earlier}\n\n---\n\nThe user's new question:\n${last}`;
}

export const BRIDGE_NOTE = [
  "",
  `Your tools: the "${BRIDGE_NAME}" MCP server gives you the user's data and research tools (get_results, get_marker, search_research, read_skill and more; your program may show them with a prefix). Use only these tools. Don't use web search, files or a shell.`,
].join("\n");

export const NO_TOOLS_NOTE = [
  "",
  "You don't have the app's tools in this setup. The user's data is below, worked out by the app; use these numbers as they are.",
  "You can't search research through the app here, so the app can't check citations: don't cite study IDs. If you mention research, say it is from general knowledge and should be checked.",
].join("\n");

// ---- Claude Code ------------------------------------------------------------------------------

export function claudeArgs(o: { model?: string; effort?: Effort; systemFile: string; mcpFile?: string }): string[] {
  // --include-partial-messages: the answer's text arrives as it is written (streamed to the page).
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--system-prompt-file", o.systemFile, "--no-session-persistence"];
  if (o.mcpFile) args.push("--mcp-config", o.mcpFile, "--strict-mcp-config", "--allowedTools", "mcp__bt");
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  // No built-in tools (files, shell, web): only the app's tools.
  args.push("--tools", "");
  return args;
}

export function parseClaude(out: string, stderr: string): Parsed {
  const lines = jsonLines(out);
  const result = lines.findLast((l) => l.type === "result");
  if (!result) return { ok: false, error: `Claude Code stopped without an answer. ${lastLines(stderr || out)}`.trim() };
  const text = typeof result.result === "string" ? result.result : "";
  if (result.is_error || result.subtype !== "success") return { ok: false, error: `Claude Code: ${text || String(result.subtype ?? "error")}`.slice(0, 600) };
  const usageModels = result.modelUsage && typeof result.modelUsage === "object" ? Object.keys(result.modelUsage).filter((name) => name.length > 0 && name.length <= 200) : [];
  const message = lines.findLast((line) => line.type === "assistant" && typeof line.message === "object" && line.message !== null)?.message as { model?: unknown; stop_reason?: unknown } | undefined;
  const model = usageModels.length ? usageModels.join(", ") : typeof message?.model === "string" ? message.model : undefined;
  return { ok: true, text, ...(model ? { model } : {}), ...(message?.stop_reason === "max_tokens" ? { truncated: true } : {}) };
}

const record = (line: string): Record<string, unknown> | undefined => {
  try {
    const v = JSON.parse(line) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Claude Code's answer text as it is written: `stream_event` text deltas (--include-partial-messages), or a
 * whole assistant message's text when it wasn't streamed. Sub-agent output and tool calls are left out (the
 * bridge reports the app's tools as they run).
 */
export function claudeLines(emit: OnEvent): (line: string) => void {
  const streamed = new Set<string>();
  return (line) => {
    const ev = record(line);
    if (!ev || ev.parent_tool_use_id) return;
    if (ev.type === "stream_event") {
      const e = ev.event as { type?: string; message?: { id?: string }; delta?: { type?: string; text?: unknown } } | undefined;
      if (e?.type === "message_start" && typeof e.message?.id === "string") streamed.add(e.message.id);
      if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && typeof e.delta.text === "string") emit({ kind: "text", text: e.delta.text });
    } else if (ev.type === "assistant") {
      const message = ev.message as { id?: string; content?: { type?: string; text?: unknown }[] } | undefined;
      if (!message || (typeof message.id === "string" && streamed.has(message.id))) return;
      for (const block of message.content ?? []) if (block.type === "text" && typeof block.text === "string" && block.text) emit({ kind: "text", text: block.text });
    }
  };
}

/** Codex writes whole messages, not deltas: each agent message is passed on when it is done. */
export function codexLines(emit: OnEvent): (line: string) => void {
  let said = false;
  return (line) => {
    const ev = record(line);
    const item = ev?.item as { type?: string; text?: unknown } | undefined;
    if (ev?.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string" && item.text) {
      emit({ kind: "text", text: (said ? "\n\n" : "") + item.text });
      said = true;
    } else if (ev?.type === "item.started" && item?.type === "reasoning") emit({ kind: "status", text: "Thinking…" });
  };
}

/** Hermes streams its text in `text` lines. */
export function hermesLines(emit: OnEvent): (line: string) => void {
  return (line) => {
    const ev = record(line);
    if (ev?.type === "text" && typeof ev.text === "string" && ev.text) emit({ kind: "text", text: ev.text });
  };
}

// ---- Codex ------------------------------------------------------------------------------------

/** Codex reads -c values as TOML and falls back to a plain string, so no quotes are needed. */
export function codexArgs(o: { model?: string; effort?: Effort; dir: string; bridge?: boolean }): string[] {
  const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-C", o.dir];
  if (o.bridge) args.push("-c", `mcp_servers.bt.url=${bridgeUrl()}`, "-c", "mcp_servers.bt.bearer_token_env_var=BT_BRIDGE_TOKEN", "-c", "mcp_servers.bt.tool_timeout_sec=300");
  if (o.model) args.push("-m", o.model);
  if (o.effort) args.push("-c", `model_reasoning_effort=${o.effort}`);
  args.push("-");
  return args;
}

export function parseCodex(out: string, stderr: string): Parsed {
  let text = "";
  let error = "";
  for (const ev of jsonLines(out)) {
    const item = ev.item as { type?: string; text?: string } | undefined;
    if (ev.type === "item.completed" && item?.type === "agent_message" && item.text) text = item.text;
    if (ev.type === "turn.failed") error = String((ev.error as { message?: string } | undefined)?.message ?? "Codex failed.");
    if (ev.type === "error" && typeof ev.message === "string") error = ev.message;
  }
  if (error) return { ok: false, error: `Codex: ${error}`.slice(0, 600) };
  if (text) return { ok: true, text };
  return { ok: false, error: `Codex: ${error || lastLines(stderr || out) || "no answer."}`.slice(0, 600) };
}

// ---- Hermes -----------------------------------------------------------------------------------

export function hermesArgs(o: { model?: string; effort?: Effort; profile?: string }): string[] {
  const args: string[] = [];
  if (o.profile) args.push("-p", o.profile);
  args.push("chat", "--query-file", "-", "--format", "stream-json");
  if (o.model) args.push("-m", o.model);
  if (o.effort) args.push("--reasoning", o.effort);
  return args;
}

export function parseHermes(out: string, stderr: string): Parsed {
  const lines = jsonLines(out);
  const result = lines.findLast((l) => l.type === "result");
  const text = typeof result?.text === "string" ? result.text : lines.filter((l) => l.type === "text" && typeof l.text === "string").map((l) => l.text as string).join("");
  if (result?.exit_code && result.exit_code !== 0) return { ok: false, error: `Hermes: ${text || `failed (exit ${String(result.exit_code)})`}`.slice(0, 600) };
  if (!text) return { ok: false, error: `Hermes stopped without an answer. ${lastLines(stderr || out)}`.trim() };
  return { ok: true, text, ...(typeof result?.model === "string" && result.model.trim() ? { model: result.model.trim() } : {}), ...(result?.finish_reason === "length" || result?.stop_reason === "max_tokens" ? { truncated: true } : {}) };
}

let hermesCache: { at: number; connected: boolean } | null = null;

/** Whether Hermes has the app's tools in its MCP list. */
export async function hermesConnected(fresh = false): Promise<boolean> {
  if (!fresh && hermesCache && Date.now() - hermesCache.at < 30_000) return hermesCache.connected;
  if (!agentInstalled("hermes")) return false;
  const r = await runProgram("hermes", ["mcp", "list"], { cwd: os.homedir(), timeoutMs: 60_000 });
  const connected = r.stdout.includes(BRIDGE_NAME);
  hermesCache = { at: Date.now(), connected };
  return connected;
}

/** Adds (or removes) the app's tools in Hermes' own MCP settings. Only when the user presses the button. */
export async function setHermesConnection(on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!agentInstalled("hermes")) return { ok: false, error: "Hermes isn't installed." };
  await runProgram("hermes", ["mcp", "remove", BRIDGE_NAME], { cwd: os.homedir(), timeoutMs: 60_000 });
  if (on) {
    // Hermes asks two questions: "requires authentication?" (no: the token is in the address) and "enable all tools?" (yes).
    const r = await runProgram("hermes", ["mcp", "add", BRIDGE_NAME, "--url", `${bridgeUrl()}?token=${stableToken()}`], { cwd: os.homedir(), input: "n\n\n", timeoutMs: 120_000 });
    if (r.code !== 0) return { ok: false, error: lastLines(r.stderr || r.stdout, 400) || "Hermes couldn't add the server." };
  }
  const now = await hermesConnected(true);
  return now === on ? { ok: true } : { ok: false, error: on ? "Hermes didn't list the server after adding it." : "Hermes still lists the server." };
}

// ---- OpenClaw ---------------------------------------------------------------------------------

export function openclawArgs(o: { model?: string; effort?: Effort; profile?: string; messageFile: string; sessionKey: string; local?: boolean }): string[] {
  const args = ["agent"];
  if (o.profile) args.push("--agent", o.profile);
  args.push("--session-key", o.sessionKey, "--message-file", o.messageFile, "--json", "--timeout", "0");
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--thinking", o.effort);
  if (o.local) args.push("--local");
  return args;
}

interface OpenClawMeta {
  finalAssistantVisibleText?: string;
  error?: { message?: string };
  toolSummary?: { tools?: string[] };
}
interface OpenClawReply {
  ok?: boolean;
  error?: string | { message?: string };
  payloads?: { text?: string | null }[];
  meta?: OpenClawMeta;
  result?: { payloads?: { text?: string | null }[]; meta?: OpenClawMeta };
}

export function parseOpenClaw(out: string, stderr: string): Parsed & { gatewayDown?: boolean } {
  let reply: OpenClawReply | null = null;
  const start = out.indexOf("{");
  if (start !== -1) {
    try {
      reply = JSON.parse(out.slice(start)) as OpenClawReply;
    } catch {
      reply = null;
    }
  }
  if (!reply) return { ok: false, error: `OpenClaw stopped without an answer. ${lastLines(stderr || out)}`.trim() };
  const errText = typeof reply.error === "string" ? reply.error : (reply.error?.message ?? "");
  if (reply.ok === false) {
    return { ok: false, error: `OpenClaw: ${errText || "failed."}`.slice(0, 600), gatewayDown: /gateway not reachable|ECONNREFUSED|gateway.{0,40}(closed|not running|unavailable)/i.test(errText) };
  }
  const body = reply.result && (reply.result.payloads || reply.result.meta) ? reply.result : reply;
  const meta = body.meta ?? {};
  const text = (body.payloads ?? []).map((p) => p?.text ?? "").filter(Boolean).join("\n\n") || meta.finalAssistantVisibleText || "";
  if (!text) return { ok: false, error: `OpenClaw: ${meta.error?.message || "no answer."}` };
  return { ok: true, text, ...(meta.toolSummary?.tools?.length ? { tools: meta.toolSummary.tools } : {}) };
}

// ---- Running a question -----------------------------------------------------------------------

export interface AgentRequest {
  provider: AgentId;
  model: string;
  effort?: Effort;
  profile?: string;
  /** The assistant's stable rules (brain/prompt.ts). */
  system: string;
  /** This request's part of the prompt (critical results, cautions, the date), after the stable rules. */
  context?: string;
  messages: AgentMessage[];
  /** The app's tools, offered through the bridge. */
  tools: ToolSet;
  /** The user's data as text, for agents without the bridge. */
  dataPack: () => string;
  /** Claim reviews must never silently start another program run after a failure. */
  claimReview?: boolean;
  signal?: AbortSignal;
  /** The answer's text and the app's tool calls as they happen. */
  onEvent?: OnEvent;
}

export type AgentReply = { ok: true; text: string; steps: ToolStep[]; studyIds: string[]; usedTools: boolean; model?: string; truncated?: boolean } | { ok: false; error: string };

export async function runAgent(req: AgentRequest): Promise<AgentReply> {
  const { provider } = req;
  if (req.signal?.aborted) return { ok: false, error: "Stopped." };
  const info = providerInfo(provider)!;
  if (!agentInstalled(provider)) return { ok: false, error: `${info.label} isn't installed on this computer (the \`${info.command}\` command wasn't found).` };
  const bridged = provider === "claude-code" || provider === "codex" || (provider === "hermes" && (await hermesConnected()));
  if (req.signal?.aborted) return { ok: false, error: "Stopped." };
  // Stable rules and the tools note first, then this request's part and data (prompt cache: the program's
  // provider reads the unchanged start from its cache).
  const system = [req.system + (bridged ? BRIDGE_NOTE : NO_TOOLS_NOTE), req.context, bridged ? "" : `The user's data:\n${req.dataPack()}`].filter(Boolean).join("\n\n");
  const question = conversationText(req.messages);
  const model = req.model.trim() || undefined;
  const effort = req.effort;
  const profile = req.profile?.trim() || undefined;
  // An empty folder to work in, so the agent doesn't pick up project files or instructions.
  let run: BridgeRun | undefined;
  try {
    run = bridged ? openRun(req.tools, provider, req.onEvent) : undefined;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let dir: string;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-agent-"));
  } catch (e) {
    if (run) closeRun(run);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const emit: OnEvent = req.onEvent ?? (() => {});
  emit({ kind: "status", text: `${info.label} is working…` });
  try {
    let parsed: Parsed;
    if (provider === "claude-code") {
      const systemFile = path.join(dir, "system.md");
      fs.writeFileSync(systemFile, system);
      let mcpFile: string | undefined;
      if (run) {
        mcpFile = path.join(dir, "mcp.json");
        fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { bt: { type: "http", url: bridgeUrl(), headers: { Authorization: `Bearer ${run.token}` } } } }));
      }
      const args = claudeArgs({ model, effort, systemFile, mcpFile });
      const r = await runProgram("claude", args, { cwd: dir, input: question, signal: req.signal, onLine: claudeLines(emit) });
      parsed = parseClaude(r.stdout, r.stderr);
    } else if (provider === "codex") {
      const r = await runProgram("codex", codexArgs({ model, effort, dir, bridge: !!run }), { cwd: dir, input: `${system}\n\n---\n\n${question}`, signal: req.signal, env: run ? { BT_BRIDGE_TOKEN: run.token } : {}, onLine: codexLines(emit) });
      parsed = parseCodex(r.stdout, r.stderr);
      if (parsed.ok && r.code !== 0) parsed = { ok: false, error: `Codex stopped before completing (exit ${r.code ?? "unknown"}). ${lastLines(r.stderr)}`.slice(0, 600) };
    } else if (provider === "hermes") {
      const r = await runProgram("hermes", hermesArgs({ model, effort, profile }), { cwd: dir, input: `${system}\n\n---\n\n${question}`, signal: req.signal, onLine: hermesLines(emit) });
      parsed = parseHermes(r.stdout, r.stderr);
    } else {
      const messageFile = path.join(dir, "message.md");
      fs.writeFileSync(messageFile, `<instructions>\n${system}\n</instructions>\n\n${question}`);
      const sessionKey = `biomarker-tracker-${crypto.randomBytes(6).toString("hex")}`;
      const once = async (local: boolean) => {
        const r = await runProgram("openclaw", openclawArgs({ model, effort, profile, messageFile, sessionKey, local }), { cwd: dir, signal: req.signal });
        return parseOpenClaw(r.stdout, r.stderr);
      };
      let p = await once(false);
      // Without OpenClaw's Gateway running, answer here instead.
      if (!req.claimReview && !p.ok && p.gatewayDown && !req.signal?.aborted) p = await once(true);
      parsed = p;
    }
    if (req.signal?.aborted) return { ok: false, error: "Stopped." };
    if (!parsed.ok) return parsed;
    const steps = run ? run.steps : (parsed.tools ?? []).map((t) => ({ tool: t, server: info.label, input: "" }));
    return { ok: true, text: parsed.text, steps, studyIds: run ? [...run.ids] : [], usedTools: bridged, ...(parsed.model ? { model: parsed.model } : {}), ...(parsed.truncated ? { truncated: true } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The agent could not answer." };
  } finally {
    if (run) closeRun(run);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The settings page's Test button: one short question, no tools. */
export async function testAgent(provider: AgentId, model: string, profile?: string, effort?: Effort): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const r = await runAgent({
    provider,
    model,
    ...(effort ? { effort } : {}),
    ...(profile ? { profile } : {}),
    system: "Reply with the single word OK.",
    messages: [{ role: "user", content: "Reply with the single word OK." }],
    tools: {},
    dataPack: () => "(none)",
    signal: AbortSignal.timeout(180_000),
  });
  return r.ok ? { ok: true, reply: r.text.slice(0, 100) } : { ok: false, error: r.error };
}

/** Hermes profiles with their model (`hermes profile list`), for the settings page. */
export async function hermesProfiles(): Promise<{ id: string; label: string }[]> {
  if (!agentInstalled("hermes")) return [];
  const r = await runProgram("hermes", ["profile", "list"], { cwd: os.homedir(), timeoutMs: 60_000 });
  const out: { id: string; label: string }[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s*([◆*])?\s*([A-Za-z0-9][\w.-]*)\s+(\S+)\s+(running|stopped|\S+)/.exec(line);
    if (m && m[2] !== "Profile") out.push({ id: m[2]!, label: `${m[2]} (${m[3]})${m[1] ? " · default" : ""}` });
  }
  return out;
}

/** OpenClaw agents (`openclaw agents list --json`), for the settings page. */
export async function openclawAgents(): Promise<{ id: string; label: string }[]> {
  if (!agentInstalled("openclaw")) return [];
  const r = await runProgram("openclaw", ["agents", "list", "--json"], { cwd: os.homedir(), timeoutMs: 60_000 });
  try {
    const rows = JSON.parse(r.stdout.slice(r.stdout.indexOf("["))) as { id?: unknown; model?: unknown; isDefault?: unknown }[];
    return rows.filter((x) => typeof x.id === "string").map((x) => ({ id: String(x.id), label: `${String(x.id)}${typeof x.model === "string" && x.model ? ` (${x.model})` : ""}${x.isDefault === true ? " · default" : ""}` }));
  } catch {
    return [];
  }
}
