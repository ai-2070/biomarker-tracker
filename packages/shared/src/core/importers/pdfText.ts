/** One positioned piece of text, as pdf.js reports it (PDF units, y grows upwards). */
export interface TextPiece {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Wide gaps become this, so the parser can tell table columns apart. */
export const COLUMN_GAP = "   ";

/**
 * Rebuild reading-order lines from positioned text on one page.
 * Pieces on roughly the same baseline form a line; lines go top to bottom,
 * pieces left to right. A small gap becomes one space, a wide gap a column gap.
 */
export function piecesToLines(pieces: readonly TextPiece[]): string[] {
  const items = pieces.filter((p) => p.str.trim() !== "");
  if (items.length === 0) return [];

  const heights = items.map((p) => p.height).filter((h) => h > 0).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] ?? 10;
  const tolerance = typical * 0.5;

  // Group by baseline, top of page first.
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextPiece[][] = [];
  for (const p of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0]!.y - p.y) <= tolerance) row.push(p);
    else rows.push([p]);
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let line = "";
    let end = -Infinity;
    for (const p of row) {
      const gap = p.x - end;
      if (line !== "") {
        const h = p.height || typical;
        if (gap > h * 1.5) line = line.trimEnd() + COLUMN_GAP;
        else if (gap > h * 0.15 && !line.endsWith(" ") && !p.str.startsWith(" ")) line += " ";
      }
      line += p.str;
      end = Math.max(end, p.x + p.width);
    }
    return line.trim();
  });
}

/** A pixel counts as ink when it is darker than this (0 black … 255 white): text, lines, a scan's paper tint. */
const INK_BELOW = 230;
/** A page without enough text is a picture page (a scan) when at least this share of it is ink. */
export const PICTURE_PAGE_INK = 0.02;

/**
 * Share of a page's pixels that are ink, from an RGBA thumbnail drawn on white. A blank page, or one with
 * only a page number or a small logo, stays below `PICTURE_PAGE_INK`; a scanned page of text does not.
 */
export function inkShare(rgba: ArrayLike<number>): number {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 0;
  let ink = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    // Transparent pixels show the white page underneath.
    const a = (rgba[i + 3] ?? 255) / 255;
    const luminance = (0.299 * (rgba[i] ?? 255) + 0.587 * (rgba[i + 1] ?? 255) + 0.114 * (rgba[i + 2] ?? 255)) * a + 255 * (1 - a);
    if (luminance < INK_BELOW) ink++;
  }
  return ink / pixels;
}

/** One PDF page as `pdfPagePlan` sees it: enough selectable text, or else how much of it is ink. */
export interface PdfPageInfo {
  hasText: boolean;
  /** `inkShare` of a thumbnail; only measured for pages without enough text. */
  ink?: number;
}

/**
 * How to read a PDF: as text when no page is a picture (blank pages and footer-only pages are left out), or
 * else every page with something on it as a picture, in order (`pages` are 0-based page indexes).
 */
export function pdfPagePlan(pages: readonly PdfPageInfo[]): { kind: "text" } | { kind: "pages"; pages: number[] } {
  const isPicture = (p: PdfPageInfo) => !p.hasText && (p.ink ?? 0) >= PICTURE_PAGE_INK;
  if (!pages.some(isPicture)) return { kind: "text" };
  return { kind: "pages", pages: pages.flatMap((p, i) => (p.hasText || isPicture(p) ? [i] : [])) };
}
