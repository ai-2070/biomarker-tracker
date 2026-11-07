import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allowedHost, allowedWrite, createServer } from "../../apps/server/http";
import { getSecrets, getSettings } from "../../apps/server/store";
import { rawCall, statusOf, trpcClient } from "./trpc";

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
  api = trpcClient(port);
});
let api: ReturnType<typeof trpcClient>;
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
    expect((await rawCall(port, "settings.setAssistant", { mutation: true, input: { provider: "ollama", model: "x" }, headers: {} })).status).toBe(403);
    expect(
      (
        await rawCall(port, "settings.setAssistant", {
          mutation: true,
          input: { provider: "ollama", model: "x" },
          headers: { "x-bt": "1", "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(403);
  });

  it("never runs a change as a GET request", async () => {
    expect((await rawCall(port, "settings.setEve", { input: { on: false } })).status).toBe(405);
  });

  it("explains invalid input in plain words and sends no stack traces", async () => {
    const r = await rawCall(port, "skills.get", { input: { id: 5 } });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { message: string; data: Record<string, unknown> } };
    expect(body.error.message).toMatch(/aren't valid/);
    expect(body.error.data.stack).toBeUndefined();
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
    const s = await api.settings.get.query();
    expect(s.assistant).toEqual({ provider: "claude-code", model: "opus" });
    expect(s.chosen).toBe(false);
  });

  it("saves settings for every provider, including names with a dash", async () => {
    for (const p of ["claude-code", "codex", "hermes", "openclaw", "anthropic", "openrouter", "lmstudio"]) {
      expect(await statusOf(api.settings.setProvider.mutate({ id: p })), p).toBe(200);
    }
    expect(await statusOf(api.settings.setProvider.mutate({ id: "hermes", profile: "research" }))).toBe(200);
    expect(getSettings().providers.hermes?.profile).toBe("research");
  });

  it("saves an effort level only if the provider has it", async () => {
    await api.settings.setAssistant.mutate({ provider: "claude-code", model: "sonnet", effort: "xhigh" });
    expect(getSettings().assistant).toEqual({ provider: "claude-code", model: "sonnet", effort: "xhigh" });
    expect(await statusOf(api.settings.setAssistant.mutate({ provider: "codex", model: "", effort: "max" }))).toBe(400);
    expect(getSettings().assistant).toEqual({ provider: "claude-code", model: "sonnet", effort: "xhigh" });
  });

  it("opens install and sign-in only for known programs", async () => {
    expect((await rawCall(port, "agents.openTerminal", { mutation: true, input: { id: "rm-rf", action: "install" } })).status).toBe(400);
    expect((await rawCall(port, "agents.openTerminal", { mutation: true, input: { id: "claude-code", action: "uninstall" } })).status).toBe(400);
  });

  it("stores the key server-side and only ever reports whether it is set", async () => {
    expect(await statusOf(api.settings.setProvider.mutate({ id: "anthropic", key: "sk-ant-secret-123", zdrConfirmed: true }))).toBe(200);
    const s = await api.settings.get.query();
    expect(s.hasKey.anthropic).toBe(true);
    expect(JSON.stringify(s)).not.toContain("sk-ant-secret-123");
    expect(getSecrets().keys.anthropic).toBe("sk-ant-secret-123");
    expect(JSON.stringify(getSettings())).not.toContain("sk-ant-secret-123");
  });

  it("reports why the assistant can't be used until zero data retention is confirmed", async () => {
    await api.settings.setAssistant.mutate({ provider: "openai", model: "gpt-5" });
    await api.settings.setProvider.mutate({ id: "openai", key: "sk-test" });
    const st = await api.status.query();
    expect(st.ready).toEqual({ ok: false, reason: expect.stringMatching(/zero data retention/) });
    // The assistant refuses too, without calling anything.
    const a = (await (await call("POST", "/api/assistant", { messages: [{ role: "user", content: "hi" }], snapshot: {} })).json()) as {
      ok: boolean;
      error: string;
    };
    expect(a).toEqual({ ok: false, error: expect.stringMatching(/zero data retention/) });
  });

  it("removes a key when asked", async () => {
    await api.settings.setProvider.mutate({ id: "openai", key: null });
    expect(getSecrets().keys.openai).toBeUndefined();
  });

  it("rejects unknown providers and empty models", async () => {
    expect(await statusOf(api.settings.setProvider.mutate({ id: "nope" }))).toBe(404);
    expect(await statusOf(api.settings.setAssistant.mutate({ provider: "anthropic", model: " " }))).toBe(400);
  });
});

describe("assistant input", () => {
  it("validates the health data the page sends", async () => {
    await api.settings.setAssistant.mutate({ provider: "ollama", model: "llama3.1" });
    const r = await call("POST", "/api/assistant", { messages: [{ role: "user", content: "hi" }], snapshot: { measurements: [{ id: "x" }] } });
    expect(r.status).toBe(400);
    const r2 = await call("POST", "/api/assistant", { messages: [], snapshot: {} });
    expect(r2.status).toBe(400);
  });
});

describe("partial profile saves over HTTP", () => {
  it("saves the changed parts, and needs the page's header like every change", async () => {
    const created = await api.profiles.create.mutate({ person: { name: "Patch" } });
    const id = created.profile.id;
    const row = { id: "m1", biomarkerId: "ferritin", date: "2026-01-01", value: 40, originalValue: 40, originalUnit: "µg/L", source: "manual" };
    expect(await api.profiles.saveParts.mutate({ id, parts: { measurements: [row] } })).toEqual({ ok: true, written: ["measurements"] });
    expect((await api.profiles.data.query({ id })).measurements).toHaveLength(1);
    expect((await rawCall(port, "profiles.saveParts", { mutation: true, input: { id, parts: { measurements: [] } }, headers: { "x-bt": "" } })).status).toBe(
      403,
    );
    expect((await rawCall(port, "profiles.saveParts", { mutation: true, input: { id, parts: [] } })).status).toBe(400);
    expect(await statusOf(api.profiles.saveParts.mutate({ id, parts: { secrets: [] } }))).toBe(400);
  });
});
