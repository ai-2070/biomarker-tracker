import { sortFindings, type FindingEffect, type NutrientFinding } from "../../core/nutrients";
import { GradeBadge, StudyLink } from "./evidence";
import { Glance, anchorId } from "./glance";
import { Card, cx } from "./ui";

export const EFFECT: Record<FindingEffect, { label: string; mark: string; className: string }> = {
  helps: { label: "Helped", mark: "+", className: "bg-ok-soft text-ok" },
  "no clear effect": { label: "No clear effect", mark: "=", className: "bg-sunken text-ink-2" },
  mixed: { label: "Mixed results", mark: "±", className: "bg-sunken text-ink-2" },
  harms: { label: "Harmed", mark: "!", className: "bg-danger-soft text-danger" },
};

/** Graded findings: an at-a-glance table, then a card per outcome with its bottom line first (nutrient and lifestyle pages). */
export function Findings({ title, intro, findings, prefix }: { title: string; intro: string; findings: NutrientFinding[]; prefix: string }) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">{title}</h2>
        <p className="mt-1 text-ink-2">{intro}</p>
      </div>
      <Glance
        caption={title}
        rows={sortFindings(findings).map((f) => ({
          id: anchorId(prefix, `${f.outcome} ${f.population}`),
          label: f.outcome,
          result: <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", EFFECT[f.effect].className)}>{EFFECT[f.effect].label}</span>,
          grade: f.grade,
        }))}
      />
      <ul className="flex flex-col gap-3">
        {sortFindings(findings).map((f) => {
          const e = EFFECT[f.effect];
          return (
            <li key={`${f.outcome}|${f.population}`}>
              <article id={anchorId(prefix, `${f.outcome} ${f.population}`)} tabIndex={-1} className="flex scroll-mt-6 flex-col gap-2 rounded-lg border border-line p-3 outline-none">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-medium">{f.outcome}</h3>
                  <span className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                    <span className={cx("rounded-full px-2 py-0.5 font-medium", e.className)}>
                      <span aria-hidden="true" className="mr-1 font-mono">
                        {e.mark}
                      </span>
                      {e.label}
                    </span>
                    <GradeBadge grade={f.grade} />
                  </span>
                </div>
                <p className="text-sm text-ink-2">
                  <span className="font-medium text-ink">Studied in: </span>
                  {f.population}
                </p>
                <p>{f.bottomLine ?? f.summary}</p>
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-2">{f.bottomLine ? "Read the full summary, why this grade, and sources" : "Why this grade, and sources"}</summary>
                  {f.bottomLine && <p className="mb-3">{f.summary}</p>}
                  <p className="mb-1 text-sm font-medium">Why this grade</p>
                  <ul className="list-disc pl-5 text-sm text-ink-2">
                    {f.whyThisGrade.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
                    {f.studies.map((s) => (
                      <li key={s.pmid ?? s.doi}>
                        <StudyLink s={s} />
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
