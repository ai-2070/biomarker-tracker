// Developer-only local bridge. Participant records stay in local process pipes, never in model/API calls.
import { readFileSync } from "node:fs";
import process from "node:process";
import { type MortalityInputs, mortalityDesign } from "@bt/shared/core/mortalityModel";
import { type PhenoAgeInputs, phenoAge } from "@bt/shared/core/phenoage";

interface TrainingInput extends MortalityInputs {
  clinical?: PhenoAgeInputs;
}
const rows = JSON.parse(readFileSync(0, "utf8")) as TrainingInput[];
if (!Array.isArray(rows)) throw new TypeError("Expected a local array of cohort inputs");
const output = rows.map((row) => {
  const input: MortalityInputs = { ...row };
  if (
    row.clinical &&
    Number.isFinite(row.clinical.age) &&
    Object.values(row.clinical).every((v) => typeof v === "number" && Number.isFinite(v)) &&
    row.clinical.crp_hs > 0
  )
    input.phenoAgeGap = phenoAge(row.clinical) - row.clinical.age;
  return { design: mortalityDesign(input), phenoAgeGap: input.phenoAgeGap };
});
process.stdout.write(JSON.stringify(output));
