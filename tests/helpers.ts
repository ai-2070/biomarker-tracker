import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BiomarkerDef, Measurement } from "@bt/shared/core/types";

export const KNOWLEDGE_DIR = join(import.meta.dirname, "..", "knowledge", "biomarkers");

export function loadKnowledgeFiles(): { file: string; json: unknown }[] {
  return readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({ file, json: JSON.parse(readFileSync(join(KNOWLEDGE_DIR, file), "utf8")) as unknown }));
}

export function loadDefs(): Map<string, BiomarkerDef> {
  return new Map(loadKnowledgeFiles().map(({ json }) => [(json as BiomarkerDef).id, json as BiomarkerDef]));
}

export function def(id: string): BiomarkerDef {
  const d = loadDefs().get(id);
  if (!d) throw new Error(`no knowledge file for ${id}`);
  return d;
}

/**
 * A marker with a made-up within-person variation (CVI, %), for testing the published-variation code
 * path. EFLM's values aren't in the app (it needs a paid licence, docs/eflm-biological-variation.md),
 * so tests never use or copy them.
 */
export function withVariation(d: BiomarkerDef, cvi: number): BiomarkerDef {
  return {
    ...d,
    biologicalVariation: {
      cvi,
      ciLow: cvi,
      ciHigh: cvi,
      studies: 1,
      analyte: d.name,
      matrix: "Test",
      source: "Test fixture (made-up value)",
      url: "https://example.org/",
      retrieved: "2026-01-01",
    },
  };
}

/** All marker definitions, with made-up variation for the markers given (id → CVI %). */
export function defsWithVariation(cvis: Record<string, number>): Map<string, BiomarkerDef> {
  const defs = loadDefs();
  for (const [id, cvi] of Object.entries(cvis)) defs.set(id, withVariation(defs.get(id)!, cvi));
  return defs;
}

let counter = 0;
export function measurement(partial: Partial<Measurement> & Pick<Measurement, "date" | "value">): Measurement {
  counter += 1;
  return {
    id: `m${counter}`,
    biomarkerId: "ferritin",
    originalValue: partial.value,
    originalUnit: "µg/L",
    source: "manual",
    ...partial,
  };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

/** Controlled async work for race tests; this project's ES2022 lib lacks Promise.withResolvers. */
export function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
