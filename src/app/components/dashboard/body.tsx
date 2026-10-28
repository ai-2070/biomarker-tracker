import { useState, type FormEvent } from "react";
import { Field } from "@base-ui/react/field";
import { BODY_FIELDS, bmi, bmiBand, bmrMifflin, latestBloodPressure, latestBody, validateBodyEntry, waistToHeight, type BodyEntryErrors, type BodyField, type GlucoseContext } from "../../../core/body";
import { ageAt } from "../../../core/phenoageDraws";
import { ChoiceGroup } from "../ChoiceGroup";
import { todayIso } from "../../../core/dates";
import type { DashboardMarker } from "../../../core/dashboard";
import { flagMeasurement, sortByDate } from "../../../core/trends";
import type { Measurement, Profile } from "../../../core/types";
import { listUnits } from "../../../core/units";
import { addMeasurements } from "../../../db/db";
import { displayUnitFor, formatDate, showChange, showMeasurement } from "../../format";
import { useDisplayUnits } from "../../hooks";
import { BIOMARKER_MAP, shortName } from "../../knowledge";
import { href } from "../../router";
import { UnitSelect } from "../UnitSelect";
import { Button, FlagBadge, cx, errorStyles, inputStyles, labelStyles as formLabel } from "../ui";
import { Sparkline } from "./Sparkline";
import { Figure } from "./widgets";

const BMI_TEXT = { under: "Below the usual adult range (18.5–25)", healthy: "Within the usual adult range (18.5–25)", over: "Above the usual adult range (18.5–25)", obesity: "Well above the usual adult range (18.5–25)" } as const;

const big = "font-serif text-4xl leading-none tabular-nums sm:text-5xl";

function useUnit(id: BodyField): string {
  const units = useDisplayUnits();
  return displayUnitFor(BIOMARKER_MAP.get(id)!, units[id]);
}

/** Change from the reading about 3 months back (or the first one), in the person's unit. */
function sinceEarlier(series: Measurement[], id: BodyField, unit: string): string | undefined {
  const last = series.at(-1);
  if (!last || series.length < 2) return undefined;
  const cutoff = new Date(Date.parse(last.date) - 90 * 86_400_000).toISOString().slice(0, 10);
  const base = [...series].reverse().find((m) => m.date <= cutoff) ?? series[0]!;
  if (base === last) return undefined;
  return `${showChange(BIOMARKER_MAP.get(id)!, last.value - base.value, unit)} since ${formatDate(base.date)}`;
}

export function WeightFigure({ ms, className }: { ms: Measurement[]; className?: string }) {
  const unit = useUnit("weight");
  const series = sortByDate(ms.filter((m) => m.biomarkerId === "weight"));
  const last = series.at(-1);
  const def = BIOMARKER_MAP.get("weight")!;
  return (
    <Figure label="Weight" href={href({ name: "marker", id: "weight" })} className={className} foot={last ? (sinceEarlier(series, "weight", unit) ?? formatDate(last.date)) : "Not measured yet"}>
      {last ? (
        <p className="flex items-baseline gap-1.5">
          <span className={big}>{showMeasurement(def, last, unit)}</span>
          <span className="text-ink-2">{unit}</span>
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

export function BmiFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const w = latestBody(ms).weight;
  const b = w ? bmi(w.value, profile.heightCm) : undefined;
  return (
    <Figure
      label="BMI"
      href={href({ name: "marker", id: "weight" })}
      className={className}
      foot={b === undefined ? (profile.heightCm ? "Add your weight to see it." : "Add your height in Settings → Your data.") : `${BMI_TEXT[bmiBand(b)]}. A rough guide: it can't tell muscle from fat.`}
    >
      <p className={cx(big, b === undefined && "text-ink-2")}>{b === undefined ? "–" : b.toFixed(1)}</p>
    </Figure>
  );
}

/** Basal metabolic rate, from the latest weight, height, age and sex. Shown as an estimate, never as a target. */
export function BmrFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const w = latestBody(ms).weight;
  const age = w && profile.birthMonth ? ageAt(profile.birthMonth, w.date) : undefined;
  const value = w ? bmrMifflin(w.value, profile.heightCm, age, profile.sex) : undefined;
  const missing = [!w && "weight", !profile.heightCm && "height", !profile.birthMonth && "month of birth", !profile.sex && "sex"].filter(Boolean) as string[];
  return (
    <Figure
      label="Basal metabolic rate"
      href={href({ name: "marker", id: "weight" })}
      className={className}
      foot={
        value === undefined
          ? missing.length
            ? `Needs your ${missing.join(", ")} (Settings → Your data).`
            : "For adults only."
          : "Energy your body uses at complete rest, estimated from weight, height, age and sex (Mifflin–St Jeor, about ±10 %). Not a target."
      }
    >
      {value === undefined ? (
        <p className="font-serif text-4xl text-ink-2">–</p>
      ) : (
        <p className="flex items-baseline gap-1.5">
          <span className={big}>{Math.round(value).toLocaleString("en-GB")}</span>
          <span className="text-ink-2">kcal a day</span>
        </p>
      )}
    </Figure>
  );
}

const GLUCOSE_WHEN = (m: Measurement) => (m.fasted === true ? "fasting" : m.fasted === false ? "after a meal" : "time not given");

export function GlucoseFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const unit = useUnit("glucose_home");
  const def = BIOMARKER_MAP.get("glucose_home")!;
  const last = latestBody(ms).glucose_home;
  const flag = last ? flagMeasurement(def, last, profile) : undefined;
  return (
    <Figure label="Blood glucose (home)" href={href({ name: "marker", id: "glucose_home" })} className={className} foot={last ? `${GLUCOSE_WHEN(last)}, ${formatDate(last.date)}` : "Not measured yet"}>
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className={cx(big, flag?.startsWith("critical") && "text-danger")}>{showMeasurement(def, last, unit)}</span>
          <span className="text-ink-2">{unit}</span>
          {flag && flag !== "normal" && flag !== "unknown" && <FlagBadge flag={flag} />}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

export function WaistFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const unit = useUnit("waist");
  const last = latestBody(ms).waist;
  const def = BIOMARKER_MAP.get("waist")!;
  const ratio = last ? waistToHeight(last.value, profile.heightCm) : undefined;
  const flag = last ? flagMeasurement(def, last, profile) : undefined;
  return (
    <Figure
      label="Waist"
      href={href({ name: "marker", id: "waist" })}
      className={className}
      foot={!last ? "Not measured yet" : ratio !== undefined ? `${ratio.toFixed(2)} of your height (the usual guide is below 0.5)` : formatDate(last.date)}
    >
      {last ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className={big}>{showMeasurement(def, last, unit)}</span>
          <span className="text-ink-2">{unit}</span>
          {flag && flag !== "normal" && flag !== "unknown" && <FlagBadge flag={flag} />}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

export function BloodPressureFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const bp = latestBloodPressure(ms);
  const sysDef = BIOMARKER_MAP.get("bp_systolic")!;
  const diaDef = BIOMARKER_MAP.get("bp_diastolic")!;
  const flags = bp ? [flagMeasurement(sysDef, bp.systolic, profile), flagMeasurement(diaDef, bp.diastolic, profile)] : [];
  const worst = flags.find((f) => f.startsWith("critical")) ?? flags.find((f) => f !== "normal" && f !== "unknown");
  return (
    <Figure label="Blood pressure" href={href({ name: "marker", id: "bp_systolic" })} className={className} foot={bp ? formatDate(bp.systolic.date) : "Not measured yet"}>
      {bp ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2">
          <span className={cx(big, worst?.startsWith("critical") && "text-danger")}>
            {Math.round(bp.systolic.value)}/{Math.round(bp.diastolic.value)}
          </span>
          <span className="text-ink-2">mmHg</span>
          {worst && <FlagBadge flag={worst} />}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

export function RestingHrFigure({ ms, className }: { ms: Measurement[]; className?: string }) {
  const series = sortByDate(ms.filter((m) => m.biomarkerId === "resting_hr"));
  const last = series.at(-1);
  return (
    <Figure label="Resting heart rate" href={href({ name: "marker", id: "resting_hr" })} className={className} foot={last ? (sinceEarlier(series, "resting_hr", "bpm") ?? formatDate(last.date)) : "Not measured yet"}>
      {last ? (
        <p className="flex items-baseline gap-1.5">
          <span className={big}>{Math.round(last.value)}</span>
          <span className="text-ink-2">beats a minute</span>
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

/** Body markers in a fixed order: weight, waist, body fat, blood pressure, heart rate. */
export function inBodyOrder(markers: DashboardMarker[]): DashboardMarker[] {
  const order = new Map(BODY_FIELDS.map((f, i) => [f as string, i]));
  return [...markers].sort((a, b) => (order.get(a.def.id) ?? 9) - (order.get(b.def.id) ?? 9));
}

/** One line per body measurement with a small trend line: for the main dashboard. Blood pressure is one row. */
export function BodySummaryList({ markers }: { markers: DashboardMarker[] }) {
  const units = useDisplayUnits();
  const dia = markers.find((m) => m.def.id === "bp_diastolic");
  return (
    <ul className="flex flex-col divide-y divide-line">
      {inBodyOrder(markers.filter((m) => m.def.id !== "bp_diastolic")).map((m) => {
        const bp = m.def.id === "bp_systolic";
        const unit = displayUnitFor(m.def, units[m.def.id]);
        const flag = bp && dia && dia.flag !== "normal" && dia.flag !== "unknown" && (m.flag === "normal" || m.flag === "unknown") ? dia.flag : m.flag;
        const tone = flag.startsWith("critical") ? "danger" : flag === "normal" || flag === "unknown" ? "ok" : "warn";
        return (
          <li key={m.def.id}>
            <a href={href({ name: "marker", id: m.def.id })} className="grid min-h-12 grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-3 py-1.5 text-ink no-underline hover:bg-sunken">
              <span className="truncate text-sm font-medium">{bp ? "Blood pressure" : shortName(m.def)}</span>
              <Sparkline series={m.series.slice(-12)} {...(m.range ? { range: m.range } : {})} tone={tone} />
              <span className="flex items-center justify-end gap-2 text-sm whitespace-nowrap tabular-nums">
                {bp && dia ? `${Math.round(m.latest.value)}/${Math.round(dia.latest.value)}` : showMeasurement(m.def, m.latest, unit)} <span className="text-ink-2">{unit}</span>
                {flag !== "normal" && flag !== "unknown" && <FlagBadge flag={flag} />}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

const FIELD_LABEL: Record<BodyField, string> = {
  weight: "Weight",
  waist: "Waist",
  body_fat: "Body fat",
  bp_systolic: "Top number (systolic)",
  bp_diastolic: "Bottom number (diastolic)",
  resting_hr: "Resting heart rate",
  glucose_home: "Blood glucose",
};

/** One day's measurements. Every field is optional; empty ones are skipped. */
export function BodyEntryForm({ onDone }: { onDone: (saved: number) => void }) {
  const displayUnits = useDisplayUnits();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [values, setValues] = useState<Partial<Record<BodyField, string>>>({});
  const [units, setUnits] = useState<Record<BodyField, string>>(
    () => Object.fromEntries(BODY_FIELDS.map((f) => [f, displayUnitFor(BIOMARKER_MAP.get(f)!, displayUnits[f])])) as Record<BodyField, string>,
  );
  const [glucoseContext, setGlucoseContext] = useState<GlucoseContext | "">("");
  const [errors, setErrors] = useState<BodyEntryErrors>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = validateBodyEntry(
      { date, values: Object.fromEntries(BODY_FIELDS.map((f) => [f, { value: values[f] ?? "", unit: units[f] }])), ...(glucoseContext ? { glucoseContext } : {}) },
      BIOMARKER_MAP,
      today,
    );
    if (!r.ok) return setErrors(r.errors);
    setSaving(true);
    try {
      await addMeasurements(r.measurements);
      onDone(r.measurements.length);
    } finally {
      setSaving(false);
    }
  }

  const field = (f: BodyField, opts: { unitPick?: boolean; suffix?: string } = {}) => {
    const def = BIOMARKER_MAP.get(f)!;
    // The unit picker sits beside the field, not inside it, so each has its own label and id.
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <Field.Root invalid={!!errors[f]} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Field.Label className={formLabel}>{FIELD_LABEL[f]}</Field.Label>
            <Field.Control
              value={values[f] ?? ""}
              onValueChange={(v) => {
                setValues((s) => ({ ...s, [f]: v }));
                setErrors((er) => ({ ...er, [f]: undefined, form: undefined }));
              }}
              inputMode="decimal"
              autoComplete="off"
              className={inputStyles}
            />
          </Field.Root>
          {opts.unitPick ? (
            <div className="shrink-0">
              <UnitSelect compact labelClassName="sr-only" label={`${FIELD_LABEL[f]} unit`} units={listUnits(def)} value={units[f]} onChange={(u) => setUnits((s) => ({ ...s, [f]: u }))} />
            </div>
          ) : (
            <span className="min-h-11 shrink-0 content-center text-ink-2">{opts.suffix ?? def.canonicalUnit}</span>
          )}
        </div>
        {errors[f] && (
          <p role="alert" className={errorStyles}>
            {errors[f]}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field.Root invalid={!!errors.date} className="flex max-w-xs flex-col gap-1.5">
        <Field.Label className={formLabel}>Date</Field.Label>
        <Field.Control type="date" value={date} max={today} onValueChange={setDate} className={inputStyles} />
        <Field.Error match={!!errors.date} className={errorStyles}>
          {errors.date}
        </Field.Error>
      </Field.Root>

      <p className="-mb-2 text-sm text-ink-2">Fill in what you measured; the rest can stay empty.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {field("weight", { unitPick: true })}
        {field("waist", { unitPick: true })}
        {field("body_fat", { suffix: "%" })}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className={cx(formLabel, "mb-1")}>Blood pressure</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("bp_systolic", { suffix: "mmHg" })}
          {field("bp_diastolic", { suffix: "mmHg" })}
          {field("resting_hr", { suffix: "bpm" })}
        </div>
        <p className="text-sm text-ink-2">Sit quietly for 5 minutes first. Many monitors also show your pulse: that's your resting heart rate.</p>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className={cx(formLabel, "mb-1")}>Blood glucose (home meter)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("glucose_home", { unitPick: true })}
          <div className="sm:col-span-2">
            <ChoiceGroup<GlucoseContext | "">
              label="When"
              value={glucoseContext}
              onChange={(v) => {
                setGlucoseContext(v);
                setErrors((er) => ({ ...er, glucoseContext: undefined }));
              }}
              options={[
                { value: "fasting", label: "Fasting" },
                { value: "after-meal", label: "After a meal" },
                { value: "other", label: "Other" },
              ]}
            />
            {errors.glucoseContext && (
              <p role="alert" className={cx(errorStyles, "mt-1")}>
                {errors.glucoseContext}
              </p>
            )}
          </div>
        </div>
        <p className="text-sm text-ink-2">Fasting means nothing to eat for 8 hours, usually first thing in the morning. "After a meal" is about 2 hours after you started eating.</p>
      </fieldset>

      {errors.form && (
        <p role="alert" className={errorStyles}>
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          Save
        </Button>
        <Button variant="quiet" onClick={() => onDone(0)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
