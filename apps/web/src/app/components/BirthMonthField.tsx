import { Field } from "@base-ui/react/field";
import { todayIso } from "@bt/shared/core/dates";
import { isBirthMonth } from "@bt/shared/core/phenoageDraws";
import { useState } from "react";
import { SimpleSelect } from "./UnitSelect";
import { errorStyles, helpStyles, inputStyles, labelStyles } from "./ui";

const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long" });
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, "0"),
  label: monthFmt.format(new Date(2000, i, 1)),
}));

/**
 * Birth year and month only (no day). Calls onChange with "YYYY-MM" once both are valid.
 * Uses two fields because <input type="month"> is missing in some browsers.
 */
export function BirthMonthField({
  value,
  onChange,
  onValidityChange,
  help,
  compact = false,
}: {
  value?: string;
  onChange: (birthMonth: string) => void;
  onValidityChange?: (valid: boolean) => void;
  help?: string;
  compact?: boolean;
}) {
  const [year, setYear] = useState(value?.slice(0, 4) ?? "");
  const [month, setMonth] = useState<string | null>(value?.slice(5, 7) ?? null);
  const thisYear = new Date().getFullYear();
  const yearNum = Number(year);
  const yearError = year.length === 4 && (yearNum < 1900 || yearNum > thisYear) ? "Please check the year." : undefined;
  const futureMonth = !yearError && year.length === 4 && month && `${year}-${month}` > todayIso().slice(0, 7);

  function save(y: string, m: string | null) {
    const v = m ? `${y}-${m}` : "";
    const valid = y.length === 4 && !!m && isBirthMonth(v) && v <= todayIso().slice(0, 7);
    onValidityChange?.(valid);
    if (valid) onChange(v);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelStyles}>Month and year of birth</span>
      <span className={helpStyles}>{help ?? "Needed for biological age. Only the month and year are kept. The day is not needed."}</span>
      <div
        className={compact ? "grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-3 sm:max-w-sm" : "grid grid-cols-[1fr_7rem] gap-3 sm:max-w-sm"}
      >
        <SimpleSelect
          label="Month"
          options={MONTHS}
          value={month}
          placeholder="Month"
          onChange={(m) => {
            setMonth(m);
            save(year, m);
          }}
        />
        <Field.Root invalid={!!yearError} className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Year</Field.Label>
          <Field.Control
            value={year}
            onValueChange={(v) => {
              const y = v.replace(/\D/g, "").slice(0, 4);
              setYear(y);
              save(y, month);
            }}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 1985"
            className={inputStyles}
          />
        </Field.Root>
      </div>
      {(yearError || futureMonth) && (
        <p className={errorStyles} role="alert">
          {yearError ?? "The month of birth cannot be in the future."}
        </p>
      )}
    </div>
  );
}
