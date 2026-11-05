import { clockFindingsAbout, type ClockAbout } from "@bt/core/clocks";
import { CLOCK_FILE } from "../knowledge";
import { href } from "../router";
import { GradeDots } from "./evidence";
import { Findings } from "./findings";
import { Card } from "./ui";

/**
 * Biological age page: what has moved PhenoAge, DunedinPACE and other clocks in people, graded like any
 * finding, under the plain caveat that the clocks are stand-ins.
 */
export function ClockEvidence() {
  if (!CLOCK_FILE) return null;
  return (
    <div id="clock-evidence" className="flex scroll-mt-6 flex-col gap-3">
      <p role="note" className="max-w-3xl rounded-lg bg-warn-soft px-3 py-2 text-sm">
        {CLOCK_FILE.caveat}
      </p>
      <Findings prefix="clock" title="What has moved these clocks in studies" intro={CLOCK_FILE.intro} findings={CLOCK_FILE.findings} />
    </div>
  );
}

/** On a supplement, food or lifestyle page: what aging-clock studies found about it, linking to the Biological age page. */
export function ClockNote({ kind, id }: { kind: ClockAbout["kind"]; id: string }) {
  const found = clockFindingsAbout(CLOCK_FILE, kind, id);
  if (!found.length) return null;
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="font-semibold">Aging clocks</h2>
      <ul className="flex flex-col gap-1.5">
        {found.map((f) => (
          <li key={f.outcome} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{f.label}</span>
            <span className="text-ink-2">{f.line}</span>
            <span className="flex items-center gap-1 text-xs text-ink-2">
              <GradeDots grade={f.grade} /> {f.grade[0]!.toUpperCase() + f.grade.slice(1)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-2">
        Clocks such as PhenoAge and DunedinPACE are stand-ins: nobody has shown that lowering them adds years.{" "}
        <a href={href({ name: "phenoage" })} className="text-accent">
          What has moved these clocks
        </a>
      </p>
    </Card>
  );
}
