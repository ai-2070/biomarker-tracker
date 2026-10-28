import { useLiveQuery } from "dexie-react-hooks";
import { db, getProfile, measurementsFor } from "../db/db";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "../core/types";

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
