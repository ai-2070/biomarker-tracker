// Extract every CoFID 2021 food with the nutrients the meal builder shows, into knowledge/foods/cofid-all.json.
// Values copied as published: "Tr" (trace) -> 0; "N" (not measured) or empty -> null (left out, never guessed).
// Usage: node build-all.mjs <cofid xlsx> <output json>

import { writeFileSync } from "node:fs";
import XLSX from "xlsx";

const [xlsxPath, outPath] = process.argv.slice(2);
const wb = XLSX.readFile(xlsxPath);
const rowsOf = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false });

// key -> [sheet, CoFID code, unit, label]. Units checked against the sheets' header rows.
const NUTRIENTS = [
  ["energyKcal", "1.3 Proximates", "KCALS", "kcal", "Energy"],
  ["protein", "1.3 Proximates", "PROT", "g", "Protein"],
  ["fat", "1.3 Proximates", "FAT", "g", "Fat"],
  ["saturatedFat", "1.3 Proximates", "SATFOD", "g", "Saturated fat"],
  ["carbohydrate", "1.3 Proximates", "CHO", "g", "Carbohydrate"],
  ["sugars", "1.3 Proximates", "TOTSUG", "g", "Total sugars"],
  ["fibre", "1.3 Proximates", "AOACFIB", "g", "Fibre (AOAC)"],
  ["sodium", "1.4 Inorganics", "NA", "mg", "Sodium"],
  ["potassium", "1.4 Inorganics", "K", "mg", "Potassium"],
  ["calcium", "1.4 Inorganics", "CA", "mg", "Calcium"],
  ["magnesium", "1.4 Inorganics", "MG", "mg", "Magnesium"],
  ["phosphorus", "1.4 Inorganics", "P", "mg", "Phosphorus"],
  ["iron", "1.4 Inorganics", "FE", "mg", "Iron"],
  ["copper", "1.4 Inorganics", "CU", "mg", "Copper"],
  ["zinc", "1.4 Inorganics", "ZN", "mg", "Zinc"],
  ["selenium", "1.4 Inorganics", "SE", "µg", "Selenium"],
  ["iodine", "1.4 Inorganics", "I", "µg", "Iodine"],
  ["vitaminA", "1.5 Vitamins", "RETEQU", "µg", "Vitamin A (retinol equivalent)"],
  ["retinol", "1.5 Vitamins", "RET", "µg", "Retinol (preformed vitamin A)"],
  ["vitaminD", "1.5 Vitamins", "VITD", "µg", "Vitamin D"],
  ["vitaminE", "1.5 Vitamins", "VITE", "mg", "Vitamin E"],
  ["vitaminK1", "1.5 Vitamins", "VITK1", "µg", "Vitamin K1"],
  ["thiamin", "1.5 Vitamins", "THIA", "mg", "Thiamin (B1)"],
  ["riboflavin", "1.5 Vitamins", "RIBO", "mg", "Riboflavin (B2)"],
  ["niacin", "1.5 Vitamins", "NIACEQU", "mg", "Niacin equivalent (B3)"],
  ["vitaminB6", "1.5 Vitamins", "VITB6", "mg", "Vitamin B6"],
  ["vitaminB12", "1.5 Vitamins", "VITB12", "µg", "Vitamin B12"],
  ["folate", "1.5 Vitamins", "FOLT", "µg", "Folate"],
  ["vitaminC", "1.5 Vitamins", "VITC", "mg", "Vitamin C"],
];
const UNIT_IN_NAME = { kcal: "(kcal)", g: "(g)", mg: "(mg)", µg: "(µg)" };

function parse(v) {
  if (v === null || v === undefined || v === "" || v === "-" || v === "N") return null;
  if (v === "Tr") return 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

const sheets = new Map();
for (const [, s] of NUTRIENTS) if (!sheets.has(s)) sheets.set(s, rowsOf(s));
sheets.set("1.12 (PUFA per 100gFood)", rowsOf("1.12 (PUFA per 100gFood)"));

// Check every column's code and unit in the header before reading anything.
const col = new Map();
for (const [key, s, code, unit] of NUTRIENTS) {
  const rows = sheets.get(s);
  const i = rows[1].indexOf(code);
  if (i < 0) throw new Error(`${code} not in ${s}`);
  if (!String(rows[0][i]).includes(UNIT_IN_NAME[unit])) throw new Error(`${code} in ${s} is "${rows[0][i]}", expected unit ${unit}`);
  col.set(key, [s, i]);
}
const pufa = sheets.get("1.12 (PUFA per 100gFood)");
const epaCol = pufa[1].indexOf("FOD20:5cn3");
const dhaCol = pufa[1].indexOf("FOD22:6cn3");
if (epaCol < 0 || dhaCol < 0) throw new Error("EPA/DHA columns missing");

// Rows are matched by position, not by code: CoFID 2021 uses one code (13-669) for two foods.
// Every sheet lists the foods in the same order; each row's code and name are checked to agree.
const all = sheets.get("1.3 Proximates");
const rowsAt = (n, i) => {
  const r = sheets.get(n)[i];
  if (!r || r[0] !== all[i][0] || String(r[1]).trim() !== String(all[i][1]).trim()) throw new Error(`row ${i} differs in ${n}`);
  return r;
};
const baseIdx = all.map((_r, i) => i).filter((i) => i >= 3 && typeof all[i][0] === "string" && /^\d+-\d+$/.test(all[i][0]));

const keys = [...NUTRIENTS.map((n) => n[0]), "epaDha"];
const foods = [];
const seen = new Map();
for (const ri of baseIdx) {
  const r = all[ri];
  const values = NUTRIENTS.map(([key]) => {
    const [s, i] = col.get(key);
    return parse(rowsAt(s, ri)[i]);
  });
  const p = sheets.get("1.12 (PUFA per 100gFood)")[ri]?.[0] === r[0] ? rowsAt("1.12 (PUFA per 100gFood)", ri) : null;
  const epa = p ? parse(p[epaCol]) : null;
  const dha = p ? parse(p[dhaCol]) : null;
  values.push(epa !== null && dha !== null ? Math.round((epa + dha) * 1000) / 1000 : null);
  // A repeated code gets a suffix, so every food has its own id.
  const count = (seen.get(r[0]) ?? 0) + 1;
  seen.set(r[0], count);
  foods.push([count === 1 ? r[0] : `${r[0]}-${count}`, String(r[1]).trim(), values]);
}

const out = {
  source: {
    name: "McCance and Widdowson's Composition of Foods Integrated Dataset (CoFID) 2021",
    publisher: "Public Health England / UK Government",
    url: "https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid",
    licence: "Open Government Licence v3.0",
    notes:
      "Every food in CoFID 2021, values per 100 g edible portion. 'Tr' (trace) stored as 0. Values not measured ('N') or not listed are null: left out, never guessed. EPA + DHA only when both were measured. CoFID uses code 13-669 twice; the second food is 13-669-2.",
  },
  nutrients: Object.fromEntries([...NUTRIENTS.map(([k, , , unit, label]) => [k, { label, unit }]), ["epaDha", { label: "Omega-3 EPA + DHA", unit: "g" }]]),
  keys,
  foods,
};
writeFileSync(outPath, `${JSON.stringify(out)}\n`);
const measured = keys.map((k, i) => `${k}:${foods.filter((f) => f[2][i] !== null).length}`).join(" ");
console.log(`wrote ${foods.length} foods`);
console.log(measured);
