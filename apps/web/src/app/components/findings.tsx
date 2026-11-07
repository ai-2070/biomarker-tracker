import { sortFindings, type FindingEffect, type NutrientFinding } from "@bt/shared/core/nutrients";
import { GradeBadge, GradeDots, StudyLink } from "./evidence";
import { anchorId, jump } from "./glance";
import { Card, cx } from "./ui";
import { More } from "./disclosure";

export const EFFECT: Record<FindingEffect, { label: string; mark: string; className: string }> = {
  helps: { label: "Benefit reported", mark: "+", className: "bg-ok-soft text-ok" },
  "no clear effect": { label: "No clear effect", mark: "=", className: "bg-sunken text-ink-2" },
  mixed: { label: "Mixed results", mark: "±", className: "bg-sunken text-ink-2" },
  harms: { label: "Harm reported", mark: "!", className: "bg-danger-soft text-danger" },
};

const GRADE_WORD: Record<NutrientFinding["grade"], string> = { high: "High", moderate: "Moderate", low: "Low", "very low": "Very low" };

/** Short findings with their population in view; links reveal the full research card. */
function FindingOverview({ findings, prefix, caption }: { findings: NutrientFinding[]; prefix: string; caption: string }) {
  return (
    <ul className="flex flex-col divide-y divide-line" aria-label={caption}>
      {findings.map((f) => {
        const id = anchorId(prefix, `${f.outcome} ${f.population}`);
        return (
          <li key={id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <a href={`#${id}`} onClick={(e) => jump(e, id)} className="inline-flex min-h-11 items-center font-semibold text-ink underline-offset-4 hover:underline">
                {f.label ?? f.outcome}
              </a>
              <span className="flex items-center gap-1.5 text-xs text-ink-2">
                <GradeDots grade={f.grade} />
                {GRADE_WORD[f.grade]} evidence
              </span>
            </div>
            <p>{f.line ?? f.bottomLine ?? f.summary}</p>
            <p className="mt-1 text-sm text-ink-2">
              <span className="font-medium">Studied in: </span>
              {f.population}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Benefits first, harms visible, and uncertain uses kept separate from full research detail. */
export function Findings({ title, intro, findings, prefix }: { title: string; intro: string; findings: NutrientFinding[]; prefix: string }) {
  const sorted = sortFindings(findings);
  const benefits = sorted.filter((f) => f.effect === "helps");
  const harms = sorted.filter((f) => f.effect === "harms");
  const mixed = sorted.filter((f) => f.effect === "mixed");
  const noClearEffect = sorted.filter((f) => f.effect === "no clear effect");
  const otherCount = mixed.length + noClearEffect.length;
  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="font-serif text-2xl font-normal">{title}</h2>
        <p className="mt-1 text-ink-2">{intro}</p>
      </div>
      {benefits.length > 0 ? (
        <FindingOverview findings={benefits} prefix={prefix} caption="Uses with positive findings" />
      ) : (
        <p className="text-ink-2">These studies have not established a benefit for the outcomes below. See what was tested and who was studied in the research details.</p>
      )}
      {harms.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-line pt-4" aria-labelledby={`${prefix}-cautions`}>
          <h3 id={`${prefix}-cautions`} className="font-semibold">Risks found in studies</h3>
          <FindingOverview findings={harms} prefix={prefix} caption="Reported harms" />
        </section>
      )}
      {otherCount > 0 && (
        <More summary={<>Other uses studied ({otherCount})</>} tone="plain" className="border-t border-line pt-2">
          <div className="flex flex-col gap-5 pb-2">
            <p className="text-sm text-ink-2">These findings concern specific outcomes and groups of people, not an overall verdict on this food, supplement or habit.</p>
            {mixed.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="font-semibold">Mixed findings</h3>
                <p className="text-sm text-ink-2">Some studies or measures found a benefit and others did not.</p>
                <FindingOverview findings={mixed} prefix={prefix} caption="Uses with mixed findings" />
              </section>
            )}
            {noClearEffect.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="font-semibold">No clear benefit found</h3>
                <p className="text-sm text-ink-2">These studies did not find a clear benefit. Strong evidence can support that conclusion; limited evidence leaves more uncertainty.</p>
                <FindingOverview findings={noClearEffect} prefix={prefix} caption="Uses without a clear benefit" />
              </section>
            )}
          </div>
        </More>
      )}
      <More summary={<>Research details &amp; sources ({findings.length} {findings.length === 1 ? "finding" : "findings"})</>} id={`${prefix}-research`} tone="plain" className="border-t border-line pt-2">
        <ul className="flex flex-col gap-3 pt-2">
          {sorted.map((f) => {
            const e = EFFECT[f.effect];
            return (
              <li key={`${f.outcome}|${f.population}`}>
                <article id={anchorId(prefix, `${f.outcome} ${f.population}`)} tabIndex={-1} className="flex scroll-mt-6 flex-col gap-2 rounded-lg border border-line p-3 outline-none">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-medium">{f.outcome}</h3>
                    <span className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                      <span className={cx("rounded-full px-2 py-0.5 font-medium", e.className)}>
                        <span aria-hidden="true" className="mr-1 font-mono">{e.mark}</span>
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
                  <More summary={f.bottomLine ? "Full summary, evidence strength & sources" : "Evidence strength & sources"}>
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
                  </More>
                </article>
              </li>
            );
          })}
        </ul>
      </More>
    </Card>
  );
}
