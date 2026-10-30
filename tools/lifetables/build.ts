/**
 * Life tables for the "Best before" range: survivors at each exact age (lx, out of 100,000 born) and
 * life expectancy at 95 (for ages past the table's open 95+ group), by sex, for every EU and EFTA
 * country and the EU average, latest year available. From Eurostat's demo_mlifetable. A developer
 * tool (`bun tools/lifetables/build.ts`): the app ships only knowledge/lifetables/eurostat.json and
 * never calls Eurostat.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_mlifetable";
const GEOS: Record<string, string> = {
  EU27_2020: "European Union (27 countries)",
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus", CZ: "Czechia", DK: "Denmark", EE: "Estonia", FI: "Finland",
  FR: "France", DE: "Germany", EL: "Greece", HU: "Hungary", IE: "Ireland", IT: "Italy", LV: "Latvia", LT: "Lithuania", LU: "Luxembourg",
  MT: "Malta", NL: "Netherlands", PL: "Poland", PT: "Portugal", RO: "Romania", SK: "Slovakia", SI: "Slovenia", ES: "Spain", SE: "Sweden",
  IS: "Iceland", LI: "Liechtenstein", NO: "Norway", CH: "Switzerland",
};
const AGES = ["Y_LT1", ...Array.from({ length: 94 }, (_, i) => `Y${i + 1}`), "Y_GE95"];

interface JsonStat {
  id: string[];
  size: number[];
  value: Record<string, number>;
  dimension: Record<string, { category: { index: Record<string, number> } }>;
}

/** One value from a JSON-stat response by its category codes. */
function valueAt(d: JsonStat, codes: Record<string, string>): number | undefined {
  let index = 0;
  for (let k = 0; k < d.id.length; k++) {
    const dim = d.id[k]!;
    const pos = d.dimension[dim]!.category.index[codes[dim]!] ?? (d.size[k] === 1 ? 0 : undefined);
    if (pos === undefined) return undefined;
    index = index * d.size[k]! + pos;
  }
  return d.value[String(index)];
}

/** Download all supported countries or fail before the caller can publish a replacement. */
export async function collectCountries(fetcher: typeof fetch = fetch, geos: Record<string, string> = GEOS) {
  const countries: Record<string, { name: string; year: number; tables: Record<string, { lx: number[]; e95: number }> }> = {};
  for (const [geo, name] of Object.entries(geos)) {
    // The last 3 years: the newest one isn't always complete for every age (the Netherlands, 2024).
    const params = new URLSearchParams({ geo, lastTimePeriod: "3", format: "JSON", lang: "EN" });
    for (const s of ["F", "M", "T"]) params.append("sex", s);
    for (const i of ["SURVIVORS", "LIFEXP"]) params.append("indic_de", i);
    const res = await fetcher(`${API}?${params}`);
    if (!res.ok) throw new Error(`${geo}: Eurostat request failed (${res.status}); existing artifact was not replaced`);
    const d = (await res.json()) as JsonStat;
    const years = Object.keys(d.dimension.time!.category.index).map(Number).sort((a, b) => b - a);
    let year = 0;
    let tables: Record<string, { lx: number[]; e95: number }> = {};
    for (const y of years) {
      const t: typeof tables = {};
      for (const sex of ["F", "M", "T"]) {
        const lx = AGES.map((age) => valueAt(d, { freq: "A", indic_de: "SURVIVORS", sex, age, geo, time: String(y) }));
        const e95 = valueAt(d, { freq: "A", indic_de: "LIFEXP", sex, age: "Y_GE95", geo, time: String(y) });
        if (lx.some((v) => v === undefined || !Number.isFinite(v) || v < 0) || e95 === undefined || !Number.isFinite(e95) || e95 <= 0) continue;
        t[sex.toLowerCase()] = { lx: lx as number[], e95 };
      }
      // The newest year with all three tables (women, men, everyone).
      if (Object.keys(t).length === 3) {
        year = y;
        tables = t;
        break;
      }
    }
    if (!year) throw new Error(`${geo}: no complete table; existing artifact was not replaced`);
    countries[geo] = { name, year, tables };
    console.log(geo, year, Object.keys(tables).join(","));
  }
  return countries;
}

if (import.meta.main) {
  const countries = await collectCountries();

  const out = {
    source: "Eurostat, Life table by age and sex (demo_mlifetable)",
    url: "https://ec.europa.eu/eurostat/databrowser/view/demo_mlifetable/default/table",
    retrieved: new Date().toISOString().slice(0, 10),
    note: "lx: survivors at each exact age 0 to 95 out of 100,000 born, for the year's death rates (a period life table). e95: life expectancy at 95.",
    countries,
  };
  mkdirSync(join(ROOT, "knowledge", "lifetables"), { recursive: true });
  writeFileSync(join(ROOT, "knowledge", "lifetables", "eurostat.json"), JSON.stringify(out));
  console.log("saved", Object.keys(countries).length, "countries");
}
