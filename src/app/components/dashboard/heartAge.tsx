import { todayIso } from "../../../core/dates";
import { AGE_RANGE, framinghamRisk, heartAge, heartAgeData, type HeartAgeData } from "../../../core/heartAge";
import type { Measurement, Profile, ProtocolEntry } from "../../../core/types";
import { formatDate, formatYears } from "../../format";
import { href } from "../../router";
import { Card, LinkButton, Notice } from "../ui";
import { Figure } from "./widgets";

const PAPER_URL = "https://pubmed.ncbi.nlm.nih.gov/18212285/";

const big = "font-serif text-4xl leading-none tabular-nums sm:text-5xl";

function difference(heart: number, age: number): string {
  const d = heart - age;
  if (Math.abs(d) < 1) return "About your age";
  return `${formatYears(Math.abs(d))} ${d > 0 ? "older" : "younger"} than your age (${formatYears(age)})`;
}

const SOURCE = { habits: "from your habits", profile: "from your profile", no: "none found in your habits or profile" } as const;

/** Heart age on the Body page: the number, or what's still needed. Opens the full explanation. */
export function HeartAgeFigure({ ms, profile, protocols, className }: { ms: Measurement[]; profile: Profile; protocols: ProtocolEntry[]; className?: string }) {
  const d = heartAgeData(profile, ms, protocols, todayIso());
  const h = d.input && !d.outOfRange ? heartAge(d.input) : undefined;
  return (
    <Figure
      label="Heart age"
      href={`${href({ name: "phenoage" })}`}
      className={className}
      foot={h !== undefined ? `${difference(h, d.input!.age)}. From blood pressure, BMI and smoking (Framingham); an estimate.` : d.outOfRange ? `Only for ages ${AGE_RANGE.min}–${AGE_RANGE.max}.` : `Needs ${d.missing.join(", ")}.`}
    >
      {h !== undefined ? (
        <p className="flex items-baseline gap-1.5">
          <span className={big}>{h > 100 ? "100+" : formatYears(h)}</span>
          <span className="text-ink-2">years</span>
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

/** Heart age with its inputs and limits, for the Biological age page. */
export function HeartAgeSection({ ms, profile, protocols }: { ms: Measurement[]; profile: Profile; protocols: ProtocolEntry[] }) {
  const d = heartAgeData(profile, ms, protocols, todayIso());
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">Heart age</h2>
        <p className="text-ink-2">From blood pressure, weight, height, smoking and diabetes: no blood test needed.</p>
      </div>
      <HeartAgeBody d={d} />
      <div className="flex flex-col gap-2 text-sm text-ink-2">
        <p>
          <span className="font-medium text-ink">What it is: </span>
          the age of someone with normal risk factors (blood pressure 125, BMI 22.5, not smoking, no diabetes) who has the same predicted
          risk of a heart attack, stroke or similar in the next 10 years. It uses the Framingham Heart Study's office-based equation (
          <a href={PAPER_URL} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
            D'Agostino et al., Circulation 2008
          </a>
          ), with BMI in place of cholesterol.
        </p>
        <p>
          <span className="font-medium text-ink">Limits: </span>
          an estimate, not a verdict. It was developed in a mostly white US population aged {AGE_RANGE.min}–{AGE_RANGE.max} without heart
          disease, and can be off for others. It doesn't apply if you already have heart disease. It was built on blood pressure measured
          in a clinic; home readings are usually a little lower, so it may come out slightly young.
        </p>
      </div>
    </Card>
  );
}

function HeartAgeBody({ d }: { d: HeartAgeData }) {
  if (!d.input) {
    return (
      <Notice title="Not enough to calculate it yet">
        <p>It needs {d.missing.join(", ")}.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton variant="secondary" href={href({ name: "data" })}>
            Settings → Your data
          </LinkButton>
          <LinkButton variant="secondary" href={href({ name: "body", add: true })}>
            Add measurements
          </LinkButton>
        </div>
      </Notice>
    );
  }
  if (d.outOfRange) {
    return (
      <Notice title={`Only for ages ${AGE_RANGE.min}–${AGE_RANGE.max}`}>
        The equation was developed for people aged {AGE_RANGE.min} to {AGE_RANGE.max}, so it isn't shown for your age.
      </Notice>
    );
  }
  const i = d.input;
  const h = heartAge(i);
  const risk = framinghamRisk(i);
  const rows: [string, string][] = [
    ["Systolic blood pressure", `${Math.round(i.systolic)} mmHg${d.from.systolicReadings > 1 ? `, average of ${d.from.systolicReadings} readings in the 30 days to ${formatDate(d.from.systolicDate!)}` : `, ${formatDate(d.from.systolicDate!)}`}`],
    ["BMI", `${i.bmi.toFixed(1)}, from your weight on ${formatDate(d.from.bmiDate!)}`],
    ["Smoking", i.smoker ? "Yes" : "No"],
    ["Blood pressure medicine", i.treatedBp ? `Yes (${SOURCE[d.from.treatedBp]})` : `No (${SOURCE.no})`],
    ["Diabetes", i.diabetes ? `Yes (${SOURCE[d.from.diabetes]})` : `No (${SOURCE.no})`],
  ];
  return (
    <>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <p className="flex items-baseline gap-2">
          <span className="font-serif text-6xl leading-none tabular-nums">{h > 100 ? "100+" : formatYears(h)}</span>
          <span className="text-ink-2">years</span>
        </p>
        <p className="text-ink">{difference(h, i.age)}</p>
      </div>
      <p className="text-ink-2">
        Predicted 10-year risk of a heart attack, stroke or similar: about <span className="font-medium text-ink">{(risk * 100).toFixed(risk < 0.1 ? 1 : 0)} %</span>. That is, about{" "}
        {Math.max(1, Math.round(risk * 100))} in 100 people with these numbers had one within 10 years in the study.
      </p>
      {risk >= 0.2 && (
        <Notice tone="warn" title="Worth discussing with your doctor">
          A predicted risk this high is usually discussed with a doctor, who can measure it properly (including cholesterol) and talk through the options.
        </Notice>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-2">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-2">
        Something wrong? Smoking and conditions are in Settings → Your data; medicines in Habits; blood pressure and weight on the Body page.
      </p>
    </>
  );
}
