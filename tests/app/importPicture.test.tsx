import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BrainSettings } from "../../apps/web/src/app/brain/menus";

const state = vi.hoisted(() => ({ settings: undefined as unknown, fresh: true }));
vi.mock("../../apps/web/src/app/brain/menus", async (original) => ({
  ...await original<typeof import("../../apps/web/src/app/brain/menus")>(),
  useBrainSettings: () => ({ settings: state.settings, fresh: state.fresh, reload: () => {} }),
}));
vi.mock("../../apps/web/src/app/brain/store", () => ({ readWithBrain: vi.fn() }));
vi.mock("../../apps/web/src/app/hooks", () => ({ useProfile: () => ({}), useAllMeasurements: () => [] }));
import { SendPicture } from "../../apps/web/src/app/pages/ImportPage";

const settings = (provider: string, model: string, ok = true, reason?: string): BrainSettings => ({
  configs: {}, hasKey: {}, installed: {}, assistant: { provider, model } as BrainSettings["assistant"], ready: { ok, ...(reason ? { reason } : {}) },
});
const photo = { file: new File(["x"], "report.jpg", { type: "image/jpeg" }) };
const render = (picture: { file: File; pages?: { mediaType: "image/jpeg"; data: string }[] } = photo) =>
  renderToStaticMarkup(createElement(SendPicture, { picture, onSend: () => {}, onCancel: () => {} }));

describe("asking before a photo or scan goes to Brain", () => {
  it("names the model, says it sees names and ID numbers, and waits for Send", () => {
    state.settings = settings("claude-code", "opus");
    const html = render();
    expect(html).toContain("Send to Brain to read?");
    expect(html).toContain("report.jpg");
    expect(html).toContain("Claude Code");
    expect(html).toContain("keeps data according to your own login");
    expect(html).toMatch(/name, birth date and ID numbers/);
    expect(html).toContain("Send to Brain");
    expect(html).toContain("Cancel");
  });

  it("counts a scanned PDF's pages", () => {
    state.settings = settings("anthropic", "claude-opus-5-5");
    const page = { mediaType: "image/jpeg" as const, data: "UEFHRQ==" };
    const html = render({ file: new File(["%PDF"], "scan.pdf"), pages: [page, page] });
    expect(html).toContain("scan.pdf (2 scanned pages)");
    expect(html).not.toContain("your own login");
  });

  it("offers setting up a model or typing the values in when no model is ready, with no Send button", () => {
    state.settings = settings("anthropic", "claude-opus-5-5", false, "Add an API key first.");
    const html = render();
    expect(html).toContain("Set up a model to read photos and scans");
    expect(html).toContain("Add an API key first.");
    expect(html).toContain("Type the values in");
    expect(html).not.toContain("Send to Brain");
  });

  it("explains that photos need the local server when the page runs on its own", () => {
    state.settings = null;
    const html = render();
    expect(html).toContain("isn&#x27;t running");
    expect(html).toContain("Type the values in");
    expect(html).not.toContain("Send to Brain");
  });

  it("refuses up front for agent programs that can't be given pictures", () => {
    state.settings = settings("openclaw", "default");
    const html = render();
    expect(html).toContain("can&#x27;t read pictures");
    expect(html).not.toContain("Send to Brain");
  });
});
