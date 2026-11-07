import { MAX_PHOTOS } from "@bt/shared/core/aiProviders";
import { inkShare, type PdfPageInfo, pdfPagePlan, piecesToLines, type TextPiece } from "@bt/shared/core/importers/pdfText";
import type { PDFPageProxy } from "pdfjs-dist";
import { MAX_PHOTO_SIDE, type PreparedPhoto } from "./brain/photo";

export class PdfReadError extends Error {
  constructor(
    message: string,
    public readonly kind: "password" | "no-text" | "invalid",
  ) {
    super(message);
    this.name = "PdfReadError";
  }
}

/** A PDF's text, or, when any page is a scan (a picture without text), every page with something on it as a picture for Brain. */
export type PdfContent = { kind: "text"; text: string } | { kind: "pages"; pages: PreparedPhoto[] };

/**
 * Reads a PDF entirely in the browser. pdf.js is loaded on first use; its worker is a bundled local file.
 * Text is never guessed from pictures: a scanned page makes the whole PDF go to Brain as page pictures. Blank pages
 * (or only a page number or a logo) are left out, so they neither make a text PDF count as scanned nor use up pictures.
 */
export async function readPdf(file: File, progress?: (fraction: number, stage: string) => void): Promise<PdfContent> {
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

  try {
    const lines: string[] = [];
    const info: PdfPageInfo[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pieces: TextPiece[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const t = item.transform as number[];
        pieces.push({ str: item.str, x: t[4] ?? 0, y: t[5] ?? 0, width: item.width, height: item.height });
      }
      const pageLines = piecesToLines(pieces);
      if (pageLines.join("").trim().length >= 20) {
        lines.push(...pageLines);
        info.push({ hasText: true });
      } else {
        // Little or no text: a small drawing tells a scan from a blank page.
        const { canvas, ctx } = await drawPage(page, THUMBNAIL_SIDE);
        info.push({ hasText: false, ink: inkShare(ctx.getImageData(0, 0, canvas.width, canvas.height).data) });
      }
      page.cleanup();
    }
    const plan = pdfPagePlan(info);
    if (plan.kind === "text") return { kind: "text", text: lines.join("\n") };

    if (plan.pages.length > MAX_PHOTOS) {
      throw new PdfReadError(
        `This PDF has scanned pages and ${plan.pages.length} pages to read; Brain reads up to ${MAX_PHOTOS} at a time. Split it into smaller PDFs so every result page can be read.`,
        "invalid",
      );
    }
    const pages: PreparedPhoto[] = [];
    for (const [n, index] of plan.pages.entries()) {
      progress?.(n / plan.pages.length, `Preparing page ${n + 1} of ${plan.pages.length}`);
      const page = await doc.getPage(index + 1);
      const url = (await drawPage(page, MAX_PHOTO_SIDE)).canvas.toDataURL("image/jpeg", 0.85);
      pages.push({ mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) });
      page.cleanup();
    }
    return { kind: "pages", pages };
  } finally {
    void doc.loadingTask.destroy();
  }
}

/** Longest side of the small drawing that tells a scanned page from a blank one. */
const THUMBNAIL_SIDE = 200;

/** Draws a page on a white canvas, its longest side `side` px. */
async function drawPage(page: PDFPageProxy, side: number): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: side / Math.max(base.width, base.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: side === THUMBNAIL_SIDE });
  if (!ctx) throw new PdfReadError("This browser can't prepare the PDF's pages.", "invalid");
  // Scans can be transparent: a white page underneath, as on paper.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return { canvas, ctx };
}
