import type { Citation, EvidenceGrade } from "../../core/types";
import { cx } from "./ui";

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

export function GradeBadge({ grade, className }: { grade: EvidenceGrade; className?: string }) {
  const g = GRADE[grade];
  return (
    <span className={cx("inline-flex items-center rounded-full bg-sunken px-2 py-0.5 text-sm font-medium whitespace-nowrap", className)}>
      <span aria-hidden="true" className="mr-1 tracking-tight text-accent">
        {g.dots}
      </span>
      {g.label} evidence
    </span>
  );
}

/** A study: title linking to PubMed (or the DOI), year and kind. Opens outside the app. */
export function StudyLink({ s }: { s: Citation }) {
  const url = s.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` : `https://doi.org/${s.doi}`;
  return (
    <>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
        {s.title}
      </a>{" "}
      ({s.year}, {STUDY_LABEL[s.studyType]}
      {s.n ? `, ${s.n.toLocaleString("en-GB")} people` : ""})
    </>
  );
}
