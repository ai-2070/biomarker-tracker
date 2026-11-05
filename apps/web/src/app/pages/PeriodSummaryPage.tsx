import { useMemo, useState, type ReactNode } from "react";
import { todayIso } from "@bt/shared/core/dates";
import { buildPeriodSummary, type PeriodMarker } from "@bt/shared/core/periodSummary";
import { isCritical } from "@bt/shared/core/trends";
import { askBrain } from "../brain/store";
import { CriticalBanner } from "../components/CriticalBanner";
import { cardStyles } from "../components/dashboard/widgets";
import { SummaryTabs } from "../components/SummaryTabs";
import { SimpleSelect } from "../components/UnitSelect";
import { Button, FlagBadge, LinkButton, cx } from "../components/ui";
import { displayUnitFor, formatDate, showMeasurement, showValue, valueUnit } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile } from "../hooks";
import { BIOMARKER_MAP, CATEGORY_ORDER, fullName } from "../knowledge";
import { href, navigate } from "../router";

const CATEGORY_TITLE: Record<string, string> = { Urine: "Urine tests", Aging: "Aging (DunedinPACE)" };
const pct = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x))} %`;

/**
 * A year of blood tests for people who test a few times a year: each marker's results in the period,
 * how they compare with the period before, a trend only when there are enough tests, and what wasn't measured.
 */
export function PeriodSummaryPage({ year }: { year?: number }) {
  const all = useAllMeasurements();
  const profile = useProfile();
  const units = useDisplayUnits();
  const today = todayIso();
  const s = useMemo(
    () =>
      all
        ? buildPeriodSummary({
            measurements: all, defs: BIOMARKER_MAP, profile, categoryOrder: CATEGORY_ORDER, formatDate,
            period: year ? { kind: "year", year, today } : { kind: "rolling", end: today },
          })
        : undefined,
    [all, profile, year, today],
  );
  const years = useMemo(
    () => [...new Set((all ?? []).filter((m) => BIOMARKER_MAP.get(m.biomarkerId)?.category !== "Body").map((m) => Number(m.date.slice(0, 4))))].sort((a, b) => b - a),
    [all],
  );

  if (!all || !s) return <p className="text-ink-2">Loading…</p>;
  if (years.length === 0) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <SummaryTabs current="year" />
        <h1 className="font-serif text-4xl font-normal tracking-tight">Year summary</h1>
        <p className="text-ink-2">There are no blood tests yet. Add one and its summary appears here.</p>
        <LinkButton href={href({ name: "import" })} className="self-start">Import a lab report</LinkButton>
      </div>
    );
  }

  const unitOf = (id: string) => displayUnitFor(BIOMARKER_MAP.get(id)!, units[id]);
  const label = year ? String(year) : "the last 12 months";
  const before = year ? String(year - 1) : "the 12 months before";
  const critical = s.groups.flatMap((g) => g.markers).filter((m) => isCritical(m.lastFlag));
  const latestCritical = critical.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Past calendar years show history; the urgent banner is for results that are still the latest. */}
      {!year && <CriticalBanner items={critical.map((m) => ({ def: BIOMARKER_MAP.get(m.id)!, measurement: m.last, low: m.lastFlag === "critical-low" }))} />}
      <SummaryTabs current="year" />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="font-serif text-4xl font-normal tracking-tight text-balance sm:text-5xl">Year summary</h1>
          <p className="mt-1 text-ink-2">
            {formatDate(s.from)} to {formatDate(s.to)}:{" "}
            {s.tests.length === 0 ? "no blood test" : `${s.tests.length} blood ${s.tests.length === 1 ? "test" : "tests"} (${s.tests.map(formatDate).join(", ")})`}.{" "}
            In {before}: {s.previousTests.length === 0 ? "none" : `${s.previousTests.length} ${s.previousTests.length === 1 ? "test" : "tests"}`}.
          </p>
        </div>
        <SimpleSelect
          label="Period"
          compact
          value={year ? String(year) : "rolling"}
          options={[{ value: "rolling", label: "Last 12 months" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]}
          onChange={(v) => navigate(v === "rolling" ? { name: "period-summary" } : { name: "period-summary", year: Number(v) })}
        />
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {s.tests.length === 0 && (
            <Section title={`No blood test in ${label}`}>
              <p className="text-ink-2">Below are the most recent results for each marker and how old they are.</p>
            </Section>
          )}
          {s.groups.map((g) => (
            <Section key={g.category} title={CATEGORY_TITLE[g.category] ?? g.category}>
              <ul className="flex flex-col divide-y divide-line">
                {g.markers.map((m) => <MarkerRow key={m.id} m={m} unit={unitOf(m.id)} before={before} />)}
              </ul>
            </Section>
          ))}
          {s.notMeasured.length > 0 && (
            <Section title={`Not measured in ${label}`}>
              <ul className="flex flex-col divide-y divide-line">
                {s.notMeasured.map((n) => {
                  const def = BIOMARKER_MAP.get(n.id)!;
                  const unit = unitOf(n.id);
                  return (
                    <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <a href={href({ name: "marker", id: n.id })}>{fullName(def)}</a>
                      <span className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                        Last: {showMeasurement(def, n.last, unit)} {valueUnit(def, unit)} on {formatDate(n.last.date)}
                        {n.monthsOld >= 24 ? `, ${Math.floor(n.monthsOld / 12)} years old` : `, ${n.monthsOld} ${n.monthsOld === 1 ? "month" : "months"} old`}
                        {n.lastFlag !== "normal" && n.lastFlag !== "unknown" && <FlagBadge flag={n.lastFlag} />}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Questions questions={s.questions} />
          {!latestCritical && (
            <div className={cx(cardStyles, "flex flex-col gap-2")}>
              <h2 className="font-serif text-xl font-normal">Ask Brain</h2>
              <p className="text-sm text-ink-2">Brain gets this same summary. It doesn't diagnose or suggest medicines.</p>
              <Button
                variant="secondary"
                className="self-start"
                onClick={() => askBrain(`Explain my year summary for ${year ? year : "the last 12 months"}: what changed compared with before, what stayed outside the range, any clear trends, and what I could ask my doctor.`)}
              >
                Explain this year
              </Button>
            </div>
          )}
          <div className={cx(cardStyles, "flex flex-col gap-2 text-sm text-ink-2")}>
            <h2 className="font-serif text-xl font-normal text-ink">With only a few tests</h2>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {s.limits.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={cx(cardStyles, "flex flex-col gap-3")} aria-label={title}>
      <h2 className="font-serif text-2xl font-normal">{title}</h2>
      {children}
    </section>
  );
}

function versusText(m: PeriodMarker, unit: string, before: string): string | undefined {
  const v = m.versusBefore;
  if (!v) return undefined;
  const def = BIOMARKER_MAP.get(m.id)!;
  const now = v.nNow === 1 ? "" : ` (average of ${v.nNow})`;
  const ref = v.beforeDate ? `the last earlier result, ${formatDate(v.beforeDate)}` : v.nBefore === 1 ? before : `${before} (average of ${v.nBefore})`;
  const verdict =
    v.beyondNormalVariation === undefined
      ? "Normal test-to-test variation for this marker isn't known."
      : v.beyondNormalVariation
        ? "More than normal test-to-test variation."
        : "Within normal test-to-test variation: can't tell apart from noise.";
  const u = valueUnit(def, unit);
  return `${showValue(def, v.now, unit)} ${u}${now} vs ${showValue(def, v.before, unit)} ${u} in ${ref}: ${pct(v.changePercent)}. ${verdict}`;
}

function MarkerRow({ m, unit, before }: { m: PeriodMarker; unit: string; before: string }) {
  const def = BIOMARKER_MAP.get(m.id)!;
  const versus = versusText(m, unit, before);
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={href({ name: "marker", id: m.id })} className="font-medium">{fullName(def)}</a>
        <FlagBadge flag={m.lastFlag} />
      </div>
      <p className="text-sm">
        {m.results.length} {m.results.length === 1 ? "result" : "results"}
        {m.outside > 0 && <span className="text-warn"> · {m.outside} outside the range</span>} · latest {showMeasurement(def, m.last, unit)} {valueUnit(def, unit)} on{" "}
        {formatDate(m.last.date)}
      </p>
      {versus ? <p className="text-sm text-ink-2">{versus}</p> : <p className="text-sm text-ink-2">No earlier result to compare with.</p>}
      {m.trend && (
        <p className="text-sm text-ink-2">
          {m.trend.verdict === "unclear"
            ? `No clear trend over ${m.trend.tests} results since ${formatDate(m.trend.from)} (somewhere between ${pct(m.trend.low)} and ${pct(m.trend.high)} a year).`
            : `${m.trend.verdict === "rising" ? "Rising" : "Falling"} over ${m.trend.tests} results since ${formatDate(m.trend.from)}: about ${pct(m.trend.percentPerYear)} a year (between ${pct(m.trend.low)} and ${pct(m.trend.high)}).`}
        </p>
      )}
    </li>
  );
}

function Questions({ questions }: { questions: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cx(cardStyles, "flex flex-col gap-2")}>
      <h2 className="font-serif text-xl font-normal">Questions for your doctor</h2>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
        {questions.map((q) => <li key={q}>{q}</li>)}
      </ol>
      <Button
        variant="quiet"
        className="self-start"
        onClick={() => void navigator.clipboard?.writeText(questions.map((q, i) => `${i + 1}. ${q}`).join("\n")).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? "Copied" : "Copy the questions"}
      </Button>
    </div>
  );
}
