import { useState } from "react";
import type { ComparisonTopic, Verdict } from "../../core/foodComparison";
import { FOOD_COMPARISON } from "../knowledge";
import { Chip, Row, Rows } from "./disclosure";
import { GradeBadge, StudyLink } from "./evidence";
import { segBtn } from "./timeControls";
import { cx } from "./ui";

const HEADING: Record<ComparisonTopic, string> = {
  matrix: "The animal matrix",
  absorption: "Absorption",
  vitamins: "Vitamins",
  safety: "Safety",
};

/** Verdicts as words; colour only repeats what the word says. */
const VERDICT: Record<Verdict, { label: string; tone: "ok" | "neutral" | "danger" }> = {
  supported: { label: "Supported", tone: "ok" },
  "partly supported": { label: "Partly", tone: "neutral" },
  mixed: { label: "Mixed", tone: "neutral" },
  "not supported": { label: "Not supported", tone: "danger" },
  "not enough evidence": { label: "Unknown", tone: "neutral" },
};

/** How many claims the comparison holds, for the fold's summary. */
export const COMPARISON_CLAIMS = FOOD_COMPARISON.reduce((n, t) => n + t.claims.length, 0);

/**
 * Animal foods, fruit and other plant foods compared, claim by claim (inside a fold on the Meals page):
 * one line per claim with its verdict; open it for what the studies show, the grade and the sources.
 * No diet is recommended.
 */
export function FoodComparison() {
  const [topic, setTopic] = useState<ComparisonTopic>(FOOD_COMPARISON[0]?.topic ?? "matrix");
  if (FOOD_COMPARISON.length === 0) return null;
  const current = FOOD_COMPARISON.find((t) => t.topic === topic) ?? FOOD_COMPARISON[0]!;
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Topic" className="flex flex-wrap gap-1 self-start rounded-xl border border-line bg-sunken p-1">
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

      <div role="tabpanel">
        <p className="mb-2 text-ink-2">{current.intro}</p>
        <Rows>
          {current.claims.map((c) => {
            const v = VERDICT[c.verdict];
            return (
              <Row key={c.id} title={c.claim} aside={<Chip tone={v.tone}>{v.label}</Chip>}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <GradeBadge grade={c.grade} />
                  <span className="text-ink-2">
                    {c.favours === "neither" ? "Favours neither" : c.favours === "depends" ? "Depends on the food" : `Favours ${c.favours}`}
                  </span>
                </div>
                <p>{c.summary}</p>
                <details className="text-sm text-ink-2">
                  <summary className="min-h-10 cursor-pointer py-2">Why this grade, and sources</summary>
                  <ul className="list-disc pl-5">
                    {c.whyThisGrade.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <ul className="mt-2 flex flex-col gap-1">
                    {c.studies.map((s) => (
                      <li key={s.pmid ?? s.doi}>
                        <StudyLink s={s} />
                      </li>
                    ))}
                  </ul>
                </details>
              </Row>
            );
          })}
        </Rows>
      </div>
      <p className="text-sm text-ink-2">
        "Partly" means partly supported; "Unknown" means there isn't enough evidence. Verdicts are a first draft, checked against the cited studies
        but not reviewed by a clinician.
      </p>
    </div>
  );
}
