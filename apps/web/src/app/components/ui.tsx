import type { ComponentProps, ReactNode } from "react";
import type { Flag } from "@bt/shared/core/trends";
import { FLAG_LABEL } from "../format";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// Buttons: 44px minimum height for touch.
const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,filter,scale] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

export const buttonStyles = {
  primary: cx(buttonBase, "bg-accent text-accent-ink hover:brightness-110 active:brightness-95"),
  secondary: cx(buttonBase, "border border-line-strong bg-surface text-ink hover:bg-sunken"),
  danger: cx(buttonBase, "bg-danger-strong text-white hover:brightness-110"),
  quiet: cx(buttonBase, "px-3 text-ink-2 hover:bg-sunken hover:text-ink"),
  /** Text only, like a link: small actions next to content ("Show all", "Back to my chat"). */
  link: "inline-flex min-h-11 items-center text-left text-sm font-medium text-accent underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50",
};

type Variant = keyof typeof buttonStyles;

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={cx(buttonStyles[variant], className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<"a"> & { variant?: Variant }) {
  return <a className={cx(buttonStyles[variant], "no-underline", className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx(cardStyles, "p-4 sm:p-5", className)} {...props} />;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="font-serif text-3xl font-normal tracking-tight text-balance sm:text-4xl">{children}</h1>
      {sub && <p className="mt-1 max-w-3xl text-ink-2">{sub}</p>}
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
    <div role={role} className={cx("rounded-xl border p-4", role && "animate-fade", toneStyle[tone], className)}>
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

/** The small uppercase label above a heading or a group ("Whole foods", "Suggested habit"). */
export const eyebrowStyles = "font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase";
/** The same label at menu size: group headings in menus, lists and Brain's cards. */
export const eyebrowSmallStyles = "font-mono text-[11px] font-medium tracking-[0.14em] text-ink-2 uppercase";

/** The card look on any element (Card is a <section> with padding): add padding and layout. */
export const cardStyles = "rounded-xl border border-line bg-surface";
/** A card that is a link: lifts a little on hover. Add layout (flex, gap). */
export const linkCardStyles = "rounded-xl border border-line bg-surface p-4 text-ink no-underline transition-[border-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-sm";
/** A Base UI Dialog.Popup in the middle of the screen. Add a width, e.g. w-[34rem]. */
export const dialogStyles =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

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
