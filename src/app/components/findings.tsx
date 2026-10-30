import { sortFindings, type FindingEffect, type NutrientFinding } from "../../core/nutrients";
import { GradeBadge, GradeDots, StudyLink } from "./evidence";
import { anchorId, jump } from "./glance";
import { Card, cx } from "./ui";

export const EFFECT: Record<FindingEffect, { label: string; mark: string; className: string }> = {
  helps: { label: "Helped", mark: "+", className: "bg-ok-soft text-ok" },
  "no clear effect": { label: "No clear effect", mark: "=", className: "bg-sunken text-ink-2" },
  mixed: { label: "Mixed results", mark: "±", className: "bg-sunken text-ink-2" },
  harms: { label: "Harmed", mark: "!", className: "bg-danger-soft text-danger" },
};

const GROUPS: { title: string; effects: FindingEffect[]; mark: string; markClass: string }[] = [
  { title: "Shown in studies", effects: ["helps"], mark: "✓", markClass: "text-ok" },
  { title: "Risks found", effects: ["harms"], mark: "!", markClass: "text-danger" },
  { title: "Not shown yet", effects: ["mixed", "no clear effect"], mark: "–", markClass: "text-ink-2" },
];

const GRADE_WORD: Record<NutrientFinding["grade"], string> = { high: "High", moderate: "Moderate", low: "Low", "very low": "Very low" };

/**
 * "Main uses & benefits": every finding as a bold short name and one plain line, grouped by what studies
 * showed, with the evidence grade beside it. Each row jumps to its full card. Findings without the short
 * fields fall back to their outcome and result.
 */
function MainUses({ findings, prefix, caption }: { findings: NutrientFinding[]; prefix: string; caption: string }) {
  const sorted = sortFindings(findings);
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-sunken p-3" aria-label={caption}>
      {GROUPS.map((g) => {
        const rows = sorted.filter((f) => g.effects.includes(f.effect));
        if (!rows.length) return null;
        return (
          <section key={g.title} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-ink-2">{g.title}</h3>
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((f) => {
                const id = anchorId(prefix, `${f.outcome} ${f.population}`);
                return (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      onClick={(e) => jump(e, id)}
                      className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 py-2 text-ink no-underline hover:bg-surface/60 sm:grid-cols-[1rem_minmax(0,14rem)_minmax(0,1fr)_auto]"
                    >
                      <span aria-hidden="true" className={cx("font-medium", g.markClass)}>
                        {g.mark}
                      </span>
                      <span className="font-semibold">{f.label ?? f.outcome}</span>
                      <span className="col-start-2 row-start-2 text-ink-2 sm:col-start-3 sm:row-start-1">{f.line ?? EFFECT[f.effect].label}</span>
                      <span className="col-start-3 row-start-1 flex items-center gap-1.5 justify-self-end text-xs whitespace-nowrap text-ink-2 sm:col-start-4" title={`${GRADE_WORD[f.grade]} evidence`}>
                        <GradeDots grade={f.grade} />
                        <span className="hidden sm:inline">{GRADE_WORD[f.grade]}</span>
                        <span className="sr-only sm:hidden">{GRADE_WORD[f.grade]} evidence</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Graded findings: main uses and benefits at a glance, then a card per outcome with its bottom line first (nutrient, lifestyle and food pages). */
export function Findings({ title, intro, findings, prefix }: { title: string; intro: string; findings: NutrientFinding[]; prefix: string }) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">{title}</h2>
        <p className="mt-1 text-ink-2">{intro}</p>
      </div>
      <MainUses findings={findings} prefix={prefix} caption={title} />
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
