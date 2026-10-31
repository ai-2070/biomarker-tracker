import { useState } from "react";
import { Field } from "@base-ui/react/field";
import { LIFE_TABLE_COUNTRIES } from "../../core/lifeTable";
import { heightInCm, heightInFeet } from "../../core/body";
import type { Diet, HeightUnit, Profile, Sex, Smoking } from "../../core/types";
import { BirthMonthField } from "./BirthMonthField";
import { ChoiceGroup } from "./ChoiceGroup";
import { SimpleSelect } from "./UnitSelect";
import { helpStyles, inputStyles, labelStyles } from "./ui";

type SexChoice = Sex | "unset";
type SmokingChoice = Smoking | "unset";

/** Countries with official life tables (EU and EFTA), for "Best before". */
const COUNTRIES: { value: string; label: string }[] = [
  { value: "unset", label: "Prefer not to say" },
  ...Object.entries(LIFE_TABLE_COUNTRIES)
    .filter(([code]) => code !== "EU27_2020")
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label })),
  { value: "EU27_2020", label: "Somewhere else in the EU (EU average)" },
];

const DIETS: { value: Diet | "unset"; label: string }[] = [
  { value: "unset", label: "Prefer not to say" },
  { value: "omnivore", label: "Eats everything" },
  { value: "pescatarian", label: "Pescatarian (fish, no meat)" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "other", label: "Other or special diet" },
];

const HEIGHT_UNITS: { value: HeightUnit; label: string }[] = [
  { value: "cm", label: "Centimetres" },
  { value: "ft/in", label: "Feet and inches" },
];
const HEIGHT_PARTS = [
  { key: "feet", label: "Feet", placeholder: "e.g. 5", inputMode: "numeric" },
  { key: "inches", label: "Inches", placeholder: "e.g. 11", inputMode: "decimal" },
] as const;

/** Sets or removes one field. */
function withField<K extends keyof Profile>(p: Profile, key: K, value: Profile[K] | undefined): Profile {
  const next = { ...p };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

/** Name, birth month, sex and height. */
export function ProfileBasics({ value, onChange, nameRequired }: { value: Profile; onChange: (p: Profile) => void; nameRequired?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Name{!nameRequired && <span className="font-normal text-ink-2"> (optional)</span>}</Field.Label>
        <Field.Control
          value={value.name ?? ""}
          onValueChange={(name) => onChange(withField(value, "name", name.slice(0, 80)))}
          placeholder="e.g. Anna, or Dad"
          autoComplete="off"
          className={`${inputStyles} sm:max-w-sm`}
        />
        <Field.Description className={helpStyles}>Shown in the app so you can tell profiles apart. Never sent to an AI model.</Field.Description>
      </Field.Root>
      {/* Keyed so it picks up a value that arrives after it first rendered. */}
      <BirthMonthField key={value.birthMonth ?? "none"} value={value.birthMonth} onChange={(birthMonth) => onChange({ ...value, birthMonth })} />
      <ChoiceGroup<SexChoice>
        label="Sex for reference ranges"
        help="Some markers, like ferritin and haemoglobin, have different typical ranges for women and men."
        value={value.sex ?? "unset"}
        onChange={(v) => onChange(withField(value, "sex", v === "unset" ? undefined : v))}
        options={[
          { value: "f", label: "Female" },
          { value: "m", label: "Male" },
          { value: "unset", label: "Prefer not to say" },
        ]}
      />
      <HeightField value={value.heightCm} unit={value.heightUnit ?? "cm"} onUnitChange={(heightUnit) => onChange({ ...value, heightUnit })} onChange={(heightCm) => onChange(withField(value, "heightCm", heightCm))} />
    </div>
  );
}

/** Optional details that help the assistant and the safety checks. */
export function ProfileDetails({ value, onChange, showNotes }: { value: Profile; onChange: (p: Profile) => void; showNotes?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <SimpleSelect
        label="Country you live in"
        options={COUNTRIES}
        value={value.country ?? "unset"}
        onChange={(v) => onChange(withField(value, "country", v === "unset" ? undefined : v))}
        className="sm:max-w-sm"
      />
      <SimpleSelect label="Diet" options={DIETS} value={value.diet ?? "unset"} onChange={(v) => onChange(withField(value, "diet", v === "unset" ? undefined : (v as Diet)))} className="sm:max-w-sm" />
      <ChoiceGroup<SmokingChoice>
        label="Smoking"
        value={value.smoking ?? "unset"}
        onChange={(v) => onChange(withField(value, "smoking", v === "unset" ? undefined : v))}
        options={[
          { value: "never", label: "Never" },
          { value: "former", label: "Used to" },
          { value: "current", label: "Smokes" },
          { value: "unset", label: "Prefer not to say" },
        ]}
      />
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Health conditions</Field.Label>
        <Field.Control
          render={<textarea rows={2} />}
          value={value.conditions ?? ""}
          onValueChange={(v) => onChange(withField(value, "conditions", v.slice(0, 2000)))}
          placeholder="e.g. hypothyroidism, chronic kidney disease"
          className={`${inputStyles} py-2`}
        />
        <Field.Description className={helpStyles}>
          Separate with commas. The app uses this to warn before suggesting changes that may not be safe (for example with kidney disease or pregnancy).
          Medicines and supplements go in Habits.
        </Field.Description>
      </Field.Root>
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Allergies and intolerances</Field.Label>
        <Field.Control
          render={<textarea rows={2} />}
          value={value.allergies ?? ""}
          onValueChange={(v) => onChange(withField(value, "allergies", v.slice(0, 2000)))}
          placeholder="e.g. penicillin, lactose"
          className={`${inputStyles} py-2`}
        />
      </Field.Root>
      {showNotes && (
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Private notes</Field.Label>
          <Field.Control
            render={<textarea rows={3} />}
            value={value.notes ?? ""}
            onValueChange={(v) => onChange(withField(value, "notes", v.slice(0, 10000)))}
            className={`${inputStyles} py-2`}
          />
          <Field.Description className={helpStyles}>Only for you. Never sent to an AI model.</Field.Description>
        </Field.Root>
      )}
    </div>
  );
}

function imperialFields(cm: number | undefined): { feet: string; inches: string } {
  const parts = heightInFeet(cm);
  return { feet: parts ? String(parts.feet) : "", inches: parts ? String(parts.inches) : "" };
}

/** Keep partial input local; unit changes never convert and overwrite the stored height. */
function HeightField({ value, unit, onUnitChange, onChange }: { value?: number; unit: HeightUnit; onUnitChange: (unit: HeightUnit) => void; onChange: (cm: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [imperial, setImperial] = useState(() => imperialFields(value));
  const [typing, setTyping] = useState(false);
  const cm = unit === "cm"
    ? heightInCm(Number(text.replace(",", ".")), unit)
    : heightInCm(Number(imperial.feet.replace(",", ".")), unit, Number(imperial.inches.replace(",", ".")));
  const hasText = unit === "cm" ? text.trim() !== "" : imperial.feet.trim() !== "" || imperial.inches.trim() !== "";
  const wrong = !typing && hasText && cm === undefined;

  function changeUnit(next: HeightUnit) {
    if (next === unit) return;
    setText(value === undefined ? "" : String(value));
    setImperial(imperialFields(value));
    setTyping(false);
    onUnitChange(next);
  }

  function saveImperial() {
    setTyping(false);
    if (!imperial.feet.trim() && !imperial.inches.trim()) return onChange(undefined);
    const cm = heightInCm(Number(imperial.feet.replace(",", ".")), "ft/in", Number(imperial.inches.replace(",", ".")));
    if (cm !== undefined) onChange(cm);
  }

  return (
    <div className="flex flex-col gap-3">
      <ChoiceGroup<HeightUnit> label="Height units" value={unit} onChange={changeUnit} options={HEIGHT_UNITS} />
      {unit === "cm" ? (
        <Field.Root className="flex flex-col gap-1.5" invalid={wrong}>
          <Field.Label className={labelStyles}>Height (cm)</Field.Label>
          <Field.Control
            value={text}
            onValueChange={(text) => {
              setText(text);
              if (!text.trim()) return onChange(undefined);
              const cm = heightInCm(Number(text.replace(",", ".")), "cm");
              if (cm !== undefined) onChange(cm);
            }}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            inputMode="decimal"
            placeholder="e.g. 170"
            className={`${inputStyles} max-w-40`}
          />
        </Field.Root>
      ) : (
        <div className="grid max-w-xs grid-cols-2 gap-3">
          {HEIGHT_PARTS.map((part) => (
            <Field.Root key={part.key} className="flex flex-col gap-1.5" invalid={wrong}>
              <Field.Label className={labelStyles}>{part.label}</Field.Label>
              <Field.Control
                value={imperial[part.key]}
                onValueChange={(text) => setImperial((current) => ({ ...current, [part.key]: text }))}
                onFocus={() => setTyping(true)}
                onBlur={saveImperial}
                inputMode={part.inputMode}
                placeholder={part.placeholder}
                className={inputStyles}
              />
            </Field.Root>
          ))}
        </div>
      )}
      {wrong && <p className={helpStyles} role="alert">{unit === "cm" ? "Between 40 and 260 cm, so it isn't saved yet." : "Check your height and use inches below 12. It isn't saved yet."}</p>}
    </div>
  );
}
