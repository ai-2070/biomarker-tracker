import { useMemo } from "react";
import { buildDashboard, type Dashboard, type DashboardMarker } from "../../core/dashboard";
import { todayIso } from "../../core/dates";
import { ageAt } from "../../core/phenoageDraws";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { isCritical } from "../../core/trends";
import type { Profile, ProtocolEntry } from "../../core/types";
import { CriticalBanner } from "../components/CriticalBanner";
import { Timeline } from "../components/dashboard/Timeline";
import { Sparkline } from "../components/dashboard/Sparkline";
import { ExampleProfileButton } from "../components/ExampleProfileButton";
import { ArrowRightIcon, PlusIcon } from "../components/icons";
import { SafetyNotices } from "../components/SafetyNotices";
import { cx, FlagBadge, LinkButton } from "../components/ui";
import { CATEGORY_LABEL, displayUnitFor, formatDate, formatYears, showChange, showMeasurement } from "../format";
import { useAllMeasurements, useDisplayUnits, useExperiments, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, fullName, nameInSentence, shortName } from "../knowledge";
import { useProfiles } from "../profiles";
import { openBrain } from "../brain/store";
import { href } from "../router";

const cardStyles = "rounded-xl border border-line bg-surface p-4 sm:p-5";
const labelStyles = "font-mono text-[11px] font-medium tracking-[0.14em] text-ink-2 uppercase";

function firstName(p: Profile): string | undefined {
  const n = p.name?.replace(/\([^)]*\)/g, "").trim().split(/\s+/)[0];
  return n || undefined;
}

export function DashboardPage() {
  const all = useAllMeasurements();
  const protocols = useProtocols();
  const experiments = useExperiments();
  const profile = useProfile();
  const today = todayIso();
  const d = useMemo(
    () => (all && protocols && experiments ? buildDashboard({ measurements: all, protocols, experiments, profile, defs: BIOMARKER_MAP, today }) : undefined),
    [all, protocols, experiments, profile, today],
  );

  if (!d || !protocols) return <p className="text-ink-2">Loading…</p>;
  const name = firstName(profile);
  if (d.markers.length === 0) return <EmptyDashboard name={name} />;

  return (
    <div className="flex flex-col gap-6">
      <CriticalBanner items={d.critical.map((m) => ({ def: m.def, measurement: m.latest, low: m.flag === "critical-low" }))} />
      <div className="empty:hidden">
        <SafetyNotices notes={safetyNotes(safetyLabels(protocols, profile))} />
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl font-normal tracking-tight text-balance sm:text-5xl">{name ? `${name}'s health` : "Your health"}</h1>
          <p className="mt-1 text-ink-2">
            Latest blood test {formatDate(d.lastTest!)} · {d.draws.length} {d.draws.length === 1 ? "test" : "tests"} since {d.draws[0]!.date.slice(0, 4)}
          </p>
        </div>
        <LinkButton href={href({ name: "add" })} className="max-sm:hidden lg:hidden">
          <PlusIcon />
          Add results
        </LinkButton>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="markers-title">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="markers-title" className="font-serif text-2xl font-normal">
              Markers
            </h2>
            <a href={href({ name: "overview" })} className="flex items-center gap-1 text-sm font-medium text-accent no-underline hover:underline">
              All {d.markers.length} blood markers <ArrowRightIcon width={16} height={16} />
            </a>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:hidden">
            {d.markers.slice(0, 9).map((m) => (
              <li key={m.def.id}>
                <MarkerRow m={m} />
              </li>
            ))}
          </ul>
          <ul className="stagger hidden gap-3 sm:grid sm:grid-cols-2 xl:grid-cols-3">
            {d.markers.slice(0, 9).map((m) => (
              <li key={m.def.id}>
                <MarkerTile m={m} />
              </li>
            ))}
          </ul>
        </section>

        <aside className="flex flex-col gap-4">
          <NowTaking active={d.activeLog} />
          <ExperimentsPanel d={d} count={experiments?.filter((e) => !e.end).length ?? 0} />
          <AskPanel d={d} />
        </aside>
      </div>
    </div>
  );
}

// ---- Key figures ----------------------------------------------------------------------------

function Figure({ label, href: to, children, foot, className }: { label: string; href: string; children: React.ReactNode; foot?: React.ReactNode; className?: string }) {
  return (
    <a href={to} className={cx(cardStyles, className, "group flex min-h-40 flex-col gap-2 text-ink no-underline transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-sm")}>
      <span className={labelStyles}>{label}</span>
      <div>{children}</div>
      {foot && <div className="text-sm text-ink-2">{foot}</div>}
    </a>
  );
}

function BioAgeFigure({ d, profile, today }: { d: Dashboard; profile: Profile; today: string }) {
  const last = d.bioAge.at(-1);
  if (!last || !profile.birthMonth) {
    return (
      <Figure
        label="Biological age"
        href={href({ name: "phenoage" })}
        className="col-span-2"
        foot={!profile.birthMonth ? "Add your month and year of birth to see it." : "Needs all 9 markers from one blood test."}
      >
        <p className="font-serif text-4xl text-ink-2">Not yet</p>
      </Figure>
    );
  }
  const diff = last.difference;
  const age = ageAt(profile.birthMonth, today);
  const pts = d.bioAge.slice(-10);
  const vals = pts.flatMap((p) => [p.age, p.phenoAge]);
  const lo = Math.min(...vals) - 1;
  const hi = Math.max(...vals) + 1;
  const y = (v: number) => 34 - ((v - lo) / (hi - lo)) * 32;
  const x = (i: number) => (pts.length === 1 ? 50 : (i / (pts.length - 1)) * 100);
  return (
    <Figure label="Biological age" href={href({ name: "phenoage" })} className="col-span-2" foot={`From ${d.bioAge.length} blood ${d.bioAge.length === 1 ? "test" : "tests"} · PhenoAge, an estimate`}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <p className="flex items-baseline gap-2">
            <span className="font-serif text-6xl leading-none tabular-nums sm:text-7xl">{last.phenoAge.toFixed(1)}</span>
            <span className="text-ink-2">years</span>
          </p>
          <p className="mt-2 text-ink">
            {Math.abs(diff) < 0.5 ? (
              "About your age"
            ) : (
              <>
                <span className="font-medium">
                  {formatYears(Math.abs(diff))} {diff < 0 ? "younger" : "older"}
                </span>{" "}
                than your age ({formatYears(age)})
              </>
            )}
            {last.approximate && <span className="text-ink-2"> · approximate</span>}
          </p>
        </div>
        {pts.length > 1 && (
          <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="block h-14 min-w-32 flex-1" aria-hidden="true">
            <polygon points={[...pts.map((p, i) => `${x(i)},${y(p.phenoAge)}`), ...[...pts].reverse().map((p, i) => `${x(pts.length - 1 - i)},${y(p.age)}`)].join(" ")} className="fill-chart-band/10" />
            <polyline points={pts.map((p, i) => `${x(i)},${y(p.age)}`).join(" ")} fill="none" className="stroke-ink-2" strokeWidth={1.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <polyline points={pts.map((p, i) => `${x(i)},${y(p.phenoAge)}`).join(" ")} fill="none" className="stroke-chart-line" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
    </Figure>
  );
}

function InRangeFigure({ d }: { d: Dashboard }) {
  const judged = d.markers.filter((m) => m.flag !== "unknown");
  return (
    <Figure label="In range" href={href({ name: "overview" })} foot="Latest result of each marker">
      <p className="flex items-baseline gap-1.5">
        <span className="font-serif text-4xl leading-none tabular-nums sm:text-5xl">{d.inRange}</span>
        <span className="whitespace-nowrap text-ink-2">of {d.judged}</span>
      </p>
      {/* One mark per marker: amber or red where a result is out of range. */}
      <div className="mt-3 flex gap-[2px]" aria-hidden="true">
        {judged.map((m) => (
          <span
            key={m.def.id}
            title={m.def.name}
            className={cx("h-4 max-w-2 min-w-[3px] flex-1 rounded-full", isCritical(m.flag) ? "bg-danger" : m.flag === "normal" ? "bg-line-strong" : "bg-warn")}
          />
        ))}
      </div>
    </Figure>
  );
}

function ToWatchFigure({ d }: { d: Dashboard }) {
  const n = d.toWatch.length;
  return (
    <Figure
      label="To watch"
      href={href({ name: "overview", ...(n > 0 ? { show: "out" as const } : {}) })}
      foot={n === 0 ? "Everything in range" : d.toWatch.slice(0, 3).map((m) => `${shortName(m.def)} ${m.flag.includes("low") ? "low" : "high"}`).join(" · ")}
    >
      <p className="flex items-baseline gap-1.5">
        <span className={cx("font-serif text-4xl leading-none sm:text-5xl tabular-nums", d.critical.length ? "text-danger" : n ? "text-warn" : "")}>{n}</span>
        <span className="text-ink-2">{n === 1 ? "marker" : "markers"}</span>
      </p>
    </Figure>
  );
}

function NextFigure({ d }: { d: Dashboard }) {
  const r = d.nextRetest;
  if (r) {
    return (
      <Figure label="Next re-test" href={href({ name: "experiment", id: r.experimentId })} foot={`For "${r.change}"`} className="max-lg:col-span-2">
        <p className="flex items-baseline gap-1.5">
          {r.daysAway <= 0 ? (
            <span className="font-serif text-4xl leading-none sm:text-5xl text-warn">Due</span>
          ) : (
            <>
              <span className="font-serif text-4xl leading-none sm:text-5xl tabular-nums">{r.daysAway}</span>
              <span className="text-ink-2">{r.daysAway === 1 ? "day" : "days"}</span>
            </>
          )}
        </p>
      </Figure>
    );
  }
  const days = d.daysSinceLastTest ?? 0;
  const months = Math.floor(days / 30.4);
  return (
    <Figure label="Last blood test" href={href({ name: "overview" })} foot={formatDate(d.lastTest!)} className="max-lg:col-span-2">
      <p className="flex items-baseline gap-1.5">
        <span className="font-serif text-4xl leading-none sm:text-5xl tabular-nums">{months >= 2 ? months : days}</span>
        <span className="text-ink-2">{months >= 2 ? "months ago" : days === 1 ? "day ago" : "days ago"}</span>
      </p>
    </Figure>
  );
}

// ---- Markers ----------------------------------------------------------------------------------

function MarkerTile({ m }: { m: DashboardMarker }) {
  const units = useDisplayUnits();
  const unit = displayUnitFor(m.def, units[m.def.id]);
  const tone = isCritical(m.flag) ? "danger" : m.flag === "normal" || m.flag === "unknown" ? "ok" : "warn";
  const prev = m.series.at(-2);
  return (
    <a
      href={href({ name: "marker", id: m.def.id })}
      className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-ink no-underline transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 leading-snug font-medium" title={fullName(m.def)}>
          {shortName(m.def)}
        </span>
        {m.flag !== "normal" && m.flag !== "unknown" && <FlagBadge flag={m.flag} className="shrink-0" />}
      </div>
      <p className="flex items-baseline gap-1">
        <span className="font-serif text-3xl leading-none tabular-nums">{showMeasurement(m.def, m.latest, unit)}</span>
        <span className="text-sm text-ink-2">{unit}</span>
      </p>
      <Sparkline series={m.series} {...(m.range ? { range: m.range } : {})} tone={tone} />
      <p className="text-xs text-ink-2">
        {m.change !== undefined && prev ? `${showChange(m.def, m.change, unit)} since ${formatDate(prev.date)}` : `One result, ${formatDate(m.latest.date)}`}
      </p>
    </a>
  );
}

/** Phones: one line per marker, flagged ones first. */
function MarkerRow({ m }: { m: DashboardMarker }) {
  const units = useDisplayUnits();
  const unit = displayUnitFor(m.def, units[m.def.id]);
  return (
    <a href={href({ name: "marker", id: m.def.id })} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 text-ink no-underline hover:bg-sunken">
      <span className="min-w-0 font-medium">{shortName(m.def)}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="tabular-nums">
          {showMeasurement(m.def, m.latest, unit)} <span className="text-sm text-ink-2">{unit}</span>
        </span>
        {m.flag !== "normal" && m.flag !== "unknown" && <FlagBadge flag={m.flag} />}
      </span>
    </a>
  );
}

// ---- Side panels ------------------------------------------------------------------------------

function Panel({ title, link, children }: { title: string; link: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className={cardStyles}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-normal">{title}</h2>
        <a href={link.href} className="text-sm font-medium text-accent no-underline hover:underline">
          {link.label}
        </a>
      </div>
      {children}
    </section>
  );
}

function NowTaking({ active }: { active: ProtocolEntry[] }) {
  return (
    <Panel title="Now taking" link={{ href: href({ name: "log" }), label: "Log" }}>
      {active.length === 0 ? (
        <p className="text-sm text-ink-2">Nothing logged right now. Supplements, diet changes, medicines and habits show up on the timeline.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {active.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="text-xs text-ink-2">{CATEGORY_LABEL[p.category]}</span>
              </span>
              <span className="shrink-0 text-xs text-ink-2">since {formatDate(p.start)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ExperimentsPanel({ d, count }: { d: Dashboard; count: number }) {
  return (
    <Panel title="Experiments" link={{ href: href({ name: "experiments" }), label: "All" }}>
      {count === 0 ? (
        <p className="text-sm text-ink-2">
          Test one change on yourself and see whether a marker moved more than normal test-to-test variation.{" "}
          <a href={href({ name: "experiment-new" })} className="font-medium text-accent">
            Start one
          </a>
        </p>
      ) : (
        <p className="text-sm">
          {count} running.{" "}
          {d.nextRetest && <span className="text-ink-2">{d.nextRetest.daysAway <= 0 ? `Re-test due for "${d.nextRetest.change}".` : `Next re-test ${formatDate(d.nextRetest.date)}.`}</span>}
        </p>
      )}
    </Panel>
  );
}

function AskPanel({ d }: { d: Dashboard }) {
  const q = d.toWatch[0] ? `What can affect my ${nameInSentence(d.toWatch[0].def)}, and what does research say?` : "How have my results changed over the years?";
  return (
    <section className={cx(cardStyles, "bg-accent-soft/60")}>
      <h2 className="font-serif text-xl font-normal">Ask Brain</h2>
      <p className="mt-1 text-sm text-ink-2">Brain reads your results and log, searches research, and cites what it finds. Press Space on any page.</p>
      <button
        type="button"
        onClick={() => openBrain({ draft: q })}
        className="mt-3 flex min-h-11 w-full items-center rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-left text-sm text-ink transition-colors duration-150 hover:bg-sunken"
      >
        “{q}”
      </button>
    </section>
  );
}

// ---- No results yet ---------------------------------------------------------------------------

function EmptyDashboard({ name }: { name?: string }) {
  const { mode } = useProfiles();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-4xl font-normal tracking-tight sm:text-5xl">{name ? `${name}'s health` : "Your health"}</h1>
        <p className="mt-1 text-ink-2">Add your first blood test and the dashboard fills in: biological age, what's in range, and a timeline over the years.</p>
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
