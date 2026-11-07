
import type { DashboardMarker } from "@bt/shared/core/dashboard";

import { displayUnitFor, showMeasurement, valueUnit } from "../../format";
import { useDisplayUnits } from "../../hooks";
import { shortName } from "../../knowledge";
import { href } from "../../router";

import { cx } from "../ui";
import { Sparkline } from "./Sparkline";
import { inBodyOrder } from "./body";

/** The main dashboard shows these; the rest are on the Body page. */
const SUMMARY_IDS = new Set(["weight", "waist", "bp_systolic", "resting_hr", "hrv_resting", "spo2", "sleep_duration", "glucose_home"]);
const SUMMARY_LABEL: Record<string, string> = {
  weight: "Weight",
  waist: "Waist",
  bp_systolic: "Blood pressure",
  resting_hr: "Resting pulse",
  hrv_resting: "Resting HRV",
  spo2: "Blood oxygen",
  sleep_duration: "Sleep",
  glucose_home: "Blood glucose",
};

/** One line per key body measurement with a small trend line: for the main dashboard. Blood pressure is one row. */
/** One row of a dashboard summary list: name (and flag) | chart | value | unit, the same columns in every row. */
export const summaryRow =
  "grid min-h-12 grid-cols-[minmax(0,1fr)_4rem_4rem_3.25rem] items-center gap-2 py-1.5 text-ink no-underline hover:bg-sunken";

/** The latest value for a summary row, with an arrow when it's out of range (the name keeps its room). */
export function SummaryValue({ text, flag }: { text: string; flag: string }) {
  const out = flag !== "normal" && flag !== "unknown";
  const low = flag.endsWith("low");
  return (
    <span className={cx("text-right text-sm whitespace-nowrap tabular-nums", out && (flag.startsWith("critical") ? "font-medium text-danger" : "font-medium text-warn"))}>
      {out && (
        <span aria-hidden="true" className="mr-0.5">
          {low ? "↓" : "↑"}
        </span>
      )}
      {text}
      {out && <span className="sr-only"> ({low ? "low" : "high"})</span>}
    </span>
  );
}

export function BodySummaryList({ markers }: { markers: DashboardMarker[] }) {
  const units = useDisplayUnits();
  const dia = markers.find((m) => m.def.id === "bp_diastolic");
  return (
    <ul className="flex flex-col divide-y divide-line">
      {inBodyOrder(markers.filter((m) => SUMMARY_IDS.has(m.def.id))).map((m) => {
        const bp = m.def.id === "bp_systolic";
        const unit = displayUnitFor(m.def, units[m.def.id]);
        const flag = bp && dia && dia.flag !== "normal" && dia.flag !== "unknown" && (m.flag === "normal" || m.flag === "unknown") ? dia.flag : m.flag;
        const tone = flag.startsWith("critical") ? "danger" : flag === "normal" || flag === "unknown" ? "ok" : "warn";
        return (
          <li key={m.def.id}>
            <a href={href({ name: "marker", id: m.def.id })} className={summaryRow}>
              <span className="truncate text-sm font-medium">{SUMMARY_LABEL[m.def.id] ?? shortName(m.def)}</span>
              <Sparkline series={m.series.slice(-12)} {...(m.range ? { range: m.range } : {})} tone={tone} />
              <SummaryValue text={bp && dia ? `${Math.round(m.latest.value)}/${Math.round(dia.latest.value)}` : showMeasurement(m.def, m.latest, unit)} flag={flag} />
              <span className="truncate text-sm text-ink-2">{valueUnit(m.def, unit)}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
