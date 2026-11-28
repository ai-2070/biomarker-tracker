// The Habits page's calendar: a month of days coloured by how much of the day's plan was ticked, all habits or one,
// with blood test days marked. Tapping a day shows its checklist, to tick or untick any past day.
import { addMonths, type CheckIn, type DayState, dayPlan, firstTicks, monthWeeks, planState, trackedOn } from "@bt/shared/core/checkIns";
import type { Measurement, ProtocolEntry } from "@bt/shared/core/types";
import { useState } from "react";
import { useAllMeasurements } from "../../hooks";
import { BIOMARKER_MAP, bloodOnly, bodyOnly, shortName } from "../../knowledge";
import { href } from "../../router";
import { DayChecklist, longDate } from "../dashboard/today";
import { ChevronIcon } from "../icons";
import { SimpleSelect } from "../UnitSelect";
import { cardStyles, cx, eyebrowSmallStyles } from "../ui";

const STATE_TEXT: Record<DayState, string> = { done: "all done", part: "partly done", none: "nothing ticked", off: "not tracked" };
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthName = (month: string) =>
  new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));

export function HabitCalendar({ protocols, checkIns, today }: { protocols: ProtocolEntry[]; checkIns: CheckIn[]; today: string }) {
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [only, setOnly] = useState("all");
  const [selected, setSelected] = useState(today);
  const all = useAllMeasurements() ?? [];

  const first = `${month}-01`;
  const last = `${addMonths(month, 1)}-01`;
  const inMonth = protocols.filter((p) => p.start < last && (!p.end || p.end >= first));
  const shown = only === "all" ? protocols : protocols.filter((p) => p.id === only);
  const bloodDays = new Set(bloodOnly(all).map((m) => m.date));
  // Colours count each habit only from its first tick; the checklist lists everything, so ticking can start any day.
  const ticked = firstTicks(checkIns);
  const earliest = protocols.reduce((min, p) => (p.start < min ? p.start : min), today).slice(0, 7);
  // Habits running this month, plus the chosen one if it isn't (so the choice stays visible).
  const listed = only !== "all" && !inMonth.some((p) => p.id === only) ? [...protocols.filter((p) => p.id === only), ...inMonth] : inMonth;
  const options = [{ value: "all", label: "All habits" }, ...listed.map((p) => ({ value: p.id, label: p.label }))];
  const plan = dayPlan(shown, checkIns, selected);

  return (
    <section className={cx(cardStyles, "flex min-w-0 flex-col gap-4 p-5")} aria-labelledby="calendar-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="calendar-title" className="font-serif text-2xl font-normal">
          Calendar
        </h2>
        <SimpleSelect label="Show" compact options={options} value={only} onChange={setOnly} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMonth(addMonths(month, -1))}
              disabled={month <= earliest}
              aria-label="Previous month"
              className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken disabled:opacity-30"
            >
              <ChevronIcon width={18} height={18} className="rotate-90" />
            </button>
            <p className="font-medium" aria-live="polite">
              {monthName(month)}
            </p>
            <button
              type="button"
              onClick={() => setMonth(addMonths(month, 1))}
              disabled={month >= thisMonth}
              aria-label="Next month"
              className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken disabled:opacity-30"
            >
              <ChevronIcon width={18} height={18} className="-rotate-90" />
            </button>
          </div>
          <table className="w-full table-fixed border-separate border-spacing-1">
            <caption className="sr-only">
              {monthName(month)}: how much of each day's plan was ticked{only === "all" ? "" : ` for ${options.find((o) => o.value === only)?.label}`}
            </caption>
            <thead>
              <tr>
                {WEEK.map((d) => (
                  <th key={d} scope="col" className="pb-1 text-center text-[11px] font-medium text-ink-2">
                    {d.slice(0, 2)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks(month).map((week) => (
                <tr key={week.find(Boolean)}>
                  {week.map((date, i) =>
                    date ? (
                      <td key={date} className="p-0">
                        <DayCell
                          date={date}
                          state={date > today ? undefined : planState(dayPlan(trackedOn(shown, ticked, date), checkIns, date))}
                          blood={bloodDays.has(date)}
                          today={date === today}
                          selected={date === selected}
                          onSelect={() => setSelected(date)}
                        />
                      </td>
                    ) : (
                      <td key={`pad-${i}`} />
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <Legend />
          <p className="mt-2 text-xs text-ink-2">Each habit counts from the first day you ticked it. Days before that aren't counted as missed.</p>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-xl font-normal">{selected === today ? "Today" : longDate(selected)}</h3>
            {plan.total > 0 && <p className="text-sm text-ink-2">{plan.done === plan.total ? "All done." : `${plan.done} of ${plan.total} done`}</p>}
          </div>
          {plan.total === 0 ? (
            <p className="mt-2 text-sm text-ink-2">Nothing was planned this day{only === "all" ? "" : " for this habit"}.</p>
          ) : (
            <DayChecklist plan={plan} className="mt-3" />
          )}
          <Measured all={all} date={selected} />
          {selected !== today && (
            <button
              type="button"
              onClick={() => {
                setSelected(today);
                setMonth(thisMonth);
              }}
              className="mt-4 text-sm font-medium text-accent hover:underline"
            >
              Back to today
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function DayCell({
  date,
  state,
  blood,
  today,
  selected,
  onSelect,
}: {
  date: string;
  /** Undefined for days still to come. */
  state?: DayState;
  blood: boolean;
  today: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = `${longDate(date)}${today ? " (today)" : ""}: ${state ? STATE_TEXT[state] : "still to come"}${blood ? ", blood test" : ""}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!state}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={cx(
        "relative flex aspect-square w-full min-h-10 items-center justify-center rounded-md text-sm tabular-nums transition-colors duration-150",
        state === "done" && "bg-accent font-medium text-accent-ink",
        state === "part" && "bg-accent/35 text-ink",
        state === "none" && "border border-line-strong text-ink hover:bg-sunken",
        state === "off" && "border border-dashed border-line text-ink-2 hover:bg-sunken",
        !state && "text-ink-2/50",
        today && "font-semibold",
        selected && "outline-2 outline-offset-2 outline-ink",
      )}
    >
      {Number(date.slice(8))}
      {blood && <span aria-hidden="true" className={cx("absolute bottom-1 size-1.5 rounded-full", state === "done" ? "bg-accent-ink" : "bg-accent")} />}
    </button>
  );
}

function Legend() {
  const item = (swatch: string, text: string) => (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cx("size-3.5 rounded-sm", swatch)} />
      {text}
    </li>
  );
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {item("bg-accent", "All done")}
      {item("bg-accent/35", "Some")}
      {item("border border-line-strong", "None ticked")}
      {item("border border-dashed border-line", "Not tracked")}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
        Blood test
      </li>
    </ul>
  );
}

/** What was measured that day: the blood test (with its summary) and body measurements. */
function Measured({ all, date }: { all: Measurement[]; date: string }) {
  const day = all.filter((m) => m.date === date);
  if (day.length === 0) return null;
  const blood = bloodOnly(day);
  const body = [...new Set(bodyOnly(day).map((m) => m.biomarkerId))].flatMap((id) => {
    const def = BIOMARKER_MAP.get(id);
    return def ? [shortName(def)] : [];
  });
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className={eyebrowSmallStyles}>Measured this day</p>
      <ul className="mt-1.5 flex flex-col gap-1 text-sm">
        {blood.length > 0 && (
          <li>
            Blood test, {blood.length} result{blood.length === 1 ? "" : "s"} ·{" "}
            <a href={href({ name: "test-summary", date })} className="font-medium text-accent">
              Summary of this test
            </a>
          </li>
        )}
        {body.length > 0 && (
          <li>
            Body: {body.join(", ")} ·{" "}
            <a href={href({ name: "body" })} className="font-medium text-accent">
              Body
            </a>
          </li>
        )}
      </ul>
    </div>
  );
}
