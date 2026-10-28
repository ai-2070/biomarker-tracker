import { ageAt } from "./phenoageDraws";
import type { Profile } from "./types";

/** What may go to an AI model: everything except the name and private notes. (The server turns birth month into age.) */
export function assistantProfile(p: Profile): Profile {
  const { name: _name, notes: _notes, ...rest } = p;
  return rest;
}

/** Initials for the profile button, e.g. "Anna Kovacs" -> "AK". */
export function initials(name: string | undefined): string {
  // Words only: "(example)" and other bracketed or punctuation-only parts don't count.
  const parts = (name ?? "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** A short line about the person, e.g. "41 years, female". */
export function profileSummary(p: Profile, today: string): string {
  const bits: string[] = [];
  if (p.birthMonth) bits.push(`${Math.floor(ageAt(p.birthMonth, today))} years`);
  if (p.sex) bits.push(p.sex === "f" ? "female" : "male");
  return bits.join(", ");
}
