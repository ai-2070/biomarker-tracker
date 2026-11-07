import { dayNumber } from "@bt/shared/core/dates";
import { centerWindow, clampWindow, MIN_SPAN_DAYS, panWindow, presetWindow, timeTicks, zoomWindow } from "@bt/shared/core/timeWindow";
import { describe, expect, it } from "vitest";

const full = { from: dayNumber("2022-01-01"), to: dayNumber("2026-10-28") };

describe("time window", () => {
  it("stays inside the full range and never gets narrower than the minimum", () => {
    expect(clampWindow({ from: full.from - 100, to: full.from + 200 }, full)).toEqual({ from: full.from, to: full.from + 300 });
    expect(clampWindow({ from: full.to - 10, to: full.to + 50 }, full)).toEqual({ from: full.to - 60, to: full.to });
    const tiny = clampWindow({ from: full.from + 500, to: full.from + 505 }, full);
    expect(tiny.to - tiny.from).toBe(MIN_SPAN_DAYS);
    expect(clampWindow({ from: 0, to: 1e9 }, full)).toEqual(full);
  });

  it("zooms around the point under the pointer", () => {
    const w = { from: full.from + 400, to: full.from + 800 };
    const z = zoomWindow(w, 0.5, 0.5, full);
    expect(z).toEqual({ from: full.from + 500, to: full.from + 700 });
    const left = zoomWindow(w, 0.5, 0, full);
    expect(left.from).toBe(w.from);
    expect(zoomWindow(full, 2, 0.5, full)).toEqual(full);
  });

  it("can allow a narrower window (marker charts with daily readings)", () => {
    const w = zoomWindow({ from: full.to - 30, to: full.to }, 0.1, 1, full, 14);
    expect(w).toEqual({ from: full.to - 14, to: full.to });
    expect(clampWindow({ from: full.to - 5, to: full.to }, full, 14)).toEqual({ from: full.to - 14, to: full.to });
  });

  it("marks Mondays when the window is under 7 weeks", () => {
    const weeks = timeTicks({ from: dayNumber("2026-10-01"), to: dayNumber("2026-10-31") });
    expect(weeks.map((t) => [t.date, t.kind])).toEqual([
      ["2026-10-05", "day"],
      ["2026-10-12", "day"],
      ["2026-10-19", "day"],
      ["2026-10-26", "day"],
    ]);
  });

  it("centres the window on a day, inside the full range", () => {
    const w = { from: full.from + 100, to: full.from + 300 };
    expect(centerWindow(w, full.from + 1000, full)).toEqual({ from: full.from + 900, to: full.from + 1100 });
    expect(centerWindow(w, full.to, full)).toEqual({ from: full.to - 200, to: full.to });
  });

  it("moves and stops at the ends", () => {
    const w = presetWindow(365, full);
    expect(w).toEqual({ from: full.to - 365, to: full.to });
    expect(panWindow(w, 100, full)).toEqual(w);
    expect(panWindow(w, -100, full)).toEqual({ from: full.to - 465, to: full.to - 100 });
    expect(presetWindow("all", full)).toEqual(full);
  });

  it("picks years, half-years or months for the axis", () => {
    const years = timeTicks(full);
    expect(years.map((t) => t.date)).toEqual(["2023-01-01", "2024-01-01", "2025-01-01", "2026-01-01"]);
    expect(years.every((t) => t.kind === "year")).toBe(true);
    const halves = timeTicks({ from: dayNumber("2024-03-01"), to: dayNumber("2025-08-01") });
    expect(halves.map((t) => t.date)).toEqual(["2024-07-01", "2025-01-01", "2025-07-01"]);
    const months = timeTicks({ from: dayNumber("2025-11-15"), to: dayNumber("2026-02-20") });
    expect(months.map((t) => [t.date, t.kind])).toEqual([
      ["2025-12-01", "month"],
      ["2026-01-01", "year"],
      ["2026-02-01", "month"],
    ]);
  });
});
