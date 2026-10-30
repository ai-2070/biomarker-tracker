import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";

const seam = vi.hoisted(() => ({
  api: vi.fn(), profile: vi.fn(), read: vi.fn(), shrink: vi.fn(), parse: vi.fn(),
}));
vi.mock("react", async (original) => ({ ...await original<typeof React>(), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock("../../src/app/api", () => ({ api: seam.api }));
vi.mock("../../src/db/db", () => ({
  db: Object.fromEntries(["measurements", "protocols", "experiments", "plans", "meals", "settings"].map((name) => [name, { toArray: async () => [], get: async () => undefined }])),
  getProfile: seam.profile,
}));
vi.mock("../../src/app/hooks", () => ({ EXPIRATION_KEY: "expiration" }));
vi.mock("../../src/app/knowledge", () => ({ BIOMARKER_MAP: new Map([["ldl", { id: "ldl", name: "LDL", aliases: [] }]]), BLOOD_MARKERS: [] }));
vi.mock("../../src/app/components/LabReview", () => ({
  isImage: (f: File) => f.type.startsWith("image/"), isPdf: () => false, monthFirst: false, readReportFile: seam.read,
}));
vi.mock("../../src/core/importers/labText", () => ({ parseLabText: seam.parse }));
vi.mock("../../src/app/brain/photo", () => ({ shrinkPhoto: seam.shrink }));
import { addFiles, habitTurns, newConversation, send, setDraft, setSendPhoto, stop, useBrain } from "../../src/app/brain/store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const profile = { name: "Anna Kovacs", sex: "f" };
const reply = { ok: true, model: "Actual model", text: "Answer", steps: [], studyIds: [], truncated: false, failedServers: [] };

beforeEach(() => {
  newConversation();
  vi.clearAllMocks();
  seam.profile.mockResolvedValue(profile);
  seam.api.mockResolvedValue(reply);
  seam.read.mockResolvedValue({ text: "", ocr: false });
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

  it("stops deferred photo preparation without clearing attachments or sending", async () => {
    await addFiles([new File(["image"], "photo.png", { type: "image/png" })]);
    setSendPhoto(useBrain().attachments[0]!.id, true);
    const pending = deferred<{ mediaType: "image/jpeg"; data: string }>();
    const started = deferred<void>();
    seam.shrink.mockImplementationOnce(() => { started.resolve(); return pending.promise; });
    const task = send("Model", "Look");
    // Explicitly reach photo preparation rather than relying on a timer.
    await started.promise;
    stop();
    pending.resolve({ mediaType: "image/jpeg", data: "jpeg" });
    await task;
    expect(seam.api).not.toHaveBeenCalled();
    expect(useBrain().attachments).toHaveLength(1);
    expect(useBrain().turns).toMatchObject([{ role: "stopped" }]);
    await send("Model", "Look again");
    expect(seam.api).toHaveBeenCalledTimes(1);
  });

  it("invalidates the entire deferred attachment batch and suppresses old review cards", async () => {
    const pending = deferred<{ text: string; ocr: boolean }>();
    seam.read.mockReturnValueOnce(pending.promise);
    seam.parse.mockReturnValue({ rows: [{ biomarkerId: "ferritin" }] });
    const task = addFiles([new File(["a"], "old.png", { type: "image/png" }), new File(["b"], "later.png", { type: "image/png" })]);
    newConversation();
    pending.resolve({ text: "Ferritin 30", ocr: true });
    await task;
    expect(useBrain().turns).toEqual([]);
    expect(useBrain().attachments).toEqual([]);
    expect(seam.read).toHaveBeenCalledTimes(1);
    await addFiles([new File(["c"], "current.png", { type: "image/png" })]);
    expect(useBrain().turns).toMatchObject([{ role: "review", fileName: "current.png" }]);
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

  it("rejects five photos before snapshot or preparation and retains every attachment", async () => {
    await addFiles(Array.from({ length: 5 }, (_, i) => new File(["image"], `${i}.png`, { type: "image/png" })));
    for (const a of useBrain().attachments) setSendPhoto(a.id, true);
    await send("Model", "Look");
    expect(seam.profile).not.toHaveBeenCalled();
    expect(seam.shrink).not.toHaveBeenCalled();
    expect(seam.api).not.toHaveBeenCalled();
    expect(useBrain().attachments).toHaveLength(5);
    expect(useBrain().turns[0]).toMatchObject({ role: "error", content: expect.stringContaining("up to 4 photos") });
    setSendPhoto(useBrain().attachments[4]!.id, false);
    await send("Model", "Look");
    expect(seam.api.mock.calls[0]![2].messages[0].images).toHaveLength(4);
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
  expect(habitTurns([{ tool: "propose_meal", input, success: false, output: { error: "Unknown food" } }, { tool: "propose_meal", input }], [], "2026-10-30")).toEqual([]);
  expect(habitTurns([{ tool: "propose_meal", input, success: true, output: { meal } }], [], "2026-10-30")).toMatchObject([{ role: "meal", meal: { name: "Validated" } }]);
  const plan = { name: "Long protocol", items: Array.from({ length: 60 }, (_, i) => ({ label: `${i}${"a".repeat(78)}`, amount: "b".repeat(40), note: "c".repeat(300), category: "lifestyle", when: "any time", days: ["mon", "tue", "wed", "thu", "fri", "sat"] })) };
  expect(JSON.stringify(plan).length).toBeGreaterThan(30_000);
  const cards = habitTurns([{ tool: "propose_protocol", input: "broken truncated JSON", success: true, output: { plan } }], [], "2026-10-30");
  expect(cards).toMatchObject([{ role: "protocol", plan: { name: "Long protocol", items: plan.items } }]);
});

it("preserves resolved marker ids from successful habit output rather than untrusted input", () => {
  const proposal = { label: "Walk after dinner", category: "lifestyle", start: "2026-10-30", markerIds: ["ldl"], reason: "Track what changes." };
  const step = { tool: "propose_habit", input: JSON.stringify({ label: "Untrusted", watchMarkers: [] }), success: true, output: { shownToPerson: proposal } };
  expect(habitTurns([step], [], "2026-10-30")).toMatchObject([{ role: "habit", proposal }]);
  expect(habitTurns([{ ...step, success: false }], [], "2026-10-30")).toEqual([]);
});

it("keeps a full-length earlier photo question intact without overflowing it with an app notice", async () => {
  await addFiles([new File(["image"], "photo.png", { type: "image/png" })]);
  setSendPhoto(useBrain().attachments[0]!.id, true);
  const question = "q".repeat(20_000);
  await send("Model", question);
  expect(seam.api.mock.calls[0]![2].messages[0].content).toBe(question);
  await send("Model", "Follow-up");
  const messages = seam.api.mock.calls[1]![2].messages;
  expect(messages[0].content).toBe(question);
  expect(messages[0].images).toBeUndefined();
  expect(messages.every((message: { content: string }) => message.content.length <= 20_000)).toBe(true);
});

it("adds the earlier-photo notice when it fits without sending the photo again", async () => {
  await addFiles([new File(["image"], "photo.png", { type: "image/png" })]);
  setSendPhoto(useBrain().attachments[0]!.id, true);
  await send("Model", "Look at this");
  await send("Model", "Follow-up");
  const previous = seam.api.mock.calls[1]![2].messages[0];
  expect(previous.content).toBe("Look at this\n\n[A photo was sent with this question; it isn't sent again.]");
  expect(previous.images).toBeUndefined();
});
