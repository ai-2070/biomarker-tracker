import { isIsoDate } from "./dates";
import { MAX_LABEL } from "./protocols";
import type { BiomarkerDef } from "./types";

/**
 * A habit Brain suggests adding: shown as a card the person checks, edits and confirms; nothing is
 * saved without them. Checked the same way on the server (so the model hears what was wrong) and in
 * the page (which builds the card from the tool call). Never a medicine, never with an amount: the
 * app explains, it doesn't prescribe (CLAUDE.md).
 */

export type ProposalCategory = "supplement" | "diet" | "lifestyle";

export interface HabitProposal {
  label: string;
  category: ProposalCategory;
  start: string;
  /** Marker ids to watch (resolved from names or aliases). */
  markerIds: string[];
  /** Brain's short reason, shown on the card. */
  reason: string;
}

/** An amount or a count of pills in a label: a dose, which Brain must not set. */
export const DOSE = /\d+(?:[.,]\d+)?\s*(?:mg|µg|mcg|ug|iu|i\.u\.|g|ml|units?|tablets?|capsules?|caps|pills?|drops?|scoops?)\b|\b\d+\s*x\b/i;
export const MAX_WATCHED = 5;

/** A marker id from an id, name, abbreviation or alias (case-insensitive). */
export function markerIdFor(query: string, defs: ReadonlyMap<string, BiomarkerDef>): string | undefined {
  const q = query.trim().toLowerCase();
  if (defs.has(q)) return q;
  for (const d of defs.values()) if ([d.name, d.abbreviation ?? "", ...d.aliases].some((a) => a.toLowerCase() === q)) return d.id;
  return undefined;
}

export type ProposalCheck = { ok: true; proposal: HabitProposal; unknownMarkers: string[] } | { ok: false; error: string };

export function parseHabitProposal(input: unknown, defs: ReadonlyMap<string, BiomarkerDef>, today: string): ProposalCheck {
  if (typeof input !== "object" || input === null) return { ok: false, error: "No habit was given." };
  const v = input as Record<string, unknown>;
  const label = typeof v.label === "string" ? v.label.trim() : "";
  if (!label) return { ok: false, error: "Give the habit a short name." };
  if (label.length > MAX_LABEL) return { ok: false, error: `Keep the name under ${MAX_LABEL} characters.` };
  if (DOSE.test(label)) return { ok: false, error: "Leave out amounts and doses: the person adds those themselves, with their doctor or pharmacist." };
  if (v.category === "medication") return { ok: false, error: "Medicines can't be suggested. The person can add one themselves in Habits." };
  if (v.category !== "supplement" && v.category !== "diet" && v.category !== "lifestyle")
    return { ok: false, error: "Category must be supplement, diet or lifestyle." };
  const start = typeof v.start === "string" && v.start.trim() ? v.start.trim() : today;
  if (!isIsoDate(start)) return { ok: false, error: "Start must be a date (YYYY-MM-DD)." };
  const reason = typeof v.reason === "string" ? v.reason.trim().slice(0, 300) : "";
  if (!reason) return { ok: false, error: "Give a short reason the person can read on the card." };
  const asked = Array.isArray(v.watchMarkers) ? v.watchMarkers.filter((m): m is string => typeof m === "string") : [];
  const markerIds: string[] = [];
  const unknownMarkers: string[] = [];
  for (const m of asked) {
    const id = markerIdFor(m, defs);
    if (!id) unknownMarkers.push(m);
    else if (!markerIds.includes(id)) markerIds.push(id);
  }
  if (markerIds.length > MAX_WATCHED) return { ok: false, error: `Watch at most ${MAX_WATCHED} markers: with many, some would look changed by chance.` };
  return { ok: true, proposal: { label, category: v.category, start, markerIds, reason }, unknownMarkers };
}
