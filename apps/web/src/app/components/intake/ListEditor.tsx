import { type IntakeItem, parseLabelAmount, SUPPLEMENT_NUTRIENTS, supplementKeyFor } from "@bt/shared/core/intake";
import { type FoodDb, foodById, type Meal, mealTotals } from "@bt/shared/core/meals";
import { nutrientFor } from "@bt/shared/core/plans";
import { formatValue } from "@bt/shared/core/units";
import { useState } from "react";
import { newId } from "../../../db/db";
import { usePlans } from "../../hooks";
import { NUTRIENTS } from "../../knowledge";
import { href } from "../../router";
import { FoodResults } from "../FoodResults";
import { SegmentTabs } from "../SegmentTabs";
import { SimpleSelect } from "../UnitSelect";
import { Button, Card, inputStyles, labelStyles } from "../ui";
import { LoadProtocol, ToProtocol } from "./LoadProtocol";

/** The list of meals and foods, with ways to add more. */
export function ListEditor({ items, db, meals, save }: { items: IntakeItem[]; db?: FoodDb; meals: Meal[]; save: (items: IntakeItem[]) => void }) {
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
        <SegmentTabs
          label="Add"
          tabs={[
            { value: "meal", label: "Meals" },
            { value: "food", label: "Foods" },
            { value: "supplement", label: "Supplements" },
          ]}
          value={mode}
          onChange={setMode}
          className="flex flex-col gap-3"
        >
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
                <SimpleSelect
                  label="Meal"
                  options={meals.map((m) => ({ value: m.id, label: m.name }))}
                  value={mealId || meals[0]!.id}
                  onChange={setMealId}
                  className="min-w-0 flex-1"
                />
                <label className="flex w-24 flex-col gap-1.5">
                  <span className={labelStyles}>Portions</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.25}
                    max={10}
                    step={0.25}
                    value={portions}
                    onChange={(e) => setPortions(e.target.value)}
                    className={inputStyles}
                  />
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
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={2000}
                    value={grams}
                    onChange={(e) => setGrams(e.target.value)}
                    className={inputStyles}
                  />
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
        </SegmentTabs>
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
      <SimpleSelect label="Nutrient" options={SUPPLEMENT_NUTRIENTS.map((n) => ({ value: n.key, label: n.label }))} value={key} onChange={setKey} />
      <div className="flex items-end gap-2">
        <label className="flex w-32 flex-col gap-1.5">
          <span className={labelStyles}>Amount ({unit})</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="from the label"
            className={inputStyles}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelStyles}>Name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Vitamin D3"
            autoComplete="off"
            className={inputStyles}
          />
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
