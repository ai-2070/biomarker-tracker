import type { Flag, ResolvedRange, Trend } from "../core/trends";
import type { BiomarkerDef, Sex } from "../core/types";
import type { Paper } from "../research/papers";

/**
 * Builds exactly what is sent to the model. Everything here is shown to the
 * user before sending. Only computed values from /core go in; no names, birth
 * dates (age only), lab names, notes or IDs.
 */

export interface ContextResult {
  date: string;
  /** Already formatted for display in the chosen unit, e.g. "38" or "<0.3". */
  value: string;
  flag: Flag;
  range?: string;
}

export interface AiContextInput {
  def: BiomarkerDef;
  unit: string;
  question: string;
  papers: readonly Paper[];
  /** Omit to leave out the user's own results. */
  results?: readonly ContextResult[];
  /** Pre-formatted trend sentences computed by /core. */
  trendLines?: readonly string[];
  range?: ResolvedRange;
  rangeText?: string;
  age?: number;
  sex?: Sex;
  /** "Iron 30 mg (supplement), 2022-01-15 to 2022-09-20". Omit to leave the log out. */
  logLines?: readonly string[];
  /** True when the log has entries that change what is safe to suggest (blood thinners, etc.). */
  cautious?: boolean;
}

export const MAX_ABSTRACT_CHARS = 1500;
export const MAX_PAPERS = 10;

export function systemPrompt(cautious: boolean): string {
  const rules = [
    "You explain blood test results and research evidence in plain language to someone without medical training.",
    "",
    "Rules:",
    "1. Base your answer only on the studies listed under STUDIES. Cite them with their ID in square brackets exactly as given, for example [PMID:12345678]. Never cite anything else and never invent studies, authors or IDs.",
    "2. Say how strong the evidence is, using each study's type (a guideline or several meta-analyses is stronger than one small study). Mention when evidence comes from a different group of people than the person asking.",
    '3. If the studies do not answer the question, say: "These studies don\'t give enough evidence to answer that." Do not fill gaps from general knowledge.',
    "4. Do not diagnose. Do not tell the person to start, stop or change any medicine. Do not give personal doses or amounts.",
    "5. If a result is outside its reference range or changing quickly, suggest discussing it with a doctor.",
    "6. Do not calculate new numbers. Only use the numbers under MY RESULTS, which the app computed.",
    "7. Keep the answer under 250 words. Use short sentences and explain any medical term you use.",
  ];
  if (cautious) {
    rules.push(
      "8. The person has a health condition or medicine where diet and supplement changes need a doctor's input. Do not suggest increasing any nutrient, food or supplement; say that changes should be discussed with their doctor.",
    );
  }
  return rules.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, "")} …`;
}

const KIND_LABEL: Record<Paper["kind"], string> = {
  guideline: "Guideline",
  "meta-analysis": "Meta-analysis",
  "systematic review": "Systematic review",
  "randomised trial": "Randomised controlled trial",
  review: "Review",
  observational: "Observational study",
  other: "Study",
};

export function userMessage(i: AiContextInput): string {
  const lines: string[] = [];
  lines.push(`MARKER: ${i.def.name}${i.def.abbreviation ? ` (${i.def.abbreviation})` : ""}, shown in ${i.unit}`);
  lines.push(`ABOUT THIS MARKER: ${i.def.summary}`);

  if (i.results && i.results.length > 0) {
    lines.push("", "MY RESULTS (oldest first):");
    for (const r of i.results) {
      const flag = r.flag === "unknown" ? "" : `, ${r.flag.replace("-", " ")}`;
      lines.push(`- ${r.date}: ${r.value} ${i.unit}${flag}${r.range ? ` (range ${r.range})` : ""}`);
    }
    for (const t of i.trendLines ?? []) lines.push(`- ${t}`);
    if (i.rangeText) lines.push(`- Reference range used: ${i.rangeText} (${i.range?.source === "lab" ? "from the lab" : "typical adult range"})`);
  }

  const about = [i.age !== undefined ? `age ${Math.floor(i.age)}` : undefined, i.sex ? (i.sex === "f" ? "female" : "male") : undefined].filter(Boolean);
  if (about.length > 0 && i.results && i.results.length > 0) lines.push(`- About me: ${about.join(", ")}`);

  if (i.logLines && i.logLines.length > 0) {
    lines.push("", "MY LOG (supplements, diet, medicines, habits):");
    for (const l of i.logLines) lines.push(`- ${l}`);
  }

  lines.push("", "STUDIES:");
  for (const p of i.papers.slice(0, MAX_PAPERS)) {
    const meta = [p.year, KIND_LABEL[p.kind], p.journal].filter(Boolean).join(", ");
    lines.push(`[${p.id}] ${p.title} (${meta})`);
    lines.push(p.abstract ? `Abstract: ${truncate(p.abstract.replace(/\s+/g, " "), MAX_ABSTRACT_CHARS)}` : "Abstract: not available.");
    lines.push("");
  }

  lines.push(`QUESTION: ${i.question.trim()}`);
  return lines.join("\n");
}

export function buildAiContext(i: AiContextInput): { system: string; user: string; allowedIds: Set<string> } {
  return {
    system: systemPrompt(i.cautious ?? false),
    user: userMessage(i),
    allowedIds: new Set(i.papers.slice(0, MAX_PAPERS).map((p) => p.id)),
  };
}

/** Plain trend sentences from a computed Trend, for the context. */
export function trendLines(t: Trend | undefined, change: string | undefined, perYear: string | undefined): string[] {
  if (!t || t.count < 2) return [];
  const out: string[] = [];
  if (change && t.previous) out.push(`Change since the previous result (${t.previous.date}): ${change}`);
  if (perYear && t.count >= 3) out.push(`Average change across ${t.count} results: about ${perYear} per year`);
  return out;
}
