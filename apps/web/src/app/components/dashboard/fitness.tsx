import { useEffect, useRef, useState } from "react";
import { FITNESS_FIELDS } from "@bt/shared/core/body";
import { ageMatch, cutoffsMet, describePlace, isDeviceWalkingAverage, normRow, placeAmongYoungest, placeResult, rowWho, type AgeMatch, type FitnessTestDef, type NormResult, type NormSet } from "@bt/shared/core/fitnessTests";
import { ageAt } from "@bt/shared/core/phenoageDraws";
import { sortByDate } from "@bt/shared/core/trends";
import type { Measurement, Profile } from "@bt/shared/core/types";
import { formatValue } from "@bt/shared/core/units";
import { formatDate } from "../../format";
import { FITNESS_MAP } from "../../knowledge";
import { href } from "../../router";
import { GradeBadge, StudyLink } from "../evidence";
import { NormChart, NormTable } from "../NormChart";
import { SegmentTabs } from "../SegmentTabs";
import { Card, Notice } from "../ui";
import { Figure } from "./widgets";
import { More } from "../disclosure";

/**
 * Fitness tests (push-ups, grip, chair rises, one-leg stand, walking speed, sit-and-rise): the latest
 * result compared with published norms for the person's sex and age on the day. The comparison is
 * worked out in /core; this file only shows it. Never a target or a diagnosis.
 */

const UNIT_WORD: Record<string, string> = { reps: "", points: "of 10", s: "s", kg: "kg", "m/s": "m/s" };
const unitWord = (t: FitnessTestDef) => UNIT_WORD[t.unit] ?? t.unit;

function latestOf(ms: readonly Measurement[], id: string): Measurement | undefined {
  return sortByDate(ms.filter((m) => m.biomarkerId === id)).at(-1);
}

/** The person on the day of a result: sex and age then. */
function personAt(profile: Profile, date: string) {
  return { ...(profile.sex ? { sex: profile.sex } : {}), ...(profile.birthMonth ? { age: ageAt(profile.birthMonth, date) } : {}) };
}

/** "typical of women about 43", "as good as women at their best (around 35)", "typical of women 70 and over, or below". */
export function describeAgeMatch(m: AgeMatch, sex: "m" | "f"): string {
  const who = sex === "m" ? "men" : "women";
  if (m.kind === "best") return `as good as ${who} at their best age (around ${m.age})`;
  if (m.kind === "youngest") return `as good as typical ${who} ${m.ageTo !== undefined ? `aged ${m.ageFrom}–${m.ageTo}` : `aged ${m.ageFrom}`}, the youngest in the table, or better`;
  if (m.kind === "oldest") return `typical of ${who} ${m.age} and over, or below`;
  return `typical of ${who} about ${m.age}`;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The first norm table that gives a "typical of" age for this result. */
function firstAgeMatch(test: FitnessTestDef, value: number, sex: "m" | "f" | undefined): { m: AgeMatch; label: string } | undefined {
  if (!sex) return undefined;
  // The table that reaches youngest says the most about age.
  const youngest = (s: NormSet) => Math.min(...s.rows.filter((r) => r.sex === sex || r.sex === "any").map((r) => r.ageFrom));
  for (const set of [...test.norms].sort((a, b) => youngest(a) - youngest(b))) {
    const m = ageMatch(set, sex, value, test.higherIsBetter);
    if (m) return { m, label: set.label };
  }
  return undefined;
}

function placeFor(test: FitnessTestDef, m: Measurement, profile: Profile): NormResult[] {
  return isDeviceWalkingAverage(m) ? [] : placeResult(test, m.value, personAt(profile, m.date));
}

/** One test as a figure on the Body page: latest result and where it falls for age and sex. */
export function FitnessFigure({ ms, id, profile, className }: { ms: Measurement[]; id: string; profile: Profile; className?: string }) {
  const test = FITNESS_MAP.get(id);
  if (!test) return null;
  const last = latestOf(ms, id);
  const deviceAverage = !!last && isDeviceWalkingAverage(last);
  const places = last ? placeFor(test, last, profile) : [];
  const first = places[0];
  const typical = last && !deviceAverage ? firstAgeMatch(test, last.value, profile.sex) : undefined;
  const foot = !last
    ? "Not done yet. How to do it →"
    : deviceAverage
      ? `${formatDate(last.date)} · Device daily step average, not a timed gait test`
    : typical
      ? `${capital(describeAgeMatch(typical.m, profile.sex!))} · ${formatDate(last.date)}`
      : first
      ? `${formatDate(last.date)} · compared with ${first.set.label}`
      : !profile.sex || !profile.birthMonth
        ? `${formatDate(last.date)} · add your sex and birth month to compare`
        : `${formatDate(last.date)} · no norms for your age`;
  return (
    <Figure label={deviceAverage ? "Walking speed (daily average)" : test.name} href={href({ name: "marker", id, section: "for-your-age" })} className={className} foot={foot}>
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className="font-serif text-4xl leading-none tabular-nums sm:text-5xl">{formatValue(last.value)}</span>
          {unitWord(test) && <span className="text-ink-2">{unitWord(test)}</span>}
          {first && <PlaceChip result={first} test={test} />}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

function PlaceChip({ result, test }: { result: NormResult; test: FitnessTestDef }) {
  return <span className="inline-flex rounded-full bg-sunken px-2.5 py-0.5 text-sm font-medium text-ink">{describePlace(result.place, test.higherIsBetter)}</span>;
}

/** On a test's page: where you stand for your age, the norms drawn with your results, how to do it, the evidence. */
export function FitnessPanel({ id, ms, profile, scrollTo = false }: { id: string; ms: Measurement[]; profile: Profile; scrollTo?: boolean }) {
  const test = FITNESS_MAP.get(id);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!scrollTo || !test) return;
    const t = window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      ref.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
  }, [scrollTo, test]);
  if (!test) return null;
  const series = sortByDate(ms.filter((m) => m.biomarkerId === id));
  const last = series.at(-1);
  const deviceAverage = !!last && isDeviceWalkingAverage(last);
  const person = last ? personAt(profile, last.date) : personAt(profile, new Date().toISOString().slice(0, 10));
  const places = last ? placeFor(test, last, profile) : [];
  const met = last && !deviceAverage ? cutoffsMet(test, last.value, person) : [];
  const sex = profile.sex;
  const points = profile.birthMonth ? series.filter((m) => !isDeviceWalkingAverage(m)).map((m) => ({ date: m.date, age: ageAt(profile.birthMonth!, m.date), value: m.value })) : [];
  return (
    <Card ref={ref} tabIndex={-1} aria-label={`${test.name} for your age`} className="flex scroll-mt-6 flex-col gap-6 outline-none">
      <div className="max-w-3xl">
        <h2 className="font-serif text-2xl font-normal">For your age</h2>
        <p className="mt-1 text-ink-2">{test.summary}</p>
      </div>

      {last ? (
        deviceAverage ? (
          <p className="text-ink-2">This is a device's daily step-speed average, not the short timed walking test described below. Test percentiles, age equivalents and clinical cut-offs do not apply to this average. Your daily readings are shown in the trend chart above.</p>
        ) : places.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {places.map((r) => (
              <li key={r.set.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{describePlace(r.place, test.higherIsBetter)}</span>
                <span className="text-sm text-ink-2">
                  {placeDetail(r, test, last.value)} · compared with {r.set.label}, {rowWho(r.row)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-2">
            {!profile.sex || !profile.birthMonth ? (
              <>
                Add your sex and month of birth in <a href={href({ name: "data", tab: "data" })}>Settings → Your data</a> to compare your result
                with people of your age.
              </>
            ) : (
              "None of the norm tables here cover your age and sex."
            )}
          </p>
        )
      ) : (
        <p className="text-ink-2">
          No result yet. Do the test as described below, then <a href={href({ name: "add", kind: "body" })}>add it</a>.
        </p>
      )}

      {last && sex && !deviceAverage && <YoungerComparison test={test} value={last.value} sex={sex} own={places} />}

      {met.map((c) => (
        <Notice key={c.label} tone="warn" title={c.label}>
          A threshold doctors use, not a diagnosis on its own. It's worth mentioning to your doctor, especially if it's new or getting worse.
          Source: <StudyLink s={c.source} />
        </Notice>
      ))}

      {sex && <NormSets test={test} sex={sex} points={points} age={person.age} />}
      {!sex && <p className="text-sm text-ink-2">The norm tables are by sex: add yours to see them drawn with your results.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 font-serif text-xl font-normal">How to do it</h3>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            {test.howTo.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
        <section className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 font-serif text-xl font-normal">Safety</h3>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
              {test.safety.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-serif text-xl font-normal">What it can't tell you</h3>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
              {test.limits.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <section>
        <h3 className="mb-2 font-serif text-xl font-normal">What research says</h3>
        <ul className="flex flex-col gap-3">
          {test.evidence.map((e) => (
            <li key={e.claim} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="max-w-3xl">{e.claim}</p>
                <GradeBadge grade={e.grade} short />
              </div>
              <More summary="Why this grade, and sources">
                <ul className="list-disc pl-5 text-sm text-ink-2">
                  {e.whyThisGrade.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
                  {e.studies.map((s) => (
                    <li key={s.pmid ?? s.doi ?? s.title}>
                      <StudyLink s={s} />
                    </li>
                  ))}
                </ul>
              </More>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-2">
          Population studies show links, not causes, and describe groups rather than you. Grades are a first draft, checked against the cited
          studies but not yet reviewed by a clinician.
        </p>
      </section>
    </Card>
  );
}


/** Bryan Johnson-style comparisons, kept honest: the age whose typical result matches yours, and your place among the youngest people in each table. */
function YoungerComparison({ test, value, sex, own }: { test: FitnessTestDef; value: number; sex: "m" | "f"; own: NormResult[] }) {
  const ages = test.norms.flatMap((set) => {
    const m = ageMatch(set, sex, value, test.higherIsBetter);
    return m ? [{ set, m }] : [];
  });
  // The youngest group, unless it's the person's own group (already shown above).
  const young = placeAmongYoungest(test, value, sex).filter((r) => !own.some((o) => o.set === r.set && o.row === r.row));
  if (ages.length === 0 && young.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-serif text-xl font-normal">Compared with other ages</h3>
      <ul className="flex flex-col gap-1.5">
        {ages.map(({ set, m }) => (
          <li key={`age-${set.label}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{capital(describeAgeMatch(m, sex))}</span>
            <span className="text-sm text-ink-2">{set.label}</span>
          </li>
        ))}
        {young.map((r) => (
          <li key={`young-${r.set.label}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">
              {describePlace(r.place, test.higherIsBetter)} among {rowWho(r.row)}
            </span>
            <span className="text-sm text-ink-2">{r.set.label}</span>
          </li>
        ))}
      </ul>
      <p className="max-w-3xl text-sm text-ink-2">
        Typical means the middle result (median, or average) of each age group in the table, with the ages in between joined by straight
        lines. These tables measured different people at different ages, not the same people growing older, and most stop at the 90th or 95th
        percentile, so nothing finer than that can be said. A comparison, not a body age.
      </p>
    </section>
  );
}

function placeDetail(r: NormResult, test: FitnessTestDef, value: number): string {
  const u = test.unit === "reps" ? "" : ` ${test.unit}`;
  const capped = r.set.ceiling !== undefined && value > r.set.ceiling ? ` (counted as ${r.set.ceiling} s, the study's limit)` : "";
  if (r.place.kind === "percentile" && r.place.median !== undefined) return `median ${formatValue(r.place.median)}${u}${capped}`;
  if (r.place.kind === "mean_sd") return `average ${formatValue(r.place.mean)}${u} ± ${formatValue(r.place.sd)}${capped}`;
  return `your ${formatValue(value)}${u}${capped}`;
}

/** The norm tables for the person's sex, one at a time: chart with their results, then the table. */
function NormSets({ test, sex, points, age }: { test: FitnessTestDef; sex: "m" | "f"; points: { date: string; age: number; value: number }[]; age?: number }) {
  const sets = test.norms.filter((s) => s.rows.some((r) => r.sex === sex || r.sex === "any"));
  // Start on the first table that covers the person's age.
  const [i, setI] = useState(() => Math.max(0, age === undefined ? 0 : sets.findIndex((s) => normRow(s, sex, age) !== undefined)));
  const set: NormSet | undefined = sets[Math.min(i, sets.length - 1)];
  if (!set) return <p className="text-sm text-ink-2">No norm tables for your sex.</p>;
  const heading = <h3 className="font-serif text-xl font-normal">Norms by age</h3>;
  const body = (
    <>
      <NormChart set={set} sex={sex} points={points} unit={test.unit} higherIsBetter={test.higherIsBetter} />
      <More summary="The table, and where it comes from">
        <NormTable set={set} sex={sex} {...(age !== undefined ? { age } : {})} unit={test.unit} />
        <div className="mt-3 flex max-w-3xl flex-col gap-1 text-sm text-ink-2">
          <p>
            Source: <StudyLink s={set.source} />
            {set.source.note ? ` ${set.source.note}` : ""}
          </p>
          <p>Who was measured: {set.population}</p>
          <p>Numbers read from: {set.verifiedFrom}</p>
          {set.note && <p>{set.note}</p>}
        </div>
      </More>
    </>
  );
  return (
    <section className="flex flex-col gap-3">
      {sets.length > 1 ? (
        <SegmentTabs
          label="Norm table"
          header={heading}
          tabs={sets.map((s, j) => ({ value: String(j), label: s.label }))}
          value={String(sets.indexOf(set))}
          onChange={(j) => setI(Number(j))}
          className="flex flex-col gap-3"
          panelClassName="flex flex-col gap-3"
        >
          {body}
        </SegmentTabs>
      ) : (
        <>
          {heading}
          {body}
        </>
      )}
    </section>
  );
}

/** For the Biological age page: every test with its latest result and place for your age. */
export function FitnessForYourAge({ ms, profile }: { ms: Measurement[]; profile: Profile }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="max-w-3xl">
        <h2 className="font-serif text-2xl font-normal">Tests for your age</h2>
        <p className="mt-1 text-ink-2">
          Simple tests of strength, balance and walking that change with age. Each is compared with published norms for people of your age
          and sex. Not a biological age: they say where you stand, not how old your body is.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {FITNESS_FIELDS.map((id) => {
          const test = FITNESS_MAP.get(id);
          if (!test) return null;
          const last = latestOf(ms, id);
          const deviceAverage = !!last && isDeviceWalkingAverage(last);
          const place = last ? placeFor(test, last, profile)[0] : undefined;
          const typical = last && !deviceAverage ? firstAgeMatch(test, last.value, profile.sex) : undefined;
          // Tables of named bands have no middle value: say how it compares with the youngest group instead.
          const young = last && !deviceAverage && profile.sex && !typical ? placeAmongYoungest(test, last.value, profile.sex)[0] : undefined;
          return (
            <li key={id}>
              <a
                href={href({ name: "marker", id, section: "for-your-age" })}
                className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 text-ink no-underline hover:bg-sunken sm:grid-cols-[minmax(0,14rem)_6rem_minmax(0,1fr)_minmax(0,1fr)]"
              >
                <span className="font-medium">{deviceAverage ? "Walking speed (daily average)" : test.name}</span>
                <span className="text-right tabular-nums sm:text-left">
                  {last ? `${formatValue(last.value)}${unitWord(test) ? ` ${unitWord(test)}` : ""}` : <span className="text-ink-2">Not done</span>}
                </span>
                <span className="col-span-2 text-sm text-ink-2 sm:col-span-1">
                  {deviceAverage ? "Daily step average, not a timed test" : place ? `${describePlace(place.place, test.higherIsBetter)} for your age` : last ? "No norms for your age" : "How to do it →"}
                </span>
                <span className="col-span-2 text-sm text-ink-2 sm:col-span-1">
                  {typical ? capital(describeAgeMatch(typical.m, profile.sex!)) : young ? `${describePlace(young.place, test.higherIsBetter)} among ${rowWho(young.row)}` : ""}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
