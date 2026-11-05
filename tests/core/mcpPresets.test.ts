import { describe, expect, it } from "vitest";
import { MCP_PRESETS, mcpPreset, presetArgs, toolName } from "@bt/core/mcpPresets";

describe("MCP presets", () => {
  it("have unique ids and pinned versions", () => {
    const ids = MCP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of MCP_PRESETS) {
      expect(p.version, p.id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.repo, p.id).toMatch(/^https:\/\/github\.com\//);
      expect(["Apache-2.0", "MIT"]).toContain(p.license);
      expect(p.sends.length, p.id).toBeGreaterThan(10);
    }
  });
  it("runs a pinned version with npx", () => {
    expect(presetArgs(mcpPreset("pubmed")!)).toEqual(["-y", "@cyanheads/pubmed-mcp-server@2.11.1"]);
  });
  it("keeps tool names from different servers apart and provider-safe", () => {
    expect(toolName("pubmed", "pubmed_search_articles")).toBe("pubmed__pubmed_search_articles");
    expect(toolName("my server", "find.thing")).toBe("my_server__find_thing");
    expect(toolName("s", "x".repeat(100)).length).toBe(64);
  });
});
