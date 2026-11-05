/**
 * Cleans a photo or scan of a printed page before text recognition (OCR).
 *
 * Phone photos of lab reports have uneven light, paper texture, fold lines and printer streaks.
 * Tesseract reads those as letters or merges them into numbers ("140.0" became "120.0" on a real report).
 * This turns the page into black text on white:
 * 1. Adaptive threshold: a pixel is ink when clearly darker than its neighbourhood (handles shadows).
 * 2. Long vertical dark runs are erased: no printed letter is that tall, but folds, streaks and table rules are.
 * 3. Tiny specks are erased; they are much smaller than a printed full stop, which must survive.
 * Pure function over grey pixels (0 = black, 255 = white), so it is tested without a browser.
 */

export interface CleanOptions {
  /** Neighbourhood width in pixels for the threshold. Default: 1/40 of the longest side. */
  window?: number;
  /** How much darker than the neighbourhood counts as ink (0.2 = 20 % darker). */
  k?: number;
  /** Vertical runs at least this long are lines, not letters. Default: 1/12 of the height. */
  lineRun?: number;
  /** Extra pixels erased on each side of a line, for ragged edges. */
  pad?: number;
  /** Dark blobs with fewer pixels than this are specks. */
  minArea?: number;
}

/**
 * Whether an image looks like a light page with dark print, the only kind this cleaning is for.
 * Dark-mode screenshots (light text on dark) would come out blank, so they are left as they are.
 */
export function looksLikePaper(gray: ArrayLike<number>): boolean {
  const n = gray.length;
  if (n === 0) return false;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]! | 0]!++;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v]!;
    if (seen >= n / 2) return v >= 110;
  }
  return false;
}

export function cleanScan(gray: ArrayLike<number>, w: number, h: number, opts: CleanOptions = {}): Uint8ClampedArray {
  const n = w * h;
  if (gray.length !== n) throw new Error("cleanScan: pixel count doesn't match the size");
  const longest = Math.max(w, h);
  const win = opts.window ?? Math.max(15, Math.round(longest / 40));
  const k = opts.k ?? 0.2;
  const lineRun = opts.lineRun ?? Math.max(20, Math.round(h / 12));
  const pad = opts.pad ?? Math.max(2, Math.round(w / 400));
  const minArea = opts.minArea ?? Math.max(4, Math.round((w / 1000) ** 2 * 3));

  // 1. Adaptive threshold against the mean of a window, using a summed-area table.
  const W = w + 1;
  const sums = n * 255 < 2 ** 32 ? new Uint32Array(W * (h + 1)) : new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]!;
      sums[(y + 1) * W + x + 1] = sums[y * W + x + 1]! + row;
    }
  }
  const r = win >> 1;
  const ink = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = sums[y1 * W + x1]! - sums[y0 * W + x1]! - sums[y1 * W + x0]! + sums[y0 * W + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      if (gray[y * w + x]! < mean * (1 - k)) ink[y * w + x] = 1;
    }
  }

  // 2. Long vertical runs (folds, streaks, table rules), widened a little for their ragged edges.
  const line = new Uint8Array(n);
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!ink[y * w + x]) {
        y++;
        continue;
      }
      let end = y;
      while (end < h && ink[end * w + x]) end++;
      if (end - y >= lineRun) {
        for (let yy = y; yy < end; yy++) {
          for (let xx = Math.max(0, x - pad); xx <= Math.min(w - 1, x + pad); xx++) line[yy * w + xx] = 1;
        }
      }
      y = end;
    }
  }
  for (let i = 0; i < n; i++) if (line[i]) ink[i] = 0;

  // 3. Specks: connected blobs (8 neighbours) smaller than minArea.
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const blob: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!ink[i] || seen[i]) continue;
    blob.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      blob.push(j);
      const x = j % w;
      const y = (j - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (ink[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (blob.length < minArea) for (const j of blob) ink[j] = 0;
  }

  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) out[i] = ink[i] ? 0 : 255;
  return out;
}
