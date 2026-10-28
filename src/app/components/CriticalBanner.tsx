import type { BiomarkerDef, Measurement } from "../../core/types";
import { formatDate, showMeasurement } from "../format";
import { fullName } from "../knowledge";
import { href } from "../router";

export interface CriticalItem {
  def: BiomarkerDef;
  measurement: Measurement;
  low: boolean;
}

/**
 * Urgent banner for values far outside the usual range.
 * Shown before anything else on the page, with no interpretation.
 */
export function CriticalBanner({ items }: { items: CriticalItem[] }) {
  if (items.length === 0) return null;
  return (
    <div role="alert" className="mb-5 rounded-xl border-2 border-danger-strong bg-danger-soft p-4 text-ink">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-danger-strong text-sm font-bold text-white">
          !
        </span>
        Please contact a doctor soon
      </p>
      <p className="mt-2">
        {items.length === 1 ? "This result is" : "These results are"} far outside the usual range. Contact your doctor (for a blood
        test, or the lab that did it). If you feel unwell, call your local emergency number.
      </p>
      <ul className="mt-3 flex flex-col gap-1">
        {items.map(({ def, measurement, low }) => (
          <li key={measurement.id}>
            <a href={href({ name: "marker", id: def.id })} className="font-medium underline underline-offset-2">
              {fullName(def)}: {showMeasurement(def, measurement, def.canonicalUnit)} {def.canonicalUnit}
            </a>{" "}
            <span className="text-ink-2">
              ({low ? "very low" : "very high"}, {formatDate(measurement.date)})
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink-2">
        A wrong unit or a damaged sample can also cause this. If you think the value was entered wrongly, check it against your lab
        report.
      </p>
    </div>
  );
}
