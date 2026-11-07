import "fake-indexeddb/auto";
import { addDays, todayIso } from "@bt/shared/core/dates";
import type { Meal } from "@bt/shared/core/meals";
import type { Plan } from "@bt/shared/core/plans";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveMeal, savePlan, startPlan, TrackerDB, updateMeal, updatePlan } from "../../apps/web/src/db/db";

let database: TrackerDB;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T12:00:00"));
  database = new TrackerDB(`nutrition-review-${crypto.randomUUID()}`);
  await database.open();
});
afterEach(async () => {
  await database.delete();
  vi.useRealTimers();
});
const meal: Meal = {
  id: "meal",
  name: "Original",
  createdAt: "2026-10-30",
  items: [
    { foodId: "spinach", grams: 100 },
    { foodId: "almonds", grams: 100 },
  ],
};
const plan: Plan = { id: "plan", name: "Original", createdAt: "2026-10-30", items: [{ id: "first", label: "Walk", category: "lifestyle", when: "any time" }] };

describe("nutrition review persistence", () => {
  it("rejects one-over-limit replacements and additions while retaining the accepted stored record", async () => {
    const fullMeal = { ...meal, items: Array.from({ length: 40 }, () => ({ foodId: "spinach", grams: 100 })) };
    const fullPlan = { ...plan, items: Array.from({ length: 60 }, (_, i) => ({ ...plan.items[0]!, id: `item${i}` })) };
    await saveMeal(fullMeal, database);
    await savePlan(fullPlan, database);
    await expect(saveMeal({ ...fullMeal, items: [...fullMeal.items, meal.items[0]!] }, database)).rejects.toThrow(/40/);
    await expect(updateMeal(meal.id, (current) => ({ ...current, items: [...current.items, meal.items[0]!] }), database)).rejects.toThrow(/40/);
    await expect(savePlan({ ...fullPlan, items: [...fullPlan.items, { ...plan.items[0]!, id: "overflow" }] }, database)).rejects.toThrow(/60/);
    await expect(
      updatePlan(plan.id, (current) => ({ ...current, items: [...current.items, { ...plan.items[0]!, id: "overflow" }] }), database),
    ).rejects.toThrow(/60/);
    expect(await database.meals.get(meal.id)).toEqual(fullMeal);
    expect(await database.plans.get(plan.id)).toEqual(fullPlan);
  });

  it("serializes pending field edits and deletion against actual storage, preserving the edited surviving grams and name", async () => {
    await saveMeal(meal, database);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    // Each operation represents an independent browser event, not a nested Dexie transaction.
    const blocker = Dexie.ignoreTransaction(() =>
      database.transaction("rw", database.meals, async () => {
        entered.resolve();
        await Dexie.waitFor(release.promise);
      }),
    );
    await entered.promise;
    const grams = Dexie.ignoreTransaction(() =>
      updateMeal(meal.id, (current) => ({ ...current, items: current.items.map((item, i) => (i === 0 ? { ...item, grams: 125 } : item)) }), database),
    );
    const name = Dexie.ignoreTransaction(() => updateMeal(meal.id, (current) => ({ ...current, name: "Updated" }), database));
    const remove = Dexie.ignoreTransaction(() => updateMeal(meal.id, (current) => ({ ...current, items: current.items.filter((_, i) => i !== 1) }), database));
    release.resolve();
    await Promise.all([blocker, grams, name, remove]);
    expect(await Dexie.ignoreTransaction(() => database.meals.get(meal.id))).toEqual({ ...meal, name: "Updated", items: [{ foodId: "spinach", grams: 125 }] });
  });

  it("preserves a concurrent protocol details edit when an item edit commits", async () => {
    await savePlan(plan, database);
    await Promise.all([
      updatePlan(plan.id, (current) => ({ ...current, name: "Changed details" }), database),
      updatePlan(plan.id, (current) => ({ ...current, items: [...current.items, { ...plan.items[0]!, id: "second", label: "Sleep" }] }), database),
    ]);
    const saved = await database.plans.get(plan.id);
    expect(saved?.name).toBe("Changed details");
    expect(saved?.items.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("admits the one-year planning boundary and rejects the next day atomically", async () => {
    await savePlan(plan, database);
    await expect(startPlan(plan, addDays(todayIso(), 366), database)).rejects.toThrow(/within the next year/);
    expect(await database.protocols.count()).toBe(0);
    expect((await database.plans.get(plan.id))?.active).toBeUndefined();
    await startPlan(plan, addDays(todayIso(), 365), database);
    expect(await database.protocols.count()).toBe(1);
    expect((await database.plans.get(plan.id))?.active?.since).toBe(addDays(todayIso(), 365));
  });
});
