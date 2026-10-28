/** Round a step size to 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * Evenly spaced, round axis ticks that cover [min, max].
 * Aims for about `count` ticks; the first and last tick are the axis bounds.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max < min) [min, max] = [max, min];
  if (max === min) max = min + 1;
  const step = niceStep((max - min) / Math.max(1, count - 1));
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Rounding keeps 0.1 + 0.2 style float noise out of the labels.
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}
