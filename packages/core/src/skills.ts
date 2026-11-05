/**
 * Skills: plain-language instructions the assistant loads when a task needs them.
 * Same format as Agent Skills: a SKILL.md with a YAML-style front matter
 * (name, description) and the instructions below it.
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  /** Bundled with the app (read-only) or added by the user. */
  source: "bundled" | "custom";
}

export type ParsedSkill = { ok: true; name: string; description: string; body: string } | { ok: false; error: string };

export const MAX_SKILL_CHARS = 40_000;

/** Parse a SKILL.md. Only the simple `key: value` front matter that skills use is supported. */
export function parseSkill(markdown: string): ParsedSkill {
  const text = markdown.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (text.length > MAX_SKILL_CHARS) return { ok: false, error: "This skill is too long (over 40,000 characters)." };
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { ok: false, error: "A skill starts with a front matter block between --- lines, with a name and a description." };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) fields[kv[1]!.toLowerCase()] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  const name = fields.name ?? "";
  const description = fields.description ?? "";
  const body = m[2]!.trim();
  if (!name) return { ok: false, error: "The skill needs a name." };
  if (!description) return { ok: false, error: "The skill needs a description that says when to use it." };
  if (!body) return { ok: false, error: "The skill has no instructions." };
  return { ok: true, name, description, body };
}

/** A safe id from a name: "Evidence review" -> "evidence-review". */
export function skillId(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The short list the assistant always sees; it loads a skill's full text with a tool when needed. */
export function skillIndex(skills: readonly Pick<Skill, "id" | "name" | "description">[]): string {
  if (skills.length === 0) return "";
  return skills.map((s) => `- ${s.id}: ${s.name}. ${s.description}`).join("\n");
}
