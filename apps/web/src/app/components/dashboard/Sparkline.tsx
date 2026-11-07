import type { ResolvedRange } from "@bt/shared/core/trends";
import { paddedDomain } from "@bt/shared/core/trends";
import type { Measurement } from "@bt/shared/core/types";

/**
 * One marker's recent results with its reference range as a band. Shape only: the value and its
 * date are written next to it, so nothing is read off the line alone.
 */
export function Sparkline({ series, range, tone }: { series: readonly Measurement[]; range?: ResolvedRange; tone: "ok" | "warn" | "danger" }) {
  const pts = series.slice(-10);
  const W = 200;
  const H = 44;
  const vals = pts.map((m) => m.value);
  const [lo, hi] = paddedDomain([...vals, ...(range?.low !== undefined ? [range.low] : []), ...(range?.high !== undefined ? [range.high] : [])], 0.12);
  const y = (v: number) => H - 4 - ((v - lo) / Math.max(hi - lo, 1e-9)) * (H - 8);
  const x = (i: number) => (pts.length === 1 ? W / 2 : 4 + (i / (pts.length - 1)) * (W - 8));
  const bandTop = range?.high !== undefined ? y(range.high) : 0;
  const bandBottom = range?.low !== undefined ? y(range.low) : H;
  const stroke = tone === "danger" ? "stroke-danger" : tone === "warn" ? "stroke-warn" : "stroke-chart-line";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-11 w-full" aria-hidden="true">
      {range && (
        <rect
          x={0}
          y={Math.max(0, bandTop)}
          width={W}
          height={Math.max(0, Math.min(H, bandBottom) - Math.max(0, bandTop))}
          className={range.comparisonOnly ? "fill-line-strong/30" : "fill-chart-band/12"}
        />
      )}
      <polyline
        points={pts.map((m, i) => `${x(i)},${y(m.value)}`).join(" ")}
        fill="none"
        className={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
