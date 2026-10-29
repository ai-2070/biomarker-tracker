import { useMemo, useRef, useState } from "react";
import { ageHistory, type AgeHistory, type AgePoint } from "../../../core/ageHistory";
import { pointsForWindow } from "../../../core/chartSeries";
import { dayNumber } from "../../../core/dates";
import { ageAt } from "../../../core/phenoageDraws";
import { niceTicks } from "../../../core/scale";
import { timeTicks } from "../../../core/timeWindow";
import type { Measurement, Profile, ProtocolEntry } from "../../../core/types";
import { formatDate, formatYears } from "../../format";
import { TimeControls, segBtn, segGroup, useTimeView, useWidth } from "../timeControls";
import { Card, cx } from "../ui";

/**
 * The three age estimates over time on one chart, with calendar age as a dashed line. Each series
 * has its own colour and marker shape and is labelled at its end, so colour is never the only cue.
 * People choose the period (same controls as the timeline), which series to show, and whether to see
 * the ages themselves or their difference from calendar age. There is no combined age.
 */

type SeriesId = keyof AgeHistory;
const SERIES: { id: SeriesId; label: string; short: string; color: string; shape: "circle" | "square" | "diamond"; from: string }[] = [
  { id: "blood", label: "PhenoAge (blood tests)", short: "Blood", color: "var(--color-age-blood)", shape: "circle", from: "9 blood markers" },
  { id: "heart", label: "Heart age", short: "Heart", color: "var(--color-age-heart)", shape: "square", from: "blood pressure, BMI and smoking" },
  { id: "fitness", label: "Fitness age", short: "Fitness", color: "var(--color-age-fitness)", shape: "diamond", from: "VO₂max" },
];

const PAD_L = 36;
const PAD_R = 84;
const TOP = 14;
const AXIS_H = 26;
const DAY_MS = 86_400_000;
const yearFmt = new Intl.DateTimeFormat(undefined, { year: "numeric" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "short" });
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const isoOfDay = (day: number) => new Date(Math.round(day) * DAY_MS).toISOString().slice(0, 10);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatYears(Math.abs(n))}`;

function Marker({ shape, x, y, color, hollow, size = 4.5 }: { shape: "circle" | "square" | "diamond"; x: number; y: number; color: string; hollow?: boolean; size?: number }) {
  const common = { fill: hollow ? "var(--color-surface)" : color, stroke: hollow ? color : "var(--color-surface)", strokeWidth: hollow ? 2 : 1.5 };
  if (shape === "circle") return <circle cx={x} cy={y} r={size} {...common} />;
  if (shape === "square") return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} rx={1.5} {...common} />;
  const d = size * 1.3;
  return <path d={`M${x} ${y - d}L${x + d} ${y}L${x} ${y + d}L${x - d} ${y}Z`} {...common} />;
}

function Key({ s, on, onChange, disabled }: { s: (typeof SERIES)[number] | null; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        "flex h-11 items-center gap-2 rounded-full border px-3 text-sm transition-colors duration-150 disabled:opacity-40 sm:h-8",
        on ? "border-line-strong bg-surface text-ink" : "border-line text-ink-2 hover:text-ink",
      )}
    >
      <svg width="18" height="12" aria-hidden="true" className={cx(!on && "opacity-40")}>
        {s ? (
          <>
            <line x1="1" x2="17" y1="6" y2="6" stroke={s.color} strokeWidth="2" />
            <Marker shape={s.shape} x={9} y={6} color={s.color} size={3.5} />
          </>
        ) : (
          <line x1="1" x2="17" y1="6" y2="6" stroke="var(--color-ink-2)" strokeWidth="1.5" strokeDasharray="3 3" />
        )}
      </svg>
      {s ? s.label : "Calendar age"}
    </button>
  );
}

export function AgesChart({ measurements, profile, protocols }: { measurements: readonly Measurement[]; profile: Profile; protocols: readonly ProtocolEntry[] }) {
  const history = useMemo(() => ageHistory(profile, measurements, protocols), [profile, measurements, protocols]);
  if (!profile.birthMonth) {
    return (
      <Card>
        <p className="text-ink-2">Add your month and year of birth (Settings → Your data) to see your ages over time.</p>
      </Card>
    );
  }
  if (!SERIES.some((s) => history[s.id].length > 0)) return null;
  return <AgesPlot history={history} birthMonth={profile.birthMonth} />;
}

/** The chart itself: mounted only when there is something to draw, so it can measure its width. */
function AgesPlot({ history, birthMonth }: { history: AgeHistory; birthMonth: string }) {
  const [shown, setShown] = useState<Record<SeriesId | "calendar", boolean>>({ blood: true, heart: true, fitness: true, calendar: true });
  const [mode, setMode] = useState<"ages" | "difference">("ages");
  const [hover, setHover] = useState<{ s: SeriesId; p: AgePoint } | null>(null);
  const available = SERIES.filter((s) => history[s.id].length > 0);

  const all = available.flatMap((s) => history[s.id]);
  const d0 = all.length ? Math.min(...all.map((p) => dayNumber(p.date))) : 0;
  const d1 = all.length ? Math.max(...all.map((p) => dayNumber(p.date))) : 0;
  const full = useMemo(() => {
    const span = Math.max(d1 - d0, 60);
    const lead = Math.min(span * 0.03, 20);
    return d1 - d0 >= 60 ? { from: d0 - lead, to: d1 + lead } : { from: (d0 + d1) / 2 - 30 - lead, to: (d0 + d1) / 2 + 30 + lead };
  }, [d0, d1]);

  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const plotW = Math.max(width - PAD_L - PAD_R, 1);
  const t = useTimeView(full, { left: PAD_L, width: plotW }, { ref: box, onChange: () => setHover(null) });
  const v = t.v;
  const fromIso = isoOfDay(v.from);
  const toIso = isoOfDay(v.to);
  const height = width < 640 ? 260 : 300;
  const plotBottom = height - AXIS_H;

  const value = (p: AgePoint) => (mode === "ages" ? p.years : p.years - p.age);
  const visible = SERIES.filter((s) => shown[s.id] && history[s.id].length > 0).map((s) => ({ s, pts: pointsForWindow(history[s.id], fromIso, toIso) }));
  const calAt = (day: number) => ageAt(birthMonth, isoOfDay(day));
  const ys = [
    ...visible.flatMap(({ pts }) => pts.filter((p) => p.date >= fromIso && p.date <= toIso).map(value)),
    ...(shown.calendar ? (mode === "ages" ? [calAt(v.from), calAt(v.to)] : [0]) : []),
  ];
  const lo0 = ys.length ? Math.min(...ys) : 0;
  const hi0 = ys.length ? Math.max(...ys) : 1;
  const pad = Math.max((hi0 - lo0) * 0.12, 1);
  const yTicks = niceTicks(lo0 - pad, hi0 + pad, 5);
  const lo = yTicks[0]!;
  const hi = yTicks.at(-1)!;
  const x = (day: number) => PAD_L + ((day - v.from) / (v.to - v.from)) * plotW;
  const y = (val: number) => TOP + ((hi - val) / Math.max(hi - lo, 1e-9)) * (plotBottom - TOP);

  const ticks = timeTicks(v);
  const tickLabel = (k: { date: string; kind: "year" | "month" | "day" }) => {
    const d = new Date(`${k.date}T12:00:00`);
    return k.kind === "year" ? yearFmt.format(d) : k.kind === "day" ? dayFmt.format(d) : v.to - v.from > 400 ? monthYearFmt.format(d) : monthFmt.format(d);
  };

  // Labels at the end of each line (the last point on screen), kept 14 px apart.
  const ends = visible
    .flatMap(({ s, pts }) => {
      const last = [...pts].reverse().find((p) => p.date >= fromIso && p.date <= toIso);
      return last ? [{ s, p: last, y: y(value(last)) }] : [];
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;

  // Hover and tap: the nearest point within reach.
  const pick = (clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    const px = clientX - r.left;
    const py = clientY - r.top;
    let best: { s: SeriesId; p: AgePoint; d: number } | null = null;
    for (const { s, pts } of visible)
      for (const p of pts) {
        const d = Math.hypot(x(dayNumber(p.date)) - px, y(value(p)) - py);
        if (d < 28 && (!best || d < best.d)) best = { s: s.id, p, d };
      }
    return best ? { s: best.s, p: best.p } : null;
  };
  const hs = hover ? SERIES.find((s) => s.id === hover.s)! : undefined;

  const latest = available.map((s) => ({ s, p: history[s.id].at(-1)! }));
  const summary = `Chart of your age estimates from ${formatDate(fromIso)} to ${formatDate(toIso)}. ${latest
    .map(({ s, p }) => `${s.label}: ${p.bound ? (p.bound === "younger" ? "25 or younger" : "75 or older") : `${formatYears(p.years)} years`} on ${formatDate(p.date)}, calendar age ${formatYears(p.age)}`)
    .join(". ")}.`;

  return (
    <Card className="flex flex-col gap-4">
      {/* The latest of each, next to calendar age */}
      <div className="grid gap-3 sm:grid-cols-3">
        {latest.map(({ s, p }) => (
          <div key={s.id} className="flex flex-col gap-0.5">
            <p className="flex items-center gap-2 font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">
              <svg width="12" height="12" aria-hidden="true">
                <Marker shape={s.shape} x={6} y={6} color={s.color} size={4} />
              </svg>
              {s.label}
            </p>
            <p className="flex items-baseline gap-1.5">
              <span className="font-serif text-4xl tabular-nums">{p.bound ? (p.bound === "younger" ? "≤25" : "≥75") : formatYears(p.years)}</span>
              <span className="text-ink-2">years</span>
            </p>
            <p className="text-sm text-ink-2">
              {p.bound ? `Calendar age ${formatYears(p.age)}` : `${signed(p.years - p.age)} vs calendar age ${formatYears(p.age)}`} · {formatDate(p.date)}
            </p>
          </div>
        ))}
      </div>

      <TimeControls t={t} />

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Show as" className={segGroup}>
          {(["ages", "difference"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cx(segBtn, mode === m ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
            >
              {m === "ages" ? "Ages" : "Difference from your age"}
            </button>
          ))}
        </div>
        {available.map((s) => (
          <Key key={s.id} s={s} on={shown[s.id]} onChange={(on) => setShown({ ...shown, [s.id]: on })} />
        ))}
        <Key s={null} on={shown.calendar} onChange={(on) => setShown({ ...shown, calendar: on })} />
      </div>

      <div
        {...t.bind}
        role="img"
        aria-label={`${summary} Arrow keys move through time, plus and minus zoom, 0 shows everything.`}
        className={cx("relative w-full rounded-md select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent", t.zoomed && "cursor-grab active:cursor-grabbing")}
        style={{ ...t.bind.style, height }}
        onMouseMove={(e) => !t.isDragging() && setHover(pick(e.clientX, e.clientY))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => setHover(pick(e.clientX, e.clientY))}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block" aria-hidden="true">
            <defs>
              <clipPath id="ages-plot">
                <rect x={PAD_L} y={0} width={plotW} height={height} />
              </clipPath>
            </defs>
            {yTicks.map((k) => (
              <g key={k}>
                <line x1={PAD_L} x2={PAD_L + plotW} y1={y(k)} y2={y(k)} className="stroke-line" strokeWidth={1} />
                <text x={PAD_L - 8} y={y(k) + 4} textAnchor="end" className="fill-muted text-[12px] tabular-nums">
                  {mode === "difference" && k > 0 ? `+${k}` : k}
                </text>
              </g>
            ))}
            {ticks.map((k) => (
              <text key={k.date} x={x(k.day)} y={height - 8} textAnchor="middle" className={cx("text-[12px]", k.kind === "year" ? "fill-ink-2" : "fill-muted")}>
                {tickLabel(k)}
              </text>
            ))}
            <line x1={PAD_L} x2={PAD_L + plotW} y1={plotBottom} y2={plotBottom} className="stroke-line-strong" strokeWidth={1} />

            <g clipPath="url(#ages-plot)">
              {shown.calendar &&
                (mode === "ages" ? (
                  <line x1={x(v.from)} x2={x(v.to)} y1={y(calAt(v.from))} y2={y(calAt(v.to))} stroke="var(--color-ink-2)" strokeWidth={1.5} strokeDasharray="5 5" />
                ) : (
                  <line x1={PAD_L} x2={PAD_L + plotW} y1={y(0)} y2={y(0)} stroke="var(--color-ink-2)" strokeWidth={1.5} strokeDasharray="5 5" />
                ))}
              {visible.map(({ s, pts }) => (
                <g key={s.id}>
                  <polyline
                    points={pts.map((p) => `${x(dayNumber(p.date))},${y(value(p))}`).join(" ")}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {pts.length <= 120 &&
                    pts.map((p, i) => {
                      // Close together (many readings, narrow screen): smaller markers.
                      const gap = i > 0 ? x(dayNumber(p.date)) - x(dayNumber(pts[i - 1]!.date)) : Infinity;
                      const tight = Math.min(gap, i + 1 < pts.length ? x(dayNumber(pts[i + 1]!.date)) - x(dayNumber(p.date)) : Infinity) < 14;
                      return <Marker key={p.date} shape={s.shape} x={x(dayNumber(p.date))} y={y(value(p))} color={s.color} hollow={!!p.approximate || !!p.bound} size={tight ? 2.5 : 4.5} />;
                    })}
                </g>
              ))}
              {hover && hs && (
                <Marker shape={hs.shape} x={x(dayNumber(hover.p.date))} y={y(value(hover.p))} color={hs.color} size={7} />
              )}
            </g>

            {ends.map(({ s, p, y: ly }) => (
              <text key={s.id} x={PAD_L + plotW + 10} y={ly + 4} className="text-[12px] font-medium tabular-nums" fill={s.color}>
                {s.short} {mode === "ages" ? formatYears(p.years) : signed(p.years - p.age)}
              </text>
            ))}
            {shown.calendar && mode === "ages" && (
              <text x={PAD_L + plotW + 10} y={Math.min(Math.max(y(calAt(v.to)) + 4, TOP + 4), plotBottom)} className="fill-ink-2 text-[12px]" opacity={ends.some((e) => Math.abs(e.y - y(calAt(v.to))) < 12) ? 0 : 1}>
                Calendar {formatYears(calAt(v.to))}
              </text>
            )}
          </svg>
        )}

        {hover && hs && (
          <div
            className="pointer-events-none absolute z-10 w-56 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md"
            style={{
              left: Math.min(Math.max(x(dayNumber(hover.p.date)) - 112, 0), Math.max(width - 224, 0)),
              top: Math.max(y(value(hover.p)) - 96, 0),
            }}
          >
            <p className="text-ink-2">{formatDate(hover.p.date)}</p>
            <p className="font-semibold">
              {hs.label}: {hover.p.bound ? (hover.p.bound === "younger" ? "25 or younger" : "75 or older") : `${formatYears(hover.p.years)} years`}
            </p>
            <p className="text-ink-2">
              Calendar age {formatYears(hover.p.age)}
              {!hover.p.bound && ` (${signed(hover.p.years - hover.p.age)})`}
            </p>
            {hover.p.approximate && <p className="text-ink-2">Approximate (CRP below the lab's limit)</p>}
          </div>
        )}
      </div>

      <p className="text-sm text-ink-2">
        Hollow markers are approximate: a PhenoAge with a CRP below the lab's limit, or a fitness age at the end of the table (25 or younger, 75 or
        older). Heart age uses your current smoking answer for past dates too.
      </p>
      <p className="text-sm text-ink-2">
        <span className="font-medium text-ink">Why there's no combined age: </span>
        the three measure different things in different ways (blood chemistry linked to mortality, the risk of heart disease, and fitness compared
        with healthy Norwegian adults). An average of them wouldn't mean anything, so each is shown on its own.
      </p>

      <details className="group rounded-lg border border-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 font-medium select-none">
          Show as a table
          <span aria-hidden="true" className="text-ink-2 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-ink-2">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Estimate</th>
                <th className="px-3 py-2 font-medium">Years</th>
                <th className="px-3 py-2 font-medium">Calendar age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {available
                .flatMap((s) => history[s.id].map((p) => ({ s, p })))
                .sort((a, b) => b.p.date.localeCompare(a.p.date))
                .map(({ s, p }) => (
                  <tr key={`${s.id}-${p.date}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="px-3 py-2">{s.label}</td>
                    <td className="px-3 py-2">{p.bound ? (p.bound === "younger" ? "25 or younger" : "75 or older") : `${formatYears(p.years)}${p.approximate ? " (approximate)" : ""}`}</td>
                    <td className="px-3 py-2">{formatYears(p.age)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
