import type { ReactNode } from "react";
import { todayIso } from "../../core/dates";
import { selectFoods } from "../../core/foods";
import { dailyReference } from "../../core/meals";
import { findingCounts, interactionsFor, sortFindings, type FindingEffect, type NutrientDef, type NutrientFinding } from "../../core/nutrients";
import { ageAt } from "../../core/phenoageDraws";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { computeTrend, flagLatest, groupByBiomarker } from "../../core/trends";
import type { Measurement, SafetyId } from "../../core/types";
import { formatValue } from "../../core/units";
import { Chip, Fold, FoldGroup, Row, Rows } from "../components/disclosure";
import { GradeBadge, StudyLink } from "../components/evidence";
import { ResearchPanel } from "../components/ResearchPanel";
import { SafetyNotices } from "../components/SafetyNotices";
import { FlagBadge, LinkButton } from "../components/ui";
import { displayUnitFor, formatDate, lowerFirst, showMeasurement } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, EVIDENCE, FOODS, NUTRIENT_MAP, fullName } from "../knowledge";
import { href } from "../router";
import { NotFound } from "./NotFound";

const EFFECT: Record<FindingEffect, { label: string; tone: "ok" | "neutral" | "danger" }> = {
  helps: { label: "Helped", tone: "ok" },
  "no clear effect": { label: "No clear effect", tone: "neutral" },
  mixed: { label: "Mixed", tone: "neutral" },
  harms: { label: "Harmed", tone: "danger" },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** A fold summary from a list: brackets dropped, lower case after the first item, the rest counted. */
const list = (xs: string[], max = 3) => {
  const clean = xs.map((x, i) => {
    const t = x.replace(/\s*\([^)]*\)/g, "").trim();
    return i === 0 ? t : t.charAt(0).toLowerCase() + t.slice(1);
  });
  return clean.length <= max ? clean.join(", ") : `${clean.slice(0, max).join(", ")} and ${clean.length - max} more`;
};
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One vitamin or mineral. Summary first: what it is, then four facts (your result, the EU intake, the
 * upper limit, what trials found). Everything else is one tap away in folds, in the order people
 * usually ask: what it does, how it's measured, too little or too much, what trials found, food,
 * forms, reference values, interactions, research.
 */
export function NutrientPage({ id }: { id: string }) {
  const n = NUTRIENT_MAP.get(id);
  const all = useAllMeasurements();
  const profile = useProfile();
  const protocols = useProtocols() ?? [];
  if (!n) return <NotFound />;
  const notes = safetyNotes(safetyLabels(protocols, profile));
  const safety: SafetyId[] = notes.map((x) => x.id);
  const yours = interactionsFor(n, safety);
  const counts = findingCounts(n);
  const claims = EVIDENCE.filter((c) => n.evidenceClaims.includes(c.id));

  return (
    <>
      <a href={href({ name: "supplements" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Supplementation
      </a>
      <header className="mb-6 max-w-3xl">
        <h1 className="font-serif text-4xl font-normal tracking-tight">{n.name}</h1>
        <p className="mt-2 text-lg text-ink-2">{n.summary}</p>
      </header>

      {yours.length > 0 && (
        <div role="note" className="mb-6 flex max-w-3xl flex-col gap-2 rounded-xl bg-warn-soft p-4">
          <p className="font-semibold">Talk to your doctor or pharmacist about {n.name.toLowerCase()}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {yours.map((x) => (
              <li key={x.with}>
                <span className="font-medium">{x.with}:</span> {x.note}
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-2">Shown because of something in your habits or profile.</p>
        </div>
      )}

      <Facts n={n} all={all ?? []} counts={counts} />

      <FoldGroup className="mt-8 max-w-3xl">
        <Fold title="What it does" summary={upperFirst(n.roles[0] ?? "").replace(/\s*\([^)]*\)/g, "")}>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
            {n.roles.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {n.otherNames.length > 0 && <p className="mt-3 text-sm text-ink-2">Also called: {n.otherNames.join(", ")}</p>}
        </Fold>

        <Fold
          title="Too little or too much"
          summary={`Who tends to run low: ${list(n.low.atRisk, 2).replace(/^./, (c) => c.toLowerCase())}`}
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="font-medium">Too little</h3>
              <List title="Signs" items={n.low.signs} />
              <List title="Who tends to run low" items={n.low.atRisk} />
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="font-medium">Too much</h3>
              <p className="text-ink-2">{n.high.note}</p>
              {n.high.signs.length > 0 && <List title="Signs" items={n.high.signs} />}
            </div>
          </div>
        </Fold>

        <Fold title="What trials of supplements found" summary={trialSummary(counts)} defaultOpen>
          <p className="mb-2 text-sm text-ink-2">Strongest evidence first. Who was studied matters: a benefit in people who were low says little about people who aren't.</p>
          <FindingRows findings={n.findings} />
        </Fold>

        {n.foodFindings && n.foodFindings.length > 0 && (
          <Fold title="What studies of foods found" summary="Foods rich in it, kept apart from the supplement findings">
            <p className="mb-2 text-sm text-ink-2">A food brings many other compounds, so these findings don't carry over to supplements, or the other way round.</p>
            <FindingRows findings={n.foodFindings} />
          </Fold>
        )}

        <Fold title="Food sources" summary={list(n.foodSources.examples)}>
          <Foods n={n} safety={safety} />
        </Fold>

        {n.forms.length > 0 && (
          <Fold title="Supplement forms" summary={list(n.forms.map((f) => f.name))}>
            <dl className="flex flex-col gap-3">
              {n.forms.map((f) => (
                <div key={f.name}>
                  <dt className="font-medium">{f.name}</dt>
                  <dd className="text-ink-2">{f.note}</dd>
                </div>
              ))}
            </dl>
          </Fold>
        )}

        <Fold title="How it's measured" summary={n.status.biomarkerIds.length ? `With ${list(n.status.biomarkerIds.map((x) => BIOMARKER_MAP.get(x)?.name ?? x).map(lowerFirst), 2)}` : "No routine blood test for it in the app"}>
          <Status n={n} all={all ?? []} />
        </Fold>

        <Fold title="Reference intakes and upper limit" summary="EU (EFSA) values for groups of healthy adults, not a dose for you">
          <Reference n={n} />
        </Fold>

        {(n.interactions.length > 0 || n.cautions.length > 0) && (
          <Fold title="Interactions and cautions" summary={list(n.interactions.map((x) => x.with))}>
            <SafetyNotices notes={notes.filter((x) => n.interactions.some((i) => i.safetyId === x.id))} />
            <dl className="mt-3 flex flex-col gap-3">
              {n.interactions.map((x) => (
                <div key={x.with} className={x.safetyId && safety.includes(x.safetyId) ? "rounded-lg bg-warn-soft p-2" : undefined}>
                  <dt className="font-medium">{x.with}</dt>
                  <dd className="text-ink-2">{x.note}</dd>
                </div>
              ))}
            </dl>
            {n.cautions.length > 0 && <List title="Cautions" items={n.cautions} className="mt-4" />}
          </Fold>
        )}

        {claims.length > 0 && (
          <Fold title="On your marker pages" summary={list(claims.map((c) => c.lever), 2)}>
            <ul className="flex flex-col divide-y divide-line">
              {claims.map((c) => (
                <li key={c.id}>
                  <a href={href({ name: "marker", id: c.markers[0]!.biomarkerId })} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 text-ink no-underline hover:text-accent">
                    <span>
                      {c.lever}
                      <span className="text-sm text-ink-2"> · {BIOMARKER_MAP.get(c.markers[0]!.biomarkerId)?.name}</span>
                    </span>
                    <GradeBadge grade={c.grade} short />
                  </a>
                </li>
              ))}
            </ul>
          </Fold>
        )}

        {n.status.biomarkerIds.length > 0 && (
          <Fold title="Test it on yourself" summary="Log a change as a habit and compare your results before and after">
            <p className="mb-3 text-ink-2">
              If you and your doctor decide to try a change (a food or a supplement), log it as a habit and watch your{" "}
              {lowerFirst(BIOMARKER_MAP.get(n.status.biomarkerIds[0]!)?.name ?? n.name)}. The app compares results before and after, allowing for
              normal test-to-test variation.
            </p>
            <LinkButton variant="secondary" href={href({ name: "habits", add: n.name, marker: n.status.biomarkerIds[0] })}>
              Log a habit and watch the marker
            </LinkButton>
          </Fold>
        )}

        <Fold title="Search research" summary={`Published studies about ${n.name.toLowerCase()} supplementation`}>
          <ResearchPanel
            bare
            name={n.name}
            terms={[n.name]}
            topic="supplementation"
            question={`What does research say about ${n.name.toLowerCase()} supplements, and is it relevant to my results?`}
            critical={false}
          />
        </Fold>

        <Fold title="Sources" summary={plural(n.sources.length, "general source", "general sources")}>
          <ul className="flex flex-col gap-1 text-sm text-ink-2">
            {n.sources.map((s) => (
              <li key={s.pmid ?? s.doi}>
                <StudyLink s={s} />
              </li>
            ))}
          </ul>
        </Fold>
      </FoldGroup>

      <p className="mt-6 max-w-3xl text-sm text-ink-2">
        General information, not a diagnosis or a dose for you. Grades and wording are a first draft, checked against the cited studies but not yet
        reviewed by a clinician.
      </p>
    </>
  );
}

function trialSummary(c: Record<FindingEffect, number>): string {
  return [c.helps && `${c.helps} helped`, c["no clear effect"] && `${c["no clear effect"]} no clear effect`, c.mixed && `${c.mixed} mixed`, c.harms && `${c.harms} harmed`]
    .filter(Boolean)
    .join(" · ");
}

function List({ title, items, className }: { title: string; items: string[]; className?: string }) {
  return (
    <div className={className}>
      <h4 className="mb-1 text-sm font-medium">{title}</h4>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** Four facts under the title: your result, the day's EU intake, the upper limit, what trials found. */
function Facts({ n, all, counts }: { n: NutrientDef; all: Measurement[]; counts: Record<FindingEffect, number> }) {
  const profile = useProfile();
  const units = useDisplayUnits();
  const age = profile.birthMonth ? ageAt(profile.birthMonth, todayIso()) : undefined;
  const ref = dailyReference(n, { sex: profile.sex, age });
  const byMarker = groupByBiomarker(all);
  const markerId = n.status.biomarkerIds.find((m) => byMarker.has(m));
  const def = markerId ? BIOMARKER_MAP.get(markerId) : undefined;
  const ms = markerId ? byMarker.get(markerId)! : [];
  const latest = ms.length ? computeTrend(ms)?.latest : undefined;
  const flag = def && ms.length ? flagLatest(def, ms, profile) : undefined;
  const unit = def ? displayUnitFor(def, units[def.id]) : "";
  const fact = (label: string, value: ReactNode, note?: ReactNode) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
      {note && <dd className="text-sm text-ink-2">{note}</dd>}
    </div>
  );
  return (
    <dl className="grid max-w-3xl grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      {fact(
        def ? `Your ${lowerFirst(def.name)}` : "Your status",
        def && latest ? (
          <a href={href({ name: "marker", id: def.id })} className="text-ink no-underline hover:underline">
            {showMeasurement(def, latest, unit)} {unit}
          </a>
        ) : (
          <span className="text-ink-2">–</span>
        ),
        def && latest ? flag && flag !== "unknown" ? <FlagBadge flag={flag} /> : formatDate(latest.date) : n.status.biomarkerIds.length ? "No result yet" : "No routine test in the app",
      )}
      {fact(
        "EU reference intake",
        ref.intake ? `${formatValue(ref.intake.amount)} ${ref.intake.unit}` : ref.bySex ? `${formatValue(ref.bySex.women.amount)}–${formatValue(ref.bySex.men.amount)} ${ref.bySex.men.unit}` : "–",
        ref.intake ? "a day, from all food" : ref.bySex ? "women–men, a day" : undefined,
      )}
      {fact("Upper limit", ref.upperLimit ? `${formatValue(ref.upperLimit.amount)} ${ref.upperLimit.unit}` : "None set", ref.upperLimit ? "a day, long term" : undefined)}
      {fact(
        "Supplement trials",
        <span className="flex flex-wrap gap-1 pt-1">
          {counts.helps > 0 && <Chip tone="ok">{counts.helps} helped</Chip>}
          {counts["no clear effect"] + counts.mixed > 0 && <Chip>{counts["no clear effect"] + counts.mixed} unclear</Chip>}
          {counts.harms > 0 && <Chip tone="danger">{counts.harms} harmed</Chip>}
        </span>,
      )}
    </dl>
  );
}

function FindingRows({ findings }: { findings: NutrientFinding[] }) {
  return (
    <Rows>
      {sortFindings(findings).map((f) => {
        const e = EFFECT[f.effect];
        return (
          <Row
            key={`${f.outcome}|${f.population}`}
            title={f.outcome}
            aside={
              <>
                <Chip tone={e.tone}>{e.label}</Chip>
                <GradeBadge grade={f.grade} short className="hidden sm:inline-flex" />
              </>
            }
          >
            <p className="text-sm text-ink-2">Studied in: {f.population}</p>
            <p>{f.summary}</p>
            <GradeBadge grade={f.grade} className="self-start sm:hidden" />
            <details className="text-sm text-ink-2">
              <summary className="min-h-10 cursor-pointer py-2">Why this grade, and sources</summary>
              <ul className="list-disc pl-5">
                {f.whyThisGrade.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <ul className="mt-2 flex flex-col gap-1">
                {f.studies.map((s) => (
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
  );
}

/** Your latest result for each of its status markers, and how status is measured. */
function Status({ n, all }: { n: NutrientDef; all: Measurement[] }) {
  const profile = useProfile();
  const units = useDisplayUnits();
  const byMarker = groupByBiomarker(all);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-2">{n.status.note}</p>
      {n.status.biomarkerIds.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {n.status.biomarkerIds.map((id) => {
            const def = BIOMARKER_MAP.get(id);
            if (!def) return null;
            const ms = byMarker.get(id) ?? [];
            const latest = ms.length ? computeTrend(ms)?.latest : undefined;
            const flag = ms.length ? flagLatest(def, ms, profile) : undefined;
            const unit = displayUnitFor(def, units[def.id]);
            return (
              <li key={id}>
                <a href={href({ name: "marker", id })} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 text-ink no-underline hover:text-accent">
                  <span>{fullName(def)}</span>
                  {latest ? (
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">
                        {showMeasurement(def, latest, unit)} {unit}
                      </span>
                      {flag && flag !== "unknown" && <FlagBadge flag={flag} />}
                    </span>
                  ) : (
                    <span className="text-sm text-ink-2">No results yet</span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Food sources in words, and measured amounts per portion where the food table has the nutrient. */
function Foods({ n, safety }: { n: NutrientDef; safety: SafetyId[] }) {
  const key = n.foodSources.cofidNutrient;
  const sel = key ? selectFoods(FOODS, key, FOODS.foods.map((f) => f.id), safety) : undefined;
  const unit = key ? FOODS.nutrients[key]?.unit : undefined;
  const rows = sel?.shown.filter((r) => r.amount > 0).slice(0, 8) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {n.foodSources.examples.map((x) => (
          <li key={x} className="rounded-full bg-sunken px-3 py-1 text-sm">
            {x}
          </li>
        ))}
      </ul>
      {n.foodSources.note && <p className="text-ink-2">{n.foodSources.note}</p>}
      {rows.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-medium">Measured amounts in example portions</h4>
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((r) => (
              <li key={r.food.id} className="flex items-baseline justify-between gap-3 py-2">
                <span>
                  {r.food.name} <span className="text-sm text-ink-2">· {r.food.portion.label}, {r.food.portion.grams} g</span>
                </span>
                <span className="tabular-nums whitespace-nowrap">
                  {formatValue(r.amount)} {unit}
                </span>
              </li>
            ))}
          </ul>
          {sel && sel.hidden.length > 0 && <p className="mt-2 text-sm text-ink-2">Not shown because of your habits or profile: {sel.hidden.map((h) => `${h.food.name} (${h.reason})`).join("; ")}.</p>}
          <p className="mt-2 text-sm text-ink-2">From the UK food table (CoFID 2021). Food holds thousands of compounds that aren't measured here.</p>
        </div>
      )}
      <a href={href({ name: "meals" })} className="self-start text-sm text-ink underline underline-offset-2">
        Build a meal and see its measured amounts
      </a>
    </div>
  );
}

const INTAKE_TYPE = { PRI: "Population reference intake", AI: "Adequate intake" } as const;

function Reference({ n }: { n: NutrientDef }) {
  const r = n.reference;
  const types = [...new Set(r.intake.map((x) => x.type))];
  return (
    <div className="flex flex-col gap-3">
      {r.intake.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-sm text-ink-2">
              <tr>
                <th className="py-2 pr-3 font-medium">Group</th>
                <th className="py-2 pr-3 font-medium">A day</th>
                <th className="py-2 font-medium">Kind</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.intake.map((x) => (
                <tr key={`${x.group}-${x.type}`}>
                  <td className="py-2 pr-3">{x.group}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatValue(x.amount)} {x.unit}
                  </td>
                  <td className="py-2 text-sm text-ink-2">{INTAKE_TYPE[x.type]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="flex flex-col gap-1 text-sm text-ink-2">
        {types.includes("PRI") && <li>Population reference intake: enough for almost everyone in the group.</li>}
        {types.includes("AI") && <li>Adequate intake: what healthy people usually get, used when there wasn't enough data for a reference intake.</li>}
      </ul>
      <div>
        <p className="font-medium">
          Tolerable upper intake level:{" "}
          {r.upperLimit ? (
            <span className="tabular-nums">
              {formatValue(r.upperLimit.amount)} {r.upperLimit.unit} a day
            </span>
          ) : (
            "none set"
          )}
        </p>
        <p className="mt-1 text-ink-2">{r.upperLimit ? r.upperLimit.note : r.noUpperLimit}</p>
      </div>
      <details className="text-sm text-ink-2">
        <summary className="min-h-10 cursor-pointer py-2">Sources</summary>
        <ul className="flex flex-col gap-1">
          {r.sources.map((s) => (
            <li key={s.pmid ?? s.doi}>
              <StudyLink s={s} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
