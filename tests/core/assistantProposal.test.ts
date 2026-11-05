import { describe, expect, it } from "vitest";
import { proposalIntent, proposalIssue, type AssistantProposalContext } from "@bt/shared/core/assistantProposal";
import { parseHabitProposal } from "@bt/shared/core/habitProposal";
import { SAFETY_LIMITS } from "@bt/shared/core/foods";
import { mealSafetyBlock, mealTotals, validateMeal, type FoodDb } from "@bt/shared/core/meals";
import { planFromProposal } from "@bt/shared/core/plans";
import type { SafetyId } from "@bt/shared/core/types";

const context: AssistantProposalContext = { requestText: "Suggest a simple routine and a breakfast idea.", safety: [], critical: false };
const item = { label: "Walk after dinner", category: "lifestyle", when: "evening" };
const protocol = { intent: "recommend", name: "Evening routine", items: [item] };
const habit = { intent: "recommend", label: "Walk after dinner", category: "lifestyle", reason: "You asked for a simple habit to watch." };
const meal = { intent: "recommend", name: "Oats and berries", items: [{ foodId: "oats", grams: 50 }, { foodId: "berries", grams: 80 }], note: "Example portions: 50 grams oats and 80 g berries." };
const foods: FoodDb = {
  keys: ["energyKcal", "protein", "vitaminK1", "potassium", "retinol"],
  nutrients: {},
  foods: [["oats", "Oats", [380, 12, 0, 100, 0]], ["berries", "Berries", [50, 1, 0, 100, 0]], ["spinach", "Spinach", [30, 3, 500, 600, 0]], ["liver", "Liver", [150, 20, 0, 100, 1000]]],
};

describe("assistant proposal intents", () => {
  it("requires an explicit intent instead of trusting prose or a missing input", () => {
    expect(proposalIntent({ intent: "record" })).toBe("record");
    expect(proposalIntent(protocol)).toBe("recommend");
    for (const input of [null, [], "record", {}, { intent: "create" }, { intent: "RECOMMEND" }]) {
      expect(proposalIntent(input)).toBeUndefined();
      expect(proposalIssue("protocol", input, context)).toBeDefined();
    }
  });
});

describe("requested recommendation drafts", () => {
  it("accepts useful undosed protocol and habit drafts that existing validators can turn into cards", () => {
    expect(proposalIssue("protocol", protocol, context)).toBeUndefined();
    let nextId = 0;
    const parsed = planFromProposal(protocol, () => `fresh-${++nextId}`, "2026-10-30T00:00:00Z");
    expect(parsed.ok && parsed.plan.items[0]).toMatchObject(item);
    expect(proposalIssue("habit", habit, context)).toBeUndefined();
    expect(parseHabitProposal(habit, new Map(), "2026-10-30")).toMatchObject({ ok: true, proposal: { label: habit.label } });
    expect(proposalIssue("protocol", { ...protocol, items: [{ label: "Vitamin B12", category: "supplement", when: "any time" }] }, context)).toBeUndefined();
  });

  it("blocks medicines even when disguised as lifestyle items or put in notes", () => {
    for (const unsafe of [
      { ...item, category: "medication" },
      { ...item, label: "Metformin", category: "lifestyle" },
      { ...item, note: "Add aspirin" },
    ]) expect(proposalIssue("protocol", { ...protocol, items: [unsafe] }, context)).toBeDefined();
    expect(proposalIssue("habit", { ...habit, label: "Start atorvastatin" }, context)).toBeDefined();
    expect(proposalIssue("meal", { ...meal, note: "Add metformin" }, context)).toBeDefined();
  });

  it("blocks supplement amounts and doses in displayed fields and habit reasons", () => {
    for (const unsafe of [
      { ...item, amount: "a little" },
      { ...item, label: "Magnesium 200 mg", category: "supplement" },
      { ...item, note: "Two capsules at bedtime" },
      { ...item, note: "Use 200 milligrams" },
    ]) expect(proposalIssue("protocol", { ...protocol, items: [unsafe] }, context)).toBeDefined();
    expect(proposalIssue("protocol", { ...protocol, description: "Magnesium 200mg" }, context)).toBeDefined();
    expect(proposalIssue("protocol", { ...protocol, source: "Magnesium 200mg" }, context)).toBeDefined();
    expect(proposalIssue("habit", { ...habit, reason: "Add 2 capsules of magnesium." }, context)).toBeDefined();
    expect(proposalIssue("habit", { ...habit, reason: "Double your dose." }, context)).toBeDefined();
    // Existing habit parsing still rejects doses even when the intent says record.
    expect(proposalIssue("habit", { ...habit, intent: "record", label: "Iron 1 tablet" }, context)).toBeDefined();
    expect(proposalIssue("habit", { ...habit, label: "Walk 20 minutes" }, context)).toBeUndefined();
  });

  it("allows practical activity timing examples, but not amounts disguised as lifestyle supplements", () => {
    const timed = { ...protocol, items: [
      { ...item, amount: "20 minutes" },
      { label: "Casual strength training", category: "lifestyle", when: "any time", amount: "2 sessions per week" },
    ] };
    expect(proposalIssue("protocol", timed, context)).toBeUndefined();
    expect(proposalIssue("protocol", { ...protocol, items: [{ ...item, label: "Creatine", amount: "20 minutes" }] }, context)).toBeDefined();
  });

  it("blocks all drafts for critical results and rejects restriction or treatment instructions", () => {
    for (const [kind, input] of [["protocol", protocol], ["habit", habit], ["meal", meal]] as const) {
      expect(proposalIssue(kind, input, { ...context, critical: true })).toBeDefined();
      expect(proposalIssue(kind, { ...input, intent: "record" }, { ...context, critical: true })).toBeDefined();
    }
    for (const note of ["Eat only 1200 kcal", "1500 calories per day", "Under 1200 calories", "1200 kcal target", "Lose 5 kg", "A weight-loss plan", "Your dose is 2 capsules", "You should start medication"]) {
      expect(proposalIssue("meal", { ...meal, note }, context)).toBeDefined();
      expect(proposalIssue("protocol", { ...protocol, description: note }, context)).toBeDefined();
      expect(proposalIssue("habit", { ...habit, reason: note }, context)).toBeDefined();
    }
  });

  it("keeps free-text diet and supplement recommendations behind existing safety flags", () => {
    for (const flag of ["kidney", "pregnancy", "anticoagulant", "diabetes"] satisfies SafetyId[]) {
      const guarded = { ...context, safety: [flag] };
      for (const category of ["diet", "supplement"]) {
        expect(proposalIssue("protocol", { ...protocol, items: [{ ...item, category }] }, guarded)).toBeDefined();
        expect(proposalIssue("habit", { ...habit, category }, guarded)).toBeDefined();
      }
      expect(proposalIssue("habit", { ...habit, label: "Increase potassium", category: "lifestyle" }, guarded)).toBeDefined();
      expect(proposalIssue("protocol", { ...protocol, items: [{ ...item, label: "Change diet", category: "lifestyle" }] }, guarded)).toBeDefined();
      expect(proposalIssue("protocol", protocol, guarded)).toBeUndefined();
      expect(proposalIssue("habit", { ...habit, label: "Keep a consistent bedtime" }, guarded)).toBeUndefined();
      expect(proposalIssue("habit", { ...habit, label: "Walk after meals" }, guarded)).toBeUndefined();
    }
  });

  it("allows food grams and uses code totals and exact food safety limits rather than banning every guarded meal", () => {
    expect(proposalIssue("meal", meal, { ...context, safety: ["kidney"] })).toBeUndefined();
    expect(validateMeal({ ...meal, id: "meal", createdAt: "2026-10-30" }, foods)).toEqual([]);
    expect(mealTotals(meal.items, foods).energyKcal?.amount).toBe(230);
    expect(mealTotals(meal.items, foods).protein?.amount).toBeCloseTo(6.8);
    expect(mealSafetyBlock(meal.items, foods, [SAFETY_LIMITS.kidney!])).toBeUndefined();
    expect(mealSafetyBlock([{ foodId: "spinach", grams: 100 }], foods, [SAFETY_LIMITS.kidney!])).toBeDefined();
    expect(mealSafetyBlock([{ foodId: "spinach", grams: 100 }], foods, [SAFETY_LIMITS.anticoagulant!])).toBeDefined();
    expect(mealSafetyBlock([{ foodId: "liver", grams: 50 }], foods, [SAFETY_LIMITS.pregnancy!])).toBeDefined();
    expect(proposalIssue("meal", { ...meal, note: "Take one capsule with it" }, context)).toBeDefined();
  });
});

describe("recording only the newest supplied routine", () => {
  const source = { ...context, requestText: "Please record my routine: metformin 500 mg in the morning; Magnesium 200 mg at bedtime, only if deficient; Walk after dinner." };
  const recorded = {
    intent: "record", name: "My routine", items: [
      { label: "Metformin", amount: "500 mg", category: "medication", when: "morning" },
      { label: "Magnesium", amount: "200 mg", category: "supplement", when: "bedtime", note: "only if deficient" },
      item,
    ],
  };
  it("preserves the person's own medicine quantities and conditions without inventing treatment", () => {
    expect(proposalIssue("protocol", recorded, { ...source, safety: ["diabetes"] })).toBeUndefined();
    let nextId = 0;
    expect(planFromProposal(recorded, () => `fresh-${++nextId}`, "2026-10-30T00:00:00Z")).toMatchObject({ ok: true, plan: { items: recorded.items } });
  });
  it("rejects invented items, amounts or conditions, including quantities borrowed from another item", () => {
    for (const changed of [
      { ...recorded.items[0], label: "Aspirin" },
      { ...recorded.items[0], amount: "1000 mg" },
      { ...recorded.items[0], amount: "200 mg" },
      { ...recorded.items[1], amount: "2 mg" },
      { ...recorded.items[1], note: "Double your dose" },
      { ...recorded.items[1], note: "Increase until symptoms improve" },
    ]) expect(proposalIssue("protocol", { ...recorded, items: [changed] }, source)).toBeDefined();
    expect(proposalIssue("protocol", recorded, { ...context, requestText: "Use the earlier routine." })).toBeDefined();
    expect(proposalIssue("protocol", { ...recorded, items: [{ ...recorded.items[0], amount: "200 mg" }] }, { ...context, requestText: "Metformin 500 mg and Magnesium 200 mg" })).toBeDefined();
  });
  it("does not confuse a substring, a form number, or a decimal amount with another source item", () => {
    expect(proposalIssue("protocol", { ...recorded, items: [{ label: "Iron", category: "supplement", when: "any time" }] }, { ...context, requestText: "Record my thyroid routine." })).toBeDefined();
    const decimal = { ...recorded, items: [{ label: "Vitamin D3", amount: "2,5 µg", category: "supplement", when: "morning" }] };
    expect(proposalIssue("protocol", decimal, { ...context, requestText: "Record Vitamin D3 2,5 µg in the morning." })).toBeUndefined();
  });
});
