import { cx } from "./ui";
import { href } from "../router";

/** Switch between the summary of one test and the summary of a year. */
export function SummaryTabs({ current }: { current: "test" | "year" }) {
  const tab = (active: boolean) =>
    cx("inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium no-underline", active ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink");
  return (
    <nav aria-label="Summary" className="flex gap-1 rounded-xl border border-line bg-surface p-1 self-start">
      <a href={href({ name: "test-summary" })} className={tab(current === "test")} aria-current={current === "test" ? "page" : undefined}>
        One test
      </a>
      <a href={href({ name: "period-summary" })} className={tab(current === "year")} aria-current={current === "year" ? "page" : undefined}>
        A year
      </a>
    </nav>
  );
}
