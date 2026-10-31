import { useId } from "react";
import { Combobox } from "@base-ui/react/combobox";
import type { BiomarkerDef } from "../../core/types";
import { BIOMARKERS, BLOOD_MARKERS, fullName } from "../knowledge";
import { CheckIcon, ChevronDownIcon, cx, errorStyles, labelStyles } from "./ui";

function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Match on name, abbreviation and any alias, so lab spellings ("Kalium", "LDL-C") work. */
function matches(def: BiomarkerDef, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  return [def.name, def.abbreviation ?? "", ...def.aliases].some((s) => normalize(s).includes(q));
}

/** Searchable list of biomarkers. Value is a biomarker id. */
export function BiomarkerPicker({
  value,
  onChange,
  error,
  bloodOnly = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string;
  /** Only the blood-result form opts in; habit and import pickers retain all markers. */
  bloodOnly?: boolean;
}) {
  const inputId = useId();
  const errorId = useId();
  const items = bloodOnly ? BLOOD_MARKERS : BIOMARKERS;
  const selected = value ? (items.find((d) => d.id === value) ?? null) : null;

  return (
    <Combobox.Root<BiomarkerDef>
      items={items as BiomarkerDef[]}
      value={selected}
      onValueChange={(d) => onChange(d?.id ?? null)}
      itemToStringLabel={(d) => fullName(d)}
      isItemEqualToValue={(a, b) => a.id === b.id}
      filter={(d, q) => matches(d, q)}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className={labelStyles}>
          Marker
        </label>
        <Combobox.InputGroup
          className={cx(
            "relative flex min-h-11 items-center rounded-lg border bg-surface focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent",
            error ? "border-danger" : "border-line-strong",
          )}
        >
          <Combobox.Input
            id={inputId}
            placeholder="Search, e.g. ferritin or LDL"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-11 w-full min-w-0 rounded-lg bg-transparent pr-11 pl-3 text-base text-ink outline-none placeholder:text-muted"
          />
          <Combobox.Trigger
            aria-label="Show all markers"
            className="absolute right-0 flex h-11 w-11 items-center justify-center text-ink-2"
          >
            <ChevronDownIcon />
          </Combobox.Trigger>
        </Combobox.InputGroup>
        {error && (
          <p id={errorId} className={errorStyles}>
            {error}
          </p>
        )}
      </div>

      <Combobox.Portal>
        <Combobox.Positioner className="z-50 outline-none" sideOffset={4}>
          <Combobox.Popup className="w-[var(--anchor-width)] max-w-[var(--available-width)] origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-line bg-surface text-ink shadow-lg transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Combobox.Empty>
              <div className="px-3 py-4 text-ink-2">
                No marker found. More markers will be added over time.
              </div>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(22rem,var(--available-height))] overflow-y-auto overscroll-contain py-1 outline-0 data-empty:p-0">
              {(d: BiomarkerDef) => (
                <Combobox.Item
                  key={d.id}
                  value={d}
                  className="grid min-h-11 cursor-default grid-cols-[1.25rem_1fr] items-center gap-2 px-3 py-2 outline-none select-none data-highlighted:bg-accent-soft"
                >
                  <Combobox.ItemIndicator className="col-start-1 text-accent">
                    <CheckIcon />
                  </Combobox.ItemIndicator>
                  <span className="col-start-2 flex flex-col">
                    <span>{fullName(d)}</span>
                    <span className="text-sm text-ink-2">{d.category}</span>
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
