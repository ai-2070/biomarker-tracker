import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, deleteEverything, getProfile } from "../../apps/web/src/db/db";
import { browserData, createProfile, deleteProfileFolder, flushSaving, hasBrowserData, loadIntoBrowser, restoreProfile, startSaving, switchProfile } from "../../apps/web/src/app/profiles";
import { setIntakeList } from "../../apps/web/src/app/hooks";
import { FakeError, fakeServer } from "./fakeServer";

const row = { id: "m", biomarkerId: "ferritin", date: "2026-01-01", value: 40, originalValue: 40, originalUnit: "µg/L", source: "manual" as const };
let stop: (() => void) | undefined;
const empty = { person: { name: "B" }, measurements: [], protocols: [], experiments: [], plans: [], meals: [], settings: {} };
async function seedA() {
  await db.measurements.put(row);
  await db.settings.bulkPut([{ key: "profile", value: { name: "A" } }, { key: "loadedProfile", value: "a" }, { key: "onboarded", value: true }]);
}
beforeEach(async () => { await db.open(); await deleteEverything(); vi.stubGlobal("location", { hash: "", reload: vi.fn() }); });
afterEach(async () => { stop?.(); stop = undefined; vi.unstubAllGlobals(); await db.delete(); });

describe("profile persistence review repairs", () => {
  it("reconciles retained pending edits on startup without needing a new edit", async () => {
    await seedA();
    const puts: unknown[] = [];
    fakeServer(({ path, input }) => { puts.push({ path, ...input }); return { ok: true }; });
    stop = startSaving("a");
    await vi.waitFor(() => expect(puts).toHaveLength(1), { timeout: 2000 });
    expect(puts[0]).toMatchObject({ path: "profiles.save", id: "a", data: { person: { name: "A" }, measurements: [row] } });
  });

  it("refuses a snapshot owned by a different profile before any upload", async () => {
    await seedA();
    await db.settings.put({ key: "loadedProfile", value: "b" });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(browserData("a")).rejects.toThrow(/Another profile/);
    stop = startSaving("a");
    await expect(flushSaving()).rejects.toThrow(/Another profile/);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await db.measurements.toArray()).map((m) => m.id)).toEqual(["m"]);
  });

  it("does not switch or erase the working copy when its flush fails", async () => {
    await seedA();
    const requests: string[] = [];
    fakeServer(({ path, input }) => { requests.push(`${path} ${input.id}`); throw new FakeError("disk full"); });
    stop = startSaving("a");
    await expect(switchProfile("b")).rejects.toThrow("disk full");
    expect(requests).toEqual(["profiles.save a"]);
    expect(await getProfile()).toEqual({ name: "A" });
    expect(await db.measurements.toArray()).toEqual([row]);
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("keeps autosave available after an invalid restore request", async () => {
    await seedA();
    const saves: { person: { name: string } }[] = [];
    fakeServer(({ input }) => {
      // A full save, or after the first one only the changed parts.
      saves.push(input.parts ?? input.data);
      return { ok: true };
    }, (url) => url.endsWith("/restore") ? Response.json({ error: "damaged ZIP" }, { status: 400 }) : Response.json({}, { status: 404 }));
    stop = startSaving("a");
    await expect(restoreProfile(new File(["bad"], "bad.zip"))).rejects.toThrow("damaged ZIP");
    await db.settings.put({ key: "profile", value: { name: "Edited A" } });
    await flushSaving();
    expect(saves.at(-1)?.person.name).toBe("Edited A");
    expect((await db.settings.get("loadedProfile"))?.value).toBe("a");
  });

  it("resumes the original saver when adopting a newly created folder fails", async () => {
    await seedA();
    const saves: { person: { name: string } }[] = [];
    fakeServer(({ path, input }) => {
      if (path === "profiles.create") return { profile: { id: "b", person: { name: "B" } } };
      saves.push(input.parts ?? input.data);
      return { ok: true };
    });
    stop = startSaving("a");
    const fail = (_changes: unknown, key: unknown) => { if (key === "loadedProfile") throw new Error("adoption failed"); };
    db.settings.hook("updating", fail);
    try {
      await expect(createProfile({ name: "B" }, { fromBrowser: true })).rejects.toThrow("adoption failed");
    } finally { db.settings.hook("updating").unsubscribe(fail); }
    await db.settings.put({ key: "profile", value: { name: "Still A" } });
    await flushSaving();
    expect(saves.at(-1)?.person.name).toBe("Still A");
    expect((await db.settings.get("loadedProfile"))?.value).toBe("a");
    stop = startSaving("a");
  });

  it("serializes uploads and flush waits until the newest pending snapshot is durable", async () => {
    await seedA();
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const writes: number[] = [];
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    fakeServer(async ({ input }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (++calls === 1) { firstStarted.resolve(); await releaseFirst.promise; }
      writes.push((input.parts ?? input.data).measurements.length);
      active -= 1;
      return { ok: true };
    });
    stop = startSaving("a");
    const first = flushSaving();
    await firstStarted.promise;
    await db.measurements.put({ ...row, id: "m2", date: "2026-02-01" });
    const second = flushSaving();
    try {
      // A database barrier completes any snapshot read already admitted by the second flush.
      await browserData("a");
      expect(maximumActive).toBe(1);
    } finally { releaseFirst.resolve(); }
    await Promise.all([first, second]);
    expect(maximumActive).toBe(1);
    expect(writes.at(-1)).toBe(2);
    expect(writes[0]).toBe(1);
  });

  it("rejects invalid loaded identities without replacing the current person", async () => {
    await seedA();
    fakeServer(() => ({ ...empty, measurements: [row, { ...row, value: 70 }] }));
    await expect(loadIntoBrowser("b")).rejects.toThrow(/duplicate IDs/);
    expect(await getProfile()).toEqual({ name: "A" });
    expect(await db.measurements.toArray()).toEqual([row]);
  });

  it("a failed profile fetch preserves the source working copy", async () => {
    await seedA();
    fakeServer(() => { throw new FakeError("results.json cannot be read"); });
    await expect(loadIntoBrowser("b")).rejects.toThrow(/cannot be read/);
    expect(await db.measurements.toArray()).toEqual([row]);
    expect((await db.settings.get("loadedProfile"))?.value).toBe("a");
  });

  it("deleting the open folder clears its entire recovery copy before new setup", async () => {
    await seedA();
    await db.settings.put({ key: "intakeList", value: [{ private: true }] });
    fakeServer(() => ({ ok: true, active: null }));
    stop = startSaving("a");
    await deleteProfileFolder("a");
    expect(await browserData()).toEqual({ person: {}, measurements: [], protocols: [], experiments: [], plans: [], meals: [], settings: {} });
    expect(await db.settings.toArray()).toEqual([]);
    expect(await hasBrowserData()).toBe(false);
  });

  it.each(["plans", "meals", "protocols", "experiments", "profile", "intakeList"])("recognizes %s-only browser data for migration", async (kind) => {
    expect(await hasBrowserData()).toBe(false);
    if (kind === "profile") await db.settings.put({ key: kind, value: { name: "A" } });
    else if (kind === "intakeList") await db.settings.put({ key: kind, value: [{ kind: "food", foodId: "a", grams: 10 }] });
    else await db.table(kind).put({ id: "record" });
    expect(await hasBrowserData()).toBe(true);
  });

  it("rejects a 61st intake item without hiding/replacing the previous list", async () => {
    const current = Array.from({ length: 60 }, (_, i) => ({ id: String(i), kind: "food" as const, foodId: "a", grams: 100 }));
    await setIntakeList(current);
    await expect(setIntakeList([...current, current[0]!])).rejects.toThrow(/60/);
    expect((await db.settings.get("intakeList"))?.value).toEqual(current);
  });

  it("allows a legacy oversized intake list to shrink without allowing new growth", async () => {
    const current = Array.from({ length: 63 }, (_, i) => ({ id: String(i), kind: "food" as const, foodId: "a", grams: 100 }));
    await db.settings.put({ key: "intakeList", value: current });
    await setIntakeList(current.slice(0, 62));
    await expect(setIntakeList(current)).rejects.toThrow(/60/);
    expect((await db.settings.get("intakeList"))?.value).toEqual(current.slice(0, 62));
    await setIntakeList(current.slice(0, 60));
    expect((await db.settings.get("intakeList"))?.value).toEqual(current.slice(0, 60));
  });
});

describe("saves send only what changed", () => {
  it("sends everything first, then only the changed part, and nothing when nothing changed", async () => {
    await seedA();
    const requests: { path: string; input: Record<string, unknown> }[] = [];
    fakeServer(({ path, input }) => {
      requests.push({ path, input });
      return { ok: true };
    });
    stop = startSaving("a");
    await flushSaving();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: "profiles.save", input: { id: "a", data: { person: { name: "A" }, measurements: [row] } } });
    await db.measurements.put({ ...row, id: "m2", date: "2026-02-01" });
    await flushSaving();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.path).toBe("profiles.saveParts");
    expect(Object.keys(requests[1]!.input.parts as object)).toEqual(["measurements"]);
    expect((requests[1]!.input.parts as { measurements: unknown[] }).measurements).toHaveLength(2);
    await flushSaving();
    expect(requests).toHaveLength(2);
  });

  it("after a failed save, sends everything again", async () => {
    await seedA();
    const requests: { path: string; input: Record<string, unknown> }[] = [];
    let fail = false;
    fakeServer(({ path, input }) => {
      requests.push({ path, input });
      if (fail) throw new FakeError("disk full");
      return { ok: true };
    });
    stop = startSaving("a");
    await flushSaving();
    fail = true;
    await db.settings.put({ key: "profile", value: { name: "A2" } });
    await expect(flushSaving()).rejects.toThrow("disk full");
    expect(requests[1]).toMatchObject({ path: "profiles.saveParts", input: { parts: { person: { name: "A2" } } } });
    fail = false;
    await flushSaving();
    expect(requests.at(-1)).toMatchObject({ path: "profiles.save", input: { data: { person: { name: "A2" }, measurements: [row] } } });
  });
});
