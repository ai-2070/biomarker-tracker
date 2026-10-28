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

/** Log entries drawn as bars on the same time axis as the chart above. */
export function ProtocolLanes({
  protocols,
  from,
  to,
  today,
}: {
  protocols: ProtocolEntry[];
  from: string;
  to: string;
  today: string;
}) {
  const lanes = sortProtocols(protocols)
    .map((p) => ({ p, lane: laneFor(p, from, to, today) }))
    .filter((x): x is { p: ProtocolEntry; lane: NonNullable<ReturnType<typeof laneFor>> } => x.lane !== undefined);

  if (lanes.length === 0) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
        From your log
        <a href={href({ name: "log" })} className="font-normal text-ink-2 underline underline-offset-2">
          Edit log
        </a>
      </p>
      <ul className="flex flex-col gap-2">
        {lanes.map(({ p, lane }) => (
          <li key={p.id}>
            <p className="truncate text-sm">
              {p.label}{" "}
              <span className="text-ink-2">
                · {CATEGORY_LABEL[p.category]}, {p.end ? `${formatDate(p.start)} – ${formatDate(p.end)}` : `since ${formatDate(p.start)}`}
              </span>
            </p>
            <div className="relative h-2" style={{ marginLeft: PLOT_INSET.left, marginRight: PLOT_INSET.right }} aria-hidden="true">
              <div className="absolute inset-y-0 w-full rounded-full bg-sunken" />
              <div
                className={cx("absolute inset-y-0 bg-ink-2/60", lane.cutStart ? "rounded-l-none" : "rounded-l-full", lane.cutEnd ? "rounded-r-none" : "rounded-r-full")}
                style={{ left: `${lane.leftPct}%`, width: `${lane.widthPct}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
