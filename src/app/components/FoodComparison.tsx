import { useState } from "react";
import type { ComparisonClaim, ComparisonTopic, Verdict } from "../../core/foodComparison";
import { FOOD_COMPARISON } from "../knowledge";
import { GradeBadge, StudyLink } from "./evidence";
import { Glance } from "./glance";
import { segBtn } from "./timeControls";
import { Card, cx } from "./ui";

const HEADING: Record<ComparisonTopic, string> = {
  matrix: "The animal matrix",
  absorption: "Absorption",
  vitamins: "Vitamins",
  safety: "Safety",
};

/** Verdicts as a word and a mark, never colour alone. */
const VERDICT: Record<Verdict, { mark: string; className: string }> = {
  supported: { mark: "✓", className: "bg-ok-soft text-ok" },
  "partly supported": { mark: "◐", className: "bg-sunken text-ink" },
  mixed: { mark: "±", className: "bg-sunken text-ink-2" },
  "not supported": { mark: "✕", className: "bg-danger-soft text-danger" },
  "not enough evidence": { mark: "?", className: "bg-sunken text-ink-2" },
};

/**
 * Animal foods, fruit and other plant foods compared, claim by claim: each one as people make it, then
 * what the evidence says, with a verdict, a grade and the other side. No diet is recommended.
 */
export function FoodComparison() {
  const [topic, setTopic] = useState<ComparisonTopic>(FOOD_COMPARISON[0]?.topic ?? "matrix");
  if (FOOD_COMPARISON.length === 0) return null;
  const current = FOOD_COMPARISON.find((t) => t.topic === topic) ?? FOOD_COMPARISON[0]!;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">Whole foods</p>
        <h2 className="font-serif text-2xl font-normal">Animal foods, fruit and plants: what research says</h2>
        <p className="mt-1 text-ink-2">
          Claims people make about animal and plant foods, one by one, with what the studies show, how strong that evidence is, and the other
          side where there is one. No diet is recommended here.
        </p>
      </div>

      <div role="tablist" aria-label="Topic" className="flex flex-wrap gap-1 rounded-xl border border-line bg-sunken p-1 sm:self-start">
        {FOOD_COMPARISON.map((t) => (
          <button
            key={t.topic}
            role="tab"
            type="button"
            aria-selected={t.topic === current.topic}
            onClick={() => setTopic(t.topic)}
            className={cx(segBtn, "px-3", t.topic === current.topic ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
          >
            {HEADING[t.topic]}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="flex flex-col gap-3">
        <div>
          <h3 className="font-serif text-xl font-normal">{current.title}</h3>
          <p className="text-ink-2">{current.intro}</p>
        </div>
        <Glance
          caption={current.title}
          rows={current.claims.map((c) => ({
            id: `claim-${c.id}`,
            label: c.claim,
            result: <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", VERDICT[c.verdict].className)}>{c.verdict[0]!.toUpperCase() + c.verdict.slice(1)}</span>,
            grade: c.grade,
          }))}
        />
        <ul className="flex flex-col gap-3">
          {current.claims.map((c) => (
            <li key={c.id}>
              <Claim c={c} />
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-ink-2">
        Verdicts and grades are a first draft, checked against the cited studies but not reviewed by a clinician. Absorption and lab studies can
        be precise about absorption and still say little about long-term health.
      </p>
    </Card>
  );
}

function Claim({ c }: { c: ComparisonClaim }) {
  const v = VERDICT[c.verdict];
  return (
    <article id={`claim-${c.id}`} tabIndex={-1} className="flex scroll-mt-6 flex-col gap-2 rounded-lg border border-line p-3 outline-none">
      <p className="font-medium">“{c.claim}”</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cx("rounded-full px-2 py-0.5 font-medium", v.className)}>
          <span aria-hidden="true" className="mr-1">
            {v.mark}
          </span>
          {c.verdict[0]!.toUpperCase() + c.verdict.slice(1)}
        </span>
        <GradeBadge grade={c.grade} />
        {c.favours !== "neither" && c.favours !== "depends" ? (
          <span className="rounded-full bg-sunken px-2 py-0.5 text-ink-2">Favours {c.favours}</span>
        ) : c.favours === "depends" ? (
          <span className="rounded-full bg-sunken px-2 py-0.5 text-ink-2">Depends on the food</span>
        ) : null}
      </div>
      <p>{c.bottomLine ?? c.summary}</p>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-2">{c.bottomLine ? "Read the full summary, why this grade, and sources" : "Why this grade, and sources"}</summary>
        {c.bottomLine && <p className="mb-3">{c.summary}</p>}
        <p className="mb-1 text-sm font-medium">Why this grade</p>
        <ul className="list-disc pl-5 text-sm text-ink-2">
          {c.whyThisGrade.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
          {c.studies.map((s) => (
            <li key={s.pmid ?? s.doi}>
              <StudyLink s={s} />
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
