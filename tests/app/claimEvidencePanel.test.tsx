import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import astaxanthin from "../../knowledge/nutrients/astaxanthin.json";
import type { ClaimCheck } from "../../src/core/claimEvidence";
import type { NutrientDef } from "../../src/core/nutrients";
import type { ClaimEvidenceSnapshot } from "../../src/app/claimEvidence";
import type * as ClaimEvidenceModule from "../../src/app/claimEvidence";
import { ClaimEvidencePanel } from "../../src/app/components/ClaimEvidencePanel";
import { SupplementGuide } from "../../src/app/components/SupplementGuide";

const { view, checkRequest } = vi.hoisted(() => ({ view: { snapshot: undefined as ClaimEvidenceSnapshot | undefined }, checkRequest: vi.fn() }));
vi.mock("../../src/app/api", () => ({ useServerStatus: () => null }));
vi.mock("../../src/app/claimEvidence", async (importOriginal) => ({ ...await importOriginal<typeof ClaimEvidenceModule>(), useClaimEvidence: () => view.snapshot, checkClaimEvidence: checkRequest }));
const n = astaxanthin as unknown as NutrientDef;
const guide = n.simpleGuide!;
const claim = n.commonUses![0]!;
const checked: ClaimCheck = { nutrientId: n.id, claim, topic: guide.claimTopics![claim]!, version: 1, checkedAt: "2026-10-30T10:00:00.000Z", model: "actual-serving-model", verdict: "mixed", grade: "low", summary: "The small studies have mixed findings [PMID:12345678].", limitations: "The studies were short and leave uncertainty.", citations: ["PMID:12345678"] };
const render = (critical = false) => renderToStaticMarkup(createElement(ClaimEvidencePanel, { n, guide, critical }));
beforeEach(() => {
  checkRequest.mockReset();
  view.snapshot = { cache: { version: 1, checks: [], customTopics: [], updates: [] }, identity: { loaded: null, browser: "{}", epoch: 0 }, damaged: false };
});

describe("layered Astaxanthin claim panel", () => {
  it("shows unchecked claims and a labelled custom topic without automatic AI", () => {
    const html = render();
    expect(html.match(/Not checked yet/g)).toHaveLength(n.commonUses!.length);
    expect(html).toContain("Check something else");
    expect(html).toContain("Do not include your name, results or medical history");
    expect(html).toContain("New checks need the local server");
    expect(html).not.toContain("High evidence");
    expect(checkRequest).not.toHaveBeenCalled();
  });

  it("shows the saved actual model, independent date, expandable summary, sources and candidate signal", () => {
    view.snapshot!.cache.checks = [checked];
    view.snapshot!.cache.updates = [{ request: checked, forCheckedAt: checked.checkedAt, attemptedAt: "2026-10-31T12:00:00.000Z", result: { count: 2, checkedAt: "2026-10-31T12:00:00.000Z", since: checked.checkedAt, query: "astaxanthin public claim" } }];
    const html = render();
    expect(html).toContain("Mixed findings");
    expect(html).toContain("actual-serving-model");
    expect(html).toContain("https://pubmed.ncbi.nlm.nih.gov/12345678/");
    expect(html).toContain("2 matching newer records");
    expect(html).toContain("discovery signals, not verified human evidence or changed verdicts");
    expect(html).toContain("Recheck");
    expect(checkRequest).not.toHaveBeenCalled();
  });
  it("does not offer a newer-record search before its date window exists", () => {
    view.snapshot!.cache.checks = [checked];
    view.snapshot!.cache.updates = [{ request: checked, forCheckedAt: checked.checkedAt, attemptedAt: checked.checkedAt, result: { count: 0, checkedAt: checked.checkedAt, since: checked.checkedAt, query: "a future date window" } }];
    const html = render();
    expect(html).not.toContain("pubmed.ncbi.nlm.nih.gov/?term=");
    expect(html).not.toContain("No matching newer records");
    expect(html).toContain("actual-serving-model");
  });


  it("never represents an ungraded missing-evidence result as a confident negative", () => {
    view.snapshot!.cache.checks = [{ ...checked, verdict: "not enough evidence", grade: null, citations: [], summary: "No answering human evidence was found." }];
    const html = render();
    expect(html).toContain("Not enough evidence");
    expect(html).toContain("No evidence grade");
    expect(html).toContain("not strong evidence against the claim");
    expect(html).not.toContain("High evidence");
    expect(html).not.toContain("Not supported");
  });

  it("displays a failed metadata lookup as unknown while keeping the previous verdict", () => {
    view.snapshot!.cache.checks = [checked];
    view.snapshot!.cache.updates = [{ request: checked, forCheckedAt: checked.checkedAt, attemptedAt: "2026-10-31T12:00:00.000Z", error: "offline" }];
    const html = render();
    expect(html).toContain("New-record signal unknown");
    expect(html).toContain("Mixed findings");
    expect(html).not.toContain("No matching newer records");
  });

  it("keeps saved evidence readable, but disables checks beside a critical result", () => {
    view.snapshot!.cache.checks = [checked];
    const html = render(true);
    expect(html).toContain("Contact a doctor about the critical result first");
    expect(html).toContain("actual-serving-model");
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(n.commonUses!.length + 1);
    expect(checkRequest).not.toHaveBeenCalled();
  });

  it("keeps the requested reading order, folds forms and sources into safety, and ends with real research search", () => {
    const html = renderToStaticMarkup(createElement(SupplementGuide, { n, guide, critical: false, reference: createElement("h3", null, "Reference intakes and upper limit") }));
    const headings = ["What it is", "Where it comes from", "Roles in your body", "Potential benefits &amp; common claims", "Too little", "Too much", "Dosage &amp; safety", "Reference intakes and upper limit", "Supplement forms &amp; label checks", "Ingredient &amp; safety sources", ">Research<"];
    const positions = headings.map((heading) => html.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain(n.low.note);
    expect(html).toContain("Search studies");
    expect(html).not.toContain("How the evidence was found");
    expect(html).not.toContain("evidence-map");
  });
});
