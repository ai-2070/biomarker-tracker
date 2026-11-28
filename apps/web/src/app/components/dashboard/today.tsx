// The main dashboard's day: what's planned today from started protocols and habits, ticked off one tap at a
// time, what's coming up (re-tests, before-tests, planned starts), and how often each habit was kept to.
import { Checkbox } from "@base-ui/react/checkbox";
import { adherence, type CheckIn, type DayPlan, type DayState, type DayTask, dayPlan, recentDays } from "@bt/shared/core/checkIns";
import { addDays, daysBetween } from "@bt/shared/core/dates";
import { analyzeMarker, experimentPhase, type MarkerResult, markersAwaitingRetest, retestDate } from "@bt/shared/core/experiments";
import type { Experiment, Measurement, ProtocolEntry } from "@bt/shared/core/types";
import { useState } from "react";
import { toggleCheckIn } from "../../../db/db";
import { CATEGORY_LABEL, formatDate } from "../../format";
import { useWatchMeasurements } from "../../hooks";
import { watchDef } from "../../knowledge";
import { href } from "../../router";
import { TIME_LABEL } from "../PlanWhen";
import { SegmentTabs } from "../SegmentTabs";
import { CheckIcon, cardStyles, cx, eyebrowSmallStyles } from "../ui";

const weekday = (iso: string, style: "long" | "short" = "long") =>
  new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/** "Friday, 27 November". */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

/** The day's ticklist, with a switch to catch up on yesterday. */
export function TodayPlan({ protocols, checkIns, today }: { protocols: ProtocolEntry[]; checkIns: CheckIn[]; today: string }) {
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const date = day === "today" ? today : addDays(today, -1);
  const plan = dayPlan(protocols, checkIns, date);
  const upcoming = protocols.filter((p) => p.start > today && daysBetween(today, p.start) <= 14).sort((a, b) => a.start.localeCompare(b.start));

  return (
    <section className={cx(cardStyles, "flex min-w-0 flex-col gap-4 p-5")} aria-labelledby="today-title">
      <SegmentTabs
        label="Day"
        value={day}
        onChange={setDay}
        tabs={[
          { value: "today", label: "Today" },
          { value: "yesterday", label: "Yesterday" },
        ]}
        header={
          <div>
            <h2 id="today-title" className="font-serif text-2xl font-normal">
              {day === "today" ? "Today" : `Yesterday, ${weekday(date)}`}
            </h2>
            {plan.total > 0 && (
              <p className="text-sm text-ink-2" aria-live="polite">
                {plan.done === plan.total ? "All done." : `${plan.done} of ${plan.total} done`}
              </p>
            )}
          </div>
        }
      >
        {plan.total > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-[var(--ease-soft)] motion-reduce:transition-none"
              style={{ width: `${(plan.done / plan.total) * 100}%` }}
            />
          </div>
        )}
        {plan.total === 0 ? <EmptyDay hasHabits={protocols.some((p) => !p.end || p.end >= today)} /> : <DayChecklist plan={plan} className="mt-4" />}
        {upcoming.length > 0 && <p className="mt-4 text-sm text-ink-2">{upcoming.map((p) => `${p.label} starts ${formatDate(p.start)}`).join(" · ")}</p>}
      </SegmentTabs>
    </section>
  );
}

/** A day's plan by time of day, each task ticked or unticked with one tap (saved at once). */
export function DayChecklist({ plan, className }: { plan: DayPlan; className?: string }) {
  const [error, setError] = useState<string>();
  const several = new Set(plan.groups.flatMap((g) => g.tasks.map((t) => t.habitId))).size > 1;
  const tick = (t: DayTask) => {
    setError(undefined);
    toggleCheckIn(t.habitId, plan.date, t.itemId).catch((e: unknown) => setError(e instanceof Error ? e.message : "This couldn't be saved."));
  };
  return (
    <div className={cx("flex flex-col gap-5", className)}>
      {plan.groups.map((g) => (
        <div key={g.when}>
          <p className={eyebrowSmallStyles}>{TIME_LABEL[g.when]}</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {g.tasks.map((t) => (
              <li key={`${t.habitId}:${t.itemId ?? ""}`}>
                <TaskRow task={t} showHabit={several && t.itemId !== undefined} onToggle={() => tick(t)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}

function TaskRow({ task: t, showHabit, onToggle }: { task: DayTask; showHabit: boolean; onToggle: () => void }) {
  const detail = [t.amount, t.withFood && "with a meal", t.note, showHabit && t.habit].filter(Boolean).join(" · ");
  return (
    <Checkbox.Root
      checked={t.done}
      onCheckedChange={onToggle}
      className={cx(
        "group flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-150",
        t.done ? "border-transparent bg-sunken" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink group-data-checked:border-accent group-data-checked:bg-accent"
      >
        <Checkbox.Indicator className="flex data-unchecked:hidden">
          <CheckIcon />
        </Checkbox.Indicator>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx("block font-medium", t.done && "text-ink-2")}>{t.label}</span>
        {detail && <span className="block truncate text-sm text-ink-2">{detail}</span>}
      </span>
      <span className="shrink-0 text-xs text-ink-2 max-sm:hidden">{CATEGORY_LABEL[t.category]}</span>
    </Checkbox.Root>
  );
}

function EmptyDay({ hasHabits }: { hasHabits: boolean }) {
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm text-ink-2">
      <p>
        {hasHabits
          ? "Nothing planned for this day."
          : "Nothing planned yet. Start a protocol or add a habit, and what's planned each day shows here to tick off."}
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <a href={href({ name: "plans" })} className="font-medium text-accent">
          Your protocols
        </a>
        <a href={href({ name: "habits", add: "" })} className="font-medium text-accent">
          Add a habit
        </a>
      </p>
    </div>
  );
}

interface Upcoming {
  key: string;
  title: string;
  detail: string;
  to: string;
  tone: "warn" | "plain";
}

/** Re-tests that are due or close and before-tests still needed; nothing at all when none are. */
export function ComingUp({ experiments, all: results, today }: { experiments: Experiment[]; all: Measurement[]; today: string }) {
  const all = useWatchMeasurements(results) ?? results;
  const names = (ids: readonly string[]) => ids.map((id) => watchDef(id)?.name ?? id).join(", ");
  const rows = experiments.flatMap((e): (Upcoming & { order: string })[] => {
    if (e.end && e.end < today) return [];
    const res: MarkerResult[] = e.markerIds.flatMap((id) => {
      const def = watchDef(id);
      return def ? [analyzeMarker(e, def, all)] : [];
    });
    const phase = experimentPhase(res, e, today);
    const to = href({ name: "experiment", id: e.id });
    const due = retestDate(e);
    if (phase === "due")
      return [
        {
          key: e.id,
          order: due,
          to,
          tone: "warn" as const,
          title: `Re-test ${names(markersAwaitingRetest(res))}`,
          detail: `${e.change}, due since ${formatDate(due)}`,
        },
      ];
    if (phase === "needs-baseline") {
      const missing = res.filter((r) => r.verdict === "no-baseline").map((r) => r.biomarkerId);
      return [
        {
          key: e.id,
          order: e.start,
          to,
          tone: "warn" as const,
          title: `Measure ${names(missing)} first`,
          detail: `A "before" result for ${e.change}${e.start > today ? `, which starts ${formatDate(e.start)}` : ""}`,
        },
      ];
    }
    if (phase === "running" && daysBetween(today, due) <= 21)
      return [
        {
          key: e.id,
          order: due,
          to,
          tone: "plain" as const,
          title: `Re-test ${names(markersAwaitingRetest(res))}`,
          detail: `${e.change}, on ${formatDate(due)}`,
        },
      ];
    return [];
  });
  rows.sort((a, b) => a.order.localeCompare(b.order));
  // Nothing due: no box (it only reminds of before and after tests).
  if (rows.length === 0) return null;
  return (
    <section className={cx(cardStyles, "p-5")} aria-labelledby="coming-title">
      <h2 id="coming-title" className="font-serif text-xl font-normal">
        Coming up
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key}>
            <a href={r.to} className="group block py-2.5 text-ink no-underline">
              <span className={cx("block text-sm font-medium group-hover:underline", r.tone === "warn" && "text-warn")}>{r.title}</span>
              <span className="block text-xs text-ink-2">{r.detail}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATE_LABEL: Record<DayState, string> = { done: "done", part: "partly done", none: "not ticked", off: "nothing planned" };

/** How often each running habit was ticked: the last 7 days, and the count since the first tick. */
export function KeptTo({ protocols, checkIns, today }: { protocols: ProtocolEntry[]; checkIns: CheckIn[]; today: string }) {
  const running = protocols.filter((p) => p.start <= today && (!p.end || p.end >= today));
  if (running.length === 0) return null;
  return (
    <section className={cx(cardStyles, "p-5")} aria-labelledby="kept-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="kept-title" className="font-serif text-xl font-normal">
          Kept to it
        </h2>
        <a href={href({ name: "habits" })} className="text-sm font-medium text-accent no-underline hover:underline">
          Calendar
        </a>
      </div>
      <p className="mt-1 text-xs text-ink-2">Counted from the first day you ticked each one. A habit you never tick isn't counted at all.</p>
      <ul className="mt-3 flex flex-col gap-3">
        {running.map((p) => {
          const a = adherence(p, checkIns, today);
          const days = recentDays(p, checkIns, today);
          return (
            <li key={p.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{p.label}</span>
                <span className="shrink-0 text-xs text-ink-2 tabular-nums">{a ? `${a.doneDays} of ${a.days} days` : "Not ticked yet"}</span>
              </div>
              <ol className="mt-1.5 flex gap-1" aria-label={`${p.label}, the last 7 days`}>
                {days.map((d) => (
                  <li key={d.date} className="flex flex-1 flex-col items-center gap-0.5">
                    <span
                      title={`${formatDate(d.date)}: ${STATE_LABEL[d.state]}`}
                      className={cx(
                        "h-2.5 w-full rounded-sm",
                        d.state === "done" && "bg-accent",
                        d.state === "part" && "bg-accent/40",
                        d.state === "none" && "border border-line-strong",
                        d.state === "off" && "border border-dashed border-line",
                      )}
                    />
                    <span className="text-[10px] text-ink-2" aria-hidden="true">
                      {weekday(d.date, "short").slice(0, 2)}
                    </span>
                    <span className="sr-only">
                      {weekday(d.date)}: {STATE_LABEL[d.state]}
                    </span>
                  </li>
                ))}
              </ol>
              {a && (p.plan?.items.length ?? 0) > 1 && <p className="mt-0.5 text-xs text-ink-2">{Math.round(a.share * 100)}% of its items ticked</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
