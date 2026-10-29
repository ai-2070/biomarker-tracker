import { Field } from "@base-ui/react/field";
import { LIFE_TABLE_COUNTRIES } from "../../core/lifeTable";
import type { Diet, Profile, Sex, Smoking } from "../../core/types";
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

/** Sets or removes one field. */
function withField<K extends keyof Profile>(p: Profile, key: K, value: Profile[K] | undefined): Profile {
  const next = { ...p };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

/** Name, birth month and sex. */
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
    </div>
  );
}

/** Optional details that help the assistant and the safety checks. */
export function ProfileDetails({ value, onChange, showNotes }: { value: Profile; onChange: (p: Profile) => void; showNotes?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Height (cm)</Field.Label>
        <Field.Control
          value={value.heightCm === undefined ? "" : String(value.heightCm)}
          onValueChange={(v) => {
            const n = Number(v.replace(",", "."));
            onChange(withField(value, "heightCm", v.trim() && Number.isFinite(n) && n >= 40 && n <= 260 ? Math.round(n) : undefined));
          }}
          inputMode="numeric"
          placeholder="e.g. 170"
          className={`${inputStyles} max-w-40`}
        />
      </Field.Root>
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
