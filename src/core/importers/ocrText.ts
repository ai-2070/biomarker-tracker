/**
 * Text read by OCR (photos, scanned PDFs) has a few typical mix-ups that would stop the lab-report
 * parser from finding a value. This fixes only those, and only next to digits, so names are left alone.
 * The review screen still shows every value for the person to check.
 */
export function normalizeOcrText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        // Table rules read as characters.
        .replace(/[|¦]/g, " ")
        .replace(/[—–]/g, "-")
        // Letter O for zero inside or at the start of a number: "O.8" "1O.2" "4,O"
        .replace(/(?<=\d[.,]?)[Oo](?=[\d.,\s]|$)/g, "0")
        .replace(/(?<![A-Za-z])[Oo](?=[.,]\d)/g, "0")
        // Letter l or I for one between digits: "1l2" "4I.5"
        .replace(/(?<=\d)[lI](?=[\d.,\s]|$)/g, "1")
        // Cell-count units with a small raised power: "x10^9/L" is often read as x10"9/L, x1079/L or x1049/L.
        .replace(/(?<=[x×*]\s?10)\s?["'*°^74A]?\s?(9|12)(?=\s?\/\s?[lL]\b)/g, "^$1")
        // Litre read as a capital i: "G/I" "mmol/I" (no unit ends in /I).
        .replace(/(?<=\/)I\b/g, "l")
        // A space inside a decimal: "5 .2" "5. 2"
        .replace(/(?<=\d) ?([.,]) ?(?=\d)/g, "$1")
        .replace(/[ \t]{2,}/g, "  ")
        .trimEnd(),
    )
    .filter((l) => l.trim() !== "")
    .join("\n");
}
