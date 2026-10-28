import { describe, expect, it } from "vitest";
import { addCustom, addPreset, listServers, removeServer, resolveCommand, serverEnv, updateServer } from "../../server/mcp";
import { addSkill, deleteSkill, enabledSkills, listSkills, setSkillEnabled } from "../../server/skills";
import { getSecrets, getSettings } from "../../server/store";

describe("skills", () => {
  it("lists the bundled medical skills, all on by default", () => {
    const s = listSkills();
    expect(s.length).toBeGreaterThanOrEqual(8);
    expect(s.every((x) => x.enabled && x.source === "bundled")).toBe(true);
    expect(s.map((x) => x.id)).toContain("evidence-review");
  });

  it("switches a skill off and on", () => {
    setSkillEnabled("biological-age", false);
    expect(enabledSkills().some((s) => s.id === "biological-age")).toBe(false);
    setSkillEnabled("biological-age", true);
    expect(enabledSkills().some((s) => s.id === "biological-age")).toBe(true);
  });

  it("adds and deletes the user's own skill, but never replaces or deletes a built-in one", () => {
    const sk = addSkill("---\nname: My protocol notes\ndescription: Use when I ask about my protocol.\n---\nAlways ask my doctor.");
    expect(sk.id).toBe("my-protocol-notes");
    expect(listSkills().find((s) => s.id === "my-protocol-notes")?.source).toBe("custom");
    expect(() => addSkill("---\nname: Evidence review\ndescription: x\n---\nbody")).toThrow(/built-in/);
    expect(() => deleteSkill("evidence-review")).toThrow(/switched off, not deleted/);
    deleteSkill("my-protocol-notes");
    expect(listSkills().some((s) => s.id === "my-protocol-notes")).toBe(false);
  });

  it("rejects an invalid skill", () => {
    expect(() => addSkill("just text")).toThrow(/front matter/);
  });
});

describe("MCP servers", () => {
  it("adds a ready-made server once, pinned to its version", () => {
    const cfg = addPreset("pubmed");
    expect(cfg).toMatchObject({ command: "npx", args: ["-y", "@cyanheads/pubmed-mcp-server@2.11.1"], enabled: true });
    expect(() => addPreset("pubmed")).toThrow(/already added/);
    expect(() => addPreset("nope")).toThrow(/Unknown/);
  });

  it("keeps secret settings out of the settings file", async () => {
    await updateServer("pubmed", { env: { NCBI_API_KEY: "ncbi-secret" } });
    expect(getSecrets().mcpEnv.pubmed).toEqual({ NCBI_API_KEY: "ncbi-secret" });
    expect(JSON.stringify(getSettings())).not.toContain("ncbi-secret");
    expect(listServers().find((s) => s.id === "pubmed")?.secretsSet).toEqual(["NCBI_API_KEY"]);
    await updateServer("pubmed", { env: { NCBI_API_KEY: null } });
    expect(getSecrets().mcpEnv.pubmed).toEqual({});
  });

  it("rejects bad setting names and line breaks in commands", async () => {
    await expect(updateServer("pubmed", { env: { "BAD NAME": "x" } })).rejects.toThrow(/valid setting name/);
    expect(() => addCustom({ name: "x", command: "npx\nrm", args: [] })).toThrow(/line breaks/);
    expect(() => addCustom({ name: "", command: "npx", args: [] })).toThrow(/name/);
  });

  it("gives a server only a minimal environment plus its own settings", () => {
    process.env.SOME_OTHER_APP_KEY = "leak-me";
    const cfg = addCustom({ name: "Mine", command: "node", args: ["server.js"] });
    const env = serverEnv(cfg, { MY_KEY: "k" });
    expect(env.MY_KEY).toBe("k");
    expect(env.SOME_OTHER_APP_KEY).toBeUndefined();
    expect(env.PATH ?? env.Path).toBeDefined();
    delete process.env.SOME_OTHER_APP_KEY;
  });

  it("wraps npx in cmd on Windows only", () => {
    expect(resolveCommand("npx", ["-y", "x"], true)).toEqual({ command: process.env.ComSpec || "cmd.exe", args: ["/c", "npx", "-y", "x"] });
    expect(resolveCommand("npx", ["-y", "x"], false)).toEqual({ command: "npx", args: ["-y", "x"] });
    expect(resolveCommand("C:\\tools\\srv.exe", [], true)).toEqual({ command: "C:\\tools\\srv.exe", args: [] });
  });

  it("removes a server and its secrets", async () => {
    await updateServer("pubmed", { env: { NCBI_API_KEY: "x" } });
    await removeServer("pubmed");
    expect(getSettings().mcp.some((s) => s.id === "pubmed")).toBe(false);
    expect(getSecrets().mcpEnv.pubmed).toBeUndefined();
  });
});
