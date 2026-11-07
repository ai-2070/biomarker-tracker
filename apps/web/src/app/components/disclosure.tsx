import type { ReactNode, Ref } from "react";
import { Accordion } from "@base-ui/react/accordion";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronIcon } from "./icons";
import { cx } from "./ui";

/**
 * Progressive disclosure, so long pages read as a short list first: a summary on every fold, the
 * detail one tap away. Folds sit in a FoldGroup (lines between them, no boxes); lists of findings,
 * claims or levers use Rows (one line each, open for the detail and sources); smaller reveals
 * ("Show as a table", "Why this grade, and sources") use More. Height animates with the panel's own
 * CSS variable; reduced motion stops it (index.css).
 *
 * Closed panels stay in the page as hidden="until-found", like a closed <details>: the browser's
 * find-in-page opens them, and `reveal` (for in-page links) does the same. Use these, not <details>.
 */

const panelMotion =
  "overflow-hidden transition-[height,opacity] duration-200 ease-[var(--ease-soft)] data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none";

/** Opens every closed fold around an element, e.g. before scrolling to it. */
export function reveal(el: Element) {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    // Do what the browser does for find-in-page: show the panel, then tell Base UI, which opens it.
    if (parent.getAttribute("hidden") === "until-found") {
      parent.removeAttribute("hidden");
      parent.dispatchEvent(new Event("beforematch", { bubbles: true }));
    }
  }
}

/** A group of folds, separated by hairlines, no card around each. */
export function FoldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-col divide-y divide-line border-y border-line", className)}>{children}</div>;
}

/** One section that opens on demand: a title, a one-line summary, the content inside. */
export function Fold({ title, summary, defaultOpen = false, children }: { title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="group/trigger flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <span className="min-w-0">
          <span className="block font-serif text-xl">{title}</span>
          {summary && <span className="mt-0.5 block text-sm text-ink-2">{summary}</span>}
        </span>
        <ChevronIcon className="shrink-0 text-ink-2 transition-transform duration-200 group-data-[panel-open]/trigger:rotate-180 motion-reduce:transition-none" />
      </Collapsible.Trigger>
      <Collapsible.Panel hiddenUntilFound className={cx(panelMotion, "h-[var(--collapsible-panel-height)]")}>
        <div className="pb-5">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

const MORE_TONE = {
  /** Small grey text: "Sources", "Show as a table", "Why this grade, and sources". */
  quiet: "text-sm text-ink-2",
  /** Body-size, medium weight: a sub-section inside a card. */
  plain: "font-medium text-ink",
  /** Small, medium weight. */
  small: "text-sm font-medium text-ink",
  /** A section heading that opens (the food comparison's evidence map). */
  heading: "font-serif text-xl text-ink",
  /** A small uppercase label (Brain's "3 steps"). */
  label: "font-mono text-[11px] tracking-[0.12em] text-ink-2 uppercase",
} as const;

/**
 * A small reveal inside a page or card: a one-line label with a chevron, the content below. `boxed`
 * puts it in a bordered box with the chevron on the right (optional form fields, a table view).
 */
export function More({
  summary,
  children,
  tone = "quiet",
  boxed = false,
  defaultOpen,
  open,
  onOpenChange,
  id,
  ref,
  className,
  summaryClassName,
  panelClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  tone?: keyof typeof MORE_TONE;
  boxed?: boolean;
  defaultOpen?: boolean;
  /** Controlled open state, with onOpenChange. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  ref?: Ref<HTMLDivElement>;
  className?: string;
  summaryClassName?: string;
  /** Around the content when open (boxed folds usually want "border-t border-line p-3"). */
  panelClassName?: string;
}) {
  return (
    <Collapsible.Root
      {...(id ? { id } : {})}
      {...(ref ? { ref } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange: (o: boolean) => onOpenChange(o) } : {})}
      className={cx(boxed && "rounded-lg border border-line", className)}
    >
      <Collapsible.Trigger
        className={cx(
          "group/trigger flex min-h-11 w-full cursor-pointer items-center text-left",
          boxed ? "justify-between gap-2 px-3 py-2 font-medium text-ink" : cx("gap-1.5 py-2 hover:text-ink", MORE_TONE[tone]),
          summaryClassName,
        )}
      >
        {!boxed && <ChevronIcon width={14} height={14} className="shrink-0 -rotate-90 transition-transform duration-200 group-data-[panel-open]/trigger:rotate-0 motion-reduce:transition-none" />}
        <span className="min-w-0">{summary}</span>
        {boxed && <ChevronIcon width={16} height={16} className="shrink-0 text-ink-2 transition-transform duration-200 group-data-[panel-open]/trigger:rotate-180 motion-reduce:transition-none" />}
      </Collapsible.Trigger>
      <Collapsible.Panel hiddenUntilFound className={cx(panelMotion, "h-[var(--collapsible-panel-height)]")}>
        <div className={cx(!boxed && "pb-2", panelClassName)}>{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/** A list of one-line rows that open for detail (findings, claims, levers). */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Accordion.Root multiple className={cx("flex flex-col divide-y divide-line", className)}>
      {children}
    </Accordion.Root>
  );
}

/** One row: what it is on the left, a short status on the right; the rest when opened. */
export function Row({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <Accordion.Item>
      <Accordion.Header>
        <Accordion.Trigger className="group/trigger flex min-h-12 w-full cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-left hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <span className="min-w-0 flex-1 font-medium">{title}</span>
          <span className="flex shrink-0 items-center gap-2">
            {aside}
            <ChevronIcon width={16} height={16} className="text-ink-2 transition-transform duration-200 group-data-[panel-open]/trigger:rotate-180 motion-reduce:transition-none" />
          </span>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Panel hiddenUntilFound className={cx(panelMotion, "h-[var(--accordion-panel-height)]")}>
        <div className="flex flex-col gap-2 pb-4">{children}</div>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

/** Small status chip next to a row's title (verdict, effect); always a word, never colour alone. */
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "accent" }) {
  const tones = { neutral: "bg-sunken text-ink-2", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", danger: "bg-danger-soft text-danger", accent: "bg-accent-soft text-accent" };
  return <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}
