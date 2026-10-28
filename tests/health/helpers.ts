import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BiomarkerDef, Measurement } from "../../shared/health/types.ts";

export const KNOWLEDGE_DIR = join(import.meta.dirname, "..", "..", "knowledge", "biomarkers");

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
