import type { ReactNode } from "react";

export const P2 = (a: [number, number][]) => a;
export const P3 = (a: [number, number, number][]) => a;
export const INK = "var(--color-accent)";
export const PAPER = "var(--color-surface)";

/** Parallel diagonal lines ("/" direction) across a circle, only on the side away from the light (distance d0..d1 from the centre along the diagonal). */
export function shade(cx: number, cy: number, r: number, d0: number, d1: number, n: number) {
  const s = Math.SQRT1_2;
  const lines: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const d = d0 + ((d1 - d0) * i) / Math.max(1, n - 1);
    if (Math.abs(d) >= r) continue;
    const h = Math.sqrt(r * r - d * d);
    const px = cx + d * s;
    const py = cy + d * s;
    lines.push(<line key={i} x1={px + h * s} y1={py - h * s} x2={px - h * s} y2={py + h * s} />);
  }
  return <g strokeWidth="0.7">{lines}</g>;
}

/** Short straight lines, used for veins, rings and fronds. */
export function ticks(points: [number, number, number, number][]) {
  return points.map(([x1, y1, x2, y2]) => <line key={`${x1},${y1},${x2},${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />);
}

/** A closed shape filled with the card's surface colour and hatched on one side (lines slanting "/", clipped to the shape). */
export function Solid({
  id,
  d,
  from = 33,
  n = 10,
  step = 2.4,
  slant = 10,
  y0 = 8,
  y1 = 62,
  weight = 0.7,
}: {
  id: string;
  d: string;
  from?: number;
  n?: number;
  step?: number;
  slant?: number;
  y0?: number;
  y1?: number;
  weight?: number;
}) {
  return (
    <>
      <clipPath id={`art-${id}`}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={PAPER} />
      <g clipPath={`url(#art-${id})`} strokeWidth={weight}>
        {Array.from({ length: n }, (_, i) => (
          <line key={i} x1={from + i * step + slant} y1={y0} x2={from + i * step - slant} y2={y1} />
        ))}
      </g>
      <path d={d} />
    </>
  );
}

/** A narrow pointed leaf with a midrib, from (x, y) at an angle (degrees), l long and w wide. */
export function Leaf({ x, y, a, l, w, veins = 0 }: { x: number; y: number; a: number; l: number; w: number; veins?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${a})`}>
      <path d={`M0 0Q${l / 2} ${-w} ${l} 0Q${l / 2} ${w} 0 0z`} fill={PAPER} />
      <path d={`M0 0L${l * 0.92} 0`} strokeWidth="0.6" />
      {Array.from({ length: veins }, (_, i) => {
        const vx = (l * (i + 1)) / (veins + 1);
        const vy = w * 0.55 * Math.sin((Math.PI * vx) / l);
        return <path key={i} d={`M${vx} 0L${vx + l * 0.12} ${-vy}M${vx} 0L${vx + l * 0.12} ${vy}`} strokeWidth="0.45" />;
      })}
    </g>
  );
}

/** A small round berry with a highlight and shade hatching on the lower right. */
export function Round({ cx, cy, r, hatch = 4 }: { cx: number; cy: number; r: number; hatch?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={PAPER} />
      {shade(cx, cy, r, 0.1 * r, 1.1 * r, hatch)}
      <circle cx={cx} cy={cy} r={r} fill="none" />
    </g>
  );
}
