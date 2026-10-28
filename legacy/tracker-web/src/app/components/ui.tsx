import type { ComponentProps, ReactNode } from "react";
import type { Flag } from "../../core/trends";
import { FLAG_LABEL } from "../format";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// Buttons: 44px minimum height for touch.
const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium whitespace-nowrap select-none transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const buttonStyles = {
  primary: cx(buttonBase, "bg-accent text-accent-ink hover:brightness-110 active:brightness-95"),
  secondary: cx(buttonBase, "border border-line-strong bg-surface text-ink hover:bg-sunken"),
  danger: cx(buttonBase, "bg-danger-strong text-white hover:brightness-110"),
  quiet: cx(buttonBase, "px-3 text-ink-2 hover:bg-sunken hover:text-ink"),
};

type Variant = keyof typeof buttonStyles;

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={cx(buttonStyles[variant], className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<"a"> & { variant?: Variant }) {
  return <a className={cx(buttonStyles[variant], "no-underline", className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-xl border border-line bg-surface p-4 sm:p-5", className)} {...props} />;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{children}</h1>
      {sub && <p className="mt-1 text-ink-2">{sub}</p>}
    </div>
  );
}

const flagStyle: Record<Flag, string> = {
  normal: "bg-ok-soft text-ok",
  low: "bg-warn-soft text-warn",
  high: "bg-warn-soft text-warn",
  "critical-low": "bg-danger-soft text-danger",
  "critical-high": "bg-danger-soft text-danger",
  unknown: "bg-sunken text-ink-2",
};

const flagIcon: Record<Flag, string> = {
  normal: "✓",
  low: "↓",
  high: "↑",
  "critical-low": "!",
  "critical-high": "!",
  unknown: "–",
};

/** Status is always icon + text, never colour alone. */
export function FlagBadge({ flag, className }: { flag: Flag; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap",
        flagStyle[flag],
        className,
      )}
    >
      <span aria-hidden="true" className="font-bold">
        {flagIcon[flag]}
      </span>
      {FLAG_LABEL[flag]}
    </span>
  );
}

type Tone = "info" | "warn" | "danger";

const toneStyle: Record<Tone, string> = {
  info: "border-line bg-sunken text-ink",
  warn: "border-warn/30 bg-warn-soft text-ink",
  danger: "border-danger/40 bg-danger-soft text-ink",
};

export function Notice({ tone = "info", title, children, className, role }: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div role={role} className={cx("rounded-xl border p-4", toneStyle[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx("text-ink-2", title ? "mt-1" : undefined)}>{children}</div>}
    </div>
  );
}

export const inputStyles =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-muted focus:outline-2 focus:-outline-offset-1 focus:outline-accent data-invalid:border-danger";

export const labelStyles = "text-base font-medium text-ink";
export const helpStyles = "text-sm text-ink-2";
export const errorStyles = "text-sm font-medium text-danger";

export function ChevronDownIcon(props: ComponentProps<"svg">) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" {...props}>
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon(props: ComponentProps<"svg">) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
