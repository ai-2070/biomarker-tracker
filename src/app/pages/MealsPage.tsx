import { SAFETY_LIMITS } from "../../core/foods";
import { mealSafetyBlock, mealTotals, mealWeight, type ExampleMeal, type FoodDb, type Meal } from "../../core/meals";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { flagLatest, groupByBiomarker } from "../../core/trends";
import { formatValue } from "../../core/units";
import type { SafetyId } from "../../core/types";
import { newId, saveMeal } from "../../db/db";
import { openBrain } from "../brain/store";
import { DarkMatterExplainer } from "../components/DarkMatter";
import { COMPARISON_CLAIMS, FoodComparison } from "../components/FoodComparison";
import { Fold, FoldGroup } from "../components/disclosure";
import { BrainIcon, PlusIcon } from "../components/icons";
import { Button, Card, PageTitle } from "../components/ui";
import { EXAMPLE_MEALS, useFoodDb } from "../foodDb";
import { useAllMeasurements, useMeals, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, EVIDENCE, nameInSentence } from "../knowledge";
import { href } from "../router";

/**
 * Meals: build meals from foods and grams and see what the food table measured in them, starting from
 * what food tables can't tell (nutritional dark matter). Example meals are matched to the person's
 * out-of-range results through the evidence levers, and hidden when they don't suit them.
 */
export function MealsPage() {
  const db = useFoodDb();
  const meals = useMeals();
  const all = useAllMeasurements() ?? [];
  const profile = useProfile();
  const habits = useProtocols() ?? [];
  const safety: SafetyId[] = safetyNotes(safetyLabels(habits, profile)).map((n) => n.id);
  const limits = safety.flatMap((s) => (SAFETY_LIMITS[s] ? [SAFETY_LIMITS[s]!] : []));

  // Markers whose latest result is out of range, and in which direction.
  const off = new Map<string, "low" | "high">();
  for (const [id, ms] of groupByBiomarker(all)) {
    const def = BIOMARKER_MAP.get(id);
    const f = def ? flagLatest(def, ms, profile) : "unknown";
    if (f === "low" || f === "critical-low") off.set(id, "low");
    if (f === "high" || f === "critical-high") off.set(id, "high");
  }
  const markersOf = (m: ExampleMeal) => EVIDENCE.filter((c) => m.claimIds.includes(c.id)).flatMap((c) => c.markers);
  const forYou = (m: ExampleMeal) => markersOf(m).filter((x) => off.get(x.biomarkerId) === x.helpsWhen);
  const blocked = db ? EXAMPLE_MEALS.flatMap((m) => (mealSafetyBlock(m.items, db, limits) ? [{ m, why: mealSafetyBlock(m.items, db, limits)! }] : [])) : [];
  const usable = EXAMPLE_MEALS.filter((m) => !blocked.some((b) => b.m.id === m.id));
  const mine = usable.filter((m) => forYou(m).length > 0);
  const rest = usable.filter((m) => forYou(m).length === 0);

  async function create() {
    const meal: Meal = { id: newId(), name: "New meal", items: [], createdAt: new Date().toISOString() };
    await saveMeal(meal);
    location.hash = href({ name: "meal", id: meal.id });
  }

  return (
    <>
      <PageTitle sub="Build a meal from foods and grams and see what it contains. No targets, no diet plans.">
        Meals
      </PageTitle>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={() => void create()}>
          <PlusIcon /> New meal
        </Button>
        <Button variant="secondary" onClick={() => openBrain({ draft: "Turn this into a meal (foods and grams): " })}>
          <BrainIcon width={18} height={18} /> Ask Brain to write one from a recipe
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-normal">Your meals</h2>
          {meals === undefined ? (
            <p className="text-ink-2">Loading…</p>
          ) : meals.length === 0 ? (
            <Card>
              <p className="text-ink-2">No meals yet. Start a new one, ask Brain to turn a recipe into one, or save a copy of an example below.</p>
            </Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {meals.map((m) => (
                <li key={m.id}>
                  <MealCard to={href({ name: "meal", id: m.id })} name={m.name} items={m.items} db={db} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {mine.length > 0 && (
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="font-serif text-2xl font-normal">Examples for your results</h2>
              <p className="text-ink-2">Meals with foods that research links to your out-of-range results. Examples, not what you should eat.</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {mine.map((m) => (
                <li key={m.id}>
                  <MealCard
                    to={href({ name: "example-meal", id: m.id })}
                    name={m.name}
                    items={m.items}
                    db={db}
                    tag={`For your ${forYou(m)
                      .map((x) => nameInSentence(BIOMARKER_MAP.get(x.biomarkerId)!))
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join(" and ")}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-serif text-2xl font-normal">{mine.length ? "More example meals" : "Example meals"}</h2>
            <p className="text-ink-2">Each one shows foods from an evidence lever on a marker page. Open one to see its numbers, or save a copy to change it.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {rest.map((m) => (
              <li key={m.id}>
                <MealCard to={href({ name: "example-meal", id: m.id })} name={m.name} items={m.items} db={db} />
              </li>
            ))}
          </ul>
          {blocked.length > 0 && (
            <p className="text-sm text-ink-2">
              Not shown because of your habits or profile: {blocked.map((b) => `${b.m.name} (${b.why})`).join("; ")}.
            </p>
          )}
        </section>

        <FoldGroup>
          <Fold title="What food tables can't tell you" summary="They measure about 30 nutrients; food holds more than 26,000 chemicals. What this means for the numbers here.">
            <DarkMatterExplainer db={db} />
          </Fold>
          <Fold title="Animal foods, fruit and plants: what research says" summary={`${COMPARISON_CLAIMS} common claims about absorption, vitamins, the food matrix and safety, each with a verdict and sources.`}>
            <FoodComparison />
          </Fold>
        </FoldGroup>
      </div>
    </>
  );
}

function MealCard({ to, name, items, db, tag }: { to: string; name: string; items: Meal["items"]; db: FoodDb | undefined; tag?: string }) {
  const t = db ? mealTotals(items, db) : undefined;
  const g = (k: string) => (t?.[k] && t[k]!.measuredIn > 0 ? formatValue(Math.round(t[k]!.amount * 10) / 10) : "–");
  return (
    <a
      href={to}
      className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-ink no-underline transition-[border-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-sm"
    >
      {tag && <span className="self-start rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-medium text-accent">{tag}</span>}
      <h3 className="font-serif text-xl font-normal">{name}</h3>
      <p className="mt-auto text-sm text-ink-2 tabular-nums">
        {items.length} {items.length === 1 ? "food" : "foods"} · {formatValue(mealWeight(items))} g
        {t && items.length > 0 && ` · ${g("energyKcal")} kcal · ${g("protein")} g protein · ${g("fibre")} g fibre`}
      </p>
    </a>
  );
}
