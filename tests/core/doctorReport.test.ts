import { buildDoctorReport, type DoctorReportInput, groupDoctorReportSeries } from "@bt/shared/core/doctorReport";
import type { BiomarkerDef, Measurement, ProtocolEntry } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";

const marker = (id: string, extra: Partial<BiomarkerDef> = {}): BiomarkerDef => ({
  id,
  name: id,
  category: "Metabolic",
  aliases: [],
  canonicalUnit: "mmol/L",
  conversions: {},
  summary: "",
  high: { meaning: "", commonCauses: [] },
  low: { meaning: "", commonCauses: [] },
  affectedBy: [],
  sources: [],
  defaultRanges: [{ low: 3, high: 6 }],
  ...extra,
});
const reading = (id: string, date: string, value: number, extra: Partial<Measurement> = {}): Measurement => ({
  id,
  biomarkerId: "blood",
  date,
  value,
  originalValue: value,
  originalUnit: "mmol/L",
  source: "manual",
  ...extra,
});
function fixture(): DoctorReportInput {
  return {
    generatedOn: "2026-10-31",
    profile: { name: "Test person", birthMonth: "1980-05", sex: "f", notes: "private profile", heightUnit: "cm", example: true },
    measurements: [],
    protocols: [],
    defs: new Map([
      ["blood", marker("blood")],
      ["other", marker("other")],
      ["body", marker("body", { category: "Body" })],
      ["aging", marker("aging", { category: "Aging" })],
      ["sleep", marker("sleep", { category: "Body", judgeAverageOfDays: 7 })],
      ["activity", marker("activity", { category: "Body", judgeSumOfDays: 7 })],
    ]),
    options: { from: "2026-01-01", to: "2026-10-31", markerIds: ["blood"], includeProfile: true, includeNotes: false, includeLog: true },
  };
}

describe("buildDoctorReport", () => {
  it("rejects impossible, reversed and future date ranges, including an invalid report date", () => {
    for (const [from, to, generatedOn] of [
      ["2026-02-30", "2026-10-31", "2026-10-31"],
      ["2026-10-31", "2026-01-01", "2026-10-31"],
      ["2026-01-01", "2026-11-01", "2026-10-31"],
      ["2026-01-01", "2026-10-31", "2026-13-01"],
      ["2026-1-01", "2026-10-31", "2026-10-31"],
    ]) {
      const input = fixture();
      input.options.from = from!;
      input.options.to = to!;
      input.generatedOn = generatedOn!;
      expect(() => buildDoctorReport(input)).toThrow();
    }
  });

  it("includes both boundaries, excludes unknown and unselected markers, and keeps save order", () => {
    const input = fixture();
    input.options.markerIds = ["missing", "blood", "blood", "unknown"];
    input.measurements = [
      reading("late", "2026-10-31", 8, { savedOrder: 8 }),
      reading("before", "2025-12-31", 1),
      reading("first", "2026-01-01", 4),
      reading("earlier-save", "2026-10-31", 7, { savedOrder: 2 }),
      reading("after", "2026-11-01", 9),
      reading("unselected", "2026-06-01", 5, { biomarkerId: "other" }),
      reading("unknown", "2026-06-01", 5, { biomarkerId: "unknown" }),
      reading("bad-date", "2026-02-30", 5),
    ];
    const report = buildDoctorReport(input);
    expect(report.series).toHaveLength(1);
    const series = report.series[0]!;
    expect(series.count).toBe(3);
    expect(series.history.map((r) => r.measurement.id)).toEqual(["first", "earlier-save", "late"]);
    expect(series.latest.id).toBe("late");
    expect(series.latestFlag).toBe("high");
    expect(series.latestRange).toEqual({ low: 3, high: 6, source: "default" });
    input.options.markerIds = ["missing"];
    expect(buildDoctorReport(input).series).toEqual([]);
  });

  it("takes the latest reading from within the selected period, including a singleton", () => {
    const input = fixture();
    input.options.from = "2026-03-01";
    input.options.to = "2026-05-01";
    input.measurements = [
      reading("after-period", "2026-06-01", 9),
      reading("within", "2026-04-01", 4, { labRange: { low: 2, high: 5 }, note: "private" }),
      reading("before-period", "2026-02-01", 1),
    ];
    const series = buildDoctorReport(input).series[0]!;
    expect(series.count).toBe(1);
    expect(series.history.map(({ measurement }) => measurement.id)).toEqual(["within"]);
    expect(series.latest).toBe(series.history[0]!.measurement);
    expect(series.latest).not.toHaveProperty("note");
    expect(series.latestFlag).toBe("normal");
    expect(series.latestRange).toEqual({ low: 2, high: 5, source: "lab" });
  });

  it("uses stable input order for same-day readings without a distinct saved order", () => {
    const input = fixture();
    input.measurements = [
      reading("legacy-one", "2026-01-01", 4),
      reading("legacy-two", "2026-01-01", 5),
      reading("saved-one", "2026-01-01", 6, { savedOrder: 2 }),
      reading("saved-two", "2026-01-01", 7, { savedOrder: 2, labRange: { high: 8 } }),
    ];
    const series = buildDoctorReport(input).series[0]!;
    expect(series.history.map(({ measurement }) => measurement.id)).toEqual(["legacy-one", "legacy-two", "saved-one", "saved-two"]);
    expect(series.latest.id).toBe("saved-two");
    expect(series.latestFlag).toBe("normal");
    expect(series.latestRange?.high).toBe(8);
  });

  it("uses lab ranges first and preserves source and fasting for every reading", () => {
    const input = fixture();
    input.defs = new Map([
      [
        "blood",
        marker("blood", {
          defaultRanges: [
            { high: 5, fasted: true },
            { high: 8, fasted: false },
          ],
        }),
      ],
    ]);
    input.measurements = [
      reading("fasting", "2026-01-01", 6, { fasted: true, source: "pdf", lab: "Test lab" }),
      reading("after-meal", "2026-02-01", 6, { fasted: false }),
      reading("lab", "2026-03-01", 6, { fasted: true, labRange: { high: 7 } }),
    ];
    const series = buildDoctorReport(input).series[0]!;
    expect(series.history.map((r) => r.flag)).toEqual(["high", "normal", "normal"]);
    expect(series.latestFlag).toBe("normal");
    expect(series.latestRange).toEqual({ low: undefined, high: 7, source: "lab" });
    expect(series.history[0]!.measurement).toMatchObject({ fasted: true, source: "pdf", lab: "Test lab" });
  });

  it("preserves bound limits, conclusive warnings and unknown flags for ambiguous bounds", () => {
    const input = fixture();
    input.defs = new Map([["blood", marker("blood", { criticalRange: { low: 1, high: 10 } })]]);
    input.measurements = [
      reading("below", "2026-01-01", 1, { qualifier: "<", source: "pdf", lab: "Lab", fasted: true }),
      reading("ambiguous-below", "2026-01-02", 4, { qualifier: "<" }),
      reading("ambiguous-above", "2026-01-03", 5, { qualifier: ">" }),
      reading("low", "2026-01-04", 3, { qualifier: "<" }),
      reading("high", "2026-01-05", 6, { qualifier: ">" }),
      reading("above", "2026-02-01", 10, { qualifier: ">", source: "photo", labRange: { low: 2, high: 8 } }),
    ];
    const series = buildDoctorReport(input).series[0]!;
    expect(
      series.history.map(({ measurement, flag }) => ({
        id: measurement.id,
        value: measurement.value,
        qualifier: measurement.qualifier,
        flag,
      })),
    ).toEqual([
      { id: "below", value: 1, qualifier: "<", flag: "critical-low" },
      { id: "ambiguous-below", value: 4, qualifier: "<", flag: "unknown" },
      { id: "ambiguous-above", value: 5, qualifier: ">", flag: "unknown" },
      { id: "low", value: 3, qualifier: "<", flag: "low" },
      { id: "high", value: 6, qualifier: ">", flag: "high" },
      { id: "above", value: 10, qualifier: ">", flag: "critical-high" },
    ]);
    expect(series.history[0]!.measurement).toMatchObject({ source: "pdf", lab: "Lab", fasted: true });
    expect(series.latest).toMatchObject({ id: "above", value: 10, qualifier: ">", source: "photo" });
    expect(series.latestFlag).toBe("critical-high");
    expect(series.latestRange).toEqual({ low: 2, high: 8, source: "lab" });
  });

  it("resolves each reading with the original profile even when personal details are excluded", () => {
    const input = fixture();
    input.profile.birthMonth = "1980-05";
    input.options.includeProfile = false;
    input.defs = new Map([
      [
        "blood",
        marker("blood", {
          defaultRanges: [
            { high: 5, sex: "f", ageTo: 46, fasted: true },
            { high: 7, sex: "f", ageFrom: 46, fasted: true },
            { high: 8, sex: "f", fasted: false },
            { high: 10, sex: "m", fasted: true },
          ],
        }),
      ],
    ]);
    input.measurements = [
      reading("younger", "2026-01-01", 6, { fasted: true }),
      reading("older", "2026-06-01", 6, { fasted: true }),
      reading("fed", "2026-07-01", 6, { fasted: false }),
      reading("lab", "2026-08-01", 6, { fasted: false, labRange: { high: 4 } }),
    ];
    const report = buildDoctorReport(input);
    expect(report).not.toHaveProperty("profile");
    expect(report).not.toHaveProperty("age");
    expect(report.series[0]!.history.map(({ flag, range }) => ({ flag, high: range?.high, source: range?.source }))).toEqual([
      { flag: "high", high: 5, source: "default" },
      { flag: "normal", high: 7, source: "default" },
      { flag: "normal", high: 8, source: "default" },
      { flag: "high", high: 4, source: "lab" },
    ]);
    expect(report.series[0]!.latestFlag).toBe("high");
    expect(report.series[0]!.latestRange).toEqual({ low: undefined, high: 4, source: "lab" });
  });

  it("retains full blood, aging and body history without flagging daily sleep/activity as weekly values", () => {
    const input = fixture();
    input.options.markerIds = ["blood", "aging", "body", "sleep", "activity"];
    input.measurements = input.options.markerIds.flatMap((id) => [
      reading(`${id}-last`, "2026-02-01", 1, { biomarkerId: id }),
      reading(`${id}-first`, "2026-01-01", 2, { biomarkerId: id }),
    ]);
    const report = buildDoctorReport(input);
    expect(report.series.map((s) => s.count)).toEqual([2, 2, 2, 2, 2]);
    for (const series of report.series) {
      expect(series.history.map(({ measurement }) => measurement.id)).toEqual([`${series.def.id}-first`, `${series.def.id}-last`]);
      expect(series.latest.id).toBe(`${series.def.id}-last`);
    }
    expect(report.series.slice(3).map((s) => s.latestFlag)).toEqual(["unknown", "unknown"]);
    expect(report.series.slice(3).flatMap((s) => s.history.map((r) => r.flag))).toEqual(["unknown", "unknown", "unknown", "unknown"]);
  });

  it("retains every body reading with its fasting state, range, provenance and selected notes", () => {
    const input = fixture();
    input.options.markerIds = ["body"];
    input.options.includeNotes = true;
    input.defs = new Map([
      [
        "body",
        marker("body", {
          category: "Body",
          defaultRanges: [
            { high: 5, fasted: true },
            { high: 8, fasted: false },
          ],
        }),
      ],
    ]);
    input.measurements = [
      reading("first", "2026-01-01", 6, { biomarkerId: "body", source: "device", fasted: true, lab: "Home meter", note: "Before breakfast" }),
      reading("middle", "2026-02-01", 7, { biomarkerId: "body", fasted: false, labRange: { high: 6 }, note: "Meter range" }),
      reading("last", "2026-03-01", 6, { biomarkerId: "body", source: "photo", fasted: false, note: "After a meal" }),
    ];
    const series = buildDoctorReport(input).series[0]!;
    expect(series.count).toBe(3);
    expect(
      series.history.map(({ measurement, flag, range }) => ({
        id: measurement.id,
        fasted: measurement.fasted,
        source: measurement.source,
        note: measurement.note,
        flag,
        high: range?.high,
      })),
    ).toEqual([
      { id: "first", fasted: true, source: "device", note: "Before breakfast", flag: "high", high: 5 },
      { id: "middle", fasted: false, source: "manual", note: "Meter range", flag: "high", high: 6 },
      { id: "last", fasted: false, source: "photo", note: "After a meal", flag: "normal", high: 8 },
    ]);
    expect(series.history[0]!.measurement.lab).toBe("Home meter");
    expect(series.latest).toBe(series.history[2]!.measurement);
    expect(series.latestRange).toEqual({ low: undefined, high: 8, source: "default" });
    input.options.includeNotes = false;
    const privateSeries = buildDoctorReport(input).series[0]!;
    expect(privateSeries.history.every(({ measurement }) => !("note" in measurement))).toBe(true);
    expect(privateSeries.latest).not.toHaveProperty("note");
  });

  it("never assigns a weekly activity threshold to any daily reading or its latest summary", () => {
    const input = fixture();
    input.options.markerIds = ["activity"];
    input.defs = new Map([["activity", marker("activity", { category: "Body", judgeSumOfDays: 7, defaultRanges: [{ low: 150 }] })]]);
    input.measurements = [reading("day-one", "2026-01-01", 30, { biomarkerId: "activity" }), reading("day-two", "2026-01-02", 20, { biomarkerId: "activity" })];
    const series = buildDoctorReport(input).series[0]!;
    expect(series.latestFlag).toBe("unknown");
    expect(series.history.map(({ range, flag }) => ({ range, flag }))).toEqual([
      { range: undefined, flag: "unknown" },
      { range: undefined, flag: "unknown" },
    ]);
    expect(series.latestRange).toBeUndefined();
  });

  it("includes only overlapping logged habits, retaining grouped medicine and supplement snapshots", () => {
    const input = fixture();
    const log = (id: string, start: string, end?: string): ProtocolEntry => ({ id, label: id, category: "lifestyle", start, ...(end ? { end } : {}) });
    input.protocols = [
      log("ended-before", "2025-01-01", "2025-12-31"),
      log("ends-at-start", "2025-01-01", "2026-01-01"),
      log("current", "2025-01-01"),
      log("ended-within", "2026-02-01", "2026-03-01"),
      log("starts-at-end", "2026-10-31"),
      log("future", "2026-11-01"),
    ];
    input.protocols[2]!.plan = {
      id: "plan",
      items: [
        { id: "med", label: "Own medicine", category: "medication", when: "morning", amount: "own amount", note: "private item", days: ["mon"] },
        { id: "supp", label: "Own supplement", category: "supplement", when: "evening" },
      ],
    };
    const report = buildDoctorReport(input);
    expect(report.logs.map((l) => l.id)).toEqual(["ends-at-start", "current", "ended-within", "starts-at-end"]);
    expect(report.logs[1]!.plan!.items.map((item) => item.category)).toEqual(["medication", "supplement"]);
    expect(report.logs[1]!.plan!.items[0]).not.toHaveProperty("note");
    input.options.includeNotes = true;
    expect(buildDoctorReport(input).logs[1]!.plan!.items[0]!.note).toBe("private item");
    input.options.includeLog = false;
    expect(buildDoctorReport(input).logs).toEqual([]);
  });

  it("strips private notes by default, omits app metadata, and always discloses example data", () => {
    const input = fixture();
    input.measurements = [reading("one", "2026-01-01", 4, { note: "private result" })];
    const report = buildDoctorReport(input);
    expect(report.example).toBe(true);
    expect(report.age).toBe(46);
    expect(report.profile).not.toHaveProperty("heightUnit");
    expect(report.profile).not.toHaveProperty("notes");
    expect(report.series[0]!.latest).not.toHaveProperty("note");
    expect(report.series[0]!.history[0]!.measurement).not.toHaveProperty("note");
    input.options.includeNotes = true;
    const withNotes = buildDoctorReport(input);
    expect(withNotes.profile!.notes).toBe("private profile");
    expect(withNotes.series[0]!.history[0]!.measurement.note).toBe("private result");
    input.options.includeProfile = false;
    const anonymous = buildDoctorReport(input);
    expect(anonymous).not.toHaveProperty("profile");
    expect(anonymous).not.toHaveProperty("age");
    expect(anonymous.example).toBe(true);
  });

  it("includes the latest weight on or before the report end even outside the chart selection", () => {
    const input = fixture();
    input.options.from = "2026-09-01";
    input.options.to = "2026-10-01";
    input.defs = new Map([...input.defs, ["weight", marker("weight", { category: "Body", canonicalUnit: "kg", defaultRanges: undefined })]]);
    input.measurements = [
      reading("blood", "2026-09-15", 4),
      reading("older-weight", "2026-01-01", 82, { biomarkerId: "weight" }),
      reading("chosen-weight", "2026-06-01", 81, { biomarkerId: "weight", originalUnit: "kg", source: "device", savedOrder: 3, note: "private weight note" }),
      reading("earlier-save", "2026-06-01", 80, { biomarkerId: "weight", savedOrder: 1 }),
      reading("after-report", "2026-10-20", 79, { biomarkerId: "weight" }),
      reading("invalid-date", "2026-02-30", 78, { biomarkerId: "weight" }),
    ];
    const report = buildDoctorReport(input);
    expect(report.series.map((series) => series.def.id)).toEqual(["blood"]);
    expect(report.profileWeight?.measurement).toMatchObject({ id: "chosen-weight", date: "2026-06-01", value: 81, originalUnit: "kg", source: "device" });
    expect(report.profileWeight!.measurement).not.toHaveProperty("note");
    report.profileWeight!.measurement.value = 0;
    expect(input.measurements[2]!.value).toBe(81);
    input.options.includeNotes = true;
    expect(buildDoctorReport(input).profileWeight!.measurement.note).toBe("private weight note");
    input.options.includeProfile = false;
    expect(buildDoctorReport(input)).not.toHaveProperty("profileWeight");
  });

  it("does not invent a profile weight when no reading exists by the report end", () => {
    const input = fixture();
    input.defs = new Map([...input.defs, ["weight", marker("weight", { category: "Body", canonicalUnit: "kg", defaultRanges: undefined })]]);
    input.options.to = "2026-06-01";
    input.measurements = [reading("later-weight", "2026-07-01", 81, { biomarkerId: "weight" })];
    expect(buildDoctorReport(input)).not.toHaveProperty("profileWeight");
  });

  it("uses the same report-date weight for BMI and Mifflin, not today's age or a later reading", () => {
    const input = fixture();
    input.profile.birthMonth = "1980-01";
    input.profile.heightCm = 180;
    input.options.to = "2026-06-01";
    input.defs = new Map([...input.defs, ["weight", marker("weight", { category: "Body", canonicalUnit: "kg", defaultRanges: undefined })]]);
    input.measurements = [
      reading("recorded-weight", "2020-01-16", 81, { biomarkerId: "weight", originalUnit: "kg" }),
      reading("later-weight", "2026-07-01", 100, { biomarkerId: "weight", originalUnit: "kg" }),
    ];
    const report = buildDoctorReport(input);
    expect(report.profileBmi).toBe(25);
    expect(report.profileRmr!.age).toBeCloseTo(40, 1);
    expect(report.profileRmr!.terms.total).toBeCloseTo(1574, 0);
    input.options.includeProfile = false;
    const privateReport = buildDoctorReport(input);
    expect(privateReport).not.toHaveProperty("profileBmi");
    expect(privateReport).not.toHaveProperty("profileRmr");
  });

  it("does not derive profile facts from a bounded weight or missing Mifflin inputs", () => {
    const input = fixture();
    input.profile.heightCm = 180;
    input.defs = new Map([...input.defs, ["weight", marker("weight", { category: "Body", canonicalUnit: "kg", defaultRanges: undefined })]]);
    input.measurements = [reading("weight-limit", "2026-01-01", 81, { biomarkerId: "weight", qualifier: "<" })];
    const bounded = buildDoctorReport(input);
    expect(bounded.profileWeight!.measurement.qualifier).toBe("<");
    expect(bounded.profileBmi).toBeUndefined();
    expect(bounded.profileRmr).toBeUndefined();
    input.measurements[0]!.qualifier = undefined;
    input.profile.sex = undefined;
    expect(buildDoctorReport(input).profileBmi).toBe(25);
    expect(buildDoctorReport(input).profileRmr).toBeUndefined();
    input.profile.sex = "f";
    input.profile.birthMonth = undefined;
    expect(buildDoctorReport(input).profileRmr).toBeUndefined();
    input.profile.birthMonth = "1980-05";
    input.profile.heightCm = undefined;
    expect(buildDoctorReport(input).profileBmi).toBeUndefined();
    expect(buildDoctorReport(input).profileRmr).toBeUndefined();
  });

  it("groups body readings like the Body page, keeps blood pressure adjacent, and retains unfamiliar markers", () => {
    const input = fixture();
    const ids = ["bp_diastolic", "pushups", "unfamiliar_body", "blood", "steps", "bp_systolic", "weight", "aging"];
    input.options.markerIds = ids;
    input.defs = new Map(ids.map((id) => [id, marker(id, { category: id === "blood" ? "Metabolic" : id === "aging" ? "Aging" : "Body" })]));
    input.measurements = ids.map((id) => reading(id, "2026-01-01", 4, { biomarkerId: id }));
    const report = buildDoctorReport(input);
    const grouped = groupDoctorReportSeries(report.series);
    expect(grouped.blood.map((series) => series.def.id)).toEqual(["blood", "aging"]);
    expect(grouped.body.map((group) => group.id)).toEqual(["size", "heart", "activity", "fitness", "other"]);
    expect(grouped.body.find((group) => group.id === "heart")!.series.map((series) => series.def.id)).toEqual(["bp_systolic", "bp_diastolic"]);
    expect(grouped.body.at(-1)!.series.map((series) => series.def.id)).toEqual(["unfamiliar_body"]);
    expect(report.series.map((series) => series.def.id)).toEqual(ids);
    expect([...grouped.blood, ...grouped.body.flatMap((group) => group.series)].map((series) => series.def.id).sort()).toEqual([...ids].sort());
  });

  it("does not mutate inputs and detaches mutable readings, ranges and grouped snapshots", () => {
    const input = fixture();
    input.measurements = [reading("one", "2026-02-01", 4, { note: "secret", labRange: { high: 8 } })];
    input.protocols = [
      {
        id: "log",
        label: "Routine",
        category: "lifestyle",
        start: "2026-01-01",
        plan: { id: "plan", items: [{ id: "item", label: "Medicine", category: "medication", when: "morning", note: "secret", days: ["mon"] }] },
      },
    ];
    const before = JSON.stringify(input);
    const report = buildDoctorReport(input);
    expect(JSON.stringify(input)).toBe(before);
    report.series[0]!.latest.labRange!.high = 99;
    report.series[0]!.latest.value = 99;
    report.series[0]!.history[0]!.measurement.labRange!.high = 100;
    report.series[0]!.latestRange!.high = 101;
    report.logs[0]!.plan!.items[0]!.days!.push("tue");
    report.logs[0]!.plan!.items[0]!.label = "Changed";
    expect(JSON.stringify(input)).toBe(before);
  });
});
