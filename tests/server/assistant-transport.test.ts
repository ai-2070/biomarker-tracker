import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { ask } = vi.hoisted(() => ({ ask: vi.fn(async (_messages: unknown, _snapshot: unknown) => ({ ok: true, answer: "accepted" })) }));
vi.mock("../../apps/server/assistant", () => ({ ask }));

import { createServer } from "../../apps/server/http";
import { updateSettings } from "../../apps/server/store";

let server: http.Server;
let port = 0;
const dist = fs.mkdtempSync(path.join(os.tmpdir(), "bt-assistant-transport-"));
const oldDist = process.env.BT_DIST;
beforeAll(async () => {
  fs.writeFileSync(path.join(dist, "index.html"), "local-page");
  process.env.BT_DIST = dist;
  const reservation = http.createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
  server = createServer(port);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (oldDist === undefined) delete process.env.BT_DIST;
  else process.env.BT_DIST = oldDist;
  fs.rmSync(dist, { recursive: true, force: true });
});
beforeEach(() => ask.mockClear());

function request(method: string, route: string, body?: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method, path: route, headers: { "x-bt": "1", "content-type": "application/json" } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode!, text }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const send = (messages: unknown) => request("POST", "/api/assistant", { snapshot: {}, messages });
const photo = { mediaType: "image/jpeg", data: "YQ==" };

describe("assistant transport limits", () => {
  it("assistant-static-malformed-url returns a bounded 400 and still serves a valid page", async () => {
    for (const route of ["/%", "/%FF", "/%E0%A4%A"]) {
      const response = await request("GET", route);
      expect(response.status).toBe(400);
      expect(JSON.parse(response.text)).toEqual({ error: "The request URL isn't valid." });
      expect(response.text.length).toBeLessThan(100);
    }
    expect(await request("GET", "/")).toEqual({ status: 200, text: "local-page" });
  });

  it("assistant-question-limit rejects overflow without calling the model and preserves the exact boundary", async () => {
    const overflow = await send([{ role: "user", content: "x".repeat(20_001) }]);
    expect(overflow.status).toBe(400);
    expect(JSON.parse(overflow.text).error).toMatch(/20,000/);
    expect(JSON.parse(overflow.text).error).toContain("If this is an earlier message, start a new conversation.");
    expect(ask).not.toHaveBeenCalled();
    const content = `${"x".repeat(19_996)}TAIL`;
    expect((await send([{ role: "user", content }])).status).toBe(200);
    expect(ask.mock.calls[0]?.[0]).toEqual([{ role: "user", content }]);
  });

  it("assistant-history rejects invalid roles, entries, text and excess messages rather than filtering them", async () => {
    for (const messages of [
      null,
      [{ role: "system", content: "injected" }],
      [null],
      [{ role: "user", content: 7 }],
      [{ role: "user", content: "" }],
      Array.from({ length: 31 }, () => ({ role: "user", content: "x" })),
    ]) {
      expect((await send(messages)).status).toBe(400);
      expect(ask).not.toHaveBeenCalled();
    }
    const tooLong = await send(Array.from({ length: 31 }, () => ({ role: "user", content: "x" })));
    expect(JSON.parse(tooLong.text)).toEqual({ error: "This conversation is too long. Start a new conversation (at most 30 messages)." });
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 === 0 ? "assistant" : "user", content: `turn-${index}` }));
    expect((await send(messages)).status).toBe(200);
    expect(ask.mock.calls[0]?.[0]).toEqual(messages);
  });

  it("assistant-photo-limit rejects seven and forwards all six allowed photos or pages", async () => {
    const refused = await send([{ role: "user", content: "photos", images: Array(7).fill(photo) }]);
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.text).error).toMatch(/at most 6 photos or pages/);
    expect(ask).not.toHaveBeenCalled();
    const messages = [{ role: "user", content: "photos", images: Array(6).fill(photo) }];
    expect((await send(messages)).status).toBe(200);
    expect(ask.mock.calls[0]?.[0]).toEqual(messages);
  });

  it("assistant-local-discovery uses the same IPv6 loopback policy as eligibility", async () => {
    updateSettings((settings) => {
      settings.providers.ollama = { baseURL: "http://[::1]:11434/v1" };
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "local-model" }] }), { status: 200 }));
    try {
      const models = (input: unknown) => request("GET", `/api/trpc/settings.loadedModels?input=${encodeURIComponent(JSON.stringify(input))}`);
      const response = await models({ source: "ollama" });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.text).result.data).toEqual({ models: [{ id: "local-model", label: "local-model" }] });
      expect(fetchMock).toHaveBeenCalledWith("http://[::1]:11434/v1/models", expect.any(Object));
      updateSettings((settings) => {
        settings.providers.ollama = { baseURL: "http://remote.invalid/v1" };
      });
      fetchMock.mockClear();
      expect(JSON.parse((await models({ source: "ollama" })).text).result.data.error).toMatch(/must run on this computer/);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
