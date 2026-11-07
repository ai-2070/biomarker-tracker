import { groupReadings } from "@bt/shared/core/chartSeries";
import { flagLatest, recentAverage, recentTotal, sortByDate } from "@bt/shared/core/trends";
import type { Measurement, Profile } from "@bt/shared/core/types";
import { formatDate } from "../../format";
import { BIOMARKER_MAP } from "../../knowledge";
import { href } from "../../router";
import { FlagBadge } from "../ui";
import { Sparkline } from "./Sparkline";
import { Figure } from "./widgets";

const big = "font-serif text-4xl leading-none tabular-nums sm:text-5xl";
const whole = (v: number) => Math.round(v).toLocaleString("en-GB");

/** Weekly values as points for a sparkline: averages (steps) or totals (active minutes), leaving out a week still under way. */
function weekly(series: readonly Measurement[], id: string, how: "average" | "total"): Measurement[] {
  const weeks = groupReadings(series, "week", how);
  const done = weeks.at(-1) && weeks.at(-1)!.count < 7 ? weeks.slice(0, -1) : weeks;
  return done.map((w) => ({
    id: `${id}-${w.from}`,
    biomarkerId: id,
    date: w.date,
    value: w.value,
    originalValue: w.value,
    originalUnit: "",
    source: "device",
  }));
}

/** Daily steps: last week's average first (one day says little), the latest day under it. */
export function StepsFigure({ ms, className }: { ms: Measurement[]; className?: string }) {
  const series = sortByDate(ms.filter((m) => m.biomarkerId === "steps"));
  const last = series.at(-1);
  const week = recentAverage(series, 7, 3);
  const trend = weekly(series, "steps", "average");
  return (
    <Figure
      label="Daily steps"
      href={href({ name: "marker", id: "steps" })}
      className={className}
      foot={
        !last
          ? "From a phone, watch or ring, or type it in"
          : `${formatDate(last.date)}: ${whole(last.value)} steps. No official target; in studies most of the benefit came by about 5,000–8,000 a day.`
      }
    >
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className={big}>{whole(week ? week.value : last.value)}</span>
          <span className="text-ink-2">{week ? "steps a day, last week" : "steps"}</span>
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
      {trend.length > 1 && <Sparkline series={trend} tone="ok" />}
    </Figure>
  );
}

/** Active minutes: the last 7 days' total, which is what the WHO advice (150 a week) is about. */
export function ActiveTimeFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const def = BIOMARKER_MAP.get("active_minutes")!;
  const series = sortByDate(ms.filter((m) => m.biomarkerId === "active_minutes"));
  const last = series.at(-1);
  const total = recentTotal(series, def.judgeSumOfDays ?? 7);
  const flag = last ? flagLatest(def, series, profile) : undefined;
  const out = flag === "low" || flag === "high";
  const trend = weekly(series, "active_minutes", "total");
  const advice = "The WHO advises at least 150 minutes of moderate activity a week (or 75 of vigorous).";
  return (
    <Figure
      label="Active time"
      href={href({ name: "marker", id: "active_minutes" })}
      className={className}
      foot={
        !last
          ? "Moderate or harder, from a watch or phone, or type it in"
          : total
            ? `${advice}${total.days < 7 ? ` From ${total.days} days with readings.` : ""}`
            : `${advice} A week's total needs at least 4 days with readings.`
      }
    >
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className={big}>{whole(total ? total.value : last.value)}</span>
          <span className="text-ink-2">{total ? "minutes in the last 7 days" : `minutes on ${formatDate(last.date)}`}</span>
          {out && <FlagBadge flag={flag!} />}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
      {trend.length > 1 && <Sparkline series={trend} range={{ low: 150, source: "default" }} tone={out ? "warn" : "ok"} />}
    </Figure>
  );
}
