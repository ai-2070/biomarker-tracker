/**
 * Developer-only official period life tables. Eurostat covers EU/EFTA; release-pinned national
 * importers cover the US, UK, Canada, Australia, New Zealand and Japan. The app ships the validated
 * countries.json artifact and makes no calls to these statistical offices.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LIFE_TABLE_COUNTRIES, validateLifeTables, type LifeTableCountry, type LifeTableFile } from "../../src/core/lifeTable";
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
  const countries: Record<string, LifeTableCountry> = {};
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
    countries[geo] = {
      name,
      source: {
        name: "Eurostat",
        url: "https://ec.europa.eu/eurostat/databrowser/view/demo_mlifetable/default/table",
        retrieved: new Date().toISOString().slice(0, 10),
        period: { from: year, to: year },
      },
      tables,
    };
    console.log(geo, year, Object.keys(tables).join(","));
  }
  return countries;
}

if (import.meta.main) {
  const cache = resolve(process.env.BT_LIFETABLE_CACHE ?? join(tmpdir(), "biomarker-life-tables"));
  const output = join(cache, "national.json");
  const national = spawn(process.env.PYTHON ?? "python", [
    join(import.meta.dirname, "national.py"),
    "--cache", cache,
    "--output", output,
  ], { stdio: "inherit" });
  const completed = new Promise<number>((resolve, reject) => {
    national.once("error", reject);
    national.once("close", (code) => resolve(code ?? 1));
  });
  const [countries, exit] = await Promise.all([collectCountries(), completed]);
  if (exit !== 0) throw new Error(`National table import failed (${exit}); existing artifact was not replaced`);
  const additions = JSON.parse(readFileSync(output, "utf8")) as Record<string, LifeTableCountry>;
  for (const code of Object.keys(additions)) {
    if (countries[code]) throw new Error(`Duplicate country ${code}; existing artifact was not replaced`);
  }
  const out: LifeTableFile = {
    note: "Official period life tables, normalized to 100,000 births. lx contains survivors at exact ages 0–95; e95 is the source's remaining mean at 95. The app joins whole ages linearly and approximates survival after 95 exponentially. Rates are held constant at the source reporting period; this is not an individual prediction.",
    countries: { ...countries, ...additions },
  };
  const errors = validateLifeTables(out);
  for (const code of Object.keys(LIFE_TABLE_COUNTRIES)) {
    if (!out.countries[code]) errors.push(`${code}: missing supported country`);
  }
  if (errors.length) throw new Error(`${errors.join("; ")}; existing artifact was not replaced`);
  const destination = join(ROOT, "knowledge", "lifetables", "countries.json");
  mkdirSync(join(ROOT, "knowledge", "lifetables"), { recursive: true });
  const staging = `${destination}.tmp-${process.pid}`;
  writeFileSync(staging, JSON.stringify(out));
  renameSync(staging, destination);
  console.log("saved", Object.keys(out.countries).length, "country references");
}
