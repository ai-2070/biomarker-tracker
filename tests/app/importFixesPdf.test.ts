import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPdfText } from "../../apps/web/src/app/pdf";

const fixture = vi.hoisted(() => ({ document: undefined as unknown, recognized: [] as string[] }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve(fixture.document) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/bundled/pdf-worker.mjs" }));
vi.mock("../../apps/web/src/app/ocr", () => ({ recognize: vi.fn(async () => fixture.recognized.shift() ?? "") }));

function pdfPage(value: string) {
  return {
    getTextContent: vi.fn(async () => ({ items: value ? [{ str: value, transform: [1, 0, 0, 1, 20, 100], width: value.length * 5, height: 10 }] : [] })),
    getViewport: () => ({ width: 100, height: 150 }),
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

beforeEach(() => {
  fixture.recognized = [];
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("per-page PDF text recognition", () => {
  it("OCRs scanned result pages even after a text cover, preserving document order", async () => {
    const pages = [pdfPage("Laboratory cover with more than twenty characters"), pdfPage(""), pdfPage("Ferritin 45 µg/L 15 - 150")];
    const doc = pdfDocument(pages);
    fixture.recognized = ["C-reactive protein < 0.3 mg/L"];
    const result = await readPdfText(file());
    expect(result).toEqual({ text: "Laboratory cover with more than twenty characters\nC-reactive protein < 0.3 mg/L\nFerritin 45 µg/L 15 - 150", ocr: true });
    expect(pages.map((p) => p.render.mock.calls.length)).toEqual([0, 1, 0]);
    expect(pages.map((p) => p.cleanup.mock.calls.length)).toEqual([1, 1, 1]);
    expect(doc.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("does not load OCR for usable text pages", async () => {
    const page = pdfPage("Ferritin 45 µg/L reference 15 - 150");
    pdfDocument([page]);
    expect(await readPdfText(file())).toEqual({ text: "Ferritin 45 µg/L reference 15 - 150", ocr: false });
    expect(page.render).not.toHaveBeenCalled();
  });

  it("discloses the scanned-page cap instead of silently returning a partial report", async () => {
    const pages = [pdfPage("A selectable-text cover for a longer report"), ...Array.from({ length: 7 }, () => pdfPage(""))];
    const doc = pdfDocument(pages);
    fixture.recognized = Array.from({ length: 6 }, () => "Ferritin 45 µg/L reference 15 - 150");
    await expect(readPdfText(file())).rejects.toThrow(/more than 6 scanned pages.*Split it.*Nothing from this file has been imported/);
    expect(pages.reduce((n, p) => n + p.render.mock.calls.length, 0)).toBe(6);
    expect(doc.loadingTask.destroy).toHaveBeenCalledOnce();
  });
});
