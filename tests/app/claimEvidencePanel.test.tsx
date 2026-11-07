import { type ClaimCheck, type ClaimDepth, claimSearchQuery } from "@bt/shared/core/claimEvidence";
import type { NutrientDef } from "@bt/shared/core/nutrients";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClaimEvidenceModule from "../../apps/web/src/app/claimEvidence";
import type { ClaimEvidenceSnapshot } from "../../apps/web/src/app/claimEvidence";
import { ClaimEvidencePanel } from "../../apps/web/src/app/components/ClaimEvidencePanel";
import { formatDate } from "../../apps/web/src/app/format";
import astaxanthin from "../../knowledge/nutrients/astaxanthin.json";

const { view, checkRequest } = vi.hoisted(() => ({ view: { snapshot: undefined as ClaimEvidenceSnapshot | undefined }, checkRequest: vi.fn() }));
vi.mock("../../apps/web/src/app/api", () => ({ useServerStatus: () => null }));
vi.mock("../../apps/web/src/app/claimEvidence", async (importOriginal) => ({
  ...(await importOriginal<typeof ClaimEvidenceModule>()),
  useClaimEvidence: () => view.snapshot,
  checkClaimEvidence: checkRequest,
}));
const n = astaxanthin as unknown as NutrientDef;
const guide = n.simpleGuide!;
const claim = n.commonUses![0]!;
const checked: ClaimCheck = {
  nutrientId: n.id,
  claim,
  topic: guide.claimTopics![claim]!,
  version: 1,
  checkedAt: "2026-10-30T10:00:00.000Z",
  model: "actual-serving-model",
  verdict: "mixed",
  grade: "low",
  summary: "The small studies have mixed findings [PMID:12345678].",
  limitations: "The studies were short and leave uncertainty.",
  citations: ["PMID:12345678"],
};
function auditedCheck(depth: ClaimDepth): ClaimCheck {
  const plan = { intervention: "test intervention", outcome: "test outcome", interventionSynonyms: [], outcomeSynonyms: [], route: "any" as const };
  return {
    ...checked,
    version: 2,
    research: {
      depth,
      status: "evidence_found",
      plan,
      retrieved: 1,
      screened: 1,
      included: 1,
      records: [{ id: "PMID:12345678", title: "Synthetic human trial" }],
      screening: [
        {
          id: "PMID:12345678",
          decision: "direct",
          reason: "Synthetic matching intervention and outcome.",
          route: "oral",
          formulation: "alone",
          evidence: "human_trial",
        },
      ],
      queries: (["reviews", "trials", "broad"] as const).map((rung) => ({
        rung,
        query: claimSearchQuery(plan, rung),
        source: "europepmc",
        sort: "relevance",
        resultCount: 1,
        ids: ["PMID:12345678"],
      })),
    },
  };
}
const render = (critical = false) => renderToStaticMarkup(createElement(ClaimEvidencePanel, { n, guide, critical }));
beforeEach(() => {
  checkRequest.mockReset();
  view.snapshot = { cache: { version: 1, checks: [], customTopics: [], updates: [] }, identity: { loaded: null, browser: "{}", epoch: 0 }, damaged: false };
});

describe("critical-result evidence access", () => {
  it("makes the latest date primary, summarizes the previous deep result and flags its changed grade", () => {
    const previous = { ...auditedCheck("deep"), checkedAt: "2026-11-02T10:00:00.000Z" };
    const current = { ...auditedCheck("quick"), checkedAt: "2026-12-02T10:00:00.000Z", grade: "moderate" as const };
    view.snapshot!.cache.checks = [current];
    view.snapshot!.cache.history = [previous];
    const html = render();
    expect(html).toContain(`Last checked <time dateTime="${current.checkedAt}">${formatDate("2026-12-02")}</time>`);
    expect(html).toContain(`Previous: <time dateTime="${previous.checkedAt}">${formatDate("2026-11-02")}</time> (deep, Low)`);
    expect(html).toContain("Was Low, now Moderate");
    expect(html).toContain("Check history (1)");
    expect(html).toContain("1 retrieved · 1 screened · 1 included");
    expect(html).toContain("Rerun deeper check");
    expect(html).toContain("Grade changes may reflect new evidence, search coverage or model assessment.");
  });
  it("sorts older checks newest first and does not flag an unchanged grade", () => {
    view.snapshot!.cache.checks = [{ ...auditedCheck("quick"), checkedAt: "2026-12-02T10:00:00.000Z" }];
    view.snapshot!.cache.history = [
      { ...auditedCheck("deep"), checkedAt: "2026-10-02T10:00:00.000Z" },
      { ...auditedCheck("quick"), checkedAt: "2026-11-02T10:00:00.000Z" },
    ];
    const html = render();
    expect(html).toContain(`Previous: <time dateTime="2026-11-02T10:00:00.000Z">${formatDate("2026-11-02")}</time> (quick, Low)`);
    expect(html).toContain("Check history (2)");
    expect(html).not.toContain("Was Low, now");
  });
  it("does not compare or expose history from another claim", () => {
    view.snapshot!.cache.checks = [auditedCheck("quick")];
    view.snapshot!.cache.history = [{ ...auditedCheck("deep"), topic: "another outcome", grade: "high" }];
    const html = render();
    expect(html).not.toContain("Previous:");
    expect(html).not.toContain("Check history (");
    expect(html).not.toContain("Was High");
    expect(html).toContain('aria-label="Run deeper check:');
  });
  it.each(["quick", "deep"] as const)("shows the saved %s budget and model in its footer, with the matching deep action", (depth) => {
    view.snapshot!.cache.checks = [auditedCheck(depth)];
    const html = render();
    const footer = /<footer\b[^>]*>([\s\S]*?)<\/footer>/.exec(html)?.[1];
    expect(footer).toContain("Model: actual-serving-model");
    expect(footer).toContain(`Budget: ${depth === "deep" ? "Deep" : "Quick"}`);
    expect(html).toContain(`aria-label="${depth === "deep" ? "Rerun" : "Run"} deeper check:`);
  });
  it("shows legacy uncertainty without inventing retrieval counts and offers deeper checks", () => {
    view.snapshot!.cache.checks = [
      { ...checked, verdict: "not enough evidence", grade: null, citations: [], summary: "The legacy quick check did not establish direct evidence." },
    ];
    const html = render();
    expect(html).toContain("Quick check: no direct trials found");
    expect(html).toContain("search coverage unverified");
    expect(html).toContain("Run deeper check");
    expect(html).toContain("provider, model and reasoning effort selected in Settings");
    expect(html).not.toContain("Deeper-check model (optional)");
    expect(html).not.toContain("No evidence grade");
    expect(html).not.toContain("0 retrieved");
    expect(html).toContain("Budget: Unknown (legacy check)");
  });
  it("keeps the completed deep action after a failed quick retry, with both runs' own footers", () => {
    view.snapshot!.cache.checks = [auditedCheck("deep")];
    view.snapshot!.cache.attempts = [
      {
        ...auditedCheck("quick"),
        model: "retry-serving-model",
        verdict: "not enough evidence",
        grade: null,
        citations: [],
        research: { ...auditedCheck("quick").research!, status: "search_failed", error: "Search timed out." },
      },
    ];
    const html = render();
    expect(html).toContain("Rerun deeper check");
    const footers = [...html.matchAll(/<footer\b[^>]*>([\s\S]*?)<\/footer>/g)].map((match) => match[1]);
    expect(footers[0]).toContain("Model: retry-serving-model");
    expect(footers[0]).toContain("Budget: Quick");
    expect(footers[1]).toContain("Model: actual-serving-model");
    expect(footers[1]).toContain("Budget: Deep");
  });
  it("shows failed searches, exact screening counts and the previous saved assessment separately", () => {
    view.snapshot!.cache.checks = [checked];
    view.snapshot!.cache.attempts = [
      {
        ...checked,
        version: 2,
        verdict: "not enough evidence",
        grade: null,
        citations: [],
        research: {
          depth: "quick",
          status: "search_failed",
          records: [],
          screening: [],
          queries: [
            { rung: "reviews", query: "synthetic public query", source: "europepmc", sort: "relevance", resultCount: null, ids: [], error: "Search timed out" },
          ],
          retrieved: 0,
          screened: 0,
          included: 0,
          error: "Search failed, retry.",
        },
      },
    ];
    const html = render();
    expect(html).toContain("Search failed, retry");
    expect(html).toContain("0 retrieved · 0 screened · 0 included");
    expect(html).toContain("Previous saved assessment");
    expect(html).toContain("synthetic public query");
    expect(html).not.toContain(">No evidence found</span>");
  });
  it("disables every new check but preserves access to the saved evidence sources", () => {
    view.snapshot!.cache.checks = [checked];
    const html = render(true);
    const actions = [...html.matchAll(/<button\b[^>]*aria-label="(?:Rerun quick check|Check evidence):[^>]*>/g)].map((match) => match[0]);
    expect(actions).toHaveLength(n.commonUses!.length);
    for (const action of actions) expect(action).toMatch(/\bdisabled=""/);
    expect(html).toContain("https://pubmed.ncbi.nlm.nih.gov/12345678/");
  });
});
