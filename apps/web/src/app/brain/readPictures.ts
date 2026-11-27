// Brain reads a lab report's pictures for the bulk import, outside the chat: one question per report, sent with
// an empty profile (no results, habits or profile details, only the pictures), and the results it proposes come
// back as a parsed report for the review screen. Nothing is saved here.
import { MAX_PHOTOS } from "@bt/shared/core/aiProviders";
import { todayIso } from "@bt/shared/core/dates";
import type { ParsedReport } from "@bt/shared/core/importers/labText";
import { parseResultProposal } from "@bt/shared/core/importers/resultProposal";
import { BIOMARKER_MAP } from "../knowledge";
import type { PreparedPhoto } from "./photo";
import { READ_REPORT_QUESTION } from "./store";

interface Reply {
  ok: boolean;
  text?: string;
  error?: string;
  steps?: { tool: string; server?: string; validated?: boolean; success?: boolean; output?: unknown }[];
}

const EMPTY_SNAPSHOT = { measurements: [], protocols: [], experiments: [], profile: {} };

async function readOnce(images: PreparedPhoto[], signal: AbortSignal): Promise<ParsedReport | string> {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-bt": "1" },
    body: JSON.stringify({ messages: [{ role: "user", content: READ_REPORT_QUESTION, images }], snapshot: EMPTY_SNAPSHOT, userText: READ_REPORT_QUESTION }),
    signal,
  });
  const r = (await res.json().catch(() => ({ ok: false, error: `Request failed (${res.status}).` }))) as Reply;
  if (!res.ok || !r.ok) return r.error ?? `Request failed (${res.status}).`;
  const reports = (r.steps ?? []).flatMap((st) => {
    if (st.server !== undefined || st.tool !== "propose_results" || st.validated !== true || st.success !== true || !st.output) return [];
    const p = parseResultProposal((st.output as { shownToPerson?: unknown }).shownToPerson, BIOMARKER_MAP, todayIso());
    return p.ok ? [p.report] : [];
  });
  if (!reports.length) return r.text?.trim() ? `Brain found no results it could read: ${r.text.trim().slice(0, 300)}` : "Brain found no results it could read.";
  return {
    rows: reports.flatMap((x) => x.rows),
    unmatched: reports.flatMap((x) => x.unmatched),
    ...(reports.find((x) => x.date)?.date ? { date: reports.find((x) => x.date)!.date! } : {}),
    ...(reports.some((x) => x.dateNote) ? { dateNote: reports.flatMap((x) => (x.dateNote ? [x.dateNote] : [])).join(" ") } : {}),
  };
}

/** Reads one report's pictures (a photo, or a scanned PDF's pages, in groups the server accepts). */
export async function readPicturesWithBrain(images: PreparedPhoto[], signal: AbortSignal): Promise<ParsedReport | string> {
  const parts: ParsedReport[] = [];
  for (let i = 0; i < images.length; i += MAX_PHOTOS) {
    const r = await readOnce(images.slice(i, i + MAX_PHOTOS), signal);
    if (typeof r === "string") {
      if (images.length <= MAX_PHOTOS) return r;
      continue;
    }
    parts.push(r);
  }
  if (!parts.length) return "Brain found no results it could read.";
  const date = parts.find((p) => p.date)?.date;
  return { rows: parts.flatMap((p) => p.rows), unmatched: parts.flatMap((p) => p.unmatched), ...(date ? { date } : {}) };
}
