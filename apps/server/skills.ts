// Skills: bundled ones in <repo>/skills (read-only) and the user's own in <data>/skills.
import fs from "node:fs";
import path from "node:path";
import { parseSkill, skillId, type Skill } from "@bt/core/skills";
import { ROOT, dataPath, getSettings, updateSettings } from "./store";

const BUNDLED = () => path.join(ROOT, "skills");
const CUSTOM = () => dataPath("skills");

function readDir(dir: string, source: Skill["source"]): Skill[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const r = parseSkill(fs.readFileSync(path.join(dir, e.name, "SKILL.md"), "utf8"));
      if (r.ok) out.push({ id: e.name, name: r.name, description: r.description, body: r.body, source });
    } catch {
      /* folder without a SKILL.md */
    }
  }
  return out;
}

export interface SkillListing extends Omit<Skill, "body"> {
  enabled: boolean;
}

export function allSkills(): Skill[] {
  const bundled = readDir(BUNDLED(), "bundled");
  const ids = new Set(bundled.map((s) => s.id));
  return [...bundled, ...readDir(CUSTOM(), "custom").filter((s) => !ids.has(s.id))].sort((a, b) => a.name.localeCompare(b.name));
}

export function listSkills(): SkillListing[] {
  const off = new Set(getSettings().skillsOff);
  return allSkills().map(({ body: _b, ...s }) => ({ ...s, enabled: !off.has(s.id) }));
}

export function enabledSkills(): Skill[] {
  const off = new Set(getSettings().skillsOff);
  return allSkills().filter((s) => !off.has(s.id));
}

export function getSkill(id: string): Skill | undefined {
  return allSkills().find((s) => s.id === id);
}

export function setSkillEnabled(id: string, enabled: boolean): void {
  if (!getSkill(id)) throw new Error("No skill with that name.");
  updateSettings((s) => {
    const off = new Set(s.skillsOff);
    if (enabled) off.delete(id);
    else off.add(id);
    s.skillsOff = [...off];
  });
}

/** Save the user's own skill. It can't replace a bundled one. */
export function addSkill(markdown: string): Skill {
  const r = parseSkill(markdown);
  if (!r.ok) throw new Error(r.error);
  const id = skillId(r.name);
  if (!id) throw new Error("The name needs letters or numbers.");
  if (readDir(BUNDLED(), "bundled").some((s) => s.id === id)) throw new Error("A built-in skill already has this name. Choose another name.");
  const dir = path.join(CUSTOM(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), markdown.replace(/\r\n/g, "\n"));
  return { id, name: r.name, description: r.description, body: r.body, source: "custom" };
}

export function deleteSkill(id: string): void {
  const s = getSkill(id);
  if (!s) throw new Error("No skill with that name.");
  if (s.source !== "custom") throw new Error("Built-in skills can be switched off, not deleted.");
  fs.rmSync(path.join(CUSTOM(), id), { recursive: true, force: true });
}
