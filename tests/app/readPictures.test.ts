import { afterEach, describe, expect, it, vi } from "vitest";
import ferritin from "../../knowledge/biomarkers/ferritin.json";

vi.mock("../../apps/web/src/app/brain/store", () => ({ READ_REPORT_QUESTION: "Read the results in this report and show them to me to check." }));
vi.mock("../../apps/web/src/app/knowledge", () => ({ BIOMARKER_MAP: new Map([[ferritin.id, ferritin]]) }));

const { readPicturesWithBrain } = await import("../../apps/web/src/app/brain/readPictures");

const page = (n: number) => ({ mediaType: "image/jpeg" as const, data: `PAGE${n}` });
const read = (results: unknown[], date?: string) => ({
  ok: true,
  text: "I read it.",
  steps: [{ tool: "propose_results", validated: true, success: true, output: { shownToPerson: { ...(date ? { date } : {}), results } } }],
});

afterEach(() => vi.unstubAllGlobals());

describe("Brain reading pictures for the bulk import", () => {
  it("sends only the pictures and the reading question, with an empty profile", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(JSON.stringify(read([{ marker: "ferritin", value: "45", unit: "ug/L" }], "2025-03-12"))),
    );
    vi.stubGlobal("fetch", fetch);
    const r = await readPicturesWithBrain([page(1)], new AbortController().signal);
    expect(r).toMatchObject({ date: "2025-03-12", rows: [{ biomarkerId: "ferritin", value: "45" }] });
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body));
    expect(body.snapshot).toEqual({ measurements: [], protocols: [], experiments: [], profile: {} });
    expect(body.messages).toEqual([{ role: "user", content: body.userText, images: [page(1)] }]);
    expect(fetch.mock.calls[0]![1].headers).toMatchObject({ "x-bt": "1" });
  });

  it("reads a long scan in groups the server accepts and joins the rows", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(read([{ marker: "ferritin", value: "45", unit: "ug/L" }]))));
    vi.stubGlobal("fetch", fetch);
    const r = await readPicturesWithBrain(
      Array.from({ length: 8 }, (_, i) => page(i)),
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(typeof r !== "string" && r.rows).toHaveLength(2);
  });

  it("says why when nothing could be read, and passes on server errors", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true, text: "This is a photo of a cat.", steps: [] })));
    expect(await readPicturesWithBrain([page(1)], new AbortController().signal)).toContain("cat");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Set up a model first." }), { status: 400 }));
    expect(await readPicturesWithBrain([page(1)], new AbortController().signal)).toBe("Set up a model first.");
  });
});
