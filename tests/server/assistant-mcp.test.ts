import type { ToolSet } from "ai";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { z } from "zod";
import type { McpServerConfig } from "../../apps/server/store";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  transports: [] as { close: Mock }[],
  settings: { mcp: [] as McpServerConfig[] },
  secrets: { mcpEnv: {} as Record<string, Record<string, string>> },
}));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: mocks.create }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  getDefaultEnvironment: () => ({}),
  StdioClientTransport: class {
    close = vi.fn(async () => undefined);
    constructor() {
      mocks.transports.push(this);
    }
  },
}));
vi.mock("../../apps/server/store", () => ({
  getSettings: () => mocks.settings,
  getSecrets: () => mocks.secrets,
  updateSettings: (fn: (settings: typeof mocks.settings) => void) => fn(mocks.settings),
  updateSecrets: (fn: (secrets: typeof mocks.secrets) => void) => fn(mocks.secrets),
}));

import { assistantTools, removeServer, stopAll, testServer } from "../../apps/server/mcp";

// Deferred gates establish ordering; no sleeps, real packages, subprocesses or network calls.
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cfg = (id: string): McpServerConfig => ({ id, name: id, command: "mock-mcp", args: [], env: {}, enabled: true });
const tools: ToolSet = { sample: { description: "mock research", inputSchema: z.object({}) } };
beforeEach(() => {
  mocks.settings.mcp = [cfg("research")];
  mocks.secrets.mcpEnv = { research: { SENTINEL_SECRET: "private" } };
  mocks.create.mockReset();
  mocks.transports.length = 0;
});
afterEach(async () => {
  await stopAll();
});

describe("MCP process ownership", () => {
  it("assistant-mcp-discovery-failure closes the initialized client and transport before a clean retry", async () => {
    const failedClient = { tools: vi.fn().mockRejectedValue(new Error("tools/list failed")), close: vi.fn(async () => undefined) };
    const readyClient = { tools: vi.fn().mockResolvedValue(tools), close: vi.fn(async () => undefined) };
    mocks.create.mockResolvedValueOnce(failedClient).mockResolvedValueOnce(readyClient);
    const failed = await assistantTools();
    expect(failed.failed).toEqual([{ name: "research", error: "tools/list failed" }]);
    expect(failed.tools).toEqual({});
    expect(failedClient.tools).toHaveBeenCalledTimes(1);
    expect(failedClient.close).toHaveBeenCalledTimes(1);
    expect(mocks.transports[0]?.close).toHaveBeenCalledTimes(1);
    const recovered = await testServer("research");
    expect(recovered.tools).toEqual([{ name: "sample", description: "mock research" }]);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.transports[0]?.close).toHaveBeenCalledTimes(1);
    expect(mocks.transports[1]?.close).not.toHaveBeenCalled();
    await stopAll();
    expect(mocks.transports[1]?.close).toHaveBeenCalledTimes(1);
  });

  it("assistant-mcp-initialization-failure closes its spawned transport and can retry", async () => {
    mocks.create.mockRejectedValueOnce(new Error("initialize failed"));
    const failed = await assistantTools();
    expect(failed.failed).toEqual([{ name: "research", error: "initialize failed" }]);
    expect(mocks.transports[0]?.close).toHaveBeenCalledTimes(1);
    mocks.create.mockResolvedValueOnce({ tools: vi.fn().mockResolvedValue(tools), close: vi.fn(async () => undefined) });
    const ready = await assistantTools();
    expect(ready.failed).toEqual([]);
    expect(ready.servers).toEqual([{ id: "research", name: "research", about: "", tools: 1 }]);
    expect(Object.keys(ready.tools)).toEqual(["research_tools", "use_research_tool"]);
  });

  it("assistant-mcp-remove ends admission before delayed shutdown and fences an in-flight discovery", async () => {
    const discoveryStarted = deferred<void>();
    const discovered = deferred<ToolSet>();
    const closed = deferred<void>();
    const client = {
      tools: vi.fn(() => {
        discoveryStarted.resolve();
        return discovered.promise;
      }),
      close: vi.fn(async () => undefined),
    };
    mocks.create.mockResolvedValue(client);
    const question = assistantTools();
    await discoveryStarted.promise;
    mocks.transports[0]!.close.mockImplementation(() => closed.promise);
    const removal = removeServer("research");
    expect(mocks.settings.mcp).toEqual([]);
    expect(mocks.transports[0]!.close).toHaveBeenCalledTimes(1);
    expect(await assistantTools()).toEqual({ tools: {}, failed: [], servers: [] });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    discovered.resolve(tools);
    closed.resolve();
    await removal;
    expect(mocks.secrets.mcpEnv).toEqual({});
    const result = await question;
    expect(result.tools).toEqual({});
    expect(result.servers).toEqual([]);
    expect(result.failed).toEqual([{ name: "research", error: "The research server was stopped." }]);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    // The same path is live when a newly admitted server is added afterward.
    mocks.settings.mcp.push(cfg("replacement"));
    mocks.create.mockResolvedValueOnce({ tools: vi.fn().mockResolvedValue(tools), close: vi.fn(async () => undefined) });
    expect((await assistantTools()).servers).toEqual([{ id: "replacement", name: "replacement", about: "", tools: 1 }]);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
});
