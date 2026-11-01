import { selectLevers } from "../../core/evidence";
import { selectFoods } from "../../core/foods";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { useProfile } from "../hooks";
import type { Flag } from "../../core/trends";
import { formatValue } from "../../core/units";
import type { BiomarkerDef, Citation, EvidenceClaim, Profile, ProtocolEntry, SafetyId } from "../../core/types";
import { EVIDENCE, FOODS, nameInSentence } from "../knowledge";
import { lowerFirst } from "../format";
import { href } from "../router";
import { SafetyNotices } from "./SafetyNotices";
import { Chip, Row, Rows } from "./disclosure";
import { GradeBadge } from "./evidence";
import { cx } from "./ui";
import { PaperLink } from "./PaperLink";

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
/** What the levers section is called for this marker and result, and whether there is anything to show. */
export function leversHeading(def: BiomarkerDef, flag: Flag | undefined, protocols: ProtocolEntry[], profile: Profile): { title: string; count: number; focus?: "low" | "high" } {
  const safety: SafetyId[] = safetyNotes(safetyLabels(protocols, profile)).map((n) => n.id);
  const sel = selectLevers(def.id, flag, EVIDENCE, safety);
  return {
    title: sel.focus ? `What is known to ${sel.focus === "low" ? "raise" : "lower"} ${nameInSentence(def)}` : `What is known to affect ${nameInSentence(def)}`,
    count: sel.claims.length + sel.hidden.length,
    ...(sel.focus ? { focus: sel.focus } : {}),
  };
}

/**
 * "What is known to affect it": evidence-graded levers, one row each (open for what was tested, the
 * effect, food amounts, sources and "test it on yourself"). Shown inside a fold on the marker page.
 */
export function LeversPanel({ def, flag, protocols }: { def: BiomarkerDef; flag: Flag | undefined; protocols: ProtocolEntry[] }) {
  const profile = useProfile();
  const notes = safetyNotes(safetyLabels(protocols, profile));
  const safety: SafetyId[] = notes.map((n) => n.id);
  const sel = selectLevers(def.id, flag, EVIDENCE, safety);
  if (sel.claims.length === 0 && sel.hidden.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-2">
        {sel.focus ? `Because your latest result is ${sel.focus}: what research says can help, strongest evidence first.` : "Strongest evidence first."} Options to
        discuss with your doctor, not instructions.
      </p>
      <SafetyNotices notes={notes} />
      <Rows>
        {sel.claims.map((c) => (
          <Row
            key={c.id}
            title={c.lever}
            aside={
              <>
                <Chip>{KIND[c.kind]}</Chip>
                <GradeBadge grade={c.grade} short />
              </>
            }
          >
            <Lever claim={c} def={def} safety={safety} />
          </Row>
        ))}
      </Rows>
      {sel.hidden.length > 0 && (
        <p className="text-sm text-ink-2">
          {sel.hidden.length} {sel.hidden.length === 1 ? "option is" : "options are"} not shown because of what's in your habits. Ask your doctor about{" "}
          {sel.hidden.length === 1 ? "it" : "them"}.
        </p>
      )}
      <p className="text-sm text-ink-2">A whole food and a supplement of one of its nutrients are graded separately: they don't always have the same effect.</p>
    </div>
  );
}

function Lever({ claim: c, def, safety }: { claim: EvidenceClaim; def: BiomarkerDef; safety: SafetyId[] }) {
  return (
    <>
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
      <a
        href={href({ name: "habits", add: c.lever, marker: def.id })}
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-accent underline-offset-2 hover:underline"
      >
        Trying this? Compare your {nameInSentence(def)} before and after
        <span aria-hidden="true">→</span>
      </a>
    </>
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
          Not shown because of your habits: {sel.hidden.map((h) => `${lowerFirst(h.food.name)} (${h.reason})`).join("; ")}.
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
      <PaperLink href={url} source={{ title: s.title, year: s.year, kind: type[s.studyType], n: s.n }} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
        {s.title}
      </PaperLink>{" "}
      ({s.year}, {type[s.studyType]}
      {s.n ? `, ${s.n.toLocaleString()} people` : ""})
    </>
  );
}
