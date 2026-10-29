import type { ReactNode } from "react";
import type { EvidenceGrade } from "../../core/types";
import { GradeDots } from "./evidence";

/**
 * An at-a-glance table over a list of findings or claims: one row each with its result and the
 * strength of evidence, linking down to the full card. Read in seconds; nothing is hidden by it.
 */
export function Glance({ rows, caption }: { rows: { id: string; label: string; result: ReactNode; grade: EvidenceGrade }[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-sunken px-3 py-2">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-ink-2">
          <tr>
            <th className="py-1.5 pr-3 font-medium">At a glance</th>
            <th className="py-1.5 pr-3 font-medium">Result</th>
            <th className="py-1.5 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 pr-3">
                <a href={`#${r.id}`} onClick={(e) => jump(e, r.id)} className="text-ink underline-offset-2 hover:underline">
                  {r.label}
                </a>
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{r.result}</td>
              <td className="py-1.5">
                <span className="flex items-center gap-1.5 whitespace-nowrap text-ink-2">
                  <GradeDots grade={r.grade} />
                  <span className="hidden sm:inline">{r.grade[0]!.toUpperCase() + r.grade.slice(1)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The app routes on the hash, so in-page links scroll by hand instead of changing it. */
export function jump(e: React.MouseEvent, id: string) {
  e.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

/** A stable id for a card, from its text. */
export const anchorId = (prefix: string, text: string) => `${prefix}-${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60)}`;
