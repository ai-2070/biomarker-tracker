import { useRef, useState } from "react";
import { PERCENTILES, normRow, rowSpan, type NormRow, type NormSet } from "../../core/fitnessTests";
import type { Sex } from "../../core/types";
import { formatValue } from "../../core/units";
import { formatDate } from "../format";
import { useWidth } from "./timeControls";
import { cx } from "./ui";

/**
 * A norm table drawn across age: bands (Poor … Excellent) as shaded blocks per age group, percentiles as
 * step lines with the middle half shaded, or mean ± 1 SD. The person's own results sit on it as dots at
 * their age on the day. Below it, the table itself with the person's row marked. Values are the source's,
 * drawn as given; nothing between rows is smoothed or filled in.
 */

export interface NormPoint {
  date: string;
  age: number;
  value: number;
}

const H = 260;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };

/** Sequential shades of the accent for ordered bands, lowest result lightest. */
const shade = (i: number, n: number) => `color-mix(in oklab, var(--color-accent) ${Math.round(10 + (i / Math.max(1, n - 1)) * 45)}%, var(--color-surface))`;

export function NormChart({ set, sex, points, unit, higherIsBetter }: { set: NormSet; sex: Sex; points: NormPoint[]; unit: string; higherIsBetter: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [hover, setHover] = useState<string>();
  const rows = set.rows.filter((r) => r.sex === sex || r.sex === "any").sort((a, b) => a.ageFrom - b.ageFrom);
  if (rows.length === 0) return <p className="text-sm text-ink-2">This table has no rows for your sex.</p>;

  // Age axis: the ages the rows stand for (an open last row gets 10 years), widened to the person's points.
  const span = (r: NormRow) => rowSpan(set.rows, r);
  const ageMin = Math.min(span(rows[0]!)[0], ...points.map((p) => Math.floor(p.age)));
  const ageMax = Math.max(span(rows.at(-1)!)[1], ...points.map((p) => Math.ceil(p.age) + 1));
  // Value axis: the table's numbers and the person's, with room above an open top band.
  const tableValues = rows.flatMap((r) => [
    ...(r.bands ?? []).flatMap((b) => [b.min, b.max].filter((v): v is number => v !== undefined)),
    ...PERCENTILES.map((p) => r[p]).filter((v): v is number => v !== undefined),
    ...(r.mean !== undefined && r.sd !== undefined ? [r.mean - r.sd * 1.5, r.mean + r.sd * 1.5] : []),
  ]);
  const vals = [...tableValues, ...points.map((p) => p.value)];
  let vMin = Math.min(0, ...vals);
  let vMax = Math.max(...vals);
  vMax = vMax + Math.max((vMax - vMin) * 0.15, 1);
  if (set.kind !== "bands") vMin = Math.max(0, Math.min(...vals) - (vMax - Math.min(...vals)) * 0.1);

  const w = Math.max(width, 280);
  const x = (age: number) => PAD.left + ((age - ageMin) / (ageMax - ageMin)) * (w - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD.top - PAD.bottom);
  const labels = set.labels ?? rows[0]!.bands?.map((b) => b.label) ?? [];
  const ticks = niceTicks(vMin, vMax);
  // Tick at each row's own age (exact-age rows) or start (ranges); thinned when crowded.
  const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor((w - PAD.left - PAD.right) / 44))));
  const ageTicks = rows.map((r) => r.ageFrom).filter((a, i, all) => all.indexOf(a) === i && i % every === 0);

  return (
    <figure className="flex flex-col gap-2">
      <div ref={box} className="relative w-full">
        {width > 0 && (
          <svg width={w} height={H} role="img" aria-label={`${set.kind === "bands" ? "Bands" : set.kind === "percentiles" ? "Percentiles" : "Average and spread"} by age, with your results`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray="2 4" />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="12" fill="var(--color-ink-2)">
                  {formatValue(t)}
                </text>
              </g>
            ))}
            {rows.map((r) => {
              const x1 = x(span(r)[0]) + 1;
              const x2 = x(span(r)[1]) - 1;
              const key = `${r.sex}-${r.ageFrom}`;
              if (set.kind === "bands" && r.bands) {
                return (
                  <g key={key}>
                    {r.bands.map((b) => {
                      const i = Math.max(0, labels.indexOf(b.label));
                      const top = b.max === undefined ? vMax : b.max + (Number.isInteger(b.max) ? 0.5 : 0);
                      const bottom = b.min === undefined ? vMin : b.min - (Number.isInteger(b.min) && b.min > 0 ? 0.5 : 0);
                      const id = `${key}-${b.label}`;
                      return (
                        <rect
                          key={b.label}
                          x={x1}
                          width={Math.max(0, x2 - x1)}
                          y={y(Math.min(top, vMax))}
                          height={Math.max(0, y(Math.max(bottom, vMin)) - y(Math.min(top, vMax)))}
                          fill={shade(i, labels.length)}
                          stroke="var(--color-surface)"
                          strokeWidth={hover === id ? 2 : 1}
                          onMouseEnter={() => setHover(id)}
                          onMouseLeave={() => setHover(undefined)}
                        >
                          <title>
                            {ageLabel(r)}: {b.label} {rangeText(b.min, b.max)} {unit}
                          </title>
                        </rect>
                      );
                    })}
                  </g>
                );
              }
              if (set.kind === "percentiles") {
                const ps = PERCENTILES.filter((p) => r[p] !== undefined);
                const lo = r.p25 ?? r.p20 ?? r.p10;
                const hi = r.p75 ?? r.p80 ?? r.p90;
                return (
                  <g key={key}>
                    {lo !== undefined && hi !== undefined && <rect x={x1} width={x2 - x1} y={y(hi)} height={y(lo) - y(hi)} fill="var(--color-accent-soft)" />}
                    {ps.map((p) => (
                      <line
                        key={p}
                        x1={x1}
                        x2={x2}
                        y1={y(r[p]!)}
                        y2={y(r[p]!)}
                        stroke={p === "p50" ? "var(--color-accent)" : "var(--color-line-strong)"}
                        strokeWidth={p === "p50" ? 2 : 1}
                      >
                        <title>
                          {ageLabel(r)}: {p.slice(1)}th percentile {formatValue(r[p]!)} {unit}
                        </title>
                      </line>
                    ))}
                  </g>
                );
              }
              if (r.mean !== undefined && r.sd !== undefined) {
                return (
                  <g key={key}>
                    <rect x={x1} width={x2 - x1} y={y(r.mean + r.sd)} height={y(r.mean - r.sd) - y(r.mean + r.sd)} fill="var(--color-accent-soft)" />
                    <line x1={x1} x2={x2} y1={y(r.mean)} y2={y(r.mean)} stroke="var(--color-accent)" strokeWidth={2}>
                      <title>
                        {ageLabel(r)}: average {formatValue(r.mean)} ± {formatValue(r.sd)} {unit}
                      </title>
                    </line>
                  </g>
                );
              }
              return null;
            })}
            {ageTicks.map((a) => (
              <text key={a} x={x(a)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-ink-2)">
                {a}
              </text>
            ))}
            <line x1={PAD.left} x2={w - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--color-line-strong)" />
            {points.length > 1 && (
              <polyline
                points={points.map((p) => `${x(p.age)},${y(p.value)}`).join(" ")}
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
            )}
            {points.map((p, i) => (
              <circle key={p.date} cx={x(p.age)} cy={y(p.value)} r={i === points.length - 1 ? 6 : 4.5} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={2}>
                <title>
                  {formatDate(p.date)}: {formatValue(p.value)} {unit} at {Math.floor(p.age)}
                </title>
              </circle>
            ))}
          </svg>
        )}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
        <span>Age (years) across, {unit} up{higherIsBetter ? "" : " (lower is better)"}.</span>
        {set.kind === "bands" &&
          labels.map((l, i) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm border border-line" style={{ background: shade(i, labels.length) }} aria-hidden="true" />
              {l}
            </span>
          ))}
        {set.kind === "percentiles" && <span>Line: median (50th percentile). Shaded: the middle half of people.</span>}
        {set.kind === "mean_sd" && <span>Line: average. Shaded: average ± 1 standard deviation.</span>}
        {points.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-ink" aria-hidden="true" /> You
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** The source table for one sex, with the person's current row marked. */
export function NormTable({ set, sex, age, unit }: { set: NormSet; sex: Sex; age?: number; unit: string }) {
  const rows = set.rows.filter((r) => r.sex === sex || r.sex === "any").sort((a, b) => a.ageFrom - b.ageFrom);
  const mine = age !== undefined ? normRow(set, sex, age) : undefined;
  const labels = set.labels ?? rows[0]?.bands?.map((b) => b.label) ?? [];
  const ps = PERCENTILES.filter((p) => rows.some((r) => r[p] !== undefined));
  const head =
    set.kind === "bands" ? [...labels].reverse() : set.kind === "percentiles" ? ps.map((p) => `${p.slice(1)}th`) : ["Average", "SD"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm tabular-nums">
        <caption className="sr-only">Norm table ({unit})</caption>
        <thead className="text-ink-2">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Age</th>
            {head.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const cells =
              set.kind === "bands"
                ? [...labels].reverse().map((l) => {
                    const b = r.bands?.find((x) => x.label === l);
                    return b ? rangeText(b.min, b.max) : "–";
                  })
                : set.kind === "percentiles"
                  ? ps.map((p) => (r[p] !== undefined ? formatValue(r[p]!) : "–"))
                  : [r.mean !== undefined ? formatValue(r.mean) : "–", r.sd !== undefined ? formatValue(r.sd) : "–"];
            const me = r === mine;
            return (
              <tr key={`${r.sex}-${r.ageFrom}`} className={cx(me && "bg-accent-soft font-medium")}>
                <th scope="row" className="py-1.5 pr-3 font-normal whitespace-nowrap">
                  {ageLabel(r)}
                  {me && <span className="ml-1.5 text-xs text-accent">you</span>}
                </th>
                {cells.map((c, i) => (
                  <td key={i} className="py-1.5 pr-3 whitespace-nowrap">
                    {c}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ageLabel = (r: NormRow) => (r.ageTo === undefined ? `${r.ageFrom}+` : `${r.ageFrom}–${r.ageTo}`);

function rangeText(min?: number, max?: number): string {
  if (min === undefined && max === undefined) return "";
  if (max === undefined) return `${formatValue(min!)}+`;
  if (min === undefined || min === 0) return min === 0 && max === 0 ? "0" : `≤${formatValue(max)}`;
  return min === max ? formatValue(min) : `${formatValue(min)}–${formatValue(max)}`;
}

function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].map((s) => s * 10 ** Math.floor(Math.log10(span / 5) - 0)).find((s) => span / s <= 6) ?? span / 5;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
