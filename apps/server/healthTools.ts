// The assistant's built-in tools. Every number comes from the tested core (packages/shared/src/core);
// the model only explains. Tools work on the snapshot the page sends with each question.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { parseBackup } from "@bt/shared/core/backup";
import { todayIso } from "@bt/shared/core/dates";
import { selectLevers } from "@bt/shared/core/evidence";
import { analyzeMarker, rcvBand, retestDate } from "@bt/shared/core/experiments";
import { SAFETY_LIMITS, selectFoods } from "@bt/shared/core/foods";
import { chanceNote, pickedAfterResults } from "@bt/shared/core/habits";
import { ageAt, isBirthMonth, summarizePhenoAge } from "@bt/shared/core/phenoageDraws";
import { assistantProfile } from "@bt/shared/core/profile";
import { completeProfileDetails, PROFILE_DETAIL_FIELDS } from "@bt/shared/core/profileCompletion";
import { proposalIssue } from "@bt/shared/core/assistantProposal";
import { safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import { personalRange } from "@bt/shared/core/personalRange";
import { computeTrend, flagLatest, flagMeasurement, groupByBiomarker, isCritical, recentAverage, resolveRange, sortByDate } from "@bt/shared/core/trends";
import { buildTestSummary, rangeText, valueText, type SummaryResult } from "@bt/shared/core/testSummary";
import { CATEGORY_ORDER } from "@bt/shared/core/knowledge";
import { buildPeriodSummary } from "@bt/shared/core/periodSummary";
import { roundForDisplay } from "@bt/shared/core/units";
import type { BiomarkerDef, Experiment, Measurement, Profile, ProtocolEntry, SafetyId } from "@bt/shared/core/types";
import { markerTerms, paperById, searchPapers, type SearchFilter } from "@bt/shared/research/papers";
import { bodySummary } from "@bt/shared/core/bodySummary";
import { parseHabitProposal } from "@bt/shared/core/habitProposal";
import { MAX_PROPOSED_RESULTS, parseResultProposal } from "@bt/shared/core/importers/resultProposal";
import { PLAN_TIMES, WEEKDAYS, nutrientFor, pairWarnings, planFromProposal, validatePlan, type Plan, type PlanTime, type Weekday } from "@bt/shared/core/plans";
import { closestFoods, dailyReference, foodNameNote, mealSafetyBlock, mealTotals, searchFoods, validateMeal, type Meal } from "@bt/shared/core/meals";
import { findLifestyle, findMarker, findNutrient, findWholeFood, foods, knowledge } from "./knowledge";
import { enabledSkills, getSkill } from "./skills";
import { phenoAgePace } from "@bt/shared/core/agePace";
import { ageAtMoment, bestBefore, bestBeforeMoments, lifeTablePeriod, populationSurvival, tableFor, type ResolvedLifeTable } from "@bt/shared/core/lifeTable";
import { mortalityProjection } from "@bt/shared/core/mortalityProjection";
import { lifeTables, mortalityModels } from "./knowledge";

export interface HealthSnapshot {
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
  profile: Profile;
  /** Protocols the person wrote (Protocols page). */
  plans?: Plan[];
  /** Meals the person built (foods and grams). */
  meals?: Meal[];
  /** The expiration date is turned on in Settings (off by default). */
  expirationDate?: boolean;
  /** Explicit compatibility confirmation; all-day device active time is not silently treated as leisure exercise. */
  mortalityActivityIsLeisure?: boolean;
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
  return { ok: true, snapshot: { measurements, protocols, experiments, profile: assistantProfile(profile), plans: plans as Plan[], meals: meals as Meal[], expirationDate: o.expirationDate === true, mortalityActivityIsLeisure: o.mortalityActivityIsLeisure === true } };
}

const r = (n: number | undefined) => (n === undefined ? undefined : roundForDisplay(n));

function rangeOut(range: { low?: number; high?: number; source: string; comparisonOnly?: boolean } | undefined) {
  return range ? { low: r(range.low), high: r(range.high), source: range.comparisonOnly ? "published population comparison" : range.source === "lab" ? "lab's own range" : "typical adult range", ...(range.comparisonOnly ? { comparisonOnly: true, note: "For comparison only, not clinical low/high limits or minimum/maximum healthy body fat." } : {}) } : null;
}

export function safetyOf(s: HealthSnapshot): SafetyId[] {
  return safetyNotes(safetyLabels(s.protocols, s.profile)).map((n) => n.id);
}

const WHOLE_PROTOCOL_COMPARISON = "The whole protocol is one change; changes cannot be attributed to one included item.";

/** The same started-habit details for tool callers and agents without tools; source plans may change. */
export function logOverview(s: HealthSnapshot) {
  return {
    habits: s.protocols.map((p) => {
      const watch = s.experiments.find((e) => e.protocolId === p.id);
      return {
        label: p.label,
        type: p.category,
        start: p.start,
        end: p.end ?? "ongoing",
        ...(p.plan ? { plan: p.plan, comparisonScope: WHOLE_PROTOCOL_COMPARISON } : {}),
        ...(watch ? { watches: watch.markerIds } : {}),
      };
    }),
    safetyNotes: safetyNotes(safetyLabels(s.protocols, s.profile)).map((n) => `${n.title}: ${n.text}`),
  };
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
    ...(p.country ? { country: p.country } : {}),
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
  const pace = phenoAgePace(sum.draws.filter((d) => d.status === "ok" && d.phenoAge !== undefined).map((d) => ({ date: d.date, years: d.phenoAge!, approximate: d.approximate.length > 0 })));
  const dunedin = s.measurements.filter((m) => m.biomarkerId === "dunedinpace").sort((a, b) => a.date.localeCompare(b.date));
  const reference = populationTableFor(s);
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
    phenoAgePace: pace
      ? {
          pace: Math.round(pace.pace * 100) / 100,
          likelyRange: [Math.round(pace.low * 100) / 100, Math.round(pace.high * 100) / 100],
          verdict: pace.verdict,
          tests: pace.tests,
          from: pace.from,
          to: pace.to,
          about: "Computed by the app: PhenoAge years per calendar year across this person's own tests in the last 3 years (slope, 95% range). 1.0 = in step with the calendar. Not DunedinPACE. Say 'unclear' when the range includes 1.",
        }
      : "Needs at least 3 PhenoAge results over a year or more.",
    dunedinPace: dunedin.length
      ? {
          results: dunedin.map((m) => ({ date: m.date, value: m.value })),
          about: "DunedinPACE (Belsky et al., eLife 2022, PMID 35029144): a DNA methylation blood test from a specialised lab, recorded as the lab reported it. 1.0 = one year of biological aging per calendar year. Linked with illness, disability and mortality in studies; a lower value doesn't prove aging was slowed.",
        }
      : "No DunedinPACE result recorded (it needs a DNA methylation test, not a routine blood test).",
    countryPopulationReference: typeof reference === "string" ? reference : countryPopulationReference(reference),
    expirationDate: !s.expirationDate
      ? "Turned off in Settings (it's off by default). Don't estimate it or a date of death; say it can be turned on in Settings → Appearance if the person asks."
      : typeof reference === "string" ? reference : bestBeforeFor(s, reference),
  };
}

interface PopulationTable {
  found: ResolvedLifeTable;
  currentAge: number;
  note: string;
}

/** Resolve genuine missing inputs once, independently of the exact-date preference. */
function populationTableFor(s: HealthSnapshot): PopulationTable | string {
  const p = s.profile;
  if (!p.birthMonth || !isBirthMonth(p.birthMonth)) return "Needs the person's valid month and year of birth.";
  const currentAge = ageAtMoment(p.birthMonth, Date.parse(`${todayIso()}T00:00:00Z`));
  if (!(currentAge >= 0)) return "Month and year of birth cannot be in the future.";
  const file = lifeTables();
  if (!file) return "The country life tables could not be loaded or validated; no population statistics are guessed.";
  const country = p.country ? file.countries[p.country] : undefined;
  if (!country) return "Needs a supported country the person lives in (Settings → Your data), for its population life table.";
  const found = tableFor(file, p.country, p.sex);
  if (!found) return !p.sex
    ? `Needs the person's sex in Settings; ${country.name} has no both-sex life table. The saved country does not need changing.`
    : `No life table is available for the saved sex in ${country.name}; no other sex's figures are substituted.`;
  return { found, currentAge, note: file.note };
}

/** Public conditional survival only: no fitted model, shifted age or calendar death dates. */
function countryPopulationReference({ found, currentAge, note }: PopulationTable) {
  const population = bestBefore(found.table, currentAge);
  return {
    country: found.country,
    countryName: found.name,
    sex: found.sex,
    currentAge,
    source: found.source,
    medianAge: population.median,
    middleHalfAges: [population.quarter, population.threeQuarters],
    averageRemainingYears: population.expectancy,
    survivalByAge: populationSurvival(found.table, currentAge),
    limits: [
      "Conditional on being alive at the current calendar age, using this country's period death rates. These are population statistics, not a personal prediction, risk percentile or individual confidence interval.",
      "Period life tables hold the reporting period's death rates constant; they do not predict future changes in mortality.",
      "Past age 95, survival uses an exponential tail approximation based on the source's remaining life expectancy at 95.",
      note,
    ],
  };
}

/** Opt-in exact-date/experimental figures; never called when expiration dates are off. */
function bestBeforeFor(s: HealthSnapshot, { found }: PopulationTable) {
  const p = s.profile;
  const today = todayIso();
  const models = mortalityModels();
  const projection = models ? mortalityProjection(found.table, p, s.measurements, today, models, s.mortalityActivityIsLeisure === true) : undefined;
  const plain = projection?.plain ?? bestBeforeMoments(found.table, p.birthMonth!, today);
  const mine = projection?.adjusted;
  const head = mine ?? plain;
  const prediction = projection?.prediction;
  const selected = prediction?.model;
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {
    headline: mine ? "Experimental fitted-risk lifetime projection" : "Country population reference",
    medianDate: d(head.medianAt),
    aQuarterDieBefore: d(head.quarterAt),
    aQuarterLivePast: d(head.threeQuartersAt),
    averageRemainingYears: Math.round(head.expectancy * 10) / 10,
    populationReference: { medianDate: d(plain.medianAt), aQuarterDieBefore: d(plain.quarterAt), aQuarterLivePast: d(plain.threeQuartersAt) },
    fittedTenYearMortality: prediction?.status === "ok" && prediction.risk10 !== undefined && selected ? {
      percent: r(prediction.risk10 * 100),
      model: selected.label,
      version: models!.version,
      riskEquivalentAge: prediction.riskAgeBound ? `${prediction.riskAgeBound} the model's ${selected.ageFrom}–${selected.ageTo - 1} age range; no exact lifetime extrapolation` : r(prediction.riskAge),
      heldOutEvaluation: selected.evaluation,
      includedInputs: projection!.included,
      limits: models!.limitations,
    } : { notShown: prediction?.reasons ?? ["The offline-fitted models could not be loaded; no coefficients are guessed."] },
    notUsed: projection?.notUsed ?? [],
    assumptions: projection?.cautions ?? [],
    lifeTable: `${found.source.name}: ${found.name}, ${lifeTablePeriod(found.source.period)}, ${found.sex === "f" ? "women" : found.sex === "m" ? "men" : "both sexes"}`,
    source: found.source,
    about: "The country reference is a population life table, not this person's predicted death. A separately fitted US cohort score estimates ten-year all-cause mortality; it is not the original PhenoAge equation or heart-attack risk. The experimental lifetime projection reads the country table at a fitted risk-equivalent age and assumes that age gap persists. This transfer between countries and from ten years to lifetime has NOT been validated. The displayed date range is the middle half of the shifted population, NOT an individual confidence interval. HRV, DunedinPACE and functional tests have no weights in this model. Never invent weights, add years from separate studies, estimate a date when off, or say this is when the person will die.",
  };
}

export function experimentResults(s: HealthSnapshot) {
  const { defs } = knowledge();
  return s.experiments.map((e) => ({
    change: e.change,
    start: e.start,
    retestFrom: retestDate(e),
    ended: e.end ?? null,
    ...(s.protocols.some((p) => p.id === e.protocolId && p.plan) ? { comparisonScope: WHOLE_PROTOCOL_COMPARISON } : {}),
    chosenOn: e.chosenOn ?? null,
    pickedAfterResults: pickedAfterResults(e),
    interpretation: pickedAfterResults(e) ? "A hint, not a test: these markers were selected after follow-up results were available." : e.chosenOn ? "Markers were selected before follow-up results were available." : "When these markers were selected is not recorded.",
    caution: chanceNote(e.markerIds.length) ?? null,
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

/** The app's year summary (the page shows the same), compact for the model. */
export function yearSummaryFor(s: HealthSnapshot, year?: number) {
  const { defs } = knowledge();
  const today = todayIso();
  const t = buildPeriodSummary({ measurements: s.measurements, defs, profile: s.profile, categoryOrder: CATEGORY_ORDER, period: year ? { kind: "year", year, today } : { kind: "rolling", end: today } });
  const unit = (id: string) => defs.get(id)!.canonicalUnit;
  return {
    period: { from: t.from, to: t.to },
    comparedWith: t.previous,
    tests: t.tests,
    testsInPeriodBefore: t.previousTests,
    ...(t.tests.length === 0 ? { note: "No blood test in this period: only the last result of each marker and its age are known." } : {}),
    measured: t.groups.map((g) => ({
      category: g.category,
      markers: g.markers.map((m) => ({
        marker: m.id,
        name: m.name,
        results: m.results.map((x) => `${x.date}: ${valueText(x, unit(m.id))}`),
        outsideRange: m.outside,
        latestFlag: m.lastFlag,
        ...(m.versusBefore ? {
          versusBefore: {
            now: `${r(m.versusBefore.now)} ${unit(m.id)} (${m.versusBefore.nNow === 1 ? "one result" : `geometric mean of ${m.versusBefore.nNow}`})`,
            before: `${r(m.versusBefore.before)} ${unit(m.id)} (${m.versusBefore.beforeDate ? `last earlier result, ${m.versusBefore.beforeDate}` : m.versusBefore.nBefore === 1 ? "one result in the period before" : `geometric mean of ${m.versusBefore.nBefore} in the period before`})`,
            changePercent: r(m.versusBefore.changePercent),
            beyondNormalVariation: m.versusBefore.beyondNormalVariation ?? "unknown (no published or personal variation)",
          },
        } : { versusBefore: "nothing earlier to compare with" }),
        trend: m.trend
          ? { verdict: m.trend.verdict, percentPerYear: r(m.trend.percentPerYear), interval95: [r(m.trend.low), r(m.trend.high)], tests: m.trend.tests, since: m.trend.from }
          : "not enough results for a trend (needs 3 over a year or more)",
      })),
    })),
    notMeasured: t.notMeasured.map((n) => ({ name: n.name, last: `${n.last.date}: ${valueText(n.last, unit(n.id))}`, flag: n.lastFlag, monthsOld: n.monthsOld })),
    questionsForTheDoctor: t.questions,
    limits: t.limits,
    howToUse: "Explain these facts plainly. Say when a change can't be told apart from normal variation; never describe a trend that isn't returned, never fill in missing months, and never say what the person has, what causes it or what to take. A critical latest result comes first: contact a doctor. End with the questions for the doctor.",
  };
}

/** The app's summary of one blood test (the page shows the same), compact for the model. */
export function testSummaryFor(s: HealthSnapshot, date?: string) {
  const { defs, nutrients } = knowledge();
  const t = buildTestSummary({ measurements: s.measurements, defs, profile: s.profile, protocols: s.protocols, nutrients, categoryOrder: CATEGORY_ORDER, ...(date ? { date } : {}) });
  if (!t) return { error: "There are no blood tests yet." };
  const item = (x: SummaryResult) => {
    const unit = defs.get(x.id)!.canonicalUnit;
    return {
      marker: x.id,
      name: x.name,
      result: valueText(x.measurement, unit),
      flag: x.flag,
      range: rangeText(x.range, unit) ?? null,
      rangeFrom: x.range?.source ?? null,
      ...(x.meaning ? { whatItUsuallyMeans: x.meaning } : {}),
      ...(x.commonCauses.length ? { commonCauses: x.commonCauses } : {}),
      ...(x.previous ? { previous: { date: x.previous.date, result: `${r(x.previous.value)} ${unit}`, flag: x.previous.flag } } : {}),
      ...(x.change ? { change: x.change, beyondNormalVariation: x.beyondNormalVariation ?? "unknown (no published variation)" } : {}),
      ...(x.streak >= 2 ? { outsideOnTestsInARow: x.streak, since: x.streakFrom } : {}),
    };
  };
  return {
    date: t.date,
    otherTestDates: t.dates.filter((d) => d !== t.date),
    results: t.results,
    inRange: t.inRange,
    critical: t.critical.map(item),
    ...(t.critical.length ? { criticalNote: "Critical results come first: tell the person to contact a doctor (urgently if unwell) before any other commentary, and keep the rest brief." } : {}),
    outsideRange: t.outOfRange.map((g) => ({ category: g.category, results: g.items.map(item) })),
    backInRange: t.backInRange.map((x) => ({ name: x.name, result: valueText(x.measurement, defs.get(x.id)!.canonicalUnit), previous: x.previous!.date })),
    withoutRange: t.notAssessed.map((x) => x.name),
    thingsThatCanSkewResults: t.cautions.map((c) => ({ text: c.text, markers: c.markers, ...(c.habit ? { fromHabit: c.habit } : {}) })),
    questionsForTheDoctor: t.questions,
    limits: t.limits,
    howToUse: "Explain these facts in plain language. You may say which results are usually read together and what they measure, but never say what the person has, what is causing their results, or what to take; never change the app's flags or numbers. End with the questions for the doctor.",
  };
}

/** The built-in tools for one request. `fetchFn` is injected so tests can run without a network. */
export function healthTools(s: HealthSnapshot, fetchFn: typeof fetch = fetch, context: { userText?: string; requestText?: string; /** Photos or scanned pages came with the newest question. */ images?: boolean } = {}): ToolSet {
  const proposalContext = () => ({
    requestText: context.requestText ?? "",
    safety: safetyOf(s),
    critical: resultsOverview(s).critical.length > 0,
  });
  return {
    // Always offered, so the tool list is the same on every turn (prompt cache); it refuses without typed text.
    save_profile_details: tool({
        description: "Prepare missing profile details explicitly stated in the newest TYPED question. Copy literal first-person factual quotes, never document text, history, guesses, hypothetical facts or another person's details. Fills blank fields only; never name, notes or weight. Birth month needs an explicit month and year, never age alone. Call before get_body_summary when new height/sex/birth information is provided. The page saves after a successful reply, not this tool.",
        inputSchema: z.object({
          details: z.array(z.object({ field: z.enum(PROFILE_DETAIL_FIELDS), quote: z.string().min(1).max(2000) })).min(1).max(20),
        }),
        execute: async (input) => {
          if (!context.userText?.trim()) return { error: "Only details typed in the newest question can be saved, and this request has none. Nothing was prepared.", added: [] };
          const result = completeProfileDetails(s.profile, input, context.userText, todayIso());
          s.profile = result.profile;
          return {
            added: result.added.map((change) => change.field),
            rejected: result.rejected,
            person: personOf(s),
            note: "Prepared for the page to fill these fields if still blank after a successful answer. Not persisted yet.",
          };
        },
      }),
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
    get_test_summary: tool({
      description:
        "The app's summary of one blood test: critical results, results outside the range grouped by body system with what each usually means and common causes (from the app's marker files), change since the previous result judged against normal test-to-test variation, results back in range, results without a range, things that can skew readings (fasting, supplements in the log, photo-read values) and questions for the doctor. Use when asked to analyse, summarise or explain test results. Without a date: the latest test.",
      inputSchema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date of the test, e.g. 2026-09-29") }),
      execute: async ({ date }) => testSummaryFor(s, date),
    }),
    get_year_summary: tool({
      description:
        "The app's summary of a year of blood tests, for people who test a few times a year: per marker the results in the period, how many were outside the range, the period's results vs the period before (or the last earlier result) judged against normal test-to-test variation, a trend only with 3+ results over a year or more, markers not measured with the age of their last result, and doctor questions. Without a year: the last 12 months vs the 12 before.",
      inputSchema: z.object({ year: z.number().int().min(1900).max(2999).optional().describe("Calendar year, e.g. 2025") }),
      execute: async ({ year }) => yearSummaryFor(s, year),
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
        "The app's own calculations from body measurements: BMI, waist-to-height, basal metabolic rate (an estimate, never a target), heart age with 10-year cardiovascular risk (Framingham), recent averages of blood pressure, resting heart rate, resting HRV, blood oxygen and sleep, and fitness tests (push-ups, grip strength, chair rises, one-leg stand, walking speed, sit-and-rise) compared with published norms for age and sex. Use these numbers and comparisons; don't calculate them yourself.",
      inputSchema: z.object({}),
      execute: async () => bodySummary(s.profile, s.measurements, s.protocols, todayIso(), knowledge().defs, knowledge().fitness),
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
            items: p.items.map((i) => {
              const n = nutrientFor(i, nutrients);
              return {
                item: i.label,
                ...(i.amount ? { amountTheyWrote: i.amount } : {}),
                type: i.category,
                when: i.when,
                days: i.days?.length ? i.days : WEEKDAYS,
                withFood: i.withFood ?? false,
                ...(i.note ? { note: i.note } : {}),
                ...(n ? {
                  nutrient: n.name,
                  ...(n.researchStatus === "not-reviewed"
                    ? { researchStatus: n.researchStatus }
                    : { euReferenceForThisPerson: dailyReference(n, { sex: s.profile.sex, age: s.profile.birthMonth ? ageAt(s.profile.birthMonth, todayIso()) : undefined }) }),
                } : {}),
              };
            }),
            interactionsBetweenItems: pairWarnings(p, nutrients),
          })),
        };
      },
    }),
    propose_protocol: tool({
      description:
        "Show a protocol review card when asked to create one. intent 'record' copies the supplied routine, including only amounts/medicines present in the newest request. intent 'recommend' drafts requested suggestions without medicines, supplement doses or food amounts; general activity durations or frequency can be examples. No diet/supplement changes with safety flags. Unspecified timing is 'any time'; recorded withFood and days preserve the person's timing. Nothing is saved or started until confirmed. Never use while a result is critical.",
      inputSchema: z.object({
        intent: z.enum(["record", "recommend"]),
        name: z.string().describe("The person's name for a recorded routine, or a short name clearly marking a suggested example"),
        description: z.string().optional(),
        source: z.string().optional().describe("Where it comes from, if they said"),
        items: z
          .array(
            z.object({
              label: z.string().describe("For record, copy the person's item; for recommend, a plain food, supplement or activity name without medicines or doses"),
              amount: z.string().optional().describe("Record: only the person's supplied amount. Recommend: general activity duration/frequency examples only; never supplement doses or food amounts."),
              category: z.enum(["supplement", "diet", "medication", "lifestyle"]),
              when: z.enum(PLAN_TIMES as unknown as [PlanTime, ...PlanTime[]]),
              withFood: z.boolean().optional().describe("True when they said to take it with a meal or food"),
              days: z.array(z.enum(WEEKDAYS as unknown as [Weekday, ...Weekday[]])).optional().describe("Only when they named days of the week, e.g. ['mon','wed','fri']"),
              note: z.string().optional(),
            }),
          )
          .min(1)
          .max(60),
      }),
      execute: async (input) => {
        const issue = proposalIssue("protocol", input, proposalContext());
        if (issue) return { error: issue };
        const r = planFromProposal(input, () => crypto.randomUUID(), new Date().toISOString());
        if (!r.ok) return { error: r.error };
        const { nutrients } = knowledge();
        return {
          intent: input.intent,
          shownToPerson: { name: r.plan.name, items: r.plan.items.length },
          plan: r.plan,
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
        const withValues = (list: { id: string; name: string }[]) =>
          list.map((f) => {
            const row = db.foods.find((x) => x[0] === f.id)!;
            const note = foodNameNote(query, f.name);
            return { id: f.id, name: f.name, per100g: { kcal: row[2][e], proteinG: row[2][p] }, ...(note ? { note } : {}) };
          });
        const found = searchFoods(db, query, 10);
        if (found.length) return { foods: withValues(found) };
        // Not in the table: offer the closest foods, clearly as other foods (blood orange juice -> orange juice).
        return {
          foods: [],
          notInTable: `"${query}" isn't in the food table.`,
          closest: withValues(closestFoods(db, query, 6)),
          note: "These are different foods. Use one only if it's close enough, and tell the person which food you used instead of the one they named.",
        };
      },
    }),
    propose_meal: tool({
      description:
        "Show a meal review card from real find_foods ids and grams. intent 'record' writes down the person's recipe; intent 'recommend' drafts a requested meal example with portions clearly labelled as examples. Use code totals, not your calculations. Never a best/complete meal, calorie target or weight-loss plan. Recommended meals are checked against the person's food-safety limits; no proposal while a result is critical. Nothing saves until review.",
      inputSchema: z.object({
        intent: z.enum(["record", "recommend"]),
        name: z.string().min(1).max(80),
        items: z.array(z.object({ foodId: z.string(), grams: z.number().positive().max(2000) })).min(1).max(40),
        note: z.string().max(1000).optional(),
      }),
      execute: async (input) => {
        const issue = proposalIssue("meal", input, proposalContext());
        if (issue) return { error: issue };
        const db = foods();
        const errs = validateMeal({ ...input, id: "x", createdAt: "x" }, db);
        if (errs.length) return { error: `${errs[0]}. Look the food up with find_foods.` };
        if (input.intent === "recommend") {
          const limits = safetyOf(s).flatMap((id) => SAFETY_LIMITS[id] ? [SAFETY_LIMITS[id]!] : []);
          const block = mealSafetyBlock(input.items, db, limits);
          if (block) return { error: `Discuss this food change with your doctor: ${block}.` };
        }
        const t = mealTotals(input.items, db);
        const shown = Object.fromEntries(["energyKcal", "protein", "fat", "carbohydrate", "fibre"].map((k) => [k, Math.round(t[k]!.amount * 10) / 10]));
        return {
          intent: input.intent,
          shownToPerson: { name: input.name, foods: input.items.length },
          meal: { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() },
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
        "The app's entry for a vitamin, mineral or other supplement: description, forms, interactions and cautions. Basic guides have researchStatus 'not-reviewed' and commonUses describing purposes, not proven benefits; they have no graded findings. Other entries include graded supplement findings, separate food findings and EFSA population values, never personal doses. Use this for supplement questions and respect the entry's research status.",
      inputSchema: z.object({ nutrient: z.string().describe("Name or id, e.g. vitamin D, iron, magnesium") }),
      execute: async ({ nutrient }) => {
        const n = findNutrient(nutrient);
        if (!n) return { error: `No entry for "${nutrient}". Entries: ${knowledge().nutrients.map((x) => x.name).join(", ")}.` };
        const cite = (c: { pmid?: string; doi?: string; title: string; year: number; studyType: string }) => ({ id: c.pmid ? `PMID:${c.pmid}` : `DOI:${c.doi}`, title: c.title, year: c.year, type: c.studyType });
        const finding = (f: (typeof n.findings)[number]) => ({ outcome: f.outcome, studiedIn: f.population, effect: f.effect, grade: f.grade, whyThisGrade: f.whyThisGrade, summary: f.summary, studies: f.studies.map(cite) });
        return {
          ...n,
          reference: { ...n.reference, note: n.researchStatus === "not-reviewed" ? "This basic guide does not provide reference intakes or upper-limit values." : "EFSA population values for healthy adults. Not a target or a dose for this person.", sources: n.reference.sources.map(cite) },
          findings: n.findings.map(finding),
          ...(n.foodFindings ? { foodFindings: n.foodFindings.map(finding) } : {}),
          sources: n.sources.map(cite),
          safetyNotesFromLog: safetyOf(s).filter((id) => n.interactions.some((x) => x.safetyId === id)),
        };
      },
    }),
    get_whole_food: tool({
      description:
        "The app's research-based entry for a whole food (extra virgin olive oil, blueberries, strawberries, ginger, pomegranate…): what's in it (including compounds the food table doesn't measure), graded findings from studies of people eating it with study IDs, what processing changes, the numbers behind the page's charts, who should be careful, and what isn't known. Use it for questions about one of these foods. Keep food evidence apart from supplement evidence, and never turn what studies used into an amount for this person.",
      inputSchema: z.object({ food: z.string().describe("Name or id, e.g. olive oil, blueberries, ginger") }),
      execute: async ({ food }) => {
        const f = findWholeFood(food);
        if (!f) return { error: `No entry for "${food}". Entries: ${knowledge().wholeFoods.map((x) => x.name).join(", ")}. For nutrients per 100 g of any food, use find_foods.` };
        const cite = (c: { pmid?: string; doi?: string; title: string; year: number; studyType: string }) => ({ id: c.pmid ? `PMID:${c.pmid}` : `DOI:${c.doi}`, title: c.title, year: c.year, type: c.studyType });
        return {
          ...f,
          findings: f.findings.map((x) => ({ outcome: x.outcome, studiedIn: x.population, effect: x.effect, grade: x.grade, whyThisGrade: x.whyThisGrade, summary: x.summary, studies: x.studies.map(cite) })),
          visuals: f.visuals.map((v) => ({ ...v, sources: v.sources.map(cite) })),
          sources: f.sources.map(cite),
          safetyNotesFromLog: safetyOf(s).filter((id) => f.whoShouldBeCareful.some((x) => x.safetyId === id)),
        };
      },
    }),
    get_lifestyle: tool({
      description:
        "The app's research-based entry for a lifestyle habit (walking and steps, sleep, sauna, cold water, red light therapy…): how it's thought to work, what the studies had people do, graded findings with study IDs, the numbers behind the page's charts, who should be careful, and what isn't known. Use it for any question about one of these. Never turn what studies did into a plan or amount for this person.",
      inputSchema: z.object({ topic: z.string().describe("Name or id, e.g. sauna, walking, cold shower, red light") }),
      execute: async ({ topic }) => {
        const l = findLifestyle(topic);
        if (!l) return { error: `No entry for "${topic}". Entries: ${knowledge().lifestyle.map((x) => x.name).join(", ")}.` };
        const cite = (c: { pmid?: string; doi?: string; title: string; year: number; studyType: string }) => ({ id: c.pmid ? `PMID:${c.pmid}` : `DOI:${c.doi}`, title: c.title, year: c.year, type: c.studyType });
        return {
          ...l,
          findings: l.findings.map((f) => ({ outcome: f.outcome, studiedIn: f.population, effect: f.effect, grade: f.grade, whyThisGrade: f.whyThisGrade, summary: f.summary, studies: f.studies.map(cite) })),
          visuals: l.visuals.map((v) => ({ ...v, sources: v.sources.map(cite) })),
          sources: l.sources.map(cite),
          safetyNotesFromLog: safetyOf(s).filter((id) => l.whoShouldBeCareful.some((x) => x.safetyId === id)),
        };
      },
    }),
    get_biological_age: tool({
      description: "App-computed PhenoAge history and pace, recorded DunedinPACE, and (only when turned on) the country life-table reference and experimental jointly fitted mortality projection, with included/excluded inputs, held-out calibration and limits. Never invent missing weights or a date when off.",
      inputSchema: z.object({}),
      execute: async () => biologicalAge(s),
    }),
    get_log: tool({
      description:
        "The person's Habits: supplements, diet changes, medicines, lifestyle habits and whole protocols with start/end dates, the items and amounts they wrote when each protocol started, watched markers and safety notes. A protocol's snapshot here is authoritative for what started, even if its source was edited or deleted. Comparisons concern the whole routine, not an individual item's effect. Call them habits.",
      inputSchema: z.object({}),
      execute: async () => logOverview(s),
    }),
    compare_before_after: tool({
      description:
        "What changed for habits that watch markers (the \"What changed\" part of Habits): before, after, the change, and whether it is bigger than normal test-to-test variation.",
      inputSchema: z.object({}),
      execute: async () => ({ experiments: experimentResults(s), today: todayIso() }),
    }),
    propose_habit: tool({
      description:
        "Show a habit review card for an explicit logging/tracking request (intent 'record') or requested recommendations (intent 'recommend'). Never medicines or amounts/doses, never unsolicited supplement ideas, never while a result is critical. With safety flags, do not recommend diet/supplement changes; safe lifestyle examples can remain. Watch up to 5 markers; nothing is saved or started before review.",
      inputSchema: z.object({
        intent: z.enum(["record", "recommend"]),
        label: z.string().describe("Short name without amounts, e.g. 'Oats for breakfast', 'Walk after dinner', 'Vitamin D supplement'"),
        category: z.enum(["supplement", "diet", "lifestyle"]),
        start: z.string().optional().describe("YYYY-MM-DD; default today. Up to a year ahead for a planned change."),
        watchMarkers: z.array(z.string()).max(5).optional().describe("Marker names or ids to watch, e.g. ['ldl']"),
        reason: z.string().describe("One or two plain sentences the person reads on the card"),
      }),
      execute: async (input) => {
        const issue = proposalIssue("habit", input, proposalContext());
        if (issue) return { error: issue };
        const r = parseHabitProposal(input, knowledge().defs, todayIso());
        if (!r.ok) return { error: r.error };
        return {
          intent: input.intent,
          shownToPerson: r.proposal,
          ...(r.unknownMarkers.length ? { markersNotFound: r.unknownMarkers } : {}),
          note: "A card is shown in the chat. Nothing is saved until the person confirms it; tell them they can edit it first.",
        };
      },
    }),
    // Always offered (the same tool list every turn); it refuses without pictures in the newest question.
    propose_results: tool({
      description:
        "Show a review card of the results you read from the photos or scanned pages sent with the newest question: a lab report, a health app screen, a blood pressure monitor, a scale. One entry per result. Copy each value, unit and range exactly as printed; never calculate, convert, round or guess, and leave out anything you can't read clearly. The app matches units and flags doubtful values; nothing is saved until the person checks every value against the picture and presses Save. Then answer briefly; don't list every value again.",
      inputSchema: z.object({
        date: z.string().optional().describe("The sample or measurement date printed on the picture, as YYYY-MM-DD. Leave out when none is printed."),
        results: z.array(z.object({
          marker: z.string().describe(`The app's marker id (its name in brackets; one marker covers every lab's name for the test): ${[...knowledge().defs.values()].map((d) => `${d.id} (${d.name})`).sort().join(", ")}. Results for other tests: leave them out.`),
          printed: z.string().optional().describe("The result's line as printed (name, value, unit, range), shown on the card"),
          value: z.string().describe("As printed, e.g. '5,4', '<0.3', '8,120', '7 h 12 min'"),
          unit: z.string().optional().describe("As printed, e.g. 'µmol/L', 'G/l', 'lbs'"),
          rangeLow: z.string().optional().describe("Lower end of the printed reference range"),
          rangeHigh: z.string().optional().describe("Upper end of the printed reference range"),
        })).min(1).max(MAX_PROPOSED_RESULTS),
      }),
      execute: async (input) => {
        if (!context.images) return { error: "This only shows results read from photos or scanned pages sent with the newest question, and it has none. Values the person types are saved by the app itself." };
        const r = parseResultProposal(input, knowledge().defs, todayIso());
        if (!r.ok) return { error: r.error };
        const toCheck = r.report.rows.filter((row) => row.problems.length > 0);
        return {
          shownToPerson: r.proposal,
          resultsOnCard: r.report.rows.length,
          ...(toCheck.length ? { needsChecking: toCheck.map((row) => ({ marker: row.biomarkerId, problems: row.problems })) } : {}),
          ...(r.unknownMarkers.length ? { notTrackedByTheApp: r.unknownMarkers } : {}),
          ...(r.report.dateNote ? { dateNote: r.report.dateNote } : {}),
          note: "A review card is shown in the chat. Nothing is saved until the person checks each value against the picture and saves. Rows with problems start unticked.",
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
