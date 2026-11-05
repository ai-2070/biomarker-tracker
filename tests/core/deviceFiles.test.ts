import { describe, expect, it } from "vitest";
import {
  DailyTally,
  appleRecords,
  columnReadings,
  dailyAverages,
  findDateColumn,
  guessColumn,
  parseCsv,
  readTable,
  safeCut,
  tableOf,
  toIsoDate,
} from "@bt/shared/core/importers/deviceFiles";

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
    expect(g("Move Minutes count")).toMatchObject({ field: null, reason: expect.stringMatching(/light activity/) });
    expect(g("Lean body mass")).toBeUndefined();
  });
  it.each(["body_fat_mass", "bodyFatMass", "Body fat (kg)", "Fat (kg)", "Fat mass (lb)", "Fat mass (kg)"])("does not import %s as a percentage or total body weight", (header) => {
    const result = readTable("body/weight.csv", tableOf(parseCsv(`date,${header}\n2026-03-01,20\n`))!);
    expect(result.columns).toEqual([
      { header: expect.any(String), field: null, unit: "", reason: expect.any(String), readings: [] },
    ]);
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
      ["steps", "2026-03-01", 120, "steps"],
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

describe("steps and active minutes", () => {
  const g = (h: string, family = "") => guessColumn(h, 0, family);
  it("recognises step columns and skips goals, cadence and averages", () => {
    expect(g("Steps")).toMatchObject({ field: "steps", unit: "steps" });
    expect(g("totalSteps")).toMatchObject({ field: "steps" });
    expect(g("Step count")).toMatchObject({ field: "steps" });
    expect(g("value", "steps")).toMatchObject({ field: "steps" });
    expect(g("Step goal")).toBeUndefined();
    expect(g("Steps per minute")).toBeUndefined();
    expect(g("Average steps")).toBeUndefined();
  });
  it("recognises active minutes, and skips light activity and move minutes", () => {
    expect(g("Active minutes")).toMatchObject({ field: "active_minutes", unit: "min" });
    expect(g("Intensity Minutes")).toMatchObject({ field: "active_minutes" });
    expect(g("Exercise time (min)")).toMatchObject({ field: "active_minutes", unit: "min" });
    expect(g("Active Zone Minutes")).toMatchObject({ field: "active_minutes" });
    expect(g("Minutes Lightly Active")).toMatchObject({ field: null });
    expect(g("Minutes Sedentary")).toMatchObject({ field: null });
    expect(g("Exercise heart rate")?.field).toBe("exercise_hr");
    expect(g("Activity calories")).toBeUndefined();
  });
  it("adds up Fitbit's fairly and very active minutes, with steps from the same file", () => {
    const csv = "Date,Steps,Minutes Sedentary,Minutes Lightly Active,Minutes Fairly Active,Minutes Very Active\n2026-03-01,8412,600,180,20,15\n2026-03-02,10240,580,200,10,40";
    const r = readTable("Fitbit/activities.csv", tableOf(parseCsv(csv))!);
    const by = (f: string) => r.columns.find((c) => c.field === f)!;
    expect(by("steps").readings.map((x) => x.value)).toEqual([8412, 10240]);
    expect(by("active_minutes")).toMatchObject({ unit: "min" });
    expect(by("active_minutes").readings.map((x) => x.value)).toEqual([35, 50]);
  });
  it("counts Garmin's vigorous minutes twice, as Garmin and the WHO do", () => {
    const csv = "Date,Steps,Moderate Intensity Minutes,Vigorous Intensity Minutes\n2026-03-01,7000,20,10";
    const r = readTable("Garmin/daily.csv", tableOf(parseCsv(csv))!);
    expect(r.columns.find((c) => c.field === "active_minutes")!.readings[0]!.value).toBe(40);
  });
  it("reads Oura's activity time in seconds", () => {
    const csv = "day,steps,high_activity_time,medium_activity_time,low_activity_time\n2026-03-01,9100,600,1800,9000\n2026-03-02,7400,0,1500,8000";
    const r = readTable("oura/daily_activity.csv", tableOf(parseCsv(csv))!);
    const active = r.columns.find((c) => c.field === "active_minutes")!;
    expect(active.unit).toBe("s");
    expect(active.readings.map((x) => x.value)).toEqual([2400, 1500]);
  });
  it("adds a day's step counts per device, so a phone and a watch aren't counted twice", () => {
    const xml = `<HealthData>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-03-01 09:00:00 +0100" value="1200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-03-01 17:00:00 +0100" value="3000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" startDate="2026-03-01 09:00:00 +0100" value="1300"/>
 <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="min" startDate="2026-03-01 18:00:00 +0100" value="25"/>
 <Record type="HKQuantityTypeIdentifierAppleExerciseTime" sourceName="Apple Watch" unit="min" startDate="2026-03-01 19:00:00 +0100" value="8"/>
</HealthData>`;
    const tally = new DailyTally();
    for (const x of appleRecords(xml, new Map())) tally.add(x.key, x.field, x.unit, x.date, x.value, (v) => v);
    const series = Object.fromEntries(tally.series().map((s) => [s.from, s.days.map((d) => d.value)]));
    expect(series).toEqual({ "Steps (iPhone)": [4200], "Steps (Apple Watch)": [1300], "Exercise minutes (Apple Watch)": [33] });
  });
  it("leaves out days with no steps at all (the device wasn't worn)", () => {
    const s = dailyAverages("steps", "steps", "Steps", [{ date: "2026-03-01", value: 0 }, { date: "2026-03-02", value: 6500 }], (v) => v);
    expect(s.days.map((d) => d.date)).toEqual(["2026-03-02"]);
    expect(s.dropped).toBe(1);
  });
});
