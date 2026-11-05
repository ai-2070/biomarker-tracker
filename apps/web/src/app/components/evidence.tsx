import type { Citation, EvidenceGrade } from "@bt/core/types";
import { cx } from "./ui";
import { PaperLink } from "./PaperLink";

/** Evidence grades as dots and a word, never colour alone. */
export const GRADE: Record<EvidenceGrade, { dots: string; label: string }> = {
  high: { dots: "●●●", label: "High" },
  moderate: { dots: "●●○", label: "Moderate" },
  low: { dots: "●○○", label: "Low" },
  "very low": { dots: "○○○", label: "Very low" },
};

export const STUDY_LABEL: Record<Citation["studyType"], string> = {
  "meta-analysis": "Meta-analysis",
  rct: "Randomised trial",
  observational: "Observational study",
  animal: "Animal study",
  "in vitro": "Lab study",
  review: "Review",
  guideline: "Guideline",
};

const FILLED: Record<EvidenceGrade, number> = { high: 3, moderate: 2, low: 1, "very low": 0 };

/** Three small dots, filled for the grade: drawn, so they match the icon set. */
export function GradeDots({ grade }: { grade: EvidenceGrade }) {
  return (
    <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true" className="shrink-0">
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={4 + i * 7} cy="4" r="3" className={i < FILLED[grade] ? "fill-accent" : "fill-none stroke-line-strong"} strokeWidth="1.25" />
      ))}
    </svg>
  );
}

/** The evidence grade: dots and a word. `short` drops "evidence" (for rows). */
export function GradeBadge({ grade, className, short = false }: { grade: EvidenceGrade; className?: string; short?: boolean }) {
  const g = GRADE[grade];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap", short ? "text-xs text-ink-2" : "rounded-full bg-sunken px-2 py-0.5 text-sm font-medium", className)}>
      <GradeDots grade={grade} />
      {short ? g.label : `${g.label} evidence`}
    </span>
  );
}

/** A study: title linking to PubMed (or the DOI), year and kind. Opens outside the app. */
export function StudyLink({ s }: { s: Citation }) {
  const url = s.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` : `https://doi.org/${s.doi}`;
  return (
    <>
      <PaperLink href={url} source={{ title: s.title, year: s.year, kind: STUDY_LABEL[s.studyType], n: s.n }} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
        {s.title}
      </PaperLink>{" "}
      ({s.year}, {STUDY_LABEL[s.studyType]}
      {s.n ? `, ${s.n.toLocaleString("en-GB")} people` : ""})
    </>
  );
}
