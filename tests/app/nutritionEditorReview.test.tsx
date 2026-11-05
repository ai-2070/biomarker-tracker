import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeItem } from "@bt/core/intake";
import type { FoodDb, Meal } from "@bt/core/meals";
import type { Measurement, Profile } from "@bt/core/types";

const state = vi.hoisted(() => ({ all: [] as Measurement[], profile: { sex: "f", birthMonth: "1986-10" } as Profile, items: [] as IntakeItem[], meals: [] as Meal[], foodDb: undefined as FoodDb | undefined }));
vi.mock("../../apps/web/src/app/hooks", () => ({
  useAllMeasurements: () => state.all, useProfile: () => state.profile, useProtocols: () => [], usePlans: () => [],
  useMeals: () => state.meals, useIntakeList: () => state.items, useDisplayUnits: () => ({}), setIntakeList: vi.fn(async () => {}),
}));
vi.mock("../../apps/web/src/app/foodDb", () => ({ useFoodDb: () => state.foodDb, EXAMPLE_MEALS: [] }));
vi.mock("../../apps/web/src/app/components/ResearchPanel", () => {
  return { ResearchPanel: ({ critical }: { critical: boolean }) => createElement("div", { "data-research-critical": String(critical) }) };
});
vi.mock("../../apps/web/src/app/components/EvidenceMap", () => ({ hasEvidenceMap: () => false, EvidenceMap: () => null }));
import { IntakePage } from "../../apps/web/src/app/pages/IntakePage";
import { NutrientPage } from "../../apps/web/src/app/pages/NutrientPage";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T12:00:00"));
  state.all = [];
  state.profile = { sex: "f", birthMonth: "1986-10" };
  state.items = [{ id: "supplement", kind: "supplement", nutrient: "potassium", amount: 100 }];
  state.foodDb = JSON.parse(readFileSync(join(import.meta.dirname, "../../knowledge/foods/cofid-all.json"), "utf8")) as FoodDb;
});
afterEach(() => vi.useRealTimers());
const potassium = (value: number): Measurement => ({ id: "critical", biomarkerId: "potassium", value, originalValue: value, originalUnit: "mmol/L", date: "2026-10-29", source: "manual" });

describe("nutrition review visible safety boundaries", () => {
  it("replaces intake food-increase ideas with urgent handling for a latest critical result", () => {
    const normal = renderToStaticMarkup(createElement(IntakePage));
    expect(normal).toContain("what would add the most");
    state.all = [potassium(6.5)];
    const critical = renderToStaticMarkup(createElement(IntakePage));
    expect(critical).toContain("Contact a doctor now");
    expect(critical).not.toContain("what would add the most");
    expect(critical).not.toContain("Meals with the most:");
    expect(critical).toContain("Vitamins and minerals");
  });

  it("warns, disables research handoff and removes change controls at critical status", () => {
    const normal = renderToStaticMarkup(createElement(NutrientPage, { id: "potassium" }));
    expect(normal).toContain('data-research-critical="false"');
    expect(normal).toContain("Start as a habit");
    state.all = [potassium(6.5)];
    const critical = renderToStaticMarkup(createElement(NutrientPage, { id: "potassium" }));
    expect(critical).toContain('data-research-critical="true"');
    expect(critical).toContain("Contact a doctor now");
    expect(critical).not.toContain("Start as a habit");
    expect(critical).not.toContain("Log a habit and watch the marker");
  });

  it("shows partial measurement coverage rather than an exact shortfall", () => {
    state.items = [{ id: "s", kind: "food", foodId: "13-573", grams: 10 }, { id: "a", kind: "food", foodId: "14-870", grams: 100 }];
    const html = renderToStaticMarkup(createElement(IntakePage));
    expect(html).toContain("Measured in 1 of 2 sources; the rest is unknown.");
    expect(html).toContain("Partly measured");
    expect(html).toContain("At least");
    expect(html).not.toContain("Vitamin K: 82 % of the reference");
  });

  it("keeps child totals without adult comparisons or food-increase ideas", () => {
    state.profile.birthMonth = "2016-10";
    state.items = [{ id: "calcium", kind: "supplement", nutrient: "calcium", amount: 1000 }];
    const html = renderToStaticMarkup(createElement(IntakePage));
    expect(html).toContain("Measured totals are shown without adult intake comparisons");
    expect(html).toContain("Adult reference not applicable");
    expect(html).not.toContain("what would add the most");
    expect(html).not.toContain("Reached");
  });

  it.each(["magnesium", "folate"])("preserves the source restriction next to %s's sidebar upper limit", (id) => {
    const html = renderToStaticMarkup(createElement(NutrientPage, { id }));
    const sidebar = html.slice(html.indexOf("EU values for a day"), html.indexOf("Supplement trials,"));
    expect(sidebar).toContain("Upper limits cover only the sources stated above");
    expect(sidebar).not.toContain("From food and supplements together.");
    expect(sidebar).toMatch(id === "magnesium" ? /naturally|supplement/i : /folic acid|supplement/i);
  });
});
