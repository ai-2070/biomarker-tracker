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
import { personalRange } from "../src/core/personalRange";
import { computeTrend, flagLatest, flagMeasurement, groupByBiomarker, isCritical, recentAverage, resolveRange, sortByDate } from "../src/core/trends";
import { roundForDisplay } from "../src/core/units";
import type { BiomarkerDef, Experiment, Measurement, Profile, ProtocolEntry, SafetyId } from "../src/core/types";
import { markerTerms, paperById, searchPapers, type SearchFilter } from "../src/research/papers";
import { bodySummary } from "../src/core/bodySummary";
import { parseHabitProposal } from "../src/core/habitProposal";
import { PLAN_TIMES, nutrientFor, pairWarnings, planFromProposal, validatePlan, type Plan, type PlanTime } from "../src/core/plans";
import { dailyReference, mealTotals, searchFoods, validateMeal, type Meal } from "../src/core/meals";
import { findMarker, findNutrient, foods, knowledge } from "./knowledge";
import { enabledSkills, getSkill } from "./skills";

export interface HealthSnapshot {
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
  profile: Profile;
  /** Protocols the person wrote (Protocols page). */
  plans?: Plan[];
  /** Meals the person built (foods and grams). */
  meals?: Meal[];
}

/** Validate what the page sent, with the same checks as a backup file. */
export function parseSnapshot(v: unknown): { ok: true; snapshot: HealthSnapshot } | { ok: false; error: string } {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const r = parseBackup({ app: "biomarker-tracker", version: 2, measurements: o.measurements ?? [], protocols: o.protocols ?? [], experiments: o.experiments ?? [], profile: o.profile ?? {} });
  if (!r.ok) return { ok: false, error: r.error };
  const { measurements, protocols, experiments, profile } = r.backup;
  const plans = Array.isArray(o.plans) ? o.plans : [];
  if (plans.length > 200 || plans.some((p) => validatePlan(p).length > 0)) return { ok: false, error: "The protocols are damaged." };
  const meals = Array.isArray(o.meals) ? o.meals : [];
  if (meals.length > 1000 || meals.some((m) => validateMeal(m).length > 0)) return { ok: false, error: "The meals are damaged." };
  // Name and private notes are dropped here too, even if a page sent them.
  return { ok: true, snapshot: { measurements, protocols, experiments, profile: assistantProfile(profile), plans: plans as Plan[], meals: meals as Meal[] } };
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
    const flag = flagLatest(def, ms, s.profile);
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

/** Where the marker stands now: sleep is judged on the week's average; HRV against the person's own usual range. */
function nowOf(s: HealthSnapshot, def: BiomarkerDef, ms: Measurement[]) {
  if (!ms.length) return null;
  const week = def.judgeAverageOfDays ? recentAverage(ms, def.judgeAverageOfDays) : undefined;
  const usual = def.personalRange ? personalRange(ms) : undefined;
  return {
    flag: flagLatest(def, ms, s.profile),
    ...(def.judgeAverageOfDays
      ? { judgedOn: `the average of the last ${def.judgeAverageOfDays} days, never one reading`, average: week ? r(week.value) : "not enough readings (needs 3)" }
      : {}),
    ...(def.personalRange
      ? {
          usualRange: usual
            ? {
                low: r(usual.low),
                high: r(usual.high),
                from: `${usual.baseline.count} readings, ${usual.baseline.from} to ${usual.baseline.to}`,
                ...(usual.recent ? { lastWeekAverage: r(usual.recent.value), lastWeekIs: `${usual.recent.position} the usual range` } : {}),
                note: "This person's own usual range, not a medical range: nothing is out of range because of it.",
              }
            : "Not enough readings yet (needs 2 weeks).",
        }
      : {}),
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
    now: nowOf(s, def, ms),
    trend: t && t.count > 1 ? { changeSincePrevious: r(t.change), percentChange: r(t.percentChange), ratePerYear: r(t.ratePerYear), since: t.previous?.date } : null,
    normalVariation: bv && band ? { withinPersonCV: `${bv.cvi}%`, oneTestToNextBand: `${r(band.down * 100)}% to +${r(band.up * 100)}%`, source: bv.source } : "not known for this marker",
    sources: def.sources.map((c) => ({ id: c.pmid ? `PMID:${c.pmid}` : `DOI:${c.doi}`, title: c.title, year: c.year, type: c.studyType })),
  };
}

export function levers(s: HealthSnapshot, def: BiomarkerDef) {
  const { evidence, foods } = knowledge();
  const mine = s.measurements.filter((m) => m.biomarkerId === def.id);
  const latest = computeTrend(mine)?.latest;
  const flag = latest ? flagLatest(def, mine, s.profile) : undefined;
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
          normalVariationFrom: a.bandFrom === "personal" ? "the person's own readings before and after" : a.bandFrom === "published" ? "published biological variation (EFLM)" : null,
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
    get_body_summary: tool({
      description:
        "The app's own calculations from body measurements: BMI, waist-to-height, basal metabolic rate (an estimate, never a target), heart age with 10-year cardiovascular risk (Framingham), and recent averages of blood pressure, resting heart rate, resting HRV, blood oxygen and sleep. Use these numbers; don't calculate them yourself.",
      inputSchema: z.object({}),
      execute: async () => bodySummary(s.profile, s.measurements, s.protocols, todayIso(), knowledge().defs),
    }),
    get_protocols: tool({
      description:
        "The person's protocols (Protocols page): named sets of supplements, foods, exercise, sleep habits or medicines they follow or plan to, each item with their own amount and time of day, and whether the protocol is running (started as habits). Supplements are linked to the vitamins and minerals knowledge base, with the EU (EFSA) reference intake and upper limit for this person (population values, from all food; never a dose) and interactions between items. Amounts are the person's own entries: never change them or suggest new ones.",
      inputSchema: z.object({}),
      execute: async () => {
        const { nutrients } = knowledge();
        return {
          protocols: (s.plans ?? []).map((p) => ({
            name: p.name,
            ...(p.description ? { description: p.description } : {}),
            ...(p.source ? { source: p.source } : {}),
            running: p.active ? `since ${p.active.since}` : "not started",
            items: p.items.map((i) => ({
              item: i.label,
              ...(i.amount ? { amountTheyWrote: i.amount } : {}),
              type: i.category,
              when: i.when,
              ...(i.note ? { note: i.note } : {}),
              ...(nutrientFor(i, nutrients) ? { nutrient: nutrientFor(i, nutrients)!.name, euReferenceForThisPerson: dailyReference(nutrientFor(i, nutrients)!, { sex: s.profile.sex, age: s.profile.birthMonth ? ageAt(s.profile.birthMonth, todayIso()) : undefined }) } : {}),
            })),
            interactionsBetweenItems: pairWarnings(p, nutrients),
          })),
        };
      },
    }),
    propose_protocol: tool({
      description:
        "Set up a protocol from text the person gave you (a pasted routine, a list of what they take or do). It shows a card in the chat that they check and create; nothing is saved until they do. Copy their items, times and amounts exactly as written: never add items, amounts or advice of your own, and leave amount empty when they gave none. Conditions such as 'only if deficient' go in the item's note. Use 'any time' when no time fits, with the timing in the note (e.g. 'Before a workout').",
      inputSchema: z.object({
        name: z.string().describe("The person's name for it, or a short one from their text"),
        description: z.string().optional(),
        source: z.string().optional().describe("Where it comes from, if they said"),
        items: z
          .array(
            z.object({
              label: z.string().describe("Item as they wrote it, e.g. 'Vitamin D3 + K2'"),
              amount: z.string().optional().describe("Only if they wrote one, e.g. '2000 IU'"),
              category: z.enum(["supplement", "diet", "medication", "lifestyle"]),
              when: z.enum(PLAN_TIMES as unknown as [PlanTime, ...PlanTime[]]),
              note: z.string().optional(),
            }),
          )
          .min(1)
          .max(60),
      }),
      execute: async (input) => {
        if (resultsOverview(s).critical.length > 0) return { error: "Not while a result is critical: the person should contact a doctor first." };
        const r = planFromProposal(input, () => crypto.randomUUID(), new Date().toISOString());
        if (!r.ok) return { error: r.error };
        const { nutrients } = knowledge();
        return {
          shownToPerson: { name: r.plan.name, items: r.plan.items.length },
          interactionsBetweenItems: pairWarnings(r.plan, nutrients),
          note: "A card is shown in the chat. Nothing is saved until the person creates it; they can edit it afterwards on the Protocols page.",
        };
      },
    }),
    find_foods: tool({
      description:
        "Search the UK food table (CoFID 2021, 2,887 foods) by name. Returns food ids for propose_meal, with energy and protein per 100 g. Use plain words (e.g. porridge oats, salmon grilled, onions raw); try simpler words if nothing matches. Prefer the cooked form when a recipe weighs cooked food.",
      inputSchema: z.object({ query: z.string().min(2).max(80) }),
      execute: async ({ query }) => {
        const db = foods();
        const e = db.keys.indexOf("energyKcal");
        const p = db.keys.indexOf("protein");
        return {
          foods: searchFoods(db, query, 10).map((f) => {
            const row = db.foods.find((x) => x[0] === f.id)!;
            return { id: f.id, name: f.name, per100g: { kcal: row[2][e], proteinG: row[2][p] } };
          }),
        };
      },
    }),
    propose_meal: tool({
      description:
        "Write down a meal from a recipe or description the person gave you, as foods from find_foods with grams. It shows a card in the chat with the app's own totals; they check it and save it. Use the person's amounts; when they gave none, use a typical portion and say so in your answer. Never present a meal as best, complete or a diet plan, and set no targets.",
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        items: z.array(z.object({ foodId: z.string(), grams: z.number().positive().max(2000) })).min(1).max(40),
        note: z.string().max(1000).optional(),
      }),
      execute: async (input) => {
        const db = foods();
        const errs = validateMeal({ ...input, id: "x", createdAt: "x" }, db);
        if (errs.length) return { error: `${errs[0]}. Look the food up with find_foods.` };
        const t = mealTotals(input.items, db);
        const shown = Object.fromEntries(["energyKcal", "protein", "fat", "carbohydrate", "fibre"].map((k) => [k, Math.round(t[k]!.amount * 10) / 10]));
        return {
          shownToPerson: { name: input.name, foods: input.items.length },
          appTotals: shown,
          note: "A card is shown in the chat with the full totals. Nothing is saved until the person saves it. Report these totals rather than calculating your own.",
        };
      },
    }),
    get_meals: tool({
      description:
        "The meals the person built (foods and grams), with the app's own totals of energy, macros, vitamins and minerals, and how many foods each total covers. Report these numbers; don't calculate your own.",
      inputSchema: z.object({}),
      execute: async () => {
        const db = foods();
        return {
          meals: (s.meals ?? []).map((m) => {
            const t = mealTotals(m.items, db);
            return {
              name: m.name,
              foods: m.items.map((i) => `${db.foods.find((f) => f[0] === i.foodId)?.[1] ?? i.foodId}: ${i.grams} g`),
              totals: Object.fromEntries(
                db.keys.map((k) => [k, `${Math.round(t[k]!.amount * 100) / 100} ${db.nutrients[k]!.unit}${t[k]!.measuredIn < t[k]!.of ? ` (measured in ${t[k]!.measuredIn} of ${t[k]!.of} foods)` : ""}`]),
              ),
            };
          }),
          note: "Only the nutrients the food table measured (about 30). Food has many more compounds that are not tracked (nutritional dark matter).",
        };
      },
    }),
    get_nutrient: tool({
      description:
        "The app's research-based entry for a vitamin or mineral: what it does, how status is measured, who runs low, food sources, supplement forms, graded findings from supplement trials (and separately from foods) with study IDs, EFSA reference intakes and upper limit (population values, never a personal dose), interactions and cautions. Use it for any question about a vitamin, mineral or supplement of one.",
      inputSchema: z.object({ nutrient: z.string().describe("Name or id, e.g. vitamin D, iron, magnesium") }),
      execute: async ({ nutrient }) => {
        const n = findNutrient(nutrient);
        if (!n) return { error: `No entry for "${nutrient}". Entries: ${knowledge().nutrients.map((x) => x.name).join(", ")}.` };
        const cite = (c: { pmid?: string; doi?: string; title: string; year: number; studyType: string }) => ({ id: c.pmid ? `PMID:${c.pmid}` : `DOI:${c.doi}`, title: c.title, year: c.year, type: c.studyType });
        const finding = (f: (typeof n.findings)[number]) => ({ outcome: f.outcome, studiedIn: f.population, effect: f.effect, grade: f.grade, whyThisGrade: f.whyThisGrade, summary: f.summary, studies: f.studies.map(cite) });
        return {
          ...n,
          reference: { ...n.reference, note: "EFSA population values for healthy adults. Not a target or a dose for this person.", sources: n.reference.sources.map(cite) },
          findings: n.findings.map(finding),
          ...(n.foodFindings ? { foodFindings: n.foodFindings.map(finding) } : {}),
          sources: n.sources.map(cite),
          safetyNotesFromLog: safetyOf(s).filter((id) => n.interactions.some((x) => x.safetyId === id)),
        };
      },
    }),
    get_biological_age: tool({
      description: "PhenoAge for each blood test that had all 9 markers, computed by the app.",
      inputSchema: z.object({}),
      execute: async () => biologicalAge(s),
    }),
    get_log: tool({
      description:
        "The person's Habits (the app's Habits page): supplements, diet changes, medicines and lifestyle habits with start and end dates, which markers each one watches, and the safety notes they trigger. Call them habits when you talk to the person.",
      inputSchema: z.object({}),
      execute: async () => ({
        habits: s.protocols.map((p) => {
          const watch = s.experiments.find((e) => e.protocolId === p.id);
          return { label: p.label, type: p.category, start: p.start, end: p.end ?? "ongoing", ...(watch ? { watches: watch.markerIds } : {}) };
        }),
        safetyNotes: safetyNotes(safetyLabels(s.protocols, s.profile)).map((n) => `${n.title}: ${n.text}`),
      }),
    }),
    compare_before_after: tool({
      description:
        "What changed for habits that watch markers (the \"What changed\" part of Habits): before, after, the change, and whether it is bigger than normal test-to-test variation.",
      inputSchema: z.object({}),
      execute: async () => ({ experiments: experimentResults(s), today: todayIso() }),
    }),
    propose_habit: tool({
      description:
        "Suggest adding a habit to the person's Habits. It shows a card in the chat that the person checks, edits and confirms; nothing is saved until they do. Use it only when the person asks to log, track or try something, or agrees when you ask. Never for medicines, never with an amount or dose in the name, and not while a result is critical. Optionally watch up to 5 markers it could change.",
      inputSchema: z.object({
        label: z.string().describe("Short name without amounts, e.g. 'Oats for breakfast', 'Walk after dinner', 'Vitamin D supplement'"),
        category: z.enum(["supplement", "diet", "lifestyle"]),
        start: z.string().optional().describe("YYYY-MM-DD; default today. Up to a year ahead for a planned change."),
        watchMarkers: z.array(z.string()).max(5).optional().describe("Marker names or ids to watch, e.g. ['ldl']"),
        reason: z.string().describe("One or two plain sentences the person reads on the card"),
      }),
      execute: async (input) => {
        if (resultsOverview(s).critical.length > 0) return { error: "Not while a result is critical: the person should contact a doctor first." };
        const r = parseHabitProposal(input, knowledge().defs, todayIso());
        if (!r.ok) return { error: r.error };
        return {
          shownToPerson: r.proposal,
          ...(r.unknownMarkers.length ? { markersNotFound: r.unknownMarkers } : {}),
          note: "A card is shown in the chat. Nothing is saved until the person confirms it; tell them they can edit it first.",
        };
      },
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
    get_study: tool({
      description:
        "Look up one study by its ID (PMID:…, PMCID:… or DOI:…) on Europe PMC: title, journal, year, study type and abstract. Use it when the user asks about a specific paper.",
      inputSchema: z.object({ id: z.string().max(220).describe("e.g. PMID:12345678") }),
      execute: async ({ id }) => {
        const p = await paperById(id, (u, i) => fetchFn(u, i), AbortSignal.timeout(20_000));
        if (!p) return { error: "No study with that ID was found on Europe PMC." };
        return {
          studies: [{ id: p.id, title: p.title, year: p.year ?? null, type: p.kind, journal: p.journal ?? null, authors: p.authors ?? null, freeFullText: p.openAccess, abstract: p.abstract?.slice(0, 4000) ?? null }],
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
