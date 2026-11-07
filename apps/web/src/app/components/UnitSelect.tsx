import { Select } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon, cx, eyebrowSmallStyles, labelStyles } from "./ui";

export interface Option {
  value: string;
  label: string;
  /** Options with a group are listed under that heading (consecutive options share one). */
  group?: string;
}

/** Consecutive options that share a group, in order. */
function groupOptions(options: Option[]): { group?: string; options: Option[] }[] {
  const out: { group?: string; options: Option[] }[] = [];
  for (const o of options) {
    const last = out[out.length - 1];
    if (last && last.group === o.group) last.options.push(o);
    else out.push({ ...(o.group ? { group: o.group } : {}), options: [o] });
  }
  return out;
}

const item = (o: Option) => (
  <Select.Item
    key={o.value}
    value={o.value}
    className="grid min-h-11 cursor-default grid-cols-[1.25rem_1fr] items-center gap-2 px-3 outline-none select-none data-highlighted:bg-accent-soft"
  >
    <Select.ItemIndicator className="col-start-1 text-accent">
      <CheckIcon />
    </Select.ItemIndicator>
    <Select.ItemText className="col-start-2">{o.label}</Select.ItemText>
  </Select.Item>
);

/** Base UI Select with large touch targets. */
export function SimpleSelect({
  label,
  options,
  value,
  onChange,
  disabled,
  compact,
  placeholder = "Choose…",
  className,
  labelClassName,
}: {
  label: string;
  options: Option[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Smaller inline variant, e.g. "Show in" on the marker page. */
  compact?: boolean;
  placeholder?: string;
  className?: string;
  /** Overrides the label style, e.g. to match small field labels. */
  labelClassName?: string;
}) {
  return (
    <Select.Root items={options} value={value} onValueChange={(v) => v !== null && onChange(v)} disabled={disabled}>
      <div className={cx("flex gap-1.5", compact ? "items-center" : "flex-col", className)}>
        <Select.Label className={labelClassName ?? (compact ? "text-sm text-ink-2" : labelStyles)}>{label}</Select.Label>
        <Select.Trigger
          className={cx(
            "flex min-h-11 items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 text-base text-ink select-none hover:bg-sunken data-disabled:opacity-50",
            compact ? "min-w-28" : "w-full",
          )}
        >
          <Select.Value placeholder={placeholder} className="truncate data-placeholder:text-muted" />
          <Select.Icon className="text-ink-2">
            <ChevronDownIcon />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner className="z-50 outline-none select-none" sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className="min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-lg border border-line bg-surface py-1 text-ink shadow-lg transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Select.List className="max-h-[min(22rem,var(--available-height))] overflow-y-auto">
              {groupOptions(options).map((g, gi) =>
                g.group ? (
                  <Select.Group key={g.group} className={gi > 0 ? "mt-1 border-t border-line pt-1" : undefined}>
                    <Select.GroupLabel className={cx("px-3 pt-2 pb-1", eyebrowSmallStyles)}>{g.group}</Select.GroupLabel>
                    {g.options.map(item)}
                  </Select.Group>
                ) : (
                  g.options.map(item)
                ),
              )}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function UnitSelect({
  units,
  value,
  ...rest
}: {
  label: string;
  units: string[];
  value: string;
  onChange: (unit: string) => void;
  disabled?: boolean;
  compact?: boolean;
  labelClassName?: string;
}) {
  return <SimpleSelect {...rest} options={units.map((u) => ({ value: u, label: u }))} value={value || null} placeholder="Choose a unit" />;
}
