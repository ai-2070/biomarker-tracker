/**
 * A made-up example profile for trying and showing the app. Every number is invented: it is not
 * anyone's data. The results tell a few stories the app can show: low ferritin that recovers after
 * an iron supplement, vitamin D that dips in winter until D3 is started, and LDL that falls during a
 * diet experiment. Same input date, same data (a seeded random generator adds small wobbles).
 */
import { addDays } from "./dates";
import type { Plan } from "./plans";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "./types";

export interface DemoData {
  person: Profile;
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
  plans: Plan[];
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

export const DEMO_BODY_IDS: readonly string[] = ["weight", "waist", "body_fat", "bp_systolic", "bp_diastolic", "resting_hr", "heart_rate", "exercise_hr", "hrv", "hrv_resting", "spo2", "glucose_home", "sleep_duration", "sleep_deep", "sleep_rem", "vo2max"];
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
    notes: "Made-up example data to show how the app works. None of these results belong to a real person.",
  };

  // Ten blood tests, about six months apart, the last one a month ago.
  const draws = Array.from({ length: 10 }, (_, i) => addDays(today, -30 - (9 - i) * 182));
  const measurements: Measurement[] = [];
  let n = 0;
  const add = (date: string, biomarkerId: string, value: number, extra: Partial<Measurement> = {}) => {
    n += 1;
    measurements.push({ id: `example-${String(n).padStart(3, "0")}`, biomarkerId, date, value, originalValue: value, originalUnit: DEMO_UNITS[biomarkerId]!, source: "manual", lab: "Example Lab", ...extra });
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

  // The diet experiment: start two weeks after test 7. Two lipid tests before and two after, as the
  // app suggests, so the change can be told apart from normal test-to-test variation.
  const expStart = addDays(draws[6]!, 14);
  const lipids = (date: string, ldlValue: number) => {
    add(date, "ldl", ldlValue);
    add(date, "total_cholesterol", Number((ldlValue + 2.1).toFixed(1)));
    add(date, "hdl", wobble(1.56, 0.03, 0.01));
    add(date, "triglycerides", wobble(1.1, 0.06, 0.01));
  };
  lipids(addDays(expStart, -45), 3.8);
  lipids(addDays(expStart, 88), 3.2);
  lipids(addDays(expStart, 96), 3.1);

  // Body: measured at home about once a month for the last two years. Blood pressure and resting
  // heart rate drift down slowly; waist goes from just above to just below the usual limit.
  for (let k = 0; k < 24; k++) {
    const date = addDays(today, -7 - (23 - k) * 30);
    const t = k / 23;
    const body = (biomarkerId: string, value: number, extra: Partial<Measurement> = {}) => {
      n += 1;
      measurements.push({ id: `example-${String(n).padStart(3, "0")}`, biomarkerId, date, value, originalValue: value, originalUnit: DEMO_UNITS[biomarkerId]!, source: "manual", ...extra });
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
    // VO2max from the watch: a little higher as the walking habit continues.
    body("vo2max", wobble(34 + t * 2.5, 0.02, 0.1));
  }

  // The last 10 weeks, every night from the watch: sleep and HRV vary night to night, so the app
  // judges sleep on a week's average and shows HRV against this person's own usual range.
  for (let d = NIGHTLY_DAYS; d >= 1; d--) {
    const date = addDays(today, -d);
    const night = (biomarkerId: string, value: number) => {
      n += 1;
      measurements.push({ id: `example-${String(n).padStart(3, "0")}`, biomarkerId, date, value, originalValue: value, originalUnit: DEMO_UNITS[biomarkerId]!, source: "device" });
    };
    night("sleep_duration", wobble(7.3, 0.08, 0.05));
    night("hrv", Math.round(wobble(39, 0.25, 1)));
    night("hrv_resting", Math.round(wobble(48, 0.2, 1)));
  }

  const protocols: ProtocolEntry[] = [
    { id: "example-log-iron", label: "Iron bisglycinate 25 mg every other day", category: "supplement", start: addDays(draws[3]!, 9), end: addDays(draws[5]!, 20) },
    { id: "example-log-d3", label: "Vitamin D3 1000 IU daily", category: "supplement", start: d3Start },
    { id: "example-log-walk", label: "Walking 30 minutes a day", category: "lifestyle", start: addDays(draws[1]!, 40) },
    { id: "example-log-fibre", label: "Oats and beans every day (more fibre)", category: "diet", start: expStart, end: addDays(expStart, 100) },
  ];
  const experiments: Experiment[] = [
    { id: "example-exp-fibre", change: "Oats and beans every day (more fibre)", category: "diet", markerIds: ["ldl", "total_cholesterol"], start: expStart, retestAfterDays: 84, end: addDays(expStart, 100), protocolId: "example-log-fibre" },
  ];

  measurements.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  // A protocol the example person wrote down: their current routine, already running as habits above.
  const plans: Plan[] = [
    {
      id: "example-plan-routine",
      name: "My daily routine",
      description: "What I do on a normal day. Written down to keep track, not a recommendation.",
      items: [
        { id: "example-item-d3", label: "Vitamin D3", amount: "1000 IU", category: "supplement", when: "morning", note: "With breakfast" },
        { id: "example-item-oats", label: "Oats with berries", category: "diet", when: "morning" },
        { id: "example-item-walk", label: "Walk", amount: "30 min", category: "lifestyle", when: "evening" },
        { id: "example-item-screens", label: "No screens in bed", category: "lifestyle", when: "bedtime" },
      ],
      createdAt: `${d3Start}T08:00:00.000Z`,
    },
    {
      id: "example-plan-standard",
      name: "Standard Routine",
      description: "A bigger supplement routine, written down as it's followed: no amounts yet, some items only if a test shows a deficiency. Not a recommendation: see what research says about each one, and the warnings above the schedule.",
      items: [
        { id: "example-std-nr-nmn", label: "NR / NMN", category: "supplement", when: "morning" },
        { id: "example-std-creatine", label: "Creatine", category: "supplement", when: "morning" },
        { id: "example-std-probiotic", label: "Probiotic", category: "supplement", when: "morning" },
        { id: "example-std-omega3", label: "Omega-3", category: "supplement", when: "midday", note: "With food or extra virgin olive oil" },
        { id: "example-std-vit-e", label: "Vitamin E", category: "supplement", when: "midday", note: "With food or extra virgin olive oil" },
        { id: "example-std-calcium", label: "Calcium", category: "supplement", when: "midday", note: "Only if deficient. With food" },
        { id: "example-std-d3k2", label: "Vitamin D3 + K2", category: "supplement", when: "midday", note: "With food or extra virgin olive oil" },
        { id: "example-std-coq10", label: "CoQ10", category: "supplement", when: "midday", note: "With food or extra virgin olive oil" },
        { id: "example-std-astaxanthin", label: "Astaxanthin", category: "supplement", when: "midday", note: "With food or extra virgin olive oil" },
        { id: "example-std-garlic", label: "Fermented garlic extract", category: "supplement", when: "midday", note: "With food" },
        { id: "example-std-sulforaphane", label: "Sulforaphane", category: "supplement", when: "midday", note: "With food" },
        { id: "example-std-collagen-c", label: "Collagen + vitamin C", category: "supplement", when: "evening" },
        { id: "example-std-hyaluronic", label: "Hyaluronic acid", category: "supplement", when: "evening" },
        { id: "example-std-iron", label: "Iron", category: "supplement", when: "evening", note: "Only if deficient" },
        { id: "example-std-magnesium", label: "Magnesium", category: "supplement", when: "bedtime" },
        { id: "example-std-zinc", label: "Zinc", category: "supplement", when: "bedtime", note: "Only if deficient" },
        { id: "example-std-glycine-nac", label: "Glycine + NAC", category: "supplement", when: "bedtime" },
        { id: "example-std-ashwagandha", label: "Ashwagandha", category: "supplement", when: "bedtime" },
        { id: "example-std-hmb", label: "HMB", category: "supplement", when: "any time", note: "Before a workout" },
        { id: "example-std-eaa", label: "EAA (essential amino acids)", category: "supplement", when: "any time", note: "Before a workout" },
        { id: "example-std-citrulline", label: "L-Citrulline", category: "supplement", when: "any time", note: "Before a workout" },
        { id: "example-std-protein", label: "Protein powder", category: "supplement", when: "any time", note: "Before a workout" },
        { id: "example-std-multivitamin", label: "Multivitamin", category: "supplement", when: "any time", note: "Only on a low-calorie or vegan diet" },
        { id: "example-std-hmb-diet", label: "HMB", category: "supplement", when: "any time", note: "Only on a low-calorie or vegan diet" },
      ],
      createdAt: `${addDays(today, -3)}T08:00:00.000Z`,
    },
  ];
  return { person, measurements, protocols, experiments, plans };
}
