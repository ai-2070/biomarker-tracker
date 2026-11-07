import { useState, type FormEvent } from "react";
import { Field } from "@base-ui/react/field";
import { todayIso } from "@bt/shared/core/dates";
import { validateManualEntry, type ManualEntryField } from "@bt/shared/core/importers/manual";
import { flagMeasurement, isCritical, type Flag } from "@bt/shared/core/trends";
import { listUnits } from "@bt/shared/core/units";
import type { Measurement } from "@bt/shared/core/types";
import { addMeasurement } from "../../db/db";
import { BiomarkerPicker } from "../components/BiomarkerPicker";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { CriticalBanner } from "../components/CriticalBanner";
import { SegmentTabs } from "../components/SegmentTabs";
import { BodyEntryForm } from "../components/dashboard/BodyEntryForm";
import { BodyIcon, DropIcon, FileIcon, PhoneSyncIcon } from "../components/icons";
import { UnitSelect } from "../components/UnitSelect";
import { Button, Card, FlagBadge, Notice, PageTitle, errorStyles, helpStyles, inputStyles, labelStyles, eyebrowStyles, linkCardStyles, cx } from "../components/ui";
import { formatDate, showMeasurement, valueUnit } from "../format";
import { useProfile } from "../hooks";
import { BIOMARKER_MAP, fullName } from "../knowledge";
import { href } from "../router";
import { More } from "../components/disclosure";

type Fasted = "yes" | "no" | "unknown";

interface Saved {
  measurement: Measurement;
  flag: Flag;
}

const WAYS = [
  { title: "Import a lab report", text: "A PDF or a photo of your report: all results at once. Photos are read on this device.", to: { name: "import" } as const, icon: FileIcon },
  { title: "From a device or app", text: "Export files from Apple Health, Garmin, Fitbit, Oura, Samsung, Withings and others.", to: { name: "device-import" } as const, icon: PhoneSyncIcon },
];

type Kind = "blood" | "body";

const KINDS: { id: Kind; label: string; icon: typeof BodyIcon }[] = [
  { id: "blood", label: "Blood test result", icon: DropIcon },
  { id: "body", label: "Body measurements", icon: BodyIcon },
];

export function AddResult({ initialMarker, initialKind }: { initialMarker?: string; initialKind?: "body" }) {
  const [kind, setKind] = useState<Kind>(initialKind ?? (initialMarker && BIOMARKER_MAP.get(initialMarker)?.category === "Body" ? "body" : "blood"));
  const profile = useProfile();
  const today = todayIso();
  const startMarker = initialMarker && BIOMARKER_MAP.get(initialMarker)?.category !== "Body" && BIOMARKER_MAP.has(initialMarker) ? initialMarker : null;

  const [biomarkerId, setBiomarkerId] = useState<string | null>(startMarker);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(startMarker ? BIOMARKER_MAP.get(startMarker)!.canonicalUnit : "");
  const [date, setDate] = useState(today);
  const [lab, setLab] = useState("");
  const [labLow, setLabLow] = useState("");
  const [labHigh, setLabHigh] = useState("");
  const [fasted, setFasted] = useState<Fasted>("unknown");
  const [note, setNote] = useState("");

  const [errors, setErrors] = useState<Partial<Record<ManualEntryField, string>>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saving, setSaving] = useState(false);

  const def = biomarkerId ? BIOMARKER_MAP.get(biomarkerId) : undefined;

  function chooseMarker(id: string | null) {
    if (id && BIOMARKER_MAP.get(id)?.category === "Body") return;
    setBiomarkerId(id);
    setUnit(id ? BIOMARKER_MAP.get(id)!.canonicalUnit : "");
    setWarnings([]);
    setErrors((e) => ({ ...e, biomarkerId: undefined, unit: undefined }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (kind !== "blood" || def?.category === "Body") {
      setErrors({ biomarkerId: "Use Body measurements to enter this reading." });
      return;
    }
    const result = validateManualEntry(
      {
        biomarkerId: biomarkerId ?? "",
        value,
        unit,
        date,
        labLow,
        labHigh,
        lab,
        note,
        fasted: fasted === "unknown" ? undefined : fasted === "yes",
      },
      BIOMARKER_MAP,
      today,
    );
    if (!result.ok) {
      setErrors(result.errors);
      setWarnings([]);
      return;
    }
    setErrors({});
    // Unit warnings need a second, deliberate click to save anyway.
    if (result.warnings.length > 0 && warnings.length === 0) {
      setWarnings(result.warnings);
      return;
    }

    setSaving(true);
    try {
      const id = await addMeasurement(result.measurement);
      const measurement = { ...result.measurement, id };
      setSaved((s) => [{ measurement, flag: flagMeasurement(def!, measurement, profile) }, ...s]);
      // Keep date, lab and fasting so a whole lab report can be entered quickly.
      setBiomarkerId(null);
      setUnit("");
      setValue("");
      setLabLow("");
      setLabHigh("");
      setNote("");
      setWarnings([]);
      document.getElementById("marker-picker")?.querySelector("input")?.focus();
    } finally {
      setSaving(false);
    }
  }

  const critical = saved
    .filter((s) => isCritical(s.flag))
    .map((s) => ({ def: BIOMARKER_MAP.get(s.measurement.biomarkerId)!, measurement: s.measurement, low: s.flag === "critical-low" }));

  return (
    <>
      <CriticalBanner items={critical} />
      <PageTitle sub="Blood test results, body measurements like weight and blood pressure, or files from a watch or health app. You check everything before it's saved.">
        Add data
      </PageTitle>

      {/* Files first: they bring many values at once. Typing values in is below. */}
      <ul className="mb-8 grid gap-3 sm:grid-cols-2">
        {WAYS.map((w) => (
          <li key={w.title}>
            <a
              href={href(w.to)}
              className={cx("flex h-full items-start gap-3", linkCardStyles)}
            >
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <w.icon />
              </span>
              <span>
                <span className="block font-medium">{w.title}</span>
                <span className="text-sm text-ink-2">{w.text}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      <h2 className="mb-3 font-serif text-2xl font-normal">Type it in</h2>
      <SegmentTabs
        label="What to add"
        tabs={KINDS.map((k) => ({ value: k.id, label: <><k.icon width={16} height={16} />{k.label}</> }))}
        value={kind}
        onChange={setKind}
        listClassName="mb-4"
      >
      {kind === "body" ? (
        <BodyPanel />
      ) : (
      <div>
      <p className="mb-4 max-w-3xl text-ink-2">Copy one value from your lab report. You can add several results from the same report one after another.</p>

      {/* minmax(0, 1fr) lets long marker names truncate instead of widening the page. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <div id="marker-picker">
              <BiomarkerPicker bloodOnly value={biomarkerId} onChange={chooseMarker} error={errors.biomarkerId} />
            </div>

            <div className="grid grid-cols-[1fr_9rem] gap-3 sm:grid-cols-[1fr_12rem]">
              <Field.Root invalid={!!errors.value} className="flex min-w-0 flex-col gap-1.5">
                <Field.Label className={labelStyles}>Result</Field.Label>
                <Field.Control
                  value={value}
                  onValueChange={(v) => {
                    setValue(v);
                    setWarnings([]);
                  }}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 5.4"
                  className={inputStyles}
                />
                <Field.Error match={!!errors.value} className={errorStyles}>
                  {errors.value}
                </Field.Error>
              </Field.Root>
              <div className="flex min-w-0 flex-col gap-1.5">
                <UnitSelect
                  label="Unit"
                  units={def ? listUnits(def) : []}
                  value={unit}
                  onChange={(u) => {
                    setUnit(u);
                    setWarnings([]);
                  }}
                  disabled={!def}
                />
                {errors.unit && <p className={errorStyles}>{errors.unit}</p>}
              </div>
            </div>
            <p className={`${helpStyles} -mt-3`}>
              If your report says something like "&lt;0.3", type it exactly like that.
            </p>

            <Field.Root invalid={!!errors.date} className="flex flex-col gap-1.5">
              <Field.Label className={labelStyles}>Date of the blood test</Field.Label>
              <Field.Control
                type="date"
                value={date}
                max={today}
                onValueChange={setDate}
                className={`${inputStyles} sm:max-w-56`}
              />
              <Field.Error match={!!errors.date} className={errorStyles}>
                {errors.date}
              </Field.Error>
            </Field.Root>

            <More summary="More details (optional)" boxed>
              <div className="flex flex-col gap-5 border-t border-line p-3">
                <div className="flex flex-col gap-1.5">
                  <span className={labelStyles}>Lab's reference range</span>
                  <span className={helpStyles}>
                    Printed next to the result on most reports. Use the same unit as the result. If you leave it empty, a typical
                    adult range is used.
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <Field.Root invalid={!!errors.labLow} className="flex flex-col gap-1">
                      <Field.Label className="text-sm text-ink-2">From</Field.Label>
                      <Field.Control value={labLow} onValueChange={setLabLow} inputMode="decimal" className={inputStyles} />
                      <Field.Error match={!!errors.labLow} className={errorStyles}>
                        {errors.labLow}
                      </Field.Error>
                    </Field.Root>
                    <Field.Root invalid={!!errors.labHigh} className="flex flex-col gap-1">
                      <Field.Label className="text-sm text-ink-2">To</Field.Label>
                      <Field.Control value={labHigh} onValueChange={setLabHigh} inputMode="decimal" className={inputStyles} />
                      <Field.Error match={!!errors.labHigh} className={errorStyles}>
                        {errors.labHigh}
                      </Field.Error>
                    </Field.Root>
                  </div>
                </div>

                <ChoiceGroup<Fasted>
                  label="Were you fasting?"
                  help="No food for at least 8 hours before the test. This matters for glucose and triglycerides."
                  value={fasted}
                  onChange={setFasted}
                  options={[
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                    { value: "unknown", label: "Not sure" },
                  ]}
                />

                <Field.Root className="flex flex-col gap-1.5">
                  <Field.Label className={labelStyles}>Lab name</Field.Label>
                  <Field.Control value={lab} onValueChange={setLab} autoComplete="off" className={inputStyles} />
                </Field.Root>

                <Field.Root className="flex flex-col gap-1.5">
                  <Field.Label className={labelStyles}>Note</Field.Label>
                  <Field.Control
                    render={<textarea rows={2} />}
                    value={note}
                    onValueChange={setNote}
                    placeholder="e.g. had a cold that week"
                    className={`${inputStyles} py-2`}
                  />
                </Field.Root>
              </div>
            </More>

            {warnings.length > 0 && (
              <Notice tone="warn" title="Please check the unit" role="alert">
                {warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                <p className="mt-1">If the value and unit are correct, press "Save anyway".</p>
              </Notice>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {warnings.length > 0 ? "Save anyway" : "Save result"}
              </Button>
              <a href={href({ name: "overview" })} className="inline-flex min-h-11 items-center px-3 text-ink-2 underline-offset-2 hover:underline">
                Done
              </a>
            </div>
          </form>
        </Card>

        <aside aria-live="polite" className="flex flex-col gap-2">
          {saved.length > 0 && (
            <>
              <h2 className={eyebrowStyles}>Saved just now</h2>
              <ul className="flex flex-col gap-2">
                {saved.map(({ measurement: m, flag }) => {
                  const d = BIOMARKER_MAP.get(m.biomarkerId)!;
                  return (
                    <li key={m.id}>
                      <a
                        href={href({ name: "marker", id: d.id })}
                        className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3 no-underline hover:bg-sunken"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{fullName(d)}</span>
                          <span className="text-sm text-ink-2">
                            {showMeasurement(d, m, d.canonicalUnit)} {valueUnit(d, d.canonicalUnit)} ·{" "}
                            {formatDate(m.date)}
                          </span>
                        </span>
                        <FlagBadge flag={flag} />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>
      </div>
      </div>
      )}
      </SegmentTabs>
    </>
  );
}

/** Body measurements for one day: the same form as on the Body page. */
function BodyPanel() {
  const [saved, setSaved] = useState(0);
  const [round, setRound] = useState(0);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <p className="mb-4 text-ink-2">Weight, waist, blood pressure, heart rate, sleep, blood glucose and more, for one day.</p>
        <BodyEntryForm
          key={round}
          cancel={false}
          onDone={(n) => {
            setSaved((s) => s + n);
            setRound((r) => r + 1);
          }}
        />
      </Card>
      <aside aria-live="polite">
        {saved > 0 && (
          <Notice role="status" title={`Saved ${saved} ${saved === 1 ? "measurement" : "measurements"}`}>
            <a href={href({ name: "body" })}>See them on Body</a>, or add another day.
          </Notice>
        )}
      </aside>
    </div>
  );
}
