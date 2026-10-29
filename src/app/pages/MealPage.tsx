import { useState } from "react";
import { todayIso } from "../../core/dates";
import { MACROS, NUTRIENT_OF_KEY, adultReference, foodById, mealNote, mealTotals, mealWeight, saltFromSodium, searchFoods, shareOfReference, type FoodDb, type Meal, type MealItem, type Total } from "../../core/meals";
import { ageAt } from "../../core/phenoageDraws";
import { formatValue } from "../../core/units";
import { deleteMeal, newId, saveMeal } from "../../db/db";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DarkMatterNote } from "../components/DarkMatter";
import { Fold, FoldGroup } from "../components/disclosure";
import { GradeBadge } from "../components/evidence";
import { AddToProtocol } from "../components/AddToProtocol";
import { Button, Card, LinkButton, cx, inputStyles, labelStyles } from "../components/ui";
import { EXAMPLE_MEALS, useFoodDb } from "../foodDb";
import { useMeals, useProfile } from "../hooks";
import { BIOMARKER_MAP, EVIDENCE, NUTRIENT_MAP, nameInSentence } from "../knowledge";
import { href } from "../router";
import { NotFound } from "./NotFound";

const fmt = (v: number) => formatValue(v < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);
const MACRO_LABEL: Record<(typeof MACROS)[number], string> = {
  energyKcal: "Energy",
  protein: "Protein",
  fat: "Fat",
  saturatedFat: "of which saturated",
  carbohydrate: "Carbohydrate",
  sugars: "of which sugars",
  fibre: "Fibre",
  sodium: "Salt",
};

/** One meal: the person's own (editable) or an example (read-only, can be copied). */
export function MealPage({ id, example = false }: { id: string; example?: boolean }) {
  const db = useFoodDb();
  const meals = useMeals();
  const ex = example ? EXAMPLE_MEALS.find((m) => m.id === id) : undefined;
  const meal: Meal | undefined = example ? (ex ? { id: ex.id, name: ex.name, items: ex.items, createdAt: "" } : undefined) : meals?.find((m) => m.id === id);
  if (!example && meals === undefined) return <p className="text-ink-2">Loading…</p>;
  if (!meal) return <NotFound />;

  async function copy() {
    const m: Meal = { id: newId(), name: meal!.name, items: meal!.items.map((i) => ({ ...i })), createdAt: new Date().toISOString() };
    await saveMeal(m);
    location.hash = href({ name: "meal", id: m.id });
  }

  return (
    <>
      <a href={href({ name: "meals" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Meals
      </a>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {example ? (
            <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">{meal.name}</h1>
          ) : (
            <NameField meal={meal} />
          )}
          {ex && <p className="mt-1 max-w-2xl text-ink-2">{ex.description}</p>}
        </div>
        {example && <Button onClick={() => void copy()}>Save a copy to change it</Button>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-5">
          <Foods meal={meal} db={db} editable={!example} />
          {ex && <Evidence claimIds={ex.claimIds} />}
          {!example && <Manage meal={meal} />}
        </div>
        <Totals items={meal.items} db={db} />
      </div>
    </>
  );
}

function NameField({ meal }: { meal: Meal }) {
  const [name, setName] = useState(meal.name);
  return (
    <input
      aria-label="Meal name"
      value={name}
      maxLength={80}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => name.trim() && name.trim() !== meal.name && void saveMeal({ ...meal, name: name.trim() })}
      className="-ml-1 w-full rounded-md border border-transparent bg-transparent px-1 font-serif text-3xl tracking-tight hover:border-line focus:border-line-strong focus:outline-none sm:text-4xl"
    />
  );
}

/** The foods and grams; for the person's meals, a search to add more and grams to change. */
function Foods({ meal, db, editable }: { meal: Meal; db: FoodDb | undefined; editable: boolean }) {
  const [query, setQuery] = useState("");
  const results = db && query.trim().length >= 2 ? searchFoods(db, query, 12) : [];
  const save = (items: MealItem[]) => void saveMeal({ ...meal, items });
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Foods</h2>
      {meal.items.length === 0 && <p className="text-ink-2">No foods yet. Search the food table below and add them with their weight.</p>}
      <ul className="flex flex-col divide-y divide-line">
        {meal.items.map((it, i) => {
          const food = db ? foodById(db, it.foodId) : undefined;
          return (
            <li key={`${it.foodId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">{food?.name ?? it.foodId}</span>
              {editable ? (
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={2000}
                    aria-label={`Grams of ${food?.name ?? "this food"}`}
                    defaultValue={it.grams}
                    onBlur={(e) => {
                      const g = Number(e.target.value);
                      if (g > 0 && g <= 2000 && g !== it.grams) save(meal.items.map((x, j) => (j === i ? { ...x, grams: g } : x)));
                    }}
                    className={cx(inputStyles, "w-24 text-right")}
                  />
                  <span className="text-ink-2">g</span>
                  <Button variant="quiet" className="min-h-10 text-sm" onClick={() => save(meal.items.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </span>
              ) : (
                <span className="text-ink-2 tabular-nums">{it.grams} g</span>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelStyles}>Add a food</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={db ? "e.g. porridge oats, salmon grilled, kiwi" : "Loading the food table…"}
              disabled={!db}
              autoComplete="off"
              className={inputStyles}
            />
          </label>
          {results.length > 0 && (
            <ul className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-line">
              {results.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      save([...meal.items, { foodId: f.id, grams: 100 }]);
                      setQuery("");
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-sunken"
                  >
                    <span>{f.name}</span>
                    <span className="shrink-0 text-sm text-ink-2">Add 100 g</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {db && query.trim().length >= 2 && results.length === 0 && <p className="text-sm text-ink-2">No food in the table matches every word. Try fewer or simpler words.</p>}
          <p className="text-xs text-ink-2">Weights are of the food as eaten (cooked foods are listed cooked in the table). 2,887 foods from CoFID 2021.</p>
        </div>
      )}
    </Card>
  );
}

function coverageNote(t: Total | undefined): string | undefined {
  if (!t || t.of === 0 || t.measuredIn === t.of) return undefined;
  return t.measuredIn === 0 ? "not measured" : `measured in ${t.measuredIn} of ${t.of} foods`;
}

/** What the table measured in the meal: energy and macros, then vitamins and minerals against the day's EU reference intake. */
function Totals({ items, db }: { items: MealItem[]; db: FoodDb | undefined }) {
  const profile = useProfile();
  const age = profile.birthMonth ? ageAt(profile.birthMonth, todayIso()) : undefined;
  if (!db) return <Card><p className="text-ink-2">Loading the food table…</p></Card>;
  if (items.length === 0) return <Card><p className="text-ink-2">The totals appear here once the meal has foods.</p></Card>;
  const t = mealTotals(items, db);
  const unit = (k: string) => db.nutrients[k]?.unit ?? "";
  const micro = db.keys.filter((k) => !(MACROS as readonly string[]).includes(k) && k !== "retinol");
  const refFor = (k: string) => {
    const n = NUTRIENT_MAP.get(NUTRIENT_OF_KEY[k] ?? "");
    return n ? { n, ref: adultReference(n, { sex: profile.sex, age }) } : undefined;
  };
  // The three biggest shares of a day's reference, for the fold's summary line.
  const top = micro
    .flatMap((k) => {
      const link = refFor(k);
      const share = link ? shareOfReference(t[k]!, unit(k), link.ref) : undefined;
      return share !== undefined ? [{ label: db.nutrients[k]?.label ?? k, share }] : [];
    })
    .sort((a, b) => b.share - a.share)
    .slice(0, 3);
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">In this meal</h2>
        <p className="text-sm text-ink-2 tabular-nums">{fmt(mealWeight(items))} g of food</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {MACROS.map((k) => {
          const total = t[k];
          const sub = k === "saturatedFat" || k === "sugars";
          const value = !total || total.measuredIn === 0 ? "–" : k === "sodium" ? fmt(saltFromSodium(total.amount)) : fmt(total.amount);
          return (
            <div key={k} className={cx(sub && "text-ink-2")}>
              <dt className="text-sm text-ink-2">{MACRO_LABEL[k]}</dt>
              <dd className="font-serif text-2xl tabular-nums">
                {value} <span className="font-sans text-sm text-ink-2">{k === "energyKcal" ? "kcal" : "g"}</span>
              </dd>
              {coverageNote(total) && <dd className="text-xs text-ink-2">{coverageNote(total)}</dd>}
            </div>
          );
        })}
      </dl>
      <p className="text-xs text-ink-2">What the meal contains, not a target. Salt is worked out from sodium (sodium × 2.5).</p>

      <FoldGroup>
        <Fold
          title="Vitamins and minerals"
          summary={
            top.length
              ? `Most of a day's reference: ${top.map((x) => `${x.label.replace(/ \(.*\)$/, "").toLowerCase()} ${x.share}%`).join(", ")}`
              : "Shares of the EU reference intake for a day"
          }
        >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="mb-2 text-left text-ink-2">
            Share of the EU reference intake for a whole day
            {profile.sex ? ` (${profile.sex === "m" ? "men" : "women"}${age !== undefined ? `, ${Math.floor(age)}` : ""})` : " (set your sex in Settings for values that depend on it)"}
          </caption>
          <tbody className="divide-y divide-line">
            {micro.map((k) => {
              const total = t[k]!;
              const link = refFor(k);
              const share = link ? shareOfReference(total, unit(k), link.ref) : undefined;
              const label = db.nutrients[k]?.label ?? k;
              return (
                <tr key={k}>
                  <td className="py-1.5 pr-3">
                    {link ? (
                      <a href={href({ name: "nutrient", id: link.n.id })} className="text-ink underline underline-offset-2">
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                    {coverageNote(total) && <span className="block text-xs text-ink-2">{coverageNote(total)}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{total.measuredIn ? `${fmt(total.amount)} ${unit(k)}` : "–"}</td>
                  <td className="w-2/5 py-1.5">
                    {share !== undefined && (
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                          <span className="absolute inset-y-0 left-0 rounded-full bg-chart-line" style={{ width: `${Math.min(share, 100)}%` }} />
                        </span>
                        <span className="w-12 text-right text-ink-2">{share}%</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-2">
        EU (EFSA) reference intakes describe what covers the needs of most healthy adults over a day, from all food. A meal isn't meant to reach
        them, and more isn't better. Food folate is compared with the folate reference as it is.
      </p>
        </Fold>
      </FoldGroup>
      <DarkMatterNote />
    </Card>
  );
}

/** For an example meal: the evidence levers it illustrates. */
function Evidence({ claimIds }: { claimIds: string[] }) {
  const claims = EVIDENCE.filter((c) => claimIds.includes(c.id));
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Why this example</h2>
      <ul className="flex flex-col gap-3">
        {claims.map((c) => (
          <li key={c.id} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{c.lever}</span>
              <GradeBadge grade={c.grade} />
            </span>
            <span className="text-ink-2">{c.summary}</span>
            <span className="text-sm">
              On the marker page for{" "}
              {c.markers.map((m, i) => (
                <span key={m.biomarkerId}>
                  {i > 0 && ", "}
                  <a href={href({ name: "marker", id: m.biomarkerId })} className="text-ink underline underline-offset-2">
                    {nameInSentence(BIOMARKER_MAP.get(m.biomarkerId)!)}
                  </a>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-2">An example of how a meal can contain these foods, not the best meal for you and not a diet plan.</p>
    </Card>
  );
}

/** Start as a habit, add to a protocol, delete. */
function Manage({ meal }: { meal: Meal }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Use it</h2>
      <div className="flex flex-wrap gap-2">
        <LinkButton variant="secondary" href={href({ name: "habits", meal: meal.id })}>
          Start as a habit
        </LinkButton>
        {meal.items.length > 0 && <AddToProtocol label={meal.name} category="diet" extra={{ mealId: meal.id, note: mealNote(meal) }} amountHint="e.g. 1 portion" />}
      </div>
      <p className="text-sm text-ink-2">A habit lets you watch markers and see what changed after you started eating it regularly.</p>
      <div>
        <ConfirmDialog
          trigger="Delete meal"
          triggerVariant="quiet"
          title="Delete this meal?"
          description="This can't be undone. Protocols it was added to keep their item."
          confirmLabel="Delete meal"
          onConfirm={async () => {
            await deleteMeal(meal.id);
            location.hash = href({ name: "meals" });
          }}
        />
      </div>
    </Card>
  );
}
