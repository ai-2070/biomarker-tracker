import { Checkbox } from "@base-ui/react/checkbox";
import { daysLabel, normalizeItem, PLAN_TIMES, type PlanItem, type PlanTime, WEEKDAYS, type Weekday } from "@bt/shared/core/plans";
import { useId } from "react";
import { ChoiceGroup } from "./ChoiceGroup";
import { CheckIcon, cx, labelStyles } from "./ui";

/** When a protocol item is taken: time of day, with a meal or not, and on which days of the week. */

export const TIME_LABEL: Record<PlanTime, string> = {
  morning: "Morning",
  midday: "Midday",
  evening: "Evening",
  bedtime: "Bedtime",
  "any time": "Any time",
  "with meals": "With meals",
};

const DAY_LETTER: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export interface WhenValue {
  when: PlanTime;
  withFood: boolean;
  /** Empty means every day. */
  days: Weekday[];
}

/** An item's when in the form's terms (old "with meals" items become any time, with a meal). */
export function whenOf(item: PlanItem | undefined, fallback: PlanTime = "morning"): WhenValue {
  if (!item) return { when: fallback, withFood: false, days: [] };
  const n = normalizeItem(item);
  return { when: n.when, withFood: !!n.withFood, days: n.days ?? [] };
}

/** The fields to save on an item from the form's value. */
export function whenFields(v: WhenValue): Pick<PlanItem, "when" | "withFood" | "days"> {
  const days = WEEKDAYS.filter((d) => v.days.includes(d));
  return { when: v.when, ...(v.withFood ? { withFood: true } : {}), ...(days.length > 0 && days.length < 7 ? { days } : {}) };
}

/** "With a meal · Mon, Wed, Fri", or nothing when neither applies. */
export function whenExtras(item: PlanItem): string | undefined {
  const n = normalizeItem(item);
  return [n.withFood && "With a meal", daysLabel(n.days)].filter(Boolean).join(" · ") || undefined;
}

export function WhenFields({ value, onChange }: { value: WhenValue; onChange: (v: WhenValue) => void }) {
  const foodId = useId();
  const toggle = (d: Weekday) => onChange({ ...value, days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d] });
  return (
    <div className="flex flex-col gap-3">
      <ChoiceGroup<PlanTime>
        label="When"
        value={value.when}
        onChange={(when) => onChange({ ...value, when })}
        options={PLAN_TIMES.map((t) => ({ value: t, label: TIME_LABEL[t] }))}
      />
      <div className="flex items-center gap-2">
        <Checkbox.Root
          id={foodId}
          checked={value.withFood}
          onCheckedChange={(withFood) => onChange({ ...value, withFood })}
          className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
        >
          <Checkbox.Indicator className="flex data-unchecked:hidden">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <label htmlFor={foodId} className="min-h-11 content-center">
          With a meal
        </label>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className={cx(labelStyles, "mb-1.5")}>Days (none picked: every day)</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const on = value.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d)}
                className={cx(
                  "min-h-11 min-w-12 rounded-lg border px-2 text-sm transition-colors duration-150",
                  on ? "border-accent bg-accent-soft font-medium text-ink" : "border-line text-ink-2 hover:bg-sunken",
                )}
              >
                {DAY_LETTER[d]}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
