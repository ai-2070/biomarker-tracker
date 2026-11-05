import { isIsoDate } from "./dates";
import type { SleepSession } from "./types";

/** A local clock timestamp parsed as a wall-clock coordinate, independent of this computer's zone. */
export function sleepLocalTime(value: string): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?$/.exec(value);
  if (!match || match[0] !== value || !isIsoDate(match[1]!) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return undefined;
  const time = Date.parse(`${value}Z`);
  return Number.isFinite(time) ? time : undefined;
}

const offsetValid = (value: unknown) => value === undefined || (typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 14 * 60);

/** Structural bounds only, not a clinical definition of a healthy sleep session. */
export function isSleepSession(value: unknown): value is SleepSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (typeof session.start !== "string" || typeof session.end !== "string" ||
    (session.kind !== "asleep" && session.kind !== "in-bed" && session.kind !== "session")) return false;
  if (session.source !== undefined && (typeof session.source !== "string" || session.source.length > 200)) return false;
  const start = sleepLocalTime(session.start), end = sleepLocalTime(session.end);
  if (start === undefined || end === undefined || !offsetValid(session.startOffsetMinutes) || !offsetValid(session.endOffsetMinutes)) return false;
  const bothOffsets = typeof session.startOffsetMinutes === "number" && typeof session.endOffsetMinutes === "number";
  const duration = end - start - (bothOffsets ? ((session.endOffsetMinutes as number) - (session.startOffsetMinutes as number)) * 60_000 : 0);
  return duration > 0 && duration <= 36 * 3_600_000;
}

/** Metadata is tied to a sleep-duration reading's waking date, never to unrelated markers. */
export function validSleepSessions(value: unknown, biomarkerId: string, date: string): value is SleepSession[] {
  if (biomarkerId !== "sleep_duration" || !Array.isArray(value) || value.length === 0 || value.length > 64) return false;
  for (const session of value) if (!isSleepSession(session) || session.end.slice(0, 10) !== date) return false;
  return true;
}
