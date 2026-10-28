import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DailyTally, appleRecords, dailyAverages, fileFamily, jsonTable, parseCsv, readTable, sleepUnit, tableOf, toIsoDate } from "../../src/core/importers/deviceFiles";
import { BIOMARKER_MAP } from "../../src/app/knowledge";
import { matchUnit, toCanonical } from "../../src/core/units";
import { zipEntries } from "../../src/core/importers/zipRead";
import { crc32, zipStore } from "../../src/core/zipStore";
import type { BodyField } from "../../src/core/body";

// Synthetic files shaped like each brand's export, from their documented or commonly seen layouts.
// No real person's data. Real exports may differ; the review screen lets people remap anything.

/** What a file gives: field → [date, daily value][] (same steps as the import page). */
function read(path: string, table: { headers: string[]; data: string[][] }): Partial<Record<BodyField, [string, number][]>> {
  const out: Partial<Record<BodyField, [string, number][]>> = {};
  for (const c of readTable(path, table).columns) {
    if (!c.field) continue;
    const def = BIOMARKER_MAP.get(c.field)!;
    const u = matchUnit(def, c.unit);
    const s = dailyAverages(c.field, c.unit, c.header, c.readings, (v) => (u ? toCanonical(def, v, u) : NaN));
    if (s.days.length) out[c.field] = s.days.map((d) => [d.date, d.value]);
  }
  return out;
}
const csv = (path: string, text: string) => read(path, tableOf(parseCsv(text))!);
const json = (path: string, value: unknown) => read(path, jsonTable(value)!);

describe("Fitbit (Google Takeout)", () => {
  it("reads heart rate samples and resting heart rate from JSON", () => {
    expect(
      json("Takeout/Fitbit/Global Export Data/heart_rate-2026-03-01.json", [
        { dateTime: "03/01/26 08:00:05", value: { bpm: 70, confidence: 2 } },
        { dateTime: "03/01/26 08:00:10", value: { bpm: 74, confidence: 3 } },
      ]),
    ).toEqual({ heart_rate: [["2026-03-01", 72]] });
    expect(
      json("Takeout/Fitbit/Global Export Data/resting_heart_rate-2026-03-01.json", [{ dateTime: "03/01/26 00:00:00", value: { date: "03/01/26", value: 58.4, error: 6.2 } }]),
    ).toEqual({ resting_hr: [["2026-03-01", 58.4]] });
  });
  it("reads weight with body fat, nightly HRV and daily SpO2", () => {
    expect(json("Global Export Data/weight-2026-03-01.json", [{ logId: 1, weight: 68.2, bmi: 24.1, fat: 29.5, date: "03/01/26", time: "07:10:00" }])).toEqual({
      weight: [["2026-03-01", 68.2]],
      body_fat: [["2026-03-01", 29.5]],
    });
    expect(csv("Heart Rate Variability/Daily Heart Rate Variability Summary - 2026-03.csv", "timestamp,rmssd,nremhr,entropy\n2026-03-01T00:00:00,45.2,55.1,2.9\n")).toEqual({
      hrv_resting: [["2026-03-01", 45.2]],
    });
    expect(csv("Oxygen Saturation (SpO2)/Daily SpO2 - 2026-03-01-2026-03-31.csv", "timestamp,average_value,lower_bound,upper_bound\n2026-03-01T00:00:00,96.4,94.0,98.0\n")).toEqual({
      spo2: [["2026-03-01", 96.4]],
    });
  });
});

describe("Garmin (account export)", () => {
  it("reads daily summaries and skips multi-day averages", () => {
    expect(
      json("DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026-03-01_2026-06-01.json", [
        { calendarDate: "2026-03-01", restingHeartRate: 54, minHeartRate: 48, maxHeartRate: 151, lastSevenDaysAvgRestingHeartRate: 55, averageSpo2Value: 96 },
      ]),
    ).toEqual({ resting_hr: [["2026-03-01", 54]], spo2: [["2026-03-01", 96]] });
  });
});

describe("Polar (Flow account data)", () => {
  it("reads a training session's average heart rate", () => {
    expect(
      json("polar-user-data-export/training-session-2026-03-01-123456.json", {
        startTime: "2026-03-01T18:00:00.000",
        exercises: [{ sport: "RUNNING", heartRate: { min: 95, avg: 141, max: 172 } }],
      }),
    ).toEqual({ exercise_hr: [["2026-03-01", 141]] });
  });
});

describe("Huawei Health (data export)", () => {
  it("reads sample points stored as key and value", () => {
    expect(
      json("health detail data.json", [
        {
          type: 7,
          samplePoints: [
            { key: "DATA_POINT_DYNAMIC_HEARTRATE", value: "71", startTime: Date.parse("2026-03-01T09:00:00") },
            { key: "DATA_POINT_DYNAMIC_HEARTRATE", value: "75", startTime: Date.parse("2026-03-01T10:00:00") },
            { key: "DATA_POINT_REST_HEARTRATE", value: "56", startTime: Date.parse("2026-03-01T07:00:00") },
          ],
        },
      ]),
    ).toEqual({ heart_rate: [["2026-03-01", 73]], resting_hr: [["2026-03-01", 56]] });
  });
});

describe("Zepp / Amazfit", () => {
  it("reads heart rate, body and sport files", () => {
    expect(csv("HEARTRATE_AUTO/HEARTRATE_AUTO_1700000000000.csv", "date,time,heartRate\n2026-03-01,08:00,68\n2026-03-01,08:10,72\n")).toEqual({ heart_rate: [["2026-03-01", 70]] });
    expect(csv("BODY/BODY_1700000000000.csv", "time,weight,height,bmi,fatRate,bodyWaterRate\n2026-03-01 07:00:00+0000,68.4,168,24.2,29.1,51\n")).toEqual({
      weight: [["2026-03-01", 68.4]],
      body_fat: [["2026-03-01", 29.1]],
    });
    expect(csv("SPORT/SPORT_1700000000000.csv", "type,startTime,sportTime(s),maxPace,minPace,distance(m),avgPace,calories(kcal),avgHeartRate\n1,2026-03-01 18:00:00+0000,2400,0,0,5000,0,320,139\n")).toEqual({
      exercise_hr: [["2026-03-01", 139]],
    });
  });
});

describe("Whoop", () => {
  it("reads physiological cycles and workouts", () => {
    expect(
      csv(
        "my_whoop_data/physiological_cycles.csv",
        "Cycle start time,Cycle end time,Cycle timezone,Recovery score %,Resting heart rate (bpm),Heart rate variability (ms),Skin temp (celsius),Blood oxygen %,Day Strain,Max HR (bpm),Average HR (bpm)\n2026-03-01 23:10:00,2026-03-02 22:40:00,UTC+01:00,71,55,52,33.6,96.5,10.2,165,68\n",
      ),
    ).toEqual({ resting_hr: [["2026-03-01", 55]], hrv_resting: [["2026-03-01", 52]], spo2: [["2026-03-01", 96.5]], heart_rate: [["2026-03-01", 68]] });
    expect(csv("my_whoop_data/workouts.csv", "Workout start time,Workout end time,Activity name,Activity Strain,Average HR (bpm),Max HR (bpm)\n2026-03-01 18:00:00,2026-03-01 18:45:00,Running,12.1,142,171\n")).toEqual({
      exercise_hr: [["2026-03-01", 142]],
    });
  });
});

describe("Withings", () => {
  it("reads weight and blood pressure, ignoring fat mass in kg", () => {
    expect(csv("data_WIT_123/weight.csv", 'Date,"Weight (kg)","Fat mass (kg)","Bone mass (kg)","Muscle mass (kg)","Hydration (kg)",Comments\n"2026-03-01 07:12:00",68.3,19.9,2.6,45.5,35.0,\n')).toEqual({
      weight: [["2026-03-01", 68.3]],
    });
    expect(csv("data_WIT_123/bp.csv", 'Date,"Heart rate",Systolic,Diastolic,Comments\n"2026-03-01 07:20:00",58,124,79,\n')).toEqual({
      resting_hr: [["2026-03-01", 58]],
      bp_systolic: [["2026-03-01", 124]],
      bp_diastolic: [["2026-03-01", 79]],
    });
  });
});

describe("shared helpers", () => {
  it("names file families without dates and numbers", () => {
    expect(fileFamily("Takeout/Fitbit/Global Export Data/heart_rate-2026-03-01.json")).toBe("takeout/fitbit/global export data/heart rate");
    expect(fileFamily("Daily SpO2 - 2026-03-01.csv")).toBe("daily spo2");
  });
  it("reads Fitbit's two-digit years month first", () => {
    expect(toIsoDate("03/01/26 08:00:05")).toBe("2026-03-01");
  });
});

describe("zip files", () => {
  const enc = new TextEncoder();
  it("reads stored entries", async () => {
    const zip = zipStore([
      { name: "a/heart_rate.csv", data: enc.encode("date,heart rate\n2026-03-01,70\n") },
      { name: "b/", data: new Uint8Array() },
    ]);
    const entries = await zipEntries(new Blob([zip as BlobPart]));
    expect(entries.map((e) => e.name)).toEqual(["a/heart_rate.csv"]);
    expect(await entries[0]!.text()).toBe("date,heart rate\n2026-03-01,70\n");
  });
  it("inflates deflated entries", async () => {
    const text = "x,".repeat(5000);
    const data = enc.encode(text);
    const comp = deflateRawSync(data);
    const name = enc.encode("big.csv");
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc32(data), true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(data), true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, 0, true);
    central.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, central.length, true);
    ev.setUint32(16, local.length + comp.length, true);
    const [e] = await zipEntries(new Blob([local, comp, central, end] as BlobPart[]));
    expect(e!.size).toBe(data.length);
    expect(await e!.text()).toBe(text);
  });
  it("says when a file isn't a zip", async () => {
    await expect(zipEntries(new Blob(["hello"]))).rejects.toThrow(/zip/);
  });
});

describe("sleep", () => {
  it("reads Fitbit sleep logs: total, deep and REM in minutes, naps added", () => {
    expect(
      json("Takeout/Fitbit/Global Export Data/sleep-2026-03-01.json", [
        {
          logId: 1,
          dateOfSleep: "2026-03-02",
          startTime: "2026-03-01T23:05:00.000",
          endTime: "2026-03-02T06:50:00.000",
          duration: 27900000,
          minutesToFallAsleep: 0,
          minutesAsleep: 412,
          minutesAwake: 53,
          timeInBed: 465,
          efficiency: 92,
          mainSleep: true,
          levels: { summary: { deep: { count: 4, minutes: 71, thirtyDayAvgMinutes: 65 }, light: { count: 30, minutes: 230 }, rem: { count: 6, minutes: 111 }, wake: { count: 28, minutes: 53 } }, data: [{ dateTime: "x", level: "wake", seconds: 30 }] },
        },
        { logId: 2, dateOfSleep: "2026-03-02", startTime: "2026-03-02T14:00:00.000", endTime: "2026-03-02T14:30:00.000", duration: 1800000, minutesAsleep: 28, mainSleep: false, levels: { summary: { asleep: { count: 1, minutes: 28 } } } },
      ]),
    ).toEqual({ sleep_duration: [["2026-03-02", 440]], sleep_deep: [["2026-03-02", 71]], sleep_rem: [["2026-03-02", 111]] });
  });
  it("reads Whoop and Oura, dated by the morning, and skips sleep scores", () => {
    expect(
      csv(
        "my_whoop_data/sleeps.csv",
        "Cycle start time,Sleep onset,Wake onset,Sleep performance %,Respiratory rate (rpm),Asleep duration (min),In bed duration (min),Light sleep duration (min),Deep (SWS) duration (min),REM duration (min),Awake duration (min),Sleep need (min),Sleep efficiency %\n2026-03-01 22:50:00,2026-03-01 23:10:00,2026-03-02 06:45:00,88,14.8,420,455,210,95,115,35,470,92\n",
      ),
    ).toEqual({ sleep_duration: [["2026-03-02", 420]], sleep_deep: [["2026-03-02", 95]], sleep_rem: [["2026-03-02", 115]] });
    expect(csv("oura_sleep.csv", "date,Sleep Score,Total Sleep Duration,Deep Sleep Duration,REM Sleep Duration,Light Sleep Duration,Sleep Efficiency\n2026-03-02,81,26100,5400,6300,14400,90\n")).toEqual({
      sleep_duration: [["2026-03-02", 26100]],
      sleep_deep: [["2026-03-02", 5400]],
      sleep_rem: [["2026-03-02", 6300]],
    });
  });
  it("adds up a total from stages when there is none (Garmin, Zepp)", () => {
    expect(
      json("DI_CONNECT/DI-Connect-Wellness/2026-03-01_2026-06-01_123_sleepData.json", [
        { calendarDate: "2026-03-02", deepSleepSeconds: 4800, lightSleepSeconds: 15600, remSleepSeconds: 6000, awakeSleepSeconds: 1200, sleepStartTimestampGMT: "2026-03-01T22:00:00.0" },
      ]),
    ).toEqual({ sleep_deep: [["2026-03-02", 4800]], sleep_rem: [["2026-03-02", 6000]], sleep_duration: [["2026-03-02", 26400]] });
    expect(csv("SLEEP/SLEEP_1700000000000.csv", "date,deepSleepTime,shallowSleepTime,wakeTime,start,stop,REMTime,naps\n2026-03-02,80,250,20,2026-03-01 23:00:00+0000,2026-03-02 06:40:00+0000,100,\n")).toEqual({
      sleep_deep: [["2026-03-02", 80]],
      sleep_rem: [["2026-03-02", 100]],
      sleep_duration: [["2026-03-02", 430]],
    });
  });
  it("tells hours, minutes and seconds apart from the numbers", () => {
    expect(sleepUnit([7.2, 6.8, 7.9])).toBe("h");
    expect(sleepUnit([420, 390])).toBe("min");
    expect(sleepUnit([25200, 26100])).toBe("s");
  });
  it("reads Apple sleep stages per night and keeps each device apart", () => {
    const xml = `
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-03-01 23:00:00 +0100" endDate="2026-03-02 01:00:00 +0100" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-03-02 01:00:00 +0100" endDate="2026-03-02 02:30:00 +0100" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-03-02 02:30:00 +0100" endDate="2026-03-02 02:45:00 +0100" value="HKCategoryValueSleepAnalysisAwake"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-03-02 02:45:00 +0100" endDate="2026-03-02 06:45:00 +0100" value="HKCategoryValueSleepAnalysisAsleepREM"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone" startDate="2026-03-01 23:00:00 +0100" endDate="2026-03-02 07:00:00 +0100" value="HKCategoryValueSleepAnalysisInBed"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="iPhone" startDate="2026-03-01 23:30:00 +0100" endDate="2026-03-02 06:30:00 +0100" value="HKCategoryValueSleepAnalysisAsleepUnspecified"/>`;
    const tally = new DailyTally();
    for (const r of appleRecords(xml, new Map())) tally.add(r.key, r.field, r.unit, r.date, r.value, (v) => v);
    const got = Object.fromEntries(tally.series().map((s) => [s.from, s.days.map((d) => [d.date, d.value])]));
    expect(got).toEqual({
      "Sleep (Watch)": [["2026-03-02", 7.5]],
      "Deep sleep (Watch)": [["2026-03-02", 1.5]],
      "REM sleep (Watch)": [["2026-03-02", 4]],
      "Sleep (iPhone)": [["2026-03-02", 7]],
    });
  });
  it("drops nights that can't be real, but not short pieces of a night", () => {
    const tally = new DailyTally();
    for (const v of [0.1, 0.2, 7]) tally.add("Sleep", "sleep_duration", "h", "2026-03-02", v, (x) => x);
    tally.add("Sleep", "sleep_duration", "h", "2026-03-03", 0.1, (x) => x);
    const [s] = tally.series();
    expect(s!.days).toEqual([{ date: "2026-03-02", value: 7.3, readings: 3 }]);
    expect(s!.dropped).toBe(1);
  });
});
