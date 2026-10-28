import { selectLevers } from "../../core/evidence";
import { selectFoods } from "../../core/foods";
import { safetyNotes } from "../../core/protocols";
import type { Flag } from "../../core/trends";
import { formatValue } from "../../core/units";
import type { BiomarkerDef, Citation, EvidenceClaim, EvidenceGrade, ProtocolEntry, SafetyId } from "../../core/types";
import { EVIDENCE, FOODS, nameInSentence } from "../knowledge";
import { lowerFirst } from "../format";
import { href } from "../router";
import { SafetyNotices } from "./SafetyNotices";
import { Card, cx } from "./ui";

const GRADE: Record<EvidenceGrade, { dots: string; label: string }> = {
  high: { dots: "●●●", label: "High" },
  moderate: { dots: "●●○", label: "Moderate" },
  low: { dots: "●○○", label: "Low" },
  "very low": { dots: "○○○", label: "Very low" },
};

const KIND: Record<EvidenceClaim["kind"], string> = {
  food: "Food",
  diet: "Diet",
  supplement: "Supplement",
  habit: "Habit",
};

const DIRECTION: Record<EvidenceClaim["direction"], string> = {
  increase: "Raises",
  decrease: "Lowers",
  "no effect": "No effect on",
  mixed: "Mixed effects on",
};

/**
 * "What is known to affect it": evidence-graded levers with measured food
 * amounts. Explains, never prescribes. Hidden for critical values.
 */
export function LeversPanel({ def, flag, protocols }: { def: BiomarkerDef; flag: Flag | undefined; protocols: ProtocolEntry[] }) {
  const notes = safetyNotes(protocols.filter((p) => !p.end).map((p) => p.label));
  const safety: SafetyId[] = notes.map((n) => n.id);
  const sel = selectLevers(def.id, flag, EVIDENCE, safety);
  if (sel.claims.length === 0 && sel.hidden.length === 0) return null;

  const title = sel.focus
    ? `What is known to ${sel.focus === "low" ? "raise" : "lower"} ${nameInSentence(def)}`
    : `What is known to affect ${nameInSentence(def)}`;

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">{title}</h2>
        <p className="mt-1 text-ink-2">
          {sel.focus
            ? "Because your latest result is " + sel.focus + ", here is what research says can help, strongest evidence first. "
            : "General information, strongest evidence first. "}
          These are options to discuss with your doctor, not instructions. The right step depends on why the value is{" "}
          {sel.focus ?? "where it is"}.
        </p>
      </div>

      <SafetyNotices notes={notes} />

      <ul className="flex flex-col gap-3">
        {sel.claims.map((c) => (
          <li key={c.id}>
            <Lever claim={c} def={def} safety={safety} />
          </li>
        ))}
      </ul>

      {sel.hidden.length > 0 && (
        <p className="text-sm text-ink-2">
          {sel.hidden.length} {sel.hidden.length === 1 ? "option is" : "options are"} not shown because of what's in your log. Ask your doctor
          about {sel.hidden.length === 1 ? "it" : "them"}.
        </p>
      )}

      <p className="text-sm text-ink-2">
        Grades describe how strong the research is: <span aria-hidden="true">●●●</span> high, <span aria-hidden="true">●●○</span> moderate,{" "}
        <span aria-hidden="true">●○○</span> low. A whole food and a supplement of one of its nutrients are graded separately, because they
        don't always have the same effect.
      </p>
    </Card>
  );
}

function Lever({ claim: c, def, safety }: { claim: EvidenceClaim; def: BiomarkerDef; safety: SafetyId[] }) {
  const grade = GRADE[c.grade];
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium">{c.lever}</h3>
        <span className="flex shrink-0 items-center gap-2 text-sm">
          <span className="rounded-full bg-sunken px-2 py-0.5 text-ink-2">{KIND[c.kind]}</span>
          <span className="rounded-full bg-sunken px-2 py-0.5 font-medium whitespace-nowrap">
            <span aria-hidden="true" className="mr-1 tracking-tight text-accent">
              {grade.dots}
            </span>
            {grade.label} evidence
          </span>
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-sm text-ink-2">
        <dt className="font-medium text-ink">Tested:</dt>
        <dd>{c.intervention}</dd>
        <dt className="font-medium text-ink">Effect:</dt>
        <dd>
          {DIRECTION[c.direction]} {lowerFirst(c.outcome)}
        </dd>
      </dl>
      <p>{c.summary}</p>
      {c.caution && (
        <p className="text-sm">
          <span className="font-medium">Caution: </span>
          <span className="text-ink-2">{c.caution}</span>
        </p>
      )}

      {c.foods && <FoodList claim={c} safety={safety} />}

      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-2">Why this grade, and sources</summary>
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

      <a
        href={href({ name: "experiment-new", marker: def.id, change: c.lever })}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent underline-offset-2 hover:underline"
      >
        Trying this? Test it on yourself
        <span aria-hidden="true">→</span>
      </a>
      <span className="-mt-2 text-sm text-ink-2">
        Compare your {nameInSentence(def)} before and after, against its normal test-to-test variation.
      </span>
    </article>
  );
}

function FoodList({ claim: c, safety }: { claim: EvidenceClaim; safety: SafetyId[] }) {
  const foods = c.foods!;
  const nutrient = FOODS.nutrients[foods.nutrient]!;
  const sel = selectFoods(FOODS, foods.nutrient, foods.foodIds, safety);
  if (sel.shown.length === 0 && sel.hidden.length === 0) return null;
  return (
    <div className="rounded-lg bg-sunken p-3">
      <p className="mb-2 text-sm font-medium">
        Examples: {lowerFirst(nutrient.label)} in a typical portion
      </p>
      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>Food</th>
            <th>Portion</th>
            <th>{nutrient.label}</th>
          </tr>
        </thead>
        <tbody>
          {sel.shown.map(({ food, amount }) => (
            <tr key={food.id} className="border-t border-line first:border-t-0">
              <td className="py-1.5 pr-2">{food.name}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-ink-2">
                {food.portion.grams} g<span className="hidden sm:inline"> ({food.portion.label})</span>
              </td>
              <td className={cx("py-1.5 text-right whitespace-nowrap tabular-nums")}>
                {formatValue(amount)} {nutrient.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sel.hidden.length > 0 && (
        <p className="mt-2 text-sm text-ink-2">
          Not shown because of your log: {sel.hidden.map((h) => `${lowerFirst(h.food.name)} (${h.reason})`).join("; ")}.
        </p>
      )}
      {foods.note && <p className="mt-2 text-sm text-ink-2">{foods.note}</p>}
      <p className="mt-2 text-xs text-ink-2">
        Measured values from {FOODS.source.name}. Nutrient numbers cover ~150 measured compounds; foods contain thousands more that aren't
        tracked. Portions are examples, not recommendations.
      </p>
    </div>
  );
}

function StudyLink({ s }: { s: Citation }) {
  const url = s.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` : `https://doi.org/${s.doi}`;
  const type: Record<Citation["studyType"], string> = {
    "meta-analysis": "Meta-analysis",
    rct: "Controlled trial",
    observational: "Observational study",
    animal: "Animal study",
    "in vitro": "Lab study",
    review: "Review",
    guideline: "Guideline",
  };
  return (
    <>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
        {s.title}
      </a>{" "}
      ({s.year}, {type[s.studyType]}
      {s.n ? `, ${s.n.toLocaleString()} people` : ""})
    </>
  );
}
