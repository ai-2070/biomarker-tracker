import { useMemo, useState } from "react";
import { buildDashboard } from "@bt/shared/core/dashboard";
import { DEMO_BODY_IDS, demoBodyMeasurements } from "@bt/shared/core/demo";
import { addMeasurements } from "../../db/db";
import { todayIso } from "@bt/shared/core/dates";
import { BloodPressureFigure, BmiFigure, BmrFigure, BodyEntryForm, GlucoseFigure, LatestFigure, WaistFigure, WeightFigure, inBodyOrder } from "../components/dashboard/body";
import { BODY_GROUPS, FITNESS_FIELDS } from "@bt/shared/core/body";
import { HabitsPanel, MarkerGrid, cardStyles } from "../components/dashboard/widgets";
import { HeartAgeFigure } from "../components/dashboard/heartAge";
import { FitnessAgeFigure } from "../components/dashboard/fitnessAge";
import { CriticalBanner } from "../components/CriticalBanner";
import { WaistToHeightFigure } from "../components/dashboard/waistToHeight";
import { FitnessFigure } from "../components/dashboard/fitness";
import { PlusIcon } from "../components/icons";
import { Button, Card, LinkButton, Notice, PageTitle } from "../components/ui";
import { formatDate, lowerFirst } from "../format";
import { useAllMeasurements, useExperiments, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, bodyOnly } from "../knowledge";
import { href } from "../router";
import { ActiveTimeFigure, StepsFigure } from "../components/dashboard/activity";
import { SavedResults } from "../components/SavedResults";

/** Shown as a figure on this page, so not repeated as a tile. */
const FIGURED = new Set([...FITNESS_FIELDS, "weight", "waist", "body_fat", "bp_systolic", "bp_diastolic", "resting_hr", "hrv_resting", "spo2", "glucose_home", "sleep_duration", "sleep_deep", "sleep_rem", "vo2max", "steps", "active_minutes"]);

/** The body dashboard: weight, BMI, waist, blood pressure and resting heart rate over time. */
export function BodyPage() {
  const all = useAllMeasurements();
  const protocols = useProtocols();
  const experiments = useExperiments();
  const profile = useProfile();
  const today = todayIso();
  const [saved, setSaved] = useState(0);
  const [managing, setManaging] = useState(false);
  const body = useMemo(() => (all ? bodyOnly(all) : undefined), [all]);
  const d = useMemo(
    () => (body && protocols && experiments ? buildDashboard({ measurements: body, protocols, experiments, profile, defs: BIOMARKER_MAP, today }) : undefined),
    [body, protocols, experiments, profile, today],
  );
  if (!d || !body || !protocols) return <p className="text-ink-2">Loading…</p>;
  const empty = d.markers.length === 0;

  if (managing) return (
    <>
      <CriticalBanner items={d.critical.map((m) => ({ def: m.def, measurement: m.latest, low: m.flag === "critical-low" }))} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <PageTitle sub="Edit saved measurements and device readings, or select several to delete.">Manage body results</PageTitle>
        <Button variant="secondary" onClick={() => setManaging(false)}>Back to Body</Button>
      </div>
      <SavedResults measurements={body} />
    </>
  );

  const form = (
    <Card className="animate-enter">
      <h2 className="mb-4 font-serif text-2xl font-normal">Add measurements</h2>
      <BodyEntryForm
        cancel={false}
        onDone={(n) => setSaved(n)}
      />
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <CriticalBanner items={d.critical.map((m) => ({ def: m.def, measurement: m.latest, low: m.flag === "critical-low" }))} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">Body</h1>
          <p className="mt-1 text-ink-2">
            {empty
              ? "Weight, waist, blood pressure and resting heart rate, measured at home or at the doctor's."
              : `Latest measurement ${formatDate(d.lastTest!)} · ${body.length} ${body.length === 1 ? "measurement" : "measurements"} since ${d.draws[0]!.date.slice(0, 4)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!empty && <Button variant="secondary" onClick={() => setManaging(true)}>Manage results</Button>}
          <LinkButton variant="secondary" href={href({ name: "device-import" })}>
            Import from a device
          </LinkButton>
          {!empty && (
            <LinkButton href={href({ name: "add", kind: "body" })}>
              <PlusIcon />
              Add measurements
            </LinkButton>
          )}
        </div>
      </header>

      {saved > 0 && (
        <Notice role="status" title={`Saved ${saved} ${saved === 1 ? "measurement" : "measurements"}`}>
          They're on your charts below.
        </Notice>
      )}
      {profile.example && <ExampleBodyData have={new Set(body.map((m) => m.biomarkerId))} />}
      {empty && form}

      {!empty && (
        <>
          {BODY_GROUPS.map((g) => {
            // Charts for what the figures above don't already show (each figure opens its own chart).
            const markers = inBodyOrder(d.markers.filter((m) => (g.fields as readonly string[]).includes(m.def.id) && !FIGURED.has(m.def.id)));
            return (
              <section key={g.id} aria-labelledby={`body-${g.id}`} className="flex flex-col gap-3">
                <h2 id={`body-${g.id}`} className="font-serif text-2xl font-normal">
                  {g.title}
                </h2>
                <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {g.id === "size" && (
                    <>
                      <WeightFigure ms={body} />
                      <WaistFigure ms={body} profile={profile} />
                      <WaistToHeightFigure ms={body} profile={profile} />
                      <BmiFigure ms={body} profile={profile} />
                      <LatestFigure ms={body} id="body_fat" label="Body fat" profile={profile} className="col-span-2" chart />
                      <BmrFigure ms={body} profile={profile} className="col-span-2" />
                    </>
                  )}
                  {g.id === "heart" && (
                    <>
                      <BloodPressureFigure ms={body} profile={profile} />
                      <LatestFigure ms={body} id="resting_hr" label="Resting heart rate" profile={profile} />
                      <LatestFigure ms={body} id="hrv_resting" label="Resting HRV" profile={profile} />
                      <LatestFigure ms={body} id="spo2" label="Blood oxygen" profile={profile} />
                      <HeartAgeFigure ms={body} profile={profile} protocols={protocols} className="col-span-2" />
                      <LatestFigure ms={body} id="vo2max" label="VO₂max" profile={profile} />
                      <FitnessAgeFigure ms={body} profile={profile} />
                    </>
                  )}
                  {g.id === "sleep" && (
                    <>
                      <LatestFigure ms={body} id="sleep_duration" label="Sleep" profile={profile} className="col-span-2" chart />
                      <LatestFigure ms={body} id="sleep_deep" label="Deep sleep" profile={profile} />
                      <LatestFigure ms={body} id="sleep_rem" label="REM sleep" profile={profile} />
                    </>
                  )}
                  {g.id === "activity" && (
                    <>
                      <StepsFigure ms={body} className="col-span-2" />
                      <ActiveTimeFigure ms={body} profile={profile} className="col-span-2" />
                    </>
                  )}
                  {g.id === "sugar" && <GlucoseFigure ms={body} profile={profile} className="col-span-2" />}
                  {g.id === "fitness" &&
                    FITNESS_FIELDS.map((id, i) => <FitnessFigure key={id} ms={body} id={id} profile={profile} {...(i === FITNESS_FIELDS.length - 1 ? { className: "col-span-2" } : {})} />)}
                </div>
                {markers.length > 0 && <MarkerGrid markers={markers} title={`${g.title}: more`} hideTitle limit={12} />}
              </section>
            );
          })}

          <div className="grid gap-4 lg:grid-cols-2">
              <section className={cardStyles}>
                <h2 className="font-serif text-xl font-normal">About these numbers</h2>
                <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
                  <li>BMI and waist size are rough guides to health risk, not verdicts. BMI can't tell muscle from fat.</li>
                  <li>Home blood pressure runs lower than in a clinic. One high reading isn't a diagnosis; repeated ones are worth discussing with a doctor.</li>
                  <li>Resting metabolic rate (often called basal metabolic rate) is an estimate of the energy your body uses at rest. It isn't a target, and not a reason to eat less; for changes to your weight, talk to your doctor or a dietitian.</li>
                  <li>Home glucose meters can be about 15 % off. A diagnosis always needs a lab test.</li>
                  <li>Watches and rings estimate heart rate, HRV, blood oxygen and sleep stages; compare them with your own past readings rather than with other people. Company sleep scores aren't imported: they're each company's own formula.</li>
                  <li>Day-to-day swings are normal. Measure the same way and at the same time of day, and follow the trend.</li>
                </ul>
                <p className="mt-3 text-sm text-ink-2">
                  Watch, ring or phone app data can be imported from their export files (
                  <a href={href({ name: "device-import" })} className="text-accent">
                    Import from a device
                  </a>
                  ). Coming later: automatic sync from your phone (
                  <a href={href({ name: "soon", section: "devices" })} className="text-accent">
                    Devices
                  </a>
                  ).
                </p>
              </section>
            <HabitsPanel protocols={protocols} experiments={experiments ?? []} all={all ?? []} today={today} />
          </div>
        </>
      )}
    </div>
  );
}

/** Example profiles made before body measurements existed can get the example's body data. Never offered on a real profile. */
function ExampleBodyData({ have }: { have: ReadonlySet<string> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addMeasurements(
        demoBodyMeasurements(todayIso())
          .filter((m) => !have.has(m.biomarkerId))
          .map(({ id: _id, ...m }) => m),
      );
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the example data.");
      setBusy(false);
    }
  }
  const missing = DEMO_BODY_IDS.filter((id) => !have.has(id));
  if (missing.length === 0) return null;
  const names = missing.map((id) => lowerFirst(BIOMARKER_MAP.get(id)?.name ?? id));
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warn/25 bg-warn-soft p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-ink">
        <span className="font-medium">{have.size === 0 ? "This example profile has no body measurements yet." : "This example profile is missing some of the example's body data."}</span>{" "}
        <span className="text-ink-2">Add made-up {names.length > 3 ? "weight, waist, blood pressure, heart rate and glucose" : names.join(", ")} readings to see how this page works.</span>
      </p>
      <Button variant="secondary" className="shrink-0" disabled={busy} onClick={() => void add()}>
        {busy ? "Adding…" : "Add example body data"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
