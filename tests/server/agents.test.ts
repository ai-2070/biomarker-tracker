import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tool } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  claudeArgs,
  codexArgs,
  conversationText,
  hermesArgs,
  openclawArgs,
  parseClaude,
  parseCodex,
  parseHermes,
  parseOpenClaw,
  which,
} from "../../server/agents";
import { closeRun, openRun, runFor, stableToken } from "../../server/bridge";
import { createServer } from "../../server/http";
import { openRouterModels, zdrFetch } from "../../server/openrouter";

describe("agent programs: arguments", () => {
  it("runs Claude Code without its own tools, with only the app's tools allowed", () => {
    const a = claudeArgs({ model: "haiku", systemFile: "/t/system.md", mcpFile: "/t/mcp.json" });
    expect(a).toEqual(expect.arrayContaining(["-p", "--strict-mcp-config", "--no-session-persistence"]));
    expect(a[a.indexOf("--allowedTools") + 1]).toBe("mcp__bt");
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    expect(a[a.indexOf("--model") + 1]).toBe("haiku");
    expect(claudeArgs({ systemFile: "/t/s.md" })).not.toContain("--mcp-config");
  });

  it("runs Codex read-only, with the bridge token in the environment, not on the command line", () => {
    const a = codexArgs({ dir: "/t", bridge: true });
    expect(a).toEqual(expect.arrayContaining(["exec", "--json", "--sandbox", "read-only"]));
    expect(a.join(" ")).toContain("mcp_servers.bt.bearer_token_env_var=BT_BRIDGE_TOKEN");
    expect(a.join(" ")).not.toMatch(/[a-f0-9]{64}/);
    expect(a.at(-1)).toBe("-");
  });

  it("passes Hermes profiles and OpenClaw agents as separate arguments", () => {
    expect(hermesArgs({ profile: "research", model: "x/y" })).toEqual(["-p", "research", "chat", "--query-file", "-", "--format", "stream-json", "-m", "x/y"]);
    expect(openclawArgs({ profile: "main", messageFile: "/t/m.md", sessionKey: "k1", local: true })).toEqual(
      expect.arrayContaining(["agent", "--agent", "main", "--message-file", "/t/m.md", "--json", "--local"]),
    );
  });

  it("passes effort the way each program expects it", () => {
    const at = (a: string[], flag: string) => a[a.indexOf(flag) + 1];
    expect(at(claudeArgs({ systemFile: "/s", effort: "max" }), "--effort")).toBe("max");
    expect(codexArgs({ dir: "/t", effort: "high" })).toContain("model_reasoning_effort=high");
    expect(at(hermesArgs({ effort: "xhigh" }), "--reasoning")).toBe("xhigh");
    expect(at(openclawArgs({ messageFile: "/m", sessionKey: "k", effort: "low" }), "--thinking")).toBe("low");
    expect(claudeArgs({ systemFile: "/s" })).not.toContain("--effort");
  });

  it("puts earlier turns before the new question", () => {
    expect(conversationText([{ role: "user", content: "Hi" }])).toBe("Hi");
    const t = conversationText([
      { role: "user", content: "Is my ferritin ok?" },
      { role: "assistant", content: "It's in range." },
      { role: "user", content: "And iron?" },
    ]);
    expect(t.indexOf("Is my ferritin ok?")).toBeLessThan(t.indexOf("And iron?"));
    expect(t).toMatch(/new question:\nAnd iron\?$/);
  });

  it("finds commands on PATH", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-which-"));
    const name = process.platform === "win32" ? "fakeagent.exe" : "fakeagent";
    fs.writeFileSync(path.join(dir, name), "");
    expect(which("fakeagent", { PATH: dir, PATHEXT: ".EXE;.CMD" })).toBe(path.join(dir, name));
    expect(which("nothere", { PATH: dir })).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("agent programs: reading their answers", () => {
  it("Claude Code: the result line, or its error", () => {
    const ok = ['{"type":"system"}', '{"type":"assistant","message":{}}', '{"type":"result","subtype":"success","is_error":false,"result":"Ferritin is fine."}'].join("\n");
    expect(parseClaude(ok, "")).toEqual({ ok: true, text: "Ferritin is fine." });
    const bad = '{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login"}';
    expect(parseClaude(bad, "")).toEqual({ ok: false, error: expect.stringMatching(/run \/login/) });
    expect(parseClaude("", "boom").ok).toBe(false);
  });

  it("Codex: the last agent message", () => {
    const out = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"item.completed","item":{"type":"mcp_tool_call","server":"bt","tool":"get_results"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Here is what I found."}}',
      '{"type":"turn.completed"}',
    ].join("\n");
    expect(parseCodex(out, "")).toEqual({ ok: true, text: "Here is what I found." });
    expect(parseCodex('{"type":"turn.failed","error":{"message":"Not logged in"}}', "")).toEqual({ ok: false, error: "Codex: Not logged in" });
  });

  it("Hermes: the result line, or streamed text", () => {
    expect(parseHermes('{"type":"text","text":"Hel"}\n{"type":"result","text":"Hello","exit_code":0}', "")).toEqual({ ok: true, text: "Hello" });
    expect(parseHermes('{"type":"result","text":"","exit_code":2}', "").ok).toBe(false);
  });

  it("OpenClaw: payloads, and a down Gateway is recognised", () => {
    expect(parseOpenClaw('noise {"ok":true,"result":{"payloads":[{"text":"Answer"}],"meta":{"toolSummary":{"tools":["web_search"]}}}}', "")).toEqual({ ok: true, text: "Answer", tools: ["web_search"] });
    const down = parseOpenClaw('{"ok":false,"error":"gateway not reachable at ws://127.0.0.1:18789"}', "");
    expect(down).toMatchObject({ ok: false, gatewayDown: true });
  });
});

describe("OpenRouter", () => {
  it("adds zero-data-retention routing to every request body", async () => {
    let sent: Record<string, unknown> = {};
    const base = (async (_u: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}");
    }) as typeof fetch;
    await zdrFetch(base)("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "m", provider: { zdr: false, order: ["a"] } }) });
    expect(sent.provider).toEqual({ order: ["a"], zdr: true, data_collection: "deny" });
    await zdrFetch(base, { reasoning: { effort: "high" } })("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "m" }) });
    expect(sent.reasoning).toEqual({ effort: "high" });
    expect(sent.provider).toEqual({ zdr: true, data_collection: "deny" });
  });

  it("lists only models with a zero-retention endpoint that can use tools", async () => {
    const fetchFn = (async (u: string) =>
      Response.json(
        u.endsWith("/endpoints/zdr")
          ? { data: [{ model_id: "a/tools" }, { model_id: "b/notools" }] }
          : {
              data: [
                { id: "a/tools", name: "A", supported_parameters: ["tools"] },
                { id: "b/notools", name: "B", supported_parameters: [] },
                { id: "c/nozdr", name: "C", supported_parameters: ["tools"] },
                { id: "a/tools:batch", name: "A batch", supported_parameters: ["tools"] },
              ],
            },
      )) as unknown as typeof fetch;
    expect(await openRouterModels(fetchFn)).toEqual([{ id: "a/tools", label: "A" }]);
  });
});

describe("bridge: the app's tools for agent programs over MCP", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer(0);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
    server.close();
    server = createServer(port);
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  });
  afterAll(() => server.close());

  const connect = async (token: string) => {
    const client = new Client({ name: "test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
  };

  const tools = {
    search_research: tool({
      description: "Search studies",
      inputSchema: z.object({ terms: z.array(z.string()) }),
      execute: async ({ terms }) => ({ studies: [{ id: "PMID:12345678", title: terms.join(" ") }] }),
    }),
  };

  it("lists and runs the run's tools, and records steps and study IDs", async () => {
    const run = openRun(tools);
    const client = await connect(run.token);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(["search_research"]);
    expect(list.tools[0]!.inputSchema.type).toBe("object");
    const res = await client.callTool({ name: "search_research", arguments: { terms: ["ferritin"] } });
    expect(JSON.stringify(res.content)).toContain("PMID:12345678");
    expect(run.steps).toEqual([{ tool: "search_research", input: '{"terms":["ferritin"]}', success: true }]);
    expect([...run.ids]).toEqual(["PMID:12345678"]);
    await client.close();
    closeRun(run);
  });

  it("doesn't count example IDs in skill instructions as retrieved studies", async () => {
    const run = openRun({
      read_skill: tool({ description: "Skill", inputSchema: z.object({ id: z.string() }), execute: async () => ({ body: "Cite like [PMID:12345678]." }) }),
    });
    const client = await connect(run.token);
    await client.callTool({ name: "read_skill", arguments: { id: "evidence-review" } });
    expect(run.ids.size).toBe(0);
    await client.close();
    closeRun(run);
  });

  it("refuses unknown tokens and tokens of finished runs", async () => {
    await expect(connect("0".repeat(64))).rejects.toThrow();
    const run = openRun(tools);
    closeRun(run);
    await expect(connect(run.token)).rejects.toThrow();
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
  });

  it("never retargets the Hermes stable token to an overlapping request", async () => {
    const first = openRun(tools, "hermes");
    const token = stableToken();
    const client = await connect(token);
    try {
      expect(() => openRun({
        get_results: tool({ inputSchema: z.object({}), execute: async () => ({ private: "OTHER_SCOPE" }) }),
      }, "hermes")).toThrow();
      expect(runFor(token)).toBe(first);
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["search_research"]);
      expect((await client.callTool({ name: "get_results", arguments: {} })).isError).toBe(true);
    } finally {
      await client.close();
      closeRun(first);
    }
    const next = openRun(tools, "hermes");
    expect(runFor(token)).toBe(next);
    closeRun(next);
  });

  it("with the stable token and no question running, lists tools but won't run them", async () => {
    const client = await connect(stableToken());
    const res = await client.callTool({ name: "get_results", arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/only work while it is answering/);
    await client.close();
  });
});
