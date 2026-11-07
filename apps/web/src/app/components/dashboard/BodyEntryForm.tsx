import { Field } from "@base-ui/react/field";
import { BODY_FIELDS, type BodyEntryErrors, type BodyField, FITNESS_FIELDS, type GlucoseContext, validateBodyEntry } from "@bt/shared/core/body";
import { todayIso } from "@bt/shared/core/dates";
import { listUnits } from "@bt/shared/core/units";
import { type FormEvent, useState } from "react";
import { addMeasurements } from "../../../db/db";
import { displayUnitFor } from "../../format";
import { useDisplayUnits } from "../../hooks";
import { BIOMARKER_MAP } from "../../knowledge";
import { href } from "../../router";
import { ChoiceGroup } from "../ChoiceGroup";
import { More } from "../disclosure";
import { UnitSelect } from "../UnitSelect";
import { Button, cx, errorStyles, labelStyles as formLabel, inputStyles } from "../ui";

const FIELD_LABEL: Record<BodyField, string> = {
  weight: "Weight",
  waist: "Waist",
  body_fat: "Body fat",
  bp_systolic: "Top number (systolic)",
  bp_diastolic: "Bottom number (diastolic)",
  resting_hr: "Resting pulse",
  heart_rate: "Heart rate, day average",
  exercise_hr: "Heart rate during exercise",
  hrv: "HRV",
  hrv_resting: "Resting HRV (overnight)",
  spo2: "Blood oxygen (SpO₂)",
  glucose_home: "Blood glucose",
  sleep_duration: "Sleep last night",
  sleep_deep: "Deep sleep",
  sleep_rem: "REM sleep",
  vo2max: "VO₂max",
  steps: "Steps that day",
  active_minutes: "Active minutes (moderate or harder)",
  pushups: "Push-ups",
  grip_strength: "Grip strength",
  sit_to_stand_5x: "Five chair rises",
  chair_stand_30s: "Chair stands in 30 s",
  one_leg_stand: "One-leg stand (right leg)",
  gait_speed: "Walking speed",
  sitting_rising: "Sit-and-rise score",
};

/** One day's measurements. Every field is optional; empty ones are skipped. */
export function BodyEntryForm({ onDone, cancel = true }: { onDone: (saved: number) => void; cancel?: boolean }) {
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
      {
        date,
        values: Object.fromEntries(BODY_FIELDS.map((f) => [f, { value: values[f] ?? "", unit: units[f] }])),
        ...(glucoseContext ? { glucoseContext } : {}),
      },
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
              <UnitSelect
                compact
                labelClassName="sr-only"
                label={`${FIELD_LABEL[f]} unit`}
                units={listUnits(def)}
                value={units[f]}
                onChange={(u) => setUnits((s) => ({ ...s, [f]: u }))}
              />
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
      <More summary="Heart rate, HRV, blood oxygen, sleep and activity (usually from a watch or ring)" boxed panelClassName="border-t border-line p-3">
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {field("heart_rate", { suffix: "bpm" })}
          {field("exercise_hr", { suffix: "bpm" })}
          {field("spo2", { suffix: "%" })}
          {field("hrv", { suffix: "ms" })}
          {field("hrv_resting", { suffix: "ms" })}
          {field("vo2max", { suffix: "mL/kg/min" })}
        </div>
        <p className="mt-4 mb-1 font-medium">Sleep</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("sleep_duration", { unitPick: true })}
          {field("sleep_deep", { unitPick: true })}
          {field("sleep_rem", { unitPick: true })}
        </div>
        <p className="mt-4 mb-1 font-medium">Activity</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("steps", { suffix: "steps" })}
          {field("active_minutes", { suffix: "minutes" })}
        </div>
        <p className="mt-3 text-sm text-ink-2">For a whole day that's over. Active minutes are brisk walking or harder; light activity doesn't count.</p>
        <p className="mt-3 text-sm text-ink-2">HRV here is RMSSD, as most rings and Android watches show it. Apple Watch shows SDNN, a different measure.</p>
      </More>
      <More summary="Strength, balance and walking tests" boxed panelClassName="border-t border-line p-3">
        <p className="mt-2 text-sm text-ink-2">
          Do each test the way its page describes, so your result can be compared with people of your age. Stop if anything hurts, and have someone nearby for
          the balance tests.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {field("pushups", { suffix: "push-ups" })}
          {field("grip_strength", { unitPick: true })}
          {field("sit_to_stand_5x", { suffix: "seconds" })}
          {field("chair_stand_30s", { suffix: "stands" })}
          {field("one_leg_stand", { suffix: "seconds" })}
          {field("gait_speed", { suffix: "m/s" })}
          {field("sitting_rising", { suffix: "of 10" })}
        </div>
        <p className="mt-3 text-sm text-ink-2">
          How to do them:{" "}
          {FITNESS_FIELDS.map((f, i) => (
            <span key={f}>
              {i > 0 && " · "}
              <a href={href({ name: "marker", id: f, section: "for-your-age" })}>{FIELD_LABEL[f].replace(" (right leg)", "")}</a>
            </span>
          ))}
          . Walking speed: 4 metres divided by the seconds it took.
        </p>
      </More>
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
        <p className="text-sm text-ink-2">
          Fasting means nothing to eat for 8 hours, usually first thing in the morning. "After a meal" is about 2 hours after you started eating.
        </p>
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
        {cancel && (
          <Button variant="quiet" onClick={() => onDone(0)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
