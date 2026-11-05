import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCP_PRESETS } from "@bt/core/mcpPresets";
import { assistantTools, ensureDefaultServers, removeServer, researchTools } from "../../apps/server/mcp";
import { studyIdsFromTool, toolStep } from "../../apps/server/steps";
import { getSettings, updateSettings } from "../../apps/server/store";

describe("ready-made MCP servers on first start", () => {
  it("are added switched off when npx is missing", () => {
    ensureDefaultServers(false);
    const s = getSettings();
    expect(s.mcp.map((m) => m.presetId).sort()).toEqual(MCP_PRESETS.map((p) => p.id).sort());
    expect(s.mcp.every((m) => !m.enabled)).toBe(true);
    expect(s.mcpSeeded).toBe(true);
  });

  it("are added only once: a removed server stays removed", async () => {
    await removeServer("pubmed");
    ensureDefaultServers(true);
    expect(getSettings().mcp.some((m) => m.presetId === "pubmed")).toBe(false);
  });

  it("are switched on when npx is there and no key is required", () => {
    updateSettings((s) => {
      s.mcp = [];
      delete s.mcpSeeded;
    });
    ensureDefaultServers(true);
    const s = getSettings();
    for (const p of MCP_PRESETS) {
      const needsKey = p.env.some((v) => v.required);
      expect(s.mcp.find((m) => m.presetId === p.id)?.enabled).toBe(!needsKey);
    }
  });

  it("don't hold up a question while starting: a slow server is skipped and reported", async () => {
    updateSettings((s) => {
      // A command that never answers the MCP handshake.
      s.mcp = [{ id: "slow", name: "Slow server", command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], env: {}, enabled: true }];
    });
    const started = Date.now();
    const r = await assistantTools(300);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.failed).toEqual([{ name: "Slow server", error: expect.stringMatching(/still starting/) }]);
    await removeServer("slow");
  });
});

describe("research servers behind two tools", () => {
  const fake = new Map([
    [
      "pubmed",
      {
        search: tool({
          description: "Search PubMed. Example: PMID:11111111",
          inputSchema: z.object({ q: z.string() }),
          execute: async ({ q }) => ({ results: [{ pmid: "22222222", title: q }] }),
        }),
      },
    ],
  ]);
  const t = researchTools(fake);
  const opts = { toolCallId: "1", messages: [] } as never;

  it("lists a server's tools with their input", async () => {
    const out = (await t.research_tools!.execute!({ server: "pubmed" }, opts)) as { tools: { name: string; input: { type: string } }[] };
    expect(out.tools.map((x) => x.name)).toEqual(["search"]);
    expect(out.tools[0]!.input.type).toBe("object");
    expect(await t.research_tools!.execute!({ server: "nope" }, opts)).toMatchObject({ error: expect.stringMatching(/Connected: pubmed/) });
  });

  it("calls a tool, shows it as that server's step, and counts only its real results as studies", async () => {
    const input = { server: "pubmed", tool: "search", input: { q: "ferritin" } };
    expect(await t.use_research_tool!.execute!(input, opts)).toEqual({ results: [{ pmid: "22222222", title: "ferritin" }] });
    expect(toolStep("use_research_tool", input)).toEqual({ tool: "search", server: "pubmed", input: '{"q":"ferritin"}' });
    expect(studyIdsFromTool("use_research_tool", { results: [{ pmid: "22222222", title: "Retrieved study" }] })).toEqual(["PMID:22222222"]);
    const listing = await t.research_tools!.execute!({ server: "pubmed" }, opts);
    expect(studyIdsFromTool("research_tools", listing)).toEqual([]);
  });
});
