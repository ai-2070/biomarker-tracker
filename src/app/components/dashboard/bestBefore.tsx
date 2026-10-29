import { useEffect, useMemo, useState } from "react";
import { todayIso } from "../../../core/dates";
import { framinghamRisk, heartAgeData } from "../../../core/heartAge";
import { LIFE_TABLE_COUNTRIES, bestBeforeMoments, bestBeforeWithShift, phenoAgeShift, tableFor, type LifeTableFile } from "../../../core/lifeTable";
import { mortalityFromPhenoAge } from "../../../core/phenoage";
import { summarizePhenoAge } from "../../../core/phenoageDraws";
import type { Citation, Measurement, Profile, ProtocolEntry } from "../../../core/types";
import { setProfile } from "../../../db/db";
import { formatDate } from "../../format";
import { href } from "../../router";
import { StudyLink } from "../evidence";
import { Card } from "../ui";
import { SimpleSelect } from "../UnitSelect";

const LIU_2018: Citation = {
  pmid: "30596641",
  doi: "10.1371/journal.pmed.1002718",
  title: "A new aging measure captures morbidity and mortality risk across diverse subpopulations from NHANES IV: A cohort study",
  year: 2018,
  studyType: "observational",
  n: 11617,
};
const JHA_2013: Citation = {
  pmid: "23343063",
  doi: "10.1056/NEJMsa1211128",
  title: "21st-century hazards of smoking and benefits of cessation in the United States",
  year: 2013,
  studyType: "observational",
};

const label = "font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase";
const exact = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`;
const yrs = (v: number) => v.toFixed(1);

/**
 * "Expiration date": the moment by which half of the people like you have died, from Eurostat's life table
 * for your country and sex, read at your PhenoAge when your blood tests allow (people like you by your
 * blood tests), otherwise at your age. Shown to the second, with what it is, the range around it, and
 * everything it leaves out. Never a prediction of one person's death.
 */
export function BestBefore({ measurements, profile, protocols }: { measurements: readonly Measurement[]; profile: Profile; protocols: readonly ProtocolEntry[] }) {
  const [file, setFile] = useState<LifeTableFile>();
  useEffect(() => {
    void import("../../../../knowledge/lifetables/eurostat.json").then((m) => setFile(m.default as LifeTableFile));
  }, []);
  const today = todayIso();
  const draws = useMemo(
    () =>
      summarizePhenoAge(measurements, profile.birthMonth)
        .draws.filter((d) => d.status === "ok" && d.phenoAge !== undefined && d.age !== undefined)
        .map((d) => ({ date: d.date, age: d.age!, phenoAge: d.phenoAge! })),
    [measurements, profile.birthMonth],
  );

  if (!profile.birthMonth) {
    return (
      <Card className="flex flex-col gap-2">
        <p className={label}>Expiration date</p>
        <p className="text-ink-2">Add your month and year of birth (Settings → Your data) to see it.</p>
      </Card>
    );
  }
  if (!file) return null;
  const found = tableFor(file, profile.country, profile.sex);
  if (!found) {
    return (
      <Card className="flex flex-col gap-3">
        <p className={label}>Expiration date</p>
        <p className="max-w-3xl text-ink-2">It uses the official life table of the country you live in. Choose it to see your expiration date (it's saved in your profile, on this computer).</p>
        <SimpleSelect
          label="Country you live in"
          options={[
            { value: "unset", label: "Choose…" },
            ...Object.entries(LIFE_TABLE_COUNTRIES)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([value, name]) => ({ value, label: value === "EU27_2020" ? "Somewhere else in the EU (EU average)" : name })),
          ]}
          value="unset"
          onChange={(v) => v !== "unset" && void setProfile({ ...profile, country: v })}
          className="sm:max-w-sm"
        />
      </Card>
    );
  }

  const shift = phenoAgeShift(draws);
  const plain = bestBeforeMoments(found.table, profile.birthMonth, today);
  const mine = shift ? bestBeforeWithShift(found.table, profile.birthMonth, today, shift.shift) : undefined;
  const head = mine ?? plain;
  const who = found.sex === "f" ? "women" : found.sex === "m" ? "men" : "people";
  const where = found.name;
  const ageNow = Math.floor(plain.age);

  // Measured on their own, not added in: each overlaps with the others and with PhenoAge.
  const latest = draws.at(-1);
  const heart = heartAgeData(profile, measurements, protocols, today);
  const heartRisk = heart.input && !heart.outOfRange ? framinghamRisk(heart.input) : undefined;

  // The range as a line from today to a little past the last quarter.
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = head.threeQuartersAt + (head.threeQuartersAt - start) * 0.06;
  const pos = (ms: number) => `${(((ms - start) / (end - start)) * 100).toFixed(2)}%`;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className={label}>Expiration date</p>
        <p className="font-serif text-3xl leading-tight tabular-nums sm:text-5xl">{exact.format(new Date(head.medianAt))}</p>
        <p className="text-sm text-ink-2">Time zone: {zone}</p>
        <p className="max-w-3xl">
          {mine && shift ? (
            <>
              Half of {who} in {where} whose blood tests look like yours live past this moment, and half don't. Your PhenoAge runs{" "}
              <span className="font-medium">
                {yrs(Math.abs(shift.shift))} years {shift.shift < 0 ? "younger" : "older"}
              </span>{" "}
              than your age ({shift.tests === 1 ? "1 test" : `average of ${shift.tests} tests`}, {formatDate(shift.from)}
              {shift.tests > 1 ? ` to ${formatDate(shift.to)}` : ""}), so you're compared with {who} aged {yrs(mine.comparedAge)}.
            </>
          ) : (
            <>
              Half of {who} aged {ageNow} in {where} live past this moment, and half don't. Add blood tests with the 9 PhenoAge markers to compare you
              with {who} whose blood tests look like yours.
            </>
          )}
        </p>
        {mine && (
          <p className="text-sm text-ink-2">
            For an average {found.sex === "f" ? "woman" : found.sex === "m" ? "man" : "person"} aged {ageNow} in {where}: {day.format(new Date(plain.medianAt))}.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="relative h-2 rounded-full bg-sunken" aria-hidden="true">
          <span className="absolute inset-y-0 rounded-full bg-accent/25" style={{ left: pos(head.quarterAt), right: `calc(100% - ${pos(head.threeQuartersAt)})` }} />
          <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: pos(head.medianAt) }} />
          <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: "0%" }} />
        </div>
        <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-ink-2">
          <span>Today</span>
          <span>A quarter die before {day.format(new Date(head.quarterAt))}</span>
          <span>A quarter live past {day.format(new Date(head.threeQuartersAt))}</span>
        </p>
        <p className="text-sm">
          On average, {yrs(head.expectancy)} more years (life expectancy {mine ? `of ${who} aged ${yrs(mine.comparedAge)}` : `at ${ageNow}`}).
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Measured on their own, not added in</h3>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {latest && (
            <li>
              Your latest PhenoAge, {yrs(latest.phenoAge)} ({formatDate(latest.date)}), stands for a {pct(mortalityFromPhenoAge(latest.phenoAge))} risk of dying in the
              next 10 years in the model it comes from (US adults).
            </li>
          )}
          {heartRisk !== undefined && (
            <li>
              Heart attack, stroke or similar in the next 10 years: {pct(heartRisk)} (Framingham, from your blood pressure, weight and smoking).{" "}
              <a href={href({ name: "phenoage" })} className="text-accent">
                Heart age
              </a>
            </li>
          )}
          {profile.smoking === "current" && (
            <li>
              In a large US study, current smokers lived more than 10 years less than people who never smoked; people who stopped at 25 to 34, 35 to 44 or 45 to 54
              gained about 10, 9 and 6 years.
            </li>
          )}
          <li>
            Fitness (VO₂max), steps, sleep and weight are on the Body page. They aren't added in: they overlap with PhenoAge and with each other (smoking and
            fitness show in CRP and white cells, for example), and no study has measured them together, so adding their risks would count the same thing more
            than once.
          </li>
        </ul>
      </section>

      <details className="max-w-3xl">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">How it's worked out, and what it can't say</summary>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
          <li>
            The date is the median of a life table: of 100,000 {who} alive at the age you're compared with, the moment when 50,000 are still alive. It's worked out to the
            second from the life table and the middle of your birth month, and moves a little each day, because surviving another day changes who you're compared with.
          </li>
          <li>
            Life table: Eurostat, {where}, {found.year}, {who} (survivors at each age; past 95 they fall at a constant rate, a standard approximation).{" "}
            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-accent">
              Eurostat demo_mlifetable
            </a>
          </li>
          {mine && (
            <li>
              PhenoAge is "the expected age within the population that corresponds to a person's estimated mortality risk" (Liu et al. 2018), so {who} like you by your
              blood tests are {who} of your PhenoAge. It assumes your difference stays the same for the rest of your life; PhenoAge was built and tested in US adults, and
              its authors say it still needs testing in other groups and over time.
            </li>
          )}
          <li>
            A life table uses one year's death rates. People alive today will probably live a little longer than it says, as death rates have mostly fallen over time.
          </li>
          <li>Nobody can predict when one person will die: the range above is the honest part. This is general information, not medical advice and not a medical device.</li>
        </ul>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
          <li>
            <StudyLink s={LIU_2018} />
          </li>
          {profile.smoking === "current" && (
            <li>
              <StudyLink s={JHA_2013} />
            </li>
          )}
        </ul>
      </details>
    </Card>
  );
}
