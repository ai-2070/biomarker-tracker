import { describe, expect, it } from "vitest";
import {
  activeOn,
  durationDays,
  isActiveOn,
  laneFor,
  MAX_LABEL,
  safetyNotes,
  sortProtocols,
  validateProtocol,
} from "../../../shared/health/protocols.ts";

const today = "2025-06-01";

describe("validateProtocol", () => {
  it("accepts an ongoing entry and trims the label", () => {
    const r = validateProtocol({ label: "  Creatine 5 g  ", category: "supplement", start: "2025-01-01" }, today);
    expect(r).toEqual({ ok: true, entry: { label: "Creatine 5 g", category: "supplement", start: "2025-01-01" } });
  });

  it("keeps an end date and treats an empty one as ongoing", () => {
    const ended = validateProtocol({ label: "Iron", category: "supplement", start: "2025-01-01", end: "2025-03-01" }, today);
    expect(ended.ok && ended.entry.end).toBe("2025-03-01");
    const ongoing = validateProtocol({ label: "Iron", category: "supplement", start: "2025-01-01", end: " " }, today);
    expect(ongoing.ok && ongoing.entry.end).toBeUndefined();
  });

  it("allows a one-day entry", () => {
    expect(validateProtocol({ label: "Marathon", category: "lifestyle", start: "2025-04-01", end: "2025-04-01" }, today).ok).toBe(true);
  });

  it("reports every problem", () => {
    const r = validateProtocol({ label: "", category: "magic", start: "2025-13-01" }, today);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["category", "label", "start"]);
  });

  it("rejects future dates, end before start and long labels", () => {
    const future = validateProtocol({ label: "x", category: "diet", start: "2025-06-02" }, today);
    expect(!future.ok && future.errors.start).toMatch(/future/);
    const backwards = validateProtocol({ label: "x", category: "diet", start: "2025-03-01", end: "2025-02-01" }, today);
    expect(!backwards.ok && backwards.errors.end).toMatch(/before/);
    const futureEnd = validateProtocol({ label: "x", category: "diet", start: "2025-03-01", end: "2025-07-01" }, today);
    expect(!futureEnd.ok && futureEnd.errors.end).toMatch(/future/);
    const long = validateProtocol({ label: "x".repeat(MAX_LABEL + 1), category: "diet", start: "2025-03-01" }, today);
    expect(!long.ok && long.errors.label).toBeDefined();
  });
});

describe("activity", () => {
  const iron = { start: "2024-01-10", end: "2024-03-10" };
  const vitD = { start: "2024-02-01" };

  it("is inclusive at both ends", () => {
    expect(isActiveOn(iron, "2024-01-10")).toBe(true);
    expect(isActiveOn(iron, "2024-03-10")).toBe(true);
    expect(isActiveOn(iron, "2024-03-11")).toBe(false);
    expect(isActiveOn(iron, "2024-01-09")).toBe(false);
  });

  it("treats entries without an end as ongoing", () => {
    expect(isActiveOn(vitD, "2030-01-01")).toBe(true);
    expect(activeOn([iron, vitD], "2024-02-15")).toEqual([iron, vitD]);
    expect(activeOn([iron, vitD], "2024-05-01")).toEqual([vitD]);
  });

  it("sorts ongoing first, then by most recent end", () => {
    const a = { id: "a", start: "2023-01-01", end: "2023-02-01" };
    const b = { id: "b", start: "2024-01-01" };
    const c = { id: "c", start: "2022-01-01", end: "2024-01-01" };
    const d = { id: "d", start: "2024-05-01" };
    expect(sortProtocols([a, b, c, d]).map((p) => p.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("counts duration in days including both ends", () => {
    expect(durationDays({ start: "2024-01-01", end: "2024-01-01" }, today)).toBe(1);
    expect(durationDays({ start: "2025-05-02" }, today)).toBe(31);
  });
});

describe("laneFor", () => {
  const from = "2024-01-01";
  const to = "2024-12-31"; // 365-day span

  it("places an entry inside the chart range", () => {
    const lane = laneFor({ start: "2024-04-01", end: "2024-07-01" }, from, to, today)!;
    expect(lane.leftPct).toBeCloseTo((91 / 365) * 100, 6);
    expect(lane.widthPct).toBeCloseTo((91 / 365) * 100, 6);
    expect(lane.cutStart).toBe(false);
    expect(lane.cutEnd).toBe(false);
  });

  it("clips entries that start before or end after the chart", () => {
    const lane = laneFor({ start: "2023-06-01", end: "2025-03-01" }, from, to, today)!;
    expect(lane).toEqual({ leftPct: 0, widthPct: 100, cutStart: true, cutEnd: true });
  });

  it("runs ongoing entries to today", () => {
    const lane = laneFor({ start: "2024-07-01" }, from, to, today)!;
    expect(lane.leftPct + lane.widthPct).toBeCloseTo(100, 6);
    expect(lane.cutEnd).toBe(true);
  });

  it("returns nothing when there is no overlap", () => {
    expect(laneFor({ start: "2022-01-01", end: "2022-06-01" }, from, to, today)).toBeUndefined();
    expect(laneFor({ start: "2025-01-01" }, from, to, today)).toBeUndefined();
  });

  it("keeps one-day entries visible", () => {
    expect(laneFor({ start: "2024-06-01", end: "2024-06-01" }, from, to, today)!.widthPct).toBe(1);
  });

  it("handles a chart with a single date", () => {
    expect(laneFor({ start: "2023-01-01" }, "2024-01-01", "2024-01-01", today)).toEqual({ leftPct: 0, widthPct: 100, cutStart: true, cutEnd: true });
    expect(laneFor({ start: "2024-02-01" }, "2024-01-01", "2024-01-01", today)).toBeUndefined();
  });
});

describe("safetyNotes", () => {
  it("recognises blood thinners, diabetes medicines, pregnancy and kidney disease", () => {
    expect(safetyNotes(["Warfarin 5 mg"]).map((n) => n.id)).toEqual(["anticoagulant"]);
    expect(safetyNotes(["Eliquis"]).map((n) => n.id)).toEqual(["anticoagulant"]);
    expect(safetyNotes(["Metformin 500 mg twice daily"]).map((n) => n.id)).toEqual(["diabetes"]);
    expect(safetyNotes(["Ozempic weekly"]).map((n) => n.id)).toEqual(["diabetes"]);
    expect(safetyNotes(["Pregnant (2nd trimester)"]).map((n) => n.id)).toEqual(["pregnancy"]);
    expect(safetyNotes(["Prenatal vitamins"]).map((n) => n.id)).toEqual(["pregnancy"]);
    expect(safetyNotes(["Dialysis 3x/week"]).map((n) => n.id)).toEqual(["kidney"]);
  });
  it("returns each note once, in a fixed order", () => {
    expect(safetyNotes(["Insulin", "Warfarin", "Metformin"]).map((n) => n.id)).toEqual(["anticoagulant", "diabetes"]);
  });
  it("stays quiet for ordinary entries", () => {
    expect(safetyNotes(["Creatine 5 g", "Vitamin D 1000 IU", "Running 3x/week", "Mediterranean diet"])).toEqual([]);
  });
});
