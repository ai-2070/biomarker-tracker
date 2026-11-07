import {
  type IntakeItem,
  intakeToPlanItems,
  MAX_INTAKE_ITEMS,
  MAX_SUPPLEMENT_AMOUNT,
  type NeedsAmount,
  protocolToIntake,
  SUPPLEMENT_NUTRIENTS,
} from "@bt/shared/core/intake";
import type { FoodDb, Meal } from "@bt/shared/core/meals";
import { MAX_ITEMS } from "@bt/shared/core/plans";
import { formatValue } from "@bt/shared/core/units";
import { useState } from "react";
import { newId, savePlan } from "../../../db/db";
import { usePlans } from "../../hooks";
import { NUTRIENTS } from "../../knowledge";
import { href } from "../../router";
import { More } from "../disclosure";
import { SimpleSelect } from "../UnitSelect";
import { Button, inputStyles, labelStyles } from "../ui";

/**
 * A protocol loaded into the list: its meals, table foods and supplements written in their unit. Supplements
 * without such an amount are listed to fill in from the label, and the amount can be saved back to the
 * protocol. Medicines, lifestyle items and anything the analyzer can't count are named with the reason.
 */
export function LoadProtocol({ items, meals, db, save }: { items: IntakeItem[]; meals: Meal[]; db: FoodDb; save: (items: IntakeItem[]) => void }) {
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
        <SimpleSelect
          label="Load a protocol"
          options={plans.map((p) => ({ value: p.id, label: p.name }))}
          value={plan.id}
          onChange={(id) => {
            setPlanId(id);
            setLoaded(undefined);
          }}
          className="min-w-0 flex-1"
        />
        <Button variant="secondary" onClick={load}>
          Load
        </Button>
      </div>
      {loaded && (
        <div role="status" className="flex flex-col gap-3 rounded-lg bg-sunken p-3 text-sm">
          <p>
            {loaded.added === 0
              ? `Nothing from ${loaded.name} could be counted yet.`
              : `Added ${loaded.added} ${loaded.added === 1 ? "item" : "items"} from ${loaded.name}.`}
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
            <More summary={<>{loaded.skipped.length} not counted, and why</>}>
              <ul className="mt-1 flex flex-col gap-1 text-ink-2">
                {loaded.skipped.map((s, i) => (
                  <li key={`${s.label}-${i}`}>
                    <span className="text-ink">{s.label}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            </More>
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
export function ToProtocol({ items, meals, db }: { items: IntakeItem[]; meals: Meal[]; db: FoodDb }) {
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
          <SimpleSelect
            label="Or add it to"
            labelClassName="text-sm text-ink-2"
            options={plans.map((p) => ({ value: p.id, label: p.name }))}
            value={target?.id ?? null}
            onChange={setPlanId}
            className="min-w-0 flex-1"
          />
          <Button
            variant="secondary"
            disabled={!target}
            onClick={() => {
              if (!target) return;
              const room = Math.max(0, MAX_ITEMS - target.items.length);
              const add = make();
              void savePlan({ ...target, items: [...target.items, ...add.slice(0, room)] }).then(() =>
                setDone({ id: target.id, name: target.name, skipped: Math.max(0, add.length - room) }),
              );
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
