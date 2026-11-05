import { describe, expect, it } from "vitest";
import { compareLifeTables, type LifeTable, type LifeTableFile } from "@bt/core/lifeTable";

const lx = Array.from({ length: 96 }, (_, age) => age <= 60 ? 100_000 : 100_000 - (age - 60) * 2_000);
const table = (e95: number): LifeTable => ({ lx, e95 });
const source = { name: "Official fixture", url: "https://example.org/table", retrieved: "2026-11-01", period: { from: 2024, to: 2024 } };
const file: LifeTableFile = { note: "Synthetic distributions", countries: {
  AT: { name: "Austria", source, tables: { f: table(3), m: table(9), t: table(4) } },
  US: { name: "United States", source, tables: { f: table(6), m: table(2) } },
} };

describe("country life-table comparison", () => {
  it("ranks remaining means at the same current age, using the requested sex", () => {
    const women = compareLifeTables(file, 80, "f");
    expect(women.rows.map((row) => [row.country, row.meanRemainingYears])).toEqual([["US", 14.25], ["AT", 12.75]]);
    expect(women.maxRemainingYears).toBe(14.25);
    const men = compareLifeTables(file, 80, "m");
    expect(men.rows.map((row) => [row.country, row.meanRemainingYears])).toEqual([["AT", 15.75], ["US", 12.25]]);
    expect(compareLifeTables(file, 95, "f").rows.map((row) => row.meanRemainingYears)).toEqual([6, 3]);
  });
  it("uses only official combined-sex tables when sex is unknown and reports omissions", () => {
    const result = compareLifeTables(file, 80, undefined);
    expect(result.rows.map((row) => [row.country, row.meanRemainingYears])).toEqual([["AT", 13.25]]);
    expect(result.missingSex).toEqual([{ country: "US", name: "United States" }]);
  });
  it.each([-1, NaN, Infinity])("does not rank an invalid age: %s", (age) => {
    expect(compareLifeTables(file, age, "f")).toEqual({ rows: [], missingSex: [], maxRemainingYears: 0 });
  });
});
