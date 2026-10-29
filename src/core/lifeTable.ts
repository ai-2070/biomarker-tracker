/**
 * "Best before": what official life tables say about people of your age and sex in your country. A
 * population figure, never a prediction for one person. From a period life table (Eurostat): lx is
 * how many of 100,000 born are still alive at each exact age, at one year's death rates.
 *
 * Between whole ages survivors are joined by straight lines; past 95 (the table's open group) they
 * fall at a constant rate, 1 / (life expectancy at 95), a standard approximation.
 */

export interface LifeTable {
  /** Survivors at exact ages 0 to 95, out of 100,000 born. */
  lx: number[];
  /** Life expectancy at 95, in years. */
  e95: number;
}

export interface LifeTableFile {
  source: string;
  url: string;
  retrieved: string;
  note: string;
  countries: Record<string, { name: string; year: number; tables: Partial<Record<"f" | "m" | "t", LifeTable>> }>;
}

/** Countries with Eurostat life tables (codes as Eurostat writes them: EL is Greece). */
export const LIFE_TABLE_COUNTRIES: Readonly<Record<string, string>> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus", CZ: "Czechia", DK: "Denmark", EE: "Estonia", FI: "Finland",
  FR: "France", DE: "Germany", EL: "Greece", HU: "Hungary", IS: "Iceland", IE: "Ireland", IT: "Italy", LV: "Latvia", LI: "Liechtenstein",
  LT: "Lithuania", LU: "Luxembourg", MT: "Malta", NL: "Netherlands", NO: "Norway", PL: "Poland", PT: "Portugal", RO: "Romania", SK: "Slovakia",
  SI: "Slovenia", ES: "Spain", SE: "Sweden", CH: "Switzerland", EU27_2020: "the European Union (average)",
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
  return { age, ...b, quarterAt: momentAtAge(birthMonth, b.quarter), medianAt: momentAtAge(birthMonth, b.median), threeQuartersAt: momentAtAge(birthMonth, b.threeQuarters) };
}

/** The table for a person: by sex, or both sexes together when sex isn't known. */
export function tableFor(file: LifeTableFile, country: string | undefined, sex: "m" | "f" | undefined): { table: LifeTable; year: number; name: string; sex: "f" | "m" | "t" } | undefined {
  const c = country ? file.countries[country] : undefined;
  if (!c) return undefined;
  const key = sex ?? "t";
  const table = c.tables[key];
  return table ? { table, year: c.year, name: c.name, sex: key } : undefined;
}

/** Problems with a life table file; empty means valid. */
export function validateLifeTables(v: unknown): string[] {
  const f = v as Partial<LifeTableFile>;
  const errs: string[] = [];
  if (!f || typeof f !== "object" || !f.countries) return ["no countries"];
  for (const [code, c] of Object.entries(f.countries)) {
    if (!LIFE_TABLE_COUNTRIES[code]) errs.push(`${code}: unknown country`);
    for (const [sex, t] of Object.entries(c.tables)) {
      if (!t || t.lx.length !== TOP + 1) errs.push(`${code}/${sex}: needs survivors at ages 0 to 95`);
      else if (t.lx.some((x, i) => i > 0 && x > t.lx[i - 1]!)) errs.push(`${code}/${sex}: survivors can't rise with age`);
      if (!t || !(t.e95 > 0 && t.e95 < 10)) errs.push(`${code}/${sex}: life expectancy at 95 looks wrong`);
    }
  }
  return errs;
}

// ---- With your blood tests: the life table read at your PhenoAge -----------------------------------

/**
 * How much older or younger your PhenoAge runs than your age: the average difference over your most
 * recent tests (up to `maxTests` within `windowYears` of the latest), so one unusual test (an
 * infection raising CRP) moves it less.
 */
export function phenoAgeShift(draws: readonly { date: string; age: number; phenoAge: number }[], windowYears = 2, maxTests = 3): { shift: number; tests: number; from: string; to: string } | undefined {
  const sorted = [...draws].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  if (!last) return undefined;
  const since = new Date(Date.parse(last.date) - windowYears * YEAR_MS).toISOString().slice(0, 10);
  const used = sorted.filter((d) => d.date >= since).slice(-maxTests);
  const shift = used.reduce((s, d) => s + (d.phenoAge - d.age), 0) / used.length;
  return { shift, tests: used.length, from: used[0]!.date, to: last.date };
}

/**
 * The best-before range read at your PhenoAge instead of your age. PhenoAge is "the expected age within
 * the population that corresponds to a person's estimated mortality risk" (Liu et al. 2018), so people
 * like you, by your blood tests, are people of your PhenoAge: their remaining years are added to your age.
 * Assumes your difference stays the same from here on.
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
