import { BODY_FIELDS, type BodyField, PLAUSIBLE, validateBodyEntry } from "./body";
import { parseLabText } from "./importers/labText";
import { validateManualEntry } from "./importers/manual";
import { measurementStatementsIn } from "./profileCompletion";
import type { BiomarkerDef, Measurement } from "./types";

/** Explicit current readings, not inferred body metrics, targets, doses or exercise loads. */
export function measurementsIn(userText: string, today: string, defs: ReadonlyMap<string, BiomarkerDef>): Omit<Measurement, "id">[] {
  const lines: string[] = [];
  for (const statement of measurementStatementsIn(userText)) {
    // Deleting or correcting a reading is a change Brain makes on request (change_data), not a new reading.
    if (/\b(?:delete|deleting|remove|removing|erase|wrong|mistake|incorrect|correct|correction|change|edit|fix|undo)\b/i.test(statement)) continue;
    const training = /\b(?:lift|lifting|lifted|deadlift|squat|bench|barbell|dumbbell|carry|carrying)\b/i.test(statement);
    for (const part of statement.split(/,(?!\d)|(?<!\d),|\s+and\s+/i)) {
      let line = part
        .trim()
        .replace(/[’‘]/g, "'")
        .replace(/^im\b/i, "I'm")
        .replace(/\s+(?:today|now|currently|at the moment)[.!]?$/i, "")
        .replace(/^(?:i(?: am|'m| have| weigh)|my(?: current)? weight(?: is|:))\s+(?:(?:currently|now|about|around)\s+)?/i, "")
        .replace(/^my\s+(?:current\s+)?/i, "");
      const weight = line.match(/^(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|lb|lbs|pounds?)$/i);
      if (weight && !training) line = `Body weight ${weight[1]} ${/^k/i.test(weight[2]!) ? "kg" : "lb"}`;
      else if (weight) continue;
      // A value-first description still names its marker: "27% body fat".
      const valueFirst = line.match(/^(\d+(?:[.,]\d+)?)\s*(%|percent)\s+(.+)$/i);
      if (valueFirst) line = `${valueFirst[3]} ${valueFirst[1]} %`;
      if (/\b(?:pheno\s*age|phenoage|heart age|fitness age|bmi|waist.to.height)\b/i.test(line)) continue;
      lines.push(line);
    }
  }
  const candidates = new Map<string, Omit<Measurement, "id"> | null>();
  for (const row of parseLabText(lines.join("\n"), [...defs.values()]).rows) {
    if (row.problems.length || !row.unit) continue;
    const result = validateManualEntry(
      {
        biomarkerId: row.biomarkerId,
        value: row.value,
        unit: row.unit,
        date: today,
        note: "Stated as current in Brain; dated to the day the message was sent.",
      },
      defs,
      today,
    );
    if (!result.ok || result.warnings.length) continue;
    const m = result.measurement;
    if ((BODY_FIELDS as readonly string[]).includes(m.biomarkerId)) {
      const bounds = PLAUSIBLE[m.biomarkerId as BodyField];
      if (m.value < bounds.min || m.value > bounds.max) continue;
    }
    if (candidates.has(m.biomarkerId)) {
      const previous = candidates.get(m.biomarkerId);
      if (!previous || previous.value !== m.value || previous.qualifier !== m.qualifier) candidates.set(m.biomarkerId, null);
    } else candidates.set(m.biomarkerId, m);
  }
  const systolic = candidates.get("bp_systolic");
  const diastolic = candidates.get("bp_diastolic");
  if (systolic || diastolic) {
    const pair = validateBodyEntry(
      {
        date: today,
        values: {
          ...(systolic ? { bp_systolic: { value: String(systolic.originalValue), unit: systolic.originalUnit } } : {}),
          ...(diastolic ? { bp_diastolic: { value: String(diastolic.originalValue), unit: diastolic.originalUnit } } : {}),
        },
      },
      defs,
      today,
    );
    if (!pair.ok) {
      candidates.delete("bp_systolic");
      candidates.delete("bp_diastolic");
    }
  }
  return [...candidates.values()].filter((m): m is Omit<Measurement, "id"> => m !== null);
}
