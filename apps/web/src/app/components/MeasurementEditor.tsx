import { useId, useRef, useState, type FormEvent } from "react";
import { Field } from "@base-ui/react/field";
import { todayIso } from "@bt/shared/core/dates";
import { validateManualEntry, type ManualEntryField, type ManualEntryInput } from "@bt/shared/core/importers/manual";
import type { Measurement } from "@bt/shared/core/types";
import { fromCanonical, listUnits, matchUnit } from "@bt/shared/core/units";
import { updateMeasurement } from "../../db/db";
import { BIOMARKER_MAP } from "../knowledge";
import { BiomarkerPicker } from "./BiomarkerPicker";
import { ChoiceGroup } from "./ChoiceGroup";
import { UnitSelect } from "./UnitSelect";
import { Button, Notice, errorStyles, helpStyles, inputStyles, labelStyles } from "./ui";

type Fasted = "yes" | "no" | "unknown";

function initialInput(measurement: Measurement): ManualEntryInput {
  const def = BIOMARKER_MAP.get(measurement.biomarkerId);
  const originalUnit = def ? matchUnit(def, measurement.originalUnit) : undefined;
  const unit = originalUnit ?? def?.canonicalUnit ?? measurement.originalUnit;
  const value = originalUnit ? measurement.originalValue : measurement.value;
  return {
    biomarkerId: measurement.biomarkerId,
    value: `${measurement.qualifier ?? ""}${value}`,
    unit,
    date: measurement.date,
    labLow: measurement.labRange?.low === undefined ? "" : (def ? fromCanonical(def, measurement.labRange.low, unit) : measurement.labRange.low).toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 15 }),
    labHigh: measurement.labRange?.high === undefined ? "" : (def ? fromCanonical(def, measurement.labRange.high, unit) : measurement.labRange.high).toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 15 }),
    fasted: measurement.fasted,
    lab: measurement.lab ?? "",
    note: measurement.note ?? "",
  };
}

/** Edits a saved reading in place; its original import/source provenance is retained. */
export function MeasurementEditor({ measurement, onSaved, onCancel }: {
  measurement: Measurement;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState(() => initialInput(measurement));
  const [errors, setErrors] = useState<Partial<Record<ManualEntryField, string>>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const headingId = useId();
  const resultHelpId = useId();
  const unitErrorId = useId();
  const today = todayIso();
  const def = BIOMARKER_MAP.get(input.biomarkerId);
  const fasted: Fasted = input.fasted === undefined ? "unknown" : input.fasted ? "yes" : "no";

  function change(patch: Partial<ManualEntryInput>) {
    if (savingRef.current) return;
    setInput((current) => ({ ...current, ...patch }));
    // A warning is acknowledged only for the exact fields the person checked.
    setWarnings([]);
    setErrors({});
    setSaveError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    const result = validateManualEntry(input, BIOMARKER_MAP, todayIso(), measurement.source);
    if (!result.ok) {
      setErrors({
        ...result.errors,
        ...(result.errors.date === "Enter the date the blood sample was taken."
          ? { date: "Enter a valid measurement date." }
          : {}),
      });
      setWarnings([]);
      return;
    }
    setErrors({});
    setSaveError("");
    if (result.warnings.length > 0 && warnings.length === 0) {
      setWarnings(result.warnings);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await updateMeasurement(measurement.id, result.measurement);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "The changes could not be saved. Your edits are still here. Try saving again, or cancel to leave the saved result unchanged.");
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={headingId} aria-busy={saving} className="min-w-0">
      <h3 id={headingId} className="mb-4 text-lg font-semibold">Edit measurement</h3>
      <fieldset disabled={saving} inert={saving} className="flex min-w-0 flex-col gap-5 disabled:opacity-60">
        <BiomarkerPicker
          value={input.biomarkerId || null}
          onChange={(id) => change({
            biomarkerId: id ?? "",
            unit: id ? BIOMARKER_MAP.get(id)?.canonicalUnit ?? "" : "",
            labLow: "",
            labHigh: "",
          })}
          error={errors.biomarkerId}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field.Root invalid={!!errors.value} className="flex min-w-0 flex-col gap-1.5">
            <Field.Label className={labelStyles}>Result</Field.Label>
            <Field.Control value={input.value} onValueChange={(value) => change({ value })} inputMode="decimal" autoComplete="off" aria-describedby={resultHelpId} className={inputStyles} />
            <Field.Error match={!!errors.value} className={errorStyles}>{errors.value}</Field.Error>
          </Field.Root>
          <div className="flex min-w-0 flex-col gap-1.5" aria-describedby={errors.unit ? unitErrorId : undefined}>
            <UnitSelect label="Unit" units={def ? listUnits(def) : []} value={input.unit} onChange={(unit) => change({ unit })} disabled={!def || saving} />
            {errors.unit && <p id={unitErrorId} className={errorStyles}>{errors.unit}</p>}
          </div>
        </div>
        <p id={resultHelpId} className={`${helpStyles} -mt-3`}>
          You can include &lt; or &gt;, as printed on the report.
          {def?.id.startsWith("sleep_") && " Enter a number in the selected unit, for example 7.5 hours for 7 hours 30 minutes."}
        </p>
        <Field.Root invalid={!!errors.date} className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Measurement date</Field.Label>
          <Field.Control type="date" value={input.date} max={today} min="1900-01-01" onValueChange={(date) => change({ date })} className={`${inputStyles} sm:max-w-56`} />
          <Field.Error match={!!errors.date} className={errorStyles}>{errors.date}</Field.Error>
        </Field.Root>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className={`${labelStyles} mb-1.5`}>Lab's reference range (optional)</legend>
          <p className={helpStyles}>Use the same unit as the result{input.unit ? ` (${input.unit})` : ""}. Clear both limits to remove the saved lab range.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field.Root invalid={!!errors.labLow} className="flex min-w-0 flex-col gap-1.5">
              <Field.Label className={labelStyles}>From</Field.Label>
              <Field.Control value={input.labLow ?? ""} onValueChange={(labLow) => change({ labLow })} inputMode="decimal" className={inputStyles} />
              <Field.Error match={!!errors.labLow} className={errorStyles}>{errors.labLow}</Field.Error>
            </Field.Root>
            <Field.Root invalid={!!errors.labHigh} className="flex min-w-0 flex-col gap-1.5">
              <Field.Label className={labelStyles}>To</Field.Label>
              <Field.Control value={input.labHigh ?? ""} onValueChange={(labHigh) => change({ labHigh })} inputMode="decimal" className={inputStyles} />
              <Field.Error match={!!errors.labHigh} className={errorStyles}>{errors.labHigh}</Field.Error>
            </Field.Root>
          </div>
        </fieldset>
        <ChoiceGroup<Fasted>
          label="Were you fasting?"
          help="No food for at least 8 hours before the measurement. Choose Not sure to clear this detail."
          value={fasted}
          onChange={(value) => change({ fasted: value === "unknown" ? undefined : value === "yes" })}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unknown", label: "Not sure" }]}
        />
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Lab name (optional)</Field.Label>
          <Field.Control value={input.lab ?? ""} onValueChange={(lab) => change({ lab })} autoComplete="off" className={inputStyles} />
        </Field.Root>
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Note (optional)</Field.Label>
          <Field.Control render={<textarea rows={2} />} value={input.note ?? ""} onValueChange={(note) => change({ note })} className={`${inputStyles} py-2`} />
        </Field.Root>
        {Object.keys(errors).length > 0 && <p role="alert" className={errorStyles}>Check the fields marked above before saving.</p>}
        {warnings.length > 0 && (
          <Notice tone="warn" title="Please check the value and unit" role="alert">
            {warnings.map((warning) => <p key={warning}>{warning}</p>)}
            <p className="mt-1">If they are correct, press Save anyway.</p>
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>{saving ? "Saving changes…" : warnings.length > 0 ? "Save anyway" : "Save changes"}</Button>
          <Button variant="secondary" disabled={saving} onClick={onCancel}>Cancel</Button>
        </div>
      </fieldset>
      {saveError && <div className="mt-4"><Notice tone="danger" title="Changes not saved" role="alert">{saveError}</Notice></div>}
    </form>
  );
}
