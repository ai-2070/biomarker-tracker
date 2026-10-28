import { piecesToLines, type TextPiece } from "../core/importers/pdfText";
import type { OcrProgress } from "./ocr";

/** Scanned PDFs are read page by page with text recognition, up to this many pages. */
const MAX_OCR_PAGES = 6;

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
 * A scanned PDF (pictures of pages, no text) is rendered and read with text recognition instead.
 */
export async function readPdfText(file: File, progress?: OcrProgress): Promise<{ text: string; ocr: boolean }> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      // Nothing is fetched: no fonts from outside, no forms.
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
  let ocrText: string | null = null;
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

    if (lines.join("").trim().length < 20) {
      // No text layer: a scan. Render each page and recognise its text.
      const { recognize } = await import("./ocr");
      const pages = Math.min(doc.numPages, MAX_OCR_PAGES);
      const texts: string[] = [];
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 2.5 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
        texts.push(await recognize(canvas, (f, stage) => progress?.((i - 1 + f) / pages, pages > 1 ? `${stage} (page ${i} of ${pages})` : stage)));
        page.cleanup();
      }
      ocrText = texts.join("\n");
    }
  } finally {
    void doc.loadingTask.destroy();
  }

  if (ocrText !== null) {
    if (ocrText.replace(/\s/g, "").length < 20) {
      throw new PdfReadError("No text was found in this PDF, even with text recognition. Please enter the values by hand.", "no-text");
    }
    return { text: ocrText, ocr: true };
  }
  return { text: lines.join("\n"), ocr: false };
}
