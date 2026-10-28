/**
 * Fitness age from VO₂max, using measured reference data: mean VO₂max (mL/kg/min) of healthy
 * Norwegian adults by sex and age group, from treadmill tests in the HUNT 3 Fitness Study
 * (Loe et al., PLoS One 2013, PMID 23691196, Table 2; 3816 people, free from heart and lung disease).
 *
 * Fitness age is the age at which these people averaged the same VO₂max. Group means are placed at
 * the middle of each age group (25, 35 … 75) and joined with straight lines. Outside that span the
 * answer is "25 or younger" or "75 or older" rather than an extrapolation.
 */
export const HUNT_VO2MAX: Record<"m" | "f", readonly { age: number; mean: number; sd: number }[]> = {
  m: [
    { age: 25, mean: 54.4, sd: 8.4 },
    { age: 35, mean: 49.1, sd: 7.5 },
    { age: 45, mean: 47.2, sd: 7.7 },
    { age: 55, mean: 42.6, sd: 7.4 },
    { age: 65, mean: 39.2, sd: 6.7 },
    { age: 75, mean: 35.3, sd: 6.5 },
  ],
  f: [
    { age: 25, mean: 43.0, sd: 7.7 },
    { age: 35, mean: 40.0, sd: 6.8 },
    { age: 45, mean: 38.4, sd: 6.9 },
    { age: 55, mean: 34.4, sd: 5.7 },
    { age: 65, mean: 31.1, sd: 5.1 },
    { age: 75, mean: 28.3, sd: 5.2 },
  ],
};

export type FitnessAge = { age: number; bound?: undefined } | { age: number; bound: "younger" | "older" };

/** The age at which healthy people averaged this VO₂max. */
export function fitnessAge(vo2max: number, sex: "m" | "f"): FitnessAge {
  const t = HUNT_VO2MAX[sex];
  if (vo2max >= t[0]!.mean) return { age: t[0]!.age, bound: "younger" };
  if (vo2max <= t.at(-1)!.mean) return { age: t.at(-1)!.age, bound: "older" };
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1]!;
    const b = t[i]!;
    if (vo2max <= a.mean && vo2max >= b.mean) return { age: a.age + ((a.mean - vo2max) / (a.mean - b.mean)) * (b.age - a.age) };
  }
  return { age: t.at(-1)!.age, bound: "older" };
}

/** The reference group for an age: its mean and SD, and how many SDs this VO₂max is from the mean. */
export function vo2maxForAge(vo2max: number, age: number, sex: "m" | "f"): { group: string; mean: number; sd: number; z: number } {
  const t = HUNT_VO2MAX[sex];
  const row = t.find((r) => age < r.age + 5) ?? t.at(-1)!;
  const group = row.age === 75 ? "70 and over" : `${row.age - 5}–${row.age + 4}`;
  return { group, mean: row.mean, sd: row.sd, z: (vo2max - row.mean) / row.sd };
}
