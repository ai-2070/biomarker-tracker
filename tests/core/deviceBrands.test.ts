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

describe("Samsung Health body composition", () => {
  const path = "samsunghealth/com.samsung.health.weight.20261030120000.csv";

  it("imports the percentage, not fat mass, from a zipped weight export", async () => {
    const text = "com.samsung.shealth.tracker.weight,6302004,4\ncom.samsung.health.weight.start_time,com.samsung.health.weight.weight,com.samsung.health.weight.body_fat_mass,com.samsung.health.weight.body_fat\n2026-03-01 07:00:00.000,80,20,25\n";
    const archive = zipStore([{ name: path, data: new TextEncoder().encode(text) }]);
    const [entry] = await zipEntries(new Blob([archive as BlobPart]));
    const table = tableOf(parseCsv(await entry!.text()))!;
    expect(read(entry!.name, table)).toEqual({
      weight: [["2026-03-01", 80]],
      body_fat: [["2026-03-01", 25]],
    });
    expect(readTable(entry!.name, table).columns.find((c) => c.header === "body fat mass")).toMatchObject({
      field: null,
      reason: expect.any(String),
      readings: [],
    });
  });

  it("does not invent a percentage when only fat mass is present", () => {
    const text = "com.samsung.shealth.tracker.weight\ncom.samsung.health.weight.start_time,com.samsung.health.weight.weight,com.samsung.health.weight.body_fat_mass\n2026-03-01 07:00:00.000,80,20\n";
    expect(csv(path, text)).toEqual({
      weight: [["2026-03-01", 80]],
    });
  });
});

describe("Samsung Health steps", () => {
  it("uses only the combined daily total, with the newest snapshot replacing an earlier total", () => {
    const text = `com.samsung.shealth.step_daily_trend,7010053,6
create_time,update_time,source_type,count,day_time
2026-03-05 10:00:00.000,2026-03-05 11:00:00.000,-2,4800,2026-03-01 00:00:00.000
2026-03-05 10:00:00.000,2026-03-05 10:00:00.000,-2,5000,2026-03-01 00:00:00.000
2026-03-05 10:00:00.000,2026-03-05 11:00:00.000,0,3000,2026-03-01 00:00:00.000
2026-03-05 10:00:00.000,2026-03-05 11:00:00.000,108,4500,2026-03-01 00:00:00.000
2026-03-05 10:00:00.000,2026-03-05 11:00:00.000,-2,2000,2026-03-02 00:00:00.000
`;
    expect(csv("com.samsung.shealth.step_daily_trend.csv", text)).toEqual({ steps: [["2026-03-01", 4800], ["2026-03-02", 2000]] });
  });

  it("reads the daily date encoded as UTC-midnight milliseconds", () => {
    const text = `com.samsung.shealth.step_daily_trend\nsource_type,count,day_time\n-2,1234,${Date.UTC(2026, 2, 1)}\n`;
    expect(csv("com.samsung.shealth.step_daily_trend.csv", text)).toEqual({ steps: [["2026-03-01", 1234]] });
  });

  it("does not invent a combined total from overlapping phone and watch counts", () => {
    const text = "com.samsung.shealth.step_daily_trend\nsource_type,count,day_time\n0,3000,2026-03-01\n108,4500,2026-03-01\n";
    const result = readTable("com.samsung.shealth.step_daily_trend.csv", tableOf(parseCsv(text))!);
    expect(result.columns.filter((c) => c.field === "steps").flatMap((c) => c.readings)).toEqual([]);
    expect(result.columns).toContainEqual(expect.objectContaining({ field: null, reason: expect.any(String) }));
  });

  it.each([false, true])("ignores redundant Samsung step files regardless of zip order (reversed: %s)", async (reverse) => {
    const enc = new TextEncoder();
    const files = [
      { name: "com.samsung.shealth.tracker.pedometer_day_summary.csv", data: enc.encode("date,step_count,walk_step_count,run_step_count\n2026-03-01,5000,4500,500\n") },
      { name: "com.samsung.shealth.tracker.pedometer_step_count.csv", data: enc.encode("date,count\n2026-03-01,7000\n") },
      { name: "com.samsung.shealth.activity.day_summary.csv", data: enc.encode("date,step_count\n2026-03-01,5000\n") },
      { name: "com.samsung.shealth.step_daily_trend.csv", data: enc.encode("day_time,source_type,count\n2026-03-01,-2,5000\n2026-03-01,0,3000\n2026-03-01,108,4500\n") },
    ];
    const entries = await zipEntries(new Blob([zipStore(reverse ? files.reverse() : files) as BlobPart]));
    const totals = [];
    for (const entry of entries) {
      const result = csv(entry.name, await entry.text());
      if (result.steps) totals.push(result.steps);
    }
    expect(totals).toEqual([[["2026-03-01", 5000]]]);
  });
});

describe("Samsung Health active time", () => {
  it("reads the activity day's milliseconds as minutes, not seconds or scoring inputs", () => {
    const text = `com.samsung.shealth.activity.day_summary,7010053,6
create_time,day_time,active_time,exercise_time,dynamic_active_time,walk_time,run_time,step_count
2026-03-05 10:00:00.000,2026-03-01 00:00:00.000,845219,0,0,838419,6800,1274
2026-03-05 10:00:00.000,2026-03-02 00:00:00.000,2700000,120000,0,2580000,120000,5000
`;
    expect(csv("com.samsung.shealth.activity.day_summary.csv", text)).toEqual({ active_minutes: [["2026-03-01", 14.1], ["2026-03-02", 45]] });
  });
  it("replaces cumulative daily snapshots instead of adding them", () => {
    const text = "com.samsung.shealth.activity.day_summary\nday_time,update_time,active_time\n2026-03-01,2026-03-02 12:00:00.000,1200000\n2026-03-01,2026-03-02 10:00:00.000,1800000\n";
    expect(csv("com.samsung.shealth.activity.day_summary.csv", text)).toEqual({ active_minutes: [["2026-03-01", 20]] });
  });
  it("does not import overlapping pedometer or detail-bin active time", () => {
    expect(csv("com.samsung.shealth.tracker.pedometer_day_summary.csv", "day_time,active_time\n2026-03-01,745753\n2026-03-01,44351\n2026-03-01,605419\n")).toEqual({});
    expect(json("jsons/com.samsung.shealth.activity.day_summary/example.binning_data.json", [{ date: "2026-03-01", mTotalActiveTime: 60000 }, { date: "2026-03-01", mTotalActiveTime: 120000 }])).toEqual({});
  });
});

describe("Samsung Health overnight resting summaries", () => {
  it("imports the measured sleeping heart rate and HRV, not scores, scales or baselines", () => {
    const text = `com.samsung.shealth.vitality_score,7010053,4
day_time,create_time,shr_value,shrv_value,shr_score,shrv_score,shr_balance_scale,shrv_balance_scale,prev_shr_avg,prev_shrv_avg,shr_baseline_min,shrv_baseline_max,sleep_duration,sleep_duration_scale,active_time,pkg_name
2026-03-01 00:00:00.000,2026-03-05 12:00:00.000,60,50,98,95,90,85,61,51,45,80,24000000,97,845219,com.sec.android.app.shealth
`;
    expect(csv("com.samsung.shealth.vitality_score.csv", text)).toEqual({
      resting_hr: [["2026-03-01", 60]],
      hrv_resting: [["2026-03-01", 50]],
    });
  });
  it("uses each summary day and its latest update instead of averaging snapshots", () => {
    const text = `com.samsung.shealth.vitality_score
day_time,update_time,shr_value,shrv_value
2026-03-01,2026-03-05 12:00:00.000,57,65
2026-03-01,2026-03-05 10:00:00.000,60,50
`;
    expect(csv("com.samsung.shealth.vitality_score.csv", text)).toEqual({
      resting_hr: [["2026-03-01", 57]],
      hrv_resting: [["2026-03-01", 65]],
    });
  });
  it("leaves unavailable measurements out rather than filling them from scores or previous averages", () => {
    const text = `com.samsung.shealth.vitality_score
day_time,shr_value,shrv_value,shr_score,shrv_score,prev_shr_avg,prev_shrv_avg
2026-03-01,-1,0,99,98,60,50
2026-03-02,55,,99,98,60,50
2026-03-03,,48,99,98,60,50
`;
    expect(csv("com.samsung.shealth.vitality_score.csv", text)).toEqual({
      resting_hr: [["2026-03-02", 55]],
      hrv_resting: [["2026-03-03", 48]],
    });
  });
  it("keeps ordinary heart-rate and HRV readings separate from resting summaries", () => {
    expect(csv("com.samsung.health.heart_rate.csv", "date,heart_rate\n2026-03-01,88\n")).toEqual({ heart_rate: [["2026-03-01", 88]] });
    expect(json("jsons/com.samsung.health.hrv/example.binning_data.json", [{ date: "2026-03-01", rmssd: 50 }])).toEqual({ hrv: [["2026-03-01", 50]] });
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
  it("reads Samsung's actual sleep from stage intervals, excluding awake time", () => {
    const text = `com.samsung.health.sleep_stage,7010053,7
start_time,end_time,sleep_id,stage,time_offset
2026-03-01 13:35:30.000,2026-03-01 15:17:30.000,night,40004,UTC+0100
2026-03-01 08:37:00.000,2026-03-01 12:50:00.000,night,40002,UTC+0100
2026-03-01 15:17:30.000,2026-03-01 15:52:00.000,night,40001,UTC+0100
2026-03-01 12:50:00.000,2026-03-01 13:35:30.000,night,40003,UTC+0100
`;
    expect(csv("com.samsung.health.sleep_stage.20260302.csv", text)).toEqual({
      sleep_duration: [["2026-03-01", 400.5]],
      sleep_deep: [["2026-03-01", 45.5]],
      sleep_rem: [["2026-03-01", 102]],
    });
  });
  it("dates all Samsung stages by the session's local wake-up day and adds naps", () => {
    const text = `com.samsung.health.sleep_stage,7010053,7
start_time,end_time,sleep_id,stage,time_offset
2026-03-01 20:00:00.000,2026-03-01 21:00:00.000,night,40002,UTC+0200
2026-03-01 21:00:00.000,2026-03-01 21:30:00.000,night,40003,UTC+0200
2026-03-01 21:30:00.000,2026-03-01 22:00:00.000,night,40004,UTC+0200
2026-03-01 22:00:00.000,2026-03-01 22:30:00.000,night,40001,UTC+0200
2026-03-02 10:00:00.000,2026-03-02 10:20:00.000,nap,40002,UTC+0200
`;
    expect(csv("com.samsung.health.sleep_stage.csv", text)).toEqual({
      sleep_duration: [["2026-03-02", 140]],
      sleep_deep: [["2026-03-02", 30]],
      sleep_rem: [["2026-03-02", 30]],
    });
  });
  it("uses Samsung's negative time-zone offsets when the local wake-up date is the previous day", () => {
    const text = "com.samsung.health.sleep_stage,7010053,7\nstart_time,end_time,sleep_id,stage,time_offset\n2026-03-02 01:00:00.000,2026-03-02 02:00:00.000,night,40002,UTC-0500\n";
    expect(csv("com.samsung.health.sleep_stage.csv", text)).toEqual({ sleep_duration: [["2026-03-01", 60]] });
  });
  it.each(["sleep", "sleep_combined", "vitality_score"])("does not import Samsung %s score inputs or time in bed as sleep", (kind) => {
    const text = `com.samsung.shealth.${kind},7010053,12
start_time,end_time,total_sleep_time_weight,sleep_duration_scale,sleep_duration,total_rem_duration,total_light_duration,sleep_score
2026-03-01 08:37:00.000,2026-03-01 15:52:00.000,34,97.9,435,102,254,83
`;
    const result = readTable(`com.samsung.shealth.${kind}.20260302.csv`, tableOf(parseCsv(text))!);
    expect(result.columns.filter((c) => c.field)).toEqual([]);
    expect(result.columns).toContainEqual(expect.objectContaining({ field: null, reason: expect.any(String) }));
  });
  it("leaves out a Samsung session with invalid intervals or unknown stages rather than undercounting it", () => {
    const text = `com.samsung.health.sleep_stage,7010053,7
start_time,end_time,sleep_id,stage,time_offset
2026-03-01 20:00:00.000,2026-03-01 21:00:00.000,bad-stage,40002,UTC+0100
2026-03-01 21:00:00.000,2026-03-01 22:00:00.000,bad-stage,99999,UTC+0100
2026-03-02 20:00:00.000,2026-03-02 21:00:00.000,bad-time,40002,UTC+0100
2026-03-02 22:00:00.000,2026-03-02 21:00:00.000,bad-time,40003,UTC+0100
2026-03-03 20:00:00.000,2026-03-03 21:00:00.000,good,40002,UTC+0100
`;
    expect(csv("com.samsung.health.sleep_stage.csv", text)).toEqual({ sleep_duration: [["2026-03-03", 60]] });
  });
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

describe("VO2max", () => {
  it("reads Garmin, Fitbit and plain columns, but not ranks or fitness ages", () => {
    expect(json("DI_CONNECT/DI-Connect-Metrics/MetricsMaxMetData_2026.json", [{ calendarDate: "2026-03-01", vO2MaxValue: 41.0, vo2MaxPreciseValue: 41.3, fitnessAge: 38 }])).toEqual({ vo2max: [["2026-03-01", 41]] });
    expect(csv("Cardio Fitness Score/demographic_vo2_max - 2026-03.csv", "date,demographic_vo2_max,demographic_vo2_max_error\n2026-03-01,42.5,1.2\n")).toEqual({ vo2max: [["2026-03-01", 42.5]] });
    expect(csv("oura.csv", "date,VO2 Max\n2026-03-01,39\n")).toEqual({ vo2max: [["2026-03-01", 39]] });
  });
  it("reads Apple's VO2Max records", () => {
    const r = appleRecords('<Record type="HKQuantityTypeIdentifierVO2Max" unit="mL/min·kg" startDate="2026-03-01 18:30:00 +0100" value="40.2"/>', new Map());
    expect(r.map((x) => [x.field, x.unit, x.date, x.value])).toEqual([["vo2max", "mL/kg/min", "2026-03-01", 40.2]]);
  });
});
