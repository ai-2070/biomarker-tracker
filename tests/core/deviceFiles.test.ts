import { describe, expect, it } from "vitest";
import {
  DailyTally,
  appleRecords,
  columnReadings,
  dailyAverages,
  findDateColumn,
  guessColumn,
  parseCsv,
  safeCut,
  tableOf,
  toIsoDate,
} from "../../src/core/importers/deviceFiles";

// Synthetic files shaped like real exports; no real person's data.

const takeout = `Date,Move Minutes count,Average heart rate (bpm),Max heart rate (bpm),Min heart rate (bpm),Average weight (kg)
2026-03-01,45,72.4,141,55,68.2
2026-03-02,30,70.1,120,54,
2026-03-03,12,,,,68.0
`;

const samsung = `com.samsung.shealth.tracker.heart_rate,6302004,4
com.samsung.health.heart_rate.create_time,com.samsung.health.heart_rate.start_time,com.samsung.health.heart_rate.heart_rate,com.samsung.health.heart_rate.min,com.samsung.health.heart_rate.max,com.samsung.health.heart_rate.heart_beat_count
2026-03-01 08:10:00.000,2026-03-01 08:00:00.000,70,60,80,1
2026-03-01 20:10:00.000,2026-03-01 20:00:00.000,80,70,90,1
2026-03-02 08:10:00.000,2026-03-02 08:00:00.000,66,60,70,1
`;

const oura = `date;Average Resting Heart Rate;Lowest Resting Heart Rate;Average HRV;Average Oxygen Saturation
01.03.2026;58;52;44;0.97
02.03.2026;57;51;47;0.96
`;

describe("CSV", () => {
  it("reads quotes, separators and a BOM", () => {
    expect(parseCsv('﻿a,"b, c",d\n1,"say ""hi""",3\r\n')).toEqual([
      ["a", "b, c", "d"],
      ["1", 'say "hi"', "3"],
    ]);
    expect(parseCsv("a;b\n1,5;2")).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
  });
  it("skips Samsung's description line and column prefixes", () => {
    const t = tableOf(parseCsv(samsung))!;
    expect(t.headers).toEqual(["create time", "start time", "heart rate", "min", "max", "heart beat count"]);
    expect(t.data).toHaveLength(3);
  });
});

describe("recognising columns", () => {
  it("maps averages and skips maxima, minima and counts", () => {
    const g = (h: string) => guessColumn(h, 0);
    expect(g("Average heart rate (bpm)")?.field).toBe("heart_rate");
    expect(g("Max heart rate (bpm)")).toMatchObject({ field: null });
    expect(g("Average weight (kg)")).toMatchObject({ field: "weight", unit: "kg" });
    expect(g("Weight (lbs)")).toMatchObject({ field: "weight", unit: "lb" });
    expect(g("Average Resting Heart Rate")?.field).toBe("resting_hr");
    expect(g("Lowest Resting Heart Rate")).toMatchObject({ field: null });
    expect(g("Average HRV")?.field).toBe("hrv");
    expect(g("Nightly HRV (rmssd)")?.field).toBe("hrv_resting");
    expect(g("HRV SDNN")).toMatchObject({ field: null });
    expect(g("Average Oxygen Saturation")?.field).toBe("spo2");
    expect(g("Workout average heart rate")?.field).toBe("exercise_hr");
    expect(g("Move Minutes count")).toBeUndefined();
    expect(g("Lean body mass")).toBeUndefined();
  });
  it("finds the date column", () => {
    const t = tableOf(parseCsv(takeout))!;
    expect(findDateColumn(t.headers, t.data)).toBe(0);
    const s = tableOf(parseCsv(samsung))!;
    expect(s.headers[findDateColumn(s.headers, s.data)]).toBe("start time");
  });
  it("reads dates as files write them", () => {
    expect(toIsoDate("2026-03-01 08:00:00.000")).toBe("2026-03-01");
    expect(toIsoDate("01.03.2026")).toBe("2026-03-01");
    expect(toIsoDate("03/01/2026", true)).toBe("2026-03-01");
    expect(toIsoDate("2026-02-30")).toBeUndefined();
    expect(toIsoDate("nonsense")).toBeUndefined();
  });
});

describe("daily values", () => {
  it("averages each day and drops impossible readings", () => {
    const t = tableOf(parseCsv(samsung))!;
    const g = guessColumn("heart rate", 2)!;
    const s = dailyAverages("heart_rate", "bpm", "heart rate", [...columnReadings(t.data, 1, g), { date: "2026-03-03", value: 900 }], (v) => v);
    expect(s.days).toEqual([
      { date: "2026-03-01", value: 75, readings: 2 },
      { date: "2026-03-02", value: 66, readings: 1 },
    ]);
    expect(s.dropped).toBe(1);
  });
  it("turns blood oxygen fractions into percentages", () => {
    const t = tableOf(parseCsv(oura))!;
    const g = guessColumn(t.headers[4]!, 4)!;
    expect(columnReadings(t.data, 0, g)).toEqual([
      { date: "2026-03-01", value: 97 },
      { date: "2026-03-02", value: 96 },
    ]);
  });
  it("skips empty cells", () => {
    const t = tableOf(parseCsv(takeout))!;
    expect(columnReadings(t.data, 0, guessColumn(t.headers[5]!, 5)!).map((r) => r.date)).toEqual(["2026-03-01", "2026-03-03"]);
  });
});

describe("Apple Health", () => {
  const xml = `<HealthData>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" creationDate="2026-03-01 08:01:00 +0100" startDate="2026-03-01 08:00:00 +0100" endDate="2026-03-01 08:00:00 +0100" value="71"/>
 <Record type="HKQuantityTypeIdentifierOxygenSaturation" unit="%" startDate="2026-03-01 03:00:00 +0100" endDate="2026-03-01 03:00:00 +0100" value="0.96"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" unit="ms" startDate="2026-03-01 03:00:00 +0100" value="48">
  <HeartRateVariabilityMetadataList></HeartRateVariabilityMetadataList>
 </Record>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-03-01 09:00:00 +0100" value="120"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2026-03-01 18:00:00 +0100">
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-03-01 18:00:00 +0100" endDate="2026-03-01 18:40:00 +0100" average="142" minimum="95" maximum="171" unit="count/min"/>
 </Workout>
</HealthData>`;
  it("reads heart rate, blood oxygen and workouts, and says why SDNN is skipped", () => {
    const skipped = new Map<string, string>();
    const r = appleRecords(xml, skipped);
    expect(r.map((x) => [x.field, x.date, x.value, x.unit])).toEqual([
      ["heart_rate", "2026-03-01", 71, "bpm"],
      ["spo2", "2026-03-01", 96, "%"],
      ["exercise_hr", "2026-03-01", 142, "bpm"],
    ]);
    expect([...skipped.keys()]).toEqual(["HeartRateVariabilitySDNN"]);
  });
  it("cuts pieces after a complete record", () => {
    const piece = xml.slice(0, 300);
    const cut = safeCut(piece);
    expect(piece.slice(0, cut).endsWith("/>")).toBe(true);
    expect(cut).toBeLessThanOrEqual(300);
  });
});

describe("daily tally for big files", () => {
  it("keeps a running average per source and day", () => {
    const t = new DailyTally();
    for (const [d, v] of [["2026-03-01", 70], ["2026-03-01", 80], ["2026-03-02", 60], ["2026-03-02", 0]] as const) t.add("HeartRate", "heart_rate", "bpm", d, v, (x) => x);
    const [s] = t.series();
    expect(s!.days).toEqual([
      { date: "2026-03-01", value: 75, readings: 2 },
      { date: "2026-03-02", value: 60, readings: 1 },
    ]);
    expect(s!.dropped).toBe(1);
  });
});
