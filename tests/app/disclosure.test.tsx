import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Fold, More, reveal } from "../../apps/web/src/app/components/disclosure";

// Opening with the mouse and keys, and jumping into a closed fold, were checked in a browser;
// these check what doesn't need one.
describe("More and Fold", () => {
  // On the server the panel is plain `hidden`; Base UI makes it hidden="until-found" in the browser.
  it("keep closed content in the page, so find-in-page and in-page links can reach it", () => {
    for (const html of [
      renderToStaticMarkup(createElement(More, { summary: "Sources", children: createElement("p", null, "A closed source") })),
      renderToStaticMarkup(createElement(Fold, { title: "Section", children: createElement("p", null, "A closed section") })),
    ]) {
      expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
      expect(html).toMatch(/hidden=""[^>]*>[\s\S]*A closed/);
    }
  });

  it("open by default when asked, with the label as the button's text", () => {
    const html = renderToStaticMarkup(createElement(More, { summary: "Show as a table", defaultOpen: true, children: "rows" }));
    expect(html).toMatch(/aria-expanded="true"[^>]*>[\s\S]*Show as a table/);
    expect(html).not.toMatch(/\shidden=/);
  });

  it("boxed: a bordered box with the chevron after the label", () => {
    const html = renderToStaticMarkup(createElement(More, { summary: "More details (optional)", boxed: true, children: "fields" }));
    expect(html).toMatch(/^<div[^>]*class="rounded-lg border border-line"/);
    expect(html).toMatch(/More details \(optional\)<\/span><svg/);
  });
});

describe("reveal", () => {
  it("shows and opens every closed panel around an element, like the browser's find-in-page", () => {
    const events: string[] = [];
    const node = (name: string, hidden: string | null, parentElement: unknown) => {
      const attrs = new Map(hidden ? [["hidden", hidden]] : []);
      return {
        parentElement,
        getAttribute: (a: string) => attrs.get(a) ?? null,
        removeAttribute: (a: string) => void attrs.delete(a),
        dispatchEvent: (e: Event) => {
          events.push(`${name}:${e.type}`);
          return true;
        },
        attrs,
      };
    };
    const outer = node("outer", "until-found", null);
    const plain = node("plain", null, outer);
    const inner = node("inner", "until-found", plain);
    const target = node("target", null, inner);
    reveal(target as unknown as Element);
    expect(events).toEqual(["inner:beforematch", "outer:beforematch"]);
    expect(inner.attrs.has("hidden")).toBe(false);
    expect(outer.attrs.has("hidden")).toBe(false);
  });
});
