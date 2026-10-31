import { useMemo } from "react";
import { buildDashboard } from "../../core/dashboard";
import { todayIso } from "../../core/dates";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { CriticalBanner } from "../components/CriticalBanner";
import { Timeline } from "../components/dashboard/Timeline";
import {
  AskPanel,
  BioAgeFigure,
  HabitsPanel,
  InRangeFigure,
  MarkerGrid,
  NextFigure,
  ToWatchFigure,
  cardStyles,
} from "../components/dashboard/widgets";
import { ExampleProfileButton } from "../components/ExampleProfileButton";
import { PlusIcon } from "../components/icons";
import { SafetyNotices } from "../components/SafetyNotices";
import { cx, LinkButton } from "../components/ui";
import { formatDate } from "../format";
import { useAllMeasurements, useExperiments, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, bloodOnly } from "../knowledge";
import { useProfiles } from "../profiles";
import { href } from "../router";

/** The blood tests dashboard: biological age, what's in range, the timeline and saved-marker highlights. */
export function BloodDashboardPage() {
  const all = useAllMeasurements();
  const protocols = useProtocols();
  const experiments = useExperiments();
  const profile = useProfile();
  const today = todayIso();
  const blood = useMemo(() => (all ? bloodOnly(all) : undefined), [all]);
  const d = useMemo(
    () => (blood && protocols && experiments ? buildDashboard({ measurements: blood, protocols, experiments, profile, defs: BIOMARKER_MAP, today }) : undefined),
    [blood, protocols, experiments, profile, today],
  );

  if (!d || !protocols || !blood) return <p className="text-ink-2">Loading…</p>;
  if (d.markers.length === 0) return <EmptyBlood />;

  return (
    <div className="flex flex-col gap-6">
      <CriticalBanner items={d.critical.map((m) => ({ def: m.def, measurement: m.latest, low: m.flag === "critical-low" }))} />
      <div className="empty:hidden">
        <SafetyNotices notes={safetyNotes(safetyLabels(protocols, profile))} />
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl font-normal tracking-tight text-balance sm:text-5xl">Blood tests</h1>
          <p className="mt-1 text-ink-2">
            Latest blood test {formatDate(d.lastTest!)} · {d.draws.length} {d.draws.length === 1 ? "test" : "tests"} since {d.draws[0]!.date.slice(0, 4)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="secondary" href={href({ name: "overview" })}>
            All results
          </LinkButton>
          <LinkButton href={href({ name: "add" })} className="max-sm:hidden lg:hidden">
            <PlusIcon />
            Add results
          </LinkButton>
        </div>
      </header>

      <section aria-label="Key figures" className="stagger grid grid-cols-2 gap-3 lg:grid-cols-5">
        <BioAgeFigure d={d} profile={profile} today={today} />
        <InRangeFigure d={d} />
        <ToWatchFigure d={d} />
        <NextFigure d={d} />
      </section>

      <section className={cardStyles} aria-labelledby="timeline-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="timeline-title" className="font-serif text-2xl font-normal">
            Timeline
          </h2>
          <p className="text-sm text-ink-2">Drag to move through time. Point at or tap a blood test to see what was off.</p>
        </div>
        <Timeline d={d} protocols={protocols} birthMonth={profile.birthMonth} today={today} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <MarkerGrid markers={d.markers} title="Markers" more={{ href: href({ name: "overview" }), label: "Results list" }} />
        <aside className="flex flex-col gap-4">
          <HabitsPanel protocols={protocols} experiments={experiments ?? []} all={blood} today={today} />
          <AskPanel d={d} />
        </aside>
      </div>
    </div>
  );
}

// ---- No results yet ---------------------------------------------------------------------------

export function EmptyBlood() {
  const { mode } = useProfiles();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">Blood tests</h1>
        <p className="mt-1 text-ink-2">Add your first blood test and this fills in: biological age, what's in range, and a timeline over the years.</p>
        <LinkButton variant="secondary" href={href({ name: "overview" })} className="mt-4">All results</LinkButton>
      </header>
      <div className="stagger grid gap-3 sm:grid-cols-3">
        <a href={href({ name: "import" })} className={cx(cardStyles, "flex flex-col gap-1 text-ink no-underline hover:border-line-strong")}>
          <span className="font-medium">Import a lab report</span>
          <span className="text-sm text-ink-2">A PDF or a photo. Every value is checked before saving.</span>
        </a>
        <a href={href({ name: "add" })} className={cx(cardStyles, "flex flex-col gap-1 text-ink no-underline hover:border-line-strong")}>
          <span className="font-medium">Type in a result</span>
          <span className="text-sm text-ink-2">One value at a time from a paper report.</span>
        </a>
        <div className={cx(cardStyles, "flex flex-col gap-2")}>
          <span className="font-medium">Just looking?</span>
          <span className="text-sm text-ink-2">Open a profile with five years of made-up results.</span>
          {mode === "folders" ? <ExampleProfileButton mode="folders" label="Open an example" /> : <span className="text-sm text-ink-2">Needs the app's local server.</span>}
        </div>
      </div>
    </div>
  );
}
