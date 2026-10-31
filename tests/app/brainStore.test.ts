import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainState } from "../../src/app/brain/store";
import type * as BrainStore from "../../src/app/brain/store";
import ferritin from "../../knowledge/biomarkers/ferritin.json";
import weight from "../../knowledge/biomarkers/weight.json";
import bodyFat from "../../knowledge/biomarkers/body_fat.json";
import pace from "../../knowledge/biomarkers/dunedinpace.json";
import { deferred } from "../helpers";
import type { Profile } from "../../src/core/types";
import type { ProfileFillResult } from "../../src/db/db";

const mocks = vi.hoisted(() => ({
  api: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  measurements: vi.fn<() => Promise<unknown[]>>(),
  rows: vi.fn<() => Promise<unknown[]>>(),
  profile: vi.fn<() => Promise<Profile>>(),
  setting: vi.fn<() => Promise<{ key: string; value: unknown } | undefined>>(),
  fillProfile: vi.fn<(...args: unknown[]) => Promise<ProfileFillResult>>(),
  readReport: vi.fn<() => Promise<{ text: string; ocr: boolean }>>(),
  shrinkPhoto: vi.fn<() => Promise<{ mediaType: "image/jpeg"; data: string }>>(),
}));

// Exercise the real external store without mounting a UI or loading OCR/PDF workers.
vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, snapshot: () => BrainState) => snapshot() }));
vi.mock("../../src/app/api", () => ({ api: mocks.api }));
vi.mock("../../src/db/db", () => ({
  db: {
    transaction: (_mode: string, _tables: unknown[], action: () => Promise<unknown>) => action(),
    measurements: { toArray: mocks.measurements },
    protocols: { toArray: mocks.rows },
    experiments: { toArray: mocks.rows },
    plans: { toArray: mocks.rows },
    meals: { toArray: mocks.rows },
    settings: { get: mocks.setting },
  },
  getProfile: mocks.profile,
  fillPersonalDetails: mocks.fillProfile,
  LOADED_PROFILE_KEY: "loadedProfile",
}));
vi.mock("../../src/app/hooks", () => ({ EXPIRATION_KEY: "showExpirationDate" }));
vi.mock("../../src/app/knowledge", () => ({
  BLOOD_MARKERS: [ferritin], BIOMARKER_MAP: new Map([ferritin, weight, bodyFat, pace].map((def) => [def.id, def])),
}));
vi.mock("../../src/app/components/LabReview", () => ({
  isPdf: (file: File) => file.type === "application/pdf",
  isImage: (file: File) => file.type.startsWith("image/"),
  monthFirst: false,
  readReportFile: mocks.readReport,
}));
vi.mock("../../src/app/brain/photo", () => ({ shrinkPhoto: mocks.shrinkPhoto }));


const reply = (text = "Public evidence answer") => ({ ok: true, text, steps: [], studyIds: ["PMID:123"], truncated: false, failedServers: [] });
const claim = "Check human evidence for oral astaxanthin and skin elasticity.";
let brain: typeof BrainStore;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.api.mockResolvedValue(reply());
  mocks.measurements.mockResolvedValue([]);
  mocks.rows.mockResolvedValue([]);
  mocks.profile.mockResolvedValue({ name: "PRIVATE_NAME", birthMonth: "1980-01" });
  mocks.setting.mockResolvedValue(undefined);
  mocks.fillProfile.mockResolvedValue({ profile: {}, added: [], rejected: [], measurementsAdded: [], sameProfile: true });
  mocks.readReport.mockResolvedValue({ text: "", ocr: true });
  mocks.shrinkPhoto.mockResolvedValue({ mediaType: "image/jpeg", data: "PRIVATE_PHOTO" });
  // Reload deliberately: every test needs fresh private thread/request state.
  brain = await import("../../src/app/brain/store");
});

describe("research Brain thread", () => {
  it("excludes profile reads, personal history and files on initial and follow-up requests, then restores my chat", async () => {
    mocks.api.mockResolvedValueOnce(reply("PRIVATE_ANSWER"));
    await brain.addFiles([new File(["PRIVATE_DOCUMENT"], "private.txt", { type: "text/plain" })]);
    await brain.send("Personal model", "PRIVATE_QUESTION");
    const personalTurns = brain.useBrain().turns;
    brain.setDraft("PRIVATE_UNSENT_DRAFT");
    await brain.addFiles([new File(["PRIVATE_NEXT_DOCUMENT"], "next.txt", { type: "text/plain" })]);
    const personalFiles = brain.useBrain().attachments;
    expect(mocks.api.mock.calls[0]?.[2]).toMatchObject({
      snapshot: { profile: { birthMonth: "1980-01" } },
      messages: [{ role: "user", content: expect.stringContaining("PRIVATE_DOCUMENT") }],
    });
    const readsBeforeResearch = mocks.rows.mock.calls.length;

    brain.askResearchBrain(claim);
    await brain.send("Research model");
    expect(mocks.api.mock.calls[1]?.[2]).toEqual({ scope: "research", messages: [{ role: "user", content: claim }] });
    expect(brain.useBrain()).toMatchObject({ scope: "research", attachments: [], draft: "", busy: false });
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "assistant"]);

    brain.setDraft("What were the main limitations?");
    await brain.send("Research model");
    const followup = mocks.api.mock.calls[2]?.[2] as { scope: string; messages: { role: string; content: string }[] };
    expect(Object.keys(followup).sort()).toEqual(["messages", "scope"]);
    expect(followup.scope).toBe("research");
    expect(followup.messages).toHaveLength(1);
    expect(followup.messages[0]).toMatchObject({ role: "user", content: expect.stringContaining("What were the main limitations?") });
    expect(followup.messages[0]?.content).toContain(claim);
    expect(JSON.stringify(followup)).not.toMatch(/PRIVATE_|Public evidence answer|PMID:123/);
    expect(mocks.measurements).toHaveBeenCalledTimes(1);
    expect(mocks.profile).toHaveBeenCalledTimes(1);
    expect(mocks.rows).toHaveBeenCalledTimes(readsBeforeResearch);
    expect(mocks.shrinkPhoto).not.toHaveBeenCalled();

    brain.backToMyChat();
    expect(brain.useBrain()).toMatchObject({ scope: "personal", draft: "PRIVATE_UNSENT_DRAFT", turns: personalTurns, attachments: personalFiles });
    // Research turns survive switching back, but never become personal message history.
    await brain.send("Personal model", "Another personal question");
    const personalBody = mocks.api.mock.calls[3]?.[2];
    expect(JSON.stringify(personalBody)).not.toMatch(/astaxanthin|main limitations|Public evidence answer/);
    brain.askResearchBrain("A second public claim");
    expect(brain.useBrain().turns).toHaveLength(4);
  });

  it("keeps an unready claim editable, preserves scope through open/close, and clears only the current conversation", async () => {
    brain.setDraft("My saved draft");
    brain.askResearchBrain(claim);
    brain.takePending(false, "");
    expect(brain.useBrain()).toMatchObject({ scope: "research", draft: claim, pending: undefined, turns: [] });
    expect(mocks.api).not.toHaveBeenCalled();
    brain.setDraft("Does oral astaxanthin affect dry skin?");
    brain.takePending(true, "Ready model");
    expect(mocks.api).not.toHaveBeenCalled();
    brain.closeBrain();
    brain.openBrain();
    expect(brain.useBrain()).toMatchObject({ open: true, scope: "research", draft: "Does oral astaxanthin affect dry skin?" });
    await brain.send("Ready model");
    expect(JSON.stringify(mocks.api.mock.calls[0]?.[2])).toContain("Does oral astaxanthin affect dry skin?");
    brain.newConversation();
    expect(brain.useBrain()).toMatchObject({ scope: "research", turns: [], draft: "", attachments: [] });
    brain.setDraft("A fresh research question");
    await brain.send("Ready model");
    expect(mocks.api.mock.calls[1]?.[2]).toEqual({ scope: "research", messages: [{ role: "user", content: "A fresh research question" }] });
    brain.backToMyChat();
    expect(brain.useBrain().draft).toBe("My saved draft");
    brain.newConversation();
    brain.askResearchBrain("A different public claim");
    expect(brain.useBrain().turns).toHaveLength(2);
  });

  it("takes a ready pending claim only in research scope and never converts it into a personal pending question", async () => {
    brain.askResearchBrain(claim);
    brain.takePending(true, "Ready model");
    await vi.waitFor(() => expect(brain.useBrain().busy).toBe(false));
    expect(mocks.api.mock.calls[0]?.[2]).toEqual({ scope: "research", messages: [{ role: "user", content: claim }] });
    brain.askResearchBrain("Unanswered public claim");
    brain.askBrain("A personal question");
    expect(brain.useBrain()).toMatchObject({ scope: "personal", pending: "A personal question" });
    brain.takePending(false, "");
    expect(brain.useBrain().draft).toBe("A personal question");
    expect(mocks.api).toHaveBeenCalledTimes(1);
    // Existing personal prefill callers must not accidentally continue a research thread.
    brain.askResearchBrain(claim);
    brain.openBrain({ draft: "Explain my results" });
    expect(brain.useBrain()).toMatchObject({ scope: "personal", draft: "Explain my results" });
  });

  it("refuses files at the store boundary and does not turn research replies into personal proposal cards", async () => {
    brain.askResearchBrain(claim);
    const file = new File(["PRIVATE_DOCUMENT"], "private.txt", { type: "text/plain" });
    const read = vi.spyOn(file, "text");
    await brain.addFiles([file, new File(["photo"], "photo.jpg", { type: "image/jpeg" })]);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.readReport).not.toHaveBeenCalled();
    const steps = [{ tool: "propose_habit", validated: true, input: JSON.stringify({ intent: "recommend", label: "Iron-rich breakfast", category: "diet", reason: "You asked to track this.", watchMarkers: ["Ferritin"] }) }];
    expect(brain.habitTurns(steps, [], "2026-10-30", { requestText: "Recommend a breakfast habit", safety: [] })).toHaveLength(1);
    mocks.api.mockResolvedValue({ ...reply(), steps });
    await brain.send("Research model");
    expect(brain.useBrain().attachments).toEqual([]);
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(mocks.profile).not.toHaveBeenCalled();
  });
});

describe("research preparation and response races", () => {
  it.each(["resolve", "reject"] as const)("discards delayed personal snapshot %s after switching, without a duplicate request or lost draft", async (finish) => {
    const pending = deferred<unknown[]>();
    mocks.measurements.mockReturnValue(pending.promise);
    brain.setDraft("PRIVATE_DRAFT");
    await brain.addFiles([new File(["PRIVATE_FILE"], "private.txt", { type: "text/plain" })]);
    const sending = brain.send("Personal model");
    expect(brain.useBrain().busy).toBe(true);
    await brain.send("Personal model");
    expect(mocks.measurements).toHaveBeenCalledTimes(1);
    brain.askResearchBrain(claim);
    await brain.send("Research model");
    if (finish === "resolve") pending.resolve([]);
    else pending.reject(new Error("PRIVATE_SNAPSHOT_FAILURE"));
    await sending;
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api.mock.calls[0]?.[2]).toEqual({ scope: "research", messages: [{ role: "user", content: claim }] });
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    brain.backToMyChat();
    expect(brain.useBrain()).toMatchObject({ draft: "PRIVATE_DRAFT", busy: false, turns: [], attachments: [{ name: "private.txt", status: "ready", text: "PRIVATE_FILE" }] });
  });

  it("does not send photos whose normal preparation finishes after switching, and keeps them in my chat", async () => {
    const prepared = deferred<{ mediaType: "image/jpeg"; data: string }>();
    mocks.shrinkPhoto.mockReturnValue(prepared.promise);
    const photo = new File(["photo"], "private.jpg", { type: "image/jpeg" });
    await brain.addFiles([photo]);
    brain.setSendPhoto(brain.useBrain().attachments[0]!.id, true);
    brain.setDraft("PRIVATE_PHOTO_QUESTION");
    const sending = brain.send("Personal model");
    await vi.waitFor(() => expect(mocks.shrinkPhoto).toHaveBeenCalledTimes(1));
    brain.askResearchBrain(claim);
    await brain.send("Research model");
    prepared.resolve({ mediaType: "image/jpeg", data: "PRIVATE_PHOTO" });
    await sending;
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api.mock.calls[0]?.[2]).toEqual({ scope: "research", messages: [{ role: "user", content: claim }] });
    brain.backToMyChat();
    expect(brain.useBrain()).toMatchObject({ draft: "PRIVATE_PHOTO_QUESTION", turns: [], attachments: [{ name: "private.jpg", photo, sendPhoto: true, status: "ready" }] });
  });

  it("aborts an old personal response and ignores its late completion while research is active", async () => {
    const oldReply = deferred<unknown>();
    mocks.api.mockReturnValueOnce(oldReply.promise);
    brain.setDraft("PRIVATE_QUESTION");
    const sending = brain.send("Personal model");
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const signal = mocks.api.mock.calls[0]?.[3] as AbortSignal;
    brain.askResearchBrain(claim);
    expect(signal.aborted).toBe(true);
    await brain.send("Research model");
    oldReply.resolve(reply("PRIVATE_LATE_ANSWER"));
    await sending;
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(brain.useBrain().turns)).not.toContain("PRIVATE_");
    brain.backToMyChat();
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "stopped"]);
  });

  it("does not let a canceled research response reset a newer personal request's busy state", async () => {
    const oldReply = deferred<unknown>();
    const personalReply = deferred<unknown>();
    mocks.api.mockReturnValueOnce(oldReply.promise).mockReturnValueOnce(personalReply.promise);
    brain.askResearchBrain(claim);
    const researchSending = brain.send("Research model");
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    brain.backToMyChat();
    brain.setDraft("PRIVATE_QUESTION");
    const personalSending = brain.send("Personal model");
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    oldReply.resolve(reply("OLD_RESEARCH_ANSWER"));
    await researchSending;
    expect(brain.useBrain().busy).toBe(true);
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user"]);
    personalReply.resolve(reply("PRIVATE_ANSWER"));
    await personalSending;
    expect(brain.useBrain().busy).toBe(false);
    expect(JSON.stringify(brain.useBrain().turns)).not.toContain("OLD_RESEARCH_ANSWER");
  });

  it("does not resurrect a cleared research conversation when the old answer arrives", async () => {
    const pending = deferred<unknown>();
    mocks.api.mockReturnValueOnce(pending.promise);
    brain.askResearchBrain(claim);
    const sending = brain.send("Research model");
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    brain.newConversation();
    pending.resolve(reply("Old answer"));
    await sending;
    expect(brain.useBrain()).toMatchObject({ scope: "research", busy: false, turns: [], draft: "" });
    expect((mocks.api.mock.calls[0]?.[3] as AbortSignal).aborted).toBe(true);
  });
});

describe("parked personal file reads", () => {
  it.each(["document", "lab report"])("finishes a delayed %s in my chat, not in research", async (kind) => {
    const pending = deferred<string>();
    const file = new File([""], "private.txt", { type: "text/plain" });
    vi.spyOn(file, "text").mockReturnValue(pending.promise);
    const reading = brain.addFiles([file]);
    expect(brain.useBrain().attachments[0]?.status).toBe("reading");
    brain.askResearchBrain(claim);
    pending.resolve(kind === "document" ? "PRIVATE_DOCUMENT" : "Ferritin 42 µg/L 15-150");
    await reading;
    expect(brain.useBrain()).toMatchObject({ scope: "research", turns: [], attachments: [] });
    await brain.send("Research model");
    expect(mocks.api.mock.calls[0]?.[2]).toEqual({ scope: "research", messages: [{ role: "user", content: claim }] });
    brain.backToMyChat();
    if (kind === "document") {
      expect(brain.useBrain().attachments).toMatchObject([{ name: "private.txt", status: "ready", text: "PRIVATE_DOCUMENT" }]);
    } else {
      expect(brain.useBrain().attachments).toEqual([]);
      expect(brain.useBrain().turns).toMatchObject([{ role: "review", fileName: "private.txt", report: { rows: [{ biomarkerId: "ferritin", value: "42" }] } }]);
      const reviewId = brain.useBrain().turns[0]!.id;
      brain.askResearchBrain("Another public claim");
      // A save that began in my chat may finish after I switch to research.
      brain.updateTurn(reviewId, { state: "saved" });
      expect(brain.useBrain().turns.some((t) => t.role === "review")).toBe(false);
      brain.backToMyChat();
      expect(brain.useBrain().turns).toMatchObject([{ role: "review", state: "saved" }]);
    }
  });

  it("does not resurrect an old file batch after clearing my conversation", async () => {
    const pending = deferred<string>();
    const file = new File([""], "old.txt", { type: "text/plain" });
    vi.spyOn(file, "text").mockReturnValue(pending.promise);
    const reading = brain.addFiles([file, new File(["OLD_SECOND_FILE"], "second.txt", { type: "text/plain" })]);
    brain.newConversation();
    await brain.addFiles([new File(["NEW_DOCUMENT"], "new.txt", { type: "text/plain" })]);
    pending.resolve("Ferritin 42 µg/L 15-150");
    await reading;
    expect(brain.useBrain().turns).toEqual([]);
    expect(brain.useBrain().attachments).toMatchObject([{ name: "new.txt", status: "ready", text: "NEW_DOCUMENT" }]);
    expect(brain.useBrain().attachments).toHaveLength(1);
  });
});

describe("personal Brain profile updates", () => {
  const profileStep = { tool: "save_profile_details", validated: true, input: JSON.stringify({ details: [{ field: "heightCm", quote: "I'm 180 cm" }] }) };

  it("shows a saved receipt only after persistence, without sending local identity or private fields", async () => {
    const saved = deferred<ProfileFillResult>();
    mocks.profile.mockResolvedValue({ name: "PRIVATE_NAME", notes: "PRIVATE_NOTES" });
    mocks.setting.mockResolvedValue({ key: "loadedProfile", value: "PRIVATE_FOLDER_ID" });
    mocks.api.mockResolvedValue({ ...reply("Your height can be used for body measurements."), steps: [profileStep] });
    mocks.fillProfile.mockReturnValue(saved.promise);
    const sending = brain.send("Model", "I'm 180 cm");
    await vi.waitFor(() => expect(mocks.fillProfile).toHaveBeenCalledTimes(1));
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user"]);
    const body = mocks.api.mock.calls[0]?.[2];
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_NAME|PRIVATE_NOTES|PRIVATE_FOLDER_ID|identity/);
    saved.resolve({ profile: { heightCm: 180 }, added: [{ field: "heightCm", value: 180 }], rejected: [], measurementsAdded: [], sameProfile: true });
    await sending;
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "assistant", "profile"]);
    expect(brain.useBrain().turns.at(-1)).toMatchObject({ changes: [{ field: "heightCm", value: 180 }] });
  });

  it.each([
    { ...profileStep, validated: false },
    { ...profileStep, validated: undefined },
    { ...profileStep, server: "external" },
    { ...profileStep, server: "" },
    { ...profileStep, input: "not json" },
  ])("ignores unsuccessful, external and malformed profile steps %#", async (step) => {
    mocks.api.mockResolvedValue({ ...reply(), steps: [step] });
    await brain.send("Model", "Explain this result");
    expect(mocks.fillProfile).not.toHaveBeenCalled();
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("keeps the answer and exposes persistence failure without a false saved receipt", async () => {
    mocks.api.mockResolvedValue({ ...reply("An answer worth keeping"), steps: [profileStep] });
    mocks.fillProfile.mockRejectedValue(new Error("Disk unavailable"));
    await brain.send("Model", "I'm 180 cm");
    expect(brain.useBrain().turns).toEqual([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ role: "assistant", content: "An answer worth keeping", note: expect.any(String) }),
    ]);
  });

  it("drops a response that belongs to a profile replaced while the model was answering", async () => {
    mocks.api.mockResolvedValue({ ...reply("Old person's answer"), steps: [profileStep] });
    mocks.fillProfile.mockResolvedValue({ profile: {}, added: [], rejected: [], measurementsAdded: [], sameProfile: false });
    await brain.send("Model", "I'm 180 cm");
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user"]);
  });

  it("aborts an in-flight profile write and hides its late response when changing scope", async () => {
    const saved = deferred<ProfileFillResult>();
    mocks.api.mockResolvedValue({ ...reply(), steps: [profileStep] });
    mocks.fillProfile.mockReturnValue(saved.promise);
    const sending = brain.send("Model", "I'm 180 cm");
    await vi.waitFor(() => expect(mocks.fillProfile).toHaveBeenCalledTimes(1));
    const signal = mocks.fillProfile.mock.calls[0]?.[5];
    brain.askResearchBrain(claim);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).toHaveProperty("aborted", true);
    saved.resolve({ profile: { heightCm: 180 }, added: [{ field: "heightCm", value: 180 }], rejected: [], measurementsAdded: [], sameProfile: true });
    await sending;
    brain.backToMyChat();
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "stopped"]);
  });

  it("never applies profile tool results in public research", async () => {
    brain.askResearchBrain(claim);
    mocks.api.mockResolvedValue({ ...reply(), steps: [profileStep] });
    await brain.send("Model");
    expect(mocks.fillProfile).not.toHaveBeenCalled();
    expect(brain.useBrain().turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("saves explicit profile facts even when a successful answer contains no save tool call", async () => {
    mocks.fillProfile.mockResolvedValue({
      profile: { heightCm: 184, sex: "m", diet: "omnivore" },
      added: [{ field: "heightCm", value: 184 }, { field: "sex", value: "m" }, { field: "diet", value: "omnivore" }],
      rejected: [], measurementsAdded: [], sameProfile: true,
    });
    await brain.send("Model", "I'm 36, 84kg, 184cm tall, man. I usually eat everything. What should I consider if I start lifting?");
    expect(brain.useBrain().turns.map((turn) => turn.role)).toEqual(["user", "assistant", "profile"]);
    expect(brain.useBrain().turns.at(-1)).toMatchObject({ changes: [
      { field: "heightCm", value: 184 }, { field: "sex", value: "m" }, { field: "diet", value: "omnivore" },
    ] });
  });

  it("shows a persisted measurement receipt even when there are no new profile fields or save tools", async () => {
    const measurement = { id: "body-fat", biomarkerId: "body_fat", value: 27, originalValue: 27, originalUnit: "%", date: "2026-10-30", source: "manual" as const };
    mocks.fillProfile.mockResolvedValue({ profile: {}, added: [], rejected: [], measurementsAdded: [measurement], sameProfile: true });
    await brain.send("Model", "im 27% body fat");
    expect(brain.useBrain().turns.map((turn) => turn.role)).toEqual(["user", "assistant", "profile"]);
    expect(brain.useBrain().turns.at(-1)).toMatchObject({ changes: [], measurements: [measurement] });
  });
});

it("does not make a habit draft from an external tool even with an empty server id", () => {
  const input = JSON.stringify({ intent: "recommend", label: "Walk outdoors", category: "lifestyle", reason: "An example." });
  expect(brain.habitTurns([{ tool: "propose_habit", input, server: "", validated: true }], [], "2026-10-30", { requestText: "Recommend a habit", safety: [] })).toEqual([]);
});
