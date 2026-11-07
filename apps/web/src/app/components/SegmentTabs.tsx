import type { ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { cx } from "./ui";

export interface SegmentTab<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * A row of tabs in a sunken pill, with the content for the chosen tab below. Base UI gives the tab
 * semantics and keys: arrow keys, Home and End move between tabs, Enter or Space chooses one, and
 * only the chosen tab is in the Tab order. The raised background slides to the chosen tab.
 */
export function SegmentTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  className,
  listClassName,
  panelClassName,
  header,
  children,
}: {
  /** Names the row for screen readers, e.g. "Topic". */
  label: string;
  tabs: readonly SegmentTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  listClassName?: string;
  panelClassName?: string;
  /** Shown on the same row as the tabs, before them (a heading); the tabs wrap below it on narrow screens. */
  header?: ReactNode;
  /** What the chosen tab shows. */
  children: ReactNode;
}) {
  const list = (
    <Tabs.List aria-label={label} className={cx("relative flex flex-wrap gap-1 self-start rounded-xl border border-line bg-sunken p-1", listClassName)}>
      {tabs.map((t) => (
        <Tabs.Tab
          key={t.value}
          value={t.value}
          className="relative z-10 flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-ink-2 transition-colors duration-150 hover:text-ink data-active:font-medium data-active:text-ink sm:min-h-9"
        >
          {t.label}
        </Tabs.Tab>
      ))}
      <Tabs.Indicator className="absolute top-[var(--active-tab-top)] left-[var(--active-tab-left)] h-[var(--active-tab-height)] w-[var(--active-tab-width)] rounded-lg bg-surface shadow-sm transition-[top,left,width,height] duration-200 ease-[var(--ease-soft)] motion-reduce:transition-none" />
    </Tabs.List>
  );
  return (
    <Tabs.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      {header ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {header}
          {list}
        </div>
      ) : (
        list
      )}
      <Tabs.Panel value={value} className={panelClassName}>
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
