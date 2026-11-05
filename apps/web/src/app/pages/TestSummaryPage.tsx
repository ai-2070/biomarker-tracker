import { useMemo, useState, type ReactNode } from "react";
import { buildTestSummary, type SummaryCaution, type SummaryResult } from "@bt/shared/core/testSummary";
import { askBrain } from "../brain/store";
import { CriticalBanner } from "../components/CriticalBanner";
import { cardStyles } from "../components/dashboard/widgets";
import { SimpleSelect } from "../components/UnitSelect";
import { SummaryTabs } from "../components/SummaryTabs";
import { Button, FlagBadge, LinkButton, cx } from "../components/ui";
import { displayUnitFor, formatDate, showMeasurement, showRange, showValue, valueUnit } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, CATEGORY_ORDER, NUTRIENTS, fullName } from "../knowledge";
import { href, navigate } from "../router";

const CATEGORY_TITLE: Record<string, string> = { Urine: "Urine tests", Aging: "Aging (DunedinPACE)" };

/**
 * One blood test explained: what was outside its range and what that usually means, what changed since
 * the previous result, what can skew a reading, and questions to take to a doctor. Explains, never diagnoses.
 */
export function TestSummaryPage({ date }: { date?: string }) {
  const all = useAllMeasurements();
  const protocols = useProtocols();
  const profile = useProfile();
  const units = useDisplayUnits();
  const s = useMemo(
    () =>
      all && protocols
        ? buildTestSummary({ measurements: all, defs: BIOMARKER_MAP, profile, protocols, nutrients: NUTRIENTS, categoryOrder: CATEGORY_ORDER, formatDate, ...(date ? { date } : {}) })
        : undefined,
    [all, protocols, profile, date],
  );

  if (!all || !protocols) return <p className="text-ink-2">Loading…</p>;
  if (!s) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Test summary</h1>
        <p className="text-ink-2">There are no blood tests yet. Add one and its summary appears here.</p>
        <LinkButton href={href({ name: "import" })} className="self-start">Import a lab report</LinkButton>
      </div>
    );
  }

  const unitOf = (id: string) => displayUnitFor(BIOMARKER_MAP.get(id)!, units[id]);
  const flaggedCount = s.critical.length + s.outOfRange.reduce((n, g) => n + g.items.length, 0);
  const isLatest = s.date === s.dates[0];

  return (
    <div className="flex flex-col gap-6">
      <CriticalBanner items={s.critical.map((r) => ({ def: BIOMARKER_MAP.get(r.id)!, measurement: r.measurement, low: r.flag === "critical-low" }))} />
      <SummaryTabs current="test" />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="font-serif text-4xl font-normal tracking-tight text-balance sm:text-5xl">Test summary</h1>
          <p className="mt-1 text-ink-2">
            {isLatest ? "Your latest blood test" : "Blood test"}, {formatDate(s.date)}: {s.results} {s.results === 1 ? "result" : "results"}, {s.inRange} in range,{" "}
            {flaggedCount} outside {flaggedCount === 1 ? "its" : "their"} range{s.notAssessed.length ? `, ${s.notAssessed.length} without a range` : ""}.
          </p>
        </div>
        {s.dates.length > 1 && (
          <SimpleSelect
            label="Blood test"
            compact
            value={s.date}
            options={s.dates.map((d, i) => ({ value: d, label: `${formatDate(d)}${i === 0 ? " (latest)" : ""}` }))}
            onChange={(d) => navigate({ name: "test-summary", ...(d === s.dates[0] ? {} : { date: d }) })}
          />
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {s.critical.length > 0 && (
            <Section title="Far outside the range">
              <p className="text-ink-2">Contact a doctor about these first. The rest of this summary can wait.</p>
              <ul className="flex flex-col gap-3">
                {s.critical.map((r) => <ResultCard key={r.id} r={r} unit={unitOf(r.id)} />)}
              </ul>
            </Section>
          )}

          {s.outOfRange.length > 0 ? (
            <Section title="Outside the range">
              <p className="text-ink-2">What each result usually means, from the app's sources. It doesn't tell what is behind your result; a doctor who knows you can.</p>
              {s.outOfRange.map((g) => (
                <div key={g.category} className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{CATEGORY_TITLE[g.category] ?? g.category}</h3>
                  <ul className="flex flex-col gap-3">
                    {g.items.map((r) => <ResultCard key={r.id} r={r} unit={unitOf(r.id)} />)}
                  </ul>
                </div>
              ))}
            </Section>
          ) : (
            s.critical.length === 0 && (
              <Section title="Outside the range">
                <p>Every result with a range was inside it.</p>
              </Section>
            )
          )}

          {s.backInRange.length > 0 && (
            <Section title="Back in range">
              <p className="text-ink-2">Outside the range on the test before, inside it on this one.</p>
              <ul className="flex flex-col divide-y divide-line">
                {s.backInRange.map((r) => {
                  const def = BIOMARKER_MAP.get(r.id)!;
                  const unit = unitOf(r.id);
                  return (
                    <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                      <a href={href({ name: "marker", id: r.id })} className="font-medium">{def.name}</a>
                      <span className="text-ink-2">
                        {showValue(def, r.previous!.value, unit)} on {formatDate(r.previous!.date)} → <span className="text-ink">{showMeasurement(def, r.measurement, unit)} {valueUnit(def, unit)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {s.notAssessed.length > 0 && (
            <Section title="Without a range">
              <p className="text-ink-2">No range was saved for these and the app has no typical one, so they aren't judged. That doesn't mean they're normal.</p>
              <p>
                {s.notAssessed.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ", "}
                    <a href={href({ name: "marker", id: r.id })}>{BIOMARKER_MAP.get(r.id)!.name}</a>
                  </span>
                ))}
              </p>
            </Section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          {s.cautions.length > 0 && <Cautions cautions={s.cautions} />}
          <Questions questions={s.questions} />
          {s.critical.length === 0 && (
            <div className={cx(cardStyles, "flex flex-col gap-2")}>
              <h2 className="font-serif text-xl font-normal">Ask Brain</h2>
              <p className="text-sm text-ink-2">Brain gets this same summary and explains it in conversation. It doesn't diagnose or suggest medicines.</p>
              <Button
                variant="secondary"
                className="self-start"
                onClick={() => askBrain(`Explain the summary of my blood test on ${s.date}: what was outside the range, what those results usually mean and how they relate, what changed since before, and what I could ask my doctor.`)}
              >
                Explain this test
              </Button>
            </div>
          )}
          <div className={cx(cardStyles, "flex flex-col gap-2 text-sm text-ink-2")}>
            <h2 className="font-serif text-xl font-normal text-ink">What this can't tell</h2>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {s.limits.map((l) => <li key={l}>{l}</li>)}
            </ul>
            <a href={href({ name: "data", tab: "data" })}>Make a doctor-ready report</a>
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

function changeText(r: SummaryResult): string | undefined {
  switch (r.change) {
    case "new":
      return "Inside the range or not judged on the test before.";
    case "about the same":
      return r.beyondNormalVariation === false ? "About the same as before: the change is within normal test-to-test variation." : "About the same as before.";
    case "closer":
      return r.beyondNormalVariation ? "Closer to the range than before, by more than normal test-to-test variation." : "Closer to the range than before.";
    case "further":
      return r.beyondNormalVariation ? "Further from the range than before, by more than normal test-to-test variation." : "Further from the range than before.";
    default:
      return r.previous ? undefined : "The first result for this marker.";
  }
}

function ResultCard({ r, unit }: { r: SummaryResult; unit: string }) {
  const def = BIOMARKER_MAP.get(r.id)!;
  const range = showRange(def, r.range, unit);
  const change = changeText(r);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={href({ name: "marker", id: r.id })} className="font-medium">{fullName(def)}</a>
        <FlagBadge flag={r.flag} />
      </div>
      <p className="text-lg">
        {showMeasurement(def, r.measurement, unit)} {valueUnit(def, unit)}
        {range && <span className="text-sm text-ink-2"> · range {range}{r.range?.source === "default" ? " (typical adult range)" : ""}</span>}
      </p>
      {r.meaning && <p>{r.meaning}</p>}
      {r.commonCauses.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2">Common reasons for a {r.flag.endsWith("high") ? "high" : "low"} result</summary>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
            {r.commonCauses.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </details>
      )}
      {(r.previous || change) && (
        <p className="text-sm text-ink-2">
          {r.previous && <>Before: {showValue(def, r.previous.value, unit)} {valueUnit(def, unit)} on {formatDate(r.previous.date)}. </>}
          {change}
          {r.streak >= 2 && <> Outside the range on {r.streak} tests in a row, since {formatDate(r.streakFrom)}.</>}
        </p>
      )}
    </li>
  );
}

function Cautions({ cautions }: { cautions: SummaryCaution[] }) {
  return (
    <div className={cx(cardStyles, "flex flex-col gap-2")}>
      <h2 className="font-serif text-xl font-normal">Worth knowing</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {cautions.map((c) => (
          <li key={c.kind + (c.nutrientId ?? "")} className="border-l-2 border-warn pl-3">
            {c.habit && <span className="font-medium">From your habit "{c.habit}": </span>}
            {c.text}
            {c.nutrientId && (
              <>
                {" "}
                <a href={href({ name: "nutrient", id: c.nutrientId })}>Evidence</a>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Questions({ questions }: { questions: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cx(cardStyles, "flex flex-col gap-2")}>
      <h2 className="font-serif text-xl font-normal">Questions for your doctor</h2>
      <p className="text-sm text-ink-2">Written from your results. Change them as you like.</p>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
        {questions.map((q) => <li key={q}>{q}</li>)}
      </ol>
      <Button
        variant="quiet"
        className="self-start"
        onClick={() => {
          void navigator.clipboard?.writeText(questions.map((q, i) => `${i + 1}. ${q}`).join("\n")).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy the questions"}
      </Button>
    </div>
  );
}

