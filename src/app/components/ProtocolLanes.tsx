import { laneFor, sortProtocols } from "../../core/protocols";
import type { ProtocolEntry } from "../../core/types";
import { CATEGORY_LABEL, formatDate } from "../format";
import { href } from "../router";
import { cx } from "./ui";

/** Layout numbers shared with TrendChart so bars line up with the chart's time axis. */
export const CHART_LAYOUT = { yAxisWidth: 44, padX: 20, marginRight: 12 };
const PLOT_INSET = {
  left: CHART_LAYOUT.yAxisWidth + CHART_LAYOUT.padX,
  right: CHART_LAYOUT.marginRight + CHART_LAYOUT.padX,
};

/**
 * Log entries drawn as bars on the same time axis as the chart above. With `onSelect`, each one is a
 * button that shades its period on the chart (pressed again: off).
 */
export function ProtocolLanes({
  protocols,
  from,
  to,
  today,
  selected,
  onSelect,
  inset = PLOT_INSET,
}: {
  protocols: ProtocolEntry[];
  from: string;
  to: string;
  today: string;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Where the chart above starts and ends horizontally, in pixels, so the bars line up with it. */
  inset?: { left: number; right: number };
}) {
  const lanes = sortProtocols(protocols)
    .map((p) => ({ p, lane: laneFor(p, from, to, today) }))
    .filter((x): x is { p: ProtocolEntry; lane: NonNullable<ReturnType<typeof laneFor>> } => x.lane !== undefined);

  if (lanes.length === 0) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
        From your habits
        <a href={href({ name: "habits" })} className="font-normal text-ink-2 underline underline-offset-2">
          Edit habits
        </a>
      </p>
      {onSelect && <p className="mb-2 text-sm text-ink-2">Choose one to shade its period on the chart.</p>}
      <ul className="flex flex-col gap-1">
        {lanes.map(({ p, lane }) => {
          const on = selected === p.id;
          const body = (
            <>
              <span className="block truncate text-sm">
                {p.label}{" "}
                <span className="text-ink-2">
                  · {p.plan ? "Protocol" : CATEGORY_LABEL[p.category]}, {p.end ? `${formatDate(p.start)} – ${formatDate(p.end)}` : `since ${formatDate(p.start)}`}
                </span>
              </span>
              <span className="relative mt-1 block h-2" style={{ marginLeft: inset.left - 8, marginRight: inset.right - 8 }} aria-hidden="true">
                <span className="absolute inset-y-0 w-full rounded-full bg-sunken" />
                <span
                  className={cx("absolute inset-y-0", on ? "bg-ink" : "bg-ink-2/60", lane.cutStart ? "rounded-l-none" : "rounded-l-full", lane.cutEnd ? "rounded-r-none" : "rounded-r-full")}
                  style={{ left: `${lane.leftPct}%`, width: `${lane.widthPct}%` }}
                />
              </span>
            </>
          );
          return (
            <li key={p.id}>
              {onSelect ? (
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(on ? null : p.id)}
                  className={cx("block w-full rounded-md px-2 py-1.5 text-left transition-colors duration-150", on ? "bg-sunken" : "hover:bg-sunken/60")}
                >
                  {body}
                </button>
              ) : (
                <div className="px-2 py-1.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
