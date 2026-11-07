import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  api: vi.fn(),
  profile: vi.fn(),
  shrink: vi.fn(),
  parse: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("../../apps/web/src/app/api", async () =>
  (await import("./fakeServer")).mockApiModule(() => {
    throw new Error("No local server in this test.");
  }),
);
// The streamed answer (stream.ts) resolves with the same reply the JSON API gave; tests drive it through api.
vi.mock("../../apps/web/src/app/brain/stream", () => ({
  streamAssistant: (body: unknown, signal: AbortSignal, onUpdate: unknown) => seam.api("POST", "/api/assistant", body, signal, onUpdate),
}));
vi.mock("../../apps/web/src/db/db", () => ({
  db: {
    ...Object.fromEntries(
      ["measurements", "protocols", "experiments", "plans", "meals", "settings"].map((name) => [name, { toArray: async () => [], get: async () => undefined }]),
    ),
    transaction: (_mode: string, _tables: unknown[], action: () => Promise<unknown>) => action(),
  },
  getProfile: seam.profile,
  LOADED_PROFILE_KEY: "loadedProfile",
}));
vi.mock("../../apps/web/src/app/hooks", () => ({ EXPIRATION_KEY: "expiration", MORTALITY_ACTIVITY_KEY: "mortalityActivityIsLeisure" }));
vi.mock("../../apps/web/src/app/knowledge", () => ({ BIOMARKER_MAP: new Map([["ldl", { id: "ldl", name: "LDL", aliases: [] }]]), BLOOD_MARKERS: [] }));
vi.mock("../../apps/web/src/app/components/LabReview", () => ({
  isImage: (f: File) => f.type.startsWith("image/"),
  isPdf: () => false,
  monthFirst: false,
}));
vi.mock("@bt/shared/core/importers/labText", () => ({ parseLabText: seam.parse }));
vi.mock("../../apps/web/src/app/brain/photo", () => ({ shrinkPhoto: seam.shrink }));

import { addFiles, addPastedLabText, habitTurns, newConversation, removeAttachment, send, setDraft, useBrain } from "../../apps/web/src/app/brain/store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const profile = { name: "Anna Kovacs", sex: "f" };
const reply = { ok: true, model: "Actual model", text: "Answer", steps: [], studyIds: [], truncated: false, failedServers: [] };

beforeEach(() => {
  newConversation();
  vi.clearAllMocks();
  seam.profile.mockResolvedValue(profile);
  seam.api.mockResolvedValue(reply);
  seam.parse.mockReturnValue({ rows: [] });
  seam.shrink.mockResolvedValue({ mediaType: "image/jpeg", data: "jpeg" });
});

describe("assistant preparation boundaries", () => {
  it("locks synchronously, cancels deferred snapshot preparation and accepts the next send", async () => {
    const pending = deferred<typeof profile>();
    seam.profile.mockReturnValueOnce(pending.promise);
    setDraft("Old question");
    const first = send("Cached model");
    expect(useBrain().busy).toBe(true);
    await send("Cached model", "Duplicate");
    expect(seam.profile).toHaveBeenCalledTimes(1);
    newConversation();
    pending.resolve(profile);
    await first;
    expect(seam.api).not.toHaveBeenCalled();
    expect(useBrain().turns).toEqual([]);
    await send("Cached model", "New question");
    expect(seam.api).toHaveBeenCalledTimes(1);
    expect(useBrain().turns.find((t) => t.role === "assistant")).toMatchObject({ model: "Actual model" });
  });

  it("prepares a photo when it is attached and sends it with the question, never reading it as text", async () => {
    await addFiles([new File(["image"], "photo.png", { type: "image/png" })]);
    expect(seam.parse).not.toHaveBeenCalled();
    expect(useBrain().attachments).toMatchObject([
      { name: "photo.png", status: "ready", images: [{ mediaType: "image/jpeg", data: "jpeg" }], pictureOf: "photo" },
    ]);
    await send("Model", "Look");
    expect(seam.api.mock.calls[0]![2].messages[0]).toMatchObject({ content: "Look", images: [{ mediaType: "image/jpeg", data: "jpeg" }] });
    expect(useBrain().turns[0]).toMatchObject({ role: "user", photos: 1, files: ["photo.png"] });
  });

  it("shows a photo the browser can't open as an error on its card", async () => {
    seam.shrink.mockRejectedValueOnce(new Error("This browser can't open this picture. Save it as JPG or PNG and try again."));
    await addFiles([new File(["heic"], "photo.heic", { type: "image/heic" })]);
    expect(useBrain().attachments).toMatchObject([{ status: "error", error: expect.stringContaining("JPG or PNG") }]);
  });

  it("invalidates the entire deferred attachment batch", async () => {
    const pending = deferred<{ mediaType: "image/jpeg"; data: string }>();
    seam.shrink.mockReturnValueOnce(pending.promise);
    const task = addFiles([new File(["a"], "old.png", { type: "image/png" }), new File(["b"], "later.png", { type: "image/png" })]);
    newConversation();
    pending.resolve({ mediaType: "image/jpeg", data: "jpeg" });
    await task;
    expect(useBrain().turns).toEqual([]);
    expect(useBrain().attachments).toEqual([]);
    expect(seam.shrink).toHaveBeenCalledTimes(1);
    await addFiles([new File(["c"], "current.png", { type: "image/png" })]);
    expect(useBrain().attachments).toMatchObject([{ name: "current.png", status: "ready" }]);
  });

  it("redacts both filename and body on the wire but retains local filenames", async () => {
    await addFiles([new File(["Anna Kovacs referral details"], "Anna Kovacs referral.txt", { type: "text/plain" })]);
    await send("Model", "Read this");
    const body = seam.api.mock.calls[0]![2];
    expect(body.messages[0].content).not.toContain("Anna");
    expect(body.messages[0].content).not.toContain("Kovacs");
    expect(body.messages[0].content).toContain("referral details");
    expect(useBrain().turns[0]).toMatchObject({ files: ["Anna Kovacs referral.txt"] });
  });

  it("rejects seven photos before the snapshot and retains every attachment", async () => {
    await addFiles(Array.from({ length: 7 }, (_, i) => new File(["image"], `${i}.png`, { type: "image/png" })));
    await send("Model", "Look");
    expect(seam.profile).not.toHaveBeenCalled();
    expect(seam.api).not.toHaveBeenCalled();
    expect(useBrain().attachments).toHaveLength(7);
    expect(useBrain().turns[0]).toMatchObject({ role: "error", content: expect.stringContaining("up to 6 photos or pages") });
    removeAttachment(useBrain().attachments[6]!.id);
    await send("Model", "Look");
    expect(seam.api.mock.calls[0]![2].messages[0].images).toHaveLength(6);
  });

  it("releases the lock and retains files when complete-message budgeting rejects preparation", async () => {
    await addFiles([new File(["details"], "document.txt", { type: "text/plain" })]);
    await send("Model", "q".repeat(20_001));
    expect(useBrain().busy).toBe(false);
    expect(useBrain().attachments).toHaveLength(1);
    expect(useBrain().turns[0]).toMatchObject({ role: "error" });
    expect(seam.api).not.toHaveBeenCalled();
    await send("Model", "Read");
    expect(seam.api).toHaveBeenCalledTimes(1);
  });
});

it("builds cards only from successful complete proposal outputs, never input", () => {
  const meal = { id: "server", name: "Validated", createdAt: "2026-10-30", items: [{ foodId: "food", grams: 100 }] };
  const input = JSON.stringify({ ...meal, name: "Rejected input" });
  const context = { requestText: "Record my breakfast recipe", safety: [] };
  expect(
    habitTurns(
      [
        { tool: "propose_meal", input, validated: true, success: false, output: { error: "Unknown food" } },
        { tool: "propose_meal", input },
      ],
      [],
      "2026-10-30",
      context,
    ),
  ).toEqual([]);
  expect(
    habitTurns([{ tool: "propose_meal", input, validated: true, success: true, output: { intent: "record", meal } }], [], "2026-10-30", context),
  ).toMatchObject([{ role: "meal", meal: { name: "Validated" } }]);
  const plan = {
    name: "Long protocol",
    items: Array.from({ length: 60 }, (_, i) => ({
      label: `${i}${"a".repeat(78)}`,
      amount: "b".repeat(40),
      note: "c".repeat(300),
      category: "lifestyle",
      when: "any time",
      days: ["mon", "tue", "wed", "thu", "fri", "sat"],
    })),
  };
  expect(JSON.stringify(plan).length).toBeGreaterThan(30_000);
  const cards = habitTurns(
    [{ tool: "propose_protocol", input: "broken truncated JSON", validated: true, success: true, output: { intent: "record", plan } }],
    [],
    "2026-10-30",
    { requestText: plan.items.map((i) => `${i.label} ${i.amount} ${i.note}`).join("\n"), safety: [] },
  );
  expect(cards).toMatchObject([{ role: "protocol", plan: { name: "Long protocol", items: plan.items } }]);
});

it("preserves resolved marker ids from successful habit output rather than untrusted input", () => {
  const proposal = { label: "Walk after dinner", category: "lifestyle", start: "2026-10-30", markerIds: ["ldl"], reason: "Track what changes." };
  const step = {
    tool: "propose_habit",
    input: JSON.stringify({ label: "Untrusted", watchMarkers: [] }),
    validated: true,
    success: true,
    output: { intent: "recommend", shownToPerson: proposal },
  };
  const context = { requestText: "Recommend a walking habit", safety: [] };
  expect(habitTurns([step], [], "2026-10-30", context)).toMatchObject([{ role: "habit", proposal }]);
  expect(habitTurns([{ ...step, success: false }], [], "2026-10-30", context)).toEqual([]);
});

it("keeps a full-length earlier photo question intact without overflowing it with an app notice", async () => {
  await addFiles([new File(["image"], "photo.png", { type: "image/png" })]);
  const question = "q".repeat(20_000);
  await send("Model", question);
  expect(seam.api.mock.calls[0]![2].messages[0].content).toBe(question);
  await send("Model", "Follow-up");
  const messages = seam.api.mock.calls[1]![2].messages;
  expect(messages[0].content).toBe(question);
  expect(messages[0].images).toBeUndefined();
  expect(messages.every((message: { content: string }) => message.content.length <= 20_000)).toBe(true);
});

describe("lab results pasted into Brain", () => {
  const rows = (n: number) => ({ rows: Array.from({ length: n }, (_, i) => ({ biomarkerId: `m${i}` })), unmatched: [] });

  it("turns pasted lab rows into a review card instead of a message", async () => {
    seam.parse.mockReturnValue(rows(3));
    expect(addPastedLabText("Serum Natrium 140 mmol/L\nSerum Kalium 4.6 mmol/L\nRDW 13.3 %")).toBe(true);
    await vi.waitFor(() => expect(useBrain().turns).toMatchObject([{ role: "review", fileName: "Pasted lab results.txt", state: "open" }]));
    expect(useBrain().draft).toBe("");
    expect(seam.api).not.toHaveBeenCalled();
  });

  it("leaves ordinary pasted text in the question box", () => {
    seam.parse.mockReturnValue(rows(2));
    expect(addPastedLabText("My ferritin was 18 last spring and 30 now")).toBe(false);
  });
});
