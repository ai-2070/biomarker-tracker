import { useState } from "react";
import { bmrMifflin } from "@bt/shared/core/body";
import { todayIso } from "@bt/shared/core/dates";
import {
  ACTIVITY_LEVELS,
  energyVsResting,
  foodIdeas,
  EXAMPLE_DAY,
  SUPPLEMENT_NUTRIENTS,
  gapAdvice,
  intakeToPlanItems,
  parseLabelAmount,
  protocolToIntake,
  MAX_INTAKE_ITEMS,
  MAX_SUPPLEMENT_AMOUNT,
  supplementKeyFor,
  validateIntakeItems,
  type NeedsAmount,
  intakeTotals,
  upperLimitRoom,
  macroRows,
  mealsRichIn,
  nutrientRows,
  type GapIdea,
  type IntakeItem,
  type MacroKey,
  type MacroRow,
  type NutrientRow,
  type PortionFood,
} from "@bt/shared/core/intake";
import { foodById, mealTotals, saltFromSodium, type FoodDb, type Meal, type Total } from "@bt/shared/core/meals";
import { MAX_ITEMS, nutrientFor } from "@bt/shared/core/plans";
import { ageAt } from "@bt/shared/core/phenoageDraws";
import { safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import { computeTrend, flagLatest, groupByBiomarker, isCritical, sortByDate } from "@bt/shared/core/trends";
import type { Measurement, Profile, SafetyId } from "@bt/shared/core/types";
import { formatValue } from "@bt/shared/core/units";
import { newId, savePlan } from "../../db/db";
import { DarkMatterNote } from "../components/DarkMatter";
import { StudyLink } from "../components/evidence";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, Card, FlagBadge, Notice, PageTitle, cx, inputStyles, labelStyles } from "../components/ui";
import { displayUnitFor, formatDate, showMeasurement } from "../format";
import { EXAMPLE_MEALS, useFoodDb } from "../foodDb";
import { setIntakeList, useAllMeasurements, useDisplayUnits, useIntakeList, useMeals, usePlans, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, FOODS, NUTRIENTS } from "../knowledge";
import { href } from "../router";
import { FoodResults } from "../components/FoodResults";

/**
 * Daily intake: the meals and foods eaten on a day, added up, and compared with EU (EFSA) reference
 * values and with resting energy use; where a vitamin, mineral, protein, fibre or omega-3 is below its
 * reference, the foods and meals that would add the most, and the nutrient's research page. All the
 * maths is in core/intake.ts. A description, never a target.
 */

const EFSA_ENERGY = { doi: "10.2903/j.efsa.2013.3005", title: "Scientific Opinion on Dietary Reference Values for energy", year: 2013, studyType: "guideline" as const };
const EFSA_SUMMARY = { doi: "10.2903/sp.efsa.2017.e15121", title: "Dietary Reference Values for nutrients: Summary report", year: 2017, studyType: "guideline" as const };

const PORTION_FOODS: PortionFood[] = FOODS.foods.flatMap((f) => (f.portion ? [{ id: f.id, name: f.name, portion: f.portion }] : []));

const MACRO_LABEL: Record<MacroKey, string> = {
  protein: "Protein",
  carbohydrate: "Carbohydrate",
  sugars: "Sugars (total)",
  fibre: "Fibre",
  fat: "Fat",
  saturatedFat: "Saturated fat",
  epaDha: "Omega-3 (EPA + DHA)",
  sodium: "Salt",
};

export function IntakePage() {
  const db = useFoodDb();
  const meals = useMeals() ?? [];
  const list = useIntakeList();
  const [saveError, setSaveError] = useState("");
  const profile = useProfile();
  const all = useAllMeasurements() ?? [];
  const protocols = useProtocols() ?? [];
  const notes = safetyNotes(safetyLabels(protocols, profile));
  const safety: SafetyId[] = notes.map((n) => n.id);
  const items = list ?? [];
  const save = (next: IntakeItem[]) => {
    const errors = validateIntakeItems(next);
    const repairingOversize = next.length > MAX_INTAKE_ITEMS && next.length < items.length && next.every((item) => validateIntakeItems([item]).length === 0);
    if (errors.length && !repairingOversize) { setSaveError(`Cannot save this list: ${errors.join("; ")}. Remove an item before adding another.`); return; }
    setSaveError("");
    void setIntakeList(next).catch(() => setSaveError("Could not save the list. Please try again."));
  };

  return (
    <>
      <PageTitle sub="Put in what someone eats in a day, from your meals or the food table, and see it added up and compared with EU reference values for a whole day. An analysis, not a diary, a target or a diet.">
        Daily intake analyzer
      </PageTitle>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col gap-5">
          <ListEditor items={items} db={db} meals={meals} save={save} />
          {saveError && <Notice tone="warn">{saveError}</Notice>}
          {items.length > MAX_INTAKE_ITEMS && <Notice tone="warn">This saved list has {items.length} items; the limit is {MAX_INTAKE_ITEMS}. Your entries are still here. Remove items until it is within the limit before adding or changing anything.</Notice>}
          {notes.length > 0 && <SafetyNotices notes={notes} />}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {!db ? (
            <p className="text-ink-2">Loading the food table…</p>
          ) : items.length === 0 ? (
            <Card className="flex flex-col items-start gap-3">
              <p className="text-ink-2">Add meals or foods to see the totals, how they compare with the reference values, and what would add the most where something is low.</p>
              <Button
                variant="secondary"
                onClick={() => save(EXAMPLE_DAY.map(([foodId, grams]) => ({ id: newId(), kind: "food" as const, foodId, grams })))}
              >
                Try an example day
              </Button>
            </Card>
          ) : (
            <Analysis items={items} db={db} profile={profile} all={all} safety={safety} />
          )}
        </div>
      </div>
    </>
  );
}

/** The list of meals and foods, with ways to add more. */
function ListEditor({ items, db, meals, save }: { items: IntakeItem[]; db?: FoodDb; meals: Meal[]; save: (items: IntakeItem[]) => void }) {
  const [mode, setMode] = useState<"meal" | "food" | "supplement">(meals.length ? "meal" : "food");
  const [mealId, setMealId] = useState("");
  const [portions, setPortions] = useState("1");
  const [query, setQuery] = useState("");
  const [grams, setGrams] = useState("100");
  const kcalOf = (it: IntakeItem): number | undefined => {
    if (!db || it.kind === "supplement") return undefined;
    if (it.kind === "food") return mealTotals([{ foodId: it.foodId, grams: it.grams }], db).energyKcal?.amount;
    const m = meals.find((x) => x.id === it.mealId);
    return m ? (mealTotals(m.items, db).energyKcal?.amount ?? 0) * it.portions : undefined;
  };
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-2xl font-normal">A day of food and supplements</h2>
        {items.length > 0 && (
          <Button variant="quiet" className="min-h-10 text-sm" onClick={() => save([])}>
            Clear
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-ink-2">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((it) => {
            const supp = it.kind === "supplement" ? SUPPLEMENT_NUTRIENTS.find((n) => n.key === it.nutrient) : undefined;
            const name =
              it.kind === "meal"
                ? (meals.find((m) => m.id === it.mealId)?.name ?? "A deleted meal")
                : it.kind === "supplement"
                  ? it.name || supp?.label || it.nutrient
                  : db
                    ? (foodById(db, it.foodId)?.name ?? it.foodId)
                    : "…";
            const kcal = kcalOf(it);
            return (
              <li key={it.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate">{name}</span>
                  <span className="text-sm text-ink-2 tabular-nums">
                    {it.kind === "meal"
                      ? `${formatValue(it.portions)} ${it.portions === 1 ? "portion" : "portions"}`
                      : it.kind === "supplement"
                        ? `Supplement · ${it.name ? `${supp?.label ?? ""} ` : ""}${formatValue(it.amount)} ${supp?.unit ?? ""}`
                        : `${formatValue(it.grams)} g`}
                    {kcal !== undefined ? ` · ${Math.round(kcal)} kcal` : ""}
                  </span>
                </span>
                <Button variant="quiet" className="min-h-10 shrink-0 text-sm" onClick={() => save(items.filter((x) => x.id !== it.id))}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {db && <LoadProtocol items={items} meals={meals} db={db} save={save} />}

      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <div role="tablist" aria-label="Add" className="flex flex-wrap gap-1 self-start rounded-xl border border-line bg-sunken p-1">
          {(
            [
              ["meal", "Meals"],
              ["food", "Foods"],
              ["supplement", "Supplements"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={mode === v}
              onClick={() => setMode(v)}
              className={cx("min-h-9 rounded-lg px-3 text-sm transition-colors duration-150", mode === v ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "meal" ? (
          meals.length === 0 ? (
            <p className="text-sm text-ink-2">
              No meals yet. <a href={href({ name: "meals" })}>Build one in Meals</a>, or add single foods.
            </p>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const p = Number(portions);
                const id = mealId || meals[0]!.id;
                if (!(p >= 0.25 && p <= 10)) return;
                save([...items, { id: newId(), kind: "meal", mealId: id, portions: p }]);
              }}
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className={labelStyles}>Meal</span>
                <select value={mealId || meals[0]!.id} onChange={(e) => setMealId(e.target.value)} className={inputStyles}>
                  {meals.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-24 flex-col gap-1.5">
                <span className={labelStyles}>Portions</span>
                <input type="number" inputMode="decimal" min={0.25} max={10} step={0.25} value={portions} onChange={(e) => setPortions(e.target.value)} className={inputStyles} />
              </label>
              <Button type="submit">Add</Button>
            </form>
          )
        ) : mode === "supplement" ? (
          <SupplementForm add={(it) => save([...items, it])} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className={labelStyles}>Food</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={db ? "e.g. banana, cheddar, rice boiled" : "Loading the food table…"}
                  disabled={!db}
                  autoComplete="off"
                  className={inputStyles}
                />
              </label>
              <label className="flex w-24 flex-col gap-1.5">
                <span className={labelStyles}>Grams</span>
                <input type="number" inputMode="decimal" min={1} max={2000} value={grams} onChange={(e) => setGrams(e.target.value)} className={inputStyles} />
              </label>
            </div>
            <FoodResults
              db={db}
              query={query}
              limit={10}
              action={`Add ${grams} g`}
              onPick={(f) => {
                const g = Number(grams);
                if (!(g >= 1 && g <= 2000)) return;
                save([...items, { id: newId(), kind: "food", foodId: f.id, grams: g }]);
                setQuery("");
              }}
            />
          </div>
        )}
      </div>
      {items.length > 0 && db && <ToProtocol items={items} meals={meals} db={db} />}
    </Card>
  );
}

/** A supplement with the person's own amount from its label; the app never suggests one. Supplements in their protocols are quick picks. */
function SupplementForm({ add }: { add: (it: IntakeItem) => void }) {
  const plans = usePlans() ?? [];
  const [key, setKey] = useState(SUPPLEMENT_NUTRIENTS[1]!.key);
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const unit = SUPPLEMENT_NUTRIENTS.find((n) => n.key === key)!.unit;
  // Supplements in the person's protocols that the app knows the nutrient of.
  const picks = [
    ...new Map(
      plans
        .flatMap((p) => p.items)
        .filter((i) => i.category === "supplement")
        .flatMap((i) => {
          const n = nutrientFor(i, NUTRIENTS);
          const k = n ? supplementKeyFor(i, n.id) : undefined;
          return k && SUPPLEMENT_NUTRIENTS.some((x) => x.key === k) ? [[i.label.toLowerCase(), { label: i.label, amount: i.amount, key: k }] as const] : [];
        }),
    ).values(),
  ].slice(0, 8);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const a = Number(amount.replace(",", "."));
        if (!(a > 0 && a <= 100_000)) return;
        add({ id: newId(), kind: "supplement", nutrient: key, amount: a, ...(name.trim() ? { name: name.trim().slice(0, 80) } : {}) });
        setAmount("");
        setName("");
      }}
    >
      {picks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-ink-2">From your protocols:</span>
          {picks.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setKey(p.key);
                setName(p.label);
                const u = SUPPLEMENT_NUTRIENTS.find((n) => n.key === p.key)!.unit;
                const a = parseLabelAmount(p.amount, u);
                setAmount(a !== undefined ? String(a) : "");
              }}
              className="min-h-9 rounded-full border border-line px-3 text-sm hover:bg-sunken"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1.5">
        <span className={labelStyles}>Nutrient</span>
        <select value={key} onChange={(e) => setKey(e.target.value)} className={inputStyles}>
          {SUPPLEMENT_NUTRIENTS.map((n) => (
            <option key={n.key} value={n.key}>
              {n.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <label className="flex w-32 flex-col gap-1.5">
          <span className={labelStyles}>Amount ({unit})</span>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="from the label" className={inputStyles} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelStyles}>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Vitamin D3" autoComplete="off" className={inputStyles} />
        </label>
      </div>
      <div>
        <Button type="submit">Add</Button>
      </div>
      <p className="text-sm text-ink-2">
        Your own amount, as on the label (EU labels use mg or µg). {key === "folate" ? "Folic acid counts 1.7 times food folate (EFSA). " : ""}
        The app never suggests what or how much to take.
      </p>
    </form>
  );
}

/**
 * A protocol loaded into the list: its meals, table foods and supplements written in their unit. Supplements
 * without such an amount are listed to fill in from the label, and the amount can be saved back to the
 * protocol. Medicines, lifestyle items and anything the analyzer can't count are named with the reason.
 */
function LoadProtocol({ items, meals, db, save }: { items: IntakeItem[]; meals: Meal[]; db: FoodDb; save: (items: IntakeItem[]) => void }) {
  const plans = usePlans() ?? [];
  const [planId, setPlanId] = useState("");
  const [loaded, setLoaded] = useState<{ name: string; added: number; needsAmount: NeedsAmount[]; skipped: { label: string; reason: string }[] }>();
  const [toProtocol, setToProtocol] = useState(true);
  if (plans.length === 0) return null;
  const plan = plans.find((p) => p.id === (planId || plans[0]!.id))!;
  const load = () => {
    const r = protocolToIntake(plan, meals, db, NUTRIENTS, newId);
    const room = Math.max(0, MAX_INTAKE_ITEMS - items.length);
    save([...items, ...r.items.slice(0, room)]);
    setLoaded({ name: plan.name, added: Math.min(room, r.items.length), needsAmount: r.needsAmount, skipped: r.skipped });
  };
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelStyles}>Load a protocol</span>
          <select value={plan.id} onChange={(e) => (setPlanId(e.target.value), setLoaded(undefined))} className={inputStyles}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" onClick={load}>
          Load
        </Button>
      </div>
      {loaded && (
        <div role="status" className="flex flex-col gap-3 rounded-lg bg-sunken p-3 text-sm">
          <p>
            {loaded.added === 0 ? `Nothing from ${loaded.name} could be counted yet.` : `Added ${loaded.added} ${loaded.added === 1 ? "item" : "items"} from ${loaded.name}.`}
          </p>
          {loaded.needsAmount.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="font-medium">
                {loaded.needsAmount.length === 1 ? "This supplement needs" : "These supplements need"} an amount from the label to be counted
              </p>
              <label className="flex min-h-9 items-center gap-2">
                <input type="checkbox" checked={toProtocol} onChange={(e) => setToProtocol(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                <span>Also save the amounts to {loaded.name}</span>
              </label>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
                {loaded.needsAmount.map((x) => (
                  <NeedsAmountRow
                    key={x.itemId}
                    x={x}
                    toProtocol={toProtocol}
                    add={(it) => {
                      save([...items, it]);
                      setLoaded((l) => l && { ...l, added: l.added + 1, needsAmount: l.needsAmount.filter((y) => y.itemId !== x.itemId) });
                    }}
                  />
                ))}
              </ul>
            </div>
          )}
          {loaded.skipped.length > 0 && (
            <details>
              <summary className="min-h-9 cursor-pointer py-1 text-ink-2">
                {loaded.skipped.length} not counted, and why
              </summary>
              <ul className="mt-1 flex flex-col gap-1 text-ink-2">
                {loaded.skipped.map((s, i) => (
                  <li key={`${s.label}-${i}`}>
                    <span className="text-ink">{s.label}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** One protocol supplement without a usable amount: type it from the label, and optionally save it to the protocol. */
function NeedsAmountRow({ x, toProtocol, add }: { x: NeedsAmount; toProtocol: boolean; add: (it: IntakeItem) => void }) {
  const plans = usePlans() ?? [];
  const [amount, setAmount] = useState("");
  const nutrient = SUPPLEMENT_NUTRIENTS.find((n) => n.key === x.key)?.label ?? x.key;
  // "Vitamin D3" needs no "(Vitamin D)"; "Fish oil" does: "(Omega-3 (EPA + DHA))".
  const sameName = x.label.toLowerCase().startsWith(nutrient.split(" (")[0]!.toLowerCase());
  const value = Number(amount.replace(",", "."));
  const ok = value > 0 && value <= MAX_SUPPLEMENT_AMOUNT;
  return (
    <li className="p-2.5">
      <form
        className="flex items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          add({ id: newId(), kind: "supplement", nutrient: x.key, amount: value, name: x.label.slice(0, 80) });
          const plan = plans.find((p) => p.id === x.planId);
          // The person's own amount, written back as they typed it with the label's unit.
          if (toProtocol && plan)
            void savePlan({ ...plan, items: plan.items.map((i) => (i.id === x.itemId ? { ...i, amount: `${formatValue(value)} ${x.unit}` } : i)) });
        }}
      >
        <p className="min-w-0 flex-1">
          <span className="font-medium">{x.label}</span>
          {!sameName && <span className="text-ink-2"> ({nutrient})</span>}
          {x.written && <span className="block text-ink-2">Written as “{x.written}”</span>}
        </p>
        <span className="flex shrink-0 items-center gap-2">
          <span className="w-20">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={x.unit}
              aria-label={`${x.label}: amount in ${x.unit}, from the label`}
              className={inputStyles}
            />
          </span>
          <Button type="submit" variant="secondary" disabled={!ok}>
            Add
          </Button>
        </span>
      </form>
    </li>
  );
}

/** The list as a new protocol, or added to one of the person's protocols. */
function ToProtocol({ items, meals, db }: { items: IntakeItem[]; meals: Meal[]; db: FoodDb }) {
  const plans = usePlans() ?? [];
  const [planId, setPlanId] = useState("");
  const [done, setDone] = useState<{ id: string; name: string; skipped: number }>();
  const target = plans.find((p) => p.id === (planId || plans[0]?.id));
  const make = () => intakeToPlanItems(items, meals, db, newId);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className={labelStyles}>Protocols</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            const created = { id: newId(), name: "From the intake analyzer", items: make().slice(0, MAX_ITEMS), createdAt: new Date().toISOString() };
            void savePlan(created).then(() => setDone({ id: created.id, name: created.name, skipped: 0 }));
          }}
        >
          Create a protocol from this
        </Button>
      </div>
      {plans.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm text-ink-2">Or add it to</span>
            <select value={target?.id ?? ""} onChange={(e) => setPlanId(e.target.value)} className={inputStyles}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            disabled={!target}
            onClick={() => {
              if (!target) return;
              const room = Math.max(0, MAX_ITEMS - target.items.length);
              const add = make();
              void savePlan({ ...target, items: [...target.items, ...add.slice(0, room)] }).then(() => setDone({ id: target.id, name: target.name, skipped: Math.max(0, add.length - room) }));
            }}
          >
            Add to protocol
          </Button>
        </div>
      )}
      {done && (
        <p role="status" className="text-sm">
          Saved to <a href={href({ name: "plan", id: done.id })}>{done.name}</a>.
          {done.skipped > 0 && ` ${done.skipped} left out: a protocol holds at most ${MAX_ITEMS} items.`}
        </p>
      )}
    </div>
  );
}

/** Totals, energy against resting use, macros, vitamins and minerals, and what would close the gaps. */
function Analysis({ items, db, profile, all, safety }: { items: IntakeItem[]; db: FoodDb; profile: Profile; all: Measurement[]; safety: SafetyId[] }) {
  const meals = useMeals() ?? [];
  const { totals, supplements, missingMeals } = intakeTotals(items, meals, db);
  const age = profile.birthMonth ? ageAt(profile.birthMonth, todayIso()) : undefined;
  const weight = sortByDate(all.filter((m) => m.biomarkerId === "weight")).at(-1);
  const adult = age === undefined || age >= 18;
  const macros = macroRows(totals, weight?.value, age);
  const vitamins = nutrientRows(totals, db, NUTRIENTS, { ...(profile.sex ? { sex: profile.sex } : {}), ...(age !== undefined ? { age } : {}) }, supplements);
  const kcal = totals.energyKcal;
  const resting = adult && weight ? bmrMifflin(weight.value, profile.heightCm, age, profile.sex) : undefined;
  const critical = [...groupByBiomarker(all)].some(([id, readings]) => {
    const def = BIOMARKER_MAP.get(id);
    return def ? isCritical(flagLatest(def, readings, profile)) : false;
  });
  return (
    <>
      {missingMeals > 0 && <Notice tone="warn">{missingMeals} {missingMeals === 1 ? "meal in the list was" : "meals in the list were"} deleted since, so the totals leave them out.</Notice>}
      {!adult && <Notice>These reference values are for adults. Measured totals are shown without adult intake comparisons or food-increase ideas.</Notice>}
      {critical && <Notice role="alert" tone="danger" title="Contact a doctor now">A latest result is critically out of range. Contact a doctor urgently before changing food or supplements. Food-increase ideas are not shown.</Notice>}
      <EnergyCard kcal={kcal} resting={resting} />
      <MacroCard rows={macros} totals={totals} weightKnown={!!weight} />
      <NutrientCard rows={vitamins} />
      {adult && !critical && <Gaps vitamins={vitamins} macros={macros} db={db} safety={safety} all={all} profile={profile} />}
      <Card className="flex flex-col gap-2">
        <DarkMatterNote />
        <p className="text-sm text-ink-2">
          Reference intakes describe groups of healthy adults and are meant as averages over time: one day below one says little, and more
          isn't better. Values: <StudyLink s={EFSA_SUMMARY} />. Not medical advice.
        </p>
      </Card>
    </>
  );
}

function EnergyCard({ kcal, resting }: { kcal?: Total; resting?: number }) {
  const e = kcal && resting ? energyVsResting(kcal.amount, resting) : undefined;
  const r = (x: number) => Math.round(x).toLocaleString("en-GB");
  const message = !e
    ? undefined
    : e.band === "below-resting"
      ? `Less than your body uses at rest (about ${r(resting!)} kcal); most adults use 1.4 to 2.0 times that in a day. If something is missing from the list, add it to see the whole day.`
      : e.band === "below-low-active"
        ? `Between your resting rate and what a mostly sitting day uses (about ${r(resting! * ACTIVITY_LEVELS.lowActive)} kcal, 1.4 × resting).`
        : e.band === "within"
          ? `Within what most adults use in a day: about ${r(resting! * ACTIVITY_LEVELS.lowActive)} kcal for a mostly sitting day to ${r(resting! * ACTIVITY_LEVELS.veryActive)} kcal for a very active one.`
          : `More than most adults use in a day unless very active (2.0 × resting is about ${r(resting! * ACTIVITY_LEVELS.veryActive)} kcal).`;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Energy</h2>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-serif text-5xl leading-none tabular-nums">{kcal ? r(kcal.amount) : "–"}</span>
        <span className="text-ink-2">kcal</span>
        {e && (
          <span className={cx("rounded-full px-2.5 py-0.5 text-sm font-medium", e.band === "within" ? "bg-ok-soft text-ok" : "bg-sunken text-ink")}>
            {formatValue(Math.round(e.ratio * 10) / 10)} × your resting rate
          </span>
        )}
      </p>
      {message && <p className="max-w-3xl">{message}</p>}
      {!resting && <p className="text-sm text-ink-2">Add your weight, height, month of birth and sex to compare with your resting energy use.</p>}
      <p className="max-w-3xl text-sm text-ink-2">
        Compared with your resting metabolic rate (Mifflin–St Jeor) and EFSA's activity levels, 1.4 × resting for low active up to 2.0 × for
        very active (<StudyLink s={EFSA_ENERGY} />). Lists often miss drinks, oils and snacks, and one day says little. Not a target: the app
        never sets a calorie goal.
      </p>
    </Card>
  );
}

const STATUS_CHIP: Record<string, { text: string; className: string }> = {
  below: { text: "Below", className: "bg-warn-soft text-warn" },
  within: { text: "Within", className: "bg-ok-soft text-ok" },
  met: { text: "Reached", className: "bg-ok-soft text-ok" },
  above: { text: "Above", className: "bg-warn-soft text-warn" },
  "above-upper-limit": { text: "Above the upper limit", className: "bg-danger-soft text-danger" },
  "as-low-as-possible": { text: "Keep low", className: "bg-sunken text-ink-2" },
  "needs-weight": { text: "Add your weight", className: "bg-sunken text-ink-2" },
  "not-measured": { text: "Not measured", className: "bg-sunken text-ink-2" },
  "no-reference": { text: "No reference", className: "bg-sunken text-ink-2" },
  partial: { text: "Partly measured", className: "bg-sunken text-ink-2" },
};

function Chip({ status }: { status: string }) {
  const c = STATUS_CHIP[status] ?? STATUS_CHIP["no-reference"]!;
  return <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", c.className)}>{c.text}</span>;
}

function MacroCard({ rows, totals, weightKnown }: { rows: MacroRow[]; totals: Record<string, Total>; weightKnown: boolean }) {
  const show = (r: MacroRow) =>
    r.key === "sodium"
      ? `${formatValue(Math.round(saltFromSodium(r.amount) * 10) / 10)} g`
      : r.key === "epaDha"
        ? `${formatValue(Math.round(r.amount * 1000))} mg`
        : `${formatValue(Math.round(r.amount * 10) / 10)} g`;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Protein, carbohydrate, fat and fibre</h2>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-0.5 py-2">
            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium">{MACRO_LABEL[r.key]}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{show(r)}</span>
                {r.energyPct !== undefined && <span className="w-24 text-right text-sm text-ink-2 tabular-nums">{Math.round(r.energyPct)} % of energy</span>}
                <Chip status={r.status} />
              </span>
            </span>
            <span className="text-sm text-ink-2">EFSA: {r.reference}</span>
            {r.measuredIn < r.of && <span className="text-xs text-ink-2">Measured in {r.measuredIn} of {r.of} sources; the rest is unknown.</span>}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-2">
        Salt is worked out from sodium (× 2.5). "Sugars" is all sugars the food table measured; EFSA's "as low as possible" is for added and
        free sugars, which the table doesn't separate.{!weightKnown && " Protein is compared once you have a weight."}
        {totals.energyKcal && totals.energyKcal.measuredIn < totals.energyKcal.of ? ` Energy was measured in ${totals.energyKcal.measuredIn} of ${totals.energyKcal.of} foods.` : ""}
      </p>
    </Card>
  );
}

function NutrientCard({ rows }: { rows: NutrientRow[] }) {
  const units = (r: NutrientRow) => `${formatValue(r.amount < 10 ? Math.round(r.amount * 10) / 10 : Math.round(r.amount))} ${r.unit}`;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Vitamins and minerals</h2>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_7rem_auto]">
            <a href={href({ name: "nutrient", id: r.nutrient.id })} className="font-medium text-ink no-underline hover:underline">
              {r.nutrient.name}
            </a>
            <span className="col-span-2 row-start-2 flex items-center gap-2 sm:col-span-1 sm:row-start-auto">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                <span
                  className={cx("block h-full rounded-full", r.status === "above-upper-limit" ? "bg-danger" : r.status === "below" ? "bg-warn" : r.status === "partial" ? "bg-ink-2" : "bg-ok")}
                  style={{ width: `${Math.min(100, r.share ?? 0)}%` }}
                />
              </span>
              <span className="w-12 text-right text-sm tabular-nums">{r.share !== undefined ? `${r.measuredIn < r.of ? "≥ " : ""}${r.share} %` : ""}</span>
            </span>
            <span className="col-span-2 text-sm text-ink-2 tabular-nums sm:col-span-1 sm:text-right">
              {r.measuredIn === 0 ? "Unknown" : <>{r.measuredIn < r.of ? "At least " : ""}{units(r)}{r.reference ? ` of ${formatValue(r.reference.amount)}` : ""}</>}
              {r.measuredIn < r.of && <span className="block text-xs">Measured in {r.measuredIn} of {r.of} sources; the rest is unknown.</span>}
            </span>
            <span className="row-start-1 justify-self-end sm:row-start-auto">
              <Chip status={r.status} />
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-2">
        Share of the adult EU reference intake for a whole day where the reference applies to your known sex and age. Unmeasured values never count as zero:
        partial totals show their coverage here and are not treated as a precise shortfall.{" "}
        {rows.some((r) => r.status === "above-upper-limit") &&
          "Above the upper limit means more than the highest daily intake considered safe over a long time. Magnesium's and folic acid's limits count supplements only; the others count food and supplements together. Worth discussing with a doctor or pharmacist if it's usual."}
      </p>
    </Card>
  );
}

/** For each nutrient below its reference: foods and meals that would add the most, and the nutrient's research page. */
function Gaps({ vitamins, macros, db, safety, all, profile }: { vitamins: NutrientRow[]; macros: MacroRow[]; db: FoodDb; safety: SafetyId[]; all: Measurement[]; profile: Profile }) {
  const meals = useMeals() ?? [];
  const units = useDisplayUnits();
  const byMarker = groupByBiomarker(all);
  const [all4, setAll] = useState(false);
  const room = upperLimitRoom(vitamins);
  const lowAll = vitamins.filter((r) => r.status === "below").sort((a, b) => (a.share ?? 0) - (b.share ?? 0));
  // The four furthest below in full; the rest one tap away.
  const low = all4 ? lowAll : lowAll.slice(0, 4);
  const more = lowAll.slice(4);
  const macroLow = macros.filter((r) => r.status === "below" && (r.key === "protein" || r.key === "fibre" || r.key === "epaDha"));
  if (low.length === 0 && macroLow.length === 0) {
    return (
      <Card>
        <h2 className="font-serif text-2xl font-normal">Below the reference</h2>
        <p className="mt-1 text-ink-2">Nothing the app can compare is below its reference intake.</p>
      </Card>
    );
  }
  const mealList = [...meals.map((m) => ({ id: m.id, name: m.name, items: m.items, example: false })), ...EXAMPLE_MEALS.map((m) => ({ id: m.id, name: m.name, items: m.items, example: true }))];
  const ideaLine = (f: GapIdea, unit: string, pct: boolean) => (
    <li key={f.name} className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span>
        {f.name} <span className="text-ink-2">· {f.label}, {f.grams} g</span>
      </span>
      <span className="text-sm text-ink-2 tabular-nums">
        +{formatValue(f.adds < 10 ? Math.round(f.adds * 10) / 10 : Math.round(f.adds))} {unit}
        {pct && f.shareAfter !== undefined ? ` → ${f.shareAfter} %` : ""}
      </span>
    </li>
  );
  return (
    <Card className="flex flex-col gap-4">
      <div className="max-w-3xl">
        <h2 className="font-serif text-2xl font-normal">Below the reference: what would add the most</h2>
        <p className="mt-1 text-ink-2">
          Foods with the most per example portion, and meals that contain the most, with what the day's share would be after one portion. Ideas
          to look at, not a plan; foods that don't suit your medicines or conditions are left out.
        </p>
      </div>
      <ul className="flex flex-col gap-4">
        {macroLow.map((r) => {
          const ref = r.key === "fibre" ? 25 : r.key === "epaDha" ? 0.25 : undefined;
          const ideas = foodIdeas(r.key, r.amount, ref, PORTION_FOODS, db, safety, room);
          // Omega-3 is in grams in the food table; it reads better in milligrams.
          const missing = r.key === "epaDha" ? `${Math.round((r.missing ?? 0) * 1000)} mg` : `${formatValue(Math.round((r.missing ?? 0) * 10) / 10)} g`;
          const unit = "g";
          return (
            <li key={r.key} className="rounded-lg border border-line p-3">
              <p className="font-medium">
                {MACRO_LABEL[r.key]}: {missing} below the reference
              </p>
              <ul className="mt-2 flex flex-col gap-1">{ideas.foods.map((f) => ideaLine(f, unit, ref !== undefined))}</ul>
            </li>
          );
        })}
        {low.map((r) => {
          const linked = r.nutrient.status.biomarkerIds.flatMap((id) => {
            const d = BIOMARKER_MAP.get(id);
            const readings = byMarker.get(id);
            return d && readings?.length ? [{ marker: d, ms: readings, flag: flagLatest(d, readings, profile) }] : [];
          });
          const result = linked.find((x) => x.flag === "critical-high" || x.flag === "critical-low") ?? linked[0];
          const { marker, ms, flag } = result ?? {};
          const critical = flag === "critical-high" || flag === "critical-low";
          const latest = ms ? computeTrend(ms)?.latest : undefined;
          const advice = critical ? undefined : gapAdvice(r.key, r, PORTION_FOODS, db, safety, room);
          const rich = critical || advice?.kind !== "foods" ? [] : mealsRichIn(r.key, mealList, db, safety, 2, room);
          return (
            <li key={r.key} className="rounded-lg border border-line p-3">
              <p className="font-medium">
                {r.nutrient.name}: {r.share} % of the reference
              </p>
              {critical ? <Notice tone="danger" className="mt-2" title="Contact a doctor now">Your linked blood result is critically out of range. Contact a doctor urgently before changing food or supplements. Food-increase ideas are not shown.</Notice> : advice?.kind === "talk-to-doctor" ? (
                <Notice tone="warn" className="mt-2" title="Talk to your doctor or pharmacist first">
                  {advice.because.map((b) => `${b.with}: ${b.note}`).join(" ")}
                </Notice>
              ) : (
                <>
                  {advice?.kind === "foods" && advice.foods.length > 0 && <ul className="mt-2 flex flex-col gap-1">{advice.foods.map((f) => ideaLine(f, r.unit, true))}</ul>}
                  {advice?.kind === "foods" && advice.hidden.length > 0 && (
                    <p className="mt-1 text-sm text-ink-2">Left out for you: {advice.hidden.map((h) => `${h.name} (${h.reason})`).join("; ")}.</p>
                  )}
                  {rich.length > 0 && (
                    <p className="mt-2 text-sm">
                      <span className="text-ink-2">Meals with the most: </span>
                      {rich.map((x, i) => (
                        <span key={x.meal.id}>
                          {i > 0 && ", "}
                          <a href={href(x.meal.example ? { name: "example-meal", id: x.meal.id } : { name: "meal", id: x.meal.id })}>{x.meal.name}</a>
                          <span className="text-ink-2">
                            {" "}
                            ({formatValue(x.amount < 10 ? Math.round(x.amount * 10) / 10 : Math.round(x.amount))} {r.unit}
                            {x.meal.example ? ", example" : ""})
                          </span>
                        </span>
                      ))}
                    </p>
                  )}
                </>
              )}
              <p className="mt-2 text-sm text-ink-2">
                {latest && marker ? (
                  <>
                    Your {marker.name.toLowerCase()} blood result: {showMeasurement(marker, latest, displayUnitFor(marker, units[marker.id]))}{" "}
                    {displayUnitFor(marker, units[marker.id])} ({formatDate(latest.date)}) {flag && flag !== "unknown" && <FlagBadge flag={flag} />}.{" "}
                  </>
                ) : null}
                {!critical && <><span>Supplements help most when you&apos;re low. </span>
                <a href={href({ name: "nutrient", id: r.nutrient.id })}>Supplements: what trials found, forms and the upper limit</a></>}
              </p>
            </li>
          );
        })}
      </ul>
      {more.length > 0 && !all4 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-ink-2">Also below: {more.map((r) => `${r.nutrient.name} ${r.share} %`).join(", ")}.</p>
          <Button variant="secondary" onClick={() => setAll(true)}>
            Show ideas for these too
          </Button>
        </div>
      )}
      <p className="text-sm text-ink-2">
        The app never suggests a supplement amount. Talk to a doctor or pharmacist before taking supplements, especially with medicines.
      </p>
    </Card>
  );
}
