// HTTP: the page (dist/) and the API. Security checks follow Blacksite's:
// 127.0.0.1 only, Host header checked, cross-site requests refused, and every
// change needs the x-bt header that only this app's page sends.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { PROVIDERS, providerInfo, type Effort, type ProviderId, type Region } from "../src/core/aiProviders";
import { MCP_PRESETS } from "../src/core/mcpPresets";
import { agentInstalled, hermesConnected, hermesProfiles, isAgent, openclawAgents, setHermesConnection, testAgent } from "./agents";
import { openTerminal } from "./terminal";
import { ask, type ChatMessage } from "./assistant";
import { handleMcp, setBridgePort } from "./bridge";
import { openRouterModels } from "./openrouter";
import * as profiles from "./profiles";
import { parseSnapshot } from "./healthTools";
import * as mcp from "./mcp";
import { assistantCheck, currentChoice, describeModelError, readyModel } from "./models";
import { addSkill, deleteSkill, getSkill, listSkills, setSkillEnabled } from "./skills";
import { ROOT, getSecrets, getSettings, updateSecrets, updateSettings } from "./store";
import { generateText } from "ai";

export const MAX_BODY = 20 * 1024 * 1024;
/** Uploads (scanned files, backup zips). */
const MAX_UPLOAD = 200 * 1024 * 1024;
const DIST = () => process.env.BT_DIST ?? path.join(ROOT, "dist");

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Json = Record<string, unknown>;
type Handler = (params: string[], body: Json) => Promise<unknown> | unknown;
const routes: { method: string; re: RegExp; fn: Handler }[] = [];
const route = (method: string, pattern: string, fn: Handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

const str = (v: unknown, max = 500): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
const providerOf = (id: string): ProviderId => {
  if (!providerInfo(id)) throw new HttpError(404, "Unknown provider.");
  return id as ProviderId;
};

// Status and settings

route("GET", "/api/status", () => {
  const s = getSettings();
  return { app: "biomarker-tracker", assistant: currentChoice(), chosen: !!s.assistant, ready: assistantCheck() };
});

route("GET", "/api/settings", async () => {
  const s = getSettings();
  const keys = getSecrets().keys;
  return {
    providers: PROVIDERS,
    configs: s.providers,
    hasKey: Object.fromEntries(PROVIDERS.map((p) => [p.id, !!keys[p.id]])),
    installed: Object.fromEntries(PROVIDERS.filter((p) => p.kind === "agent").map((p) => [p.id, agentInstalled(p.id)])),
    hermesConnected: await hermesConnected(),
    assistant: currentChoice(),
    /** False while the default (Claude Code, Opus) is in use because nothing was saved yet. */
    chosen: !!s.assistant,
    ready: assistantCheck(),
  };
});

/** Models (or profiles) that are loaded rather than listed in the app: local servers, Hermes, OpenClaw. */
route("GET", "/api/settings/models/(ollama|lmstudio|hermes|openclaw)", async ([id]) => {
  if (id === "hermes") return { models: [], profiles: await hermesProfiles() };
  if (id === "openclaw") return { models: [], profiles: await openclawAgents() };
  const info = providerInfo(id!)!;
  const base = (getSettings().providers[info.id]?.baseURL?.trim() || info.defaultBaseURL || "").replace(/\/+$/, "");
  try {
    if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${base}/`)) return { models: [], error: `${info.label} must run on this computer.` };
    const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as { data?: { id?: unknown }[] };
    return { models: (j.data ?? []).filter((m) => typeof m.id === "string").map((m) => ({ id: String(m.id), label: String(m.id) })) };
  } catch {
    return { models: [], error: `${info.label} isn't running, or isn't at ${base}. Start it, then reload this page.` };
  }
});

/** Opens a terminal with the program maker's official install (or sign-in) command. Fixed commands only. */
route("POST", "/api/agents/(claude-code|codex|hermes|openclaw)/(install|signin)", ([id, action]) => {
  const info = providerInfo(id!)!;
  const cmd = action === "install" ? (process.platform === "win32" ? info.install!.windows : info.install!.unix) : info.install!.signIn;
  return openTerminal(`${action === "install" ? "Install" : "Sign in to"} ${info.label}`, cmd);
});

route("GET", "/api/settings/models/openrouter", async () => {
  try {
    return { models: await openRouterModels() };
  } catch (e) {
    return { models: [], error: `Couldn't load OpenRouter's model list: ${e instanceof Error ? e.message : String(e)}` };
  }
});

// Adds or removes the app's tools in Hermes' own MCP settings (only when the user presses the button).
route("POST", "/api/settings/hermes", async (_p, body) => {
  if (typeof body.connect !== "boolean") throw new HttpError(400, "Say whether to connect or disconnect.");
  return setHermesConnection(body.connect);
});

route("PUT", "/api/settings/provider/([a-z]+)", ([id], body) => {
  const p = providerOf(id!);
  updateSettings((s) => {
    const c = { ...(s.providers[p] ?? {}) };
    if (typeof body.zdrConfirmed === "boolean") c.zdrConfirmed = body.zdrConfirmed;
    if (body.region === "EU" || body.region === "US") c.region = body.region as Region;
    if (typeof body.baseURL === "string") c.baseURL = body.baseURL.trim().slice(0, 300);
    if (typeof body.profile === "string") c.profile = body.profile.trim().slice(0, 80);
    s.providers[p] = c;
  });
  if (body.key === null || typeof body.key === "string") {
    const key = typeof body.key === "string" ? body.key.trim() : "";
    updateSecrets((s) => {
      if (key) s.keys[p] = key;
      else delete s.keys[p];
    });
  }
  return { ok: true, ready: assistantCheck() };
});

route("PUT", "/api/settings/assistant", (_p, body) => {
  const provider = providerOf(str(body.provider, 20) ?? "");
  const model = (str(body.model, 120) ?? "").trim();
  if (!model && !providerInfo(provider)?.modelOptional) throw new HttpError(400, "Choose a model.");
  const effort = typeof body.effort === "string" && providerInfo(provider)!.efforts.includes(body.effort as Effort) ? (body.effort as Effort) : undefined;
  updateSettings((s) => (s.assistant = { provider, model, ...(effort ? { effort } : {}) }));
  return { ok: true, ready: assistantCheck() };
});

route("POST", "/api/settings/test", async () => {
  const s = getSettings();
  const choice = currentChoice();
  if (isAgent(choice.provider)) {
    const check = assistantCheck();
    if (!check.ok) return { ok: false, error: check.reason };
    return testAgent(choice.provider, choice.model, s.providers[choice.provider]?.profile, choice.effort);
  }
  const r = readyModel();
  if (!r.ok) return { ok: false, error: r.reason };
  try {
    const res = await generateText({ model: r.ready.model, prompt: "Reply with the single word OK.", maxOutputTokens: 200, providerOptions: r.ready.providerOptions, abortSignal: AbortSignal.timeout(60_000) });
    return { ok: true, reply: res.text.slice(0, 100) };
  } catch (e) {
    return { ok: false, error: describeModelError(e) };
  }
});

// Skills

route("GET", "/api/skills", () => ({ skills: listSkills() }));
route("GET", "/api/skills/([a-z0-9-]+)", ([id]) => {
  const s = getSkill(id!);
  if (!s) throw new HttpError(404, "No skill with that name.");
  return s;
});
route("PUT", "/api/skills/([a-z0-9-]+)", ([id], body) => {
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "Say whether the skill is on or off.");
  setSkillEnabled(id!, body.enabled);
  return { ok: true };
});
route("POST", "/api/skills", (_p, body) => ({ skill: addSkill(str(body.markdown, 60_000) ?? "") }));
route("DELETE", "/api/skills/([a-z0-9-]+)", ([id]) => {
  deleteSkill(id!);
  return { ok: true };
});

// MCP servers

route("GET", "/api/mcp", () => ({ presets: MCP_PRESETS, servers: mcp.listServers(), npx: mcp.hasNpx() }));
route("POST", "/api/mcp", (_p, body) => {
  if (typeof body.presetId === "string") return { server: mcp.addPreset(body.presetId) };
  const args = Array.isArray(body.args) ? body.args.filter((a): a is string => typeof a === "string").slice(0, 30) : [];
  return { server: mcp.addCustom({ name: str(body.name, 60) ?? "", command: str(body.command, 300) ?? "", args }) };
});
route("PUT", "/api/mcp/([a-z0-9-]+)", async ([id], body) => {
  const env = typeof body.env === "object" && body.env !== null ? (body.env as Record<string, string | null>) : undefined;
  await mcp.updateServer(id!, { ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}), ...(env ? { env } : {}) });
  return { ok: true };
});
route("POST", "/api/mcp/([a-z0-9-]+)/test", async ([id]) => {
  try {
    return { ok: true, ...(await mcp.testServer(id!)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
route("DELETE", "/api/mcp/([a-z0-9-]+)", async ([id]) => {
  await mcp.removeServer(id!);
  return { ok: true };
});

// Profiles: one folder per person (profiles.ts)

const ID = "([a-z0-9][a-z0-9-]{0,59})";
route("GET", "/api/profiles", () => ({ profiles: profiles.listProfiles(), active: profiles.activeProfile(), root: profiles.PROFILES() }));
route("POST", "/api/profiles", (_p, body) => {
  const created = profiles.createProfile(body);
  profiles.setActiveProfile(created.id);
  return { profile: created };
});
route("PUT", "/api/profiles/active", (_p, body) => {
  profiles.setActiveProfile(str(body.id, 60) ?? "");
  return { ok: true };
});
route("GET", `/api/profiles/${ID}/data`, ([id]) => profiles.getProfileData(id!));
route("PUT", `/api/profiles/${ID}/data`, ([id], body) => {
  profiles.saveProfileData(id!, body);
  return { ok: true };
});
route("DELETE", `/api/profiles/${ID}`, ([id]) => {
  profiles.deleteProfile(id!);
  return { ok: true, active: profiles.activeProfile() };
});
route("POST", `/api/profiles/${ID}/reveal`, ([id]) => {
  profiles.revealFolder(id!);
  return { ok: true };
});
route("GET", `/api/profiles/${ID}/files`, ([id]) => ({ files: profiles.listFiles(id!) }));
route("DELETE", `/api/profiles/${ID}/files/([^/]+)`, ([id, name]) => {
  profiles.deleteFile(id!, decodeURIComponent(name!));
  return { ok: true };
});

/** Routes that send or receive files instead of JSON. */
type RawHandler = (params: string[], req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<void> | void;
const rawRoutes: { method: string; re: RegExp; fn: RawHandler }[] = [];
const rawRoute = (method: string, pattern: string, fn: RawHandler) => rawRoutes.push({ method, re: new RegExp(`^${pattern}$`), fn });

const sendFile = (res: http.ServerResponse, data: Buffer, type: string, fileName: string, download: boolean) =>
  res
    .writeHead(200, {
      "content-type": type,
      "content-length": data.length,
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "no-store",
    })
    .end(data);

rawRoute("GET", `/api/profiles/${ID}/backup`, ([id], _req, res) => {
  const b = profiles.backupZip(id!);
  sendFile(res, b.data, "application/zip", b.fileName, true);
});
rawRoute("GET", `/api/profiles/${ID}/files/([^/]+)`, ([id, name], _req, res, url) => {
  const f = profiles.readFile(id!, decodeURIComponent(name!));
  sendFile(res, f.data, f.entry.type, f.entry.originalName, url.searchParams.has("download"));
});
rawRoute("POST", `/api/profiles/${ID}/files`, async ([id], req, res, url) => {
  const data = await readRaw(req, profiles.MAX_FILE);
  const file = profiles.addFile(id!, url.searchParams.get("name") ?? "file", data, url.searchParams.get("note") ?? undefined);
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ file }));
});
rawRoute("POST", "/api/profiles/restore", async (_p, req, res) => {
  const created = profiles.restoreZip(await readRaw(req, MAX_UPLOAD));
  profiles.setActiveProfile(created.id);
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ profile: created }));
});

function readRaw(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new HttpError(413, "The file is too large."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Assistant

route("POST", "/api/assistant", async (_p, body) => {
  const snap = parseSnapshot(body.snapshot);
  if (!snap.ok) throw new HttpError(400, snap.error);
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMessage[] = raw
    .filter((m): m is Json => typeof m === "object" && m !== null)
    .map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: str(m.content, 20_000) ?? "" }))
    .filter((m) => m.content.trim())
    .slice(-30);
  if (messages.length === 0 || messages[messages.length - 1]!.role !== "user") throw new HttpError(400, "Ask a question.");
  return ask(messages, snap.snapshot);
});

// Security and serving

export function allowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** Changes need the app's header and must not come from another site. */
export function allowedWrite(method: string, headers: http.IncomingHttpHeaders): boolean {
  if (method === "GET" || method === "HEAD") return true;
  if (headers["x-bt"] !== "1") return false;
  const site = headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function serveStatic(urlPath: string, res: http.ServerResponse): void {
  const dist = path.resolve(DIST());
  const rel = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const file = path.resolve(dist, `.${rel}`);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
  fs.createReadStream(file).pipe(res);
}

function readBody(req: http.IncomingMessage): Promise<Json>;
function readBody(req: http.IncomingMessage, raw: true): Promise<unknown>;
function readBody(req: http.IncomingMessage, raw = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "Too much data in one request."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        resolve(raw ? v : typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : {});
      } catch {
        reject(new HttpError(400, "The request isn't valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(port: number): http.Server {
  setBridgePort(port);
  return http.createServer(async (req, res) => {
    const send = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(value));
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    if (!allowedHost(req.headers.host, port)) return send(403, { error: "Wrong host." });
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const method = req.method ?? "GET";
    // Agent programs reach the app's tools here, with a token that only works while they answer (bridge.ts).
    if (url.pathname === "/mcp") {
      try {
        const body = method === "POST" ? await readBody(req, true) : undefined;
        return await handleMcp(req, res, url, body);
      } catch (e) {
        if (!res.headersSent) send(e instanceof HttpError ? e.status : 400, { error: e instanceof Error ? e.message : "Bad request." });
        return;
      }
    }
    if (!url.pathname.startsWith("/api/")) return method === "GET" ? serveStatic(url.pathname, res) : send(405, { error: "Not allowed." });
    if (!allowedWrite(method, req.headers)) return send(403, { error: "This request isn't allowed." });
    const raw = rawRoutes.find((x) => x.method === method && x.re.test(url.pathname));
    if (raw) {
      try {
        await raw.fn(raw.re.exec(url.pathname)!.slice(1), req, res, url);
      } catch (e) {
        if (res.headersSent) return;
        const status = e instanceof HttpError || e instanceof profiles.ProfileError ? e.status : 400;
        send(status, { error: e instanceof Error ? e.message : "Something went wrong." });
      }
      return;
    }
    const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
    if (!r) return send(404, { error: "Not found." });
    try {
      const body = method === "GET" ? {} : await readBody(req);
      send(200, await r.fn(r.re.exec(url.pathname)!.slice(1), body));
    } catch (e) {
      if (e instanceof HttpError || e instanceof profiles.ProfileError) return send(e.status, { error: e.message });
      send(400, { error: e instanceof Error ? e.message : "Something went wrong." });
    }
  });
}
