import type { DoctorReportSeries } from "@bt/shared/core/doctorReport";
import { reportChartGeometry } from "@bt/shared/core/doctorReportChart";
import type { Measurement } from "@bt/shared/core/types";
import { useId } from "react";
import { displayUnitFor, formatDate, showMeasurement, showValue, valueUnit } from "../format";

const BOX = { left: 92, top: 28, width: 524, height: 146 };
const SOURCE: Record<Measurement["source"], string> = {
  manual: "Typed manually",
  pdf: "Lab PDF",
  csv: "CSV file",
  photo: "Photo or scanned report",
  device: "Device export",
};

/** Static, paper-first SVG: no animation, reference-band assumptions or interactive chart state. */
export function DoctorReportChart({ series, unit, from, to }: { series: DoctorReportSeries; unit: string; from: string; to: string }) {
  const id = useId();
  const { def } = series;
  const displayUnit = displayUnitFor(def, unit);
  const suffix = valueUnit(def, displayUnit);
  const chart = reportChartGeometry(
    def,
    series.history.map((reading) => reading.measurement),
    displayUnit,
    from,
    to,
    BOX,
  );
  const hasBounds = chart.points.some((point) => point.measurement.qualifier !== undefined);
  const hasCoincidentReadings = chart.points.some((point) => point.overlapCount > 1);
  const description = `All ${chart.points.length} selected readings of ${def.name}, from ${formatDate(from)} to ${formatDate(to)}, in ${suffix || "hours and minutes"}. Dots show exact readings. Lines join consecutive exact readings on separate days and stop at bounds or days with multiple readings. Arrows marked less than or greater than show reported limits, not exact values. No readings are averaged or removed.`;

  return (
    <figure className="doctor-report-chart m-0">
      <div
        className="doctor-report-chart-viewport overflow-x-auto outline-offset-2 focus-visible:outline-2 focus-visible:outline-black print:overflow-visible"
        tabIndex={0}
        role="group"
        aria-label={`${def.name} chart, scroll horizontally if needed`}
      >
        <svg
          className="doctor-report-chart-svg block h-auto w-full min-w-[600px] print:min-w-0"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 640 218"
          width="640"
          height="218"
          role="group"
          aria-roledescription="chart"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
          fill="#000"
          fontFamily="inherit"
          fontSize="12"
        >
          <title id={`${id}-title`}>{def.name} — selected readings</title>
          <desc id={`${id}-description`}>{description}</desc>
          <rect x="0" y="0" width="640" height="218" fill="#fff" />
          <g aria-hidden="true">
            <text x={BOX.left} y="14">
              {suffix || "Hours / minutes"}
            </text>
            {chart.yTicks.map((tick, index) => (
              <g key={index}>
                <line x1={BOX.left} x2={BOX.left + BOX.width} y1={tick.y} y2={tick.y} stroke="#000" strokeWidth="0.45" strokeDasharray="2 4" />
                <text x={BOX.left - 10} y={tick.y} dominantBaseline="middle" textAnchor="end">
                  {showValue(def, tick.canonicalValue, displayUnit)}
                </text>
              </g>
            ))}
            <path d={`M ${BOX.left} ${BOX.top} V ${BOX.top + BOX.height} H ${BOX.left + BOX.width}`} fill="none" stroke="#000" strokeWidth="0.8" />
            {chart.dateTicks.map((tick, index) => (
              <g key={tick.date}>
                <line x1={tick.x} x2={tick.x} y1={BOX.top + BOX.height} y2={BOX.top + BOX.height + 5} stroke="#000" strokeWidth="0.8" />
                <text
                  x={tick.x}
                  y={BOX.top + BOX.height + 23}
                  textAnchor={chart.dateTicks.length === 1 ? "middle" : index === 0 ? "start" : index === chart.dateTicks.length - 1 ? "end" : "middle"}
                >
                  {formatDate(tick.date)}
                </text>
              </g>
            ))}
            {chart.segments.map((segment, index) => (
              <polyline
                key={index}
                points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="#000"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            ))}
          </g>
          {chart.points.map((point) => {
            const m = point.measurement;
            const qualifier = m.qualifier;
            const boundLabelOnLeft = qualifier && point.x > BOX.left + BOX.width / 2;
            const label = [
              `${formatDate(m.date)}: ${showMeasurement(def, m, displayUnit)} ${suffix}`.trim(),
              SOURCE[m.source],
              m.lab ? `Lab: ${m.lab}` : undefined,
              m.fasted === true ? "Fasting" : m.fasted === false ? "Not fasting" : "Fasting not recorded",
              m.note ? `Note: ${m.note}` : undefined,
            ]
              .filter(Boolean)
              .join("; ");
            return (
              <g key={m.id} role="img" aria-label={label}>
                <title>{label}</title>
                {qualifier ? (
                  <g fill="none" stroke="#000" strokeWidth="1.2">
                    {/* The cap is the reported limit; the arrow points towards possible values. */}
                    <path
                      d={`M ${point.x - 4} ${point.y} H ${point.x + 4} M ${point.x} ${point.y} v ${qualifier === "<" ? 12 : -12} m -3 ${qualifier === "<" ? -4 : 4} l 3 ${qualifier === "<" ? 4 : -4} l 3 ${qualifier === "<" ? -4 : 4}`}
                    />
                    {point.overlapIndex === 0 && (
                      <text
                        x={point.x + (boundLabelOnLeft ? -8 : 8)}
                        y={point.y + 4}
                        textAnchor={boundLabelOnLeft ? "end" : "start"}
                        stroke="none"
                        fill="#000"
                        fontSize="13"
                        fontWeight="600"
                      >
                        {showMeasurement(def, m, displayUnit)}
                      </text>
                    )}
                  </g>
                ) : (
                  <circle cx={point.x} cy={point.y} r="2.7" fill="#000" />
                )}
                {point.overlapCount > 1 && point.overlapIndex === 0 && (
                  <text x={point.x} y={point.y - 17} textAnchor="middle" fontSize="11" fill="#000" aria-hidden="true">
                    ×{point.overlapCount}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption>
        {chart.points.length} {chart.points.length === 1 ? "reading" : "readings"}. Dots: exact readings. Lines: visual guides only.
        {hasBounds && " < / > arrows: reported limits, not exact values; lines stop at these limits."}
        {chart.hasSameDayReadings && " Same-day readings are not joined and may overlap."}
        {hasCoincidentReadings && " ×n marks identical readings at the same position."}
      </figcaption>
    </figure>
  );
}
