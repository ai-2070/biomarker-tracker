import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPdf } from "../../apps/web/src/app/pdf";

const fixture = vi.hoisted(() => ({ document: undefined as unknown }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve(fixture.document) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/bundled/pdf-worker.mjs" }));

function pdfPage(value: string) {
  return {
    getTextContent: vi.fn(async () => ({ items: value ? [{ str: value, transform: [1, 0, 0, 1, 20, 100], width: value.length * 5, height: 10 }] : [] })),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale })),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    cleanup: vi.fn(),
  };
}
function pdfDocument(pages: unknown[]) {
  const doc = { numPages: pages.length, getPage: vi.fn(async (page: number) => pages[page - 1]!), loadingTask: { destroy: vi.fn(async () => {}) } };
  fixture.document = doc;
  return doc;
}
const file = () => new File(["synthetic PDF fixture"], "mixed.pdf", { type: "application/pdf" });
const canvases: { width: number; height: number }[] = [];

beforeEach(() => {
  canvases.length = 0;
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {} }), toDataURL: () => "data:image/jpeg;base64,UEFHRQ==" };
      canvases.push(canvas);
      return canvas;
    },
  });
});
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
    expect(pages.map((p) => p.render.mock.calls.length)).toEqual([1, 1, 1]);
    // Drawn so the longest side is 1568 px, the size sent to models.
    expect(canvases.map((c) => [c.width, c.height])).toEqual(Array(3).fill([1045, 1568]));
    expect(doc.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("refuses scanned PDFs with more pages than Brain reads at once, instead of sending part of the report", async () => {
    const pages = [pdfPage("A selectable-text cover for a longer report"), ...Array.from({ length: 6 }, () => pdfPage(""))];
    const doc = pdfDocument(pages);
    await expect(readPdf(file())).rejects.toThrow(/7 pages in all.*up to 6.*Split it/);
    expect(pages.reduce((n, p) => n + p.render.mock.calls.length, 0)).toBe(0);
    expect(doc.loadingTask.destroy).toHaveBeenCalledOnce();
  });
});
