/**
 * Checks draft whole-food files before they go into knowledge/wholefoods:
 *   bun tools/wholefoods/check.ts path/to/food.json [more.json …]
 * Runs the same rules as the app and tests: schema, food-table ids, marker ids, prescribing wording and the
 * blocked cultures. Prints "ok" or the problems per file; exits 1 on any problem.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FoodDb } from "@bt/shared/core/meals";
import { validateWholeFoodDef, type WholeFoodDef, wholeFoodPrescribes } from "@bt/shared/core/wholeFoods";
import { BLOCKED_PATTERN } from "./ancientSources";

const ROOT = join(import.meta.dirname, "..", "..");
const db = JSON.parse(readFileSync(join(ROOT, "knowledge", "foods", "cofid-all.json"), "utf8")) as FoodDb;
const cofid = new Set(db.foods.map((f) => f[0]));
const markers = new Set(
  readdirSync(join(ROOT, "knowledge", "biomarkers"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5)),
);

let bad = 0;
for (const path of process.argv.slice(2)) {
  const json = JSON.parse(readFileSync(path, "utf8")) as WholeFoodDef;
  const problems = validateWholeFoodDef(json);
  for (const t of json.tableFoods ?? []) if (!cofid.has(t.id)) problems.push(`tableFoods: no food-table id ${t.id}`);
  for (const m of json.markers ?? []) if (!markers.has(m)) problems.push(`markers: no marker ${m}`);
  for (const t of wholeFoodPrescribes(json)) problems.push(`personal-advice wording: ${t.slice(0, 80)}`);
  const text = [...(json.history ?? []).flatMap((h) => [h.who, h.use, h.note]), ...(json.lore ?? []).flatMap((l) => [l.who, l.belief, l.note ?? ""])];
  for (const t of text) if (BLOCKED_PATTERN.test(t)) problems.push(`blocked culture: ${t.slice(0, 80)}`);
  if (json.lore?.some((l) => !l.modern)) problems.push('every lore entry must carry modern: "not tested" (entries without it are not shown)');
  console.log(`${path}: ${problems.length ? "" : "ok"}`);
  for (const p of problems) console.log(`  - ${p}`);
  bad += problems.length;
}
process.exit(bad ? 1 : 0);
