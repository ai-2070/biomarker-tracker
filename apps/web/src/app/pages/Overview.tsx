import { useState } from "react";
import { summarizePhenoAge } from "@bt/shared/core/phenoageDraws";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { computeTrend, flagLatest, groupByBiomarker, isCritical, isOutOfRange, type Flag } from "@bt/shared/core/trends";
import type { BiomarkerDef, Measurement, Profile } from "@bt/shared/core/types";
import { CriticalBanner, type CriticalItem } from "../components/CriticalBanner";
import { Button, FlagBadge, LinkButton, PageTitle, cx, inputStyles, labelStyles } from "../components/ui";
import { displayUnitFor, formatDate, formatYears, showChange, showMeasurement, valueUnit } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { SafetyNotices } from "../components/SafetyNotices";
import { DueExperiments } from "../components/DueExperiments";
import { safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import { BLOOD_MARKERS, CATEGORY_ORDER, bloodOnly, fullName } from "../knowledge";
import { href, type ResultsFilter } from "../router";
import { SavedResults } from "../components/SavedResults";
import { SimpleSelect } from "../components/UnitSelect";

const NO_RESULTS: readonly Measurement[] = [];
const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  ...CATEGORY_ORDER.filter((category) => BLOOD_MARKERS.some((def) => def.category === category))
    .map((category) => ({ value: category, label: category === "Aging" ? "Aging (DunedinPACE)" : category === "Urine" ? "Urine tests" : category })),
];

function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function Overview({ show }: { show?: ResultsFilter }) {
  const everything = useAllMeasurements();
  // Body measurements have their own page.
  const all = everything && bloodOnly(everything);
  const profile = useProfile();
  const units = useDisplayUnits();
  const protocols = useProtocols() ?? [];
  const [managing, setManaging] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  if (all === undefined) return <p className="text-ink-2">Loading…</p>;

  const grouped = groupByBiomarker(all);
  const rows: { def: BiomarkerDef; ms: readonly Measurement[]; flag: Flag }[] = [];
  let withResults = 0;
  for (const def of BLOOD_MARKERS) {
    const ms = grouped.get(def.id);
    if (ms?.length) withResults++;
    rows.push({ def, ms: ms ?? NO_RESULTS, flag: ms?.length ? flagLatest(def, ms, profile) : "unknown" });
  }

  const critical: CriticalItem[] = [];
  for (const row of rows) {
    if (isCritical(row.flag)) critical.push({ def: row.def, measurement: computeTrend(row.ms)!.latest, low: row.flag === "critical-low" });
  }

  const search = normalizeSearch(query.trim());
  const matching = rows.filter(({ def }) => (
    (category === "all" || def.category === category)
    && (!search || [def.name, def.abbreviation ?? "", ...def.aliases].some((name) => normalizeSearch(name).includes(search)))
  ));
  // Missing readings have their own filter; unassessed readings stay under All.
  let outCount = 0;
  let inCount = 0;
  let emptyCount = 0;
  for (const row of matching) {
    if (isOutOfRange(row.flag)) outCount++;
    if (row.flag === "normal") inCount++;
    if (row.ms.length === 0) emptyCount++;
  }
  const shown = matching.filter((r) => (
    show === "empty" ? r.ms.length === 0
      : show === "out" ? isOutOfRange(r.flag)
        : show === "in" ? r.flag === "normal" : true
  ));
  const byCategory = new Map<string, typeof rows>();
  for (const row of shown) {
    const list = byCategory.get(row.def.category) ?? [];
    list.push(row);
    byCategory.set(row.def.category, list);
  }

  if (managing) return (
    <>
      <CriticalBanner items={critical} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <PageTitle sub="Correct a saved reading, or select results to delete.">Manage blood results</PageTitle>
        <Button variant="secondary" onClick={() => setManaging(false)}>Back to blood tests</Button>
      </div>
      <SavedResults measurements={all} />
    </>
  );

  const lastDate = all.reduce((d, m) => (m.date > d ? m.date : d), "");

  return (
    <>
      <CriticalBanner items={critical} />
      <div className="mb-5 empty:hidden">
        <SafetyNotices notes={safetyNotes(safetyLabels(protocols, profile))} />
      </div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">Blood tests</h1>
          <p className="mt-1 text-ink-2">
            {rows.length} markers · {withResults} with results · {all.length} {all.length === 1 ? "result" : "results"}.
            {lastDate && <> Latest sample: {formatDate(lastDate)}.</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {all.length > 0 && <Button variant="secondary" onClick={() => setManaging(true)}>Manage results</Button>}
          <LinkButton href={href({ name: "add" })}>Add result</LinkButton>
        </div>
      </div>
      {all.length === 0 && <div className="mb-5 flex flex-col gap-3">
        <p className="text-ink-2">No blood test results saved yet. You can browse every marker under All, or add your first results.</p>
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="secondary" href={href({ name: "import" })}>Import a PDF or photo</LinkButton>
          <LinkButton variant="secondary" href={href({ name: "data" })}>Restore a backup</LinkButton>
        </div>
      </div>}

      <DueExperiments all={all} />
      <BioAgeTeaser all={all} profile={profile} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={labelStyles}>Search markers</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); }
            }}
            placeholder="Name, abbreviation or lab name"
            autoComplete="off"
            className={inputStyles}
          />
        </label>
        <SimpleSelect label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} className="min-w-0" />
      </div>
      <ResultsFilterBar
        show={show}
        counts={{ all: matching.length, out: outCount, in: inCount, empty: emptyCount }}
        onClear={query || category !== "all" || show ? () => {
          setQuery("");
          setCategory("all");
          if (show) location.replace(href({ name: "overview" }));
        } : undefined}
      />

      {shown.length === 0 && (
        <p className="animate-fade rounded-xl border border-dashed border-line-strong bg-surface p-5 text-ink-2">
          {matching.length === 0
            ? "No markers match your search and category. Try another term or clear the filters."
            : show === "empty"
              ? "Every matching marker has a saved result."
              : show === "out"
                ? "No out-of-range results to show. Choose All to see markers without readings or an assessment."
                : "No in-range results to show. Markers without readings or a reference range are listed under All."}
        </p>
      )}

      <div key={show ?? "all"} className="flex flex-col gap-6">
        {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => {
          const categoryId = `blood-category-${CATEGORY_ORDER.indexOf(category)}`;
          return <section key={category} aria-labelledby={categoryId}>
            <h2 id={categoryId} className="mb-2 font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">
              {category}
            </h2>
            <ul className="stagger grid grid-cols-1 gap-2 sm:grid-cols-2">
              {byCategory
                .get(category)!
                .sort((a, b) => a.def.name.localeCompare(b.def.name))
                .map(({ def, ms, flag }) => (
                  <li key={def.id}>
                    <MarkerRow def={def} ms={ms} flag={flag} unit={displayUnitFor(def, units[def.id])} />
                  </li>
                ))}
            </ul>
          </section>;
        })}
      </div>
    </>
  );

}

const FILTERS: { value: "all" | ResultsFilter; label: string; count: "all" | ResultsFilter }[] = [
  { value: "all", label: "All", count: "all" },
  { value: "out", label: "Out of range", count: "out" },
  { value: "in", label: "In range", count: "in" },
  { value: "empty", label: "No results", count: "empty" },
];

/** Range and missing-result filters live in the page address, so they can be linked to. */
function ResultsFilterBar({ show, counts, onClear }: { show?: ResultsFilter; counts: Record<"all" | ResultsFilter, number>; onClear?: () => void }) {
  const value = show ?? "all";
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <ToggleGroup
        aria-label="Show markers"
        value={[value]}
        onValueChange={(v) => {
          const next = v[0] as "all" | ResultsFilter | undefined;
          if (!next || next === value) return; // pressing the chosen one again keeps it
          // Replace, so changing the filter doesn't fill the back button's history.
          location.replace(href(next === "all" ? { name: "overview" } : { name: "overview", show: next }));
        }}
        className="grid w-full grid-cols-2 gap-1 rounded-xl border border-line bg-sunken p-1 sm:inline-flex sm:w-auto"
      >
        {FILTERS.map((f) => (
          <Toggle
            key={f.value}
            value={f.value}
            className={cx(
              "flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1.5 text-sm sm:min-h-10 sm:gap-2 sm:px-3 font-medium whitespace-nowrap text-ink-2 transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-soft)]",
              "hover:text-ink data-pressed:bg-surface data-pressed:text-ink data-pressed:shadow-sm",
            )}
          >
            {f.label}
            <span
              className={cx(
                "min-w-5 rounded-full px-1 py-0.5 text-center sm:min-w-6 sm:px-1.5 font-mono text-xs tabular-nums",
                f.count === "out" && counts.out > 0 ? "bg-warn-soft text-warn" : "bg-line/60 text-ink-2",
              )}
            >
              {counts[f.count]}
            </span>
          </Toggle>
        ))}
      </ToggleGroup>
      {onClear && <Button variant="secondary" onClick={onClear}>Clear filters</Button>}
    </div>
  );
}

function MarkerRow({ def, ms, flag, unit }: { def: BiomarkerDef; ms: readonly Measurement[]; flag: Flag; unit: string }) {
  const trend = computeTrend(ms);
  const change = trend?.change !== undefined ? showChange(def, trend.change, unit) : undefined;
  return (
    <a
      href={href({ name: "marker", id: def.id })}
      className="flex min-h-20 items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 no-underline transition-[border-color,background-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-sm"
    >
      <div className="min-w-0">
        <div className="font-medium break-words text-ink">{fullName(def)}</div>
        <div className="text-sm text-ink-2">
          {trend ? <>{formatDate(trend.latest.date)}{change && ` · ${change === "no change" ? "no change" : `${change} ${unit}`} since previous`}</> : "No results yet"}
        </div>
      </div>
      {trend && <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="text-lg font-semibold whitespace-nowrap text-ink tabular-nums">
          {showMeasurement(def, trend.latest, unit)} <span className="text-sm font-normal text-ink-2">{valueUnit(def, unit)}</span>
        </div>
        <FlagBadge flag={flag} />
      </div>}
    </a>
  );
}

/** Short link to the biological age page, only once at least one PhenoAge marker exists. */
function BioAgeTeaser({ all, profile }: { all: Measurement[]; profile: Profile }) {
  const summary = summarizePhenoAge(all, profile.birthMonth);
  const latest = summary.draws[summary.draws.length - 1];
  let text: string;
  if (latest?.status === "ok") text = `About ${formatYears(latest.phenoAge!)} years, from your test on ${formatDate(latest.date)}. An estimate, not a verdict.`;
  else if (latest?.status === "needs-birth-month") text = "You have all 9 markers. Add your month and year of birth to see the estimate.";
  else if (summary.latestPartial) text = `${9 - summary.latestPartial.missing.length} of 9 markers from your test on ${formatDate(summary.latestPartial.date)}. See what's missing.`;
  else return null;
  return (
    <a
      href={href({ name: "phenoage" })}
      className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-line bg-accent-soft p-4 no-underline hover:border-line-strong"
    >
      <span>
        <span className="block font-medium text-ink">Biological age (PhenoAge)</span>
        <span className="text-sm text-ink-2">{text}</span>
      </span>
      <span aria-hidden="true" className="text-xl text-accent">→</span>
    </a>
  );
}

