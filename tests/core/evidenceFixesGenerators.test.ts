import type * as Fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classify, screeningInput, type Decision, type EvidenceRecord } from "../../src/core/evidenceMap";
import { collectCountries } from "../../tools/lifetables/build";

const state = vi.hoisted(() => ({ fixture: undefined as unknown, writes: [] as { path: string; body: string }[], published: "" }));
vi.mock("../../tools/evidence/load", () => ({ ROOT: "/fixture", loadTopic: () => state.fixture }));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof Fs>("node:fs");
  return { ...actual, mkdirSync: vi.fn(), writeFileSync: (path: unknown, body: unknown) => { state.writes.push({ path: String(path), body: String(body) }); state.published = String(body); } };
});

const q = { population: "Adults", intervention: "Biotin", comparison: "No biotin", outcome: "Wrong lab results" };
const record = (pmid: string) => classify({ pmid, title: "Biotin lab results: systematic review", abstract: "A review of laboratory and observational studies.", year: 2026, pubTypes: ["Systematic Review"], mesh: ["Humans"], citedBy: 1 } satisfies EvidenceRecord, [{ id: "labs", title: /lab/i }]);
const r = record("100");
const approval: Decision = { pmid: "100", fits: "yes", reason: "The laboratory question matches.", input: screeningInput(q, r, "any-design"), by: "Fixture model (opus)", at: "2026-10-29" };
function fixture(decisions: Decision[], question = q) {
  return {
    topic: { id: "fixture", nutrientId: "biotin", name: "biotin", terms: ["biotin"], outcomes: [{ id: "labs", label: "Wrong lab results", question: q, anyDesign: true }] },
    raw: { fetchedAt: "2026-10-29", counts: { all: 2 }, queries: {} }, food: false,
    records: [r, record("200")], eligible: () => [r, record("200")], studiesFor: () => [], topicTitle: /biotin/i,
    screening: { by: "Do not attribute retained decisions to this global model", outcomes: { labs: { question, at: "2026-10-29", decisions } } },
  };
}
async function build() {
  // Intentionally execute the CLI module anew: static import would run before each fixture is installed.
  await import("../../tools/evidence/build");
  expect(state.writes).toHaveLength(1);
  return JSON.parse(state.writes[0]!.body);
}

beforeEach(() => {
  vi.resetModules();
  state.writes = [];
  state.published = '{"historical":"prior artifact bytes remain unchanged"}';
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No network allowed in fixtures"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("evidence review: actual offline builder", () => {
  it.each(["missing", "legacy", "changed-question", "changed-abstract", "partial"])("preserves the prior published artifact for %s screening inputs", async (kind) => {
    const decision = kind === "missing" ? [] : kind === "partial" ? [approval] : kind === "legacy" ? [{ pmid: "100", fits: "yes" as const, reason: "Legacy approval." }] : [{ ...approval, input: kind === "changed-question" ? screeningInput({ ...q, population: "Children" }, r, "any-design") : screeningInput(q, { ...r, abstract: "Old abstract." }, "any-design") }];
    state.fixture = kind === "missing" ? { ...fixture([]), screening: undefined } : fixture(decision, kind === "changed-question" ? { ...q, population: "Children" } : q);
    const previous = state.published;
    await expect(build()).rejects.toThrow("eligible reviews need current screening; published map was not replaced");
    expect(state.writes).toEqual([]);
    expect(state.published).toBe(previous);
  });
  it("does not replace any prior bytes when a later outcome remains incomplete", async () => {
    const base = fixture([approval]);
    state.fixture = {
      ...base,
      topic: { ...base.topic, outcomes: [...base.topic.outcomes, { ...base.topic.outcomes[0]!, id: "later" }] },
      eligible: (id: string) => id === "labs" ? [r] : [record("200")],
    };
    const previous = state.published;
    await expect(build()).rejects.toThrow("fixture/later: 1 eligible reviews need current screening");
    expect(state.writes).toEqual([]);
    expect(state.published).toBe(previous);
  });
  it("publishes only current approvals, exact per-decision provenance and any-design rationale without bibliography overlap", async () => {
    const excluded: Decision = { ...approval, pmid: "200", fits: "no", reason: "Different question.", input: screeningInput(q, record("200"), "any-design"), by: "Fixture model (sonnet)" };
    state.fixture = fixture([approval, excluded]);
    const map = await build();
    const outcome = map.outcomes[0];
    expect(outcome.chosenReviews.map((c: { pmid: string }) => c.pmid)).toEqual(["100"]);
    expect(outcome.anyDesign).toBe(true);
    expect(outcome.chosenReviews[0].why).toContain("reviews of any study design");
    expect(outcome.chosenReviews[0].why).not.toContain("of trials on this outcome");
    expect(outcome.screening.by).toBe(`${approval.by}; ${excluded.by}`);
    expect(outcome.screening.decisions).toEqual([approval, excluded]);
    expect(outcome.screening.counts.unscreened).toBe(0);
    expect(outcome).not.toHaveProperty("overlap");
    // No reference-list retrieval or cache publication exists, including empty/partial failure cases.
    expect(fetch).not.toHaveBeenCalled();
    expect(state.writes[0]!.path).toContain("fixture.json");
  });
});

function eurostat(missing = false) {
  const ages = ["Y_LT1", ...Array.from({ length: 94 }, (_, i) => `Y${i + 1}`), "Y_GE95"];
  const years = ["2025", "2024"], sexes = ["F", "M", "T"], indicators = ["SURVIVORS", "LIFEXP"];
  const index = (values: string[]) => Object.fromEntries(values.map((v, i) => [v, i]));
  const value: Record<string, number> = {};
  for (let y = 0; y < years.length; y++) for (let s = 0; s < sexes.length; s++) for (let d = 0; d < 2; d++) for (let a = 0; a < ages.length; a++) {
    if (y === 0 && s === 1 && d === 0 && a === 0 || missing && d === 1 && a === 95) continue;
    value[String(((y * 3 + s) * 2 + d) * 96 + a)] = d === 0 ? 100000 - a * 1000 : 3;
  }
  return { id: ["time", "sex", "indic_de", "age"], size: [2, 3, 2, 96], value, dimension: { time: { category: { index: index(years) } }, sex: { category: { index: index(sexes) } }, indic_de: { category: { index: index(indicators) } }, age: { category: { index: index(ages) } } } };
}

describe("evidence review: life-table publication prerequisites", () => {
  it("keeps every requested country and uses the newest complete year, not the newest partial year", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(eurostat()))) as unknown as typeof fetch;
    const countries = await collectCountries(fetcher, { HU: "Hungary", NL: "Netherlands" });
    expect(Object.keys(countries)).toEqual(["HU", "NL"]);
    for (const country of Object.values(countries)) {
      expect(country.source.period).toEqual({ from: 2024, to: 2024 });
      expect(Object.keys(country.tables)).toEqual(["f", "m", "t"]);
      expect(country.tables.f!.lx).toHaveLength(96);
      expect(country.tables.f!.e95).toBe(3);
    }
  });
  it("rejects a country fetch failure after earlier successes before publication", async () => {
    const publish = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(eurostat()))).mockResolvedValueOnce(new Response("rate limit", { status: 429 }));
    await expect(collectCountries(fetcher as unknown as typeof fetch, { HU: "Hungary", NL: "Netherlands" }).then(publish)).rejects.toThrow("NL: Eurostat request failed (429); existing artifact was not replaced");
    expect(publish).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });
  it("rejects missing life expectancy or incomplete sex tables rather than dropping the country", async () => {
    const publish = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(eurostat(true))));
    await expect(collectCountries(fetcher as unknown as typeof fetch, { HU: "Hungary" }).then(publish)).rejects.toThrow("HU: no complete table; existing artifact was not replaced");
    expect(publish).not.toHaveBeenCalled();
  });
});
