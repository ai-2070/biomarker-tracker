import { useEffect, useRef } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { WHTR_YEARS_LOST_RATIOS, waistToHeight, waistToHeightBand, waistToHeightYearsLost, type WaistToHeightBand } from "../../../core/body";
import { ageAt } from "../../../core/phenoageDraws";
import { sortByDate } from "../../../core/trends";
import type { Measurement, Profile } from "../../../core/types";
import { formatDate } from "../../format";
import { href } from "../../router";
import { StudyLink } from "../evidence";
import { useWidth } from "../timeControls";
import { Card, cx } from "../ui";
import { Figure } from "./widgets";

/**
 * Waist-to-height ratio: waist ÷ height, from the person's own waist measurements and height. Shown with
 * the ranges Ashwell et al. used, and the years of life lost their study tabulated (Table 3, copied
 * exactly; nothing filled in between). A guide to where fat sits, not a biological age.
 */

const ASHWELL_2014 = {
  pmid: "25198730",
  doi: "10.1371/journal.pone.0103483",
  title: "Waist-to-height ratio is more predictive of years of life lost than body mass index",
  year: 2014,
  studyType: "observational" as const,
};

export const WHTR_BANDS: Record<WaistToHeightBand, { label: string; range: string; chip: string; fill: string }> = {
  low: { label: "May mean low body weight", range: "below 0.4", chip: "bg-sunken text-ink-2", fill: "var(--color-sunken)" },
  guide: { label: "Within the usual guide", range: "0.4 to below 0.5", chip: "bg-ok-soft text-ok", fill: "var(--color-ok-soft)" },
  increased: { label: "Increased health risk", range: "0.5 to below 0.6", chip: "bg-warn-soft text-warn", fill: "var(--color-warn-soft)" },
  high: { label: "High health risk", range: "0.6 or more", chip: "bg-danger-soft text-danger", fill: "var(--color-danger-soft)" },
};

/** Every waist measurement as a ratio of the profile's height. */
function ratios(ms: readonly Measurement[], heightCm: number | undefined) {
  return sortByDate(ms.filter((m) => m.biomarkerId === "waist")).flatMap((m) => {
    const r = waistToHeight(m.value, heightCm);
    return r === undefined ? [] : [{ date: m.date, t: Date.parse(m.date), ratio: Math.round(r * 100) / 100, waist: m.value }];
  });
}

export function BandChip({ band, className }: { band: WaistToHeightBand; className?: string }) {
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-sm font-medium", WHTR_BANDS[band].chip, className)}>{WHTR_BANDS[band].label}</span>;
}

export function WaistToHeightFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const last = ratios(ms, profile.heightCm).at(-1);
  return (
    <Figure
      label="Waist-to-height"
      href={href({ name: "marker", id: "waist", section: "waist-to-height" })}
      className={className}
      foot={!profile.heightCm ? "Add your height in Settings → Your data." : !last ? "Measure your waist to see it." : `Waist ÷ height, ${formatDate(last.date)}. The usual guide is below 0.5.`}
    >
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-2">
          <span className="font-serif text-4xl leading-none tabular-nums sm:text-5xl">{last.ratio.toFixed(2)}</span>
          <BandChip band={waistToHeightBand(last.ratio)} />
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

/** On the waist page: your ratio over time on the ranges, and the study's years of life lost. */
export function WaistToHeightPanel({ ms, profile, scrollTo = false }: { ms: Measurement[]; profile: Profile; scrollTo?: boolean }) {
  const series = ratios(ms, profile.heightCm);
  // Opened from the Waist-to-height figure: bring this panel into view once it's drawn.
  const ref = useRef<HTMLElement>(null);
  const shown = series.length > 0 || !profile.heightCm;
  useEffect(() => {
    if (!scrollTo || !shown) return;
    const t = window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      ref.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
  }, [scrollTo, shown]);
  const last = series.at(-1);
  if (!profile.heightCm) {
    return (
      <Card ref={ref} tabIndex={-1} aria-label="Waist-to-height ratio" className="scroll-mt-6 outline-none">
        <h2 className="font-serif text-2xl font-normal">Waist-to-height ratio</h2>
        <p className="mt-1 text-ink-2">
          Your waist divided by your height. <a href={href({ name: "data", tab: "data" })}>Add your height</a> to see it.
        </p>
      </Card>
    );
  }
  if (!last) return null;
  const band = waistToHeightBand(last.ratio);
  const age = profile.birthMonth ? ageAt(profile.birthMonth, last.date) : undefined;
  const lost = waistToHeightYearsLost(last.ratio, { sex: profile.sex, age });
  return (
    <Card ref={ref} tabIndex={-1} aria-label="Waist-to-height ratio" className="flex scroll-mt-6 flex-col gap-5 outline-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="font-serif text-2xl font-normal">Waist-to-height ratio</h2>
          <p className="mt-1 text-ink-2">
            Your waist divided by your height. It shows where fat sits: fat around the middle is linked to more health risk than fat elsewhere,
            and this ratio predicted mortality better than BMI in a British study. It isn't a biological age.
          </p>
        </div>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="font-serif text-5xl leading-none tabular-nums">{last.ratio.toFixed(2)}</span>
          <BandChip band={band} />
        </p>
      </div>

      <RatioChart series={series} />

      {lost && <YearsLost ratio={last.ratio} lost={lost} />}

      <div className="max-w-3xl text-sm text-ink-2">
        <p>
          Ranges: below 0.4 may mean low body weight; 0.4 to 0.5 is the usual guide (a waist less than half your height); 0.5 to 0.6 is
          increased health risk; 0.6 or more is high. Measure halfway between the lowest rib and the top of the hip bone, after breathing out.
          Not for pregnancy; under 18 the guide differs.
        </p>
        <p className="mt-2">
          Source: <StudyLink s={ASHWELL_2014} />
        </p>
      </div>
    </Card>
  );
}

const ZONES: { band: WaistToHeightBand; from: number; to: number }[] = [
  { band: "low", from: 0, to: 0.4 },
  { band: "guide", from: 0.4, to: 0.5 },
  { band: "increased", from: 0.5, to: 0.6 },
  { band: "high", from: 0.6, to: 2 },
];

function RatioChart({ series }: { series: { date: string; t: number; ratio: number; waist: number }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const values = series.map((p) => p.ratio);
  const lo = Math.min(0.36, Math.floor((Math.min(...values) - 0.02) * 50) / 50);
  const hi = Math.max(0.66, Math.ceil((Math.max(...values) + 0.02) * 50) / 50);
  const one = series.length === 1;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">Your ratio at each waist measurement</figcaption>
      <div ref={box} className="w-full">
        {width > 0 && (
          <LineChart width={width} height={width < 640 ? 220 : 260} data={series} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            {ZONES.map((z) => (
              <ReferenceArea
                key={z.band}
                y1={Math.max(z.from, lo)}
                y2={Math.min(z.to, hi)}
                fill={WHTR_BANDS[z.band].fill}
                fillOpacity={1}
                stroke="none"
                ifOverflow="hidden"
              />
            ))}
            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={one ? [series[0]!.t - 30 * 86_400_000, series[0]!.t + 30 * 86_400_000] : ["dataMin", "dataMax"]}
              tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
              tick={{ fill: "var(--color-ink-2)", fontSize: 12 }}
              stroke="var(--color-line-strong)"
              minTickGap={40}
            />
            <YAxis
              domain={[lo, hi]}
              ticks={[0.4, 0.5, 0.6, 0.7, 0.8].filter((v) => v >= lo && v <= hi)}
              tickFormatter={(v: number) => v.toFixed(1)}
              tick={{ fill: "var(--color-ink-2)", fontSize: 12 }}
              stroke="var(--color-line-strong)"
              width={36}
            />
            <Tooltip
              cursor={{ stroke: "var(--color-line-strong)" }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as (typeof series)[number] | undefined) : undefined;
                return p ? (
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-sm">
                    <p className="font-medium tabular-nums">{p.ratio.toFixed(2)}</p>
                    <p className="text-ink-2">
                      Waist {Math.round(p.waist * 10) / 10} cm · {formatDate(p.date)}
                    </p>
                  </div>
                ) : null;
              }}
            />
            <Line dataKey="ratio" stroke="var(--color-ink)" strokeWidth={2} dot={{ r: 4, fill: "var(--color-ink)", stroke: "var(--color-surface)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2" aria-label="Ranges">
        {(["guide", "increased", "high"] as const).map((b) => (
          <li key={b} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-line" style={{ background: WHTR_BANDS[b].fill }} aria-hidden="true" />
            {WHTR_BANDS[b].label} ({WHTR_BANDS[b].range})
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The study's years of life lost for the person's sex and nearest age, as bars, with where their ratio falls. */
function YearsLost({ ratio, lost }: { ratio: number; lost: NonNullable<ReturnType<typeof waistToHeightYearsLost>> }) {
  const { row, from, to } = lost;
  const max = Math.max(...row.years);
  const who = `${row.sex === "m" ? "Men" : "Women"} aged ${row.age}`;
  const where =
    from === undefined
      ? `Your ratio, ${ratio.toFixed(2)}, is below the table's first column.`
      : to === undefined
        ? `Your ratio, ${ratio.toFixed(2)}, is in the last column (0.8 or more).`
        : ratio === WHTR_YEARS_LOST_RATIOS[from]
          ? `Your ratio is ${ratio.toFixed(2)}, one of the table's columns.`
          : `Your ratio, ${ratio.toFixed(2)}, is between ${WHTR_YEARS_LOST_RATIOS[from]} and ${WHTR_YEARS_LOST_RATIOS[to]}; the study didn't give values in between.`;
  return (
    <figure className="flex flex-col gap-3">
      <figcaption>
        <span className="text-sm font-medium">Years of life lost in the study: {who.toLowerCase()}</span>
        <span className="block text-sm text-ink-2">
          {who} who are non-smokers, compared with a ratio of {row.sex === "m" ? "0.5" : "0.46"}, if the ratio stays the same for life.
          {" "}
          {where}
        </span>
      </figcaption>
      <ol className="grid max-w-xl grid-cols-4 items-end gap-3" aria-label={`Years of life lost, ${who.toLowerCase()}`}>
        {row.years.map((y, i) => {
          const r = WHTR_YEARS_LOST_RATIOS[i]!;
          const near = i === from || i === to;
          return (
            <li key={r} className="flex flex-col items-center gap-1.5">
              <span className="text-sm tabular-nums">{y === 0 ? "0" : y.toFixed(1)} y</span>
              <span className="flex h-28 w-full items-end rounded-md bg-sunken">
                <span
                  className={cx("w-full rounded-md", near ? "bg-ink" : "bg-line-strong")}
                  style={{ height: `${Math.max(3, (y / max) * 100)}%` }}
                  aria-hidden="true"
                />
              </span>
              <span className={cx("text-sm tabular-nums", near ? "font-medium text-ink" : "text-ink-2")}>
                {i === 3 ? "0.8+" : r.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="max-w-3xl text-sm text-ink-2">
        An estimate for a group of British adults, not a prediction for you. Smokers in the study lost more years. Waist and life expectancy
        both depend on many other things.
      </p>
    </figure>
  );
}

