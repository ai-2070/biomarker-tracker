import type { BodyField } from "@bt/shared/core/body";
import { appleRecords, DailyTally, dailyAverages, jsonTable, parseCsv, readTable, safeCut, tableOf } from "@bt/shared/core/importers/deviceFiles";
import { matchUnit, toCanonical } from "@bt/shared/core/units";
import { describe, expect, it } from "vitest";
import { BIOMARKER_MAP } from "../../apps/web/src/app/knowledge";

// Synthetic exports only. Exercise the same table -> daily series path that the review uses.
function series(path: string, text: string, field: BodyField = "sleep_duration") {
  const column = readTable(path, tableOf(parseCsv(text))!).columns.find((c) => c.field === field)!;
  const def = BIOMARKER_MAP.get(field)!;
  const unit = matchUnit(def, column.unit)!;
  return dailyAverages(field, column.unit, column.header, column.readings, (v) => toCanonical(def, v, unit));
}

const samsungHeader = "start_time,end_time,sleep_id,stage,time_offset\n";
const apple = (stage: string, start: string, end: string, source = "Watch", device = "") =>
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysis${stage}" startDate="${start}" endDate="${end}" sourceName="${source}"${device ? ` device="${device}"` : ""}/>`;

function appleSeries(xml: string) {
  const tally = new DailyTally();
  let carry = "";
  for (let offset = 0; offset < xml.length; offset += 107) {
    const chunk = carry + xml.slice(offset, offset + 107);
    const cut = safeCut(chunk);
    for (const reading of appleRecords(chunk.slice(0, cut), new Map())) tally.addApple(reading, (v) => v);
    carry = chunk.slice(cut);
  }
  expect(carry).toBe("");
  return tally.series();
}

describe("passive sleep-session imports", () => {
  it("keeps Samsung asleep edges, internal awake gaps, naps and each endpoint's recorded offset", () => {
    const text =
      samsungHeader +
      [
        "2026-10-24 20:30:00.000,2026-10-24 21:00:00.000,night,40001,UTC+0200",
        "2026-10-24 21:00:00.000,2026-10-24 23:00:00.000,night,40002,UTC+0200",
        "2026-10-24 23:00:00.000,2026-10-24 23:15:00.000,night,40001,UTC+0200",
        "2026-10-24 23:15:00.000,2026-10-25 05:00:00.000,night,40003,UTC+0100",
        "2026-10-25 05:00:00.000,2026-10-25 05:15:00.000,night,40001,UTC+0100",
        "2026-10-25 12:00:00.000,2026-10-25 12:30:00.000,nap,40002,UTC+0100",
      ].join("\n");
    const result = series("com.samsung.health.sleep_stage.csv", text);
    expect(result.days.map(({ date, value, readings }) => ({ date, value, readings }))).toEqual([{ date: "2026-10-25", value: 495, readings: 2 }]);
    expect(result.days[0]!.sleepSessions).toEqual([
      {
        start: "2026-10-24T23:00:00.000",
        end: "2026-10-25T06:00:00.000",
        startOffsetMinutes: 120,
        endOffsetMinutes: 60,
        kind: "asleep",
        source: "Samsung Health",
      },
      {
        start: "2026-10-25T13:00:00.000",
        end: "2026-10-25T13:30:00.000",
        startOffsetMinutes: 60,
        endOffsetMinutes: 60,
        kind: "asleep",
        source: "Samsung Health",
      },
    ]);
    expect(series("com.samsung.health.sleep_stage.csv", text, "sleep_deep").days[0]!.sleepSessions).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("does not multiply Samsung stages or sessions from repeated exports", () => {
    const rows =
      "2026-03-01 22:00:00.000,2026-03-02 01:00:00.000,night,40003,UTC+0100\n" + "2026-03-02 01:00:00.000,2026-03-02 05:00:00.000,night,40004,UTC+0100\n";
    const columns = readTable("com.samsung.health.sleep_stage.csv", tableOf(parseCsv(samsungHeader + rows + rows))!).columns;
    const expected: Record<string, number> = { sleep_duration: 420, sleep_deep: 180, sleep_rem: 240 };
    for (const column of columns.filter((c) => c.field)) {
      const result = dailyAverages(column.field!, "min", column.header, [...column.readings, ...column.readings], (v) => v / 60);
      expect(result.days.map((day) => day.value)).toEqual([expected[column.field!]]);
      expect(result.days[0]!.sleepSessions?.length).toBe(column.field === "sleep_duration" ? 1 : undefined);
    }
  });

  it("retains Samsung's existing waking-date duration when an awake tail crosses midnight, without attaching mismatched metadata", () => {
    const text =
      samsungHeader + "2026-03-01 19:00:00.000,2026-03-01 22:30:00.000,n,40002,UTC+0100\n2026-03-01 22:30:00.000,2026-03-01 23:30:00.000,n,40001,UTC+0100";
    expect(series("com.samsung.health.sleep_stage.csv", text).days).toEqual([{ date: "2026-03-02", value: 210, readings: 1 }]);
  });

  it("uses Apple awake carriers across streamed chunks, excludes awake edges and preserves naps", () => {
    const xml =
      apple("Awake", "2026-03-01 22:30:00 +0100", "2026-03-01 23:00:00 +0100") +
      apple("AsleepCore", "2026-03-01 23:00:00 +0100", "2026-03-02 01:00:00 +0100") +
      apple("Awake", "2026-03-02 01:00:00 +0100", "2026-03-02 01:30:00 +0100") +
      apple("AsleepREM", "2026-03-02 01:30:00 +0100", "2026-03-02 06:30:00 +0100") +
      apple("Awake", "2026-03-02 06:30:00 +0100", "2026-03-02 07:00:00 +0100") +
      apple("Asleep", "2026-03-02 14:00:00 +0100", "2026-03-02 15:00:00 +0100");
    const result = appleSeries(xml + xml).find((s) => s.field === "sleep_duration")!;
    expect(result.days.map(({ date, value, readings }) => ({ date, value, readings }))).toEqual([{ date: "2026-03-02", value: 8, readings: 3 }]);
    expect(result.days[0]!.sleepSessions?.map((session) => [session.start, session.end, session.kind])).toEqual([
      ["2026-03-01T23:00:00", "2026-03-02T06:30:00", "asleep"],
      ["2026-03-02T14:00:00", "2026-03-02T15:00:00", "asleep"],
    ]);
  });

  it("keeps Apple waking dates at the last asleep endpoint when awake or in-bed carriers cross midnight", () => {
    for (const stage of ["Awake", "InBed"]) {
      const xml =
        apple("Asleep", "2026-03-01 14:00:00 +0100", "2026-03-01 23:00:00 +0100") +
        apple(stage, "2026-03-01 23:00:00 +0100", "2026-03-02 00:30:00 +0100") +
        apple("Asleep", "2026-03-02 14:00:00 +0100", "2026-03-02 22:00:00 +0100");
      const result = appleSeries(xml).find((series) => series.field === "sleep_duration")!;
      expect(result.days.map(({ date, value }) => ({ date, value }))).toEqual([
        { date: "2026-03-01", value: 9 },
        { date: "2026-03-02", value: 8 },
      ]);
      expect(result.days.map((day) => day.sleepSessions?.map((session) => session.end))).toEqual([["2026-03-01T23:00:00"], ["2026-03-02T22:00:00"]]);
    }
  });

  it("uses only same-source Apple in-bed carriers, never guessing over unknown gaps or merging devices", () => {
    const early = apple("Asleep", "2026-03-01 23:00:00 +0100", "2026-03-02 01:00:00 +0100");
    const late = apple("Asleep", "2026-03-02 02:00:00 +0100", "2026-03-02 06:00:00 +0100");
    const foreign = apple("InBed", "2026-03-01 22:00:00 +0100", "2026-03-02 07:00:00 +0100", "Phone");
    const windows = (xml: string) => appleSeries(xml).find((s) => s.from === "Sleep (Watch)")!.days[0]!.sleepSessions!;
    expect(windows(early + late + foreign)).toHaveLength(2);
    const same = apple("InBed", "2026-03-01 22:00:00 +0100", "2026-03-02 07:00:00 +0100");
    expect(windows(early + late + same)).toHaveLength(1);
    const namedDevice = apple("Asleep", "2026-03-02 08:00:00 +0100", "2026-03-02 09:00:00 +0100", "Alex's Apple Watch");
    expect(appleSeries(namedDevice)[0]!.days[0]!.sleepSessions![0]!.source).not.toContain("Alex");
    const twoDevices = early + apple("InBed", "2026-03-01 22:00:00 +0100", "2026-03-02 07:00:00 +0100", "Watch", "another device") + late;
    expect(windows(twoDevices)).toHaveLength(2);
  });

  it("preserves Apple DST offsets without treating the importing computer's zone as the source", () => {
    const result = appleSeries(apple("Asleep", "2026-10-25 01:30:00 +0200", "2026-10-25 02:30:00 +0100"))[0]!;
    expect(result.days[0]!.value).toBe(2);
    expect(result.days[0]!.sleepSessions![0]).toMatchObject({
      start: "2026-10-25T01:30:00",
      end: "2026-10-25T02:30:00",
      startOffsetMinutes: 120,
      endOffsetMinutes: 60,
    });
  });

  it.each([
    ["Fitbit/sleep.csv", "startTime,endTime,minutesAsleep", "2026-03-01T23:00:00.000,2026-03-02T07:00:00.000,420", "session", "Fitbit"],
    ["Oura/sleep.csv", "bedtime_start,bedtime_end,total_sleep_duration", "2026-03-01T23:00:00+02:00,2026-03-02T07:00:00+02:00,25200", "in-bed", "Oura"],
    ["WHOOP/sleeps.csv", "Sleep onset,Wake onset,Asleep duration (min)", "2026-03-01 23:00:00,2026-03-02 07:00:00,420", "session", "WHOOP"],
    [
      "Garmin/sleep.csv",
      "sleepStartTimestampLocal,sleepEndTimestampLocal,deepSleepSeconds,lightSleepSeconds",
      "2026-03-01T23:00:00,2026-03-02T07:00:00,3600,21600",
      "session",
      "Garmin",
    ],
    ["sleep.csv", "sleep_start,sleep_end,sleep_duration (h)", "2026-03-01T23:00:00-05:00,2026-03-02T07:00:00-05:00,7", "session", "Device export"],
    ["sleep.json.csv", "dateOfSleep,startTime,endTime,minutesAsleep", "2026-03-02,2026-03-01T23:00:00,2026-03-02T07:00:00,420", "session", "Fitbit"],
    ["sleep.csv", "bedtime_start,bedtime_end,total sleep (h)", "2026-03-01T23:00:00+02:00,2026-03-02T07:00:00+02:00,7", "in-bed", "Oura"],
    ["sleeps.csv", "Sleep onset,Wake onset,Asleep duration (min)", "2026-03-01 23:00:00,2026-03-02 07:00:00,420", "session", "WHOOP"],
    ["sleepData.csv", "sleepStartTimestampLocal,sleepEndTimestampLocal,total sleep (h)", "2026-03-01T23:00:00,2026-03-02T07:00:00,7", "session", "Garmin"],
  ])("preserves explicit source-local timing from %s", (path, header, row, kind, source) => {
    const result = series(path, `${header}\n${row}`);
    expect(result.days[0]!.date).toBe("2026-03-02");
    expect(result.days[0]!.sleepSessions![0]).toMatchObject({
      start: expect.stringContaining("2026-03-01T23:00:00"),
      end: expect.stringContaining("2026-03-02T07:00:00"),
      kind,
      source,
    });
    if (source === "Fitbit" || source === "WHOOP" || source === "Garmin") {
      expect(result.days[0]!.sleepSessions![0]!.startOffsetMinutes).toBeUndefined();
      expect(result.days[0]!.sleepSessions![0]!.endOffsetMinutes).toBeUndefined();
    }
  });

  it("accepts Garmin wall-clock epoch LOCAL fields, but never UTC-only fields without a source offset", () => {
    const local = series(
      "Garmin/sleep.csv",
      `date,sleepStartTimestampLocal,sleepEndTimestampLocal,total sleep (h)\n2026-03-02,${Date.UTC(2026, 2, 1, 23)},${Date.UTC(2026, 2, 2, 7)},7`,
    );
    expect(local.days[0]!.sleepSessions![0]).toMatchObject({ start: "2026-03-01T23:00:00.000", end: "2026-03-02T07:00:00.000" });
    const utc = "date,sleepStartTimestampGMT,sleepEndTimestampGMT,total sleep (h)\n2026-03-02,2026-03-01T22:00:00,2026-03-02T06:00:00,7";
    expect(series("Garmin/sleep.csv", utc).days).toEqual([{ date: "2026-03-02", value: 7, readings: 1 }]);
    const withOffset = utc.replace("total sleep (h)", "time_offset,total sleep (h)").replace(",7", ",UTC+0100,7");
    expect(series("Garmin/sleep.csv", withOffset).days[0]!.sleepSessions![0]).toMatchObject({
      start: "2026-03-01T23:00:00.000",
      end: "2026-03-02T07:00:00.000",
      startOffsetMinutes: 60,
      endOffsetMinutes: 60,
    });
    expect(series("Garmin/sleep.csv", withOffset.replace(/(T\d{2}:\d{2}:\d{2})(?=,)/g, "$1+00:00")).days[0]!.sleepSessions![0]).toMatchObject({
      start: "2026-03-01T23:00:00.000",
      end: "2026-03-02T07:00:00.000",
      startOffsetMinutes: 60,
      endOffsetMinutes: 60,
    });
  });

  it.each([
    ["", ""],
    ["2026-03-01T23:00:00Z", "2026-03-02T07:00:00Z"],
    ["2026-03-02T08:00:00", "2026-03-02T07:00:00"],
    ["2026-02-30T23:00:00", "2026-03-02T07:00:00"],
    ["23:00", "07:00"],
    ["2026-02-27T23:00:00", "2026-03-02T07:00:00"],
  ])("retains valid durations without invalid or unknown-zone timing (%s)", (start, end) => {
    const result = series("sleep.csv", `date,start_time,end_time,total sleep (h)\n2026-03-02,${start},${end},7`);
    expect(result.days.map((day) => day.value)).toEqual([7]);
    expect(result.days[0]!.sleepSessions).toBeUndefined();
  });

  it("retains a row's explicit waking date when other rows have timing but this row's end is missing", () => {
    const result = series(
      "Fitbit/sleep.csv",
      "dateOfSleep,startTime,endTime,minutesAsleep\n2026-03-02,2026-03-01T23:00:00,2026-03-02T07:00:00,420\n2026-03-03,unknown,unknown,480",
    );
    expect(result.days.map(({ date, value }) => ({ date, value }))).toEqual([
      { date: "2026-03-02", value: 420 },
      { date: "2026-03-03", value: 480 },
    ]);
    expect(result.days[0]!.sleepSessions).toHaveLength(1);
    expect(result.days[1]!.sleepSessions).toBeUndefined();
    const endFirst = series(
      "sleep.csv",
      "endTime,date,startTime,total sleep (h)\n2026-03-02T07:00:00,2026-03-02,2026-03-01T23:00:00,7\nunknown,2026-03-03,unknown,8",
    );
    expect(endFirst.days.map((day) => [day.date, day.value])).toEqual([
      ["2026-03-02", 7],
      ["2026-03-03", 8],
    ]);
  });

  it("maps explicit Health Connect-style JSON interval fields only when source offsets are supplied", () => {
    const table = jsonTable([
      {
        date: "2026-03-02",
        startTime: "2026-03-01T22:00:00Z",
        endTime: "2026-03-02T06:00:00Z",
        startZoneOffset: "+01:00",
        endZoneOffset: "+01:00",
        sleepDuration: 7,
      },
    ])!;
    const column = readTable("health-connect/sleep.json", table).columns.find((c) => c.field === "sleep_duration")!;
    expect(column.readings[0]!.sleepSessions![0]).toMatchObject({
      start: "2026-03-01T23:00:00.000",
      end: "2026-03-02T07:00:00.000",
      source: "Health Connect",
      kind: "session",
    });
    const noSourceZone = jsonTable([{ date: "2026-03-02", startTime: "2026-03-01T22:00:00+00:00", endTime: "2026-03-02T06:00:00+00:00", sleepDuration: 7 }])!;
    expect(readTable("health-connect/sleep.json", noSourceZone).columns.find((c) => c.field === "sleep_duration")!.readings[0]!.sleepSessions).toBeUndefined();
  });

  it("keeps metadata on the winning daily summary only, and removes it when remapped", () => {
    const old = series("Oura/sleep.csv", "date,bedtime_start,bedtime_end,total sleep (h)\n2026-03-02,2026-03-01T23:00:00,2026-03-02T07:00:00,7").days[0]!;
    const readings = [
      { ...old, source: "sleep-2026-03-01.csv", daily: true },
      { date: old.date, value: 8, source: "sleep-2026-03-02.csv", daily: true },
    ];
    expect(dailyAverages("sleep_duration", "h", "Sleep", readings, (v) => v).days).toEqual([{ date: old.date, value: 8, readings: 1 }]);
    expect(dailyAverages("sleep_deep", "h", "Sleep", [readings[0]!], (v) => v).days[0]!.sleepSessions).toBeUndefined();
  });
});
