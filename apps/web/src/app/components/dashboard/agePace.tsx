import { useMemo } from "react";
import { ageHistory } from "@bt/shared/core/ageHistory";
import { dunedinSummary, phenoAgePace } from "@bt/shared/core/agePace";
import { todayIso } from "@bt/shared/core/dates";
import { sortByDate } from "@bt/shared/core/trends";
import type { Measurement, Profile, ProtocolEntry } from "@bt/shared/core/types";
import { formatDate } from "../../format";
import { BIOMARKER_MAP } from "../../knowledge";
import { href } from "../../router";
import { StudyLink } from "../evidence";
import { Card, cx, eyebrowStyles } from "../ui";
import { PaperLink } from "../PaperLink";

const big = "font-serif text-4xl leading-none tabular-nums sm:text-5xl";
const label = eyebrowStyles;
const two = (v: number) => v.toFixed(2).replace("-", "−");

/**
 * Pace of aging, two ways: how fast this person's PhenoAge changes across their own blood tests
 * (computed here, with its uncertainty), and DunedinPACE, a DNA methylation test the app only records.
 * Kept apart: they're different measures, and neither is averaged with the other.
 */
export function PaceOfAging({ measurements, profile, protocols }: { measurements: readonly Measurement[]; profile: Profile; protocols: readonly ProtocolEntry[] }) {
  const pace = useMemo(() => phenoAgePace(ageHistory(profile, measurements, protocols).blood), [profile, measurements, protocols]);
  const dunedin = sortByDate(measurements.filter((m) => m.biomarkerId === "dunedinpace"));
  const lastDunedin = dunedin.at(-1);
  const def = BIOMARKER_MAP.get("dunedinpace");
  if (!profile.birthMonth) return null;

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="font-serif text-2xl font-normal">Pace of aging</h2>
        <p className="mt-1 max-w-3xl text-ink-2">
          How fast you age, rather than how old you seem: 1.0 means one year of aging per calendar year, below 1 slower, above 1 faster. Two
          different measures, shown apart.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 md:gap-8">
        <section className="flex flex-col gap-2">
          <p className={label}>Your PhenoAge, test to test</p>
          {pace ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={big}>{two(pace.pace)}</span>
                <span className="text-ink-2">PhenoAge years per calendar year</span>
              </p>
              <p>
                Likely between {two(pace.low)} and {two(pace.high)}.{" "}
                {pace.verdict === "falling"
                  ? "Your PhenoAge went down across these tests, even at the top of that range."
                  : pace.verdict === "slower"
                  ? "Slower than the calendar, even at the top of that range."
                  : pace.verdict === "faster"
                    ? "Faster than the calendar, even at the bottom of that range."
                    : "That range includes 1.0, so these tests can't tell it apart from the calendar's pace."}
              </p>
              <p className="text-sm text-ink-2">
                From {pace.tests} blood tests between {formatDate(pace.from)} and {formatDate(pace.to)} (the last 3 years)
                {pace.approximate > 0 ? `, ${pace.approximate} of them approximate (CRP below the lab's limit)` : ""}. One test can move PhenoAge a lot
                (an infection raises CRP), so the range is wide with few tests and narrows with more.
              </p>
            </>
          ) : (
            <p className="text-ink-2">Needs at least 3 PhenoAge results spread over a year or more. Each one needs the 9 PhenoAge markers from the same blood draw.</p>
          )}
          <p className="text-sm text-ink-2">
            Calculated by this app from your own results. It isn't DunedinPACE: PhenoAge was built to predict mortality, not to measure pace.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <p className={label}>DunedinPACE, a DNA test</p>
          {lastDunedin ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={cx(big)}>{two(lastDunedin.value)}</span>
                <span className="text-ink-2">years of aging per year · {formatDate(lastDunedin.date)}</span>
              </p>
              {dunedin.length > 1 && (
                <p className="text-sm text-ink-2">
                  {dunedin.length} results; the first was {two(dunedin[0]!.value)} on {formatDate(dunedin[0]!.date)}.
                </p>
              )}
              <DunedinScores results={dunedin} />
              <a href={href({ name: "marker", id: "dunedinpace" })} className="text-sm text-accent">
                See all results and what it means
              </a>
            </>
          ) : (
            <>
              <p className="text-ink-2">
                Not measured. It needs a DNA methylation test of a blood sample from a specialised lab, not a routine blood test. If you have a
                result, add it and it's charted here.
              </p>
              <a href={href({ name: "add", marker: "dunedinpace" })} className="text-sm text-accent">
                Add a DunedinPACE result
              </a>
            </>
          )}
          <p className="text-sm text-ink-2">
            The app records the number your lab reports and never calculates it. In studies, a faster DunedinPACE went with more illness,
            disability and earlier death; a lower number doesn't prove aging was slowed.
          </p>
          {def && (
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {def.sources.map((s) => (
                <li key={s.pmid ?? s.doi}>
                  <StudyLink s={s} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

const RO_URL = "https://www.rejuvenationolympics.com/dunedin-pace";

/**
 * DunedinPACE summed up two ways: the plain average of the tests in the 2 years up to the latest, and the
 * Rejuvenation Olympics leaderboard rule (the best 3 of them), so people can see where they'd stand
 * without the leaderboard number being taken for their true pace.
 */
export function DunedinScores({ results }: { results: readonly { date: string; value: number }[] }) {
  const s = dunedinSummary(results, todayIso());
  if (!s) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-sunken p-3 text-sm">
      <p>
        <span className="font-medium">Your average:</span> {two(s.average)} ({s.window.tests === 1 ? "1 test" : `${s.window.tests} tests`}
        {s.window.tests > 1 ? `, ${formatDate(s.window.from)} to ${formatDate(s.window.to)}` : ""}).
      </p>
      {s.bestThree ? (
        <p>
          <span className="font-medium">Leaderboard score:</span> {two(s.bestThree.value)}, the average of your best 3 of those tests, as the{" "}
          <PaperLink href={RO_URL} source={{ title: "DunedinPACE leaderboard", authors: "Rejuvenation Olympics" }} target="_blank" rel="noopener noreferrer" className="text-accent">
            Rejuvenation Olympics
          </PaperLink>{" "}
          ranks people (lower is better; its leaders average about 0.50).
        </p>
      ) : (
        <p className="text-ink-2">
          A leaderboard score (the{" "}
          <PaperLink href={RO_URL} source={{ title: "DunedinPACE leaderboard", authors: "Rejuvenation Olympics" }} target="_blank" rel="noopener noreferrer" className="text-accent">
            Rejuvenation Olympics
          </PaperLink>{" "}
          rule: the best 3 tests within 2 years) needs 3 tests in 2 years.
        </p>
      )}
      <p className="text-ink-2">
        Picking the best 3 keeps the lucky results, so the leaderboard score is always at or below your average. Your average is the better guide to
        your pace. The leaderboard's own reading of "2 years" isn't spelled out; here it's the 2 years up to your latest test, with tests under 4 years old.
      </p>
    </div>
  );
}
