import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dayNumber } from "../../core/dates";
import { flagMeasurement, isOutOfRange, paddedDomain, sortByDate, type Flag, type ResolvedRange } from "../../core/trends";
import { niceTicks } from "../../core/scale";
import { formatValue, fromCanonical } from "../../core/units";
import type { BiomarkerDef, Measurement, Profile, ProtocolEntry } from "../../core/types";
import { CHART_LAYOUT, ProtocolLanes } from "./ProtocolLanes";
import { FLAG_LABEL, formatDate, showRange } from "../format";

interface Point {
  t: number;
  y: number;
  date: string;
  label: string;
  flag: Flag;
  out: boolean;
}

const DAY_MS = 86_400_000;
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });

/**
 * One marker over time. The shaded band is the reference range; points outside
 * it are larger and red. The measurement list below the chart is the text view.
 */
/** The chart draws itself in, unless the device asks for less motion. */
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const conv = (v: number) => fromCanonical(def, v, unit);
  const points: Point[] = sortByDate(measurements).map((m) => {
    const flag = flagMeasurement(def, m, profile);
    return {
      t: dayNumber(m.date) * DAY_MS,
      y: conv(m.value),
      date: m.date,
      label: `${m.qualifier ?? ""}${formatValue(conv(m.value))}`,
      flag,
      out: isOutOfRange(flag),
    };
  });

  const low = range?.low !== undefined ? conv(range.low) : undefined;
  const high = range?.high !== undefined ? conv(range.high) : undefined;
  const [padMin, padMax] = paddedDomain([...points.map((p) => p.y), ...(low !== undefined ? [low] : []), ...(high !== undefined ? [high] : [])]);
  const yTicks = niceTicks(padMin, padMax);
  const yMin = yTicks[0]!;
  const yMax = yTicks[yTicks.length - 1]!;

  // Few points: tick exactly at each sample date. Many: let the chart choose.
  const ticks = points.length <= 5 ? [...new Set(points.map((p) => p.t))] : undefined;
  const rangeText = showRange(def, range, unit);
  // Daily readings from a watch: small dots, so the line stays readable.
  const dense = points.length > 60;
  const summary = `Chart of ${def.name} in ${unit}, ${points.length} results from ${formatDate(points[0]!.date)} to ${formatDate(points[points.length - 1]!.date)}${rangeText ? `. ${range?.source === "personal" ? "Your usual range" : "Reference range"} ${rangeText}` : ""}.`;

  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: CHART_LAYOUT.marginRight, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            {(low !== undefined || high !== undefined) && (
              <ReferenceArea
                {...(range?.from ? { x1: Date.parse(range.from) } : {})}
                y1={low ?? yMin}
                y2={high ?? yMax}
                fill="var(--color-chart-band)"
                fillOpacity={0.1}
                stroke="none"
                ifOverflow="hidden"
              />
            )}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              ticks={ticks}
              tickFormatter={(t: number) => shortDate.format(new Date(t))}
              padding={{ left: CHART_LAYOUT.padX, right: CHART_LAYOUT.padX }}
              stroke="var(--color-line-strong)"
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={(v: number) => formatValue(v)}
              width={CHART_LAYOUT.yAxisWidth}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted)", fontSize: 12 }}
              ticks={yTicks}
            />
            <Tooltip
              cursor={{ stroke: "var(--color-line-strong)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Point | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-md">
                    <div className="text-ink-2">{formatDate(p.date)}</div>
                    <div className="font-semibold">
                      {p.label} {unit}
                    </div>
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
              isAnimationActive={!reducedMotion()}
              animationDuration={700}
              animationEasing="ease-out"
              dot={(props: { cx?: number; cy?: number; payload?: Point; index?: number }) => {
                const { cx, cy, payload, index } = props;
                if (cx === undefined || cy === undefined || !payload) return <g key={index} />;
                return (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
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
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        {rangeText && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-chart-band/15" />
            {range?.source === "personal"
              ? "Your usual range (from your own readings)"
              : `Reference range (${range?.source === "lab" ? "from your lab" : def.judgeAverageOfDays ? `checked against the ${def.judgeAverageOfDays}-day average` : "typical adult"})`}
          </span>
        )}
        {/* Points are marked only when a single reading can be out of range. */}
        {range?.source !== "personal" && (!def.judgeAverageOfDays || def.criticalRange) && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-3 rounded-full bg-chart-out" />
            Outside the range
          </span>
        )}
      </figcaption>
      <ProtocolLanes protocols={protocols} from={points[0]!.date} to={points[points.length - 1]!.date} today={today} />
    </figure>
  );
}
