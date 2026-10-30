import { useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { groupReadings, groupingsFor, pointsForWindow, statsBetween, type Grouping } from "../../core/chartSeries";
import { dayNumber } from "../../core/dates";
import { timeTicks } from "../../core/timeWindow";
import { flagMeasurement, isOutOfRange, paddedDomain, sortByDate, type Flag, type ResolvedRange } from "../../core/trends";
import { niceTicks } from "../../core/scale";
import { formatValue, fromCanonical } from "../../core/units";
import type { BiomarkerDef, Measurement, Profile, ProtocolEntry } from "../../core/types";
import { CHART_LAYOUT, ProtocolLanes } from "./ProtocolLanes";
import { CHART_PRESETS, Overview, SelectionBar, TimeControls, segBtn, segGroup, useTimeView, useWidth } from "./timeControls";
import { cx } from "./ui";
import { FLAG_LABEL, formatDate, showRange } from "../format";
import { habitTypesIn, ofTypes, type ProtocolCategory } from "../../core/protocols";
import { HabitTypes, Toggle, useChartPrefs } from "./chartHabits";
import { aggregateFlag } from "./chartAggregate";

interface Point {
  t: number;
  y: number;
  date: string;
  label: string;
  flag: Flag;
  out: boolean;
  /** Readings averaged into this point (1: a single reading). */
  count: number;
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const yearFmt = new Intl.DateTimeFormat(undefined, { year: "numeric" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "short" });
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const isoOfDay = (day: number) => new Date(Math.round(day) * DAY_MS).toISOString().slice(0, 10);

/** The chart draws itself in, unless the device asks for less motion. */
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Short labels on phones, full ones from the small breakpoint up. */
const GROUP_LABEL: Record<Grouping, [string, string]> = { each: ["Readings", "Each reading"], week: ["Weekly", "Weekly average"], month: ["Monthly", "Monthly average"] };

interface ChartPrefs {
  group: Grouping;
  band: boolean;
  fit: boolean;
  habits: boolean;
  /** Which types of habit to show; null = every type. */
  habitTypes: ProtocolCategory[] | null;
}
// Habits under the chart are off until asked for: the chart stays light.
const DEFAULT_PREFS: ChartPrefs = { group: "each", band: true, fit: false, habits: false, habitTypes: null };

/**
 * One marker over time. The shaded band is the reference range (or the person's usual range); points
 * outside it are larger and red. People can choose the period (quick ranges, zoom, drag, keys), show
 * weekly or monthly averages for daily readings, turn the band off, fit the scale to their values,
 * and shade a habit's period. The measurement list below the chart is the text view.
 */
export function TrendChart({
  def,
  measurements,
  range,
  unit,
  profile,
  protocols = [],
  today,
}: {
  def: BiomarkerDef;
  measurements: Measurement[];
  /** A personal range has `from`: the band starts where the readings it was built from start. */
  range: (ResolvedRange & { from?: string }) | undefined;
  unit: string;
  profile: Profile;
  /** Log entries to draw under the chart. */
  protocols?: ProtocolEntry[];
  today: string;
}) {
  // Judged on a week's total (active minutes): weekly totals by default, and the range is for a week.
  const totals = !!def.judgeSumOfDays;
  const [prefs, setPrefs] = useChartPrefs<ChartPrefs>(`chart:${def.id}`, { ...DEFAULT_PREFS, group: totals ? "week" : "each" });
  // Habits of the types chosen for this chart ("only diet changes with my weight").
  const habitTypes = useMemo(() => habitTypesIn(protocols), [protocols]);
  const shownHabits = useMemo(() => ofTypes(protocols, prefs.habitTypes), [protocols, prefs.habitTypes]);
  const [habit, setHabit] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const conv = (v: number) => fromCanonical(def, v, unit);
  const sorted = useMemo(() => sortByDate(measurements), [measurements]);
  const readings = useMemo(() => sorted.map((m) => ({ date: m.date, value: m.value })), [sorted]);
  // Totals: days or weeks (a month's total can't be compared with the weekly advice).
  const groupings = useMemo(() => groupingsFor(readings).filter((g) => !totals || g !== "month"), [readings, totals]);
  const group = groupings.includes(prefs.group) ? prefs.group : "each";
  // A range for a week's total doesn't apply to single days.
  const hasRange = !!range && (range.low !== undefined || range.high !== undefined) && (!totals || group === "week");
  const band = hasRange && prefs.band;

  const points: Point[] =
    group === "each"
      ? sorted.map((m) => {
          const flag = flagMeasurement(def, m, profile);
          return { t: dayNumber(m.date) * DAY_MS, y: conv(m.value), date: m.date, label: `${m.qualifier ?? ""}${formatValue(conv(m.value))}`, flag, out: isOutOfRange(flag), count: 1, from: m.date, to: m.date };
        })
      : groupReadings(readings, group, totals ? "total" : "average").map((p) => {
          const flag = aggregateFlag(def, p, sorted, profile, totals);
          return { t: dayNumber(p.date) * DAY_MS, y: conv(p.value), date: p.date, label: formatValue(conv(p.value)), flag, out: isOutOfRange(flag), count: p.count, from: p.from, to: p.to };
        });

  // The whole time span, with a little room at the ends; at least two weeks.
  const first = dayNumber(sorted[0]!.date);
  const last = dayNumber(sorted.at(-1)!.date);
  const span = Math.max(last - first, 14);
  const mid = (first + last) / 2;
  const full = useMemo(() => {
    const lead = Math.min(span * 0.02, 4);
    return last - first >= 14 ? { from: first - lead, to: last + lead } : { from: mid - span / 2 - lead, to: mid + span / 2 + lead };
  }, [first, last, span, mid]);

  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const height = width < 640 ? 256 : 288;
  const plotLeft = CHART_LAYOUT.yAxisWidth + CHART_LAYOUT.padX;
  const plotWidth = Math.max(width - plotLeft - CHART_LAYOUT.marginRight - CHART_LAYOUT.padX, 1);
  const t = useTimeView(full, { left: plotLeft, width: plotWidth }, { ref: box, minSpan: 14, drag: "select", onChange: () => setMoved(true) });
  const v = t.v;
  const fromIso = isoOfDay(v.from);
  const toIso = isoOfDay(v.to);

  const drawn = pointsForWindow(points, fromIso, toIso);
  const inView = drawn.filter((p) => p.date >= fromIso && p.date <= toIso);
  const low = range?.low !== undefined ? conv(range.low) : undefined;
  const high = range?.high !== undefined ? conv(range.high) : undefined;
  // The scale fits what is on screen; with the band shown (and not "fit to my values") it includes the range.
  const scaleValues = [...(inView.length ? inView : drawn).map((p) => p.y), ...(band && !prefs.fit ? [low, high].filter((x): x is number => x !== undefined) : [])];
  const [padMin, padMax] = paddedDomain(scaleValues);
  const yTicks = niceTicks(padMin, padMax);
  const yMin = yTicks[0]!;
  const yMax = yTicks[yTicks.length - 1]!;

  const ticks = timeTicks(v);
  const tickKind = new Map(ticks.map((k) => [k.day * DAY_MS, k.kind]));
  const tickLabel = (ms: number) => {
    const d = new Date(ms + DAY_MS / 2);
    const kind = tickKind.get(ms);
    return kind === "year" ? yearFmt.format(d) : kind === "day" ? dayFmt.format(d) : v.to - v.from > 400 ? monthYearFmt.format(d) : monthFmt.format(d);
  };

  const rangeText = showRange(def, range, unit);
  // Daily readings from a watch: small dots, so the line stays readable.
  const dense = inView.length > 60;
  const stats = statsBetween(readings, fromIso, toIso);
  const sel = t.selection;
  const selStats = sel ? statsBetween(readings, isoOfDay(sel.from), isoOfDay(sel.to)) : undefined;
  const shaded = habit && prefs.habits ? shownHabits.find((p) => p.id === habit) : undefined;
  const showOutKey = hasRange && band && range!.source !== "personal" && (group !== "each" || !def.judgeAverageOfDays || !!def.criticalRange);
  const summary = `Chart of ${def.name} in ${unit}, ${inView.length} ${group === "each" ? "results" : `${group === "week" ? "weekly" : "monthly"} ${totals ? "totals" : "averages"}`} from ${formatDate(fromIso)} to ${formatDate(toIso)}${rangeText ? `. ${range?.source === "personal" ? "Your usual range" : "Latest reference range"} ${rangeText}` : ""}.`;
  const withUnit = (x: number) => `${formatValue(conv(x))} ${unit}`;

  return (
    <figure className="m-0 flex flex-col gap-3">
      <TimeControls t={t} presets={CHART_PRESETS} />

      {/* What the chart shows */}
      <div className="flex flex-wrap items-center gap-2">
        {groupings.length > 1 && (
          <div role="group" aria-label="Show" className={segGroup}>
            {groupings.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={group === g}
                onClick={() => setPrefs({ group: g })}
                className={cx(segBtn, group === g ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
              >
                <span className="sm:hidden">{totals && g === "week" ? "Weekly" : GROUP_LABEL[g][0]}</span>
                <span className="hidden sm:inline">{totals && g === "week" ? "Weekly total" : totals && g === "each" ? "Each day" : GROUP_LABEL[g][1]}</span>
              </button>
            ))}
          </div>
        )}
        {hasRange && (
          <Toggle on={prefs.band} onChange={(on) => setPrefs({ band: on })}>
            {range!.source === "personal" ? "Usual range" : "Range"}
          </Toggle>
        )}
        {band && (
          <Toggle on={prefs.fit} onChange={(on) => setPrefs({ fit: on })}>
            Fit to my values
          </Toggle>
        )}
        {protocols.length > 0 && (
          <Toggle
            on={prefs.habits}
            onChange={(on) => {
              setPrefs({ habits: on });
              if (!on) setHabit(null);
            }}
          >
            Habits
          </Toggle>
        )}
      </div>

      <div
        {...t.bind}
        role="img"
        aria-label={`${summary} Drag across the chart to select a period. Arrow keys move through time, plus and minus zoom, 0 shows everything, Enter zooms to a selection.`}
        className="w-full cursor-crosshair rounded-md select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        style={{ ...t.bind.style, height }}
      >
        {width > 0 && (
          <LineChart accessibilityLayer={false} width={width} height={height} data={drawn} margin={{ top: 12, right: CHART_LAYOUT.marginRight, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            {band && (
              <ReferenceArea
                {...(range?.from ? { x1: Math.max(Date.parse(range.from), v.from * DAY_MS) } : {})}
                y1={low ?? yMin}
                y2={high ?? yMax}
                fill="var(--color-chart-band)"
                fillOpacity={0.1}
                stroke="none"
                ifOverflow="hidden"
              />
            )}
            {sel && (
              <ReferenceArea
                x1={Math.max(sel.from, v.from) * DAY_MS}
                x2={Math.min(sel.to, v.to) * DAY_MS}
                fill="var(--color-accent)"
                fillOpacity={0.12}
                stroke="var(--color-accent)"
                strokeOpacity={0.6}
                ifOverflow="hidden"
              />
            )}
            {shaded && (
              <ReferenceArea
                x1={Math.max(dayNumber(shaded.start), v.from) * DAY_MS}
                x2={Math.min(dayNumber(shaded.end ?? today), v.to) * DAY_MS}
                fill="var(--color-ink-2)"
                fillOpacity={0.08}
                stroke="var(--color-ink-2)"
                strokeOpacity={0.35}
                strokeDasharray="4 4"
                ifOverflow="hidden"
              />
            )}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[v.from * DAY_MS, v.to * DAY_MS]}
              allowDataOverflow
              ticks={ticks.map((k) => k.day * DAY_MS)}
              tickFormatter={tickLabel}
              padding={{ left: CHART_LAYOUT.padX, right: CHART_LAYOUT.padX }}
              stroke="var(--color-line-strong)"
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              domain={[yMin, yMax]}
              allowDataOverflow
              tickFormatter={(x: number) => formatValue(x)}
              width={CHART_LAYOUT.yAxisWidth}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
              ticks={yTicks}
            />
            <Tooltip
              cursor={{ stroke: "var(--color-line-strong)", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Point | undefined;
                if (!active || !p || t.isDragging()) return null;
                return (
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-md">
                    <div className="text-ink-2">{p.count > 1 ? `${formatDate(p.from)} – ${formatDate(p.to)}` : formatDate(p.date)}</div>
                    <div className="font-semibold">
                      {p.label} {unit}
                    </div>
                    {p.count > 1 && <div className="text-ink-2">{totals ? "Total" : "Average"} of {p.count} readings</div>}
                    {p.flag !== "unknown" && <div className="text-ink-2">{FLAG_LABEL[p.flag]}</div>}
                  </div>
                );
              }}
            />
            <Line
              type="linear"
              dataKey="y"
              stroke="var(--color-chart-line)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              isAnimationActive={!moved && !reducedMotion()}
              animationDuration={700}
              animationEasing="ease-out"
              dot={(props: { cx?: number; cy?: number; payload?: Point; index?: number }) => {
                const { cx: x, cy: y, payload, index } = props;
                if (x === undefined || y === undefined || !payload) return <g key={index} />;
                return (
                  <circle
                    key={index}
                    cx={x}
                    cy={y}
                    r={payload.out ? 6 : dense ? 2 : 4.5}
                    fill={payload.out ? "var(--color-chart-out)" : "var(--color-chart-line)"}
                    stroke="var(--color-surface)"
                    strokeWidth={dense && !payload.out ? 0 : 2}
                  />
                );
              }}
              activeDot={{ r: 7, stroke: "var(--color-surface)", strokeWidth: 2 }}
            />
          </LineChart>
        )}
      </div>

      {t.zoomed && <Overview t={t} lines={[{ points: sorted.map((m) => ({ day: dayNumber(m.date), value: m.value })), color: "var(--color-chart-line)" }]} />}

      <SelectionBar t={t}>
        {selStats ? (
          <span className="tabular-nums">
            {selStats.count} {selStats.count === 1 ? "reading" : "readings"}
            {selStats.count > 1 &&
              ` · average ${withUnit(selStats.average)} · from ${withUnit(selStats.first.value)} to ${withUnit(selStats.last.value)} (${selStats.change > 0 ? "+" : selStats.change < 0 ? "−" : "±"}${formatValue(Math.abs(conv(selStats.last.value) - conv(selStats.first.value)))} ${unit})`}
          </span>
        ) : (
          "No readings in this period."
        )}
      </SelectionBar>

      <figcaption className="flex flex-col gap-2 text-sm text-ink-2">
        {stats && (
          <p className="tabular-nums" aria-live="polite">
            <span className="font-medium text-ink">In view: </span>
            {stats.count} {stats.count === 1 ? "reading" : "readings"}
            {stats.count > 1 && (
              <>
                {" "}
                · average {withUnit(stats.average)} · lowest {withUnit(stats.low.value)} ({formatDate(stats.low.date)}) · highest {withUnit(stats.high.value)} ({formatDate(stats.high.date)})
              </>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {band && rangeText && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-chart-band/15" />
              {range?.source === "personal"
                ? "Your usual range (from your own readings)"
                : `Reference range (${range?.source === "lab" ? "from your lab" : def.judgeAverageOfDays ? `checked against the ${def.judgeAverageOfDays}-day average` : totals ? "advice for a week's total" : "typical adult"})`}
            </span>
          )}
          {showOutKey && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-3 rounded-full bg-chart-out" />
              Outside the range
            </span>
          )}
          {shaded && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm border border-dashed border-ink-2/50 bg-ink-2/10" />
              {shaded.label}
            </span>
          )}
        </div>
      </figcaption>
      {prefs.habits && habitTypes.length > 1 && <HabitTypes present={habitTypes} shown={prefs.habitTypes} onChange={(types) => setPrefs({ habitTypes: types })} />}
      {prefs.habits && <ProtocolLanes protocols={shownHabits} from={fromIso} to={toIso} today={today} selected={habit} onSelect={setHabit} />}
    </figure>
  );
}
