import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SegmentTabs } from "../../apps/web/src/app/components/SegmentTabs";

// Keys and focus (arrow keys, Home/End, one tab in the Tab order) come from Base UI after the page
// is interactive, so they were checked in a browser; this checks the structure.
const render = (value: "a" | "b" | "c", header?: string) =>
  renderToStaticMarkup(
    createElement(SegmentTabs<"a" | "b" | "c">, {
      label: "Topic",
      tabs: [
        { value: "a", label: "First" },
        { value: "b", label: "Second" },
        { value: "c", label: "Third" },
      ],
      value,
      onChange: () => undefined,
      ...(header ? { header: createElement("h3", null, header) } : {}),
      children: createElement("p", null, `Shown for ${value}`),
    }),
  );

describe("SegmentTabs", () => {
  it("is a named tab list with exactly the chosen tab selected", () => {
    const html = render("b");
    expect(html).toMatch(/role="tablist" aria-label="Topic"/);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)</g)];
    expect(tabs.map((m) => m[1])).toEqual(["First", "Second", "Third"]);
    expect(tabs.map((m) => m[0].includes('aria-selected="true"'))).toEqual([false, true, false]);
  });

  it("shows the chosen tab's content in a tab panel after the list", () => {
    const html = render("c");
    expect(html).toMatch(/role="tablist"[\s\S]*role="tabpanel"[^>]*><p>Shown for c<\/p>/);
  });

  it("puts a header on the same row as the tabs, before them", () => {
    const html = render("a", "Norms by age");
    expect(html).toMatch(/<div class="flex flex-wrap items-center justify-between gap-2"><h3>Norms by age<\/h3><div[^>]*role="tablist"/);
    expect(render("a")).not.toContain("<h3>");
  });
});
