import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPdf } from "../../apps/web/src/app/pdf";

const fixture = vi.hoisted(() => ({ document: undefined as unknown }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve(fixture.document) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/bundled/pdf-worker.mjs" }));

interface FakeCanvas {
  width: number;
  height: number;
  ink: number;
  getContext: () => unknown;
  toDataURL: () => string;
}

/** A page with this text; without text it is a scan (half ink) unless `ink` says otherwise (0: blank). */
function pdfPage(value: string, ink = value ? 0 : 0.5) {
  return {
    getTextContent: vi.fn(async () => ({ items: value ? [{ str: value, transform: [1, 0, 0, 1, 20, 100], width: value.length * 5, height: 10 }] : [] })),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale })),
    render: vi.fn(({ canvas }: { canvas: FakeCanvas }) => {
      canvas.ink = ink;
      return { promise: Promise.resolve() };
    }),
    cleanup: vi.fn(),
  };
}
function pdfDocument(pages: unknown[]) {
  const doc = { numPages: pages.length, getPage: vi.fn(async (page: number) => pages[page - 1]!), loadingTask: { destroy: vi.fn(async () => {}) } };
  fixture.document = doc;
  return doc;
}
const file = () => new File(["synthetic PDF fixture"], "mixed.pdf", { type: "application/pdf" });
const canvases: FakeCanvas[] = [];

beforeEach(() => {
  canvases.length = 0;
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        ink: 0,
        getContext: () => ({
          fillRect() {},
          // The share of black pixels the page drew.
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            const px = new Uint8ClampedArray(w * h * 4).fill(255);
            for (let i = 0; i < Math.round(w * h * canvas.ink); i++) px.fill(0, i * 4, i * 4 + 3);
            return { data: px };
          },
        }),
        toDataURL: () => "data:image/jpeg;base64,UEFHRQ==",
      };
      canvases.push(canvas);
      return canvas;
    },
  });
});
/** Canvases drawn at the size sent to models (the others are small drawings that tell scans from blank pages). */
const sent = () => canvases.filter((c) => Math.max(c.width, c.height) === 1568);
afterEach(() => vi.unstubAllGlobals());

describe("reading lab report PDFs", () => {
  it("returns the text of PDFs whose pages all have text, without drawing them", async () => {
    const page = pdfPage("Ferritin 45 µg/L reference 15 - 150");
    pdfDocument([page]);
    expect(await readPdf(file())).toEqual({ kind: "text", text: "Ferritin 45 µg/L reference 15 - 150" });
    expect(page.render).not.toHaveBeenCalled();
  });

  it("sends every page as a picture when one is scanned, even after a text cover; nothing is turned into text", async () => {
    const pages = [pdfPage("Laboratory cover with more than twenty characters"), pdfPage(""), pdfPage("Ferritin 45 µg/L 15 - 150")];
    const doc = pdfDocument(pages);
    const result = await readPdf(file());
    expect(result).toEqual({ kind: "pages", pages: Array(3).fill({ mediaType: "image/jpeg", data: "UEFHRQ==" }) });
    // The scan is drawn small once to check it isn't blank, then every page at the size sent to models.
    expect(pages.map((p) => p.render.mock.calls.length)).toEqual([1, 2, 1]);
    expect(sent().map((c) => [c.width, c.height])).toEqual(Array(3).fill([1045, 1568]));
    expect(doc.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("reads a text PDF with a blank last page as text, on this device", async () => {
    const pages = [pdfPage("Ferritin 45 µg/L reference 15 - 150"), pdfPage("CRP 2 mg/L reference 0 - 5 mg/L"), pdfPage("", 0)];
    pdfDocument(pages);
    expect(await readPdf(file())).toEqual({ kind: "text", text: "Ferritin 45 µg/L reference 15 - 150\nCRP 2 mg/L reference 0 - 5 mg/L" });
    expect(sent()).toEqual([]);
  });

  it("reads a long text PDF with a page-number-only page as text instead of refusing it", async () => {
    pdfDocument([...Array.from({ length: 7 }, (_, i) => pdfPage(`Ferritin ${40 + i} µg/L reference 15 - 150`)), pdfPage("8", 0.001)]);
    expect(await readPdf(file())).toMatchObject({ kind: "text" });
  });

  it("leaves blank pages out of a scanned PDF's pictures", async () => {
    pdfDocument([pdfPage(""), pdfPage("", 0), pdfPage("")]);
    expect(await readPdf(file())).toEqual({ kind: "pages", pages: Array(2).fill({ mediaType: "image/jpeg", data: "UEFHRQ==" }) });
  });

  it("refuses scanned PDFs with more pages than Brain reads at once, instead of sending part of the report", async () => {
    const pages = [pdfPage("A selectable-text cover for a longer report"), ...Array.from({ length: 6 }, () => pdfPage(""))];
    const doc = pdfDocument(pages);
    await expect(readPdf(file())).rejects.toThrow(/7 pages to read.*up to 6.*Split it/);
    expect(sent()).toEqual([]);
    expect(doc.loadingTask.destroy).toHaveBeenCalledOnce();
  });
});
