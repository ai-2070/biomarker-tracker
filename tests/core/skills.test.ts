import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_SKILL_CHARS, parseSkill, skillId, skillIndex } from "@bt/core/skills";

const SKILLS_DIR = join(import.meta.dirname, "..", "..", "skills");

describe("parseSkill", () => {
  it("reads name, description and instructions", () => {
    const r = parseSkill("---\nname: Evidence review\ndescription: \"Use when weighing studies.\"\n---\n\n# Steps\n1. Search\n");
    expect(r).toEqual({ ok: true, name: "Evidence review", description: "Use when weighing studies.", body: "# Steps\n1. Search" });
  });
  it("accepts Windows line endings and a byte-order mark", () => {
    expect(parseSkill("﻿---\r\nname: A\r\ndescription: B\r\n---\r\nBody").ok).toBe(true);
  });
  it("explains what is missing", () => {
    expect(parseSkill("no front matter")).toEqual({ ok: false, error: expect.stringMatching(/front matter/) });
    expect(parseSkill("---\ndescription: x\n---\nbody")).toEqual({ ok: false, error: expect.stringMatching(/name/) });
    expect(parseSkill("---\nname: x\n---\nbody")).toEqual({ ok: false, error: expect.stringMatching(/description/) });
    expect(parseSkill("---\nname: x\ndescription: y\n---\n   ")).toEqual({ ok: false, error: expect.stringMatching(/no instructions/) });
  });
  it("rejects very long skills", () => {
    expect(parseSkill(`---\nname: x\ndescription: y\n---\n${"a".repeat(MAX_SKILL_CHARS)}`).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("makes safe ids", () => {
    expect(skillId("Evidence review")).toBe("evidence-review");
    expect(skillId("Lab résults: explain!")).toBe("lab-results-explain");
    expect(skillId("../../etc/passwd")).toBe("etc-passwd");
  });
  it("lists skills for the assistant", () => {
    expect(skillIndex([{ id: "a", name: "A", description: "Do A." }])).toBe("- a: A. Do A.");
    expect(skillIndex([])).toBe("");
  });
});

describe("bundled skills", () => {
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());

  it("has skills", () => {
    expect(dirs.length).toBeGreaterThanOrEqual(6);
  });

  it.each(dirs.map((d) => d.name))("%s is a valid skill whose folder matches its name", (dir) => {
    const r = parseSkill(readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf8"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(skillId(r.name)).toBe(dir);
  });

  it("keeps every bundled skill within the safety rules", () => {
    for (const d of dirs) {
      const body = readFileSync(join(SKILLS_DIR, d.name, "SKILL.md"), "utf8").toLowerCase();
      // Each skill must carry the "explain, don't prescribe" rule in some form.
      expect(body, d.name).toMatch(/doctor|don't prescribe|do not prescribe|never .*dose/);
    }
  });
});
