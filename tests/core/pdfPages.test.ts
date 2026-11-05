import { describe, expect, it } from "vitest";
import { PICTURE_PAGE_INK, inkShare, pdfPagePlan } from "@bt/shared/core/importers/pdfText";

/** An RGBA thumbnail with `dark` of `total` pixels black and the rest white. */
function thumbnail(total: number, dark: number, alpha = 255): Uint8ClampedArray {
  const px = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    const v = i < dark ? 0 : 255;
    px.set([v, v, v, alpha], i * 4);
  }
  return px;
}

describe("telling scanned PDF pages from blank ones", () => {
  it("measures the share of dark pixels, treating transparency as the white page", () => {
    expect(inkShare(thumbnail(100, 0))).toBe(0);
    expect(inkShare(thumbnail(100, 25))).toBe(0.25);
    expect(inkShare(thumbnail(100, 100, 0))).toBe(0);
    expect(inkShare(new Uint8ClampedArray())).toBe(0);
    // A grey scanned paper tint counts as ink; near-white doesn't.
    expect(inkShare(new Uint8ClampedArray([200, 200, 200, 255, 245, 245, 245, 255]))).toBe(0.5);
  });

  it("reads a text PDF as text when the other pages are blank or only carry a page number", () => {
    expect(pdfPagePlan([{ hasText: true }, { hasText: true }, { hasText: false, ink: 0 }])).toEqual({ kind: "text" });
    expect(pdfPagePlan([{ hasText: true }, { hasText: false, ink: PICTURE_PAGE_INK / 4 }])).toEqual({ kind: "text" });
    expect(pdfPagePlan([])).toEqual({ kind: "text" });
  });

  it("sends every page with something on it as a picture once one page is a scan, leaving blank pages out", () => {
    expect(pdfPagePlan([{ hasText: true }, { hasText: false, ink: 0.3 }, { hasText: false, ink: 0 }, { hasText: true }])).toEqual({ kind: "pages", pages: [0, 1, 3] });
    expect(pdfPagePlan([{ hasText: false, ink: PICTURE_PAGE_INK }])).toEqual({ kind: "pages", pages: [0] });
  });
});
