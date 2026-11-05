import { describe, expect, it } from "vitest";
import { isSleepSession, sleepLocalTime, validSleepSessions } from "@bt/core/sleepSessions";
import type { SleepSession } from "@bt/core/types";

const session: SleepSession = {
  start: "2026-10-24T23:15:00", end: "2026-10-25T07:30:00", kind: "asleep", source: "Test watch",
};

describe("source-local sleep timestamps", () => {
  it("parses seconds and milliseconds as wall-clock coordinates without applying the computer's zone", () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
        process.env.TZ = zone;
        expect(sleepLocalTime("2026-10-25T07:30:00")).toBe(Date.UTC(2026, 9, 25, 7, 30));
        expect(sleepLocalTime("2024-02-29T00:00:00.125")).toBe(Date.UTC(2024, 1, 29, 0, 0, 0, 125));
        expect(sleepLocalTime(session.end)! - sleepLocalTime(session.start)!).toBe(8.25 * 3_600_000);
        expect(validSleepSessions([session], "sleep_duration", "2026-10-25")).toBe(true);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it.each([
    "", "2026-10-25", "2026-10-25 07:30:00", "2026-10-25T07:30", "2026-1-25T07:30:00",
    "2026-10-25T7:30:00", "2026-10-25T24:00:00", "2026-10-25T07:60:00", "2026-10-25T07:30:60",
    "2023-02-29T07:30:00", "2026-04-31T07:30:00", "2026-00-25T07:30:00", "2026-10-00T07:30:00",
    "2026-10-25T07:30:00.1", "2026-10-25T07:30:00.1234", "2026-10-25T07:30:00Z",
    "2026-10-25T07:30:00+02:00", " 2026-10-25T07:30:00", "2026-10-25T07:30:00\n",
  ])("rejects non-local or malformed timestamp %j", (value) => {
    expect(sleepLocalTime(value)).toBeUndefined();
  });

  it("does not coerce non-string timestamps", () => {
    for (const value of [null, undefined, 0, [session.start], { toString: () => session.start }])
      expect(sleepLocalTime(value as unknown as string)).toBeUndefined();
  });
});

describe("sleep session validation", () => {
  it("accepts all recorded boundary kinds and optional known offsets without requiring them", () => {
    for (const kind of ["asleep", "in-bed", "session"] as const) {
      expect(isSleepSession({ ...session, kind })).toBe(true);
      expect(isSleepSession({ ...session, kind, startOffsetMinutes: 120, endOffsetMinutes: 60 })).toBe(true);
    }
    for (const offset of [-840, 0, 840]) {
      expect(isSleepSession({ ...session, startOffsetMinutes: offset })).toBe(true);
      expect(isSleepSession({ ...session, endOffsetMinutes: offset })).toBe(true);
    }
    expect(isSleepSession({ ...session, source: undefined })).toBe(true);
    expect(isSleepSession({ ...session, source: "x".repeat(200) })).toBe(true);
  });

  it("rejects malformed shapes, field types and coerced boundary kinds", () => {
    const bad: unknown[] = [
      undefined, null, [], "sleep", {}, { ...session, start: 1 }, { ...session, end: null },
      { ...session, kind: undefined }, { ...session, kind: "bedtime" }, { ...session, kind: ["asleep"] },
      { ...session, source: 1 }, { ...session, source: "x".repeat(201) },
      { ...session, start: "2026-10-24T23:15:00Z" }, { ...session, end: "2026-02-30T07:30:00" },
    ];
    for (const value of bad) expect(isSleepSession(value), JSON.stringify(value)).toBe(false);
  });

  it("requires integer, finite offsets within fourteen hours east or west of UTC", () => {
    for (const offset of [null, "120", 1.5, -841, 841, NaN, Infinity, -Infinity]) {
      expect(isSleepSession({ ...session, startOffsetMinutes: offset })).toBe(false);
      expect(isSleepSession({ ...session, endOffsetMinutes: offset })).toBe(false);
    }
  });

  it("bounds wall-clock durations to more than zero and at most thirty-six hours", () => {
    expect(isSleepSession({ ...session, start: session.end })).toBe(false);
    expect(isSleepSession({ ...session, start: "2026-10-25T08:00:00" })).toBe(false);
    expect(isSleepSession({ ...session, start: "2026-10-25T07:29:59.999" })).toBe(true);
    expect(isSleepSession({ ...session, start: "2026-10-23T19:30:00" })).toBe(true);
    expect(isSleepSession({ ...session, start: "2026-10-23T19:29:59.999" })).toBe(false);
  });

  it("uses elapsed duration only with both offsets, including daylight-saving clock reversal", () => {
    const reversed = { ...session, start: "2026-10-25T02:30:00", end: "2026-10-25T02:15:00" };
    expect(isSleepSession({ ...reversed, startOffsetMinutes: 120, endOffsetMinutes: 60 })).toBe(true);
    expect(isSleepSession({ ...reversed, startOffsetMinutes: 120 })).toBe(false);
    expect(isSleepSession({ ...reversed, endOffsetMinutes: 60 })).toBe(false);
    expect(isSleepSession({ ...reversed, startOffsetMinutes: 60, endOffsetMinutes: 120 })).toBe(false);
    const limit = { ...session, start: "2026-10-23T19:30:00", startOffsetMinutes: 120 };
    expect(isSleepSession({ ...limit, endOffsetMinutes: 120 })).toBe(true);
    expect(isSleepSession({ ...limit, endOffsetMinutes: 60 })).toBe(false);
  });
});

describe("sleep timing attached to a waking-day measurement", () => {
  it("keeps separate naps and mixed recorded boundary kinds on their actual local waking date", () => {
    const nap: SleepSession = { start: "2026-10-25T14:00:00", end: "2026-10-25T14:45:00", kind: "session" };
    expect(validSleepSessions([session, nap], "sleep_duration", "2026-10-25")).toBe(true);
    expect(validSleepSessions([session], "sleep_deep", "2026-10-25")).toBe(false);
    expect(validSleepSessions([session], "sleep_rem", "2026-10-25")).toBe(false);
    expect(validSleepSessions([session], "resting_hr", "2026-10-25")).toBe(false);
    expect(validSleepSessions([session], "sleep_duration", "2026-10-24")).toBe(false);
    expect(validSleepSessions([session], "sleep_duration", "2026-10-26")).toBe(false);
    expect(validSleepSessions([session], "sleep_duration", "2026-02-30")).toBe(false);
  });

  it("rejects absent, empty, oversized, sparse or partially damaged arrays", () => {
    for (const value of [undefined, null, {}, session, [], [session, null], new Array(1), Array(65).fill(session)])
      expect(validSleepSessions(value, "sleep_duration", "2026-10-25")).toBe(false);
    expect(validSleepSessions(Array(64).fill(session), "sleep_duration", "2026-10-25")).toBe(true);
    expect(validSleepSessions([session, { ...session, end: "2026-10-26T07:30:00" }], "sleep_duration", "2026-10-25")).toBe(false);
  });
});
