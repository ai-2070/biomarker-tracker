import { useEffect, useMemo, useRef, useState } from "react";
import type { Dashboard, DrawSummary } from "../../../core/dashboard";
import { dayNumber } from "../../../core/dates";
import { ageAt } from "../../../core/phenoageDraws";
import type { ProtocolEntry } from "../../../core/types";
import { formatDate, formatYears } from "../../format";
import { BIOMARKER_MAP, shortName } from "../../knowledge";
import { href } from "../../router";
import { cx } from "../ui";

/** Left gutter for the age tick labels. */
const PAD_L = 30;
/** Room on the right for the values at the end of the two age lines. */
const PAD_R = 56;
const AGE_H = 156;
const TEST_H = 44;
const LANE_H = 24;
const AXIS_H = 26;
const MAX_LANES = 6;
/** Tests closer than this (px) are drawn as one mark and listed together. */
const CLUSTER_PX = 16;
const CHAR_PX = 6.4;

/** Width of an element, kept up to date. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Packs log entries into rows so bars never overlap. */
function lanes(protocols: readonly ProtocolEntry[], today: string): { p: ProtocolEntry; row: number }[] {
  const ends: string[] = [];
  return [...protocols]
    .sort((a, b) => a.start.localeCompare(b.start))
    .flatMap((p) => {
      const row = ends.findIndex((end) => end < p.start);
      const r = row === -1 ? ends.length : row;
      if (r >= MAX_LANES) return [];
      ends[r] = p.end ?? today;
      return [{ p, row: r }];
    });
}

const names = (ids: readonly string[]) => [...new Set(ids)].map((id) => (BIOMARKER_MAP.get(id) ? shortName(BIOMARKER_MAP.get(id)!) : id));

/**
 * The person's health over the years: biological age against calendar age (the gap shaded), every
 * blood test sized by how much was out of range, and the log underneath. Hover, focus or tap a test.
 */
export function Timeline({ d, protocols, birthMonth, today }: { d: Dashboard; protocols: readonly ProtocolEntry[]; birthMonth?: string; today: string }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hover ?? pinned;
  const span = d.span!;
  const packed = useMemo(() => lanes(protocols, today), [protocols, today]);
  const laneCount = packed.reduce((n, l) => Math.max(n, l.row + 1), 0);
  const hasAge = d.bioAge.length > 0 && !!birthMonth;

  const d0 = dayNumber(span.from);
  const d1 = Math.max(dayNumber(span.to), d0 + 30);
  const lead = (d1 - d0) * 0.02;
  const right = Math.max(width, 1) - PAD_R;
  const x = (date: string) => PAD_L + ((dayNumber(date) - d0 + lead) / (d1 - d0 + lead * 2)) * (right - PAD_L);

  const ageTop = 14;
  const testsTop = hasAge ? AGE_H : 0;
  const lanesTop = testsTop + TEST_H;
  const axisTop = lanesTop + laneCount * LANE_H + (laneCount ? 6 : 0);
  const height = axisTop + AXIS_H;

  // Age scale over both lines.
  const ageAtDate = (date: string) => (birthMonth ? ageAt(birthMonth, date) : 0);
  const calStart = d.bioAge[0]?.date ?? span.from;
  const values = [...d.bioAge.flatMap((p) => [p.age, p.phenoAge]), ...(hasAge ? [ageAtDate(today)] : [])];
  const lo = values.length ? Math.floor(Math.min(...values) - 2) : 0;
  const hi = values.length ? Math.ceil(Math.max(...values) + 2) : 1;
  const y = (v: number) => ageTop + ((hi - v) / Math.max(hi - lo, 1)) * (AGE_H - ageTop - 24);
  const last = d.bioAge.at(-1);
  const yTicks = hasAge ? [lo + 2, Math.round((lo + hi) / 2), hi - 2].filter((v, i, a) => a.indexOf(v) === i) : [];

  // The gap between biological and calendar age, shaded.
  const gap = hasAge
    ? [...d.bioAge.map((p) => `${x(p.date)},${y(p.phenoAge)}`), ...[...d.bioAge].reverse().map((p) => `${x(p.date)},${y(ageAtDate(p.date))}`)].join(" ")
    : "";

  // End labels, kept apart when the two values are close.
  let bioLabelY = last ? y(last.phenoAge) : 0;
  let ageLabelY = hasAge ? y(ageAtDate(today)) : 0;
  if (hasAge && last && Math.abs(bioLabelY - ageLabelY) < 16) {
    const mid = (bioLabelY + ageLabelY) / 2;
    const up = last.phenoAge > ageAtDate(today);
    bioLabelY = mid + (up ? -8 : 8);
    ageLabelY = mid + (up ? 8 : -8);
  }

  // Tests close together become one mark.
  const clusters: { x: number; draws: DrawSummary[] }[] = [];
  for (const t of d.draws) {
    const tx = x(t.date);
    const k = clusters.at(-1);
    if (k && tx - k.x < CLUSTER_PX) k.draws.push(t);
    else clusters.push({ x: tx, draws: [t] });
  }

  // Where each log label goes: inside its bar, beside it, or shortened (then listed under the chart).
  const placed = packed.map(({ p, row }, i) => {
    const x0 = x(p.start);
    const x1 = Math.max(x(p.end ?? today), x0 + 6);
    const next = packed.slice(i + 1).find((o) => o.row === row);
    const limit = next ? x(next.p.start) - 8 : width - 4;
    const inside = Math.floor((x1 - x0 - 16) / CHAR_PX);
    const outside = Math.floor((limit - x1 - 6) / CHAR_PX);
    const fit = (n: number) => (n >= p.label.length ? p.label : n >= 6 ? `${p.label.slice(0, n - 1).trimEnd()}…` : "");
    const label =
      inside >= p.label.length
        ? { text: p.label, at: x0 + 8, inside: true }
        : outside > inside
          ? { text: fit(outside), at: x1 + 6, inside: false }
          : { text: fit(inside), at: x0 + 8, inside: true };
    return { p, row, x0, x1, label };
  });
  const shortened = width > 0 ? placed.filter((l) => l.label.text !== l.p.label).map((l) => l.p) : [];

  const years: string[] = [];
  for (let yr = Number(span.from.slice(0, 4)) + 1; yr <= Number(span.to.slice(0, 4)); yr++) years.push(`${yr}-01-01`);

  const c = active === null ? undefined : clusters[active];
  const cOut = c ? names(c.draws.flatMap((t) => t.outOfRange)) : [];
  const cCrit = c ? c.draws.some((t) => t.critical.length > 0) : false;
  const cAge = c ? d.bioAge.filter((p) => c.draws.some((t) => t.date === p.date)) : [];

  return (
    <div className="flex flex-col gap-3">
      <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
            {years.map((yr) => (
              <g key={yr}>
                <line x1={x(yr)} x2={x(yr)} y1={0} y2={axisTop} className="stroke-line" strokeWidth={1} />
                <text x={x(yr) + 4} y={axisTop + 17} className="fill-ink-2 font-mono text-[11px]">
                  {yr.slice(0, 4)}
                </text>
              </g>
            ))}
            {yTicks.map((v) => (
              <text key={v} x={PAD_L - 6} y={y(v) + 3} textAnchor="end" className="fill-ink-2 font-mono text-[10px]">
                {v}
              </text>
            ))}

            {c && <line x1={c.x} x2={c.x} y1={0} y2={axisTop} className="stroke-ink-2" strokeWidth={1} strokeDasharray="2 3" />}

            {hasAge && (
              <g>
                <polygon points={gap} className="fill-chart-band/10" />
                <line x1={x(calStart)} y1={y(ageAtDate(calStart))} x2={x(today)} y2={y(ageAtDate(today))} className="stroke-ink-2" strokeWidth={1.5} strokeDasharray="5 5" />
                <polyline points={d.bioAge.map((p) => `${x(p.date)},${y(p.phenoAge)}`).join(" ")} fill="none" className="timeline-draw stroke-chart-line" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
                {d.bioAge.map((p) => (
                  <circle
                    key={p.date}
                    cx={x(p.date)}
                    cy={y(p.phenoAge)}
                    r={c?.draws.some((t) => t.date === p.date) ? 6 : 4.5}
                    strokeWidth={2}
                    className={cx("transition-[r] duration-150", p.approximate ? "fill-surface stroke-chart-line" : "fill-chart-line stroke-surface")}
                  />
                ))}
                {last && (
                  <>
                    <text x={right + 10} y={bioLabelY + 4} className="fill-chart-line font-mono text-[12px] font-medium">
                      {last.phenoAge.toFixed(1)}
                    </text>
                    <text x={right + 10} y={ageLabelY + 4} className="fill-ink-2 font-mono text-[12px]">
                      {ageAtDate(today).toFixed(1)}
                    </text>
                  </>
                )}
              </g>
            )}

            {/* Blood tests: size shows how much was out of range */}
            <line x1={PAD_L} x2={right} y1={testsTop + TEST_H / 2} y2={testsTop + TEST_H / 2} className="stroke-line" strokeWidth={1} />
            {clusters.map((k, i) => {
              const out = new Set(k.draws.flatMap((t) => t.outOfRange)).size;
              const crit = k.draws.some((t) => t.critical.length > 0);
              const r = (out === 0 ? 5 : 5 + Math.min(out, 6)) + (active === i ? 1.5 : 0);
              return (
                <g key={k.draws[0]!.date}>
                  <circle
                    cx={k.x}
                    cy={testsTop + TEST_H / 2}
                    r={r}
                    strokeWidth={2}
                    className={cx("transition-[r] duration-150", crit ? "fill-danger stroke-surface" : out ? "fill-warn stroke-surface" : "fill-surface stroke-ink-2")}
                  />
                  {k.draws.length > 1 && (
                    <text x={k.x} y={testsTop + 9} textAnchor="middle" className="fill-ink-2 font-mono text-[10px]">
                      ×{k.draws.length}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Log: every bar keeps a readable name */}
            {placed.map(({ p, row, x0, x1, label }) => {
              const top = lanesTop + row * LANE_H;
              return (
                <g key={p.id}>
                  <title>{`${p.label}: ${formatDate(p.start)} – ${p.end ? formatDate(p.end) : "ongoing"}`}</title>
                  <rect x={x0} y={top + 3} width={x1 - x0} height={LANE_H - 7} rx={(LANE_H - 7) / 2} className={p.end ? "fill-sunken stroke-line-strong" : "fill-accent-soft stroke-accent/40"} strokeWidth={1} />
                  {label.text && (
                    <text x={label.at} y={top + LANE_H / 2 + 4} className={cx("text-[11.5px]", label.inside ? "fill-ink" : "fill-ink-2")}>
                      {label.text}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* One target per test mark: hover or focus previews, click or tap keeps it open */}
        {width > 0 &&
          clusters.map((k, i) => (
            <button
              key={k.draws[0]!.date}
              type="button"
              aria-label={`Blood test ${k.draws.map((t) => formatDate(t.date)).join(" and ")}: ${new Set(k.draws.flatMap((t) => t.outOfRange)).size} out of range`}
              aria-pressed={pinned === i}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => setPinned(pinned === i ? null : i)}
              className="absolute top-0 -translate-x-1/2 rounded-md focus-visible:outline-2 focus-visible:outline-accent"
              style={{ left: k.x, width: Math.max(CLUSTER_PX + 6, 24), height: testsTop + TEST_H }}
            />
          ))}

        {c && width > 0 && (
          <div
            role="status"
            className="absolute z-10 w-64 animate-fade rounded-xl border border-line bg-surface p-3 text-sm shadow-lg"
            style={{ left: Math.min(Math.max(c.x - 128, 0), width - 256), top: testsTop + TEST_H + 4 }}
          >
            <p className="font-medium">{c.draws.map((t) => formatDate(t.date)).join(" and ")}</p>
            <p className="text-ink-2">
              {c.draws.reduce((n, t) => n + t.results, 0)} results
              {cAge.length ? ` · biological age ${cAge.map((p) => formatYears(p.phenoAge) + (p.approximate ? " (approx.)" : "")).join(", ")}` : ""}
            </p>
            {cOut.length > 0 ? <p className={cx("mt-1", cCrit ? "text-danger" : "text-warn")}>Out of range: {cOut.join(", ")}</p> : <p className="mt-1 text-ink-2">Everything in range</p>}
            <a href={href({ name: "overview" })} className="mt-2 inline-flex min-h-9 items-center text-sm font-medium text-accent underline-offset-2 hover:underline">
              View blood tests
            </a>
          </div>
        )}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2">
        {hasAge && (
          <>
            <li className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded bg-chart-line" />
              Biological age
            </li>
            <li className="flex items-center gap-2">
              <span className="w-5 border-t-[1.5px] border-dashed border-ink-2" />
              Your age
            </li>
            {d.bioAge.some((p) => p.approximate) && (
              <li className="flex items-center gap-2">
                <span className="size-2.5 rounded-full border-2 border-chart-line bg-surface" />
                Approximate (a result below the lab's limit)
              </li>
            )}
          </>
        )}
        <li className="flex items-center gap-2">
          <span className="size-2.5 rounded-full border-2 border-ink-2 bg-surface" />
          Blood test, all in range
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-warn" />
          Out of range (bigger: more markers)
        </li>
        {laneCount > 0 && (
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-5 rounded-full border border-accent/40 bg-accent-soft" />
            Supplements, diet, medicines, habits
          </li>
        )}
      </ul>

      {shortened.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-ink-2">
          {shortened.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className={cx("h-2.5 w-5 shrink-0 rounded-full border", p.end ? "border-line-strong bg-sunken" : "border-accent/40 bg-accent-soft")} />
              <span className="text-ink">{p.label}</span>
              <span>
                {formatDate(p.start)} – {p.end ? formatDate(p.end) : "ongoing"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Tables ignore the 1px box of sr-only, so the wrapper hides it. */}
      <div className="sr-only">
        <table>
          <caption>Blood tests over time</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Results</th>
              <th>Out of range</th>
              <th>Biological age</th>
            </tr>
          </thead>
          <tbody>
            {d.draws.map((t) => (
              <tr key={t.date}>
                <td>{formatDate(t.date)}</td>
                <td>{t.results}</td>
                <td>{t.outOfRange.map((id) => BIOMARKER_MAP.get(id)?.name ?? id).join(", ") || "none"}</td>
                <td>{d.bioAge.find((p) => p.date === t.date) ? formatYears(d.bioAge.find((p) => p.date === t.date)!.phenoAge) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
