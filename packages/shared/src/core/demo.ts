/**
 * A made-up example profile for trying and showing the app. Every number is invented: it is not
 * anyone's data. The results tell a few stories the app can show: low ferritin that recovers after
 * an iron supplement, vitamin D that dips in winter until D3 is started, and LDL that falls during a
 * diet experiment. Same input date, same data (a seeded random generator adds small wobbles).
 */
import { type CheckIn, checkInId, itemsOn } from "./checkIns";
import { addDays, isIsoDate } from "./dates";
import type { Meal } from "./meals";
import type { Plan, PlanItem } from "./plans";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "./types";

export interface DemoData {
  person: Profile;
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
  plans: Plan[];
  meals: Meal[];
  /** What the example person ticked off on Today, over the last weeks. */
  checkins: CheckIn[];
}

/** Canonical units of the markers used here (a test checks them against the knowledge base). */
export const DEMO_UNITS: Record<string, string> = {
  albumin: "g/L",
  creatinine: "µmol/L",
  glucose: "mmol/L",
  crp_hs: "mg/L",
  lymphocyte_pct: "%",
  mcv: "fL",
  rdw: "%",
  alp: "U/L",
  wbc: "10^9/L",
  hemoglobin: "g/L",
  platelets: "10^9/L",
  ferritin: "µg/L",
  vitamin_d: "nmol/L",
  ldl: "mmol/L",
  hdl: "mmol/L",
  total_cholesterol: "mmol/L",
  triglycerides: "mmol/L",
  hba1c: "%",
  tsh: "mIU/L",
  b12: "pmol/L",
  alt: "U/L",
  weight: "kg",
  waist: "cm",
  body_fat: "%",
  bp_systolic: "mmHg",
  bp_diastolic: "mmHg",
  resting_hr: "bpm",
  glucose_home: "mmol/L",
  heart_rate: "bpm",
  exercise_hr: "bpm",
  hrv: "ms",
  hrv_resting: "ms",
  spo2: "%",
  sleep_duration: "h",
  sleep_deep: "h",
  sleep_rem: "h",
  vo2max: "mL/kg/min",
  steps: "steps",
  active_minutes: "min",
  dunedinpace: "years/year",
  pushups: "reps",
  grip_strength: "kg",
  sit_to_stand_5x: "s",
  chair_stand_30s: "reps",
  one_leg_stand: "s",
  gait_speed: "m/s",
  sitting_rising: "points",
};

/** Small, repeatable random numbers (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const decimals = (step: number) => (step >= 1 ? 0 : String(step).split(".")[1]!.length);

export const DEMO_BODY_IDS: readonly string[] = [
  "weight",
  "waist",
  "body_fat",
  "bp_systolic",
  "bp_diastolic",
  "resting_hr",
  "heart_rate",
  "exercise_hr",
  "hrv",
  "hrv_resting",
  "spo2",
  "glucose_home",
  "sleep_duration",
  "sleep_deep",
  "sleep_rem",
  "vo2max",
  "steps",
  "active_minutes",
  "pushups",
  "grip_strength",
  "sit_to_stand_5x",
  "chair_stand_30s",
  "one_leg_stand",
  "gait_speed",
  "sitting_rising",
];
const BODY_IDS = new Set(DEMO_BODY_IDS);
/** Days of nightly watch data (sleep, HRV) before today. */
const NIGHTLY_DAYS = 70;

/**
 * Only the example's body measurements, for example profiles made before body measurements existed.
 * The app adds these to example profiles only, never to a real person's.
 */
export function demoBodyMeasurements(today: string): Measurement[] {
  return demoProfile(today).measurements.filter((m) => BODY_IDS.has(m.biomarkerId));
}

const EXAMPLE_NIGHTLY_FIELDS: Record<string, true | undefined> = {
  sleep_duration: true,
  hrv: true,
  hrv_resting: true,
  steps: true,
  active_minutes: true,
};

/** Upgrade only untouched, recognizable fictional watch readings from an older example. */
export function exampleSleepUpdates(profile: Profile, measurements: readonly Measurement[]): Measurement[] {
  if (profile.example !== true) return [];
  const originalWatch = measurements.filter(
    (m) =>
      /^example-\d+$/.test(m.id) &&
      EXAMPLE_NIGHTLY_FIELDS[m.biomarkerId] &&
      m.source === "device" &&
      isIsoDate(m.date) &&
      m.originalUnit === DEMO_UNITS[m.biomarkerId] &&
      m.originalValue === m.value &&
      m.qualifier === undefined &&
      m.note === undefined &&
      m.lab === undefined &&
      m.labRange === undefined &&
      m.fasted === undefined,
  );
  const watch = originalWatch.filter(
    (m) => m.biomarkerId === "sleep_duration" && (m.sleepSessions === undefined || m.sleepSessions.every((session) => session.source === "Example watch")),
  );
  if (!watch.length) return [];
  const last = originalWatch.reduce((latest, m) => (m.date > latest ? m.date : latest), watch[0]!.date);
  const original = demoProfile(addDays(last, 1)).measurements;
  const expected = new Map(original.filter((m) => m.biomarkerId === "sleep_duration" && m.source === "device").map((m) => [m.date, m]));
  const dates = new Set<string>();
  const updates: Measurement[] = [];
  for (const m of watch) {
    const match = expected.get(m.date);
    if (!match || m.value !== match.value) continue;
    dates.add(m.date);
    if (m.sleepSessions === undefined) updates.push({ ...m, sleepSessions: match.sleepSessions });
  }
  const restingDates = new Set(measurements.filter((m) => m.biomarkerId === "resting_hr").map((m) => m.date));
  for (const m of original) {
    if (m.id.startsWith("example-sleep-rhr-") && dates.has(m.date) && !restingDates.has(m.date)) updates.push(m);
  }
  return updates;
}

export function demoProfile(today: string): DemoData {
  const rand = seeded(20240512);
  /** A value with a little natural wobble (± pct), rounded like a lab prints it. */
  const wobble = (v: number, pct: number, step: number) => Number(round(v * (1 + (rand() * 2 - 1) * pct), step).toFixed(decimals(step)));

  const person: Profile = {
    name: "Sam (example)",
    example: true,
    sex: "f",
    birthMonth: "1979-03",
    heightCm: 168,
    diet: "omnivore",
    smoking: "never",
    country: "AT",
    notes: "Made-up example data to show how the app works. None of these results belong to a real person.",
  };

  // Ten blood tests, about six months apart, the last one a month ago.
  const draws = Array.from({ length: 10 }, (_, i) => addDays(today, -30 - (9 - i) * 182));
  const walkStart = addDays(draws[1]!, 40);
  const measurements: Measurement[] = [];
  let n = 0;
  const add = (date: string, biomarkerId: string, value: number, extra: Partial<Measurement> = {}) => {
    n += 1;
    measurements.push({
      id: `example-${String(n).padStart(3, "0")}`,
      biomarkerId,
      date,
      value,
      originalValue: value,
      originalUnit: DEMO_UNITS[biomarkerId]!,
      source: "manual",
      lab: "Example Lab",
      ...extra,
    });
  };

  // The stories, one value per test.
  const ferritin = [24, 18, 13, 9, 21, 38, 49, 55, 52, 58];
  const hemoglobin = [129, 127, 123, 116, 124, 130, 132, 131, 133, 132];
  const mcv = [88, 87, 85, 82, 84, 87, 88, 89, 88, 89];
  const rdw = [13.0, 13.4, 14.1, 15.3, 14.6, 13.6, 13.2, 13.1, 13.0, 13.1];
  const ldl = [3.4, 3.5, 3.6, 3.7, 3.7, 3.8, 3.9, 3.2, 3.1, 3.1];
  const hba1c = [5.2, 5.2, 5.3, 5.3, 5.3, 5.4, 5.4, 5.4, 5.3, 5.4];
  const crp = [1.2, 0.9, 1.6, 1.1, 0.8, 0.7, 1.0, 0.6, 0.3, 0.5];
  const d3Start = addDays(draws[5]!, 12);

  draws.forEach((date, i) => {
    const month = Number(date.slice(5, 7));
    const winter = month <= 3 || month === 12 || month === 11;
    const onD3 = date > d3Start;
    // PhenoAge panel at every test, so biological age can be shown over time.
    add(date, "albumin", wobble(45, 0.03, 1));
    add(date, "creatinine", wobble(68, 0.05, 1));
    add(date, "glucose", wobble(5.0 + i * 0.03, 0.03, 0.1));
    // One test reports CRP below the detection limit, which the app marks as approximate.
    if (i === 8) add(date, "crp_hs", 0.3, { qualifier: "<" });
    else add(date, "crp_hs", crp[i]!);
    add(date, "lymphocyte_pct", wobble(31, 0.06, 1));
    add(date, "mcv", mcv[i]!);
    add(date, "rdw", rdw[i]!);
    add(date, "alp", wobble(64 + i * 0.8, 0.05, 1));
    add(date, "wbc", wobble(5.6, 0.08, 0.1));
    add(date, "hemoglobin", hemoglobin[i]!);
    add(date, "platelets", wobble(255, 0.06, 1));
    add(date, "ferritin", ferritin[i]!);
    add(date, "vitamin_d", wobble(winter ? (onD3 ? 68 : 41) : onD3 ? 84 : 66, 0.05, 1));
    add(date, "ldl", ldl[i]!);
    add(date, "hdl", wobble(1.55, 0.04, 0.01));
    add(date, "triglycerides", wobble(1.15, 0.08, 0.01));
    add(date, "total_cholesterol", Number((ldl[i]! + 1.55 + 0.5).toFixed(1)));
    add(date, "hba1c", hba1c[i]!);
    if (i % 2 === 0) {
      add(date, "tsh", wobble(1.9, 0.12, 0.01));
      add(date, "b12", wobble(390, 0.07, 1));
      add(date, "alt", wobble(19, 0.1, 1));
    }
  });

  // Two DunedinPACE results from a DNA methylation test of the same blood samples, sent to another lab:
  // the app records them, it doesn't calculate them.
  add(draws[5]!, "dunedinpace", 0.94, { lab: "Example DNA lab" });
  add(draws[7]!, "dunedinpace", 0.91, { lab: "Example DNA lab" });
  add(draws[9]!, "dunedinpace", 0.88, { lab: "Example DNA lab" });

  // The diet experiment: start two weeks after test 7. Three lipid tests before and three after, so the
  // change can be told apart from normal test-to-test variation estimated from the person's own results.
  const expStart = addDays(draws[6]!, 14);
  const lipids = (date: string, ldlValue: number) => {
    add(date, "ldl", ldlValue);
    add(date, "total_cholesterol", Number((ldlValue + 2.1).toFixed(1)));
    add(date, "hdl", wobble(1.56, 0.03, 0.01));
    add(date, "triglycerides", wobble(1.1, 0.06, 0.01));
  };
  lipids(addDays(expStart, -75), 3.8);
  lipids(addDays(expStart, -45), 3.8);
  lipids(addDays(expStart, 88), 3.2);
  lipids(addDays(expStart, 96), 3.1);
  lipids(addDays(expStart, 118), 3.2);

  // Body: measured at home about once a month for the last two years. Blood pressure and resting
  // heart rate drift down slowly; waist goes from just above to just below the usual limit.
  for (let k = 0; k < 24; k++) {
    const date = addDays(today, -7 - (23 - k) * 30);
    const t = k / 23;
    const body = (biomarkerId: string, value: number, extra: Partial<Measurement> = {}) => {
      n += 1;
      measurements.push({
        id: `example-${String(n).padStart(3, "0")}`,
        biomarkerId,
        date,
        value,
        originalValue: value,
        originalUnit: DEMO_UNITS[biomarkerId]!,
        source: "manual",
        ...extra,
      });
    };
    body("weight", wobble(68.8 - t * 1.2, 0.008, 0.1));
    body("body_fat", wobble(31 - t * 1.5, 0.02, 0.1));
    body("bp_systolic", Math.round(wobble(133 - t * 10, 0.02, 1)));
    body("bp_diastolic", Math.round(wobble(85 - t * 6, 0.025, 1)));
    body("resting_hr", Math.round(wobble(67 - t * 5, 0.03, 1)));
    if (k % 3 === 0) body("waist", wobble(82 - t * 3.5, 0.005, 0.5));
    // Home glucose: a fasting reading each month, an after-meal one every other month, all in range.
    body("glucose_home", wobble(5.0, 0.05, 0.1), { fasted: true });
    if (k % 2 === 1) body("glucose_home", wobble(6.6, 0.06, 0.1), { fasted: false });
    // From a watch (monthly values here; a synced watch would give one a day): heart rate eases and
    // HRV rises a little as fitness improves; blood oxygen stays normal.
    body("heart_rate", Math.round(wobble(76 - t * 4, 0.03, 1)));
    body("exercise_hr", Math.round(wobble(133 - t * 6, 0.025, 1)));
    // The last 10 weeks come from the watch every night (below).
    const nightly = date >= addDays(today, -NIGHTLY_DAYS);
    if (!nightly) body("hrv", Math.round(wobble(34 + t * 5, 0.08, 1)));
    if (!nightly) body("hrv_resting", Math.round(wobble(41 + t * 7, 0.07, 1)));
    body("spo2", Math.round(wobble(97, 0.008, 1)));
    // Sleep (a monthly sample night; a synced watch gives every night): a little longer over time.
    if (!nightly) body("sleep_duration", wobble(6.9 + t * 0.4, 0.05, 0.1));
    body("sleep_deep", wobble(1.1, 0.12, 0.1));
    body("sleep_rem", wobble(1.5, 0.1, 0.1));
    // Steps (a monthly sample day; a synced phone or watch gives every day): up once the walking habit
    // starts. Active minutes only come from the watch below: a week's total needs every day.
    const walking = date >= walkStart;
    if (!nightly) body("steps", wobble(walking ? 8300 : 5200, 0.12, 1));
    // VO2max from the watch: a little higher as the walking habit continues.
    body("vo2max", wobble(34 + t * 2.5, 0.02, 0.1));
    // Fitness tests at home every 8 months: a little stronger and steadier with the walking habit.
    // Push-ups from the knees (the CSEP norms for women).
    if (k % 8 === 7) {
      body("pushups", Math.round(11 + t * 4));
      body("grip_strength", wobble(27 + t * 2.5, 0.02, 1));
      body("sit_to_stand_5x", wobble(9.6 - t * 1.2, 0.02, 0.1));
      body("chair_stand_30s", Math.round(16 + t * 3));
      body("one_leg_stand", Math.round(38 + t * 16));
      body("gait_speed", wobble(1.22 + t * 0.1, 0.01, 0.01));
      body("sitting_rising", k === 23 ? 8.5 : k === 15 ? 8 : 7);
    }
  }

  // The last 10 weeks, every night from the watch: sleep and HRV vary night to night, so the app
  // judges sleep on a week's average and shows HRV against this person's own usual range.
  for (let d = NIGHTLY_DAYS; d >= 1; d--) {
    const date = addDays(today, -d);
    const night = (biomarkerId: string, value: number, extra: Partial<Measurement> = {}) => {
      n += 1;
      measurements.push({
        id: `example-${String(n).padStart(3, "0")}`,
        biomarkerId,
        date,
        value,
        originalValue: value,
        originalUnit: DEMO_UNITS[biomarkerId]!,
        source: "device",
        ...extra,
      });
    };
    const sleepHours = wobble(7.3, 0.08, 0.05);
    // Invented watch windows for this newly generated example only; preserve the existing hours
    // and random sequence. Real duration-only readings never get reconstructed this way.
    const wake = Date.parse(`${date}T07:00:00Z`) + ((((NIGHTLY_DAYS - d) * 13) % 61) - 30) * 60_000;
    night("sleep_duration", sleepHours, {
      sleepSessions: [
        {
          start: new Date(wake - Math.round(sleepHours * 3_600_000)).toISOString().slice(0, 19),
          end: new Date(wake).toISOString().slice(0, 19),
          kind: "asleep",
          source: "Example watch",
        },
      ],
    });
    night("hrv", Math.round(wobble(39, 0.25, 1)));
    night("hrv_resting", Math.round(wobble(48, 0.2, 1)));
    // Steps and active minutes every day: about 210 active minutes a week, above the WHO's 150.
    night("steps", wobble(8400, 0.25, 1));
    night("active_minutes", wobble(30, 0.45, 1));
  }

  // Fictional daily resting pulse makes the sleep comparison usable without inventing a relationship.
  const restingDates = new Set(measurements.filter((m) => m.biomarkerId === "resting_hr").map((m) => m.date));
  for (let i = 0; i < NIGHTLY_DAYS; i++) {
    const date = addDays(today, -NIGHTLY_DAYS + i);
    if (restingDates.has(date)) continue;
    const value = 60 + ((i * 7) % 9);
    measurements.push({
      id: `example-sleep-rhr-${date}`,
      biomarkerId: "resting_hr",
      date,
      value,
      originalValue: value,
      originalUnit: "bpm",
      source: "device",
      note: "Fictional example watch · resting heart rate",
    });
  }

  const protocols: ProtocolEntry[] = [
    {
      id: "example-log-iron",
      label: "Iron bisglycinate 25 mg every other day",
      category: "supplement",
      start: addDays(draws[3]!, 9),
      end: addDays(draws[5]!, 20),
    },
    // Vitamin D3 moved into "Supplements through the day" (below) when that protocol was started.
    { id: "example-log-d3", label: "Vitamin D3 1000 IU daily", category: "supplement", start: d3Start, end: addDays(today, -36) },
    // Walking more for years (the steps story); six weeks ago it became a set 30-minute walk, watched for body fat.
    { id: "example-log-walk", label: "Walking more", category: "lifestyle", start: walkStart, end: addDays(today, -43) },
    { id: "example-log-walk-30", label: "Walking 30 minutes a day", category: "lifestyle", start: addDays(today, -42) },
    { id: "example-log-fibre", label: "Oats and beans every day (more fibre)", category: "diet", start: expStart, end: addDays(expStart, 100) },
  ];
  const experiments: Experiment[] = [
    {
      id: "example-exp-fibre",
      change: "Oats and beans every day (more fibre)",
      category: "diet",
      markerIds: ["ldl", "total_cholesterol"],
      start: expStart,
      retestAfterDays: 84,
      end: addDays(expStart, 100),
      protocolId: "example-log-fibre",
    },
    {
      // Running: "before" from the monthly body-fat readings, the re-test due in two weeks (Coming up shows it).
      id: "example-exp-walk-fat",
      change: "Walking 30 minutes a day",
      category: "lifestyle",
      markerIds: ["body_fat"],
      start: addDays(today, -42),
      retestAfterDays: 56,
      protocolId: "example-log-walk-30",
      chosenOn: addDays(today, -42),
    },
  ];

  measurements.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  // A protocol the example person wrote down: their current routine, already running as habits above.
  const plans: Plan[] = [
    {
      id: "example-plan-routine",
      name: "My daily routine",
      description: "What I do on a normal day. Written down to keep track, not a recommendation.",
      items: [
        { id: "example-item-d3", label: "Vitamin D3", amount: "1000 IU", category: "supplement", when: "morning", withFood: true },
        { id: "example-item-oats", label: "Oats with berries", category: "diet", when: "morning" },
        { id: "example-item-walk", label: "Walk", amount: "30 min", category: "lifestyle", when: "evening" },
        { id: "example-item-screens", label: "No screens in bed", category: "lifestyle", when: "bedtime" },
      ],
      createdAt: `${d3Start}T08:00:00.000Z`,
    },
    {
      id: "example-plan-standard",
      name: "Standard Routine",
      description:
        "A bigger supplement routine, written down as it's followed: no amounts yet, some items only if a test shows a deficiency. Not a recommendation: see what research says about each one, and the warnings above the schedule.",
      items: [
        { id: "example-std-nr-nmn", label: "NR/NMN", category: "supplement", when: "morning" },
        { id: "example-std-creatine", label: "Creatine", category: "supplement", when: "morning" },
        { id: "example-std-probiotic", label: "Probiotic", category: "supplement", when: "morning" },
        { id: "example-std-omega3", label: "Omega-3", category: "supplement", when: "midday", withFood: true, note: "Or with extra virgin olive oil" },
        { id: "example-std-vit-e", label: "Vitamin E", category: "supplement", when: "midday", withFood: true, note: "Or with extra virgin olive oil" },
        {
          id: "example-std-calcium",
          label: "Calcium",
          category: "supplement",
          when: "midday",
          withFood: true,
          note: "Only if deficient. Or with extra virgin olive oil",
        },
        { id: "example-std-d3", label: "Vitamin D3", category: "supplement", when: "midday", withFood: true, note: "Or with extra virgin olive oil" },
        { id: "example-std-k2", label: "Vitamin K2", category: "supplement", when: "midday", withFood: true, note: "Or with extra virgin olive oil" },
        { id: "example-std-coq10", label: "CoQ10", category: "supplement", when: "midday", withFood: true, note: "Or with extra virgin olive oil" },
        { id: "example-std-astaxanthin", label: "Astaxanthin", category: "supplement", when: "midday", withFood: true, note: "Or with extra virgin olive oil" },
        {
          id: "example-std-garlic",
          label: "Fermented Garlic Extract",
          category: "supplement",
          when: "midday",
          withFood: true,
          note: "Or with extra virgin olive oil",
        },
        {
          id: "example-std-sulforaphane",
          label: "Sulforaphane",
          category: "supplement",
          when: "midday",
          withFood: true,
          note: "Or with extra virgin olive oil",
        },
        { id: "example-std-collagen", label: "Collagen Peptide", category: "supplement", when: "evening" },
        { id: "example-std-vit-c", label: "Vitamin C", category: "supplement", when: "evening" },
        { id: "example-std-hyaluronic", label: "Hyaluronic Acid", category: "supplement", when: "evening" },
        { id: "example-std-iron", label: "Iron", category: "supplement", when: "evening", note: "Only if deficient" },
        { id: "example-std-magnesium", label: "Magnesium", category: "supplement", when: "bedtime" },
        { id: "example-std-zinc", label: "Zinc", category: "supplement", when: "bedtime", note: "Only if deficient" },
        { id: "example-std-glycine", label: "Glycine", category: "supplement", when: "bedtime" },
        { id: "example-std-nac", label: "NAC", category: "supplement", when: "bedtime" },
        { id: "example-std-ashwagandha", label: "Ashwagandha", category: "supplement", when: "bedtime" },
        { id: "example-std-hmb", label: "HMB", category: "supplement", when: "any time", note: "Before a workout" },
        { id: "example-std-eaa", label: "EAA", category: "supplement", when: "any time", note: "Before a workout" },
        { id: "example-std-citrulline", label: "L-Citrulline", category: "supplement", when: "any time", note: "Before a workout" },
        { id: "example-std-protein", label: "Protein Powder", category: "supplement", when: "any time", note: "Before a workout" },
        { id: "example-std-multivitamin", label: "Multivitamin", category: "supplement", when: "any time", note: "Only on a low-calorie or vegan diet" },
        { id: "example-std-hmb-diet", label: "HMB", category: "supplement", when: "any time", note: "Only on a low-calorie or vegan diet" },
      ],
      createdAt: `${addDays(today, -3)}T08:00:00.000Z`,
    },
  ];

  // Three protocols the example person runs now, ticked off on Today most days (made up, not a recommendation).
  const meals: Meal[] = [
    {
      id: "example-meal-mackerel",
      name: "Grilled mackerel with new potatoes and spinach",
      items: [
        { foodId: "16-394", grams: 140 },
        { foodId: "13-495", grams: 175 },
        { foodId: "13-573", grams: 80 },
      ],
      createdAt: `${addDays(today, -22)}T18:00:00.000Z`,
    },
  ];
  const running: { plan: Plan; habit: ProtocolEntry }[] = (
    [
      {
        id: "supplements",
        name: "Supplements through the day",
        description: "The supplements I take, at the times I take them. Written down to keep track, not a recommendation.",
        category: "supplement",
        start: addDays(today, -35),
        items: [
          { id: "example-day-d3", label: "Vitamin D3", category: "supplement", when: "morning", withFood: true },
          { id: "example-day-collagen", label: "Collagen peptides", category: "supplement", when: "morning", note: "Together with the vitamin C" },
          { id: "example-day-vit-c", label: "Vitamin C", category: "supplement", when: "morning", note: "Together with the collagen" },
          { id: "example-day-omega3", label: "Omega-3", category: "supplement", when: "midday", withFood: true },
        ],
      },
      {
        id: "dinner",
        name: "Evening meal",
        description: "Oily fish most evenings instead of takeaway.",
        category: "diet",
        start: addDays(today, -21),
        items: [
          {
            id: "example-dinner-mackerel",
            label: "Grilled mackerel with new potatoes and spinach",
            category: "diet",
            when: "evening",
            mealId: "example-meal-mackerel",
          },
        ],
      },
      {
        id: "red-light",
        name: "Red light therapy",
        description: "A red light panel at home, every other day.",
        category: "lifestyle",
        start: addDays(today, -28),
        items: [
          { id: "example-red-light", label: "Red light therapy", amount: "10 min", category: "lifestyle", when: "evening", every: 2, note: "Eyes protected" },
        ],
      },
    ] satisfies { id: string; name: string; description: string; category: ProtocolEntry["category"]; start: string; items: PlanItem[] }[]
  ).map(({ id, name, description, category, start, items }) => ({
    plan: {
      id: `example-plan-${id}`,
      name,
      description,
      items,
      createdAt: `${addDays(start, -2)}T08:00:00.000Z`,
      active: { since: start, habitIds: [`example-log-${id}`] },
    },
    habit: { id: `example-log-${id}`, label: name, category, start, plan: { id: `example-plan-${id}`, items } },
  }));
  protocols.push(...running.map((r) => r.habit));
  plans.push(...running.map((r) => r.plan));

  // Ticks: most planned items on most days, the walk less often; today only the morning so far.
  const tick = seeded(20261127);
  const keep: Record<string, number> = { "example-day-omega3": 0.8, "example-red-light": 0.75, "example-dinner-mackerel": 0.85 };
  const checkins: CheckIn[] = [];
  for (const { habit } of running)
    for (let date = habit.start; date <= today; date = addDays(date, 1)) {
      const items = itemsOn(habit, date)
        .filter((i) => (date === today ? i.when === "morning" : tick() < (keep[i.id] ?? 0.9)))
        .map((i) => i.id)
        .sort();
      if (items.length) checkins.push({ id: checkInId(habit.id, date), habitId: habit.id, date, items });
    }
  for (let date = addDays(today, -42); date < today; date = addDays(date, 1))
    if (tick() < 0.7) checkins.push({ id: checkInId("example-log-walk-30", date), habitId: "example-log-walk-30", date });

  return { person, measurements, protocols, experiments, plans, meals, checkins };
}
