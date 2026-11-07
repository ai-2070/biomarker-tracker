// Extract a curated food list from CoFID 2021 into knowledge/foods/cofid-foods.json.
// Usage: node build-foods.mjs <cofid xlsx> <output json>

import { writeFileSync } from "node:fs";
import XLSX from "xlsx";

const [xlsxPath, outPath] = process.argv.slice(2);
const wb = XLSX.readFile(xlsxPath);
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false });

// nutrient id -> [sheet, CoFID column code, unit, label]
const NUTRIENTS = {
  iron: ["1.4 Inorganics", "FE", "mg", "Iron"],
  potassium: ["1.4 Inorganics", "K", "mg", "Potassium"],
  vitaminC: ["1.5 Vitamins", "VITC", "mg", "Vitamin C"],
  vitaminB12: ["1.5 Vitamins", "VITB12", "µg", "Vitamin B12"],
  folate: ["1.5 Vitamins", "FOLT", "µg", "Folate"],
  vitaminD: ["1.5 Vitamins", "VITD", "µg", "Vitamin D"],
  vitaminK1: ["1.5 Vitamins", "VITK1", "µg", "Vitamin K1"],
  retinol: ["1.5 Vitamins", "RET", "µg", "Retinol (preformed vitamin A)"],
  fibre: ["1.3 Proximates", "AOACFIB", "g", "Fibre (AOAC)"],
  saturatedFat: ["1.3 Proximates", "SATFOD", "g", "Saturated fat"],
  epa: ["1.12 (PUFA per 100gFood)", "FOD20:5cn3", "g", "EPA (omega-3)"],
  dha: ["1.12 (PUFA per 100gFood)", "FOD22:6cn3", "g", "DHA (omega-3)"],
};

// CoFID code -> plain name, example portion in grams, portion label
const FOODS = [
  ["18-474", "Beef rump steak, lean, grilled", 100, "a small steak"],
  ["18-494", "Lamb's liver, fried", 100, "a portion"],
  ["16-424", "Sardines, canned in brine, drained", 90, "a small tin"],
  ["16-394", "Mackerel, grilled", 100, "a fillet"],
  ["16-418", "Red salmon, canned in brine, drained", 100, "a portion"],
  ["16-420", "Pink salmon, canned in brine, drained", 100, "a portion"],
  ["16-176", "Herring, grilled", 100, "a fillet"],
  ["12-940", "Eggs, boiled", 100, "2 eggs"],
  ["12-313", "Milk, semi-skimmed", 200, "a glass (200 ml)"],
  ["13-661", "Lentils, green or brown, boiled", 150, "a portion"],
  ["13-660", "Red kidney beans, canned, drained", 120, "a portion"],
  ["13-571", "Tofu, steamed then fried", 100, "a portion"],
  ["14-842", "Pumpkin seeds", 30, "a small handful"],
  ["13-573", "Spinach, boiled", 80, "a portion"],
  ["13-503", "Broccoli, boiled", 80, "a portion"],
  ["13-630", "Brussels sprouts, boiled", 80, "a portion"],
  ["13-524", "Red pepper, raw", 80, "half a pepper"],
  ["14-371", "Kiwi fruit", 75, "one kiwi"],
  ["14-324", "Strawberries", 80, "a portion"],
  ["14-327", "Orange", 130, "one orange"],
  ["11-788", "Porridge oats (dry)", 40, "a bowl's worth"],
];

function parse(v) {
  if (v === null || v === undefined || v === "" || v === "-") return null; // not in the table
  if (v === "N") return null; // present but not measured
  if (v === "Tr") return 0; // trace
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

const bySheet = new Map();
for (const [, [name]] of Object.entries(NUTRIENTS)) if (!bySheet.has(name)) bySheet.set(name, sheet(name));

const foods = [];
for (const [code, name, grams, label] of FOODS) {
  const per100g = {};
  let cofidName;
  for (const [id, [sheetName, col]] of Object.entries(NUTRIENTS)) {
    const rows = bySheet.get(sheetName);
    const c = rows[1].indexOf(col);
    const row = rows.find((r) => r[0] === code);
    if (!row) throw new Error(`food ${code} not in ${sheetName}`);
    cofidName = row[1];
    const val = parse(row[c]);
    if (val !== null) per100g[id] = val;
  }
  // Long-chain omega-3: only when both EPA and DHA were measured.
  if (per100g.epa !== undefined && per100g.dha !== undefined) per100g.epaDha = Math.round((per100g.epa + per100g.dha) * 100) / 100;
  delete per100g.epa;
  delete per100g.dha;
  foods.push({ id: code, name, cofidName, portion: { grams, label }, per100g });
}

const nutrients = Object.fromEntries(
  Object.entries(NUTRIENTS)
    .filter(([id]) => id !== "epa" && id !== "dha")
    .map(([id, [, , unit, label]]) => [id, { label, unit }]),
);
nutrients.epaDha = { label: "Omega-3 EPA + DHA", unit: "g" };

const out = {
  source: {
    name: "McCance and Widdowson's Composition of Foods Integrated Dataset (CoFID) 2021",
    publisher: "Public Health England / UK Government",
    url: "https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid",
    licence: "Open Government Licence v3.0",
    notes:
      "Values per 100 g edible portion. 'Tr' (trace) stored as 0. Nutrients that were not measured ('N') or not listed are left out, never guessed. Portions are examples chosen for this app, not from CoFID.",
  },
  nutrients,
  foods,
};
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${foods.length} foods`);
for (const f of foods) console.log(f.id, f.name, JSON.stringify(f.per100g));
