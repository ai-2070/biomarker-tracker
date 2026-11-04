import { describe, expect, it } from "vitest";
import { cleanScan, looksLikePaper } from "../../src/core/importers/scanClean";

const W = 1000;
const H = 1200;

/** A synthetic grey page: `bg(x, y)` for paper, then dark rectangles drawn on it. */
function page(bg: (x: number, y: number) => number = () => 235) {
  const px = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = bg(x, y);
  const rect = (x0: number, y0: number, w: number, h: number, v = 30) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px[y * W + x] = v;
  };
  return { px, rect };
}

const inkAt = (out: Uint8ClampedArray, x: number, y: number) => out[y * W + x] === 0;
const inkIn = (out: Uint8ClampedArray, x0: number, y0: number, w: number, h: number) => {
  let n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inkAt(out, x, y)) n++;
  return n;
};

describe("cleanScan", () => {
  it("keeps letter-sized strokes and a full stop", () => {
    const { px, rect } = page();
    rect(100, 100, 4, 30); // a "1"
    rect(110, 126, 4, 4); // a full stop
    rect(120, 100, 18, 4); // a bar of a letter
    const out = cleanScan(px, W, H);
    expect(inkIn(out, 100, 100, 4, 30)).toBeGreaterThan(100);
    expect(inkIn(out, 110, 126, 4, 4)).toBe(16);
    expect(inkIn(out, 120, 100, 18, 4)).toBeGreaterThan(60);
  });

  it("erases a fold line or table rule running down the page, with its ragged edge", () => {
    const { px, rect } = page();
    rect(500, 0, 6, H, 60); // a streak
    rect(507, 300, 1, 1, 60); // a ragged edge pixel beside it
    rect(560, 300, 4, 30); // text beside the streak survives
    const out = cleanScan(px, W, H);
    expect(inkIn(out, 498, 0, 12, H)).toBe(0);
    expect(inkIn(out, 560, 300, 4, 30)).toBeGreaterThan(100);
  });

  it("erases specks smaller than a full stop", () => {
    const { px, rect } = page();
    rect(300, 300, 1, 1);
    rect(320, 300, 2, 1);
    const out = cleanScan(px, W, H);
    expect(inkIn(out, 295, 295, 40, 10)).toBe(0);
  });

  it("reads text in a shadow without turning the shadow into ink", () => {
    // Paper from 245 on the left to 110 on the right, like a photo with a hand's shadow.
    const { px, rect } = page((x) => Math.round(245 - (135 * x) / W));
    rect(900, 600, 4, 30, 40);
    const out = cleanScan(px, W, H);
    expect(inkIn(out, 900, 600, 4, 30)).toBeGreaterThan(100);
    expect(inkIn(out, 700, 100, 100, 100)).toBe(0);
  });

  it("checks the pixel count", () => {
    expect(() => cleanScan(new Uint8ClampedArray(10), 5, 5)).toThrow();
  });
});

describe("looksLikePaper", () => {
  it("is true for a light page and false for a dark-mode screenshot", () => {
    expect(looksLikePaper(page().px)).toBe(true);
    expect(looksLikePaper(page(() => 25).px)).toBe(false);
    expect(looksLikePaper([])).toBe(false);
  });
});
