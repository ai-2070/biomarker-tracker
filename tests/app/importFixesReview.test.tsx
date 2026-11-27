import "fake-indexeddb/auto";
import { parseLabText } from "@bt/shared/core/importers/labText";
import type { Measurement } from "@bt/shared/core/types";
import type * as ReactModule from "react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Review } from "../../apps/web/src/app/components/LabReview";
import { BIOMARKER_MAP } from "../../apps/web/src/app/knowledge";
import { DeviceImportPage } from "../../apps/web/src/app/pages/DeviceImportPage";
import { db } from "../../apps/web/src/db/db";

// Exercise the real review event handlers and IndexedDB writes without a browser DOM.
// Hooks are an explicit state harness; the browser smoke still covers Base UI interaction.
const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  loaded: undefined as (() => void) | undefined,
  saved: undefined as (() => void) | undefined,
  existing: [] as Measurement[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useState(initial: unknown) {
    const slot = state.cursor++;
    if (!(slot in state.values)) state.values[slot] = typeof initial === "function" ? initial() : initial;
    return [
      state.values[slot],
      (next: unknown) => {
        state.values[slot] = typeof next === "function" ? next(state.values[slot]) : next;
        const value = state.values[slot];
        if (value && typeof value === "object" && "rows" in value) state.loaded?.();
        if (value && typeof value === "object" && "readings" in value && "kinds" in value) state.saved?.();
      },
    ];
  },
  useMemo: (compute: () => unknown) => compute(),
  useId: () => "import-review-test",
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}));
vi.mock("../../apps/web/src/app/hooks", () => ({ useAllMeasurements: () => state.existing }));

type Node = ReactElement<Record<string, unknown>>;
function elements(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}
function named(tree: ReactNode, name: string): Node {
  const node = elements(tree).find((e) => typeof e.type === "function" && e.type.name === name);
  if (!node) throw new Error(`Missing ${name} in review tree`);
  return node;
}
function text(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (isValidElement<Record<string, unknown>>(tree)) return text(tree.props.children as ReactNode);
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
function saveButton(tree: ReactNode): Node {
  const node = elements(tree).find((e) => typeof e.props.onClick === "function" && /^Save(?:\s|$)/.test(text(e.props.children as ReactNode)));
  if (!node) throw new Error("Missing Save button");
  return node;
}
function deviceTree() {
  state.cursor = 0;
  return DeviceImportPage();
}
async function choose(files: File[]) {
  const tree = deviceTree();
  const input = elements(tree).find((e) => e.type === "input" && e.props.accept)!;
  const loaded = Promise.withResolvers<void>();
  state.loaded = loaded.resolve;
  (input.props.onChange as (event: unknown) => void)({ target: { files } });
  await loaded.promise;
  state.loaded = undefined;
  return deviceTree();
}
function seriesTree(tree: ReactNode) {
  const node = named(tree, "SeriesRow");
  return (node.type as (props: Record<string, unknown>) => ReactNode)(node.props);
}

beforeEach(async () => {
  state.values = [];
  state.cursor = 0;
  state.existing = [];
  state.loaded = undefined;
  state.saved = undefined;
  await db.measurements.clear();
});

describe("import review consumer boundaries", () => {
  it("saves identical pending lab rows once but retains exact and comparator observations", async () => {
    const report = parseLabText(
      "Collected: 2026-03-01\nFerritin 45 µg/L 15 - 150\nFerritin 45 µg/L 15 - 150\nC-reactive protein < 0.3 mg/L\nC-reactive protein 0.3 mg/L",
      [...BIOMARKER_MAP.values()],
    );
    let skipped = -1;
    const saved = Promise.withResolvers<void>();
    const tree = Review({
      fileName: "synthetic.pdf",
      fromPicture: false,
      report,
      onCancel() {},
      onSaved(_rows, count) {
        skipped = count;
        saved.resolve();
      },
    });
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const rows = await db.measurements.toArray();
    expect(rows).toHaveLength(3);
    expect(skipped).toBe(1);
    expect(rows.filter((m) => m.biomarkerId === "ferritin")).toHaveLength(1);
    expect(
      rows
        .filter((m) => m.biomarkerId !== "ferritin")
        .map((m) => m.qualifier ?? "exact")
        .sort(),
    ).toEqual(["<", "exact"]);
  });

  it("keeps an empty remapped series correctable and disables saving until it recovers", async () => {
    let tree = await choose([new File(["Date,Weight (kg)\n2026-03-01,80"], "scale.csv")]);
    let series = seriesTree(tree);
    (named(series, "FieldSelect").props.onChange as (field: string) => void)("body_fat");
    tree = deviceTree();
    series = seriesTree(tree);
    expect(text(series)).toContain("No usable readings");
    expect(text(series)).toContain("1 impossible reading left out");
    expect(saveButton(tree).props.disabled).toBe(true);
    (named(series, "FieldSelect").props.onChange as (field: string) => void)("weight");
    tree = deviceTree();
    expect(text(seriesTree(tree))).toContain("latest 80 kg");
    expect(saveButton(tree).props.disabled).toBe(false);
  });

  it("saves overlapping summary exports as 8000 and 9000 steps, never 16000", async () => {
    const tree = await choose([
      new File(["Date,Steps\n2026-03-01,8000"], "activities-2026-03-01.csv"),
      new File(["Date,Steps\n2026-03-01,8000\n2026-03-02,9000"], "activities-2026-03-02.csv"),
    ]);
    expect(text(seriesTree(tree))).toContain("1 overlapping summary or sample row left out");
    const saved = Promise.withResolvers<void>();
    state.saved = saved.resolve;
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const rows = await db.measurements.orderBy("date").toArray();
    expect(rows.map((m) => [m.date, m.value])).toEqual([
      ["2026-03-01", 8000],
      ["2026-03-02", 9000],
    ]);
  });

  it("carries dated sleep windows through the real selected-series review and save flow", async () => {
    const csv =
      "date,startTime,endTime,total sleep (h)\n2026-03-02,2026-03-01T23:00:00,2026-03-02T06:00:00,7\n2026-03-02,2026-03-02T14:00:00,2026-03-02T14:30:00,0.5";
    const tree = await choose([new File([csv], "fitbit-sleep-2026-03-02.csv"), new File([csv], "fitbit-sleep-2026-03-03.csv")]);
    const review = text(seriesTree(tree));
    expect(review).toContain("1 night with timing");
    expect(review).toContain("2 recorded windows (session estimates)");
    expect(review).toContain("2 with unknown time-zone offsets");
    const saved = Promise.withResolvers<void>();
    state.saved = saved.resolve;
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const rows = await db.measurements.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ biomarkerId: "sleep_duration", date: "2026-03-02", value: 7.5, source: "device" });
    expect(rows[0]!.sleepSessions).toEqual([
      { start: "2026-03-01T23:00:00", end: "2026-03-02T06:00:00", kind: "session", source: "Fitbit" },
      { start: "2026-03-02T14:00:00", end: "2026-03-02T14:30:00", kind: "session", source: "Fitbit" },
    ]);
    expect(JSON.parse(JSON.stringify(rows[0]))).toEqual(rows[0]);
  });

  it("keeps the first selected sleep series' duration and timings together on overlapping days", async () => {
    const tree = await choose([
      new File(["date,startTime,endTime,total sleep (h)\n2026-03-02,2026-03-01T23:00:00,2026-03-02T07:00:00,7"], "fitbit-sleep.csv"),
      new File(["date,bedtime_start,bedtime_end,total sleep (h)\n2026-03-02,2026-03-01T22:00:00+01:00,2026-03-02T06:00:00+01:00,6.5"], "oura-sleep.csv"),
    ]);
    const saved = Promise.withResolvers<void>();
    state.saved = saved.resolve;
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const rows = await db.measurements.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(7);
    expect(rows[0]!.sleepSessions).toEqual([{ start: "2026-03-01T23:00:00", end: "2026-03-02T07:00:00", kind: "session", source: "Fitbit" }]);
  });

  it("drops timing metadata when the reviewed sleep series is remapped to another marker", async () => {
    let tree = await choose([new File(["date,startTime,endTime,total sleep (h)\n2026-03-02,2026-03-01T23:00:00,2026-03-02T07:00:00,7"], "fitbit-sleep.csv")]);
    (named(seriesTree(tree), "FieldSelect").props.onChange as (field: string) => void)("sleep_deep");
    tree = deviceTree();
    expect(text(seriesTree(tree))).not.toContain("night with timing");
    const saved = Promise.withResolvers<void>();
    state.saved = saved.resolve;
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const rows = await db.measurements.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ biomarkerId: "sleep_deep", value: 7 });
    expect(rows[0]!.sleepSessions).toBeUndefined();
  });

  it("saves valid duration-only rows even when explicit timing is unusable, replacing earlier timings", async () => {
    let tree = await choose([new File(["date,startTime,endTime,total sleep (h)\n2026-03-02,2026-03-01T23:00:00,2026-03-02T07:00:00,7"], "fitbit-sleep.csv")]);
    let saved = Promise.withResolvers<void>();
    state.saved = saved.resolve;
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const original = (await db.measurements.toArray())[0]!;
    tree = await choose([new File(["date,startTime,endTime,total sleep (h)\n2026-03-02,unknown,unknown,8"], "fitbit-sleep.csv")]);
    expect(text(seriesTree(tree))).toContain("Duration only");
    saved = Promise.withResolvers<void>();
    state.saved = saved.resolve;
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const rows = await db.measurements.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: original.id, biomarkerId: "sleep_duration", value: 8 });
    expect(rows[0]!.sleepSessions).toBeUndefined();
  });

  it.each(["Apple", "Samsung"])("preserves %s parser timings through file selection, review and saving", async (provider) => {
    const file =
      provider === "Apple"
        ? new File(
            [
              '<Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleep" startDate="2026-03-01 23:00:00 +0100" endDate="2026-03-02 06:00:00 +0100" sourceName="Apple Watch"/>',
            ],
            "export.xml",
          )
        : new File(
            ["start_time,end_time,sleep_id,stage,time_offset\n2026-03-01 22:00:00.000,2026-03-02 05:00:00.000,night,40002,UTC+0100"],
            "com.samsung.health.sleep_stage.csv",
          );
    const tree = await choose([file]);
    expect(text(seriesTree(tree))).toContain("1 night with timing");
    expect(text(seriesTree(tree))).toContain("asleep bounds");
    expect(text(seriesTree(tree))).toContain("source offsets recorded");
    const saved = Promise.withResolvers<void>();
    state.saved = saved.resolve;
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const rows = await db.measurements.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ biomarkerId: "sleep_duration", value: 7, date: "2026-03-02" });
    expect(rows[0]!.sleepSessions![0]).toMatchObject({ kind: "asleep", startOffsetMinutes: 60, endOffsetMinutes: 60 });
    expect(rows[0]!.sleepSessions![0]!.start.slice(0, 19)).toBe("2026-03-01T23:00:00");
    expect(rows[0]!.sleepSessions![0]!.end.slice(0, 19)).toBe("2026-03-02T06:00:00");
  });
});
