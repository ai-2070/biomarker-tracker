import { useMemo, useState } from "react";
import { buildDashboard } from "../../core/dashboard";
import { demoBodyMeasurements } from "../../core/demo";
import { addMeasurements } from "../../db/db";
import { todayIso } from "../../core/dates";
import { BloodPressureFigure, BmiFigure, BodyEntryForm, RestingHrFigure, WaistFigure, WeightFigure, inBodyOrder } from "../components/dashboard/body";
import { HabitsPanel, MarkerGrid, cardStyles } from "../components/dashboard/widgets";
import { CriticalBanner } from "../components/CriticalBanner";
import { PlusIcon } from "../components/icons";
import { Button, Card, Notice } from "../components/ui";
import { formatDate } from "../format";
import { useAllMeasurements, useExperiments, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, bodyOnly } from "../knowledge";
import { href } from "../router";

/** The body dashboard: weight, BMI, waist, blood pressure and resting heart rate over time. */
export function BodyPage({ add }: { add?: boolean }) {
  const all = useAllMeasurements();
  const protocols = useProtocols();
  const experiments = useExperiments();
  const profile = useProfile();
  const today = todayIso();
  const [adding, setAdding] = useState(!!add);
  const [saved, setSaved] = useState(0);
  const body = useMemo(() => (all ? bodyOnly(all) : undefined), [all]);
  const d = useMemo(
    () => (body && protocols && experiments ? buildDashboard({ measurements: body, protocols, experiments, profile, defs: BIOMARKER_MAP, today }) : undefined),
    [body, protocols, experiments, profile, today],
  );
  if (!d || !body || !protocols) return <p className="text-ink-2">Loading…</p>;
  const empty = d.markers.length === 0;

  const form = (
    <Card className="animate-enter">
      <h2 className="mb-4 font-serif text-2xl font-normal">Add measurements</h2>
      <BodyEntryForm
        onDone={(n) => {
          setAdding(false);
          setSaved(n);
        }}
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
        {!adding && !empty && (
          <Button onClick={() => (setAdding(true), setSaved(0))}>
            <PlusIcon />
            Add measurements
          </Button>
        )}
      </header>

      {saved > 0 && (
        <Notice role="status" title={`Saved ${saved} ${saved === 1 ? "measurement" : "measurements"}`}>
          They're on your charts below.
        </Notice>
      )}
      {empty && profile.example && <ExampleBodyData />}
      {(adding || empty) && form}

      {!empty && (
        <>
          <section aria-label="Key figures" className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
            <WeightFigure ms={body} />
            <BmiFigure ms={body} profile={profile} />
            <WaistFigure ms={body} profile={profile} />
            <BloodPressureFigure ms={body} profile={profile} />
            <RestingHrFigure ms={body} className="max-lg:col-span-2" />
          </section>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <MarkerGrid markers={inBodyOrder(d.markers)} title="Measurements" limit={12} />
            <aside className="flex flex-col gap-4">
              <section className={cardStyles}>
                <h2 className="font-serif text-xl font-normal">About these numbers</h2>
                <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
                  <li>BMI and waist size are rough guides to health risk, not verdicts. BMI can't tell muscle from fat.</li>
                  <li>Home blood pressure runs lower than in a clinic. One high reading isn't a diagnosis; repeated ones are worth discussing with a doctor.</li>
                  <li>Day-to-day swings are normal. Measure the same way and at the same time of day, and follow the trend.</li>
                </ul>
                <p className="mt-3 text-sm text-ink-2">
                  Coming later: sync from your phone (
                  <a href={href({ name: "soon", section: "devices" })} className="text-accent">
                    Devices
                  </a>
                  ).
                </p>
              </section>
              <HabitsPanel protocols={protocols} experiments={experiments ?? []} all={all ?? []} today={today} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/** Example profiles made before body measurements existed can get the example's body data. Never offered on a real profile. */
function ExampleBodyData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addMeasurements(demoBodyMeasurements(todayIso()).map(({ id: _id, ...m }) => m));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the example data.");
      setBusy(false);
    }
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warn/25 bg-warn-soft p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-ink">
        <span className="font-medium">This example profile has no body measurements yet.</span>{" "}
        <span className="text-ink-2">Add two years of made-up weight, waist, blood pressure and heart rate to see how this page works.</span>
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
