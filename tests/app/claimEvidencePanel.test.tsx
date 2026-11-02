import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import astaxanthin from "../../knowledge/nutrients/astaxanthin.json";
import type { ClaimCheck } from "../../src/core/claimEvidence";
import type { NutrientDef } from "../../src/core/nutrients";
import type { ClaimEvidenceSnapshot } from "../../src/app/claimEvidence";
import type * as ClaimEvidenceModule from "../../src/app/claimEvidence";
import { ClaimEvidencePanel } from "../../src/app/components/ClaimEvidencePanel";

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

describe("critical-result evidence access", () => {
  it("disables every new check but preserves access to the saved evidence sources", () => {
    view.snapshot!.cache.checks = [checked];
    const html = render(true);
    const actions = [...html.matchAll(/<button\b[^>]*aria-label="(?:Recheck|Check evidence):[^>]*>/g)].map((match) => match[0]);
    expect(actions).toHaveLength(n.commonUses!.length);
    for (const action of actions) expect(action).toMatch(/\bdisabled=""/);
    expect(html).toContain("https://pubmed.ncbi.nlm.nih.gov/12345678/");
  });
});
