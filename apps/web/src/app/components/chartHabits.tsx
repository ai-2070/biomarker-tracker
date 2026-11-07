import type { ProtocolCategory } from "@bt/shared/core/protocols";
import { useState } from "react";
import { cx } from "./ui";

/** Chart choices remembered per chart in this browser (a convenience; nothing depends on it). */
export function useChartPrefs<T extends object>(key: string, defaults: T): [T, (p: Partial<T>) => void] {
  const [prefs, setPrefs] = useState<T>(() => {
    try {
      return { ...defaults, ...(JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<T>) };
    } catch {
      return defaults;
    }
  });
  const update = (p: Partial<T>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage blocked: the choice lasts until reload */
      }
      return next;
    });
  return [prefs, update];
}

/** An on/off pill for what a chart shows. */
export function Toggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        "flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-150 sm:h-8",
        on ? "border-accent/40 bg-accent-soft text-ink" : "border-line text-ink-2 hover:text-ink",
      )}
    >
      <span aria-hidden="true" className={cx("size-2 rounded-full", on ? "bg-accent" : "bg-line-strong")} />
      {children}
    </button>
  );
}

const TYPE_LABEL: Record<ProtocolCategory, string> = { supplement: "Supplements", diet: "Diet", medication: "Medicines", lifestyle: "Lifestyle" };

/**
 * Which types of habit a chart shows: one pill per type present (`shown` null = every type). Hidden
 * when there is only one type, since there is nothing to choose.
 */
export function HabitTypes({
  present,
  shown,
  onChange,
}: {
  present: readonly ProtocolCategory[];
  shown: readonly ProtocolCategory[] | null;
  onChange: (types: ProtocolCategory[] | null) => void;
}) {
  if (present.length < 2) return null;
  const isOn = (c: ProtocolCategory) => shown === null || shown.includes(c);
  const set = (c: ProtocolCategory, on: boolean) => {
    const next = present.filter((x) => (x === c ? on : isOn(x)));
    onChange(next.length === present.length ? null : next);
  };
  return (
    <div role="group" aria-label="Types of habit" className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-2">Show</span>
      {present.map((c) => (
        <Toggle key={c} on={isOn(c)} onChange={(on) => set(c, on)}>
          {TYPE_LABEL[c]}
        </Toggle>
      ))}
    </div>
  );
}
