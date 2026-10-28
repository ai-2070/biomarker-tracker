// The assistant's built-in tools. Every number comes from the tested core (src/core);
// the model only explains. Tools work on the snapshot the page sends with each question.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { parseBackup } from "../src/core/backup";
import { todayIso } from "../src/core/dates";
import { selectLevers } from "../src/core/evidence";
import { analyzeMarker, rcvBand, retestDate } from "../src/core/experiments";
import { selectFoods } from "../src/core/foods";
import { summarizePhenoAge } from "../src/core/phenoageDraws";
import { ageAt } from "../src/core/phenoageDraws";
import { assistantProfile } from "../src/core/profile";
import { safetyLabels, safetyNotes } from "../src/core/protocols";
import { computeTrend, flagMeasurement, groupByBiomarker, isCritical, resolveRange, sortByDate } from "../src/core/trends";
import { roundForDisplay } from "../src/core/units";
import type { BiomarkerDef, Experiment, Measurement, Profile, ProtocolEntry, SafetyId } from "../src/core/types";
import { markerTerms, searchPapers, type SearchFilter } from "../src/research/papers";
import { findMarker, knowledge } from "./knowledge";
import { enabledSkills, getSkill } from "./skills";

export interface HealthSnapshot {
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
  profile: Profile;
}

/** Validate what the page sent, with the same checks as a backup file. */
export function parseSnapshot(v: unknown): { ok: true; snapshot: HealthSnapshot } | { ok: false; error: string } {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const r = parseBackup({ app: "biomarker-tracker", version: 2, measurements: o.measurements ?? [], protocols: o.protocols ?? [], experiments: o.experiments ?? [], profile: o.profile ?? {} });
  if (!r.ok) return { ok: false, error: r.error };
  const { measurements, protocols, experiments, profile } = r.backup;
  // Name and private notes are dropped here too, even if a page sent them.
  return { ok: true, snapshot: { measurements, protocols, experiments, profile: assistantProfile(profile) } };
}

const r = (n: number | undefined) => (n === undefined ? undefined : roundForDisplay(n));

function rangeOut(range: { low?: number; high?: number; source: string } | undefined) {
  return range ? { low: r(range.low), high: r(range.high), source: range.source === "lab" ? "lab's own range" : "typical adult range" } : null;
}

export function safetyOf(s: HealthSnapshot): SafetyId[] {
  return safetyNotes(safetyLabels(s.protocols, s.profile)).map((n) => n.id);
}

/** Every result the user has, latest per marker. */
export function resultsOverview(s: HealthSnapshot) {
  const { defs } = knowledge();
  const out = [];
  for (const [id, ms] of groupByBiomarker(s.measurements)) {
    const def = defs.get(id);
    if (!def) continue;
    const t = computeTrend(ms)!;
    const flag = flagMeasurement(def, t.latest, s.profile);
    out.push({
      marker: def.id,
      name: def.name,
      latest: `${t.latest.qualifier ?? ""}${r(t.latest.value)} ${def.canonicalUnit}`,
      date: t.latest.date,
      flag,
      range: rangeOut(resolveRange(def, t.latest, s.profile)),
      results: t.count,
    });
  }
  return { person: personOf(s), markers: out, critical: out.filter((m) => isCritical(m.flag)).map((m) => m.name) };
}

/** About the person, for context: age (never the birth month), sex and the details they gave. No name. */
export function personOf(s: HealthSnapshot) {
  const p = s.profile;
  return {
    ...(p.birthMonth ? { age: Math.floor(ageAt(p.birthMonth, todayIso())) } : {}),
    ...(p.sex ? { sex: p.sex === "f" ? "female" : "male" } : {}),
    ...(p.heightCm ? { heightCm: p.heightCm } : {}),
    ...(p.diet ? { diet: p.diet } : {}),
    ...(p.smoking ? { smoking: p.smoking } : {}),
    ...(p.conditions ? { conditions: p.conditions } : {}),
    ...(p.allergies ? { allergies: p.allergies } : {}),
  };
}

export function markerDetail(s: HealthSnapshot, def: BiomarkerDef) {
  const ms = sortByDate(s.measurements.filter((m) => m.biomarkerId === def.id));
  const t = computeTrend(ms);
  const bv = def.biologicalVariation;
  const band = bv ? rcvBand(bv.cvi) : undefined;
  return {
    marker: def.id,
    name: def.name,
    unit: def.canonicalUnit,
    about: def.summary,
    ifHigh: def.high,
    ifLow: def.low,
    rangeNote: def.rangeNote ?? null,
    results: ms.map((m) => ({
      date: m.date,
      value: `${m.qualifier ?? ""}${r(m.value)}`,
      flag: flagMeasurement(def, m, s.profile),
      range: rangeOut(resolveRange(def, m, s.profile)),
      fasted: m.fasted ?? null,
    })),
    trend: t && t.count > 1 ? { changeSincePrevious: r(t.change), percentChange: r(t.percentChange), ratePerYear: r(t.ratePerYear), since: t.previous?.date } : null,
    normalVariation: bv && band ? { withinPersonCV: `${bv.cvi}%`, oneTestToNextBand: `${r(band.down * 100)}% to +${r(band.up * 100)}%`, source: bv.source } : "not known for this marker",
    sources: def.sources.map((c) => ({ id: c.pmid ? `PMID:${c.pmid}` : `DOI:${c.doi}`, title: c.title, year: c.year, type: c.studyType })),
  };
}

export function levers(s: HealthSnapshot, def: BiomarkerDef) {
  const { evidence, foods } = knowledge();
  const latest = computeTrend(s.measurements.filter((m) => m.biomarkerId === def.id))?.latest;
  const flag = latest ? flagMeasurement(def, latest, s.profile) : undefined;
  const safety = safetyOf(s);
  const sel = selectLevers(def.id, flag, evidence, safety);
  return {
    latestFlag: flag ?? "no results",
    showing: sel.focus ? `levers that help when ${def.name} is ${sel.focus}` : "everything known to affect it",
    safetyNotes: safetyNotes(safetyLabels(s.protocols, s.profile)).map((n) => `${n.title}: ${n.text}`),
    hiddenBecauseOfLog: sel.hidden.map((c) => c.lever),
    levers: sel.claims.map((c) => {
      const f = c.foods ? selectFoods(foods, c.foods.nutrient, c.foods.foodIds, safety) : undefined;
      const unit = c.foods ? foods.nutrients[c.foods.nutrient]?.unit : undefined;
      return {
        lever: c.lever,
        kind: c.kind,
        tested: c.intervention,
        effect: `${c.direction} ${c.outcome}`,
        grade: c.grade,
        whyThisGrade: c.whyThisGrade,
        summary: c.summary,
        caution: c.caution ?? null,
        studies: c.studies.map((st) => ({ id: st.pmid ? `PMID:${st.pmid}` : `DOI:${st.doi}`, title: st.title, year: st.year, type: st.studyType })),
        foods: f
          ? {
              nutrient: c.foods!.nutrient,
              perPortion: f.shown.map((x) => `${x.food.name}, ${x.food.portion.grams} g: ${r(x.amount)} ${unit}`),
              hidden: f.hidden.map((h) => `${h.food.name} (${h.reason})`),
              note: [c.foods!.note, "Nutrient numbers cover ~150 measured compounds; foods contain thousands more that aren't tracked.", `Source: ${foods.source.name}.`].filter(Boolean).join(" "),
            }
          : null,
      };
    }),
  };
}

export function biologicalAge(s: HealthSnapshot) {
  const sum = summarizePhenoAge(s.measurements, s.profile.birthMonth);
  return {
    draws: sum.draws.map((d) => ({
      date: d.date,
      status: d.status,
      age: r(d.age),
      phenoAge: r(d.phenoAge),
      difference: r(d.difference),
      approximateBecause: d.approximate.map((a) => `${a.biomarkerId} reported as "${a.qualifier}" a limit`),
    })),
    latestIncomplete: sum.latestPartial ?? null,
    about: "PhenoAge (Levine et al. 2018): 9 routine markers and age turned into the age at which an average person in a US survey had the same risk. An estimate, not a measurement.",
  };
}

export function experimentResults(s: HealthSnapshot) {
  const { defs } = knowledge();
  return s.experiments.map((e) => ({
    change: e.change,
    start: e.start,
    retestFrom: retestDate(e),
    ended: e.end ?? null,
    markers: e.markerIds.flatMap((id) => {
      const def = defs.get(id);
      if (!def) return [];
      const a = analyzeMarker(e, def, s.measurements);
      return [
        {
          marker: def.name,
          verdict: a.verdict,
          before: r(a.beforeValue),
          after: r(a.afterValue),
          changePercent: a.change === undefined ? null : r(a.change * 100),
          normalVariationBand: a.band ? `${r(a.band.down * 100)}% to +${r(a.band.up * 100)}%` : null,
        },
      ];
    }),
  }));
}

const notFound = (q: string) => ({ error: `No marker called "${q}". Use get_results to see which markers the user has.` });

/** The built-in tools for one request. `fetchFn` is injected so tests can run without a network. */
export function healthTools(s: HealthSnapshot, fetchFn: typeof fetch = fetch): ToolSet {
  return {
    get_results: tool({
      description: "List every marker the user has with its latest result, date, flag (normal, low, high, critical) and the reference range used. Start here.",
      inputSchema: z.object({}),
      execute: async () => resultsOverview(s),
    }),
    get_marker: tool({
      description: "All results for one marker with flags, ranges, the computed trend, normal test-to-test variation, what the marker means, and sources.",
      inputSchema: z.object({ marker: z.string().describe("Marker id or name, e.g. 'ferritin', 'LDL', 'HbA1c'") }),
      execute: async ({ marker }) => {
        const def = findMarker(marker);
        return def ? markerDetail(s, def) : notFound(marker);
      },
    }),
    get_levers: tool({
      description: "Graded evidence on what can raise or lower a marker (foods, diet, supplements, habits), with measured food amounts. Safety filters for the user's log are already applied.",
      inputSchema: z.object({ marker: z.string() }),
      execute: async ({ marker }) => {
        const def = findMarker(marker);
        return def ? levers(s, def) : notFound(marker);
      },
    }),
    get_biological_age: tool({
      description: "PhenoAge for each blood test that had all 9 markers, computed by the app.",
      inputSchema: z.object({}),
      execute: async () => biologicalAge(s),
    }),
    get_log: tool({
      description: "The user's log of supplements, diet changes, medicines and habits, with dates, and any safety notes they trigger.",
      inputSchema: z.object({}),
      execute: async () => ({
        entries: s.protocols.map((p) => ({ label: p.label, type: p.category, start: p.start, end: p.end ?? "ongoing" })),
        safetyNotes: safetyNotes(safetyLabels(s.protocols, s.profile)).map((n) => `${n.title}: ${n.text}`),
      }),
    }),
    compare_before_after: tool({
      description: "Results of the user's self-experiments: before, after, the change, and whether it is bigger than normal test-to-test variation.",
      inputSchema: z.object({}),
      execute: async () => ({ experiments: experimentResults(s), today: todayIso() }),
    }),
    search_research: tool({
      description:
        "Search published studies (Europe PMC, PubMed as backup). Give 1-3 short topic terms, never personal details. Returns studies with IDs to cite, e.g. [PMID:12345678].",
      inputSchema: z.object({
        terms: z.array(z.string()).min(1).max(3).describe("Main subject terms, e.g. ['ferritin'] or ['vitamin D']"),
        topic: z.string().optional().describe("Extra words to narrow it, e.g. 'pregnancy' or 'vitamin C absorption'"),
        filter: z.enum(["reviews", "trials", "all"]).optional(),
      }),
      execute: async ({ terms, topic, filter }) => {
        const def = terms.length === 1 ? findMarker(terms[0]!) : undefined;
        const t = def ? markerTerms(def.name, def.abbreviation) : terms.map((x) => x.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim()).filter(Boolean);
        const res = await searchPapers(t, (filter ?? "reviews") as SearchFilter, topic ?? "", (u, i) => fetchFn(u, i), AbortSignal.timeout(20_000), 8);
        return {
          source: res.source,
          total: res.total,
          studies: res.papers.map((p) => ({ id: p.id, title: p.title, year: p.year, type: p.kind, journal: p.journal, abstract: p.abstract?.slice(0, 1500) ?? null })),
        };
      },
    }),
    read_skill: tool({
      description: "Load the full instructions of one of the skills listed in your instructions.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const sk = getSkill(id);
        if (!sk || !enabledSkills().some((e) => e.id === id)) return { error: `No skill "${id}".` };
        return { name: sk.name, instructions: sk.body };
      },
    }),
  };
}
