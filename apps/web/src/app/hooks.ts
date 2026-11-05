import { validateIntakeItems, type IntakeItem } from "@bt/core/intake";
import type { Meal } from "@bt/core/meals";
import type { Plan } from "@bt/core/plans";
import { useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getProfile, measurementsFor } from "../db/db";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "@bt/core/types";
import { withPhenoAgeGap } from "@bt/core/phenoageWatch";

/** All measurements, live. `undefined` while loading. */
export function useAllMeasurements(): Measurement[] | undefined {
  return useLiveQuery(() => db.measurements.toArray(), []);
}

export function useMeasurementsFor(biomarkerId: string): Measurement[] | undefined {
  return useLiveQuery(() => measurementsFor(biomarkerId), [biomarkerId]);
}

/** All log entries, live. `undefined` while loading. */
export function useProtocols(): ProtocolEntry[] | undefined {
  return useLiveQuery(() => db.protocols.toArray(), []);
}

/** All experiments, live. `undefined` while loading. */
export function useExperiments(): Experiment[] | undefined {
  return useLiveQuery(() => db.experiments.toArray(), []);
}

export function useProfile(): Profile {
  return useLiveQuery(() => getProfile(), []) ?? {};
}

const DISPLAY_UNITS_KEY = "displayUnits";

/** The unit the user prefers to see per biomarker. Missing = canonical unit. */
export function useDisplayUnits(): Record<string, string> {
  return (
    useLiveQuery(async () => {
      const row = await db.settings.get(DISPLAY_UNITS_KEY);
      return (row?.value as Record<string, string> | undefined) ?? {};
    }, []) ?? {}
  );
}

export async function setDisplayUnit(biomarkerId: string, unit: string): Promise<void> {
  await db.transaction("rw", db.settings, async () => {
    const row = await db.settings.get(DISPLAY_UNITS_KEY);
    const current = (row?.value as Record<string, string> | undefined) ?? {};
    await db.settings.put({ key: DISPLAY_UNITS_KEY, value: { ...current, [biomarkerId]: unit } });
  });
}

/** The person's protocols (Protocols page), newest first. */
export function usePlans(): Plan[] | undefined {
  return useLiveQuery(async () => (await db.plans.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), []);
}

/** The person's meals, newest first. */
export function useMeals(): Meal[] | undefined {
  return useLiveQuery(async () => (await db.meals.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), []);
}

/** Whether a CSS media query matches, updating when it changes (e.g. the window is resized). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The expiration date on the Biological age page: off unless turned on, per profile (kept in its settings). */
export const EXPIRATION_KEY = "showExpirationDate";

export function useShowExpirationDate(): boolean | undefined {
  return useLiveQuery(async () => (await db.settings.get(EXPIRATION_KEY))?.value === true, []);
}

export async function setShowExpirationDate(on: boolean): Promise<void> {
  if (on) await db.settings.put({ key: EXPIRATION_KEY, value: true });
  else await db.settings.delete(EXPIRATION_KEY);
}

/** Only opt in when saved daily active minutes match the mortality cohort's leisure-exercise definition. */
export const MORTALITY_ACTIVITY_KEY = "mortalityActivityIsLeisure";

export function useMortalityActivityLeisure(): boolean | undefined {
  return useLiveQuery(async () => (await db.settings.get(MORTALITY_ACTIVITY_KEY))?.value === true, []);
}

export async function setMortalityActivityLeisure(on: boolean): Promise<void> {
  if (on) await db.settings.put({ key: MORTALITY_ACTIVITY_KEY, value: true });
  else await db.settings.delete(MORTALITY_ACTIVITY_KEY);
}

const INTAKE_KEY = "intakeList";

/** The Daily intake analyzer's list: one per profile, kept in its settings (not a diary). */
export function useIntakeList(): IntakeItem[] | undefined {
  return useLiveQuery(async () => {
    const v = (await db.settings.get(INTAKE_KEY))?.value;
    // Keep valid legacy oversize lists visible so people can remove entries instead of losing them.
    return Array.isArray(v) && v.every((item) => validateIntakeItems([item]).length === 0) ? (v as IntakeItem[]) : [];
  }, []);
}

export async function setIntakeList(items: IntakeItem[]): Promise<void> {
  await db.transaction("rw", db.settings, async () => {
    const errors = validateIntakeItems(items);
    const current = (await db.settings.get(INTAKE_KEY))?.value;
    const repairing = Array.isArray(current) && current.length > 60 && items.length < current.length &&
      items.every((item) => validateIntakeItems([item]).length === 0);
    if (errors.length && !repairing) throw new Error(errors[0]);
    if (items.length === 0) await db.settings.delete(INTAKE_KEY);
    else await db.settings.put({ key: INTAKE_KEY, value: items });
  });
}

/** The person's results plus their PhenoAge gap at each complete blood test, for habit watches (never stored). */
export function useWatchMeasurements(all: readonly Measurement[] | undefined): Measurement[] | undefined {
  const profile = useProfile();
  return all ? [...withPhenoAgeGap(all, profile.birthMonth, new Map()).measurements] : undefined;
}
