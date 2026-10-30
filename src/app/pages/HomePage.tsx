import { useMemo } from "react";
import { buildDashboard, type Dashboard } from "../../core/dashboard";
import { todayIso } from "../../core/dates";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { isCritical } from "../../core/trends";
import type { Profile } from "../../core/types";
import { CriticalBanner } from "../components/CriticalBanner";
import { BloodPressureFigure, BodySummaryList, SummaryValue, WeightFigure, summaryRow } from "../components/dashboard/body";
import { Sparkline } from "../components/dashboard/Sparkline";
import { Timeline } from "../components/dashboard/Timeline";
import { AskPanel, BioAgeFigure, HabitsPanel, ToWatchFigure, cardStyles, labelStyles } from "../components/dashboard/widgets";
import { ExampleProfileButton } from "../components/ExampleProfileButton";
import { ArrowRightIcon } from "../components/icons";
import { SafetyNotices } from "../components/SafetyNotices";
import { cx } from "../components/ui";
import { displayUnitFor, formatDate, showMeasurement } from "../format";
import { useAllMeasurements, useDisplayUnits, useExperiments, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, bloodOnly, bodyOnly, shortName } from "../knowledge";
import { useProfiles } from "../profiles";
import { href } from "../router";

function firstName(p: Profile): string | undefined {
  const n = p.name?.replace(/\([^)]*\)/g, "").trim().split(/\s+/)[0];
  return n || undefined;
}

/** The main dashboard: blood tests and body together, with habits and Brain. */
export function HomePage() {
  const all = useAllMeasurements();
  const protocols = useProtocols();
  const experiments = useExperiments();
  const profile = useProfile();
  const today = todayIso();
  const dashboards = useMemo(() => {
    if (!all || !protocols || !experiments) return undefined;
    const build = (measurements: typeof all) => buildDashboard({ measurements, protocols, experiments, profile, defs: BIOMARKER_MAP, today });
    return { blood: build(bloodOnly(all)), body: build(bodyOnly(all)), both: build(all) };
  }, [all, protocols, experiments, profile, today]);

  if (!dashboards || !all || !protocols) return <p className="text-ink-2">Loading…</p>;
  const { blood, body, both } = dashboards;
  const name = firstName(profile);
  if (both.markers.length === 0) return <Welcome name={name} />;
  const bodyMs = bodyOnly(all);

  return (
    <div className="flex flex-col gap-6">
      <CriticalBanner items={both.critical.map((m) => ({ def: m.def, measurement: m.latest, low: m.flag === "critical-low" }))} />
      <div className="empty:hidden">
        <SafetyNotices notes={safetyNotes(safetyLabels(protocols, profile))} />
      </div>

      <header>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-balance sm:text-5xl">{name ? `${name}'s health` : "Your health"}</h1>
        <p className="mt-1 text-ink-2">
          {[blood.lastTest && `Latest blood test ${formatDate(blood.lastTest)}`, body.lastTest && `body measured ${formatDate(body.lastTest)}`].filter(Boolean).join(" · ")}
        </p>
      </header>

      <section aria-label="Key figures" className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        <BioAgeFigure d={blood} profile={profile} today={today} />
        <ToWatchFigure
          d={both}
          className="max-lg:col-span-2"
          to={blood.toWatch.length > 0 || body.toWatch.length === 0 ? href({ name: "overview", ...(blood.toWatch.length ? { show: "out" as const } : {}) }) : href({ name: "body" })}
        />
        <BloodPressureFigure ms={bodyMs} profile={profile} />
        <WeightFigure ms={bodyMs} />
      </section>

      {both.draws.length > 0 && (
        <section className={cardStyles} aria-labelledby="timeline-title">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="timeline-title" className="font-serif text-2xl font-normal">
              Timeline
            </h2>
            <p className="text-sm text-ink-2">Blood tests, body measurements and habits. Drag to move through time; point at or tap a blood test to see what was off.</p>
          </div>
          <Timeline d={{ ...blood, span: both.span }} protocols={protocols} birthMonth={profile.birthMonth} today={today} body={body.draws} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
        <BloodSummary d={blood} />
        <BodySummary d={body} />
        <aside className="flex flex-col gap-4 lg:col-span-2 lg:grid lg:grid-cols-2 xl:col-span-1 xl:flex">
          <HabitsPanel protocols={protocols} experiments={experiments ?? []} all={all} today={today} />
          <AskPanel d={both} />
        </aside>
      </div>
    </div>
  );
}

function SummaryCard({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <section className={cx(cardStyles, "flex flex-col gap-3")}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl font-normal">{title}</h2>
        <a href={to} className="flex items-center gap-1 text-sm font-medium text-accent no-underline hover:underline">
          Open <ArrowRightIcon width={16} height={16} />
        </a>
      </div>
      {children}
    </section>
  );
}

function BloodSummary({ d }: { d: Dashboard }) {
  if (d.markers.length === 0) {
    return (
      <SummaryCard title="Blood tests" to={href({ name: "blood" })}>
        <p className="text-sm text-ink-2">
          No blood tests yet.{" "}
          <a href={href({ name: "import" })} className="font-medium text-accent">
            Import a lab report
          </a>{" "}
          or{" "}
          <a href={href({ name: "add" })} className="font-medium text-accent">
            type in a result
          </a>
          .
        </p>
      </SummaryCard>
    );
  }
  const judged = d.markers.filter((m) => m.flag !== "unknown");
  return (
    <SummaryCard title="Blood tests" to={href({ name: "blood" })}>
      <div>
        <p className={labelStyles}>In range</p>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className="font-serif text-4xl leading-none tabular-nums">{d.inRange}</span>
          <span className="text-ink-2">of {d.judged} markers</span>
        </p>
        <div className="mt-3 flex gap-[2px]" aria-hidden="true">
          {judged.map((m) => (
            <span key={m.def.id} title={m.def.name} className={cx("h-3 max-w-2 min-w-[3px] flex-1 rounded-full", isCritical(m.flag) ? "bg-danger" : m.flag === "normal" ? "bg-line-strong" : "bg-warn")} />
          ))}
        </div>
      </div>
      {d.toWatch.length === 0 && <p className="text-sm text-ink-2">Every marker's latest result is in range.</p>}
      <BloodSummaryList d={d} />
      <p className="mt-auto text-sm text-ink-2">
        Latest test {formatDate(d.lastTest!)} ·{" "}
        <a href={href({ name: "overview" })} className="text-accent">
          all results
        </a>
      </p>
    </SummaryCard>
  );
}

/** Markers to watch first, then the most recently tested ones, as many rows as the Body card. */
function BloodSummaryList({ d }: { d: Dashboard }) {
  const units = useDisplayUnits();
  const watch = new Set(d.toWatch.map((m) => m.def.id));
  const rows = [
    ...d.toWatch,
    ...d.markers.filter((m) => !watch.has(m.def.id)).sort((a, b) => b.latest.date.localeCompare(a.latest.date) || a.def.name.localeCompare(b.def.name)),
  ].slice(0, 7);
  return (
    <ul className="flex flex-col divide-y divide-line border-t border-line">
      {rows.map((m) => {
        const unit = displayUnitFor(m.def, units[m.def.id]);
        const tone = isCritical(m.flag) ? "danger" : m.flag === "normal" || m.flag === "unknown" ? "ok" : "warn";
        return (
          <li key={m.def.id}>
            <a href={href({ name: "marker", id: m.def.id })} className={summaryRow}>
              <span className="truncate text-sm font-medium">{shortName(m.def)}</span>
              <Sparkline series={m.series.slice(-12)} {...(m.range ? { range: m.range } : {})} tone={tone} />
              <SummaryValue text={showMeasurement(m.def, m.latest, unit)} flag={m.flag} />
              <span className="truncate text-sm text-ink-2">{unit}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function BodySummary({ d }: { d: Dashboard }) {
  return (
    <SummaryCard title="Body" to={href({ name: "body" })}>
      {d.markers.length === 0 ? (
        <p className="text-sm text-ink-2">
          Nothing measured yet. Weight, waist, blood pressure and resting heart rate, from home or the doctor's.{" "}
          <a href={href({ name: "add", kind: "body" })} className="font-medium text-accent">
            Add measurements
          </a>
        </p>
      ) : (
        <>
          <BodySummaryList markers={d.markers} />
          <p className="mt-auto text-sm text-ink-2">
            Last measured {formatDate(d.lastTest!)} ·{" "}
            <a href={href({ name: "add", kind: "body" })} className="text-accent">
              add measurements
            </a>
          </p>
        </>
      )}
    </SummaryCard>
  );
}

function Welcome({ name }: { name?: string }) {
  const { mode } = useProfiles();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">{name ? `${name}'s health` : "Your health"}</h1>
        <p className="mt-1 text-ink-2">Add a blood test or a body measurement and this fills in: biological age, what's in range, blood pressure, and a timeline over the years.</p>
      </header>
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a href={href({ name: "import" })} className={cx(cardStyles, "flex flex-col gap-1 text-ink no-underline hover:border-line-strong")}>
          <span className="font-medium">Import a lab report</span>
          <span className="text-sm text-ink-2">A PDF or a photo. Every value is checked before saving.</span>
        </a>
        <a href={href({ name: "add" })} className={cx(cardStyles, "flex flex-col gap-1 text-ink no-underline hover:border-line-strong")}>
          <span className="font-medium">Type in a blood result</span>
          <span className="text-sm text-ink-2">One value at a time from a paper report.</span>
        </a>
        <a href={href({ name: "add", kind: "body" })} className={cx(cardStyles, "flex flex-col gap-1 text-ink no-underline hover:border-line-strong")}>
          <span className="font-medium">Add body measurements</span>
          <span className="text-sm text-ink-2">Weight, waist, blood pressure, resting heart rate.</span>
        </a>
        <div className={cx(cardStyles, "flex flex-col gap-2")}>
          <span className="font-medium">Just looking?</span>
          <span className="text-sm text-ink-2">Open a profile with years of made-up results.</span>
          {mode === "folders" ? <ExampleProfileButton mode="folders" label="Open an example" /> : <span className="text-sm text-ink-2">Needs the app's local server.</span>}
        </div>
      </div>
    </div>
  );
}
