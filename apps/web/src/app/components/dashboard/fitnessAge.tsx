import { todayIso } from "@bt/core/dates";
import { HUNT_VO2MAX, fitnessAge, vo2maxForAge } from "@bt/core/fitnessAge";
import { ageAt } from "@bt/core/phenoageDraws";
import { sortByDate } from "@bt/core/trends";
import type { Measurement, Profile } from "@bt/core/types";
import { formatDate, formatYears } from "../../format";
import { href } from "../../router";
import { Card, LinkButton, Notice } from "../ui";
import { Figure } from "./widgets";
import { PaperLink } from "../PaperLink";

const PAPER_URL = "https://pubmed.ncbi.nlm.nih.gov/23691196/";
const big = "font-serif text-4xl leading-none tabular-nums sm:text-5xl";

/** Latest VO₂max with fitness age, or what's missing. */
function fitnessOf(ms: readonly Measurement[], profile: Profile) {
  const last = sortByDate(ms.filter((m) => m.biomarkerId === "vo2max")).at(-1);
  const missing = [!last && "a VO₂max (from a watch, a lab test or typed in)", !profile.sex && "your sex", !profile.birthMonth && "your month and year of birth"].filter(Boolean) as string[];
  if (!last || !profile.sex || !profile.birthMonth) return { missing };
  const age = ageAt(profile.birthMonth, todayIso());
  return { missing, last, age, fit: fitnessAge(last.value, profile.sex), group: vo2maxForAge(last.value, age, profile.sex) };
}

function ageText(f: ReturnType<typeof fitnessAge>): string {
  return f.bound === "younger" ? "25 or younger" : f.bound === "older" ? "75 or older" : formatYears(f.age);
}

function comparison(fitAge: number, age: number, bound?: "younger" | "older"): string {
  if (bound === "younger") return "At or above the average fitness of healthy 20–29-year-olds; no exact age comparison";
  if (bound === "older") return "At or below the average fitness of healthy people aged 70 and over; no exact age comparison";
  const d = fitAge - age;
  if (Math.abs(d) < 1) return "About your age";
  return `${formatYears(Math.abs(d))} ${d > 0 ? "older" : "younger"} than your age (${formatYears(age)})`;
}

export function FitnessAgeFigure({ ms, profile, className }: { ms: Measurement[]; profile: Profile; className?: string }) {
  const f = fitnessOf(ms, profile);
  return (
    <Figure
      label="Fitness age"
      href={href({ name: "phenoage" })}
      className={className}
      foot={f.fit ? `${comparison(f.fit.age, f.age!, f.fit.bound)}. From VO₂max, compared with healthy Norwegians.` : `Needs ${f.missing.join(", ")}.`}
    >
      {f.fit ? (
        <p className="flex items-baseline gap-1.5">
          <span className={big}>{ageText(f.fit)}</span>
          {!f.fit.bound && <span className="text-ink-2">years</span>}
        </p>
      ) : (
        <p className="font-serif text-4xl text-ink-2">–</p>
      )}
    </Figure>
  );
}

export function FitnessAgeSection({ ms, profile }: { ms: Measurement[]; profile: Profile }) {
  const f = fitnessOf(ms, profile);
  const sex = profile.sex;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">Fitness age</h2>
        <p className="text-ink-2">From VO₂max: the age at which healthy people, measured on a treadmill, had the same aerobic fitness on average.</p>
      </div>
      {!f.fit ? (
        <Notice title="Not enough to calculate it yet">
          <p>It needs {f.missing.join(", ")}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton variant="secondary" href={href({ name: "device-import" })}>
              Import from a device
            </LinkButton>
            <LinkButton variant="secondary" href={href({ name: "add", kind: "body" })}>
              Add measurements
            </LinkButton>
          </div>
        </Notice>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <p className="flex items-baseline gap-2">
              <span className="font-serif text-6xl leading-none tabular-nums">{ageText(f.fit)}</span>
              {!f.fit.bound && <span className="text-ink-2">years</span>}
            </p>
            <p className="text-ink">{comparison(f.fit.age, f.age!, f.fit.bound)}</p>
          </div>
          <p className="text-ink-2">
            Your VO₂max: <span className="font-medium text-ink">{f.last!.value.toFixed(1)} mL/kg/min</span> ({formatDate(f.last!.date)}). Healthy{" "}
            {sex === "m" ? "men" : "women"} aged {f.group!.group} averaged {f.group!.mean} (most between {(f.group!.mean - f.group!.sd).toFixed(1)} and{" "}
            {(f.group!.mean + f.group!.sd).toFixed(1)}).
          </p>
          <table className="w-full max-w-md text-sm">
            <caption className="mb-1 text-left text-ink-2">Average VO₂max of healthy {sex === "m" ? "men" : "women"} by age</caption>
            <tbody>
              {HUNT_VO2MAX[sex!].map((r) => (
                <tr key={r.age} className="border-t border-line">
                  <td className="py-1 text-ink-2">{r.age === 75 ? "70 and over" : `${r.age - 5}–${r.age + 4}`}</td>
                  <td className="py-1 text-right tabular-nums">{r.mean.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="flex flex-col gap-2 text-sm text-ink-2">
        <p>
          <span className="font-medium text-ink">Source: </span>
          treadmill tests of 3,816 healthy adults aged 20–90 in the HUNT 3 Fitness Study, Norway (
          <PaperLink href={PAPER_URL} source={{ title: "Aerobic capacity reference data in 3816 healthy men and women 20-90 years", authors: "Loe et al.", journal: "PLoS One", year: 2013, n: 3816 }} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
            Loe et al., PLoS One 2013
          </PaperLink>
          ). Group averages are placed at the middle of each age group and joined with straight lines.
        </p>
        <p>
          <span className="font-medium text-ink">Limits: </span>
          an estimate, not a verdict. Watches estimate VO₂max from heart rate and pace and can be several points off a lab test. The
          reference group is healthy Norwegian volunteers, who were fitter than many populations, so the result may come out a little old.
        </p>
      </div>
    </Card>
  );
}
