import { useEffect, useMemo, useState } from "react";
import { todayIso } from "../../../core/dates";
import { bestBeforeMoments, lifeTablePeriod, type ResolvedLifeTable } from "../../../core/lifeTable";
import { validateMortalityModels, type MortalityModelFile } from "../../../core/mortalityModel";
import { mortalityProjection, type ProjectionInput } from "../../../core/mortalityProjection";
import { isBirthMonth } from "../../../core/phenoageDraws";
import type { Measurement, Profile } from "../../../core/types";
import { Popover } from "@base-ui/react/popover";
import { EGG_ODDS } from "../../easterEggs";
import { formatDate } from "../../format";
import { setMortalityActivityLeisure, useMortalityActivityLeisure } from "../../hooks";
import { ChoiceGroup } from "../ChoiceGroup";
import { Card, cx } from "../ui";

const exact = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });
const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`;
const yrs = (v: number) => v.toFixed(1);

const inputNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const ratioNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
const count = new Intl.NumberFormat();

function ProjectionInputs({ inputs }: { inputs: readonly ProjectionInput[] }) {
  return (
    <dl className="flex flex-col gap-3 text-sm">
      {inputs.map((input) => (
        <div key={input.key} className="grid gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-4">
          <dt className="font-medium">{input.label}</dt>
          <dd className="min-w-0 text-ink-2">
            {input.value !== undefined && (
              <span className="text-ink">
                {typeof input.value === "number" ? (input.key === "waistToHeight" || input.key === "dunedinpace" ? ratioNumber : inputNumber).format(input.value) : input.value}
                {input.unit ? ` ${input.unit}` : ""}
                {input.date ? ` · ${formatDate(input.date)}` : ""}
                {input.detail ? ". " : ""}
              </span>
            )}
            {input.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Opt-in exact dates and experimental transport of fitted ten-year risk. */
export function BestBefore({ measurements, profile, found }: { measurements: readonly Measurement[]; profile: Profile; found: ResolvedLifeTable }) {
  const [models, setModels] = useState<MortalityModelFile>();
  const [modelFailed, setModelFailed] = useState(false);
  const [activityError, setActivityError] = useState<string>();
  const activity = useMortalityActivityLeisure();
  // Easter egg (the user's idea), about once in 50 views. Only the headline changes;
  // the description still names the true median, and the cause explains itself on hover or tap.
  const [egg] = useState(() => (Math.random() < 1 / EGG_ODDS ? Date.now() + 86_400_000 + Math.floor(Math.random() * 86_400) * 1000 - (Date.now() % 1000) : undefined));
  useEffect(() => {
    let active = true;
    void import("../../../../knowledge/models/mortality.json")
      .then((m) => {
        if (!active) return;
        if (validateMortalityModels(m.default).length) {
          setModelFailed(true);
          return;
        }
        setModels(m.default as MortalityModelFile);
      })
      .catch(() => { if (active) setModelFailed(true); });
    return () => { active = false; };
  }, []);
  const today = todayIso();
  const projection = useMemo(
    () => models ? mortalityProjection(found.table, profile, measurements, today, models, activity === true) : undefined,
    [found.table, models, profile, measurements, today, activity],
  );

  if (!profile.birthMonth || !isBirthMonth(profile.birthMonth)) {
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl">Expiration date</h2>
        <p className="text-ink-2">Add your month and year of birth (Settings → Your data) to see it.</p>
      </Card>
    );
  }

  const plain = projection?.plain ?? bestBeforeMoments(found.table, profile.birthMonth, today);
  if (!(plain.age >= 0)) {
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl">Expiration date</h2>
        <p className="text-ink-2">Check your month and year of birth in Settings. It cannot be in the future.</p>
      </Card>
    );
  }
  const mine = projection?.adjusted;
  const head = mine ?? plain;
  const prediction = projection?.prediction;
  const selected = prediction?.model;
  const evaluation = selected?.evaluation;
  const who = found.sex === "f" ? "women" : found.sex === "m" ? "men" : "people";

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-serif text-2xl">Expiration date</h2>
        <p className="max-w-3xl text-sm text-ink-2">Population statistics, not a prediction of when you will die. The fitted-risk lifetime projection is experimental and has not been validated.</p>
      </div>

      <div className={cx("grid gap-5", mine && "lg:grid-cols-2 lg:gap-8")}>
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="font-medium">{mine ? "Experimental fitted-risk projection" : "Country population reference"}</h3>
          <p className={cx("font-serif text-3xl leading-tight tabular-nums sm:text-4xl", egg !== undefined && "text-danger")}>{exact.format(new Date(egg ?? head.medianAt))}</p>
          {egg !== undefined && (
            <Popover.Root>
              <Popover.Trigger openOnHover delay={150} className="min-h-11 cursor-help self-start font-medium underline decoration-dotted underline-offset-4">
                Cause: car crash.
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[60] outline-none">
                  <Popover.Popup className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md">Easter egg (1 in {EGG_ODDS})</Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          )}
          <p className="max-w-3xl text-sm">
            {mine ? (
              <>Under the constant-risk-age-gap assumption, half of the shifted population live past {egg !== undefined ? exact.format(new Date(head.medianAt)) : "this moment"}, and half don't. This is not an observed lifespan for people with your readings.</>
            ) : (
              <>At {lifeTablePeriod(found.source.period)} death rates, half of {who} aged {yrs(plain.age)} in {found.name} live past {egg !== undefined ? exact.format(new Date(head.medianAt)) : "this moment"}, and half don't.</>
            )}
          </p>
        </section>
        {mine && (
          <section className="flex min-w-0 flex-col gap-2 border-t border-line pt-4 lg:border-t-0 lg:pt-0">
            <h3 className="font-medium">Population reference date</h3>
            <p className="font-serif text-2xl leading-tight tabular-nums">{exact.format(new Date(plain.medianAt))}</p>
            <p className="text-sm text-ink-2">Unshifted country life table: {who} aged {yrs(plain.age)} in {found.name}, using {lifeTablePeriod(found.source.period)} death rates. No personal reading or fitted weight changes this reference.</p>
          </section>
        )}
      </div>
      <p className="max-w-3xl text-sm text-ink-2">Source: <a href={found.source.url} target="_blank" rel="noopener noreferrer" className="text-accent">{found.source.name}</a>, {lifeTablePeriod(found.source.period)}. {found.source.note}</p>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="font-medium">Middle half of the {mine ? "shifted" : "country"} population</h3>
        <p className="text-sm">{day.format(new Date(head.quarterAt))} – {day.format(new Date(head.threeQuartersAt))}</p>
        <p className="max-w-3xl text-sm text-ink-2">A quarter die before this range and a quarter live past it. It is a population spread, not an individual confidence interval and not uncertainty in the fitted model.</p>
      </div>

      <section className="flex max-w-3xl flex-col gap-2">
        <h3 className="font-medium">Fitted ten-year mortality risk</h3>
        {prediction?.status === "ok" && prediction.risk10 !== undefined ? (
          <>
            <p><span className="font-medium tabular-nums">{pct(prediction.risk10)}</span> risk of death from any cause over ten years in the fitted US cohort model.</p>
            <p className="text-sm text-ink-2">
              {selected?.label}. Inputs are jointly fitted, including smoking; this is not heart-attack or stroke risk and not the original PhenoAge risk equation.
              {prediction.riskAge !== undefined && !prediction.riskAgeBound && <> Its risk matches the age-and-sex-only comparison at age {yrs(prediction.riskAge)}.</>}
              {mine && <> The lifetime projection reads your country table at that risk-equivalent age and holds its gap from your calendar age constant for the rest of life. That transfer has not been validated.</>}
            </p>
            {evaluation && (
              <div className="mt-2 flex flex-col gap-2">
                <table className="w-full max-w-md text-left text-sm tabular-nums">
                  <caption className="pb-2 text-left text-ink-2">Ten-year mortality in the held-out cohort</caption>
                  <thead><tr className="border-b border-line"><th scope="col" className="py-2 pr-4 font-medium">Predicted on average</th><th scope="col" className="py-2 font-medium">Observed</th></tr></thead>
                  <tbody><tr><td className="py-2 pr-4">{pct(evaluation.weightedMeanPredictedRisk10)}</td><td className="py-2">{pct(evaluation.weightedObservedRisk10)}</td></tr></tbody>
                </table>
                <p className="text-sm text-ink-2">Average predictions and observed deaths did not match exactly. Better scores than the age/sex baseline do not make this a calibrated personal-risk calculator, especially in another country.</p>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-2" role="status">
            {modelFailed ? "The fitted models could not be loaded. The country population reference is still available; reload the page to try the models again." : !models ? "Loading fitted models. The country population reference is shown meanwhile." : "No compatible fitted-risk projection is available. The country population reference above is unchanged."}
          </p>
        )}
        {prediction?.reasons.map((reason) => <p key={reason} className="text-sm text-ink-2">{reason}</p>)}
      </section>

      <details className="max-w-3xl border-t border-line pt-2">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Inputs used, readings left out, and exercise assumption</summary>
        <div className="flex flex-col gap-5 py-3">
          <section className="flex flex-col gap-3">
            <h3 className="font-medium">Included in the selected fit</h3>
            {projection?.included.length ? <ProjectionInputs inputs={projection.included} /> : <p className="text-sm text-ink-2">No fitted model selected; personal readings do not change the population reference.</p>}
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="font-medium">Not used in the fit</h3>
            <p className="text-sm text-ink-2">Not included does not mean unimportant. These measurements are outside this model's data or measurement definitions.</p>
            {projection ? <ProjectionInputs inputs={projection.notUsed} /> : <p className="text-sm text-ink-2">No fitted model is loaded, so no personal reading is included. Resting heart-rate variability (HRV), DunedinPACE and functional tests have no compatible fitted weights.</p>}
          </section>
          <section className="flex flex-col gap-2">
            {activity === undefined ? <p className="text-sm text-ink-2" role="status">Loading this profile's exercise assumption…</p> : (
              <ChoiceGroup<"off" | "on">
                label="Do your saved active minutes match this exercise definition?"
                help="Only actual moderate-or-harder LEISURE exercise, in sessions of at least 10 minutes. Count a vigorous minute once, not twice. All-day active time, zone minutes and weighted intensity minutes do not qualify. Off by default; saved with this profile."
                value={activity ? "on" : "off"}
                options={[{ value: "off", label: "Do not use" }, { value: "on", label: "Yes, my minutes match" }]}
                onChange={(value) => {
                  setActivityError(undefined);
                  void setMortalityActivityLeisure(value === "on").catch(() => setActivityError("This exercise assumption could not be saved. Choose it again to retry."));
                }}
              />
            )}
            <p className="text-sm text-ink-2">At least 21 recorded daily totals in the last 30 days are required. Their daily average estimates a week; missing days are not zero. The cohort used recalled leisure exercise over 30 days. Transferring that association to your diary or device minutes has not been validated.</p>
            {activityError && <p role="alert" className="text-sm text-danger">{activityError}</p>}
          </section>
          {!!projection?.cautions.length && (
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-ink-2">{projection.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>
          )}
        </div>
      </details>

      <details className="max-w-3xl">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Method, held-out results, and limits</summary>
        <div className="flex flex-col gap-4 py-3 text-sm text-ink-2">
          {selected && evaluation && (
            <section className="flex flex-col gap-3">
              <h3 className="font-medium text-ink">Selected model: {selected.label}</h3>
              <p>Development: {count.format(evaluation.trainingPeople)} people, {count.format(evaluation.trainingDeaths)} deaths. Holdout evaluation: {count.format(evaluation.testPeople)} people, {count.format(evaluation.testDeaths)} deaths. {evaluation.testDescription}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left tabular-nums">
                  <caption className="pb-2 text-left">Survey-weighted ten-year results, compared on the same holdout people</caption>
                  <thead><tr className="border-b border-line"><th scope="col" className="py-2 pr-4 font-medium">Measure</th><th scope="col" className="px-2 py-2 font-medium">Selected fit</th><th scope="col" className="py-2 pl-2 font-medium">Age/sex only</th></tr></thead>
                  <tbody>
                    <tr className="border-b border-line"><th scope="row" className="py-2 pr-4 font-normal">AUC</th><td className="px-2 py-2">{evaluation.auc.toFixed(3)}</td><td className="py-2 pl-2">{evaluation.baselineAuc.toFixed(3)}</td></tr>
                    <tr><th scope="row" className="py-2 pr-4 font-normal">Brier score</th><td className="px-2 py-2">{evaluation.brier.toFixed(4)}</td><td className="py-2 pl-2">{evaluation.baselineBrier.toFixed(4)}</td></tr>
                  </tbody>
                </table>
              </div>
              <p>AUC measures ranking (higher is better); Brier is the mean squared error of predicted probabilities (lower is better), not “percent accuracy.” The prespecified gate requires a lower Brier score and no lower AUC than age/sex alone. Passing that gate does not validate an individual risk, another country or any lifetime date.</p>
              <p>Model choice follows available compatible inputs, not a per-person accuracy ranking. Supported calendar ages: {selected.ageFrom} to under {selected.ageTo}. No lifetime date is extrapolated when the risk-equivalent age is outside that range.</p>
            </section>
          )}
          {models && (
            <>
              <p>{models.method}</p>
              <p>Model version {models.version}; fitted {formatDate(models.fittedOn)}. Development used NHANES 1999–2004; the untouched temporal holdout was 2005–2006, with linked mortality through 2019. Ten-year labels approximate public, perturbed follow-up times. These complete-case samples are not claimed to represent every US adult.</p>
              {!!models.limitations.length && <ul className="flex list-disc flex-col gap-2 pl-5">{models.limitations.map((limit) => <li key={limit}>{limit}</li>)}</ul>}
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-medium text-ink">Public training sources</summary>
                <ul className="flex list-disc flex-col gap-2 pl-5">
                  {models.sources.map((source) => <li key={source.url}><a className="break-all text-accent" href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a></li>)}
                </ul>
              </details>
            </>
          )}
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>The country date is the median of a population life table. The experimental date shifts that table using fitted ten-year risk, not a validated lifetime survival model. Neither says when one person will die, and neither tells you how many years an intervention would add.</li>
            <li>Life table: {found.source.name}, {found.name}, {lifeTablePeriod(found.source.period)}, {who}. Survivors are joined between ages; past 95 they fall at a constant rate.</li>
            <li>The displayed population's mean remaining life is {yrs(head.expectancy)} years; its median is the date above. These are different summaries, not personal predictions.</li>
            <li>The calculation uses the middle of your birth month and displays seconds in your time zone. Seconds are calculation precision, not prediction precision. The date stays fixed through today; surviving another day changes the reference slightly.</li>
            <li>A period life table holds its reporting period's death rates constant. Future rates can change. The middle-half range is not an individual confidence interval. Not medical advice. Not a medical device.</li>
          </ul>
        </div>
      </details>
    </Card>
  );
}
