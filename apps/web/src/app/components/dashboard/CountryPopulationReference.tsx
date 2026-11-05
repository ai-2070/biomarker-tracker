import { useRef } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { todayIso } from "@bt/shared/core/dates";
import { ageAtMoment, bestBefore, LIFE_TABLE_COUNTRIES, lifeTablePeriod, populationSurvival, tableFor, type PopulationSurvivalPoint } from "@bt/shared/core/lifeTable";
import { isBirthMonth } from "@bt/shared/core/phenoageDraws";
import type { Profile } from "@bt/shared/core/types";
import { href } from "../../router";
import { useLifeTables } from "../../lifeTables";
import { InlineBirthMonth } from "../InlineBirthMonth";
import { InlineCountry } from "../InlineCountry";
import { CountryComparison } from "./CountryComparison";
import { useWidth } from "../timeControls";
import { Card } from "../ui";

const years = (value: number) => value.toFixed(1);

export function CountryPopulationReference({ profile }: { profile: Profile }) {
  const { file, failed } = useLifeTables();

  const knownCountry = !!profile.country && Object.hasOwn(LIFE_TABLE_COUNTRIES, profile.country);
  const country = file && profile.country && Object.hasOwn(file.countries, profile.country) ? file.countries[profile.country] : undefined;
  const found = file ? tableFor(file, profile.country, profile.sex) : undefined;
  const age = profile.birthMonth && isBirthMonth(profile.birthMonth)
    ? ageAtMoment(profile.birthMonth, Date.parse(`${todayIso()}T00:00:00Z`)) : undefined;
  const validAge = age !== undefined && Number.isFinite(age) && age >= 0;
  const summary = found && validAge ? bestBefore(found.table, age) : undefined;
  const points = found && validAge ? populationSurvival(found.table, age) : [];
  const who = found?.sex === "f" ? "Women" : found?.sex === "m" ? "Men" : "Both sexes";

  return (
      <Card className="flex min-w-0 flex-col gap-5">
        <div className="max-w-3xl">
          <h2 className="font-serif text-2xl font-normal">Country population reference</h2>
          <p className="mt-2 text-ink-2">Of people alive at your current calendar age, how many live to later ages? This is a population comparison, not your personal prediction or risk percentile.</p>
        </div>
        {!knownCountry ? (
          <>
            <p className="max-w-3xl text-ink-2">{profile.country ? "Your saved country is not supported. " : ""}Choose where you live to use its official life table. Choosing alone does not save it.</p>
            <InlineCountry key={`${profile.name}:${profile.country ?? ""}`} profile={profile} />
          </>
        ) : !file ? (
          <p role="status" className="text-ink-2">{failed ? "The country life tables could not be loaded. Reload the page to try again." : "Loading country life tables…"}</p>
        ) : !country ? (
          <p role="status" className="text-ink-2">The life table for your saved country is unavailable in this copy of the app. Reload the page to try again, or check your country in <a href={href({ name: "data", tab: "data" })}>Settings → Your data</a>.</p>
        ) : (
          <>
            <p className="text-sm text-ink-2">{country.name} · {found ? who : "Sex needed"} · {lifeTablePeriod(country.source.period)} death rates. <a href={href({ name: "data", tab: "data" })}>Change profile details</a></p>
            {!found ? (
              <p className="max-w-3xl text-ink-2">This country's source has separate tables for women and men, but no combined table. Add your sex in <a href={href({ name: "data", tab: "data" })}>Settings → Your data</a> to see the reference. No average is invented.</p>
            ) : !validAge ? (
              <div className="max-w-3xl">
                <p className="text-ink-2">{age !== undefined ? "Check your month and year of birth in Settings. It cannot be in the future." : "Add your month and year of birth to see the reference for your current age."}</p>
                {!profile.birthMonth && <InlineBirthMonth profile={profile} forLabel="country population reference" />}
              </div>
            ) : summary && points.length ? (
              <>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div><dt className="text-sm text-ink-2">Median age reached</dt><dd className="mt-1 text-2xl tabular-nums">{years(summary.median)} years</dd></div>
                  <div><dt className="text-sm text-ink-2">Average remaining life</dt><dd className="mt-1 text-2xl tabular-nums">{years(summary.expectancy)} years</dd></div>
                  <div><dt className="text-sm text-ink-2">Middle half reach ages</dt><dd className="mt-1 text-2xl tabular-nums">{years(summary.quarter)}–{years(summary.threeQuarters)}</dd></div>
                </dl>
                <p className="max-w-3xl text-sm text-ink-2">Among {who.toLowerCase()} alive at age {years(age)} in {found.name}, half live beyond the median age. A quarter die before the middle-half range and a quarter live beyond it. That spread is not an individual confidence interval.</p>
                <SurvivalChart points={points} />
                <CountryComparison file={file} age={age} sex={profile.sex} selectedCountry={profile.country} />
              </>
            ) : <p role="status" className="text-ink-2">No population survival curve is available for this age.</p>}
            <div className="flex max-w-3xl flex-col gap-2 border-t border-line pt-4 text-sm text-ink-2">
              <p>Source: <a href={country.source.url} target="_blank" rel="noopener noreferrer" className="text-accent">{country.source.name}</a>, {lifeTablePeriod(country.source.period)}. Retrieved {country.source.retrieved}.</p>
              {country.source.note && <p>{country.source.note}</p>}
              <p>A period life table holds the reporting period's death rates constant. Future rates can change. It does not account for your blood tests, habits or fitted risk. Ages use the middle of your birth month.</p>
              <p>Survivors are joined by straight lines through age 95. Beyond 95, the dashed curve approximates survival with a constant death rate based on remaining life expectancy at 95. Not medical advice. Not a medical device.</p>
            </div>
          </>
        )}
      </Card>
  );
}

function SurvivalChart({ points }: { points: PopulationSurvivalPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const current = points[0]!;
  const series = points.map((point) => ({
    ...point,
    observed: point.age <= 95 ? point.alivePercent : null,
    tail: point.age >= 95 ? point.alivePercent : null,
  }));
  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption className="font-medium">Population survival from your current age</figcaption>
      <p className="text-sm text-ink-2">Your age: {years(current.age)} years. Vertical axis: people still alive out of 100 alive at that age. Horizontal axis: age in years.</p>
      <div ref={box} className="w-full min-w-0" aria-label="Population survival curve; the same values are available in the table below">
        {width > 0 && (
          <LineChart width={width} height={width < 640 ? 240 : 280} data={series} margin={{ top: 26, right: 16, bottom: 4, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="2 4" />
            <XAxis dataKey="age" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "var(--color-ink-2)", fontSize: 12 }} stroke="var(--color-line-strong)" minTickGap={28} tickFormatter={(value: number) => value.toFixed(0)} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={34} tick={{ fill: "var(--color-ink-2)", fontSize: 12 }} stroke="var(--color-line-strong)" />
            <ReferenceLine y={50} stroke="var(--color-ink-2)" strokeDasharray="4 4" />
            <ReferenceLine x={current.age} stroke="var(--color-ink-2)" label={{ value: "Your age", position: "insideTopLeft", fill: "var(--color-ink-2)", fontSize: 12 }} />
            <ReferenceDot x={current.age} y={100} r={4} fill="var(--color-ink)" stroke="var(--color-surface)" />
            <Tooltip cursor={{ stroke: "var(--color-line-strong)" }} content={({ active, payload }) => {
              const point = active ? payload?.[0]?.payload as PopulationSurvivalPoint | undefined : undefined;
              return point ? <div className="max-w-56 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-sm"><p className="font-medium">Age {years(point.age)}</p><p>{point.alivePercent.toFixed(1)} out of 100 still alive</p>{point.tailApproximation && <p className="text-ink-2">95+ tail approximation</p>}</div> : null;
            }} />
            <Line type="linear" dataKey="observed" name="Population survival" stroke="var(--color-ink)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="tail" name="95+ approximation" stroke="var(--color-ink)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </LineChart>
        )}
      </div>
      <p className="text-sm text-ink-2">Solid: life-table ages through 95. Dashed: 95+ approximation. The 50-out-of-100 guide marks half the population, not a personal percentile.</p>
      <details className="border-t border-line">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">Show survival as a table</summary>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <caption className="pb-3 text-left text-ink-2">Out of 100 people alive at your current age ({years(current.age)}). Values after 95 use the tail approximation.</caption>
            <thead><tr className="border-b border-line"><th scope="col" className="py-2 pr-3 font-medium">Age (years)</th><th scope="col" className="py-2 font-medium">Still alive out of 100</th></tr></thead>
            <tbody>{points.map((point, index) => <tr key={point.age} className="border-b border-line"><th scope="row" className="py-2 pr-3 font-normal">{years(point.age)}{index === 0 ? " · Your age" : ""}{point.tailApproximation ? " (approx.)" : ""}</th><td className="py-2">{point.alivePercent.toFixed(1)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
