import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, todayIso } from "@bt/shared/core/dates";
import type { Measurement, ProtocolEntry } from "@bt/shared/core/types";
import { describe, expect, it } from "vitest";
import { ask, dataPack, studyIdsIn } from "../../apps/server/assistant";
import {
  biologicalAge,
  type HealthSnapshot,
  healthTools,
  levers,
  markerDetail,
  parseSnapshot,
  resultsOverview,
  safetyOf,
  type testSummaryFor,
} from "../../apps/server/healthTools";
import { findMarker } from "../../apps/server/knowledge";
import { toolStep } from "../../apps/server/steps";
import { withVariation } from "../helpers";
import { MockModel } from "./mockModel";

const m = (id: string, biomarkerId: string, date: string, value: number, extra: Partial<Measurement> = {}): Measurement => ({
  id,
  biomarkerId,
  date,
  value,
  originalValue: value,
  originalUnit: "x",
  source: "manual",
  ...extra,
});
const panel = (d: string) =>
  Object.entries({ albumin: 46, creatinine: 78, glucose: 5.1, crp_hs: 0.8, lymphocyte_pct: 32, mcv: 89, rdw: 12.8, alp: 64, wbc: 5.6 }).map(([b, v], i) =>
    m(`${d}-${i}`, b, d, v),
  );

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

  it("gives the app's test summary: critical first, explanations from the marker files, doctor questions", async () => {
    const out = (await healthTools(snapshot).get_test_summary!.execute!({}, { toolCallId: "t", messages: [] } as never)) as ReturnType<
      typeof testSummaryFor
    > & { critical: { name: string }[] };
    expect(out).toMatchObject({ date: "2024-05-12", otherTestDates: ["2024-01-10"] });
    expect(out.critical.map((c) => c.name)).toEqual(["Potassium"]);
    expect(out).toHaveProperty("criticalNote");
    const ferritin = (out as { outsideRange: { results: { marker: string; whatItUsuallyMeans?: string; outsideOnTestsInARow?: number }[] }[] }).outsideRange
      .flatMap((g) => g.results)
      .find((x) => x.marker === "ferritin")!;
    expect(ferritin.whatItUsuallyMeans).toBe(findMarker("ferritin")!.low.meaning);
    expect(ferritin.outsideOnTestsInARow).toBe(2);
    expect((out as { questionsForTheDoctor: string[] }).questionsForTheDoctor.at(-1)).toMatch(/next test/);
    const earlier = (await healthTools(snapshot).get_test_summary!.execute!({ date: "2024-01-10" }, { toolCallId: "t", messages: [] } as never)) as {
      date: string;
    };
    expect(earlier.date).toBe("2024-01-10");
    expect(JSON.parse(dataPack(snapshot)).latestTestSummary.date).toBe("2024-05-12");
  });

  it("gives the app's year summary, saying when there are too few tests for a trend", async () => {
    const out = (await healthTools(snapshot).get_year_summary!.execute!({ year: 2024 }, { toolCallId: "t", messages: [] } as never)) as {
      tests: string[];
      measured: { markers: { marker: string; trend: unknown; versusBefore: unknown }[] }[];
      questionsForTheDoctor: string[];
    };
    expect(out.tests).toEqual(["2024-01-10", "2024-05-12"]);
    const ferritin = out.measured.flatMap((g) => g.markers).find((x) => x.marker === "ferritin")!;
    expect(ferritin.trend).toMatch(/not enough results/);
    expect(ferritin.versusBefore).toBe("nothing earlier to compare with");
    expect(out.questionsForTheDoctor.at(-1)).toMatch(/How often/);
    const rolling = (await healthTools(snapshot).get_year_summary!.execute!({}, { toolCallId: "t", messages: [] } as never)) as {
      tests: string[];
      note?: string;
    };
    expect(rolling.tests).toEqual([]);
    expect(rolling.note).toMatch(/No blood test/);
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
    // No published variation is bundled (docs/eflm-biological-variation.md).
    expect(d.normalVariation).toBe("not known for this marker");
    // With a made-up value the published path still reports it.
    expect(markerDetail(snapshot, withVariation(findMarker("ferritin")!, 10)).normalVariation).toMatchObject({ withinPersonCV: "10%" });
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
    const out = (await tools.search_research!.execute!({ terms: ["ferritin"], topic: "pregnancy" }, { toolCallId: "t", messages: [] } as never)) as {
      studies: { id: string }[];
    };
    expect(out.studies.length).toBe(3);
    expect(urls[0]).toMatch(/^https:\/\/www\.ebi\.ac\.uk\//);
    expect(decodeURIComponent(urls[0]!)).not.toMatch(/1984|Warfarin/);
  });
});

describe("protocols", () => {
  const routine: ProtocolEntry = {
    id: "routine",
    label: "Daily routine",
    category: "lifestyle",
    start: "2024-03-01",
    plan: {
      id: "source",
      items: [
        {
          id: "med",
          label: "Warfarin",
          amount: "as prescribed",
          category: "medication",
          when: "evening",
          withFood: true,
          days: ["mon", "wed"],
          note: "My doctor's instructions",
        },
        { id: "meal", label: "Oats", amount: "50 g", category: "diet", when: "morning", mealId: "saved-meal" },
      ],
    },
  };

  it("validates and preserves started items at the snapshot boundary, including when the source is gone", () => {
    const parsed = parseSnapshot(JSON.parse(JSON.stringify({ ...snapshot, protocols: [routine] })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.protocols).toEqual([routine]);
    expect(parsed.snapshot.plans).toEqual([]);
    expect(safetyOf(parsed.snapshot)).toEqual(["anticoagulant"]);
    expect(levers(parsed.snapshot, findMarker("ferritin")!).safetyNotes[0]).toMatch(/Blood thinner/);
    expect(parseSnapshot({ ...snapshot, protocols: [{ ...routine, plan: { ...routine.plan, id: "" } }] }).ok).toBe(false);
    expect(
      parseSnapshot({
        ...snapshot,
        protocols: [{ ...routine, plan: { ...routine.plan, items: [{ ...routine.plan!.items[0], days: ["mon", "mon"] }] } }],
      }).ok,
    ).toBe(false);
  });

  it("gives tools and tool-less agents the full started routine and a whole-routine watch, not edited source items", async () => {
    const grouped: HealthSnapshot = {
      ...snapshot,
      protocols: [routine],
      experiments: [
        {
          id: "watch",
          change: routine.label,
          category: routine.category,
          markerIds: ["ferritin"],
          start: routine.start,
          retestAfterDays: 56,
          protocolId: routine.id,
        },
      ],
      plans: [
        {
          id: "source",
          name: "Edited live protocol",
          createdAt: "2024-04-01",
          items: [{ id: "new", label: "Vitamin D3", amount: "1000 IU", category: "supplement", when: "morning" }],
        },
      ],
    };
    const call = (s: HealthSnapshot, name: string) => healthTools(s)[name]!.execute!({}, { toolCallId: "t", messages: [] } as never);
    const out = (await call(grouped, "get_log")) as {
      habits: { label: string; type: string; start: string; end: string; plan?: ProtocolEntry["plan"]; comparisonScope?: string; watches?: string[] }[];
      safetyNotes: string[];
    };
    expect(out.habits).toEqual([
      {
        id: routine.id,
        label: routine.label,
        type: routine.category,
        start: routine.start,
        end: "ongoing",
        plan: routine.plan,
        comparisonScope: expect.stringMatching(/whole protocol.*cannot be attributed/),
        watches: ["ferritin"],
        keptTo: "never ticked (unknown, not missed)",
      },
    ]);
    expect(out.safetyNotes[0]).toMatch(/Blood thinner.*Talk to your doctor/);
    // This JSON is the serialization of the typed in-process summary, not external input.
    const packed = JSON.parse(dataPack(grouped)) as {
      habits: typeof out.habits;
      safetyNotes: string[];
      experiments: { comparisonScope?: string }[];
    };
    expect(packed.habits).toEqual(out.habits);
    expect(packed.safetyNotes).toEqual(out.safetyNotes);
    expect(packed.experiments[0]!.comparisonScope).toBe(out.habits[0]!.comparisonScope);
    const compared = (await call(grouped, "compare_before_after")) as { experiments: { comparisonScope?: string }[] };
    expect(compared.experiments[0]!.comparisonScope).toBe(out.habits[0]!.comparisonScope);
    const withoutSource = { ...grouped, plans: [] };
    expect(await call(withoutSource, "get_log")).toEqual(out);
    const packedWithoutSource = JSON.parse(dataPack(withoutSource)) as typeof packed;
    expect(packedWithoutSource.habits).toEqual(out.habits);
  });

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
    const out = (await healthTools(parsed.snapshot).get_protocols!.execute!({}, { toolCallId: "t", messages: [] } as never)) as {
      protocols: { items: { nutrient?: string; amountTheyWrote?: string }[]; interactionsBetweenItems: unknown[] }[];
    };
    expect(out.protocols[0]!.items[0]).toMatchObject({ nutrient: "Iron", amountTheyWrote: "25 mg" });
    expect(out.protocols[0]!.interactionsBetweenItems.length).toBeGreaterThan(0);
    expect(parseSnapshot({ ...snapshot, plans: [{ ...plan, name: "" }] }).ok).toBe(false);
  });

  it("writes down a protocol from the person's text as a card, and keeps the whole step", async () => {
    const calm: HealthSnapshot = { ...snapshot, measurements: snapshot.measurements.filter((x) => x.biomarkerId !== "potassium") };
    const items = Array.from({ length: 24 }, (_, i) => ({
      label: `Item ${i}`,
      category: "supplement",
      when: "morning",
      note: "With food or extra virgin olive oil",
    }));
    const input = {
      intent: "record",
      name: "Standard Routine",
      items: [...items, { label: "Iron", category: "supplement", when: "evening" }, { label: "Calcium", category: "supplement", when: "midday" }],
    };
    const run = (snap: HealthSnapshot, x: unknown) =>
      healthTools(snap, undefined, { requestText: `Create this protocol: ${JSON.stringify(input.items)}` }).propose_protocol!.execute!(
        x as never,
        { toolCallId: "t", messages: [] } as never,
      ) as Promise<Record<string, unknown>>;
    const r = await run(calm, input);
    expect(r.shownToPerson).toEqual({ name: "Standard Routine", items: 26 });
    expect((r.interactionsBetweenItems as unknown[]).length).toBeGreaterThan(0);
    expect((await run(snapshot, input)).error).toMatch(/critical/);
    expect(JSON.parse(toolStep("propose_protocol", input).input)).toEqual(input);
  });
});

describe("ticks in get_log", () => {
  it("shows how often a running habit was kept to and what's left today", async () => {
    const today = todayIso();
    const walk: ProtocolEntry = { id: "w", label: "Walking", category: "lifestyle", start: addDays(today, -10) };
    const s: HealthSnapshot = {
      measurements: [],
      protocols: [walk],
      experiments: [],
      profile: {},
      checkins: [addDays(today, -3), addDays(today, -2)].map((date) => ({ id: `w|${date}`, habitId: "w", date })),
    };
    const out = (await healthTools(s).get_log!.execute!({}, { toolCallId: "t", messages: [] } as never)) as {
      habits: { keptTo: unknown }[];
      today: { planned: number; ticked: number; notTickedYet: string[] };
    };
    expect(out.habits[0]!.keptTo).toMatchObject({ countedSince: addDays(today, -3), daysWithSomethingPlanned: 3, daysFullyTicked: 2 });
    expect(out.today).toMatchObject({ planned: 1, ticked: 0, notTickedYet: ["Walking (any time)"] });
  });
});

describe("meals", () => {
  const calm: HealthSnapshot = { ...snapshot, measurements: snapshot.measurements.filter((x) => x.biomarkerId !== "potassium") };
  const run = (snap: HealthSnapshot, tool: string, x: unknown) =>
    healthTools(snap)[tool]!.execute!(x as never, { toolCallId: "t", messages: [] } as never) as Promise<Record<string, unknown>>;

  it("finds foods, writes down a meal with the app's own totals, and reads saved meals", async () => {
    const found = (await run(calm, "find_foods", { query: "porridge oats" })) as { foods: { id: string; name: string }[] };
    expect(found.foods[0]!.name).toMatch(/Porridge oats/);
    const r = await run(calm, "propose_meal", { intent: "record", name: "Porridge", items: [{ foodId: found.foods[0]!.id, grams: 50 }] });
    expect(r.shownToPerson).toEqual({ name: "Porridge", foods: 1 });
    expect((r.appTotals as Record<string, number>).energyKcal).toBeGreaterThan(100);
    expect((await run(calm, "propose_meal", { intent: "record", name: "X", items: [{ foodId: "nope", grams: 50 }] })).error).toMatch(/find_foods/);
    const parsed = parseSnapshot({
      ...calm,
      meals: [{ id: "m", name: "Porridge", items: [{ foodId: found.foods[0]!.id, grams: 50 }], createdAt: "2026-10-29" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const meals = (await run(parsed.snapshot, "get_meals", {})) as { meals: { foods: string[]; totals: Record<string, string> }[]; note: string };
    expect(meals.meals[0]!.foods[0]).toMatch(/Porridge oats.*50 g/);
    expect(meals.note).toMatch(/dark matter/);
  });
});

describe("habit suggestions", () => {
  const call = (snap: HealthSnapshot, input: unknown) =>
    healthTools(snap).propose_habit!.execute!(input as never, { toolCallId: "t", messages: [] } as never) as Promise<Record<string, unknown>>;
  const calm: HealthSnapshot = { ...snapshot, measurements: snapshot.measurements.filter((x) => x.biomarkerId !== "potassium") };

  it("shows a card for a habit the person asked for, without saving anything", async () => {
    const r = await call(calm, {
      intent: "record",
      label: "Oats for breakfast",
      category: "diet",
      watchMarkers: ["LDL-C"],
      reason: "You asked to track this.",
    });
    expect(r.shownToPerson).toMatchObject({ label: "Oats for breakfast", markerIds: ["ldl"] });
    expect(String(r.note)).toMatch(/Nothing is saved/);
  });
  it("refuses medicines, doses, and anything next to a critical result", async () => {
    expect((await call(calm, { intent: "record", label: "Statin", category: "medication", reason: "x" })).error).toBeTruthy();
    expect((await call(calm, { intent: "record", label: "Vitamin D 4000 IU", category: "supplement", reason: "x" })).error).toBeTruthy();
    expect((await call(snapshot, { intent: "record", label: "Walk after dinner", category: "lifestyle", reason: "x" })).error).toMatch(/critical/i);
  });
  it("keeps the whole suggestion in the step, so the page can build the card", () => {
    const long = { label: "Walk after dinner", category: "lifestyle", reason: "r".repeat(280) };
    expect(JSON.parse(toolStep("propose_habit", long).input)).toEqual(long);
    expect(toolStep("get_marker", { marker: "x".repeat(300) }).input.length).toBe(200);
  });
});

describe("changes Brain makes when asked", () => {
  const call = (snap: HealthSnapshot, input: unknown, userText?: string) =>
    healthTools(snap, fetch, userText ? { userText } : {}).change_data!.execute!(input as never, { toolCallId: "t", messages: [] } as never) as Promise<
      Record<string, unknown>
    >;
  const del = { quote: "delete my ferritin from january", changes: [{ kind: "delete_results", marker: "ferritin", date: "2024-01-10" }] };

  it("refuses without the person's typed words, and when the quote isn't theirs", async () => {
    expect((await call(structuredClone(snapshot), del)).error).toMatch(/typed request/);
    expect((await call(structuredClone(snapshot), del, "what is ferritin?")).error).toMatch(/own words/);
  });
  it("records the person's own medicine next to a critical result, and later tools see the change", async () => {
    const snap = structuredClone(snapshot);
    const userText = "delete my ferritin from January and log my metformin 500 mg from today";
    const r = await call(
      snap,
      { ...del, quote: userText, changes: [...del.changes, { kind: "start_habit", label: "Metformin 500 mg", category: "medication" }] },
      userText,
    );
    expect(r.error).toBeUndefined();
    expect(r.done).toEqual([expect.stringContaining("Deleted Ferritin"), expect.stringContaining('Started the habit "Metformin 500 mg"')]);
    expect(snap.measurements.some((x) => x.id === "f1")).toBe(false);
    expect(snap.protocols.at(-1)).toMatchObject({ label: "Metformin 500 mg", category: "medication" });
  });
  it("keeps the whole request in the step, so the page can check it again", () => {
    const step = toolStep("change_data", { ...del, quote: "x".repeat(500) });
    expect(JSON.parse(step.input).quote).toHaveLength(500);
    expect(step.validated).toBe(false);
  });
});

describe("assistant", () => {
  it("collects study IDs only from retrieved structured records", () => {
    expect(
      studyIdsIn({
        studies: [
          { id: "PMID:123456", title: "A retrieved study" },
          { pmid: "7654321", title: "Another retrieved study" },
        ],
        text: "see PMCID:PMC99999",
      }).sort(),
    ).toEqual(["PMID:123456", "PMID:7654321"]);
  });

  it("runs a tool and returns the answer, the steps and the citable IDs", async () => {
    let call = 0;
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    };
    const model = new MockModel({
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
        return {
          content: [{ type: "text", text: "Your ferritin is low [PMID:33285139]." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const r = await ask([{ role: "user", content: "Is my ferritin ok?" }], snapshot, {
      ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe("Your ferritin is low [PMID:33285139].");
    expect(r.steps).toEqual([{ tool: "get_marker", input: '{"marker":"ferritin"}', success: true }]);
    // The marker's own sources came back from the tool, so they may be cited.
    expect(r.studyIds).toContain("PMID:33285139");
  });

  it("sends a photo to the model as an image, with the rules for photos", async () => {
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    };
    let prompt: unknown;
    const model = new MockModel({
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
    const user = msgs.find((m) => m.role === "user") as { content: { type: string }[] };
    expect(user.content.map((p) => p.type)).toEqual(["text", "file"]);
  });

  it("explains model errors without leaking keys", async () => {
    const model = new MockModel({
      doGenerate: async () => {
        throw Object.assign(new Error("bad key sk-abcdefghijklmnop"), { statusCode: 401 });
      },
    });
    const r = await ask([{ role: "user", content: "hi" }], snapshot, { ready: { model, providerOptions: {}, choice: { provider: "ollama", model: "mock" } } });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/API key was rejected/) });
  });
});
