import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allowedHost, allowedWrite, createServer } from "../../server/http";
import { getSecrets, getSettings } from "../../server/store";

let server: http.Server;
let port = 0;
const dist = fs.mkdtempSync(path.join(os.tmpdir(), "bt-dist-"));

beforeAll(async () => {
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Biomarker Tracker</title>");
  fs.mkdirSync(path.join(dist, "assets"));
  fs.writeFileSync(path.join(dist, "assets", "app.js"), "console.log(1)");
  process.env.BT_DIST = dist;
  server = createServer(0);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => {
  server.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(method === "GET" ? {} : { "x-bt": "1" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("security checks", () => {
  it("accepts only this computer's own address as Host", () => {
    expect(allowedHost("127.0.0.1:4820", 4820)).toBe(true);
    expect(allowedHost("localhost:4820", 4820)).toBe(true);
    expect(allowedHost("evil.example:4820", 4820)).toBe(false);
    expect(allowedHost("127.0.0.1:9999", 4820)).toBe(false);
    expect(allowedHost(undefined, 4820)).toBe(false);
  });

  it("needs the app's header for changes and refuses cross-site requests", () => {
    expect(allowedWrite("GET", {})).toBe(true);
    expect(allowedWrite("PUT", {})).toBe(false);
    expect(allowedWrite("PUT", { "x-bt": "1" })).toBe(true);
    expect(allowedWrite("PUT", { "x-bt": "1", "sec-fetch-site": "cross-site" })).toBe(false);
    expect(allowedWrite("POST", { "x-bt": "1", "sec-fetch-site": "same-origin" })).toBe(true);
  });

  it("refuses a change without the header over HTTP", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/settings/assistant`, { method: "PUT", body: "{}" });
    expect(r.status).toBe(403);
  });

  it("serves the page and blocks paths outside it", async () => {
    expect((await call("GET", "/")).status).toBe(200);
    expect(await (await call("GET", "/assets/app.js")).text()).toBe("console.log(1)");
    expect((await call("GET", "/../package.json")).status).toBe(404);
    expect((await call("GET", "/%2e%2e/%2e%2e/package.json")).status).toBe(404);
  });
});

describe("AI model settings", () => {
  it("uses Claude Code with Opus until something else is saved", async () => {
    const s = (await (await call("GET", "/api/settings")).json()) as { assistant: unknown; chosen: boolean };
    expect(s.assistant).toEqual({ provider: "claude-code", model: "opus" });
    expect(s.chosen).toBe(false);
  });

  it("saves settings for every provider, including names with a dash", async () => {
    for (const p of ["claude-code", "codex", "hermes", "openclaw", "anthropic", "openrouter", "lmstudio"]) {
      expect((await call("PUT", `/api/settings/provider/${p}`, {})).status, p).toBe(200);
    }
    expect((await call("PUT", "/api/settings/provider/hermes", { profile: "research" })).status).toBe(200);
    expect(getSettings().providers.hermes?.profile).toBe("research");
  });

  it("saves an effort level only if the provider has it", async () => {
    await call("PUT", "/api/settings/assistant", { provider: "claude-code", model: "sonnet", effort: "xhigh" });
    expect(getSettings().assistant).toEqual({ provider: "claude-code", model: "sonnet", effort: "xhigh" });
    expect((await call("PUT", "/api/settings/assistant", { provider: "codex", model: "", effort: "max" })).status).toBe(400);
    expect(getSettings().assistant).toEqual({ provider: "claude-code", model: "sonnet", effort: "xhigh" });
  });

  it("opens install and sign-in only for known programs", async () => {
    expect((await call("POST", "/api/agents/rm-rf/install")).status).toBe(404);
    expect((await call("POST", "/api/agents/claude-code/uninstall")).status).toBe(404);
  });

  it("stores the key server-side and only ever reports whether it is set", async () => {
    const r = await call("PUT", "/api/settings/provider/anthropic", { key: "sk-ant-secret-123", zdrConfirmed: true });
    expect(r.status).toBe(200);
    const s = (await (await call("GET", "/api/settings")).json()) as { hasKey: Record<string, boolean> };
    expect(s.hasKey.anthropic).toBe(true);
    expect(JSON.stringify(s)).not.toContain("sk-ant-secret-123");
    expect(getSecrets().keys.anthropic).toBe("sk-ant-secret-123");
    expect(JSON.stringify(getSettings())).not.toContain("sk-ant-secret-123");
  });

  it("reports why the assistant can't be used until zero data retention is confirmed", async () => {
    await call("PUT", "/api/settings/assistant", { provider: "openai", model: "gpt-5" });
    await call("PUT", "/api/settings/provider/openai", { key: "sk-test" });
    const st = (await (await call("GET", "/api/status")).json()) as { ready: { ok: boolean; reason?: string } };
    expect(st.ready).toEqual({ ok: false, reason: expect.stringMatching(/zero data retention/) });
    // The assistant refuses too, without calling anything.
    const a = (await (await call("POST", "/api/assistant", { messages: [{ role: "user", content: "hi" }], snapshot: {} })).json()) as { ok: boolean; error: string };
    expect(a).toEqual({ ok: false, error: expect.stringMatching(/zero data retention/) });
  });

  it("removes a key when asked", async () => {
    await call("PUT", "/api/settings/provider/openai", { key: null });
    expect(getSecrets().keys.openai).toBeUndefined();
  });

  it("rejects unknown providers and empty models", async () => {
    expect((await call("PUT", "/api/settings/provider/nope", {})).status).toBe(404);
    expect((await call("PUT", "/api/settings/assistant", { provider: "anthropic", model: " " })).status).toBe(400);
  });
});

describe("assistant input", () => {
  it("validates the health data the page sends", async () => {
    await call("PUT", "/api/settings/assistant", { provider: "ollama", model: "llama3.1" });
    const r = await call("POST", "/api/assistant", { messages: [{ role: "user", content: "hi" }], snapshot: { measurements: [{ id: "x" }] } });
    expect(r.status).toBe(400);
    const r2 = await call("POST", "/api/assistant", { messages: [], snapshot: {} });
    expect(r2.status).toBe(400);
  });
});
