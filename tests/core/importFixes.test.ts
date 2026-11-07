import { appleRecords, DailyTally, dailyAverages, jsonTable, parseCsv, readTable, safeCut, tableOf, toIsoDate } from "@bt/shared/core/importers/deviceFiles";
import { parseLabText } from "@bt/shared/core/importers/labText";
import { validateManualEntry } from "@bt/shared/core/importers/manual";
import { matchUnit, toCanonical } from "@bt/shared/core/units";
import { describe, expect, it } from "vitest";
import { loadDefs } from "../helpers";

const defs = loadDefs();
const canonical = (field: string, unit: string) => {
  const def = defs.get(field)!;
  const matched = matchUnit(def, unit);
  return (value: number) => (matched ? toCanonical(def, value, matched) : NaN);
};
const csv = (path: string, text: string) => readTable(path, tableOf(parseCsv(text))!);
const sleep = (stage: string, start: string, end: string, source = "Watch") =>
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysis${stage}" startDate="2026-03-${start} +0100" endDate="2026-03-${end} +0100" sourceName="${source}"/>`;

describe("import review data regressions", () => {
  it("normalizes mixed Apple units both within and across days before the review/save conversion", () => {
    const tally = new DailyTally();
    const xml = [
      '<Record type="HKQuantityTypeIdentifierBodyMass" value="70" unit="kg" startDate="2026-03-01 08:00:00 +0100"/>',
      '<Record type="HKQuantityTypeIdentifierBodyMass" value="154.3" unit="lb" startDate="2026-03-02 08:00:00 +0100"/>',
      '<Record type="HKQuantityTypeIdentifierBodyMass" value="70" unit="kg" startDate="2026-03-02 09:00:00 +0100"/>',
    ].join("");
    for (const r of appleRecords(xml, new Map())) tally.addApple(r, canonical(r.field, r.unit));
    const series = tally.series()[0]!;
    expect(series.unit).toBe("kg");
    expect(series.days.map((r) => canonical(series.field, series.unit)(r.value))).toEqual([70, 70]);
    const reverse = new DailyTally();
    reverse.add("Weight", "weight", "lb", "2026-03-01", 154.3, canonical("weight", "lb"));
    reverse.add("Weight", "weight", "kg", "2026-03-01", 70, canonical("weight", "kg"));
    const reversed = reverse.series()[0]!;
    expect(canonical("weight", reversed.unit)(reversed.days[0]!.value)).toBeCloseTo(70, 1);
  });

  it("groups contiguous sleep stages across chunks and midnight, but retains naps and separate devices", () => {
    const xml =
      sleep("AsleepCore", "01 23:00:00", "01 23:30:00") +
      sleep("AsleepDeep", "01 23:30:00", "02 07:00:00") +
      sleep("Asleep", "02 14:00:00", "02 15:00:00") +
      sleep("Asleep", "01 21:00:00", "01 22:00:00", "Phone");
    const tally = new DailyTally();
    let carry = "";
    for (let offset = 0; offset < xml.length; offset += 113) {
      const text = carry + xml.slice(offset, offset + 113);
      const cut = safeCut(text);
      for (const r of appleRecords(text.slice(0, cut), new Map())) tally.addApple(r, canonical(r.field, r.unit));
      carry = text.slice(cut);
    }
    expect(carry).toBe("");
    const series = Object.fromEntries(tally.series().map((s) => [s.from, s.days]));
    expect(series["Sleep (Watch)"]!.map(({ date, value, readings }) => ({ date, value, readings }))).toEqual([{ date: "2026-03-02", value: 9, readings: 3 }]);
    expect(series["Deep sleep (Watch)"]).toEqual([{ date: "2026-03-02", value: 7.5, readings: 1 }]);
    expect(series["Sleep (Phone)"]!.map(({ date, value, readings }) => ({ date, value, readings }))).toEqual([{ date: "2026-03-01", value: 1, readings: 1 }]);
    expect(series["Sleep (Watch)"]![0]!.sleepSessions).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(series))).toEqual(series);
    expect(tally.series()).toEqual(tally.series());
  });

  it("retains Oura's known seconds even on low-activity days", () => {
    const c = csv("oura/daily_activity.csv", "date,medium_activity_time,high_activity_time\n2026-03-01,180,60\n").columns.find(
      (c) => c.field === "active_minutes",
    )!;
    expect(c.unit).toBe("s");
    const s = dailyAverages("active_minutes", c.unit, c.header, c.readings, canonical("active_minutes", c.unit));
    expect(canonical("active_minutes", s.unit)(s.days[0]!.value)).toBe(4);
  });

  it("resolves unambiguous device dates independently of browser locale", () => {
    expect(toIsoDate("12/31/2025", false)).toBe("2025-12-31");
    expect(toIsoDate("31/12/2025", true)).toBe("2025-12-31");
    expect(toIsoDate("31/12/25", true)).toBe("2025-12-31");
    expect(toIsoDate("12/31/25", false)).toBe("2025-12-31");
    expect(toIsoDate("05/06/2025", false)).toBe("2025-06-05");
    expect(toIsoDate("05/06/2025", true)).toBe("2025-05-06");
    expect(toIsoDate("31/31/2025", false)).toBeUndefined();
  });

  it("reads grouped integer steps without breaking decimal-comma continuous measurements", () => {
    const columns = csv(
      "activities.csv",
      'Date,Steps,Weight (kg)\n2026-03-01,"8,120","70,5"\n2026-03-02,"8.120",71\n2026-03-03,"8,12",72\n2026-03-04,8120.0,72.5\n',
    ).columns;
    expect(columns.find((c) => c.field === "steps")!.readings.map((r) => r.value)).toEqual([8120, 8120, 8120]);
    expect(columns.find((c) => c.field === "weight")!.readings.map((r) => r.value)).toEqual([70.5, 71, 72, 72.5]);
  });

  it("preserves JSON measurement fields introduced after the first 500 records", () => {
    const table = jsonTable([...Array.from({ length: 500 }, () => ({ date: "2026-03-01", restingHeartRate: 60 })), { date: "2026-03-02", weight: 70 }])!;
    const weight = readTable("device.json", table).columns.find((c) => c.field === "weight");
    expect(weight?.readings).toEqual([{ date: "2026-03-02", value: 70 }]);
  });

  it("decodes XML named and numeric entities before Apple unit and device lookup", () => {
    const tally = new DailyTally();
    const xml =
      '<Record type="HKQuantityTypeIdentifierBloodGlucose" value="5.4" unit="mmol&lt;180.1558800000541&gt;/L" startDate="2026-03-01 08:00:00 +0100"/>' +
      '<Record type="HKQuantityTypeIdentifierStepCount" value="100" unit="count" sourceName="Watch &amp; phone &#x41;&#66;" startDate="2026-03-01 08:00:00 +0100"/>';
    for (const r of appleRecords(xml, new Map())) tally.addApple(r, canonical(r.field, r.unit));
    expect(tally.series().map((s) => [s.field, s.unit, s.days[0]?.value, s.dropped])).toEqual([
      ["glucose_home", "mmol/L", 5.4, 0],
      ["steps", "steps", 100, 0],
    ]);
    expect(tally.series()[1]!.from).toBe("Steps (Watch & phone AB)");
  });

  it("ignores quoted punctuation when detecting CSV separators", () => {
    expect(parseCsv('Date;"Weight, kg"\n2026-03-01;70')).toEqual([
      ["Date", "Weight, kg"],
      ["2026-03-01", "70"],
    ]);
    expect(csv("scale.csv", 'Date;"Weight, kg"\n2026-03-01;70').columns[0]).toMatchObject({
      field: "weight",
      unit: "kg",
      readings: [{ date: "2026-03-01", value: 70 }],
    });
  });

  it("preserves the SpO2 abbreviation through camel-case normalization", () => {
    expect(csv("oximeter.csv", "Date,SpO2\n2026-03-01,97").columns).toMatchObject([
      { field: "spo2", unit: "%", readings: [{ date: "2026-03-01", value: 97 }] },
    ]);
  });

  it("reconciles overlapping daily summaries by file provenance while keeping equal incremental samples", () => {
    const first = csv("activities-2026-03-01.csv", "Date,Steps\n2026-03-01,8000").columns[0]!;
    const second = csv("activities-2026-03-02.csv", "Date,Steps\n2026-03-01,8000\n2026-03-02,9000").columns[0]!;
    const s = dailyAverages("steps", "steps", "Steps", [...first.readings, ...second.readings], (v) => v);
    expect(s.days).toEqual([
      { date: "2026-03-01", value: 8000, readings: 1 },
      { date: "2026-03-02", value: 9000, readings: 1 },
    ]);
    expect(s.reconciled).toBe(1);
    const increments = csv("activities-2026-03-03.csv", "Timestamp,Steps\n2026-03-03 08:00:00,100\n2026-03-03 09:00:00,100").columns[0]!;
    expect(dailyAverages("steps", "steps", "Steps", increments.readings, (v) => v).days).toEqual([{ date: "2026-03-03", value: 200, readings: 2 }]);
    const separateTime = csv("activities.csv", "Date,Time,Steps\n2026-03-03,08:00,100\n2026-03-03,09:00,100").columns[0]!;
    expect(dailyAverages("steps", "steps", "Steps", separateTime.readings, (v) => v).days[0]!.value).toBe(200);
  });

  it("prefers daily summaries over overlapping detailed samples and exposes reconciled rows", () => {
    const summary = csv("activity-summary.csv", "Date,Steps\n2026-03-01,8000").columns[0]!;
    const samples = csv("activity-samples.csv", "Timestamp,Steps\n2026-03-01 09:00:00,4000\n2026-03-01 12:00:00,4000").columns[0]!;
    const s = dailyAverages("steps", "steps", "Steps", [...samples.readings, ...summary.readings], (v) => v);
    expect(s.days).toEqual([{ date: "2026-03-01", value: 8000, readings: 1 }]);
    expect(s.reconciled).toBe(2);
  });

  it("retains spaced ASCII inclusive comparators through lab parsing and save validation", () => {
    for (const [printed, qualifier] of [
      ["<=", "<"],
      [">=", ">"],
    ] as const) {
      const report = parseLabText(`Collected: 2026-03-01\nC-reactive protein ${printed} 0.3 mg/L`, [...defs.values()]);
      const row = report.rows[0]!;
      const result = validateManualEntry({ biomarkerId: row.biomarkerId!, value: row.value, unit: row.unit!, date: report.date! }, defs, "2026-10-30", "pdf");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.measurement.qualifier).toBe(qualifier);
    }
  });

  it("prioritizes collection over receipt dates and warns about fallback or conflicting collection dates", () => {
    const result = "\nFerritin 45 µg/L 15 - 150";
    const report = parseLabText("Specimen received: 2026-10-12\nCollected: 2026-10-10" + result, [...defs.values()]);
    expect(report.date).toBe("2026-10-10");
    expect(report.dateNote).toBeUndefined();
    for (const line of ["Probenentnahme: 12.05.2024 08:15   Eingang: 13.05.2024 10:02", "Eingang: 13.05.2024 10:02   Probenentnahme: 12.05.2024 08:15"]) {
      const combined = parseLabText(line + result, [...defs.values()]);
      expect(combined.date).toBe("2024-05-12");
      expect(combined.dateNote).toBeUndefined();
    }
    expect(parseLabText("Specimen received: 2026-10-12" + result, [...defs.values()]).dateNote).toMatch(/No collection date/);
    const ambiguous = parseLabText("Collected: 2026-10-10\nCollected: 2026-10-11" + result, [...defs.values()]);
    expect(ambiguous.dateNote).toMatch(/Several collection dates/);
    const slash = parseLabText("Collected: 05/06/2026" + result, [...defs.values()]);
    expect(slash.dateNote).toMatch(/day\/month/);
  });
});
