import { todayIso } from "@bt/shared/core/dates";
import { criticalResults } from "@bt/shared/core/importers/resultProposal";
import { flagMeasurement, isCritical } from "@bt/shared/core/trends";
import type { Measurement } from "@bt/shared/core/types";
import { CriticalBanner, type CriticalItem } from "../../components/CriticalBanner";
import { FileIcon } from "../../components/icons";
import { Review } from "../../components/LabReview";
import { Button, FlagBadge } from "../../components/ui";
import { formatDate, showMeasurement, valueUnit } from "../../format";
import { useProfile } from "../../hooks";
import { BIOMARKER_MAP, fullName } from "../../knowledge";
import { uploadFile, useProfiles } from "../../profiles";
import { href } from "../../router";
import { closeBrain, keepReportFiles, send, type Turn, updateTurn } from "../store";

/** A lab report dropped into Brain, or results Brain read from pictures: check the values, then save them. */
export function ReviewTurn({ turn, model }: { turn: Extract<Turn, { role: "review" }>; model: string }) {
  const { mode, active } = useProfiles();

  async function saved(list: Measurement[], skipped: number, date: string) {
    const note = `${turn.kind === "body" ? "Body measurements" : "Lab report"} from ${date}, ${list.length} ${list.length === 1 ? "value" : "values"} saved (via Brain)`;
    const { kept, errors } = mode === "folders" && active ? await keepReportFiles(active.id, turn.files, note, uploadFile) : { kept: [], errors: [] };
    updateTurn(turn.id, {
      state: "saved",
      saved: list,
      skipped,
      date,
      ...(kept.length ? { kept: kept.join(", ") } : {}),
      ...(errors.length ? { keepError: errors.join("; ") } : {}),
    });
  }

  if (turn.state === "dismissed") return <p className="text-center text-sm text-ink-2">Nothing saved from {turn.fileName}.</p>;
  if (turn.state === "saved") return <SavedReview turn={turn} model={model} />;
  // Results read from a picture that are far out of range, as read: the urgent banner comes before anything else.
  const critical: CriticalItem[] = turn.fromPicture
    ? criticalResults(turn.report, BIOMARKER_MAP).flatMap((c, i) => {
        const def = BIOMARKER_MAP.get(c.biomarkerId);
        if (!def) return [];
        const measurement: Measurement = {
          id: `${turn.id}-critical-${i}`,
          biomarkerId: def.id,
          value: c.value,
          originalValue: c.value,
          originalUnit: def.canonicalUnit,
          date: turn.report.date ?? todayIso(),
          source: "photo",
          ...(c.qualifier ? { qualifier: c.qualifier } : {}),
        };
        return [{ def, measurement, low: c.low }];
      })
    : [];
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sunken p-3">
      {critical.length > 0 && (
        <div>
          <CriticalBanner items={critical} />
          <p className="-mt-3 px-1 text-sm text-ink-2">As Brain read {critical.length === 1 ? "it" : "them"} from the picture: check against the report.</p>
        </div>
      )}
      <p className="flex items-center gap-2 px-1 text-sm">
        <FileIcon className="size-4 shrink-0 text-ink-2" />
        <span className="min-w-0 truncate font-medium">{turn.fileName}</span>
        <span className="shrink-0 text-ink-2">· {turn.fromPicture ? "read by Brain" : "read on this computer"}</span>
      </p>
      <Review
        fileName={turn.fileName}
        fromPicture={turn.fromPicture}
        report={turn.report}
        inChat
        kind={turn.kind ?? "lab"}
        onCancel={() => updateTurn(turn.id, { state: "dismissed" })}
        onSaved={(l, s, d) => void saved(l, s, d)}
      />
    </div>
  );
}

/** The review card after saving: what was saved, with links and follow-up questions. */
function SavedReview({ turn, model }: { turn: Extract<Turn, { role: "review" }>; model: string }) {
  const profile = useProfile();
  const list = (turn.saved ?? []).flatMap((m) => {
    const def = BIOMARKER_MAP.get(m.biomarkerId);
    return def ? [{ m, def, flag: flagMeasurement(def, m, profile) }] : [];
  });
  const critical = list.filter((x) => isCritical(x.flag)).map((x) => ({ def: x.def, measurement: x.m, low: x.flag === "critical-low" }));
  const when = turn.date ? formatDate(turn.date) : "";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
      <CriticalBanner items={critical} />
      <p>
        <span className="font-medium">
          Saved {list.length} {list.length === 1 ? "result" : "results"}
        </span>{" "}
        {turn.kind === "body" ? `measured on ${when}` : `from the blood test on ${when}`}.
        {(turn.skipped ?? 0) > 0 && ` ${turn.skipped} ${turn.skipped === 1 ? "was" : "were"} already saved.`}
        {turn.kept && <span className="text-ink-2"> The report is kept in this profile's folder.</span>}
      </p>
      {turn.keepError && <p className="text-sm text-warn">The report itself couldn't be kept in the profile folder: {turn.keepError}</p>}
      {list.length > 0 && (
        <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {list.map(({ m, def, flag }) => (
            <li key={m.id}>
              <a
                href={href({ name: "marker", id: def.id })}
                onClick={() => window.matchMedia("(max-width: 1023px)").matches && closeBrain()}
                className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5 text-sm text-ink no-underline hover:bg-sunken"
              >
                <span className="min-w-0 truncate">{fullName(def)}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums">
                    {showMeasurement(def, m, def.canonicalUnit)} {valueUnit(def, def.canonicalUnit)}
                  </span>
                  {flag !== "normal" && <FlagBadge flag={flag} />}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && critical.length === 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              void send(
                model,
                turn.kind === "body"
                  ? `Explain the body measurements from ${when} that I just added, compared with my earlier ones.`
                  : `Explain my results from the blood test on ${when} that I just added. Which are outside the range, and what can affect them?`,
              )
            }
          >
            Explain these results
          </Button>
          <Button
            variant="quiet"
            onClick={() =>
              void send(
                model,
                turn.kind === "body"
                  ? `How do my body measurements from ${when} compare with the weeks before?`
                  : `What changed in my blood test on ${when} compared with my earlier tests?`,
              )
            }
          >
            What changed?
          </Button>
        </div>
      )}
    </div>
  );
}
