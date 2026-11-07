import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useId } from "react";
import { helpStyles, labelStyles } from "./ui";

/** A row of large, tappable radio choices. */
export function ChoiceGroup<T extends string>({
  label,
  help,
  options,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const labelId = useId();
  const helpId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div id={labelId} className={labelStyles}>
        {label}
      </div>
      {help && (
        <p id={helpId} className={helpStyles}>
          {help}
        </p>
      )}
      <RadioGroup
        aria-labelledby={labelId}
        aria-describedby={help ? helpId : undefined}
        value={value}
        onValueChange={(v) => onChange(v as T)}
        className="flex flex-wrap gap-2"
      >
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 has-data-checked:border-accent has-data-checked:bg-accent-soft"
          >
            <Radio.Root
              value={o.value}
              className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-line-strong bg-surface data-checked:border-accent"
            >
              <Radio.Indicator className="flex items-center justify-center data-unchecked:hidden before:size-2.5 before:rounded-full before:bg-accent" />
            </Radio.Root>
            {o.label}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
