import { LIFE_TABLE_COUNTRIES } from "@bt/shared/core/lifeTable";
import { PROFILE_DETAIL_LABELS } from "@bt/shared/core/profileCompletion";
import { flagMeasurement, isCritical } from "@bt/shared/core/trends";
import { formatValue } from "@bt/shared/core/units";
import { CriticalBanner } from "../../components/CriticalBanner";
import { CheckIcon, FlagBadge } from "../../components/ui";
import { formatDate, showMeasurement, valueUnit } from "../../format";
import { useProfile } from "../../hooks";
import { BIOMARKER_MAP, fullName } from "../../knowledge";
import { href } from "../../router";
import { closeBrain, type Turn } from "../store";

const birthMonthFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const PROFILE_VALUE_LABELS: Record<string, string> = {
  m: "Male",
  f: "Female",
  omnivore: "Eats everything",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian (fish, no meat)",
  other: "Other or special diet",
  never: "Never smoked",
  former: "Former smoker",
  current: "Currently smokes",
};

export function ProfileTurn({ turn }: { turn: Extract<Turn, { role: "profile" }> }) {
  const profile = useProfile();
  const readings = turn.measurements.flatMap((m) => {
    const def = BIOMARKER_MAP.get(m.biomarkerId);
    return def ? [{ m, def, flag: flagMeasurement(def, m, profile) }] : [];
  });
  const critical = readings.filter(({ flag }) => isCritical(flag)).map(({ m, def, flag }) => ({ def, measurement: m, low: flag === "critical-low" }));
  return (
    <div className="rounded-xl border border-line bg-ok-soft p-3 text-sm">
      <CriticalBanner items={critical} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 font-medium">
          <CheckIcon className="size-4 shrink-0 text-ok" />
          {turn.changes.length ? (readings.length ? "Added to your profile and data" : "Added to your profile") : "Saved measurements"}
        </p>
        {turn.changes.length > 0 && (
          <a
            href={href({ name: "data", tab: "data" })}
            onClick={closeBrain}
            className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2"
          >
            Edit profile
          </a>
        )}
      </div>
      <dl className="mt-1 space-y-1 break-words">
        {turn.changes.map(({ field, value }) => {
          const shown =
            field === "heightCm"
              ? `${formatValue(Number(value))} cm`
              : field === "birthMonth"
                ? birthMonthFormat.format(new Date(`${value}-15T12:00:00`))
                : field === "country"
                  ? (LIFE_TABLE_COUNTRIES[String(value)] ?? String(value))
                  : field === "sex" || field === "diet" || field === "smoking"
                    ? (PROFILE_VALUE_LABELS[String(value)] ?? String(value))
                    : String(value);
          return (
            <div key={field}>
              <dt className="inline font-medium">{PROFILE_DETAIL_LABELS[field]}: </dt>
              <dd className="inline">{shown}</dd>
            </div>
          );
        })}
      </dl>
      {readings.length > 0 && (
        <>
          <ul className="mt-2 divide-y divide-line">
            {readings.map(({ m, def, flag }) => (
              <li key={m.id}>
                <a
                  href={href({ name: "marker", id: def.id })}
                  onClick={closeBrain}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-ink underline underline-offset-2"
                >
                  <span>{fullName(def)}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {showMeasurement(def, m, def.canonicalUnit)} {valueUnit(def, def.canonicalUnit)}
                    {flag !== "normal" && flag !== "unknown" && <FlagBadge flag={flag} />}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-2">
            Saved for {formatDate(readings[0]!.m.date)} from your current statement. Open a result to edit or delete it.
          </p>
        </>
      )}
    </div>
  );
}
