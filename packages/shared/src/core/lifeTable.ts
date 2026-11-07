/**
 * Official period life tables: population figures, never predictions for one person.
 * lx is how many of 100,000 born survive to each exact age at the reporting period's death rates.
 * Between whole ages survivors are joined by straight lines. Past 95 they fall at a constant rate,
 * 1 / life expectancy at 95; this approximation preserves the source's remaining mean at 95.
 */

export interface LifeTable {
  /** Survivors at exact ages 0 to 95, out of 100,000 born. */
  lx: number[];
  /** Life expectancy at 95, in years. */
  e95: number;
}

export interface LifeTableSource {
  name: string;
  url: string;
  retrieved: string;
  period: { from: number; to: number };
  note?: string;
}

export interface LifeTableCountry {
  name: string;
  source: LifeTableSource;
  tables: Partial<Record<"f" | "m" | "t", LifeTable>>;
}

export interface LifeTableFile {
  note: string;
  countries: Record<string, LifeTableCountry>;
}

export interface ResolvedLifeTable {
  table: LifeTable;
  name: string;
  country: string;
  sex: "f" | "m" | "t";
  source: LifeTableSource;
}

/** Country codes retain Eurostat's EL for Greece. GB is the whole United Kingdom. */
export const LIFE_TABLE_COUNTRIES: Readonly<Record<string, string>> = {
  AT: "Austria",
  BE: "Belgium",
  BG: "Bulgaria",
  HR: "Croatia",
  CY: "Cyprus",
  CZ: "Czechia",
  DK: "Denmark",
  EE: "Estonia",
  FI: "Finland",
  FR: "France",
  DE: "Germany",
  EL: "Greece",
  HU: "Hungary",
  IS: "Iceland",
  IE: "Ireland",
  IT: "Italy",
  LV: "Latvia",
  LI: "Liechtenstein",
  LT: "Lithuania",
  LU: "Luxembourg",
  MT: "Malta",
  NL: "Netherlands",
  NO: "Norway",
  PL: "Poland",
  PT: "Portugal",
  RO: "Romania",
  SK: "Slovakia",
  SI: "Slovenia",
  ES: "Spain",
  SE: "Sweden",
  CH: "Switzerland",
  EU27_2020: "the European Union (average)",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  NZ: "New Zealand",
  JP: "Japan",
};

const TOP = 95;

/** Survivors (of 100,000 born) at an exact age, fractional ages included. */
export function survivors(t: LifeTable, age: number): number {
  if (age <= 0) return t.lx[0]!;
  if (age >= TOP) return t.lx[TOP]! * Math.exp(-(age - TOP) / t.e95);
  const a = Math.floor(age);
  const f = age - a;
  return t.lx[a]! + (t.lx[a + 1]! - t.lx[a]!) * f;
}

/** The age, from `fromAge` on, at which survivors fall to `fraction` of those alive at `fromAge`. */
export function ageWhenLeft(t: LifeTable, fromAge: number, fraction: number): number {
  const target = survivors(t, fromAge) * fraction;
  if (target <= 0) return Infinity;
  if (target < t.lx[TOP]! || fromAge >= TOP) {
    // In the open group: lx95 · e^(−(x − 95)/e95) = target.
    const base = Math.max(fromAge, TOP);
    return base + t.e95 * Math.log(survivors(t, base) / target);
  }
  for (let a = Math.floor(fromAge); a < TOP; a++) {
    const lo = survivors(t, Math.max(a, fromAge));
    const hi = t.lx[a + 1]!;
    if (hi <= target && lo >= target) {
      const start = Math.max(a, fromAge);
      return lo === hi ? start : start + ((lo - target) / (lo - hi)) * (a + 1 - start);
    }
  }
  return TOP;
}

/** Remaining life expectancy at an age: years lived from here on, averaged over everyone alive at it. */
export function remainingYears(t: LifeTable, age: number): number {
  const alive = survivors(t, age);
  if (alive <= 0) return 0;
  let area = 0;
  const step = 0.25;
  for (let x = age; x < TOP; x += step) {
    const x2 = Math.min(x + step, TOP);
    area += ((survivors(t, x) + survivors(t, x2)) / 2) * (x2 - x);
  }
  area += survivors(t, Math.max(age, TOP)) * t.e95;
  return area / alive;
}

export interface BestBefore {
  /** Ages at which a quarter, half and three quarters of the people alive at `age` have died. */
  quarter: number;
  median: number;
  threeQuarters: number;
  /** Remaining life expectancy (mean), years. */
  expectancy: number;
}

export function bestBefore(t: LifeTable, age: number): BestBefore {
  return {
    quarter: ageWhenLeft(t, age, 0.75),
    median: ageWhenLeft(t, age, 0.5),
    threeQuarters: ageWhenLeft(t, age, 0.25),
    expectancy: remainingYears(t, age),
  };
}
export interface PopulationSurvivalPoint {
  age: number;
  alivePercent: number;
  tailApproximation: boolean;
}

/** Of 100 people alive at this age, how many survive to each later age at the period's rates. */
export function populationSurvival(t: LifeTable, age: number): PopulationSurvivalPoint[] {
  const alive = survivors(t, age);
  if (!Number.isFinite(age) || age < 0 || !Number.isFinite(alive) || alive <= 0) return [];
  const end = Math.ceil(ageWhenLeft(t, age, 0.01));
  if (!Number.isFinite(end)) return [];
  const point = (a: number): PopulationSurvivalPoint => ({
    age: a,
    alivePercent: (survivors(t, a) / alive) * 100,
    tailApproximation: a > TOP,
  });
  const points = [point(age)];
  for (let a = Math.floor(age) + 1; a <= end; a++) points.push(point(a));
  return points;
}

/** An annual source and a three-year source must not be presented as the same reporting period. */
export function lifeTablePeriod(period: LifeTableSource["period"]): string {
  return period.from === period.to ? String(period.from) : `${period.from}–${period.to}`;
}

export interface CountryLifeComparison {
  country: string;
  name: string;
  source: LifeTableSource;
  meanRemainingYears: number;
}

/** Compare the same age and sex, never substituting another sex or an invented combined table. */
export function compareLifeTables(file: LifeTableFile, age: number, sex: "f" | "m" | undefined) {
  const rows: CountryLifeComparison[] = [];
  const missingSex: { country: string; name: string }[] = [];
  if (!Number.isFinite(age) || age < 0) return { rows, missingSex, maxRemainingYears: 0 };
  for (const [country, entry] of Object.entries(file.countries)) {
    const table = entry.tables[sex ?? "t"];
    if (!table) {
      missingSex.push({ country, name: entry.name });
      continue;
    }
    rows.push({ country, name: entry.name, source: entry.source, meanRemainingYears: remainingYears(table, age) });
  }
  rows.sort((a, b) => b.meanRemainingYears - a.meanRemainingYears || a.name.localeCompare(b.name));
  return { rows, missingSex, maxRemainingYears: rows[0]?.meanRemainingYears ?? 0 };
}

const YEAR_MS = 365.2425 * 86_400_000;

/** The middle of the birth month ("YYYY-MM"), as the app assumes everywhere (only month and year are kept). */
export function birthMoment(birthMonth: string): number {
  const [y, m] = birthMonth.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Date.UTC(y, m - 1, 1) + (days / 2) * 86_400_000;
}

/** Age in years at a moment. */
export const ageAtMoment = (birthMonth: string, ms: number) => (ms - birthMoment(birthMonth)) / YEAR_MS;

/** The moment a person born in `birthMonth` reaches `age` years. */
export const momentAtAge = (birthMonth: string, age: number) => birthMoment(birthMonth) + age * YEAR_MS;

/**
 * The best-before range for a person, as moments. Age is taken at the start of `today` (UTC), so the
 * dates hold still through the day; they move a little each day, because surviving another day
 * changes who you're compared with.
 */
export function bestBeforeMoments(t: LifeTable, birthMonth: string, today: string) {
  const age = ageAtMoment(birthMonth, Date.parse(`${today}T00:00:00Z`));
  const b = bestBefore(t, age);
  return {
    age,
    ...b,
    quarterAt: momentAtAge(birthMonth, b.quarter),
    medianAt: momentAtAge(birthMonth, b.median),
    threeQuartersAt: momentAtAge(birthMonth, b.threeQuarters),
  };
}

/** The table for a person: by sex, or both sexes together when sex isn't known. */
export function tableFor(file: LifeTableFile, country: string | undefined, sex: "m" | "f" | undefined): ResolvedLifeTable | undefined {
  if (!country || !Object.hasOwn(file.countries, country)) return undefined;
  const c = file.countries[country];
  if (!c) return undefined;
  const key = sex ?? "t";
  const table = c.tables[key];
  return table ? { table, country, source: c.source, name: c.name, sex: key } : undefined;
}

/** Problems with a life table file; empty means valid. */
export function validateLifeTables(v: unknown): string[] {
  const errs: string[] = [];
  if (!v || typeof v !== "object") return ["no countries"];
  const f = v as Partial<LifeTableFile>;
  if (!f.countries || typeof f.countries !== "object" || Array.isArray(f.countries) || Object.keys(f.countries).length === 0) return ["no countries"];
  for (const [code, c] of Object.entries(f.countries)) {
    if (!Object.hasOwn(LIFE_TABLE_COUNTRIES, code)) errs.push(`${code}: unknown country`);
    if (!c || typeof c !== "object") {
      errs.push(`${code}: invalid country`);
      continue;
    }
    const s = c.source;
    if (
      typeof c.name !== "string" ||
      !c.name.trim() ||
      !s ||
      typeof s.name !== "string" ||
      !s.name.trim() ||
      typeof s.url !== "string" ||
      !s.url.startsWith("https://") ||
      typeof s.retrieved !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.retrieved) ||
      !s.period ||
      !Number.isInteger(s.period.from) ||
      !Number.isInteger(s.period.to) ||
      s.period.from < 1900 ||
      s.period.to < s.period.from ||
      s.period.to > 2200
    )
      errs.push(`${code}: invalid source metadata`);
    if (!c.tables || typeof c.tables !== "object" || !c.tables.f || !c.tables.m) {
      errs.push(`${code}: needs female and male tables`);
      continue;
    }
    for (const [sex, t] of Object.entries(c.tables)) {
      if (!["f", "m", "t"].includes(sex)) errs.push(`${code}/${sex}: unknown sex`);
      if (!t || !Array.isArray(t.lx) || t.lx.length !== TOP + 1) errs.push(`${code}/${sex}: needs survivors at ages 0 to 95`);
      else if (t.lx.some((x) => !Number.isFinite(x) || x <= 0) || Math.abs(t.lx[0]! - 100_000) > 0.001) errs.push(`${code}/${sex}: invalid survivor counts`);
      else if (t.lx.some((x, i) => i > 0 && x > t.lx[i - 1]!)) errs.push(`${code}/${sex}: survivors can't rise with age`);
      if (!t || !Number.isFinite(t.e95) || !(t.e95 > 0 && t.e95 < 10)) errs.push(`${code}/${sex}: life expectancy at 95 looks wrong`);
    }
  }
  return errs;
}

/**
 * Read the table at a comparison age, then add its remaining years to calendar age.
 * Keeping the age gap constant is an unvalidated lifetime-transport assumption, not
 * an individual survival forecast or a confidence interval from a fitted model.
 */
export function bestBeforeWithShift(t: LifeTable, birthMonth: string, today: string, shift: number) {
  const age = ageAtMoment(birthMonth, Date.parse(`${today}T00:00:00Z`));
  const like = Math.max(0, age + shift);
  const b = bestBefore(t, like);
  const at = (deathAge: number) => momentAtAge(birthMonth, age + (deathAge - like));
  return {
    age,
    comparedAge: like,
    quarter: age + (b.quarter - like),
    median: age + (b.median - like),
    threeQuarters: age + (b.threeQuarters - like),
    expectancy: b.expectancy,
    quarterAt: at(b.quarter),
    medianAt: at(b.median),
    threeQuartersAt: at(b.threeQuarters),
  };
}
