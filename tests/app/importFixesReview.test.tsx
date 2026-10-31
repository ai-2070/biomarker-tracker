import "fake-indexeddb/auto";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceImportPage } from "../../src/app/pages/DeviceImportPage";
import { Review } from "../../src/app/components/LabReview";
import { parseLabText } from "../../src/core/importers/labText";
import { BIOMARKER_MAP } from "../../src/app/knowledge";
import { db } from "../../src/db/db";
import type { Measurement } from "../../src/core/types";

// Exercise the real review event handlers and IndexedDB writes without a browser DOM.
// Hooks are an explicit state harness; the browser smoke still covers Base UI interaction.
const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, loaded: undefined as (() => void) | undefined, saved: undefined as (() => void) | undefined, existing: [] as Measurement[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof ReactModule>(),
  useState(initial: unknown) {
    const slot = state.cursor++;
    if (!(slot in state.values)) state.values[slot] = typeof initial === "function" ? initial() : initial;
    return [state.values[slot], (next: unknown) => {
      state.values[slot] = typeof next === "function" ? next(state.values[slot]) : next;
      const value = state.values[slot];
      if (value && typeof value === "object" && "rows" in value) state.loaded?.();
      if (value && typeof value === "object" && "readings" in value && "kinds" in value) state.saved?.();
    }];
  },
  useMemo: (compute: () => unknown) => compute(),
  useId: () => "import-review-test",
}));
vi.mock("../../src/app/hooks", () => ({ useAllMeasurements: () => state.existing }));

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
    const report = parseLabText("Collected: 2026-03-01\nFerritin 45 µg/L 15 - 150\nFerritin 45 µg/L 15 - 150\nC-reactive protein < 0.3 mg/L\nC-reactive protein 0.3 mg/L", [...BIOMARKER_MAP.values()]);
    let skipped = -1;
    const saved = Promise.withResolvers<void>();
    const tree = Review({ fileName: "synthetic.pdf", ocr: false, report, onCancel() {}, onSaved(_rows, count) { skipped = count; saved.resolve(); } });
    (saveButton(tree).props.onClick as () => void)();
    await saved.promise;
    const rows = await db.measurements.toArray();
    expect(rows).toHaveLength(3);
    expect(skipped).toBe(1);
    expect(rows.filter((m) => m.biomarkerId === "ferritin")).toHaveLength(1);
    expect(rows.filter((m) => m.biomarkerId !== "ferritin").map((m) => m.qualifier ?? "exact").sort()).toEqual(["<", "exact"]);
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
    expect(rows.map((m) => [m.date, m.value])).toEqual([["2026-03-01", 8000], ["2026-03-02", 9000]]);
  });
});
