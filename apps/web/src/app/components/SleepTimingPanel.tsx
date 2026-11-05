import { useMemo, useRef, useState } from "react";
import { buildSleepTiming, pairSleepCardiac, sleepClock, type SleepCardiacMetric, type SleepNight, type SleepTimingMetric } from "@bt/core/sleepTiming";
import { todayIso } from "@bt/core/dates";
import { niceTicks } from "@bt/core/scale";
import { presetWindow, timeTicks, type TimeWindow } from "@bt/core/timeWindow";
import type { Measurement, SleepSession } from "@bt/core/types";
import { formatDate } from "../format";
import { useAllMeasurements } from "../hooks";
import { href } from "../router";
import { PaperLink } from "./PaperLink";
import { CHART_PRESETS, Overview, SelectionBar, TimeControls, fromDay, useTimeView, useWidth } from "./timeControls";
import { SimpleSelect } from "./UnitSelect";
import { Card, LinkButton } from "./ui";

const LEFT = 54;
const RIGHT = 16;
const TOP = 16;
const HEIGHT = 260;
const BOTTOM = HEIGHT - 30;
const ACCENT = "var(--color-accent)";
const SECONDARY = "var(--color-ink-2)";
const KIND: Record<SleepSession["kind"], string> = { asleep: "Recorded sleep", "in-bed": "Time in bed", session: "Recorded session" };
const minuteText = (value: number | undefined) => value === undefined ? "Not enough adjacent nights" : `${Math.round(value)} min`;
const stamp = (value: string) => value.replace("T", " ").slice(0, 16);
const dayIso = (value: number) => fromDay(value).toISOString().slice(0, 10);
const dayLabel = (value: number) => fromDay(value).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const offsetLabel = (offset: number | undefined) => offset === undefined ? "Unknown" : `UTC${offset < 0 ? "−" : "+"}${sleepClock(Math.abs(offset) / 60)}`;

/** The marker page mounts the all-measurement subscription only for Sleep. */
export function SleepTimingSection() {
  const measurements = useAllMeasurements();
  return measurements ? <SleepTimingPanel measurements={measurements} /> : <p className="text-ink-2">Loading sleep timings…</p>;
}

/** Separate from duration and stage charts: imported local-clock windows, never guessed bedtimes. */
export function SleepTimingPanel({ measurements }: { measurements: readonly Measurement[] }) {
  const today = todayIso();
  const summary = useMemo(() => buildSleepTiming(measurements, { today }), [measurements, today]);
  return (
    <Card id="sleep-timing" className="flex min-w-0 flex-col gap-4">
      <div className="max-w-3xl">
        <h3 className="font-serif text-2xl font-normal">Sleep timing &amp; regularity</h3>
        <p className="mt-1 text-sm text-ink-2">When your device recorded sleep, shown in the local time saved by the source. These are estimated windows, not exact moments of falling asleep.</p>
      </div>
      {summary.nights.length ? <SleepPlots measurements={measurements} nights={summary.nights} today={today} /> : (
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-3xl text-sm text-ink-2">{summary.durationOnlyNights ? `${summary.durationOnlyNights} saved nights have duration but no timing. Re-import the original device export to add timings where the file contains them.` : "Import a device export containing sleep start and end times to see this chart. A total number of hours cannot tell us when you slept."}</p>
          {summary.invalidNights > 0 && <p className="text-sm text-ink-2">{summary.invalidNights} nights have timing data that could not be used.</p>}
          <LinkButton variant="secondary" href={href({ name: "device-import" })}>Import from a device</LinkButton>
        </div>
      )}
      <SleepTimingEvidence />
    </Card>
  );
}

function SleepPlots({ measurements, nights, today }: { measurements: readonly Measurement[]; nights: SleepNight[]; today: string }) {
  const first = nights[0]!.day, last = nights.at(-1)!.day;
  const full = useMemo(() => ({ from: first - 0.7, to: Math.max(last + 0.7, first + 14) }), [first, last]);
  const [requested, setRequested] = useState<{ view: TimeWindow | null; preset: string }>(() => ({ view: presetWindow(30, full, 14), preset: "1M" }));
  const [active, setActive] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const plotWidth = Math.max(width - LEFT - RIGHT, 1);
  const t = useTimeView(full, { left: LEFT, width: plotWidth }, {
    ref: box,
    minSpan: 14,
    drag: "select",
    onChange: () => setActive(null),
    shared: { extent: { first: nights[0]!.date, last: nights.at(-1)!.date }, ...requested, onChange: (view, preset) => setRequested({ view, preset }) },
  });
  const from = dayIso(Math.ceil(t.v.from)), to = dayIso(Math.floor(t.v.to));
  const windowStroke = Math.max(1.5, Math.min(7, plotWidth / (t.v.to - t.v.from) * 0.65));
  const summary = useMemo(() => buildSleepTiming(measurements, { from, to, today }), [measurements, from, to, today]);
  const shown = summary.nights;
  const selected = shown.find((night) => night.date === active) ?? shown.at(-1);
  const ticks = timeTicks(t.v);
  const x = (day: number) => LEFT + (day - t.v.from) / (t.v.to - t.v.from) * plotWidth;
  const values = shown.flatMap((night) => night.windows.flatMap((window) => [window.start, window.end]));
  const yTicks = niceTicks(values.length ? Math.min(...values) - 0.5 : -6, values.length ? Math.max(...values) + 0.5 : 12, 5);
  const low = yTicks[0]!, high = yTicks.at(-1)!;
  const y = (hour: number) => TOP + (hour - low) / Math.max(high - low, 1) * (BOTTOM - TOP);
  const regularity = summary.regularity;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TimeControls t={t} presets={CHART_PRESETS} />
      <p className="text-sm text-ink-2">{shown.length} nights in view · date is the day you woke up. The longest recorded window is the main session; extra windows, including naps, stay separate.</p>
      <div {...t.bind} className="relative min-w-0 touch-pan-y rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="Sleep timing chart. Arrow keys move through time; plus and minus zoom.">
        {width > 0 && <svg width={width} height={HEIGHT} className="block max-w-full" role="group" aria-label="Recorded sleep windows by waking date and local clock time">
          {yTicks.map((tick) => <g key={tick}><line x1={LEFT} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" /><text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" className="fill-ink-2 font-mono text-[11px]">{sleepClock(tick)}</text></g>)}
          {ticks.map((tick) => <text key={tick.day} x={x(tick.day)} y={HEIGHT - 8} textAnchor="middle" className="fill-ink-2 font-mono text-[10px]">{dayLabel(tick.day)}</text>)}
          {shown.map((night) => <g key={night.date} tabIndex={0} role="button" aria-label={`${formatDate(night.date)}. ${KIND[night.main.kind]}, ${sleepClock(night.start)} to ${sleepClock(night.end)}. ${night.windows.length} windows.`} onMouseEnter={() => { if (!t.isDragging()) setActive(night.date); }} onFocus={() => setActive(night.date)} onClick={() => setActive(night.date)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setActive(night.date); } }} className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-accent">
            <rect x={x(night.day) - 12} y={TOP} width={24} height={BOTTOM - TOP} fill="transparent" stroke={selected?.date === night.date ? "var(--color-line-strong)" : "transparent"} rx={4} />
            {night.windows.map((window, i) => <line key={i} x1={x(night.day)} x2={x(night.day)} y1={y(window.start)} y2={y(window.end)} stroke={window.main ? ACCENT : SECONDARY} strokeWidth={window.main ? windowStroke : Math.min(4, windowStroke)} strokeLinecap="round" strokeDasharray={window.main ? undefined : "2 4"} />)}
          </g>)}
        </svg>}
      </div>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2"><span>Solid green: main window</span><span>Dotted grey: additional windows</span><span>All times are source-local · no target bedtime</span></p>
      <div className="min-h-16 rounded-lg bg-sunken px-3 py-2 text-sm" aria-live="polite">
        {selected ? (
          <>
            <p className="font-medium">{formatDate(selected.date)} · {KIND[selected.main.kind]} {sleepClock(selected.start)}–{sleepClock(selected.end)}</p>
            <p className="text-ink-2">{selected.main.source ?? "Source not recorded"} · {offsetLabel(selected.main.startOffsetMinutes)} → {offsetLabel(selected.main.endOffsetMinutes)}. {selected.main.startOffsetMinutes === undefined || selected.main.endOffsetMinutes === undefined ? "Local clock times only; original offset not supplied." : selected.main.startOffsetMinutes !== selected.main.endOffsetMinutes ? "The clock offset changed; this window is not elapsed sleep time." : "Source time-zone offsets retained."}</p>
          </>
        ) : <p className="text-ink-2">No usable timings in this period.</p>}
      </div>
      {t.zoomed && <Overview t={t} lines={[{ color: ACCENT, points: nights.map((night) => ({ day: night.day, value: night.midpoint })) }]} />}
      <SelectionBar t={t}>Select dates to look closer at sleep timing.</SelectionBar>
      <TimingTable nights={shown} />
      <section className="flex flex-col gap-3 border-t border-line pt-4" aria-label="Sleep regularity">
        <div><h4 className="font-medium">How much your timing changes</h4><p className="mt-1 max-w-3xl text-sm text-ink-2">Average absolute change between adjacent nights from the same source and kind of window. Missing nights and changes of source are not joined. This is a plain difference in minutes, not the research Sleep Regularity Index or a health score.</p></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-ink-2">Start-time change</dt><dd className="mt-1 text-lg font-medium tabular-nums">{minuteText(regularity.startShiftMinutes)}</dd></div>
          <div><dt className="text-ink-2">End-time change</dt><dd className="mt-1 text-lg font-medium tabular-nums">{minuteText(regularity.endShiftMinutes)}</dd></div>
          <div><dt className="text-ink-2">Adjacent-night pairs</dt><dd className="mt-1 text-lg font-medium tabular-nums">{regularity.pairs}</dd></div>
        </dl>
        {regularity.pairs > 0 && <RegularityPlot nights={shown} width={width} from={t.v.from} to={t.v.to} />}
      </section>
      <details className="border-t border-line pt-1">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">Compare with resting heart rate or HRV</summary>
        <SleepCardiacComparison nights={shown} measurements={measurements} />
      </details>
      {(summary.durationOnlyNights > 0 || summary.invalidNights > 0) && <p className="text-sm text-ink-2">In this period, {summary.durationOnlyNights} nights have duration only and {summary.invalidNights} have unusable timings. Re-import the original files to add missing timings where available.</p>}
    </div>
  );
}

function TimingTable({ nights }: { nights: readonly SleepNight[] }) {
  return (
    <details>
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Show sleep timings as a table</summary>
      <div className="max-h-96 overflow-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="Sleep timing table">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr>
              <th className="p-3">Waking date</th>
              <th className="p-3">Window</th>
              <th className="p-3">Start</th>
              <th className="p-3">End</th>
              <th className="p-3">UTC offsets</th>
              <th className="p-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {nights.map((night) => night.measurement.sleepSessions!.map((session, i) => (
              <tr key={`${night.date}-${i}`} className="border-t border-line">
                <td className="p-3 whitespace-nowrap">{formatDate(night.date)}</td>
                <td className="p-3">{KIND[session.kind]}{session === night.main ? " · main" : ""}</td>
                <td className="p-3 whitespace-nowrap tabular-nums">{stamp(session.start)}</td>
                <td className="p-3 whitespace-nowrap tabular-nums">{stamp(session.end)}</td>
                <td className="p-3 whitespace-nowrap">{offsetLabel(session.startOffsetMinutes)} → {offsetLabel(session.endOffsetMinutes)}</td>
                <td className="p-3">{session.source ?? "Not recorded"}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
function RegularityPlot({ nights, width, from, to }: { nights: readonly SleepNight[]; width: number; from: number; to: number }) {
  const values = nights.flatMap((night) => [night.startShiftMinutes, night.endShiftMinutes].filter((v): v is number => v !== undefined));
  const ticks = niceTicks(Math.min(0, ...values) - 5, Math.max(0, ...values) + 5, 4);
  const low = ticks[0]!, high = ticks.at(-1)!;
  const H = 180, bottom = H - 30;
  const x = (day: number) => LEFT + (day - from) / (to - from) * Math.max(width - LEFT - RIGHT, 1);
  const y = (value: number) => TOP + (high - value) / Math.max(high - low, 1) * (bottom - TOP);
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-sm text-ink-2">Night-to-night shifts in minutes. Above zero is later; below zero is earlier. Circles: start · squares: end.</figcaption>
      {width > 0 && (
        <svg width={width} height={H} className="block max-w-full" role="img" aria-label="Night-to-night sleep start and end shifts, in minutes">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={LEFT} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "var(--color-line-strong)" : "var(--color-line)"} />
              <text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" className="fill-ink-2 font-mono text-[10px]">{tick > 0 ? "+" : ""}{tick}</text>
            </g>
          ))}
          {nights.map((night) => (
            <g key={night.date}>
              {night.startShiftMinutes !== undefined && <circle cx={x(night.day)} cy={y(night.startShiftMinutes)} r={3.5} fill={ACCENT} />}
              {night.endShiftMinutes !== undefined && <rect x={x(night.day) - 3} y={y(night.endShiftMinutes) - 3} width={6} height={6} fill={SECONDARY} />}
            </g>
          ))}
          {timeTicks({ from, to }).map((tick) => <text key={tick.day} x={x(tick.day)} y={H - 8} textAnchor="middle" className="fill-ink-2 font-mono text-[10px]">{dayLabel(tick.day)}</text>)}
        </svg>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm">Show timing shifts as a table</summary>
        <div className="max-h-72 overflow-auto" tabIndex={0} role="region" aria-label="Timing shift table">
          <table className="w-full text-left text-sm">
            <thead><tr><th className="p-2">Waking date</th><th className="p-2">Start shift (min)</th><th className="p-2">End shift (min)</th></tr></thead>
            <tbody>
              {nights.filter((night) => night.startShiftMinutes !== undefined).map((night) => (
                <tr key={night.date} className="border-t border-line">
                  <td className="p-2">{formatDate(night.date)}</td>
                  <td className="p-2 tabular-nums">{Math.round(night.startShiftMinutes!)}</td>
                  <td className="p-2 tabular-nums">{night.endShiftMinutes === undefined ? "—" : Math.round(night.endShiftMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

const TIMING_OPTIONS = [{ value: "start", label: "Main window start" }, { value: "end", label: "Main window end" }, { value: "midpoint", label: "Main window midpoint" }, { value: "shift", label: "Midpoint shift (later + / earlier −)" }];
const CARDIAC_OPTIONS = [{ value: "resting_hr", label: "Resting heart rate" }, { value: "hrv_resting", label: "Resting HRV (RMSSD)" }];

function SleepCardiacComparison({ nights, measurements }: { nights: readonly SleepNight[]; measurements: readonly Measurement[] }) {
  const [metric, setMetric] = useState<SleepCardiacMetric>("resting_hr");
  const [timing, setTiming] = useState<SleepTimingMetric>("midpoint");
  const [active, setActive] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const pairs = useMemo(() => pairSleepCardiac(nights, measurements, metric, timing), [nights, measurements, metric, timing]);
  const points = pairs.points;
  const unit = metric === "resting_hr" ? "bpm" : "ms";
  const xPadding = timing === "shift" ? 1 : 0.2;
  const xTicks = niceTicks(points.length ? Math.min(...points.map((p) => p.x)) - xPadding : 0, points.length ? Math.max(...points.map((p) => p.x)) + xPadding : 1, 5);
  const yTicks = niceTicks(points.length ? Math.min(...points.map((p) => p.y)) - 1 : 0, points.length ? Math.max(...points.map((p) => p.y)) + 1 : 1, 5);
  const x = (value: number) => LEFT + (value - xTicks[0]!) / Math.max(xTicks.at(-1)! - xTicks[0]!, 0.1) * Math.max(width - LEFT - RIGHT, 1);
  const y = (value: number) => TOP + (yTicks.at(-1)! - value) / Math.max(yTicks.at(-1)! - yTicks[0]!, 1) * (BOTTOM - TOP);
  const xLabel = (value: number) => timing === "shift" ? `${Math.round(value * 10) / 10} min` : sleepClock(value);
  const selected = points.find((point) => point.date === active);
  return (
    <div className="flex min-w-0 flex-col gap-3 pb-2">
      <p className="max-w-3xl text-sm text-ink-2">Each dot pairs a sleep window with a resting measurement on its waking date. Resting heart rate and resting heart rate variability (HRV, RMSSD) are kept separate. Daytime HRV, exercise pulse and Apple's SDNN are not substituted.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SimpleSelect label="Sleep timing" options={TIMING_OPTIONS} value={timing} onChange={(value) => { setTiming(value as SleepTimingMetric); setActive(null); }} />
        <SimpleSelect label="Compare with" options={CARDIAC_OPTIONS} value={metric} onChange={(value) => { setMetric(value as SleepCardiacMetric); setActive(null); }} />
      </div>
      <p className="text-sm text-ink-2">{points.length} matched dates · {pairs.excluded} nights without an eligible pair. No filling gaps or carrying a reading to another day.</p>
      <div ref={box} className="min-w-0">
        {points.length > 0 ? width > 0 && (
          <svg width={width} height={HEIGHT} className="block max-w-full" role="group" aria-label={`${metric === "resting_hr" ? "Resting heart rate" : "Resting HRV"} compared with sleep ${timing}`}>
            {yTicks.map((tick) => (
              <g key={tick}>
                <line x1={LEFT} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" />
                <text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" className="fill-ink-2 font-mono text-[10px]">{tick}</text>
              </g>
            ))}
            {xTicks.map((tick) => <text key={tick} x={x(tick)} y={HEIGHT - 8} textAnchor="middle" className="fill-ink-2 font-mono text-[10px]">{xLabel(tick)}</text>)}
            <text x={LEFT} y={11} className="fill-ink-2 text-[10px]">{unit}</text>
            {points.map((point) => (
              <g
                key={point.date}
                tabIndex={0}
                role="button"
                aria-label={`${formatDate(point.date)}. ${xLabel(point.x)}, ${point.y} ${unit}`}
                onMouseEnter={() => setActive(point.date)}
                onFocus={() => setActive(point.date)}
                onClick={() => setActive(point.date)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    setActive(point.date);
                  }
                }}
                className="cursor-pointer outline-none focus-visible:[&>circle:first-child]:stroke-accent"
              >
                <circle cx={x(point.x)} cy={y(point.y)} r={22} fill="transparent" stroke={selected?.date === point.date ? SECONDARY : "transparent"} />
                <circle cx={x(point.x)} cy={y(point.y)} r={4} fill={ACCENT} />
              </g>
            ))}
          </svg>
        ) : (
          <p className="rounded-lg bg-sunken p-3 text-sm text-ink-2">No matched data for this choice. Import resting measurements on the same waking dates; midpoint shifts also need adjacent nights from the same source.</p>
        )}
      </div>
      {selected && <p className="text-sm" aria-live="polite">{formatDate(selected.date)} · {xLabel(selected.x)} · {selected.y} {unit}</p>}
      <p className="max-w-3xl text-sm text-ink-2">Midpoint is halfway between the displayed local start and end, not elapsed-time halfway when clocks change. A same-date resting reading may not cover this exact sleep window. Alcohol, illness, training, medicines, sleep duration and device changes can all affect the comparison. A pattern is not proof of cause; there is no fitted trend, predicted benefit or ideal bedtime.</p>
      {points.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm">Show matched dates as a table</summary>
          <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label="Matched sleep and resting measurement table">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">Waking date</th><th className="p-2">Timing</th><th className="p-2">{unit}</th><th className="p-2">Measurement source</th></tr></thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.date} className="border-t border-line">
                    <td className="p-2 whitespace-nowrap">{formatDate(point.date)}</td>
                    <td className="p-2 whitespace-nowrap tabular-nums">{xLabel(point.x)}</td>
                    <td className="p-2 tabular-nums">{point.y}</td>
                    <td className="p-2">{point.measurement.note ?? point.measurement.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function SleepTimingEvidence() {
  return (
    <details className="border-t border-line pt-1">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Why compare sleep timing, heart rate and HRV?</summary>
      <div className="flex max-w-3xl flex-col gap-3 text-sm text-ink-2">
        <p>A small laboratory study found that heart rate and heart rate variability depend on sleep stage and the body clock. An observational Fitbit study linked deviations from usual bedtimes with higher resting heart rate. Neither establishes that changing your bedtime will improve your own readings.</p>
        <p>The comparison above is descriptive. Its regularity measure is the app's average clock-time change between adjacent nights, not a validated Sleep Regularity Index. Keep the same device and measurement method when comparing nights.</p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <PaperLink href="https://pubmed.ncbi.nlm.nih.gov/24293767/" source={{ title: "Circadian variation of heart rate variability across sleep stages", year: 2013, kind: "Laboratory study" }} className="text-ink underline underline-offset-2">
              Boudreau et al., 2013 — sleep stages, the body clock and HRV
            </PaperLink>
          </li>
          <li>
            <PaperLink href="https://pubmed.ncbi.nlm.nih.gov/32219180/" source={{ title: "Deviations from normal bedtimes are associated with short-term increases in resting heart rate", year: 2020, kind: "Observational study" }} className="text-ink underline underline-offset-2">
              Faust et al., 2020 — bedtime deviations and resting heart rate
            </PaperLink>
          </li>
        </ul>
      </div>
    </details>
  );
}
