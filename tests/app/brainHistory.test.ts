import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatTitle,
  clearChats,
  deleteChat,
  fitChats,
  fromSaved,
  loadChats,
  loadHistory,
  MAX_CHATS,
  parseChats,
  resetHistory,
  type SavedChat,
  SETTINGS_KEY,
  saveChat,
  toSaved,
  upsertChat,
} from "../../apps/web/src/app/brain/chatHistory";
import type { Turn } from "../../apps/web/src/app/brain/store";
import { db } from "../../apps/web/src/db/db";

const turns: Turn[] = [
  { id: "1", role: "user", content: "How has my LDL changed?", sent: "How has my LDL changed?\n[file text]", files: ["report.pdf"], pictures: undefined },
  { id: "2", role: "live", model: "m" } as unknown as Turn,
  {
    id: "3",
    role: "assistant",
    content: "It went down.",
    model: "Claude",
    steps: [{ tool: "get_marker", input: "x".repeat(900), output: { big: true } }],
    studyIds: ["PMID:1"],
    truncated: false,
    failedServers: [],
  },
  { id: "4", role: "error", content: "boom" },
  { id: "5", role: "stopped" },
];

const chat = (id: string, updated: number): SavedChat => ({ id, title: id, updated, turns: [{ role: "user", content: id, files: [] }] });

describe("Brain conversation history", () => {
  it("keeps only the words: questions and checked answers, without pictures, outputs or failed turns", () => {
    const saved = toSaved(turns);
    expect(saved.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(saved[0]).toEqual({ role: "user", content: "How has my LDL changed?", files: ["report.pdf"] });
    const answer = saved[1] as Extract<(typeof saved)[number], { role: "assistant" }>;
    expect(answer.studyIds).toEqual(["PMID:1"]);
    expect(answer.steps[0]?.input.length).toBe(300);
    expect(answer.steps[0]).not.toHaveProperty("output");
  });

  it("brings turns back that the window can show", () => {
    let n = 0;
    const back = fromSaved(toSaved(turns), () => `n${++n}`);
    expect(back.map((t) => t.id)).toEqual(["n1", "n2"]);
    expect(back[0]).toMatchObject({ role: "user", content: "How has my LDL changed?", sent: "How has my LDL changed?", files: ["report.pdf"] });
    expect(back[1]).toMatchObject({ role: "assistant", content: "It went down.", failedServers: [], truncated: false });
  });

  it("titles a conversation by its first question, shortened", () => {
    expect(chatTitle(toSaved(turns))).toBe("How has my LDL changed?");
    expect(chatTitle([{ role: "user", content: `  ${"word ".repeat(40)}`, files: [] }]).length).toBeLessThanOrEqual(70);
    expect(chatTitle([])).toBe("Conversation");
  });

  it("drops damaged entries instead of breaking, and sorts newest first", () => {
    const raw = JSON.stringify([chat("old", 1), { id: 5 }, null, chat("new", 9), { ...chat("bad", 3), turns: [{ role: "user" }] }]);
    expect(parseChats(raw).map((c) => c.id)).toEqual(["new", "old"]);
    expect(parseChats("not json")).toEqual([]);
    expect(parseChats(null)).toEqual([]);
    expect(parseChats('{"a":1}')).toEqual([]);
  });

  it("replaces a conversation by id and keeps at most the limit", () => {
    const many = Array.from({ length: MAX_CHATS + 5 }, (_, i) => chat(`c${i}`, i));
    const next = upsertChat(many, { ...chat("c3", 1000), title: "renamed" });
    expect(next).toHaveLength(MAX_CHATS);
    expect(next[0]?.title).toBe("renamed");
    expect(next.filter((c) => c.id === "c3")).toHaveLength(1);
    expect(next.some((c) => c.id === "c0")).toBe(false);
  });

  describe("storage in the profile", () => {
    const ids = (row: { value: unknown } | undefined) => ((row?.value ?? []) as SavedChat[]).map((c) => c.id);
    const legacy = new Map<string, string>();
    beforeEach(async () => {
      legacy.clear();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => legacy.get(k) ?? null,
        setItem: (k: string, v: string) => void legacy.set(k, v),
        removeItem: (k: string) => void legacy.delete(k),
      });
      await db.settings.clear();
      resetHistory();
    });

    it("saves to the profile's settings, reloads them, and can delete one or all", async () => {
      await loadHistory(null);
      saveChat(chat("a", 1));
      saveChat(chat("b", 2));
      expect(loadChats().map((c) => c.id)).toEqual(["b", "a"]);
      await vi.waitFor(async () => expect(ids(await db.settings.get(SETTINGS_KEY))).toEqual(["b", "a"]));
      resetHistory();
      expect(loadChats()).toEqual([]);
      await loadHistory(null);
      expect(loadChats().map((c) => c.id)).toEqual(["b", "a"]);
      deleteChat("b");
      expect(loadChats().map((c) => c.id)).toEqual(["a"]);
      clearChats();
      expect(loadChats()).toEqual([]);
      await vi.waitFor(async () => expect(await db.settings.get(SETTINGS_KEY)).toBeUndefined());
    });

    it("moves a list the browser kept before into the profile, once", async () => {
      legacy.set("bt:brain-chats:anna", JSON.stringify([chat("old", 5)]));
      await db.settings.put({ key: SETTINGS_KEY, value: [chat("new", 9)] });
      await loadHistory("anna");
      expect(loadChats().map((c) => c.id)).toEqual(["new", "old"]);
      expect(legacy.has("bt:brain-chats:anna")).toBe(false);
      expect(ids(await db.settings.get(SETTINGS_KEY))).toEqual(["new", "old"]);
    });

    it("keeps what was saved while the list was loading", async () => {
      await db.settings.put({ key: SETTINGS_KEY, value: [chat("stored", 1)] });
      saveChat(chat("fresh", 2));
      await loadHistory(null);
      expect(loadChats().map((c) => c.id)).toEqual(["fresh", "stored"]);
    });

    it("drops the oldest conversations when the list gets too big", () => {
      const big = (id: string, updated: number): SavedChat => ({
        id,
        title: id,
        updated,
        turns: [{ role: "user", content: "x".repeat(1_200_000), files: [] }],
      });
      const fit = fitChats([big("c", 3), big("b", 2), big("a", 1)]);
      expect(fit.map((c) => c.id)).toEqual(["c", "b"]);
    });
  });
});
