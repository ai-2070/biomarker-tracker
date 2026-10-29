import { PHENOAGE_MARKERS, PHENOAGE_MIN_AGE } from "../../core/phenoage";
import { summarizePhenoAge, type PhenoAgeDraw } from "../../core/phenoageDraws";
import type { Profile } from "../../core/types";
import { setProfile } from "../../db/db";
import { BirthMonthField } from "../components/BirthMonthField";
import { FitnessForYourAge } from "../components/dashboard/fitness";
import { Card, LinkButton, Notice, PageTitle } from "../components/ui";
import { formatDate, formatYears, showMeasurement } from "../format";
import { useAllMeasurements, useProfile, useProtocols } from "../hooks";
import { HeartAgeSection } from "../components/dashboard/heartAge";
import { FitnessAgeSection } from "../components/dashboard/fitnessAge";
import { AgesChart } from "../components/dashboard/AgesChart";
import { PaceOfAging } from "../components/dashboard/agePace";
import { BestBefore } from "../components/dashboard/bestBefore";
import { bodyOnly } from "../knowledge";
import { BIOMARKER_MAP, fullName } from "../knowledge";
import { href } from "../router";

const LEVINE_URL = "https://pubmed.ncbi.nlm.nih.gov/29676998/";

export function PhenoAgePage() {
  const all = useAllMeasurements();
  const profile = useProfile();
  const protocols = useProtocols() ?? [];

  if (all === undefined) return <p className="text-ink-2">Loading…</p>;
  const summary = summarizePhenoAge(all, profile.birthMonth);
  const latest = summary.draws[summary.draws.length - 1];

  return (
    <>
      <PageTitle sub="Three estimates: PhenoAge from 9 routine blood markers, heart age from blood pressure, weight and smoking, and fitness age from VO₂max. All are estimates, not verdicts.">
        Biological age
      </PageTitle>
      <div className="flex flex-col gap-5">
        <BestBefore measurements={all} profile={profile} protocols={protocols} />
        <AgesChart measurements={all} profile={profile} protocols={protocols} />
        <PaceOfAging measurements={all} profile={profile} protocols={protocols} />
        <h2 className="-mb-2 font-serif text-2xl font-normal">PhenoAge, from blood tests</h2>
        {!latest ? (
          <NeedsMarkers partial={summary.latestPartial} />
        ) : latest.status === "needs-birth-month" ? (
          <Card className="flex flex-col gap-4">
            <p>
              You have a complete set of markers from {formatDate(latest.date)}. To calculate biological age, enter your month and year
              of birth.
            </p>
            <BirthMonthField key={profile.birthMonth ?? "none"} value={profile.birthMonth} onChange={(birthMonth) => void setProfile({ ...profile, birthMonth })} />
          </Card>
        ) : latest.status === "too-young" ? (
          <Notice title="Not available under 20">
            PhenoAge was built from data on adults aged {PHENOAGE_MIN_AGE} and over, so it isn't shown for younger people.
          </Notice>
        ) : latest.status === "crp-zero" ? (
          <Notice tone="warn" title="CRP of 0 can't be used">
            The CRP from {formatDate(latest.date)} is saved as 0. Labs usually report a very low CRP as something like "&lt;0.3". Delete
            that result and enter it the way your report shows it.
          </Notice>
        ) : (
          <>
            <Result draw={latest} />
            {summary.latestPartial && <NeedsMarkers partial={summary.latestPartial} newer />}
            {summary.draws.length > 1 && <History draws={summary.draws} />}
          </>
        )}
        <Explanation profile={profile} />
        <HeartAgeSection ms={bodyOnly(all)} profile={profile} protocols={protocols} />
        <FitnessAgeSection ms={bodyOnly(all)} profile={profile} />
        <FitnessForYourAge ms={bodyOnly(all)} profile={profile} />
      </div>
    </>
  );
}

function Result({ draw }: { draw: PhenoAgeDraw }) {
  const diff = draw.difference!;
  const diffText =
    Math.abs(diff) < 0.05
      ? "the same as your calendar age"
      : `${formatYears(Math.abs(diff))} years ${diff < 0 ? "lower" : "higher"} than your calendar age`;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-ink-2">Estimate from your blood test on {formatDate(draw.date)}</p>
        <p className="font-serif text-6xl font-normal tabular-nums">
          {formatYears(draw.phenoAge!)} <span className="text-xl font-normal text-ink-2">years</span>
        </p>
        <p className="mt-1 text-ink-2">
          Your calendar age then: {formatYears(draw.age!)} years. The estimate is <span className="font-medium text-ink">{diffText}</span>.
        </p>
      </div>

      {draw.approximate.length > 0 && (
        <Notice tone="warn" title="Approximate">
          {draw.approximate.map(({ biomarkerId, qualifier }) => {
            const def = BIOMARKER_MAP.get(biomarkerId)!;
            return (
              <p key={biomarkerId}>
                {fullName(def)} was reported as "{showMeasurement(def, draw.used[biomarkerId], def.canonicalUnit)} {def.canonicalUnit}", so
                the limit was used. The real value is {qualifier === "<" ? "lower" : "higher"}, so the estimate may be slightly off.
              </p>
            );
          })}
        </Notice>
      )}

      <p className="text-ink-2">
        Small differences, and changes from one test to the next, are often just normal variation. A recent cold or infection can push it up
        for a few weeks. Watch the trend over years rather than a single number.
      </p>

      <details className="group rounded-lg border border-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 font-medium select-none">
          Values used
          <span aria-hidden="true" className="text-ink-2 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <ul className="divide-y divide-line border-t border-line">
          {PHENOAGE_MARKERS.map((id) => {
            const def = BIOMARKER_MAP.get(id)!;
            const m = draw.used[id];
            return (
              <li key={id}>
                <a href={href({ name: "marker", id })} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-ink no-underline hover:bg-sunken">
                  <span>{fullName(def)}</span>
                  <span className="whitespace-nowrap tabular-nums">
                    {showMeasurement(def, m, def.canonicalUnit)} <span className="text-ink-2">{def.canonicalUnit}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </details>
    </Card>
  );
}

function History({ draws }: { draws: PhenoAgeDraw[] }) {
  const rows = draws.filter((d) => d.status === "ok").reverse();
  return (
    <Card>
      <h2 className="mb-3 font-serif text-2xl font-normal">Over time</h2>
      <table className="w-full text-left tabular-nums">
        <thead className="text-sm text-ink-2">
          <tr>
            <th className="pb-2 font-medium">Blood test</th>
            <th className="pb-2 text-right font-medium">Age</th>
            <th className="pb-2 text-right font-medium">PhenoAge</th>
            <th className="pb-2 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((d) => (
            <tr key={d.date}>
              <td className="py-2">{formatDate(d.date)}</td>
              <td className="py-2 text-right">{formatYears(d.age!)}</td>
              <td className="py-2 text-right font-medium">{formatYears(d.phenoAge!)}</td>
              <td className="py-2 text-right">
                {d.difference! > 0 ? "+" : d.difference! < 0 ? "−" : ""}
                {formatYears(Math.abs(d.difference!))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function NeedsMarkers({ partial, newer }: { partial?: { date: string; missing: string[] }; newer?: boolean }) {
  const missing = new Set(partial?.missing ?? PHENOAGE_MARKERS);
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">{newer ? `Your newest test (${formatDate(partial!.date)}) is incomplete` : "What's needed"}</h2>
      <p className="text-ink-2">
        All 9 markers must come from the <span className="font-medium text-ink">same blood test</span>, because values from different days
        can't be combined. Most are part of a standard blood count and metabolic panel. CRP is sometimes ordered separately.
        {partial && !newer && ` Your newest test, from ${formatDate(partial.date)}, has ${9 - missing.size} of 9.`}
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {PHENOAGE_MARKERS.map((id) => {
          const has = partial ? !missing.has(id) : false;
          return (
            <li key={id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${has ? "bg-ok-soft text-ok" : "bg-sunken text-ink-2"}`}
              >
                {has ? "✓" : "·"}
              </span>
              <span>
                {fullName(BIOMARKER_MAP.get(id)!)}
                {partial && <span className="sr-only">{has ? " (entered)" : " (missing)"}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <div>
        <LinkButton href={href({ name: "add" })}>Add results</LinkButton>
      </div>
    </Card>
  );
}

function Explanation({ profile }: { profile: Profile }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">What is PhenoAge?</h2>
      <p>
        PhenoAge is a formula published by Morgan Levine and colleagues in 2018. They used a large US national health survey (NHANES) to
        find which routine blood markers, together with age, best predicted how many people died over the following years. The formula
        turns that risk into an age: the calendar age at which an average person in that survey had the same risk.
      </p>
      <p>
        So a PhenoAge below your calendar age means your markers looked like those of a typical younger person in that population. It does
        not measure how your cells or organs are ageing.
      </p>
      <h3 className="font-semibold">Things to keep in mind</h3>
      <ul className="list-disc pl-5 text-ink-2">
        <li>It's a statistical estimate for groups of people. For one person it can be off in either direction.</li>
        <li>It was built from US adults. It may fit other populations less well.</li>
        <li>
          Short-term things move it: infections raise CRP and white cells, eating before the test raises glucose, and dehydration or high
          muscle mass can raise creatinine.
        </li>
        <li>Lab methods differ, so comparing tests from the same lab is more reliable.</li>
        <li>Many things that matter for health aren't captured by these 9 markers at all.</li>
      </ul>
      <p className="text-ink-2">
        It is not a diagnosis. If any of the markers is out of range, talk to your doctor about that marker itself.
        {!profile.birthMonth && " Your month and year of birth can be set on the Data page."}
      </p>
      <p className="text-sm text-ink-2">
        Source:{" "}
        <a href={LEVINE_URL} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
          An epigenetic biomarker of aging for lifespan and healthspan
        </a>{" "}
        (Levine et al., Aging, 2018). The clinical formula is in Table 1 and the supplement.
      </p>
    </Card>
  );
}
