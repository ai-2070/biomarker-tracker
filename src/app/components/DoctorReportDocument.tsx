import { groupDoctorReportSeries, type DoctorReport, type DoctorReportSeries } from "../../core/doctorReport";
import type { Measurement } from "../../core/types";
import { formatValue } from "../../core/units";
import { BODY_GROUPS } from "../../core/body";
import { CATEGORY_LABEL, displayUnitFor, FLAG_LABEL, formatDate, showMeasurement, showRange, valueUnit } from "../format";
import { TIME_LABEL, whenExtras } from "./PlanWhen";
import { DoctorReportChart } from "./DoctorReportChart";
import { REPO_URL } from "./settings/AboutSettings";
import reportGithubQr from "../assets/report-github-qr.svg?inline";

const SOURCE_LABEL: Record<Measurement["source"], string> = {
  manual: "Entered manually", pdf: "PDF import", csv: "CSV import", photo: "Photo / scan (OCR)", device: "Device export",
};

function readingText(series: Pick<DoctorReportSeries, "def">, reading: Measurement, unit: string) {
  return [showMeasurement(series.def, reading, unit), valueUnit(series.def, unit)].filter(Boolean).join(" ");
}

/** Receives only the report builder's sanitized snapshot, never live profile data. */
export function DoctorReportDocument({ report, units }: { report: DoctorReport; units: Record<string, string> }) {
  const profile = report.profile;
  const profileWeightUnit = report.profileWeight ? displayUnitFor(report.profileWeight.def, units[report.profileWeight.def.id]) : "";
  const bmiText = report.profileBmi !== undefined ? `${formatValue(report.profileBmi)} kg/m²` : "Not calculated: needs an exact weight and valid height.";
  const rmrText = report.profileRmr ? `${Math.round(report.profileRmr.terms.total).toLocaleString()} kcal/day (estimate)` : "Not calculated: needs an exact weight, valid height, adult age and sex.";
  const grouped = groupDoctorReportSeries(report.series);
  const bloodSections = grouped.blood.length ? [{ id: "blood", title: null, series: grouped.blood }] : [];
  const bodySummaries = profile && report.profileWeight && !grouped.body.some((group) => group.id === "size")
    ? [{ id: "size", title: BODY_GROUPS.find((group) => group.id === "size")!.title, series: [] }, ...grouped.body]
    : grouped.body;
  const summaryGroups = [
    { label: "Blood tests", column: "Blood test", sections: bloodSections, summaries: bloodSections },
    { label: "Body measurements", column: "Body measurement", sections: grouped.body, summaries: bodySummaries },
  ];
  return (
    <article className="doctor-report-document" aria-label="Health report for a doctor">
      <table className="doctor-report-page-layout" role="presentation">
        <thead><tr><td>
      <header className="doctor-report-running">
        <span>{report.example && <strong>Fictional example data · </strong>}{profile?.name || "Health report"}</span>
        <span>Generated {formatDate(report.generatedOn)}</span>
      </header>
        </td></tr></thead>
        <tbody><tr><td>
      <header className="doctor-report-heading">
        <div>
          <h1>Health report for your doctor</h1>
          <p>Selected period: <strong>{formatDate(report.from)} – {formatDate(report.to)}</strong> (inclusive)</p>
          <p>Generated {formatDate(report.generatedOn)}</p>
        </div>
        <a className="doctor-report-brand" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Biomarker Tracker source code on GitHub">
          <span className="doctor-report-brand-name"><img src="./favicon.svg" alt="" width={22} height={22} />Biomarker Tracker</span>
          <img src={reportGithubQr} alt="QR code to the Biomarker Tracker GitHub repository" width={104} height={104} />
          <span>Source code on GitHub</span>
        </a>
      </header>
      {report.example && <p className="doctor-report-warning"><strong>FICTIONAL EXAMPLE — NOT A REAL PATIENT.</strong> Every result in this example profile is made up.</p>}
      <p className="doctor-report-provenance">Patient-entered or imported information, not verified laboratory reports. Check against original reports and the person's current medicines. Not medical advice. Not a medical device. Observed changes do not prove that a habit or treatment caused them.</p>

      {profile && <section>
        <h2>Profile information</h2>
        <dl className="doctor-report-demographics">
          {profile.name && <><dt>Name</dt><dd>{profile.name}</dd></>}
          {report.age !== undefined && <><dt>Approximate age</dt><dd>{report.age} years (from birth month)</dd></>}
          {profile.birthMonth && <><dt>Birth month</dt><dd>{profile.birthMonth}</dd></>}
          {profile.sex && <><dt>Sex used for ranges</dt><dd>{profile.sex === "m" ? "Male" : "Female"}</dd></>}
          {profile.heightCm !== undefined && <><dt>Height</dt><dd>{profile.heightCm} cm</dd></>}
          <dt>Latest recorded weight</dt><dd>{report.profileWeight ? <>
            {readingText(report.profileWeight, report.profileWeight.measurement, profileWeightUnit)}
            <span className="doctor-report-secondary">{formatDate(report.profileWeight.measurement.date)} · {SOURCE_LABEL[report.profileWeight.measurement.source]} · latest on or before report end</span>
            {report.includeNotes && report.profileWeight.measurement.note && <span className="doctor-report-secondary doctor-report-text">{report.profileWeight.measurement.note}</span>}
          </> : "Not recorded on or before the report end"}</dd>
          <dt>BMI</dt><dd>{bmiText}</dd>
          <dt>Resting metabolic rate</dt><dd>{rmrText}{report.profileRmr && <span className="doctor-report-secondary">Mifflin–St Jeor; calculation and limits under Size and composition.</span>}</dd>
          {profile.smoking && <><dt>Smoking</dt><dd>{({ never: "Never smoked", former: "Former smoker", current: "Current smoker" })[profile.smoking]}</dd></>}
          {profile.diet && <><dt>Diet</dt><dd>{profile.diet}</dd></>}
          <dt>Conditions as recorded</dt><dd>{profile.conditions || "Not recorded"}</dd>
          <dt>Allergies as recorded</dt><dd>{profile.allergies || "Not recorded"}</dd>
          {report.includeNotes && profile.notes && <><dt>Profile notes</dt><dd className="doctor-report-text">{profile.notes}</dd></>}
        </dl>
      </section>}

      <section>
        <h2>Selected measurements</h2>
        <p>The latest reading for each selected measurement within the report period. Reference ranges belong to that reading; they are not a diagnosis. When profile details are included, calculated body figures appear under Size and composition.</p>
        {report.series.length === 0 && <p>No readings match the selected markers and period. This does not mean results are normal.</p>}
        {summaryGroups.map((group) => group.summaries.length > 0 && <section className="doctor-report-summary-group" aria-label={group.label} key={group.label}>
          <h3>{group.label}</h3>
          {group.summaries.map((section) => <div key={section.id}>
            {section.title && <h4>{section.title}</h4>}
            {section.series.length > 0 && <div className="doctor-report-table-wrap"><table>
              <caption className="sr-only">{group.label}{section.title ? `: ${section.title}` : ""}: latest readings within the selected period</caption>
              <thead><tr><th scope="col">{group.column}</th><th scope="col">Latest result</th><th scope="col">Date</th><th scope="col">Reference range</th><th scope="col">Flag</th></tr></thead>
              <tbody>{section.series.map((series) => {
                const unit = displayUnitFor(series.def, units[series.def.id]);
                return <tr key={series.def.id}>
                  <th scope="row">{series.def.name}{series.def.category !== "Body" && <span className="doctor-report-secondary">{series.def.category}</span>}</th>
                  <td>{readingText(series, series.latest, unit)}</td>
                  <td>{formatDate(series.latest.date)}</td>
                  <td>{series.def.judgeSumOfDays ? "Weekly reference only; no daily comparison" : showRange(series.def, series.latestRange, unit) || "Not available"}{series.latestRange && <span className="doctor-report-secondary">{series.latestRange.comparisonOnly ? "Population comparison only; not clinical limits" : ({ lab: "Laboratory", default: "General reference", personal: "Personal usual range" })[series.latestRange.source]}</span>}</td>
                  <td>{series.latestFlag === "unknown" ? "Not assessed" : FLAG_LABEL[series.latestFlag]}</td>
                </tr>;
              })}</tbody>
            </table></div>}
            {section.id === "size" && profile && <div className="doctor-report-calculations">
              <p className="doctor-report-small">Calculated figures, not separate saved readings.{report.profileWeight && ` Weight recorded ${formatDate(report.profileWeight.measurement.date)}; height and other inputs come from the included profile details.`}</p>
              <dl className="doctor-report-demographics" aria-label="Calculated size and composition">
                <dt>BMI</dt><dd>{bmiText}<span className="doctor-report-secondary">From the recorded weight and height; does not distinguish muscle from fat.</span></dd>
                <dt>Resting metabolic rate</dt><dd>{rmrText}{report.profileRmr && report.profileWeight && <>
                  <span className="doctor-report-secondary">Mifflin–St Jeor: 10 × {formatValue(report.profileWeight.measurement.value)} kg + 6.25 × {formatValue(profile.heightCm!)} cm − 5 × {formatValue(report.profileRmr.age)} years {report.profileRmr.terms.sex > 0 ? "+ 5" : "− 161"}.</span>
                  <span className="doctor-report-secondary">Age at the weight reading, approximated from birth month. Often within about 10%, but individual error can be larger. Not a calorie target.{report.profileRmr.terms.outsideStudyAges && " Outside the equation's study ages (19–78)."}</span>
                  <span className="doctor-report-secondary">Mifflin 1990 (PMID 2305711); Frankenfield 2005 (PMID 15883556).</span>
                </>}</dd>
              </dl>
            </div>}
          </div>)}
        </section>)}
        <p className="doctor-report-small">Flags reflect the app's available clinical reference ranges, not a diagnosis. “Not assessed” is not a normal result: a range may be unavailable or for population comparison only, the reading may be bounded, or the marker may need several days of readings.</p>
      </section>

      <section>
        <h2>Reading details</h2>
        <p>Every selected reading within the report period is shown, without averaging. Charts are black and white; no value-by-value tables are included. The summary's reference ranges apply to the latest reading, and older laboratory ranges may differ.</p>
        {report.series.length === 0 && <p>No readings are available to chart for this selection.</p>}
        {summaryGroups.map((group) => group.sections.length > 0 && <section className="doctor-report-chart-group" aria-label={`${group.label} history`} key={group.label}>
          <h3>{group.label}</h3>
          {group.sections.map((section) => <div key={section.id}>
            {section.title && <h4>{section.title}</h4>}
            {section.series.map((series) => {
              const unit = displayUnitFor(series.def, units[series.def.id]);
              const MarkerHeading = section.title ? "h5" : "h4";
              const context = (measurement: Measurement) => [
                SOURCE_LABEL[measurement.source], `Lab: ${measurement.lab || "Not recorded"}`,
                `Fasting: ${measurement.fasted === undefined ? "Not recorded" : measurement.fasted ? "Yes" : "No"}`,
              ].join(" · ");
              const latestContext = context(series.latest);
              const otherContexts = new Set(series.history.map(({ measurement }) => context(measurement)));
              otherContexts.delete(latestContext);
              const notes = report.includeNotes ? series.history.filter(({ measurement }) => measurement.note) : [];
              return <div className="doctor-report-history" key={series.def.id}>
                <MarkerHeading>{series.def.name}</MarkerHeading>
                <DoctorReportChart series={series} unit={unit} from={report.from} to={report.to} />
                <p className="doctor-report-small">Latest reading context: {latestContext}</p>
                {otherContexts.size > 0 && <p className="doctor-report-small">Other recorded contexts: {[...otherContexts].join("; ")}. Conditions differ between readings; compare like with like.</p>}
                {notes.length > 0 && <div className="doctor-report-small"><strong>Included notes</strong><ul className="doctor-report-notes">{notes.map(({ measurement }) => <li className="doctor-report-text" key={measurement.id}>{formatDate(measurement.date)}: {measurement.note}</li>)}</ul></div>}
              </div>;
            })}
          </div>)}
        </section>)}
      </section>

      <section>
        <h2>Logged medicines, supplements and habits</h2>
        {!report.includeLog ? <p>The habit log was not included in this report.</p> : <>
          <p>Entries overlapping the selected period, with their original dates. Amounts and schedules are as recorded by the person, not instructions from the app. An entry with no recorded end is not confirmation it is still being taken.</p>
          {report.logs.length === 0 && <p>No overlapping log entries were recorded. This is not confirmation that no medicines or supplements are used.</p>}
          {report.logs.map((entry) => <div className="doctor-report-log" key={entry.id}>
            <h3>{entry.label}</h3>
            <p>{CATEGORY_LABEL[entry.category]} · Started {formatDate(entry.start)} · {entry.end ? `Ended ${formatDate(entry.end)}` : "No end recorded"}</p>
            {entry.plan && <div className="doctor-report-table-wrap"><table>
              <caption>Protocol item snapshot when this log entry was started</caption>
              <thead><tr><th scope="col">Item · {entry.label}</th><th scope="col">Type</th><th scope="col">Own amount</th><th scope="col">Schedule</th>{report.includeNotes && <th scope="col">Notes</th>}</tr></thead>
              <tbody>{entry.plan.items.map((item) => <tr key={item.id}>
                <th scope="row">{item.label}</th><td>{CATEGORY_LABEL[item.category]}</td><td>{item.amount || "Not recorded"}</td>
                <td>{TIME_LABEL[item.when]}<span className="doctor-report-secondary">{whenExtras(item) || "Every day"}</span>{whenExtras(item) && !item.days?.length && <span className="doctor-report-secondary">Every day</span>}</td>
                {report.includeNotes && <td className="doctor-report-text">{item.note || "—"}</td>}
              </tr>)}</tbody>
            </table></div>}
          </div>)}
        </>}
      </section>
      <p className="doctor-report-provenance">This report contains only the selected data and may be incomplete. Profile details, when included, also use the most recent weight on or before the report end. Missing information is not a negative finding. Bring original laboratory reports and a current medicine and supplement list to the appointment. No AI interpretation or combined health score was generated. BMI and resting metabolic rate use the app's calculations.</p>
        </td></tr></tbody>
      </table>
    </article>
  );
}

/** Mounted only while a report preview / direct-body print portal exists. */
export const DOCTOR_REPORT_PRINT_CSS = `
.doctor-report-print { display: none; }
.doctor-report-document .doctor-report-running { display: none; }
.doctor-report-document { color: #12161b; background: #fff; font-family: var(--font-sans, Arial, sans-serif); font-size: 14px; line-height: 1.5; padding: 28px; overflow-wrap: anywhere; color-scheme: light; }
.doctor-report-document *, .doctor-report-document *::before, .doctor-report-document *::after { box-sizing: border-box; }
.doctor-report-document h1 { font-family: var(--font-serif, Georgia, serif); font-size: 32px; font-weight: 400; line-height: 1.15; margin: 0 0 16px; }
.doctor-report-document h2 { font-size: 19px; font-weight: 650; line-height: 1.3; margin: 30px 0 10px; }
.doctor-report-document h3 { font-size: 15px; font-weight: 650; margin: 20px 0 6px; }
.doctor-report-document h4 { font-size: 15px; font-weight: 650; margin: 18px 0 6px; }
.doctor-report-document h5 { font-size: 14px; font-weight: 600; margin: 16px 0 6px; }
.doctor-report-document p { margin: 6px 0 12px; max-width: 75ch; }
.doctor-report-document .doctor-report-heading { display: grid; grid-template-columns: minmax(0, 1fr) 160px; gap: 18px; align-items: start; border-bottom: 1px solid #69707a; padding-bottom: 12px; margin-bottom: 18px; }
.doctor-report-document .doctor-report-heading p { margin: 4px 0; }
.doctor-report-document .doctor-report-brand { display: flex; flex-direction: column; align-items: center; gap: 6px; color: inherit; text-decoration: none; font-size: 11px; break-inside: avoid; }
.doctor-report-document .doctor-report-brand-name { display: flex; align-items: center; gap: 6px; font-family: var(--font-serif, Georgia, serif); font-size: 17px; white-space: nowrap; }
.doctor-report-document .doctor-report-brand-name img { filter: grayscale(1); }
.doctor-report-document .doctor-report-warning { border: 2px solid #12161b; padding: 12px; max-width: none; }
.doctor-report-document .doctor-report-provenance, .doctor-report-document .doctor-report-small { font-size: 12px; color: #454b54; }
.doctor-report-document .doctor-report-demographics { display: grid; grid-template-columns: minmax(100px, 160px) minmax(0, 1fr); gap: 5px 16px; margin: 10px 0; }
.doctor-report-document dt { font-weight: 600; }
.doctor-report-document dd { margin: 0; }
.doctor-report-document .doctor-report-table-wrap { overflow-x: auto; margin: 12px 0; }
.doctor-report-document table { border-collapse: collapse; width: 100%; font-size: 12px; font-variant-numeric: tabular-nums; line-height: 1.4; }
.doctor-report-document .doctor-report-page-layout { font: inherit; table-layout: fixed; min-width: 0; }
.doctor-report-document .doctor-report-page-layout > thead { display: none; }
.doctor-report-document .doctor-report-page-layout > :is(thead, tbody) > tr > td { padding: 0; border: 0; }
.doctor-report-document .doctor-report-page-layout > tbody > tr { break-inside: auto; page-break-inside: auto; }
.doctor-report-document caption { text-align: left; font-weight: 600; padding-bottom: 8px; }
.doctor-report-document th, .doctor-report-document td { text-align: left; vertical-align: top; padding: 9px 7px; border-bottom: 1px solid #cfd4da; overflow-wrap: anywhere; }
.doctor-report-document thead th { border-top: 1px solid #69707a; border-bottom: 1px solid #69707a; font-weight: 650; }
.doctor-report-document tbody th { font-weight: 600; }
.doctor-report-document .doctor-report-secondary { display: block; color: #454b54; font-size: 11px; margin-top: 3px; }
.doctor-report-document .doctor-report-text { white-space: pre-wrap; }
.doctor-report-document .doctor-report-chart { margin: 8px 0; }
.doctor-report-document .doctor-report-notes { margin: 6px 0 12px; padding-left: 0; list-style: none; }
.doctor-report-document .doctor-report-notes li { margin: 3px 0; }
.doctor-report-document ::selection { background: #dcece6; color: #12161b; }
@media screen and (max-width: 640px) {
  .doctor-report-document { padding: 16px; }
  .doctor-report-document .doctor-report-heading { grid-template-columns: minmax(0, 1fr); }
  .doctor-report-document .doctor-report-brand { grid-row: 1; justify-self: end; }
  .doctor-report-document table { min-width: 620px; }
}
@media print {
  @page { size: A4; margin: 15mm 12mm; }
  html, body { background: #fff !important; color: #000 !important; color-scheme: light; }
  body > :not(.doctor-report-print) { display: none !important; }
  .doctor-report-print { display: block !important; color: #000 !important; background: #fff !important; }
  .doctor-report-print .doctor-report-document { padding: 0; font-size: 10pt; color: #000; background: #fff; }
  .doctor-report-print .doctor-report-document .doctor-report-page-layout { font: inherit; }
  .doctor-report-print .doctor-report-page-layout > thead { display: table-header-group; }
  .doctor-report-print .doctor-report-running { display: flex; justify-content: space-between; gap: 4mm; border-bottom: 1px solid #69707a; padding-bottom: 2mm; margin-bottom: 5mm; font-size: 8pt; line-height: 1.3; }
  .doctor-report-print .doctor-report-running > span:first-child { min-width: 0; white-space: normal; }
  .doctor-report-print .doctor-report-running > span:last-child { flex-shrink: 0; white-space: nowrap; }
  .doctor-report-print .doctor-report-document h1 { font-size: 24pt; }
  .doctor-report-print .doctor-report-document h2 { font-size: 14pt; }
  .doctor-report-print .doctor-report-document h3 { font-size: 11pt; }
  .doctor-report-print .doctor-report-document h4, .doctor-report-print .doctor-report-document h5 { font-size: 10pt; break-after: avoid; page-break-after: avoid; }
  .doctor-report-print .doctor-report-document table { font-size: 8pt; width: 100%; min-width: 0; }
  .doctor-report-print .doctor-report-table-wrap { overflow: visible; }
  .doctor-report-print .doctor-report-document thead { display: table-header-group; }
  .doctor-report-print .doctor-report-document tr { break-inside: avoid; page-break-inside: avoid; }
  .doctor-report-print .doctor-report-document th, .doctor-report-print .doctor-report-document td { padding: 6px 4px; }
  .doctor-report-print .doctor-report-document h1, .doctor-report-print .doctor-report-document h2, .doctor-report-print .doctor-report-document h3, .doctor-report-print .doctor-report-document caption { break-after: avoid; page-break-after: avoid; }
  .doctor-report-print .doctor-report-log { break-inside: avoid; page-break-inside: avoid; }
  .doctor-report-print .doctor-report-history, .doctor-report-print .doctor-report-chart, .doctor-report-print .doctor-report-calculations { break-inside: avoid; page-break-inside: avoid; }
  .doctor-report-print .doctor-report-chart-viewport { overflow: visible; min-width: 0; }
  .doctor-report-print .doctor-report-chart svg { display: block; width: 100%; height: auto; min-width: 0; max-width: 100%; }
  .doctor-report-print .doctor-report-document p { orphans: 3; widows: 3; }
  .doctor-report-print .doctor-report-secondary, .doctor-report-print .doctor-report-provenance, .doctor-report-print .doctor-report-small { color: #333; font-size: 8pt; }
}
`;
