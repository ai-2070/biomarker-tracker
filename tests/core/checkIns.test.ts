import {
  addMonths,
  adherence,
  type CheckIn,
  checkInsError,
  dayPlan,
  dayState,
  firstTicks,
  isCheckIn,
  monthWeeks,
  planState,
  recentDays,
  toggled,
  trackedOn,
  weekdayOf,
} from "@bt/shared/core/checkIns";
import type { PlanItem } from "@bt/shared/core/plans";
import type { ProtocolEntry } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";

const item = (id: string, when: PlanItem["when"], extra: Partial<PlanItem> = {}): PlanItem => ({ id, label: id, category: "supplement", when, ...extra });
const routine: ProtocolEntry = {
  id: "r",
  label: "Morning routine",
  category: "supplement",
  start: "2026-11-01",
  plan: {
    id: "p",
    items: [
      item("d3", "morning", { amount: "2000 IU", withFood: true }),
      item("walk", "evening", { category: "lifestyle" }),
      item("lift", "any time", { category: "lifestyle", days: ["mon", "wed", "fri"] }),
      item("old", "with meals"),
    ],
  },
};
const walking: ProtocolEntry = { id: "w", label: "Walk after dinner", category: "lifestyle", start: "2026-11-10" };
const ended: ProtocolEntry = { id: "e", label: "Fish oil", category: "supplement", start: "2026-01-01", end: "2026-11-01" };
const row = (habitId: string, date: string, items?: string[]): CheckIn => ({ id: `${habitId}|${date}`, habitId, date, ...(items ? { items } : {}) });

describe("daily check-ins", () => {
  it("knows the day of the week", () => {
    expect(weekdayOf("2026-11-27")).toBe("fri");
    expect(weekdayOf("2026-11-29")).toBe("sun");
    expect(weekdayOf("1969-12-31")).toBe("wed");
  });

  it("lists today's items by time of day, weekday items only on their days, ended habits not at all", () => {
    const friday = dayPlan([routine, walking, ended], [row("r", "2026-11-27", ["d3"]), row("w", "2026-11-27")], "2026-11-27");
    expect(friday.groups.map((g) => [g.when, g.tasks.map((t) => `${t.label}${t.done ? "✓" : ""}`)])).toEqual([
      ["morning", ["d3✓"]],
      ["evening", ["walk"]],
      ["any time", ["lift", "old", "Walk after dinner✓"]],
    ]);
    expect(friday.groups[0]!.tasks[0]).toMatchObject({ amount: "2000 IU", withFood: true, habit: "Morning routine" });
    expect(friday.groups[2]!.tasks[1]).toMatchObject({ withFood: true });
    expect(friday).toMatchObject({ done: 2, total: 5 });
    const saturday = dayPlan([routine], [], "2026-11-28");
    expect(saturday.groups.flatMap((g) => g.tasks.map((t) => t.label))).toEqual(["d3", "walk", "old"]);
  });

  it("ticks and unticks items, removing the row when nothing is left", () => {
    const a = toggled(undefined, "r", "2026-11-27", "walk");
    expect(a).toEqual(row("r", "2026-11-27", ["walk"]));
    const b = toggled(a, "r", "2026-11-27", "d3");
    expect(b?.items).toEqual(["d3", "walk"]);
    expect(toggled(toggled(b, "r", "2026-11-27", "d3"), "r", "2026-11-27", "walk")).toBeUndefined();
    expect(toggled(undefined, "w", "2026-11-27")).toEqual(row("w", "2026-11-27"));
    expect(toggled(row("w", "2026-11-27"), "w", "2026-11-27")).toBeUndefined();
  });

  it("counts adherence only from the first day ticked, never as zero for a habit nobody ticked", () => {
    expect(adherence(walking, [], "2026-11-27")).toBeUndefined();
    const ticks = [row("w", "2026-11-20"), row("w", "2026-11-21"), row("w", "2026-11-23")];
    // 20th to 26th (today, the 27th, is not ticked yet): 7 days, 3 done.
    expect(adherence(walking, ticks, "2026-11-27")).toEqual({ since: "2026-11-20", days: 7, doneDays: 3, share: 3 / 7 });
    // Ticking today counts today.
    expect(adherence(walking, [...ticks, row("w", "2026-11-27")], "2026-11-27")).toMatchObject({ days: 8, doneDays: 4 });
    expect(adherence(walking, ticks, "2026-11-27", "2026-11-21")).toMatchObject({ days: 2, doneDays: 2, share: 1 });
  });

  it("counts a protocol's planned items per day, part days included in the share", () => {
    // Thu 26th: d3, walk, old (3). Fri 27th: d3, walk, lift, old (4).
    const ticks = [row("r", "2026-11-26", ["d3", "walk", "old"]), row("r", "2026-11-27", ["d3"])];
    expect(adherence(routine, ticks, "2026-11-27")).toEqual({ since: "2026-11-26", days: 2, doneDays: 1, share: 4 / 7 });
    expect(dayState(routine, ticks[1], "2026-11-27")).toBe("part");
    expect(dayState(routine, ticks[0], "2026-11-26")).toBe("done");
    expect(dayState(routine, undefined, "2026-10-01")).toBe("off");
    expect(recentDays(walking, [row("w", "2026-11-27")], "2026-11-27", 3).map((d) => d.state)).toEqual(["none", "none", "done"]);
  });

  it("plans every-other-day items from the day the protocol started", () => {
    const light: ProtocolEntry = {
      id: "l",
      label: "Red light",
      category: "lifestyle",
      start: "2026-11-24",
      plan: { id: "lp", items: [item("panel", "evening", { category: "lifestyle", every: 2 })] },
    };
    const planned = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"].map((d) => dayPlan([light], [], d).total);
    expect(planned).toEqual([0, 1, 0, 1, 0]);
    // Days with nothing planned don't count against it.
    expect(adherence(light, [row("l", "2026-11-24", ["panel"]), row("l", "2026-11-26", ["panel"])], "2026-11-27")).toMatchObject({ days: 2, doneDays: 2 });
    expect(dayState(light, undefined, "2026-11-25")).toBe("off");
  });

  it("checks stored rows", () => {
    expect(isCheckIn(row("r", "2026-11-27", ["d3"]))).toBe(true);
    expect(isCheckIn(row("w", "2026-11-27"))).toBe(true);
    expect(isCheckIn({ ...row("r", "2026-11-27"), id: "r|2026-11-26" })).toBe(false);
    expect(isCheckIn(row("r", "2026-11-27", []))).toBe(false);
    expect(isCheckIn(row("r", "2026-11-27", ["a", "a"]))).toBe(false);
    expect(isCheckIn({ ...row("r", "2026-11-27"), extra: 1 })).toBe(false);
    expect(checkInsError([row("w", "2026-11-27"), row("w", "2026-11-27")])).toContain("duplicate");
    expect(checkInsError([])).toBeUndefined();
    expect(checkInsError({})).toBeDefined();
  });
});

describe("the habits calendar", () => {
  it("lays a month out Monday first, padded to whole weeks", () => {
    const weeks = monthWeeks("2026-11");
    expect(weeks[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(weeks.at(-1)).toEqual(["2026-11-30", null, null, null, null, null, null]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(monthWeeks("2027-02").flat().filter(Boolean)).toHaveLength(28);
  });

  it("counts a habit only from its first tick", () => {
    const first = firstTicks([row("w", "2026-11-23"), row("w", "2026-11-20"), row("r", "2026-11-26", ["d3"])]);
    expect(Object.fromEntries(first)).toEqual({ w: "2026-11-20", r: "2026-11-26" });
    expect(trackedOn([routine, walking, ended], first, "2026-11-21").map((p) => p.id)).toEqual(["w"]);
    expect(trackedOn([routine, walking, ended], first, "2026-11-27").map((p) => p.id)).toEqual(["r", "w"]);
  });

  it("moves between months and sums a day's plan", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", -13)).toBe("2025-10");
    expect([planState({ done: 0, total: 0 }), planState({ done: 2, total: 2 }), planState({ done: 1, total: 2 }), planState({ done: 0, total: 3 })]).toEqual([
      "off",
      "done",
      "part",
      "none",
    ]);
  });
});
