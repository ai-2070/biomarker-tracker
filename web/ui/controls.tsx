// Controls on Base UI, drawn with the app's existing classes (.tabs, .seg, .chips) so they look the same
// as the plain-DOM ones while gaining keyboard use and the right roles for screen readers.
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import type { ReactNode } from 'react';

export interface Choice<V extends string> {
  value: V;
  label: ReactNode;
  title?: string;
}

// The tab row's layout. :where() takes away its weight, so whatever a page passes in rowClassName
// (its own gap or alignment, say) wins over it.
const TAB_ROW = '[:where(&)]:flex [:where(&)]:flex-wrap [:where(&)]:items-center [:where(&)]:justify-between [:where(&)]:gap-2.5';

const on = (yes: boolean, base = '') => [base, yes ? 'on' : ''].filter(Boolean).join(' ') || undefined;

/** A row of tabs and the panel of the open one. Arrow keys move between tabs. */
export function Tabs<V extends string>({ tabs, value, onChange, aside, children, label, rowClassName = '', panelClassName = '' }: {
  tabs: readonly Choice<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Shown at the end of the tab row (the Agent library's "Runs on"). */
  aside?: ReactNode;
  /** The open tab's content. */
  children: ReactNode;
  label: string;
  rowClassName?: string;
  panelClassName?: string;
}) {
  return (
    <BaseTabs.Root value={value} onValueChange={(v) => onChange(v as V)}>
      <div className={`${TAB_ROW} ${rowClassName}`.trim()}>
        <BaseTabs.List className="tabs" aria-label={label}>
          {tabs.map((t) => (
            <BaseTabs.Tab key={t.value} value={t.value} title={t.title} className={(s) => on(s.active)}>
              {t.label}
            </BaseTabs.Tab>
          ))}
        </BaseTabs.List>
        {aside}
      </div>
      <BaseTabs.Panel value={value} className={panelClassName || undefined}>
        {children}
      </BaseTabs.Panel>
    </BaseTabs.Root>
  );
}

/** Pick one of a few (the plain-DOM seg()). Pressing the picked one again keeps it picked. */
export function Segmented<V extends string>({ options, value, onChange, label }: {
  options: readonly Choice<V>[];
  value: V | null;
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <ToggleGroup className="seg" aria-label={label} value={value ? [value] : []} onValueChange={(v) => v[0] && onChange(v[0] as V)}>
      {options.map((o) => (
        <Toggle key={o.value} value={o.value} title={o.title} className={(s) => on(s.pressed)}>
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** An on/off switch with its text; clicking the text flips it too (the plain-DOM toggleRow()). */
export function Switch({ checked, onChange, children, className = '', disabled }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** What it turns on, read out with it. */
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch-row flex flex-wrap items-center gap-2.5 ${className}`.trim()}>
      <BaseSwitch.Root className="switch" checked={checked} onCheckedChange={(on) => onChange(on)} disabled={disabled}>
        <BaseSwitch.Thumb className="switch-thumb" />
      </BaseSwitch.Root>
      <span className="toggle-text cursor-pointer">{children}</span>
    </label>
  );
}

/** A labelled control with an optional hint under it (the plain-DOM field()). A group of buttons isn't
 *  labelable, so pass group to get a div named by its label instead of a <label>. */
export function Field({ label, hint, children, group }: { label: ReactNode; hint?: ReactNode; children: ReactNode; group?: string }) {
  if (group)
    return (
      <div className="field" role="group" aria-labelledby={group}>
        <span id={group}>{label}</span>
        {children}
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
    );
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

/** Chips you turn on and off, any number at once (the plain-DOM chipSet()). */
export function ChipSet<V extends string>({ options, value, onChange, label }: {
  options: readonly Choice<V>[];
  value: readonly V[];
  onChange: (v: V[]) => void;
  label: string;
}) {
  return (
    <ToggleGroup multiple className="chips" aria-label={label} value={[...value]} onValueChange={(v) => onChange(v as V[])}>
      {options.map((o) => (
        <Toggle key={o.value} value={o.value} title={o.title} className={(s) => on(s.pressed, 'chip')}>
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** Filter chips where one is picked at a time; the first choice is usually "All". */
export function Chips<V extends string>({ options, value, onChange, label, className = '' }: {
  options: readonly Choice<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup className={`chips ${className}`.trim()} aria-label={label} value={[value]} onValueChange={(v) => v[0] !== undefined && onChange(v[0] as V)}>
      {options.map((o) => (
        <Toggle key={o.value} value={o.value} title={o.title} className={(s) => on(s.pressed, 'chip')}>
          {o.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
