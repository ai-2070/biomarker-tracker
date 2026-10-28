import { piecesToLines, type TextPiece } from "../core/importers/pdfText";

export class PdfReadError extends Error {
  constructor(
    message: string,
    public readonly kind: "password" | "no-text" | "invalid",
  ) {
    super(message);
    this.name = "PdfReadError";
  }
}

/**
 * Extract text lines from a PDF, entirely in the browser.
 * pdf.js is loaded on first use; its worker is a bundled local file.
 */
export async function readPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      // We only read text: no fonts, no rendering, nothing fetched.
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      isOffscreenCanvasSupported: false,
    }).promise;
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") {
      throw new PdfReadError("This PDF is password-protected. Open it, save an unprotected copy, and try again.", "password");
    }
    throw new PdfReadError("This file couldn't be read as a PDF.", "invalid");
  }

  const lines: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pieces: TextPiece[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const t = item.transform as number[];
        pieces.push({ str: item.str, x: t[4] ?? 0, y: t[5] ?? 0, width: item.width, height: item.height });
      }
      lines.push(...piecesToLines(pieces));
      page.cleanup();
    }
  } finally {
    void doc.loadingTask.destroy();
  }

  if (lines.join("").trim().length < 20) {
    throw new PdfReadError(
      "No text was found in this PDF. It is probably a scanned image. Scans can't be read yet; please enter the values by hand.",
      "no-text",
    );
  }
  return lines.join("\n");
}
