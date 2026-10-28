// Text recognition (OCR) for photos and scanned PDFs, entirely in this browser with Tesseract.
// The engine and the English, German and Hungarian language files are served by the app itself
// (see ocrAssets in vite.config.ts), so nothing is downloaded from elsewhere and no image leaves the device.
import type Tesseract from "tesseract.js";
import { normalizeOcrText } from "../core/importers/ocrText";

export type OcrProgress = (fraction: number, stage: string) => void;

const base = () => new URL("ocr/", document.baseURI).href;
let worker: Promise<Tesseract.Worker> | null = null;
let onProgress: OcrProgress | null = null;

const STAGES: Record<string, string> = {
  "loading tesseract core": "Starting text recognition",
  "initializing tesseract": "Starting text recognition",
  "loading language traineddata": "Loading language files",
  "initializing api": "Starting text recognition",
  "recognizing text": "Reading the text",
};

function getWorker(): Promise<Tesseract.Worker> {
  worker ??= (async () => {
    const T = await import("tesseract.js");
    const w = await T.createWorker(["eng", "deu", "hun"], T.OEM.LSTM_ONLY, {
      workerPath: `${base()}worker.min.js`,
      corePath: base(),
      langPath: base(),
      // Same-origin worker file instead of a blob: works with the app's Content Security Policy.
      workerBlobURL: false,
      logger: (m: Tesseract.LoggerMessage) => onProgress?.(m.progress ?? 0, STAGES[m.status] ?? "Reading the text"),
    });
    // Lab reports are tables: read the page as one block and keep the spacing between columns.
    await w.setParameters({ tessedit_pageseg_mode: T.PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
    return w;
  })().catch((e: unknown) => {
    worker = null;
    throw e instanceof Error ? e : new Error("Text recognition couldn't start.");
  });
  return worker;
}

/** Recognises the text in a canvas. */
export async function recognize(canvas: HTMLCanvasElement, progress?: OcrProgress): Promise<string> {
  onProgress = progress ?? null;
  try {
    const w = await getWorker();
    const r = await w.recognize(canvas);
    return normalizeOcrText(r.data.text);
  } finally {
    onProgress = null;
  }
}

/**
 * A photo as a canvas, sized for good recognition: large enough for small print, not so large it gets slow.
 * Grey and a little more contrast, which helps with phone photos.
 */
export async function imageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("This image can't be opened. Use a JPG, PNG or WebP photo. (iPhone HEIC photos: share or export them as JPG first.)");
  }
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest > 2600 ? 2600 / longest : longest < 1400 ? 1400 / longest : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.filter = "grayscale(1) contrast(1.25)";
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas;
}

/** Reads a photo of a lab report. */
export async function readImageText(file: File, progress?: OcrProgress): Promise<string> {
  const text = await recognize(await imageToCanvas(file), progress);
  if (text.replace(/\s/g, "").length < 20) throw new Error("No text was recognised in this photo. Try a sharper, well-lit photo taken straight from above.");
  return text;
}
