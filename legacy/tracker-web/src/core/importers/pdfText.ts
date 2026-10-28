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
