import { Field } from "@base-ui/react/field";
import { addDays, todayIso } from "@bt/shared/core/dates";
import { dailyReference, mealNote } from "@bt/shared/core/meals";
import { interactionsFor } from "@bt/shared/core/nutrients";
import { ageAt } from "@bt/shared/core/phenoageDraws";
import { itemsByTime, MAX_ITEMS, nutrientFor, type Plan, type PlanItem, type PlanTime, pairWarnings, planToFile } from "@bt/shared/core/plans";
import { type ProtocolCategory, safetyLabels, safetyNotes, validateProtocol } from "@bt/shared/core/protocols";
import type { SafetyId } from "@bt/shared/core/types";
import { formatValue } from "@bt/shared/core/units";
import { wholeFoodFor } from "@bt/shared/core/wholeFoods";
import { type FormEvent, useState } from "react";
import { deletePlan, newId, savePlan, startPlan, stopPlan, updatePlan } from "../../db/db";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlusIcon } from "../components/icons";
import { TIME_LABEL, WhenFields, type WhenValue, whenExtras, whenFields, whenOf } from "../components/PlanWhen";
import { SafetyNotices } from "../components/SafetyNotices";
import { SimpleSelect } from "../components/UnitSelect";
import { Button, Card, cx, errorStyles, eyebrowStyles, helpStyles, inputStyles, labelStyles, Notice } from "../components/ui";
import { CATEGORY_LABEL, formatDate } from "../format";
import { useMeals, usePlans, useProfile, useProtocols } from "../hooks";
import { NUTRIENTS, WHOLE_FOODS } from "../knowledge";
import { href } from "../router";
import { NotFound } from "./NotFound";

/** One protocol: its items as a day's schedule, warnings, and start / stop / share. */
export function PlanPage({ id }: { id: string }) {
  const plans = usePlans();
  const profile = useProfile();
  const habits = useProtocols() ?? [];
  const [editing, setEditing] = useState<string | "new" | "details" | null>(null);
  const [saveError, setSaveError] = useState("");
  if (plans === undefined) return <p className="text-ink-2">Loading…</p>;
  const plan = plans.find((p) => p.id === id);
  if (!plan) return <NotFound />;

  // Safety: the protocol's own items, plus the person's habits and profile (medicines, conditions).
  const notes = safetyNotes([...safetyLabels(habits, profile), ...plan.items.map((i) => i.label)]);
  const safety: SafetyId[] = notes.map((n) => n.id);
  const linked = plan.items.flatMap((i) => {
    const n = nutrientFor(i, NUTRIENTS);
    return n ? [{ item: i, n }] : [];
  });
  const withYou = [...new Map(linked.flatMap(({ n }) => interactionsFor(n, safety).map((x) => [`${n.id}|${x.with}`, { n, x }] as const))).values()];
  const pairs = pairWarnings(plan, NUTRIENTS);
  const update = async (change: (current: Plan) => Plan) => {
    try {
      await updatePlan(plan.id, change);
      setSaveError("");
      setEditing(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the protocol. Please try again.");
    }
  };

  return (
    <>
      <a href={href({ name: "plans" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Protocols
      </a>

      {editing === "details" ? (
        <DetailsForm plan={plan} onDone={() => setEditing(null)} />
      ) : (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">{plan.name}</h1>
            {plan.description && <p className="mt-1 max-w-2xl text-ink-2">{plan.description}</p>}
            {plan.source && <p className="mt-1 text-sm text-ink-2">Source: {plan.source}</p>}
          </div>
          <Button variant="secondary" onClick={() => setEditing("details")}>
            Edit details
          </Button>
        </div>
      )}
      {saveError && (
        <Notice tone="warn" className="mb-4">
          {saveError}
        </Notice>
      )}

      {/* Wide screens: the day on the left; start, checks and sharing beside it. Phones: one column in this order. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:gap-x-8">
        <div className="flex flex-col gap-5 lg:col-start-2 lg:row-start-1">
          <StartStop plan={plan} />

          {(notes.length > 0 || withYou.length > 0 || pairs.length > 0) && (
            <Card className="flex flex-col gap-3">
              <h2 className="font-serif text-2xl font-normal">Check before you start</h2>
              <SafetyNotices notes={notes} />
              {(pairs.length > 0 || withYou.length > 0) && (
                <ul className="flex flex-col divide-y divide-warn/20 rounded-lg bg-warn-soft px-3">
                  {pairs.map((w) => (
                    <li key={`${w.a}|${w.b}`} className="py-2.5">
                      <span className="font-medium">
                        {w.a} and {w.b}:
                      </span>{" "}
                      {w.note}
                    </li>
                  ))}
                  {withYou.map(({ n, x }) => (
                    <li key={`${n.id}|${x.with}`} className="py-2.5">
                      <span className="font-medium">
                        {n.name} and your {x.with.toLowerCase()}:
                      </span>{" "}
                      {x.note}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <Card className="flex flex-col gap-4 self-start lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-2xl font-normal">The day</h2>
            {editing !== "new" && (
              <Button variant="secondary" disabled={plan.items.length >= MAX_ITEMS} onClick={() => setEditing("new")}>
                <PlusIcon /> Add an item
              </Button>
            )}
          </div>
          {plan.active && (
            <p className="text-sm text-ink-2">Changes here don't change what's already recorded in Habits; stop and start the protocol again to use them.</p>
          )}
          {plan.items.length >= MAX_ITEMS && (
            <p role="status" className="text-sm text-ink-2">
              A protocol can contain at most {MAX_ITEMS} items. Remove an item before adding another.
            </p>
          )}
          {editing === "new" && (
            <ItemForm
              onSave={(item) => {
                void update((current) => ({ ...current, items: [...current.items, item] }));
              }}
              onCancel={() => setEditing(null)}
            />
          )}
          {plan.items.length === 0 && editing !== "new" ? (
            <p className="text-ink-2">No items yet. Add the supplements, foods, exercise and sleep habits that make up this protocol.</p>
          ) : (
            itemsByTime(plan).map((g) => (
              <section key={g.when}>
                <h3 className={cx("mb-2", eyebrowStyles)}>{TIME_LABEL[g.when]}</h3>
                <ul className="flex flex-col divide-y divide-line">
                  {g.items.map((item) =>
                    editing === item.id ? (
                      <li key={item.id} className="p-3">
                        <ItemForm
                          initial={item}
                          onSave={(next) => {
                            void update((current) => ({ ...current, items: current.items.map((i) => (i.id === item.id ? next : i)) }));
                          }}
                          onRemove={() => {
                            void update((current) => ({ ...current, items: current.items.filter((i) => i.id !== item.id) }));
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      </li>
                    ) : (
                      <ItemRow key={item.id} item={item} onEdit={() => setEditing(item.id)} />
                    ),
                  )}
                </ul>
              </section>
            ))
          )}
        </Card>

        <div className="flex flex-col gap-5 lg:col-start-2 lg:row-start-2">
          <Share plan={plan} />

          <p className="text-sm text-ink-2">
            Amounts are your own; the app never suggests what or how much to take. EU intakes and upper limits (EFSA) describe groups of healthy adults from all
            food, not a dose for you. Talk to your doctor or pharmacist before starting supplements, especially with medicines.
          </p>
        </div>
      </div>
    </>
  );
}

const num = (v: number) => formatValue(v);

function ItemRow({ item, onEdit }: { item: PlanItem; onEdit: () => void }) {
  const profile = useProfile();
  const meals = useMeals();
  const meal = item.mealId ? meals?.find((m) => m.id === item.mealId) : undefined;
  const n = meal ? undefined : nutrientFor(item, NUTRIENTS);
  // A whole food (olive oil, blueberries…) links to its research page.
  const food = n || item.category === "medication" ? undefined : wholeFoodFor(item.label, WHOLE_FOODS);
  // The day's EU reference values for this nutrient, next to the person's own amount.
  const ref =
    n && n.researchStatus !== "not-reviewed"
      ? dailyReference(n, { sex: profile.sex, age: profile.birthMonth ? ageAt(profile.birthMonth, todayIso()) : undefined })
      : undefined;
  const intake = ref?.intake
    ? `${num(ref.intake.amount)} ${ref.intake.unit} a day`
    : ref?.bySex
      ? `men ${num(ref.bySex.men.amount)} ${ref.bySex.men.unit}, women ${num(ref.bySex.women.amount)} ${ref.bySex.women.unit} a day`
      : undefined;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <p className="font-medium">
          {item.label}
          {item.amount && <span className="font-normal text-ink-2"> · {item.amount}</span>}
        </p>
        {(item.category !== "supplement" || item.note || whenExtras(item)) && (
          <p className="text-sm text-ink-2">
            {[item.category !== "supplement" && CATEGORY_LABEL[item.category], whenExtras(item), item.note].filter(Boolean).join(" · ")}
          </p>
        )}
        {n && (
          <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-ink-2">
            {intake && (
              <span title={ref?.intake ? `${ref.intake.type === "PRI" ? "Population reference intake" : "Adequate intake"}, from all food` : undefined}>
                EU intake <span className="text-ink tabular-nums">{intake}</span>
                {/* What the value is for, when the entry says (psyllium: dietary fibre from all sources). */}
                {ref?.intake?.group.match(/\(([^)]+)\)/)?.[1] && <> ({ref.intake.group.match(/\(([^)]+)\)/)![1]})</>}
              </span>
            )}
            {ref?.upperLimit && (
              <span title={ref.upperLimit.note}>
                · upper limit{" "}
                <span className="text-ink tabular-nums">
                  {num(ref.upperLimit.amount)} {ref.upperLimit.unit}
                </span>
              </span>
            )}
            <a href={href({ name: "nutrient", id: n.id })} className="text-ink underline underline-offset-2">
              {(intake || ref?.upperLimit) && "· "}
              {n.researchStatus === "not-reviewed" ? "Basic guide · benefits not reviewed" : "What research says"}
            </a>
          </p>
        )}
        {meal && (
          <a href={href({ name: "meal", id: meal.id })} className="mt-1 inline-block text-sm text-ink underline underline-offset-2">
            Open the meal
          </a>
        )}
        {!n && food && (
          <a href={href({ name: "wholefood", id: food.id })} className="mt-1 inline-block text-sm text-ink underline underline-offset-2">
            What research says about {food.name.toLowerCase()}
          </a>
        )}
      </div>
      <Button variant="quiet" className="min-h-10 text-sm" onClick={onEdit} aria-label={`Edit ${item.label}`}>
        Edit
      </Button>
    </li>
  );
}

function ItemForm({
  initial,
  onSave,
  onCancel,
  onRemove,
}: {
  initial?: PlanItem;
  onSave: (item: PlanItem) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [category, setCategory] = useState<ProtocolCategory>(initial?.category ?? "supplement");
  const [timing, setTiming] = useState<WhenValue>(() => whenOf(initial));
  const when = timing.when;
  const setWhen = (w: PlanTime) => setTiming((t) => ({ ...t, when: w }));
  const [note, setNote] = useState(initial?.note ?? "");
  const [mealId, setMealId] = useState(initial?.mealId ?? "");
  const [error, setError] = useState<string>();
  const meals = useMeals() ?? [];

  // Picking one of your meals fills the item in as that meal (a diet item at a meal time).
  function pickMeal(id: string) {
    setMealId(id);
    const meal = meals.find((m) => m.id === id);
    if (!meal) return;
    setLabel(meal.name.slice(0, 80));
    setCategory("diet");
    setNote(mealNote(meal));
    if (when !== "midday" && when !== "evening") setWhen("midday");
    setError(undefined);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return setError('Name the item, e.g. "Vitamin D3" or "Zone 2 cardio".');
    onSave({
      id: initial?.id ?? newId(),
      label: label.trim(),
      ...(amount.trim() ? { amount: amount.trim() } : {}),
      category,
      ...whenFields(timing),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(mealId && meals.some((m) => m.id === mealId) ? { mealId } : {}),
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-lg bg-sunken p-3">
      {meals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SimpleSelect
            label="One of your meals (optional)"
            placeholder="Not a meal"
            options={[{ value: "", label: "Not a meal" }, ...meals.map((m) => ({ value: m.id, label: m.name }))]}
            value={mealId}
            onChange={pickMeal}
            className="sm:max-w-md"
          />
          <span className={helpStyles}>Fills in the item from a meal you built in Meals.</span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field.Root invalid={!!error} className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Item</Field.Label>
          <Field.Control
            value={label}
            onValueChange={setLabel}
            placeholder="e.g. Vitamin D3, Olive oil, Zone 2 cardio"
            maxLength={80}
            autoComplete="off"
            className={inputStyles}
          />
          <Field.Error match={!!error} className={errorStyles}>
            {error}
          </Field.Error>
        </Field.Root>
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Amount (optional)</Field.Label>
          <Field.Control value={amount} onValueChange={setAmount} placeholder="e.g. 45 min" maxLength={40} autoComplete="off" className={inputStyles} />
          <Field.Description className={helpStyles}>Your own amount, as you take or do it.</Field.Description>
        </Field.Root>
      </div>
      <ChoiceGroup<ProtocolCategory>
        label="Type"
        value={category}
        onChange={setCategory}
        options={(Object.keys(CATEGORY_LABEL) as ProtocolCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
      />
      {category === "medication" && <Notice>This is only for your own record. Don't start, stop or change a medicine without talking to your doctor.</Notice>}
      <WhenFields value={timing} onChange={setTiming} />
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Note (optional)</Field.Label>
        <Field.Control
          value={note}
          onValueChange={setNote}
          placeholder="e.g. with breakfast, 3 times a week"
          maxLength={300}
          autoComplete="off"
          className={inputStyles}
        />
      </Field.Root>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{initial ? "Save" : "Add"}</Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {onRemove && (
          <Button variant="quiet" className="ml-auto text-danger" onClick={onRemove}>
            Remove item
          </Button>
        )}
      </div>
    </form>
  );
}

function DetailsForm({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? "");
  const [source, setSource] = useState(plan.source ?? "");
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the protocol a name.");
    try {
      await updatePlan(plan.id, (current) => {
        const { description: _d, source: _s, ...rest } = current;
        return {
          ...rest,
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(source.trim() ? { source: source.trim() } : {}),
        };
      });
      onDone();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the protocol. Please try again.");
    }
  }

  return (
    <Card className="mb-5">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field.Root invalid={!!error} className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Name</Field.Label>
          <Field.Control value={name} onValueChange={setName} maxLength={80} autoComplete="off" className={inputStyles} />
          <Field.Error match={!!error} className={errorStyles}>
            {error}
          </Field.Error>
        </Field.Root>
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Description</Field.Label>
          <Field.Control render={<textarea rows={3} />} value={description} onValueChange={setDescription} maxLength={1000} className={inputStyles} />
        </Field.Root>
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Source (optional)</Field.Label>
          <Field.Control
            value={source}
            onValueChange={setSource}
            placeholder="e.g. a book, a website, my doctor"
            maxLength={300}
            autoComplete="off"
            className={inputStyles}
          />
        </Field.Root>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Save</Button>
          <Button variant="quiet" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Start one named habit with an item snapshot; stop keeps the recorded history. */
function StartStop({ plan }: { plan: Plan }) {
  const today = todayIso();
  const [start, setStart] = useState(today);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const latestStart = addDays(today, 365);
  const startValidation = validateProtocol({ label: plan.name, category: "lifestyle", start }, today);
  const startError = startValidation.ok ? undefined : startValidation.errors.start;
  if (plan.active) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <span className="font-medium">Running since {formatDate(plan.active.since)}.</span>{" "}
          <span className="text-ink-2">
            Watch markers for the whole routine in{" "}
            <a href={href({ name: "habits" })} className="text-ink underline underline-offset-2">
              Habits
            </a>{" "}
            to see what changes, not which item caused it.
          </span>
        </p>
        <ConfirmDialog
          trigger="Stop protocol"
          title="Stop this protocol?"
          description="The linked records end today. They stay in Habits, with their results, so you can still see what changed."
          confirmLabel="Stop protocol"
          onConfirm={() => stopPlan(plan, today)}
        />
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-2">
          Add one habit named after this protocol, with all its items kept as details. Watch markers for the whole routine, not individual items.
        </p>
        {!open && (
          <Button onClick={() => setOpen(true)} disabled={plan.items.length === 0}>
            Start protocol
          </Button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelStyles}>Start date</span>
            <input type="date" value={start} max={latestStart} onChange={(e) => setStart(e.target.value)} className={cx(inputStyles, "w-48")} />
          </label>
          <Button
            disabled={!!startError}
            onClick={() =>
              void startPlan(plan, start)
                .then(() => {
                  setError("");
                  setOpen(false);
                })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not start the protocol. Please try again."))
            }
          >
            Add 1 habit
          </Button>
          <Button variant="quiet" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
      {open && (startError || error) && <Notice tone="warn">{startError || error}</Notice>}
    </Card>
  );
}

/** Share as a file, duplicate, delete. */
function Share({ plan }: { plan: Plan }) {
  function download() {
    const blob = new Blob([planToFile(plan)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${
      plan.name
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "protocol"
    }.protocol.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function duplicate() {
    const { active: _a, ...rest } = plan;
    const copy: Plan = {
      ...rest,
      id: newId(),
      name: `${plan.name} (copy)`.slice(0, 80),
      items: plan.items.map((i) => ({ ...i, id: newId() })),
      createdAt: new Date().toISOString(),
    };
    await savePlan(copy);
    location.hash = href({ name: "plan", id: copy.id });
  }
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-line pt-4">
      <Button variant="quiet" onClick={download} disabled={plan.items.length === 0}>
        Save as a file
      </Button>
      <Button variant="quiet" onClick={() => void duplicate()}>
        Duplicate
      </Button>
      <ConfirmDialog
        trigger="Delete"
        triggerVariant="quiet"
        title="Delete this protocol?"
        description={
          plan.active
            ? "Its recorded history stays in Habits, with all included items and results."
            : "This can't be undone. Any recorded history in Habits is kept."
        }
        confirmLabel="Delete protocol"
        onConfirm={async () => {
          await deletePlan(plan.id);
          location.hash = href({ name: "plans" });
        }}
      />
      <span className="text-sm text-ink-2">The file has the items and amounts only, none of your results or details.</span>
    </div>
  );
}
