import {
  type BarsVisual,
  barsDomain,
  type FlowVisual,
  intervalRows,
  type LifestyleVisual,
  labelAnchor,
  labelRows,
  type RangesVisual,
  type SpectrumVisual,
  scalePosition,
  wavelengthRgb,
} from "@bt/shared/core/lifestyle";
import { formatValue } from "@bt/shared/core/units";
import { useState } from "react";
import { StudyLink } from "./evidence";
import { cx } from "./ui";

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
/** Translate for a label centred on a position, kept inside the chart at the edges. */
const anchorX = (f: number) => ({ start: "translateX(0)", middle: "translateX(-50%)", end: "translateX(-100%)" })[labelAnchor(f)];
const num = (x: number) => formatValue(x);
const interval = (low?: number, high?: number) => (low !== undefined && high !== undefined ? `${num(low)}–${num(high)}` : undefined);

/**
 * One visual from a lifestyle entry: the drawing, its caption, a table with the same numbers (for screen
 * readers, and anyone who prefers numbers), and the sources the numbers were copied from.
 */
export function LifestyleFigure({ v, id }: { v: LifestyleVisual; id: string }) {
  const [table, setTable] = useState(false);
  return (
    <figure id={id} className="flex scroll-mt-6 flex-col gap-3" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`${id}-title`} className="text-lg font-semibold text-balance">
          {v.title}
        </h3>
        {v.kind !== "flow" && (
          <button
            type="button"
            onClick={() => setTable((t) => !t)}
            aria-pressed={table}
            className="min-h-9 cursor-pointer rounded-lg border border-line px-3 text-sm text-ink-2 hover:border-line-strong hover:text-ink"
          >
            {table ? "Show the drawing" : "Show as a table"}
          </button>
        )}
      </div>
      {table ? <FigureTable v={v} /> : <Drawing v={v} />}
      <figcaption className="flex flex-col gap-2 text-sm text-ink-2">
        <p className="max-w-3xl">{v.caption}</p>
        <ul className="flex flex-col gap-0.5">
          {v.sources.map((s) => (
            <li key={s.pmid ?? s.doi ?? s.title}>
              <span className="text-ink-2">Source: </span>
              <StudyLink s={s} />
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

function Drawing({ v }: { v: LifestyleVisual }) {
  switch (v.kind) {
    case "bars":
      return <Bars v={v} />;
    case "spectrum":
      return <Spectrum v={v} />;
    case "flow":
      return <Flow v={v} />;
    case "ranges":
      return <Ranges v={v} />;
  }
}

// ---- Bars: ratios with intervals (a forest plot), or amounts ----------------------------------------

/** Tick values for a ratio scale: round ones first (1, 0.5, 2…), then others only where there's room. */
function ratioTicks(min: number, max: number): number[] {
  const byPriority = [1, 0.5, 2, 0.25, 4, 0.75, 1.5, 0.1, 10, 0.2, 5, 3, 0.4, 0.6, 0.8, 0.3, 0.7, 0.9, 1.25];
  const kept: number[] = [];
  for (const t of byPriority) {
    if (t < min || t > max) continue;
    const at = scalePosition(t, min, max, true);
    if (kept.every((k) => Math.abs(scalePosition(k, min, max, true) - at) >= 0.12)) kept.push(t);
  }
  return kept.sort((x, y) => x - y);
}

function linearTicks(min: number, max: number): number[] {
  const raw = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Number(t.toPrecision(6)));
  return out;
}

function Bars({ v }: { v: BarsVisual }) {
  const log = v.scale === "ratio";
  const { min, max } = barsDomain(v);
  const at = (x: number) => scalePosition(x, min, max, log);
  const ticks = log ? ratioTicks(min, max) : linearTicks(min, max);
  const ref = v.reference;
  return (
    <div className="flex flex-col gap-1">
      {log && ref && (
        <p className="flex flex-wrap justify-between gap-x-4 text-xs text-ink-2 sm:ml-[38%]">
          <span>← lower than {ref.label.toLowerCase()}</span>
          <span>higher →</span>
        </p>
      )}
      <ul className="flex flex-col">
        {v.items.map((it) => {
          const ci = interval(it.low, it.high);
          const isRef = ref !== undefined && it.value === ref.value && it.low === undefined;
          return (
            <li key={it.label} className="grid gap-x-3 gap-y-0.5 border-b border-line py-2 last:border-b-0 sm:grid-cols-[38%_minmax(0,1fr)] sm:items-center">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-ink">{it.label}</span>
                <span className="shrink-0 text-ink-2 tabular-nums sm:hidden">
                  <span className="text-ink">{num(it.value)}</span>
                  {ci && ` (${ci})`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative h-6 flex-1" title={`${it.label}: ${num(it.value)}${ci ? ` (${ci})` : ""}${it.note ? `. ${it.note}` : ""}`}>
                  {ticks.map((t) => (
                    <span key={t} aria-hidden="true" className="absolute inset-y-0 w-px bg-line" style={{ left: pct(at(t)) }} />
                  ))}
                  {ref && <span aria-hidden="true" className="absolute inset-y-0 w-px bg-ink-2" style={{ left: pct(at(ref.value)) }} />}
                  {!log && !ref && min < 0 && <span aria-hidden="true" className="absolute inset-y-0 w-px bg-ink-2" style={{ left: pct(at(0)) }} />}
                  {log ? (
                    <>
                      {it.low !== undefined && it.high !== undefined && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-accent"
                          style={{ left: pct(at(it.low)), width: pct(at(it.high) - at(it.low)) }}
                        />
                      )}
                      <span
                        aria-hidden="true"
                        className={cx(
                          "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface",
                          isRef ? "bg-ink-2" : "bg-accent",
                        )}
                        style={{ left: pct(at(it.value)) }}
                      />
                    </>
                  ) : (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute top-1 bottom-1 rounded-r bg-accent/80"
                        style={{ left: pct(at(Math.min(0, it.value))), width: pct(Math.abs(at(it.value) - at(0))) }}
                      />
                      {it.low !== undefined && it.high !== undefined && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-ink"
                          style={{ left: pct(at(it.low)), width: pct(at(it.high) - at(it.low)) }}
                        />
                      )}
                    </>
                  )}
                </div>
                <span className="hidden w-28 shrink-0 text-right text-sm text-ink-2 tabular-nums sm:block">
                  <span className="text-ink">{num(it.value)}</span>
                  {ci && <span className="block text-xs">{ci}</span>}
                </span>
              </div>
              {it.note && <p className="text-xs text-ink-2 sm:col-start-2">{it.note}</p>}
            </li>
          );
        })}
      </ul>
      {/* Axis */}
      <div className="grid gap-x-3 sm:grid-cols-[38%_minmax(0,1fr)]">
        <div className="hidden sm:block" />
        <div className="flex items-start gap-3">
          <div className="relative h-5 flex-1 text-xs text-ink-2 tabular-nums" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} className="absolute whitespace-nowrap" style={{ left: pct(at(t)), transform: anchorX(at(t)) }}>
                {num(t)}
              </span>
            ))}
          </div>
          <span className="hidden w-28 shrink-0 sm:block" />
        </div>
      </div>
      {!log && v.unit && <p className="text-right text-xs text-ink-2">{v.unit}</p>}
      {log && ref && (
        <p className="text-xs text-ink-2">
          <span aria-hidden="true" className="mr-1.5 inline-block h-3 w-px translate-y-0.5 bg-ink-2" />
          {num(ref.value)} = {ref.label}. Dots are the estimates, lines their 95% confidence intervals; the scale is logarithmic, so half and double are equally
          far from {num(ref.value)}.
        </p>
      )}
    </div>
  );
}

// ---- Spectrum: wavelengths, with what the eye can and can't see --------------------------------------

function spectrumGradient(from: number, to: number): string {
  const stops: string[] = [];
  const steps = 60;
  for (let k = 0; k <= steps; k++) {
    const nm = from + ((to - from) * k) / steps;
    const rgb = wavelengthRgb(nm);
    stops.push(`${rgb ? `rgb(${rgb.join(" ")})` : "transparent"} ${((k / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function Spectrum({ v }: { v: SpectrumVisual }) {
  const at = (nm: number) => scalePosition(nm, v.from, v.to, false);
  const groups = [...new Set(v.marks.map((m) => m.group ?? ""))];
  const ticks = linearTicks(v.from, v.to);
  return (
    <div className="flex flex-col gap-3">
      {/* The light itself: invisible parts are hatched, because the eye sees nothing there. */}
      <div className="relative">
        <div
          aria-hidden="true"
          className="h-12 rounded-lg border border-line"
          style={{
            backgroundImage: `${spectrumGradient(v.from, v.to)}, repeating-linear-gradient(135deg, var(--color-line-strong) 0 1px, transparent 1px 7px)`,
            backgroundColor: "var(--color-sunken)",
          }}
        />
        <div className="relative mt-1 h-4 text-xs text-ink-2 tabular-nums" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute whitespace-nowrap" style={{ left: pct(at(t)), transform: anchorX(at(t)) }}>
              {t}
            </span>
          ))}
        </div>
        <p className="text-right text-xs text-ink-2">nanometres (nm)</p>
      </div>

      {/* Named bands: brackets in rows so none overlap; a name inside only when it fits, every band listed below. */}
      {v.bands.length > 0 && <BandBrackets bands={v.bands} at={at} />}

      {/* Marked wavelengths, one lane per group: numbers on the axis, names in the list below. */}
      {groups.map((g) => {
        const marks = v.marks.filter((m) => (m.group ?? "") === g);
        const rows = labelRows(
          marks.map((m) => at(m.nm)),
          0.07,
        );
        const height = Math.max(...rows) + 1;
        return (
          <div key={g || "marks"} className="flex flex-col gap-1">
            {g && <p className="text-sm font-medium">{g}</p>}
            <div className="relative" style={{ height: `${height * 1.25 + 0.5}rem` }} aria-hidden="true">
              <span className="absolute inset-x-0 top-0 h-px bg-line" />
              {marks.map((m, i) => (
                <span
                  key={`${m.nm}-${m.label}`}
                  className={cx("absolute top-0 flex flex-col", { start: "items-start", middle: "items-center", end: "items-end" }[labelAnchor(at(m.nm))])}
                  style={{ left: pct(at(m.nm)), transform: anchorX(at(m.nm)) }}
                >
                  <span className="w-px bg-ink-2" style={{ height: `${rows[i]! * 1.25 + 0.4}rem` }} />
                  <span className="relative z-10 rounded-sm bg-surface px-0.5 text-xs font-medium text-ink tabular-nums">{m.nm}</span>
                </span>
              ))}
            </div>
            <ul className="grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
              {marks
                .slice()
                .sort((a, b) => a.nm - b.nm)
                .map((m) => (
                  <li key={`${m.nm}-${m.label}`} className="flex gap-2">
                    <Swatch nm={m.nm} />
                    <span>
                      <span className="font-medium tabular-nums">{m.nm} nm</span> <span className="text-ink-2">{m.label}</span>
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function BandBrackets({ bands, at }: { bands: SpectrumVisual["bands"]; at: (nm: number) => number }) {
  const spans = bands.map((b) => ({ from: at(b.from), to: at(b.to) }));
  const rows = intervalRows(spans);
  const lanes = Math.max(...rows) + 1;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative" style={{ height: `${lanes * 1.5}rem` }} aria-hidden="true">
        {bands.map((b, i) => {
          const w = spans[i]!.to - spans[i]!.from;
          // About 0.6 characters per 1% of width at phone size is too optimistic; names show from 22% wide, or when short.
          const fits = w >= 0.22 || (w >= 0.12 && b.label.length <= 12);
          return (
            <div
              key={b.label}
              className="absolute flex flex-col"
              style={{ left: pct(spans[i]!.from), width: pct(w), top: `${rows[i]! * 1.5}rem` }}
              title={`${b.label}: ${b.from}–${b.to} nm`}
            >
              <span className="h-1.5 rounded-full border-x border-ink-2/60 bg-ink-2/20" />
              {fits && <span className="truncate text-xs text-ink-2">{b.label}</span>}
            </div>
          );
        })}
      </div>
      <ul className="grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
        {bands.map((b) => (
          <li key={b.label} className="flex gap-2">
            {/* A colour swatch only when the whole band is visible, or the whole band is invisible. */}
            {!wavelengthRgb(b.from) === !wavelengthRgb(b.to) ? <Swatch nm={(b.from + b.to) / 2} /> : <span className="size-3 shrink-0" />}
            <span>
              <span className="font-medium tabular-nums">
                {b.from}–{b.to} nm
              </span>{" "}
              <span className="text-ink-2">{b.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Swatch({ nm }: { nm: number }) {
  const rgb = wavelengthRgb(nm);
  return (
    <span
      aria-hidden="true"
      className="mt-1 size-3 shrink-0 rounded-sm border border-line-strong"
      style={
        rgb
          ? { backgroundColor: `rgb(${rgb.join(" ")})` }
          : { backgroundImage: "repeating-linear-gradient(135deg, var(--color-ink-2) 0 1px, transparent 1px 4px)" }
      }
      title={rgb ? undefined : "Invisible to the eye"}
    />
  );
}

// ---- Flow: steps in order ----------------------------------------------------------------------------

function Flow({ v }: { v: FlowVisual }) {
  return (
    <ol className={cx("grid gap-2", v.steps.length <= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3", v.steps.length === 3 && "lg:grid-cols-3")}>
      {v.steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3 rounded-lg bg-sunken p-3">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-sm font-medium text-accent"
          >
            {i + 1}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{s.label}</span>
            <span className="text-sm text-ink-2">{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---- Ranges: a band per group on one scale -----------------------------------------------------------

function Ranges({ v }: { v: RangesVisual }) {
  const lo = Math.min(...v.rows.map((r) => r.low));
  const hi = Math.max(...v.rows.map((r) => r.high));
  const pad = Math.max((hi - lo) * 0.1, 0.5);
  const min = Math.max(0, Math.floor(lo - pad));
  const max = Math.ceil(hi + pad);
  const at = (x: number) => scalePosition(x, min, max, false);
  const ticks = linearTicks(min, max);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col">
        {v.rows.map((r) => (
          <li key={r.label} className="grid gap-x-3 gap-y-0.5 border-b border-line py-2 last:border-b-0 sm:grid-cols-[30%_minmax(0,1fr)] sm:items-center">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{r.label}</span>
              <span className="shrink-0 text-ink-2 tabular-nums">
                {r.low === r.high ? num(r.low) : `${num(r.low)}–${num(r.high)}`} {v.unit}
              </span>
            </div>
            <div className="relative h-5" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(at(t)) }} />
              ))}
              <span
                className="absolute top-1 bottom-1 min-w-1.5 rounded-full bg-accent/80"
                style={{ left: pct(at(r.low)), width: pct(at(r.high) - at(r.low)) }}
              />
            </div>
            {r.note && <p className="text-xs text-ink-2 sm:col-start-2">{r.note}</p>}
          </li>
        ))}
      </ul>
      <div className="grid gap-x-3 sm:grid-cols-[30%_minmax(0,1fr)]">
        <div className="hidden sm:block" />
        <div className="relative h-5 text-xs text-ink-2 tabular-nums" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute whitespace-nowrap" style={{ left: pct(at(t)), transform: anchorX(at(t)) }}>
              {num(t)}
            </span>
          ))}
        </div>
      </div>
      <p className="text-right text-xs text-ink-2">{v.unit}</p>
    </div>
  );
}

// ---- The same numbers as a table ---------------------------------------------------------------------

function FigureTable({ v }: { v: LifestyleVisual }) {
  const th = "py-1.5 pr-3 text-left font-medium text-ink-2";
  const td = "py-1.5 pr-3 align-top";
  if (v.kind === "bars")
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Group</th>
              <th className={th}>{v.scale === "ratio" ? "Ratio" : `Value${v.unit ? ` (${v.unit})` : ""}`}</th>
              <th className={th}>95% interval</th>
              <th className={th}>Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {v.items.map((it) => (
              <tr key={it.label}>
                <td className={td}>{it.label}</td>
                <td className={td}>{num(it.value)}</td>
                <td className={td}>{interval(it.low, it.high) ?? "–"}</td>
                <td className={cx(td, "text-ink-2")}>{it.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.reference && (
          <p className="mt-2 text-xs text-ink-2">
            {num(v.reference.value)} = {v.reference.label}.
          </p>
        )}
      </div>
    );
  if (v.kind === "spectrum")
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Wavelength</th>
              <th className={th}>What</th>
              <th className={th}>Group</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {v.bands.map((b) => (
              <tr key={b.label}>
                <td className={td}>
                  {b.from}–{b.to} nm
                </td>
                <td className={td}>{b.label}</td>
                <td className={cx(td, "text-ink-2")}>Band</td>
              </tr>
            ))}
            {[...v.marks]
              .sort((a, b) => a.nm - b.nm)
              .map((m) => (
                <tr key={`${m.nm}-${m.label}`}>
                  <td className={td}>{m.nm} nm</td>
                  <td className={td}>{m.label}</td>
                  <td className={cx(td, "text-ink-2")}>{m.group ?? ""}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  if (v.kind === "ranges")
    return (
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line">
            <th className={th}>Group</th>
            <th className={th}>Range ({v.unit})</th>
            <th className={th}>Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {v.rows.map((r) => (
            <tr key={r.label}>
              <td className={td}>{r.label}</td>
              <td className={td}>{r.low === r.high ? num(r.low) : `${num(r.low)}–${num(r.high)}`}</td>
              <td className={cx(td, "text-ink-2")}>{r.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  return <Flow v={v} />;
}
