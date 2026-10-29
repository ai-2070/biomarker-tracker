import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { ask, studyIdsIn, systemPrompt } from "../../server/assistant";
import { biologicalAge, healthTools, levers, markerDetail, parseSnapshot, resultsOverview, type HealthSnapshot } from "../../server/healthTools";
import { findMarker } from "../../server/knowledge";
import { toolStep } from "../../server/steps";
import type { Measurement } from "../../src/core/types";

const m = (id: string, biomarkerId: string, date: string, value: number, extra: Partial<Measurement> = {}): Measurement => ({
  id, biomarkerId, date, value, originalValue: value, originalUnit: "x", source: "manual", ...extra,
});
const panel = (d: string) =>
  Object.entries({ albumin: 46, creatinine: 78, glucose: 5.1, crp_hs: 0.8, lymphocyte_pct: 32, mcv: 89, rdw: 12.8, alp: 64, wbc: 5.6 }).map(([b, v], i) => m(`${d}-${i}`, b, d, v));

const snapshot: HealthSnapshot = {
  measurements: [m("f1", "ferritin", "2024-01-10", 11), m("f2", "ferritin", "2024-05-12", 14), m("k1", "potassium", "2024-05-12", 6.6), ...panel("2024-05-12")],
  protocols: [{ id: "p", label: "Warfarin (as prescribed)", category: "medication", start: "2024-01-01" }],
  experiments: [],
  profile: { sex: "f", birthMonth: "1984-04" },
};

describe("health tools", () => {
  it("validates the snapshot like a backup file", () => {
    expect(parseSnapshot({ measurements: [m("a", "ferritin", "2024-01-01", 10)] }).ok).toBe(true);
    expect(parseSnapshot({ measurements: [{ id: "broken" }] }).ok).toBe(false);
  });

  it("lists results and points out critical ones", () => {
    const o = resultsOverview(snapshot);
    expect(o.critical).toEqual(["Potassium"]);
    expect(o.markers.find((x) => x.marker === "ferritin")).toMatchObject({ flag: "low", latest: "14 µg/L" });
  });

  it("finds markers by alias", () => {
    expect(findMarker("Kalium")?.id).toBe("potassium");
    expect(findMarker("LDL-C")?.id).toBe("ldl");
    expect(findMarker("nonsense")).toBeUndefined();
  });

  it("gives computed trends and normal variation for a marker", () => {
    const d = markerDetail(snapshot, findMarker("ferritin")!);
    expect(d.results).toHaveLength(2);
    expect(d.trend?.changeSincePrevious).toBe(3);
    expect(d.normalVariation).toMatchObject({ withinPersonCV: "12.9%" });
    expect(d.sources[0]!.id).toMatch(/^PMID:/);
  });

  it("applies the log's safety filters to levers", () => {
    const l = levers(snapshot, findMarker("ferritin")!);
    expect(l.safetyNotes[0]).toMatch(/Blood thinner/);
    const vitC = l.levers.find((x) => x.lever.startsWith("Vitamin C"))!;
    expect(vitC.foods!.hidden.join(" ")).toMatch(/vitamin K/);
    expect(vitC.foods!.note).toMatch(/~150 measured compounds/);
  });

  it("computes biological age from birth month without returning the birth month", () => {
    const b = biologicalAge(snapshot);
    expect(b.draws[0]).toMatchObject({ date: "2024-05-12", status: "ok" });
    expect(JSON.stringify(b)).not.toContain("1984-04");
  });

  it("searches research with only topic words, through the given fetch", async () => {
    const urls: string[] = [];
    const fixture = readFileSync(join(import.meta.dirname, "..", "fixtures", "research", "europepmc-ferritin-reviews.json"), "utf8");
    const fakeFetch = (async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response(fixture, { status: 200 });
    }) as typeof fetch;
    const tools = healthTools(snapshot, fakeFetch);
    const out = (await tools.search_research!.execute!({ terms: ["ferritin"], topic: "pregnancy" }, { toolCallId: "t", messages: [] } as never)) as { studies: { id: string }[] };
    expect(out.studies.length).toBe(3);
    expect(urls[0]).toMatch(/^https:\/\/www\.ebi\.ac\.uk\//);
    expect(decodeURIComponent(urls[0]!)).not.toMatch(/1984|Warfarin/);
  });
});

describe("protocols", () => {
  it("gives Brain the person's protocols, linked to nutrients, with interactions between items", async () => {
    const plan = {
      id: "pl",
      name: "Stack",
      createdAt: "2026-10-01T00:00:00.000Z",
      items: [
        { id: "a", label: "Iron bisglycinate", amount: "25 mg", category: "supplement" as const, when: "with meals" as const },
        { id: "b", label: "Calcium", category: "supplement" as const, when: "with meals" as const },
      ],
    };
    const parsed = parseSnapshot({ ...snapshot, plans: [plan] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = (await healthTools(parsed.snapshot).get_protocols!.execute!({}, { toolCallId: "t", messages: [] } as never)) as { protocols: { items: { nutrient?: string; amountTheyWrote?: string }[]; interactionsBetweenItems: unknown[] }[] };
    expect(out.protocols[0]!.items[0]).toMatchObject({ nutrient: "Iron", amountTheyWrote: "25 mg" });
    expect(out.protocols[0]!.interactionsBetweenItems.length).toBeGreaterThan(0);
    expect(parseSnapshot({ ...snapshot, plans: [{ ...plan, name: "" }] }).ok).toBe(false);
  });
});

describe("habit suggestions", () => {
  const call = (snap: HealthSnapshot, input: unknown) => healthTools(snap).propose_habit!.execute!(input as never, { toolCallId: "t", messages: [] } as never) as Promise<Record<string, unknown>>;
  const calm: HealthSnapshot = { ...snapshot, measurements: snapshot.measurements.filter((x) => x.biomarkerId !== "potassium") };

  it("shows a card for a habit the person asked for, without saving anything", async () => {
    const r = await call(calm, { label: "Oats for breakfast", category: "diet", watchMarkers: ["LDL-C"], reason: "You asked to track this." });
    expect(r.shownToPerson).toMatchObject({ label: "Oats for breakfast", markerIds: ["ldl"] });
    expect(String(r.note)).toMatch(/Nothing is saved/);
  });
  it("refuses medicines, doses, and anything next to a critical result", async () => {
    expect((await call(calm, { label: "Statin", category: "medication", reason: "x" })).error).toMatch(/Medicines/);
    expect((await call(calm, { label: "Vitamin D 4000 IU", category: "supplement", reason: "x" })).error).toMatch(/amounts/);
    expect((await call(snapshot, { label: "Walk after dinner", category: "lifestyle", reason: "x" })).error).toMatch(/critical/);
  });
  it("keeps the whole suggestion in the step, so the page can build the card", () => {
    const long = { label: "Walk after dinner", category: "lifestyle", reason: "r".repeat(280) };
    expect(JSON.parse(toolStep("propose_habit", long).input)).toEqual(long);
    expect(toolStep("get_marker", { marker: "x".repeat(300) }).input.length).toBe(200);
  });
});

describe("assistant", () => {
  it("puts critical values and caution in the instructions", () => {
    const p = systemPrompt({ skills: "- a: A. Do A.", cautious: true, critical: ["Potassium"], mcpServers: [{ id: "pubmed", name: "PubMed and Europe PMC", about: "Search PubMed." }] });
    expect(p).toMatch(/CRITICAL: .*Potassium/);
    expect(p).toMatch(/Don't suggest increasing any nutrient/);
    expect(p).toMatch(/read_skill/);
    expect(p).toMatch(/- pubmed: PubMed and Europe PMC/);
    expect(p).toMatch(/research_tools/);
  });

  it("collects every study ID that a tool returned", () => {
    expect(studyIdsIn({ studies: [{ id: "PMID:123456" }, { pmid: "7654321" }], text: "see PMCID:PMC99999" }).sort()).toEqual(["PMCID:PMC99999", "PMID:123456", "PMID:7654321"]);
  });

  it("runs a tool and returns the answer, the steps and the citable IDs", async () => {
    let call = 0;
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        call++;
        if (call === 1) {
          return {
            content: [{ type: "tool-call", toolCallId: "c1", toolName: "get_marker", input: JSON.stringify({ marker: "ferritin" }) }],
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
            warnings: [],
          };
        }
        return { content: [{ type: "text", text: "Your ferritin is low [PMID:33285139]." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    });
    const r = await ask([{ role: "user", content: "Is my ferritin ok?" }], snapshot, { ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe("Your ferritin is low [PMID:33285139].");
    expect(r.steps).toEqual([{ tool: "get_marker", input: '{"marker":"ferritin"}' }]);
    // The marker's own sources came back from the tool, so they may be cited.
    expect(r.studyIds).toContain("PMID:33285139");
  });

  it("sends a photo to the model as an image, with the rules for photos", async () => {
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
    let prompt: unknown;
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        prompt = opts.prompt;
        return { content: [{ type: "text", text: "I can see a person standing." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      },
    });
    const r = await ask([{ role: "user", content: "What do you see?", images: [{ mediaType: "image/jpeg", data: "AAAA" }] }], snapshot, {
      ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } },
    });
    expect(r.ok).toBe(true);
    const msgs = prompt as { role: string; content: unknown }[];
    expect(JSON.stringify(msgs.find((m) => m.role === "system"))).toMatch(/Never estimate weight, body fat/);
    const user = msgs.find((m) => m.role === "user") as { content: { type: string }[] };
    expect(user.content.map((p) => p.type)).toEqual(["text", "file"]);
  });

  it("explains model errors without leaking keys", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw Object.assign(new Error("bad key sk-abcdefghijklmnop"), { statusCode: 401 });
      },
    });
    const r = await ask([{ role: "user", content: "hi" }], snapshot, { ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } } });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/API key was rejected/) });
  });
});
