import type { Dashboard, DashboardMarker } from "@bt/shared/core/dashboard";
import type { ExperimentPhase } from "@bt/shared/core/experiments";
import { habitsOf, summarizeWatch } from "@bt/shared/core/habits";
import { isCritical } from "@bt/shared/core/trends";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "@bt/shared/core/types";
import { openBrain } from "../../brain/store";
import { CATEGORY_LABEL, displayUnitFor, formatChange, formatDate, formatYears, showChange, showMeasurement, valueUnit } from "../../format";
import { useDisplayUnits, useWatchMeasurements } from "../../hooks";
import { BIOMARKER_MAP, WATCH_DEFS, fullName, nameInSentence, shortName, watchDef } from "../../knowledge";
import { href } from "../../router";
import { ArrowRightIcon } from "../icons";
import { cx, FlagBadge } from "../ui";
import { Sparkline } from "./Sparkline";

// Building blocks shared by the dashboards (main, blood tests, body).

export const cardStyles = "rounded-xl border border-line bg-surface p-4 sm:p-5";
export const labelStyles = "font-mono text-[11px] font-medium tracking-[0.14em] text-ink-2 uppercase";

export function firstName(p: Profile): string | undefined {
  const n = p.name?.replace(/\([^)]*\)/g, "").trim().split(/\s+/)[0];
  return n || undefined;
}

// ---- Key figures ----------------------------------------------------------------------------

export function Figure({ label, href: to, children, foot, className }: { label: string; href?: string; children: React.ReactNode; foot?: React.ReactNode; className?: string }) {
  const styles = cx(cardStyles, className, "flex min-h-40 flex-col justify-center gap-2 text-ink", to && "group no-underline transition-[border-color,box-shadow] duration-200 hover:border-accent/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent");
  const content = <>
    <span className={labelStyles}>{label}</span>
    <div>{children}</div>
    {foot && <div className="text-sm text-ink-2">{foot}</div>}
  </>;
  return to ? <a href={to} className={styles}>{content}</a> : <section aria-label={label} className={styles}>{content}</section>;
}

export function BioAgeFigure({ d, profile }: { d: Dashboard; profile: Profile; today: string }) {
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
  const age = last.age;
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
            <span className="text-ink-2"> · at the test on {formatDate(last.date)}</span>
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

export function InRangeFigure({ d }: { d: Dashboard }) {
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

export function ToWatchFigure({ d, to, className }: { d: Dashboard; to?: string; className?: string }) {
  const n = d.toWatch.length;
  return (
    <Figure
      label="To watch"
      className={className}
      href={to ?? href({ name: "overview", ...(n > 0 ? { show: "out" as const } : {}) })}
      foot={n === 0 ? "Everything in range" : d.toWatch.slice(0, 3).map((m) => `${shortName(m.def)} ${m.flag.includes("low") ? "low" : "high"}`).join(" · ")}
    >
      <p className="flex items-baseline gap-1.5">
        <span className={cx("font-serif text-4xl leading-none sm:text-5xl tabular-nums", d.critical.length ? "text-danger" : n ? "text-warn" : "")}>{n}</span>
        <span className="text-ink-2">{n === 1 ? "marker" : "markers"}</span>
      </p>
    </Figure>
  );
}

export function NextFigure({ d }: { d: Dashboard }) {
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

export function MarkerTile({ m }: { m: DashboardMarker }) {
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
        <span className="text-sm text-ink-2">{valueUnit(m.def, unit)}</span>
      </p>
      <Sparkline series={m.series} {...(m.range ? { range: m.range } : {})} tone={tone} />
      <p className="text-xs text-ink-2">
        {m.change !== undefined && prev ? `${showChange(m.def, m.change, unit)} since ${formatDate(prev.date)}` : `One result, ${formatDate(m.latest.date)}`}
      </p>
    </a>
  );
}

/** Phones: one line per marker, flagged ones first. */
export function MarkerRow({ m }: { m: DashboardMarker }) {
  const units = useDisplayUnits();
  const unit = displayUnitFor(m.def, units[m.def.id]);
  return (
    <a href={href({ name: "marker", id: m.def.id })} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 text-ink no-underline hover:bg-sunken">
      <span className="min-w-0 font-medium">{shortName(m.def)}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="tabular-nums">
          {showMeasurement(m.def, m.latest, unit)} <span className="text-sm text-ink-2">{valueUnit(m.def, unit)}</span>
        </span>
        {m.flag !== "normal" && m.flag !== "unknown" && <FlagBadge flag={m.flag} />}
      </span>
    </a>
  );
}

/** Saved-marker tiles (rows on phones), limited to the dashboard's highlights. */
export function MarkerGrid({
  markers,
  title,
  more,
  limit = 9,
  hideTitle = false,
}: {
  markers: DashboardMarker[];
  title: string;
  more?: { href: string; label: string };
  limit?: number;
  /** The section around it already has a heading. */
  hideTitle?: boolean;
}) {
  const shown = markers.slice(0, limit);
  return (
    <section aria-label={title} className="min-w-0">
      <div className={cx("mb-3 flex flex-wrap items-baseline justify-between gap-3", hideTitle && "sr-only")}>
        <h2 className="font-serif text-2xl font-normal">{title}</h2>
        {more && (
          <a href={more.href} className="flex items-center gap-1 text-sm font-medium text-accent no-underline hover:underline">
            {more.label} <ArrowRightIcon width={16} height={16} />
          </a>
        )}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface sm:hidden">
        {shown.map((m) => <li key={m.def.id}><MarkerRow m={m} /></li>)}
      </ul>
      <ul className="stagger hidden gap-3 sm:grid sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((m) => <li key={m.def.id}><MarkerTile m={m} /></li>)}
      </ul>
    </section>
  );
}

// ---- Side panels ------------------------------------------------------------------------------

export function Panel({ title, link, children }: { title: string; link: { href: string; label: string }; children: React.ReactNode }) {
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

const SHORT_PHASE: Record<ExperimentPhase, string> = {
  "needs-baseline": "Needs a 'before' test",
  running: "Watching",
  due: "Re-test due",
  complete: "Results ready",
  ended: "Ended",
};

/** Ongoing habits, and past ones whose watched markers have a result. Each says what changed, if it watches markers. */
export function HabitsPanel({ protocols, experiments, all: results, today }: { protocols: ProtocolEntry[]; experiments: Experiment[]; all: Measurement[]; today: string }) {
  const all = useWatchMeasurements(results) ?? results;
  const habits = habitsOf(protocols, experiments);
  const rows = habits
    .map((h) => ({ h, s: h.watch ? summarizeWatch(h.watch, WATCH_DEFS, all, today) : undefined }))
    .filter(({ h, s }) => (h.start <= today && !h.end) || s?.headline)
    .slice(0, 6);
  return (
    <Panel title="Habits" link={{ href: href({ name: "habits" }), label: "All" }}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">
          Nothing right now. Add supplements, food changes, medicines or routines, and pick markers to see what changed in you.{" "}
          <a href={href({ name: "habits", add: "" })} className="font-medium text-accent">
            Add a habit
          </a>
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map(({ h, s }) => {
            const r = s?.headline;
            const def = r ? watchDef(r.biomarkerId) : undefined;
            const beyond = r?.verdict === "rise" || r?.verdict === "fall";
            return (
              <li key={h.id} className="py-2 first:pt-0 last:pb-0">
                <a href={h.watch ? href({ name: "experiment", id: h.watch.id }) : href({ name: "habits" })} className="group block text-ink no-underline">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium group-hover:underline">{h.label}</span>
                    <span className="shrink-0 text-xs text-ink-2">{h.end ? "ended" : `since ${formatDate(h.start)}`}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-2">
                    {r && def && r.change !== undefined ? (
                      <>
                        <span className={cx("font-medium", beyond ? "text-ok" : "text-ink-2")}>
                          {shortName(def)} {formatChange(r.change, def)}
                        </span>
                        {beyond ? ", beyond normal variation" : ", within normal variation"}
                      </>
                    ) : s ? (
                      <span className={s.phase === "due" || s.phase === "needs-baseline" ? "text-warn" : ""}>
                        {SHORT_PHASE[s.phase]}: {s.results.map((x) => shortName(BIOMARKER_MAP.get(x.biomarkerId)!)).join(", ")}
                      </span>
                    ) : (
                      h.entry?.plan ? "Protocol" : CATEGORY_LABEL[h.category]
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function AskPanel({ d }: { d: Dashboard }) {
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

