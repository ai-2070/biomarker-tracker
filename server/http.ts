// HTTP: the page (dist/) and the API. Security checks follow Blacksite's:
// 127.0.0.1 only, Host header checked, cross-site requests refused, and every
// change needs the x-bt header that only this app's page sends.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { PROVIDERS, providerInfo, type ProviderId, type Region } from "../src/core/aiProviders";
import { MCP_PRESETS } from "../src/core/mcpPresets";
import { ask, type ChatMessage } from "./assistant";
import { parseSnapshot } from "./healthTools";
import * as mcp from "./mcp";
import { assistantCheck, describeModelError, readyModel } from "./models";
import { addSkill, deleteSkill, getSkill, listSkills, setSkillEnabled } from "./skills";
import { ROOT, getSecrets, getSettings, updateSecrets, updateSettings } from "./store";
import { generateText } from "ai";

export const MAX_BODY = 5 * 1024 * 1024;
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
  return { app: "biomarker-tracker", assistant: s.assistant ?? null, ready: assistantCheck() };
});

route("GET", "/api/settings", () => {
  const s = getSettings();
  const keys = getSecrets().keys;
  return {
    providers: PROVIDERS,
    configs: s.providers,
    hasKey: Object.fromEntries(PROVIDERS.map((p) => [p.id, !!keys[p.id]])),
    assistant: s.assistant ?? null,
    ready: assistantCheck(),
  };
});

route("PUT", "/api/settings/provider/([a-z]+)", ([id], body) => {
  const p = providerOf(id!);
  updateSettings((s) => {
    const c = { ...(s.providers[p] ?? {}) };
    if (typeof body.zdrConfirmed === "boolean") c.zdrConfirmed = body.zdrConfirmed;
    if (body.region === "EU" || body.region === "US") c.region = body.region as Region;
    if (typeof body.baseURL === "string") c.baseURL = body.baseURL.trim().slice(0, 300);
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
  if (!model) throw new HttpError(400, "Choose a model.");
  updateSettings((s) => (s.assistant = { provider, model }));
  return { ok: true, ready: assistantCheck() };
});

route("POST", "/api/settings/test", async () => {
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

route("GET", "/api/mcp", () => ({ presets: MCP_PRESETS, servers: mcp.listServers() }));
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

function readBody(req: http.IncomingMessage): Promise<Json> {
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
        resolve(typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : {});
      } catch {
        reject(new HttpError(400, "The request isn't valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(port: number): http.Server {
  return http.createServer(async (req, res) => {
    const send = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(value));
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    if (!allowedHost(req.headers.host, port)) return send(403, { error: "Wrong host." });
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const method = req.method ?? "GET";
    if (!url.pathname.startsWith("/api/")) return method === "GET" ? serveStatic(url.pathname, res) : send(405, { error: "Not allowed." });
    if (!allowedWrite(method, req.headers)) return send(403, { error: "This request isn't allowed." });
    const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
    if (!r) return send(404, { error: "Not found." });
    try {
      const body = method === "GET" ? {} : await readBody(req);
      send(200, await r.fn(r.re.exec(url.pathname)!.slice(1), body));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      send(400, { error: e instanceof Error ? e.message : "Something went wrong." });
    }
  });
}
