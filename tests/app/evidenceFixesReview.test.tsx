import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { anyDesignKind, validateEvidenceMap, type EvidenceMapFile, type EvidenceMapOutcome } from "@bt/shared/core/evidenceMap";
import { TOPICS } from "../../tools/evidence/topics";
import participantCorrections from "../fixtures/evidenceFixesTrialCounts.json";
vi.mock("../../apps/web/src/app/components/timeControls", () => ({ useWidth: () => 0 }));
import { EvidenceOutcome } from "../../apps/web/src/app/components/EvidenceMap";

const root = join(import.meta.dirname, "../../knowledge/evidence-maps");
const readMap = (id: string) => JSON.parse(readFileSync(join(root, `${id}.json`), "utf8")) as EvidenceMapFile;
const render = (o: EvidenceMapOutcome, kind: EvidenceMapFile["kind"] = "supplement", name = "biotin") => renderToStaticMarkup(createElement(EvidenceOutcome, { o, kind: kind ?? "supplement", food: anyDesignKind(kind), name, citedTitles: {} }));

describe("evidence review: published provenance and design wording", () => {
  it("removes false large-trial selections and keeps corrected counts and page comparisons consistent", () => {
    const corrections = new Map(participantCorrections.map((r) => [r.pmid, r.participants]));
    for (const t of TOPICS) for (const o of readMap(t.id).outcomes) {
      expect(o.counts.largeTrials, `${t.id}/${o.id}`).toBe(o.largeTrials.length);
      for (const row of [...o.newerLargeTrials, ...o.largeTrials, ...o.page.chosenNotCited]) {
        const corrected = row.pmid ? corrections.get(row.pmid) : undefined;
        if (corrected !== undefined) {
          expect(corrected, `${t.id}/${o.id}/${row.pmid}`).toBeGreaterThanOrEqual(1000);
          expect(row.n).toBe(corrected);
        }
      }
      for (const pmid of o.page.alsoChosen) {
        const corrected = corrections.get(pmid);
        if (corrected !== undefined) expect(corrected).toBeGreaterThanOrEqual(1000);
      }
    }
    for (const [topic, pmid] of [["biotin", "27589059"], ["creatine", "42455839"]]) {
      const map = readMap(topic!);
      const o = map.outcomes.find((o) => topic === "biotin" ? o.id === "multiple-sclerosis" : o.id === "performance-young")!;
      expect(o.counts.largeTrials).toBe(0);
      expect(o.newerLargeTrials).toEqual([]);
      expect(o.largeTrials).toEqual([]);
      expect(o.page.chosenNotCited.some((row) => row.pmid === pmid)).toBe(false);
    }
  });
  it("retains the historical biotin review without presenting laboratory evidence as trial reviews", () => {
    const map = readMap("biotin");
    const o = map.outcomes.find((o) => o.label === "Wrong lab results")!;
    expect(o.chosenReviews.length).toBeGreaterThan(0);
    const html = render(o);
    expect(html).toContain("systematic reviews of any study design about biotin");
    expect(html).toContain("Historical review selections");
    expect(html).toContain("not validated for current inputs");
    expect(html).toContain("individual attribution is unknown");
    expect(html).not.toContain("reviews of biotin trials");
    expect(html).not.toContain("of trials on this outcome");
    expect(html).not.toContain("Trials pooled by each chosen review");
  });
  it("distinguishes pending screening from no answering evidence", () => {
    const prior = readMap("biotin").outcomes[0]!;
    const o: EvidenceMapOutcome = { ...prior, anyDesign: true, chosenReviews: [], screening: { question: prior.screening!.question, provenance: "current", by: "Not yet screened with current inputs", at: "2026-10-30", decisions: [], counts: { yes: 0, partly: 0, no: 0, unscreened: 2 }, left: [] } };
    const html = render(o);
    expect(html).toContain("2 eligible reviews still need screening with current inputs");
    expect(html).not.toContain("No review of trials answers this question");
    expect(html).not.toContain("were about a nearby question");
  });
  it.each(["lifestyle-walking", "wholefood-kiwi", "food-matrix"])("keeps %s historical selections usable with truthful any-design provenance", (id) => {
    const map = readMap(id), o = map.outcomes.find((o) => o.chosenReviews.length > 0)!;
    expect(o).toBeDefined();
    const html = render(o, map.kind, map.name);
    expect(html).toContain("Historical review selections");
    expect(html).toContain("not validated for current inputs");
    expect(html).not.toContain("of trials on this outcome");
  });
  it("keeps individual model names visible for mixed current decisions", () => {
    const prior = readMap("biotin").outcomes[0]!;
    const o: EvidenceMapOutcome = { ...prior, chosenReviews: [], screening: { question: prior.screening!.question, provenance: "current", by: "Opus; Sonnet", at: "2026-10-30", decisions: [{ pmid: "100", fits: "no", reason: "Different outcome.", input: "recorded fixture input", by: "Opus", at: "2026-10-29" }, { pmid: "200", fits: "partly", reason: "Different population.", input: "recorded fixture input", by: "Sonnet", at: "2026-10-30" }], counts: { yes: 0, partly: 1, no: 1, unscreened: 0 }, left: [] } };
    const html = render(o);
    expect(html).toContain("PMID 100: no");
    expect(html).toContain("Opus (2026-10-29)");
    expect(html).toContain("PMID 200: partly");
    expect(html).toContain("Sonnet (2026-10-30)");
  });
  it("corrects the deterministic title-declared classification while retaining the actual historical creatine choice", () => {
    const map = readMap("creatine");
    const choice = map.outcomes.flatMap((o) => o.chosenReviews).find((c) => c.pmid === "39070254")!;
    expect(choice).toBeDefined();
    expect(choice.why).toContain("newest meta-analyses");
  });
  it("labels every shipped outcome's actual eligibility mode and every retained screening as legacy", () => {
    const files = readdirSync(root).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(TOPICS.length);
    for (const t of TOPICS) {
      const map = readMap(t.id);
      expect(validateEvidenceMap(map), t.id).toEqual([]);
      for (const o of map.outcomes) {
        const def = t.outcomes.find((x) => x.id === o.id)!;
        expect(o.anyDesign, `${t.id}/${o.id}`).toBe(anyDesignKind(t.kind) || !!def.anyDesign);
        expect(o).not.toHaveProperty("overlap");
        if (o.screening) expect(o.screening.provenance).toBe("legacy-inputs-unverified");
        if (o.anyDesign) for (const c of o.chosenReviews) expect(c.why).not.toContain("of trials on this outcome");
      }
      const historical = JSON.parse(readFileSync(join(root, "screening", `${t.id}.json`), "utf8"));
      expect(historical.provenance).toBe("legacy-inputs-unverified");
      // No invented current-input fingerprints are added to the retained historical decisions.
      for (const outcome of Object.values(historical.outcomes) as { decisions: { input?: string }[] }[]) for (const decision of outcome.decisions) expect(decision.input).toBeUndefined();
    }
  });
});
