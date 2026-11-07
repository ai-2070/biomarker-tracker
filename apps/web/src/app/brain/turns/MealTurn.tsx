import { useState } from "react";
import { SAFETY_LIMITS } from "@bt/shared/core/foods";
import { foodById, mealSafetyBlock, mealTotals } from "@bt/shared/core/meals";
import { safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import { formatValue } from "@bt/shared/core/units";
import { db as localDb, getProfile, saveMeal } from "../../../db/db";
import { SafetyNotices } from "../../components/SafetyNotices";
import { Button, CheckIcon, cardStyles, cx } from "../../components/ui";
import { useFoodDb } from "../../foodDb";
import { useProfile, useProtocols } from "../../hooks";
import { href } from "../../router";
import { setHabitState, type Turn } from "../store";

/**
 * A recorded recipe or requested meal idea. Totals and safety checks use the app's food table,
 * never the model's arithmetic. Saving still requires the person's review.
 */
export function MealTurn({ turn }: { turn: Extract<Turn, { role: "meal" }> }) {
  const foodDb = useFoodDb();
  const profile = useProfile();
  const habits = useProtocols();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const recommended = turn.intent === "recommend";
  const safety = safetyNotes(safetyLabels(habits ?? [], profile));
  const limits = safety.flatMap(({ id }) => SAFETY_LIMITS[id] ? [SAFETY_LIMITS[id]!] : []);
  const blocked = recommended && foodDb ? mealSafetyBlock(turn.meal.items, foodDb, limits) : undefined;
  if (turn.state === "dismissed") return <p className="text-center text-sm text-ink-2">Meal not saved.</p>;
  if (turn.state === "saved") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ok-soft p-3 text-sm">
        <span className="flex items-center gap-2">
          <CheckIcon className="size-4 text-ok" /> Meal saved: <span className="font-medium">{turn.meal.name}</span>
        </span>
        <a href={href({ name: "meal", id: turn.meal.id })} className="font-medium text-ink underline underline-offset-2">
          Open it
        </a>
      </div>
    );
  }
  const t = foodDb ? mealTotals(turn.meal.items, foodDb) : undefined;
  const v = (k: string) => (t?.[k] && t[k]!.measuredIn > 0 ? formatValue(Math.round(t[k]!.amount * 10) / 10) : "–");

  async function save() {
    if (!foodDb || saving) return;
    setError(undefined);
    setSaving(true);
    try {
      if (recommended) {
        // Read again at the click, so a Settings or Habits change cannot leave a stale safe draft.
        const [currentProfile, currentHabits] = await Promise.all([getProfile(), localDb.protocols.toArray()]);
        const currentLimits = safetyNotes(safetyLabels(currentHabits, currentProfile))
          .flatMap(({ id }) => SAFETY_LIMITS[id] ? [SAFETY_LIMITS[id]!] : []);
        const issue = mealSafetyBlock(turn.meal.items, foodDb, currentLimits);
        if (issue) {
          setError(`${issue}. Talk to your doctor before changing these foods.`);
          return;
        }
      }
      await saveMeal(turn.meal);
      setHabitState(turn.id, "saved");
    } catch {
      setError("The meal couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cx("flex flex-col gap-3 p-3", cardStyles)}>
      <div>
        <p className="text-sm font-medium">{recommended ? "Suggested meal" : "Meal from your recipe"} · {turn.meal.items.length} foods</p>
        <p className="mt-0.5 font-medium break-words">{turn.meal.name}</p>
      </div>
      <ul className="flex flex-col gap-0.5 rounded-lg bg-sunken p-2 text-sm">
        {turn.meal.items.map((it, i) => (
          <li key={`${it.foodId}-${i}`} className="flex justify-between gap-2">
            <span className="min-w-0 break-words">{foodDb ? (foodById(foodDb, it.foodId)?.name ?? it.foodId) : it.foodId}</span>
            <span className="shrink-0 text-ink-2 tabular-nums">{it.grams} g</span>
          </li>
        ))}
      </ul>
      {t && (
        <p className="text-sm tabular-nums">
          {v("energyKcal")} kcal · {v("protein")} g protein · {v("fat")} g fat · {v("carbohydrate")} g carbohydrate · {v("fibre")} g fibre
          <span className="block text-xs text-ink-2">Worked out by the app from the food table. Vitamins and minerals are on the meal's page.</span>
        </p>
      )}
      <p className="text-xs text-ink-2">{recommended
        ? "These are example food portions, not a daily target or a complete diet. Review them before saving; you can edit the meal afterwards."
        : "Check that the foods and weights match your recipe; you can change them after saving."}</p>
      {recommended && safety.length > 0 && <SafetyNotices notes={safety} />}
      {blocked && <p role="alert" className="rounded-lg bg-warn-soft p-2 text-sm">{blocked}. Talk to your doctor before changing these foods. This suggestion cannot be saved.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={saving || !foodDb || !!blocked || (recommended && !habits)} onClick={() => void save()}>
          {saving ? "Saving…" : "Save meal"}
        </Button>
        <Button variant="secondary" onClick={() => setHabitState(turn.id, "dismissed")}>
          Not now
        </Button>
      </div>
    </div>
  );
}
