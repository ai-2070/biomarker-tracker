import { todayIso } from "../../core/dates";
import { analyzeMarker, experimentPhase, markersAwaitingRetest, retestDate, type MarkerResult } from "../../core/experiments";
import type { Experiment, Measurement } from "../../core/types";
import { formatDate } from "../format";
import { useExperiments, useWatchMeasurements } from "../hooks";
import { watchDef } from "../knowledge";
import { href } from "../router";

/** Reminder on the results page for experiments whose re-test is due. */
export function DueExperiments({ all: results }: { all: Measurement[] }) {
  const experiments = useExperiments() ?? [];
  const all = useWatchMeasurements(results) ?? results;
  const today = todayIso();
  const due = experiments.flatMap((e: Experiment) => {
    const results: MarkerResult[] = e.markerIds.flatMap((id) => {
      const def = watchDef(id);
      return def ? [analyzeMarker(e, def, all)] : [];
    });
    return experimentPhase(results, e, today) === "due" ? [{ e, markers: markersAwaitingRetest(results) }] : [];
  });
  if (due.length === 0) return null;
  return (
    <div className="mb-5 flex flex-col gap-2">
      {due.map(({ e, markers }) => (
        <a
          key={e.id}
          href={href({ name: "experiment", id: e.id })}
          className="flex items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-soft p-4 text-ink no-underline"
        >
          <span>
            <span className="block font-medium">Time to re-test: {markers.map((id) => watchDef(id)?.name ?? id).join(", ")}</span>
            <span className="text-sm text-ink-2">
              For your experiment "{e.change}", due since {formatDate(retestDate(e))}.
            </span>
          </span>
          <span aria-hidden="true" className="text-xl">→</span>
        </a>
      ))}
    </div>
  );
}
