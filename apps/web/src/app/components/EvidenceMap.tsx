import { useEffect, useRef, useState } from "react";
import { anyDesignKind, type Chosen, type EvidenceMapFile, type EvidenceMapOutcome, type MapKind } from "@bt/shared/core/evidenceMap";
import { formatDate } from "../format";
import { SegmentTabs } from "./SegmentTabs";
import { useWidth } from "./timeControls";
import { Button, cx } from "./ui";
import { PaperLink as PreviewPaperLink } from "./PaperLink";
import { More } from "./disclosure";

/**
 * How the evidence behind a nutrient's findings was found: every PubMed record searched, the counts left
 * at each step, and per outcome the reviews and trials chosen by written rules and a timeline,
 * and how the page's own citations compare. Data from
 * knowledge/evidence-maps (built by tools/evidence), loaded only when this section is shown.
 */

const maps = import.meta.glob<EvidenceMapFile>("../../../../../knowledge/evidence-maps/*.json", { import: "default" });

/** A map by its file name: a nutrient's id ("vitamin_d"), "food-<topic>" for the food comparison, or "lifestyle-<id>". */
export function useEvidenceMap(mapId: string): EvidenceMapFile | undefined {
  const [map, setMap] = useState<EvidenceMapFile>();
  useEffect(() => {
    const load = Object.entries(maps).find(([path]) => path.endsWith(`/${mapId}.json`))?.[1];
    if (load) void load().then(setMap);
  }, [mapId]);
  return map?.topic === mapId ? map : undefined;
}

/** Whether there is an evidence map (without loading it). */
export const hasEvidenceMap = (mapId: string) => Object.keys(maps).some((p) => p.endsWith(`/${mapId}.json`));

const n = (x: number) => x.toLocaleString("en-GB");
const REVIEW_COLOR = "var(--color-age-heart)";
const TRIAL_COLOR = "var(--color-age-blood)";

function PaperLink({ c }: { c: Pick<Chosen, "pmid" | "doi" | "title" | "year" | "firstAuthor" | "journal" | "n"> }) {
  const url = c.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/` : `https://doi.org/${c.doi}`;
  return (
    <PreviewPaperLink href={url} source={{ title: c.title, year: c.year, authors: c.firstAuthor, journal: c.journal, n: c.n }} target="_blank" rel="noopener noreferrer" className="text-ink underline-offset-2 hover:underline">
      {c.title}
    </PreviewPaperLink>
  );
}

export function EvidenceMap({ mapId, citedTitles, outcome }: { mapId: string; citedTitles: Record<string, string>; outcome?: string }) {
  const map = useEvidenceMap(mapId);
  const [outcomeId, setOutcomeId] = useState<string | undefined>(outcome);
  if (!map) return <p className="text-ink-2">Loading the evidence map…</p>;
  const o = map.outcomes.find((x) => x.id === outcomeId) ?? map.outcomes[0]!;
  const c = map.counts;
  // Food and lifestyle maps search claim by claim (or finding by finding) and count reviews of any design.
  const food = anyDesignKind(map.kind);
  const kind: MapKind = map.kind ?? "supplement";
  const claim = kind === "food" ? "claim" : "finding";
  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-3xl">
        <p className="text-ink-2">
          {food
            ? `Instead of picking studies by hand, each ${claim} has its own written search of every PubMed record, and the reviews were chosen by written rules.`
            : "Instead of picking studies by hand, every PubMed record was searched and the studies for each finding were chosen by written rules."}{" "}
          Built {formatDate(map.builtAt)} from {map.source}.
        </p>
      </div>

      <ol className={cx("grid gap-2", c.all !== undefined ? "sm:grid-cols-4" : "sm:grid-cols-3")} aria-label="From every record to the studies used">
        {c.all !== undefined && <Step big={n(c.all)} text={food ? `records match the searches for these ${claim}s` : `records mention ${map.name}${map.scope ? `, ${map.scope}` : ""}`} />}
        <Step big={n(c.retrieved)} text="are reviews, randomised trials or guidelines: all downloaded" />
        <Step big={`${n(c.reviews)} · ${n(c.trials)}`} text={`reviews · trials in people (${c.animal} animal studies and ${c.retracted} retracted papers left out)`} />
        {o.screening ? (
          <Step big={`${o.screening.counts.yes}`} text={`${o.screening.provenance === "legacy-inputs-unverified" ? "historically marked as answering" : "reviews answer"} the question (${o.label}), of ${o.counts.trialReviews} the rules found`} />
        ) : (
          <Step big={`${o.counts.trialReviews}`} text={food || o.anyDesign ? `systematic reviews of any study design (${o.label}), after the rules below` : `reviews of ${map.name} trials (${o.label}), after the rules below`} />
        )}
      </ol>

      <SegmentTabs label={food ? "Claim" : "Outcome"} tabs={map.outcomes.map((x) => ({ value: x.id, label: x.label }))} value={o.id} onChange={setOutcomeId} className="flex flex-col gap-6">
        <EvidenceOutcome o={o} name={map.name} food={food} kind={kind} citedTitles={citedTitles} />
      </SegmentTabs>

      <More summary="The rules, and what they can't do yet" tone="plain" className="max-w-3xl">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ink-2">
          {map.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
        <p className="mt-3 font-medium">What the rules can't do yet</p>
        <ul className="mt-1 flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
          <li>
            The rules and the screening read titles and abstracts, not the full papers. Without screening, a review of blood-sugar control in people
            who already have diabetes could be chosen for "preventing diabetes". A model can still misjudge a review, so every decision is listed with
            its reason, and a clinician still has to check them.
          </li>
          <li>They don't judge quality (risk of bias), which needs reading each paper's methods.</li>
          <li>They don't say which way the evidence points: that comes from reading the chosen reviews, as the {kind === "food" ? "verdicts" : "findings"} on this page do.</li>
          <li>Trial sizes and the number of trials a review pooled are read from abstracts and can be missing or off.</li>
          <li>Overlap is not shown: citing a trial in a bibliography does not mean a review included or pooled it.</li>
        </ul>
        <p className="mt-3 text-sm text-ink-2">The searches, rules and the code that applies them are in the app's repository, so anyone can run them again and check.</p>
      </More>
    </div>
  );
}

function Step({ big, text }: { big: string; text: string }) {
  return (
    <li className="rounded-lg bg-sunken p-3">
      <span className="block font-serif text-2xl leading-tight tabular-nums">{big}</span>
      <span className="text-sm text-ink-2">{text}</span>
    </li>
  );
}

export function EvidenceOutcome({ o, name, food, kind, citedTitles }: { o: EvidenceMapOutcome; name: string; food: boolean; kind: MapKind; citedTitles: Record<string, string> }) {
  const claim = kind === "food" ? "claim" : "finding";
  const verdict = kind === "food" ? "verdict" : "finding";
  const anyDesign = food || !!o.anyDesign;
  const legacy = o.screening?.provenance === "legacy-inputs-unverified";
  const reviewLetter = (pmid: string) => String.fromCharCode(65 + o.chosenReviews.findIndex((r) => r.pmid === pmid));
  return (
    <div className="flex flex-col gap-6">
      {food ? (
        <p className="max-w-3xl">
          {o.counts.all !== undefined && <>{n(o.counts.all)} records match this {claim}'s search. </>}
          {n(o.counts.reviews)} systematic reviews and {n(o.counts.trials)} randomised trials in people fit its words
          {o.screening ? `; ${o.screening.counts.yes} of the reviews ${legacy ? "were historically marked as answering" : "answer"} the question below` : ""}, and {o.counts.largeTrials} trials had 1,000 people or more.
        </p>
      ) : (
        <p className="max-w-3xl">
          {n(o.counts.reviews)} reviews and {n(o.counts.trials)} randomised trials in people have this outcome in their title;{" "}
          {o.counts.trialReviews} are {anyDesign ? `systematic reviews of any study design about ${name}` : `reviews of ${name} trials`}{o.screening ? ` (${o.screening.counts.yes} ${legacy ? "historically marked as answering" : "answer"} the question below)` : " eligible under the rules, not screened against the question"}, and{" "}
          {o.counts.largeTrials} trials had 1,000 people or more.
        </p>
      )}

      {o.screening && <Screening s={o.screening} kind={kind} />}

      <Timeline o={o} />

      <section className="flex flex-col gap-2">
        <h3 className="font-serif text-xl font-normal">{legacy ? "Historical review selections" : "Reviews chosen by the rules"}</h3>
        {o.chosenReviews.length === 0 && (
          <p className="max-w-3xl rounded-lg bg-sunken p-3 text-sm">
            <span className="font-medium">No {anyDesign ? "systematic review" : "review of trials"} chosen for this question yet</span>
            {o.screening && o.screening.counts.unscreened > 0 ? `: ${o.screening.counts.unscreened} eligible reviews still need screening with current inputs.` : " The rules and screening have not selected an answering review."}{" "}
            {kind === "food"
              ? "The verdict rests on the studies it cites, such as single absorption studies, trials or studies that follow people over time, so it is less certain."
              : "The finding rests on the studies it cites, such as single trials or studies that follow people over time, so it is less certain."}
          </p>
        )}
        <ol className="flex flex-col gap-2">
          {o.chosenReviews.map((r) => (
            <li key={r.pmid ?? r.title} className="flex gap-3 rounded-lg border border-line p-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-medium" aria-hidden="true">
                {reviewLetter(r.pmid ?? "")}
              </span>
              <span className="min-w-0">
                <PaperLink c={r} />
                <span className="block text-sm text-ink-2">
                  {[r.firstAuthor, r.journal, r.year].filter(Boolean).join(" · ")} · cited {n(r.citedBy)} times
                </span>
                <span className="block text-sm">{r.why}</span>
              </span>
            </li>
          ))}
        </ol>
        {o.newerLargeTrials.length > 0 && <NewerTrials key={o.id} trials={o.newerLargeTrials} />}
      </section>


      <section className="flex max-w-3xl flex-col gap-2 rounded-lg bg-sunken p-3">
        <h3 className="font-medium">Compared with this page</h3>
        {o.finding ? (
          <>
            <p className="text-sm text-ink-2">{kind === "food" ? "The claim's verdict cites:" : `The finding "${o.finding}" cites:`}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {[...o.page.alsoChosen, ...o.page.citedNotChosen].map((p) => (
                <li key={p}>
                  <PreviewPaperLink href={`https://pubmed.ncbi.nlm.nih.gov/${p}/`} source={{ title: citedTitles[p] }} target="_blank" rel="noopener noreferrer" className="text-ink underline-offset-2 hover:underline">
                    {citedTitles[p] ?? `PMID ${p}`}
                  </PreviewPaperLink>{" "}
                  <span className="text-ink-2">· {o.page.alsoChosen.includes(p) ? "also chosen by the rules" : "not chosen by the rules"}</span>
                </li>
              ))}
            </ul>
            {o.page.chosenNotCited.length > 0 && (
              <p className="text-sm">
                <span className="font-medium">To check:</span> {o.page.chosenNotCited.length} chosen {o.page.chosenNotCited.length === 1 ? "study isn't" : "studies aren't"} on the
                page yet. A newer review can change a {verdict}; until someone reads them, the {verdict} stays as written.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-2">No finding on this page covers this outcome yet.</p>
        )}
      </section>
    </div>
  );
}

/** Large trials as new as the chosen reviews (largest first), six at a time. */
function NewerTrials({ trials }: { trials: EvidenceMapOutcome["newerLargeTrials"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? trials : trials.slice(0, 6);
  return (
    <>
      <h4 className="mt-2 font-medium">Large trials as new as these reviews</h4>
      <p className="text-sm text-ink-2">
        Trials of 1,000 people or more with this outcome in the title, from the year of the newest chosen review on. The reviews may not include
        them yet, and they weren't screened against the question, so some may be about a nearby one.
      </p>
      <ul className="flex flex-col gap-1.5">
        {shown.map((t) => (
          <li key={t.pmid ?? t.title}>
            <PaperLink c={t} />
            <span className="text-sm text-ink-2"> · {t.year} · about {n(t.n ?? 0)} people</span>
          </li>
        ))}
      </ul>
      {trials.length > shown.length && (
        <Button variant="link" onClick={() => setAll(true)} className="self-start">
          Show all {trials.length} trials
        </Button>
      )}
    </>
  );
}

/** The finding's question, how many reviews answer it, and the ones left out with the model's reason. */
function Screening({ s, kind }: { s: NonNullable<EvidenceMapOutcome["screening"]>; kind: MapKind }) {
  const rows: [string, string][] = [
    ["Who", s.question.population],
    [kind === "food" ? "Food or exposure" : kind === "lifestyle" ? "Habit or exposure" : kind === "wholefood" ? "Food" : "Given", s.question.intervention],
    ["Compared with", s.question.comparison],
    ["Measured", s.question.outcome],
  ];
  const { yes, partly, no, unscreened } = s.counts;
  return (
    <section className="flex max-w-3xl flex-col gap-3">
      <h3 className="font-serif text-xl font-normal">The question each review was checked against</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-2">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink-2">
        <span className="font-medium text-ink">{yes}</span> {yes === 1 ? "review" : "reviews"} {s.provenance === "legacy-inputs-unverified" ? "historically marked as answering" : "answer"} it, {partly} only partly, {no} not.
        {unscreened > 0 ? ` ${unscreened} not checked with current inputs.` : ""}{" "}
        {s.provenance === "legacy-inputs-unverified"
          ? `Historical selections are retained for inspection. The exact screening inputs and per-decision model provenance were not recorded, so these decisions are not validated for current inputs. Legacy file attribution: ${s.by} (${formatDate(s.at)}); individual attribution is unknown.`
          : s.decisions?.length
            ? `Only reviews screened as answering with current inputs can be chosen. Checked by ${s.by} (${formatDate(s.at)}).`
            : "There are no current screening decisions. Eligible reviews must be screened before selection."}
        {" "}Not yet checked by a clinician.
      </p>
      {s.provenance === "current" && s.decisions && s.decisions.length > 0 && (
        <More summary="Each screening decision and its provenance" tone="small">
          <ul className="flex flex-col gap-2 text-sm">
            {s.decisions.map((d) => <li key={d.pmid}>PMID {d.pmid}: {d.fits} — {d.reason} · {d.by} ({d.at})</li>)}
          </ul>
        </More>
      )}
      {s.left.length > 0 && (
        <More summary={<>Reviews left out, and why ({s.left.length})</>} tone="small">
          <ul className="flex flex-col gap-2.5">
            {s.left.map((r) => (
              <li key={r.pmid} className="text-sm">
                <PreviewPaperLink href={`https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`} source={{ title: r.title, year: r.year }} target="_blank" rel="noopener noreferrer" className="text-ink underline-offset-2 hover:underline">
                  {r.title}
                </PreviewPaperLink>
                <span className="text-ink-2"> · {r.year}</span>
                <span className="block text-ink-2">
                  <span className="font-medium text-ink">{r.fits === "partly" ? "Partly: " : "Not this question: "}</span>
                  {r.reason}
                </span>
              </li>
            ))}
          </ul>
        </More>
      )}
    </section>
  );
}

/** Reviews and trials per year as bars, with the large trials (1,000+ people) marked under the axis. */
function Timeline({ o }: { o: EvidenceMapOutcome }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const rows = o.timeline.filter((r) => r.year >= 1990);
  if (rows.length === 0) return null;
  const first = rows[0]!.year;
  const last = Math.max(rows.at(-1)!.year, ...o.largeTrials.map((t) => t.year));
  const years = last - first + 1;
  const W = Math.max(width, 300);
  const H = 180;
  const pad = { l: 32, r: 8, t: 8, b: 22 };
  const plotW = W - pad.l - pad.r;
  const bw = plotW / years;
  const max = Math.max(1, ...rows.map((r) => r.reviews + r.trials));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const x = (year: number) => pad.l + (year - first) * bw;
  const maxN = Math.max(1, ...o.largeTrials.map((t) => t.n));
  const ticks = [first, ...Array.from({ length: Math.floor(years / 5) + 1 }, (_, i) => Math.ceil(first / 5) * 5 + i * 5)].filter((v, i, a) => v <= last && a.indexOf(v) === i);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">Reviews and trials on this outcome, by year</figcaption>
      <div ref={box} className="w-full">
        {width > 0 && (
          <svg width={W} height={H + 44} role="img" aria-label={`Reviews and trials per year from ${first} to ${last}, with large trials marked`}>
            {[0, Math.round(max / 2), max].map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray="2 4" />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--color-ink-2)">
                  {t}
                </text>
              </g>
            ))}
            {rows.map((r) => {
              const bx = x(r.year) + 1;
              const w = Math.max(1, bw - 2);
              return (
                <g key={r.year}>
                  <rect x={bx} width={w} y={y(r.trials)} height={y(0) - y(r.trials)} fill={TRIAL_COLOR} rx={1}>
                    <title>{`${r.year}: ${r.trials} trials, ${r.reviews} reviews`}</title>
                  </rect>
                  <rect x={bx} width={w} y={y(r.trials + r.reviews)} height={y(r.trials) - y(r.trials + r.reviews)} fill={REVIEW_COLOR} rx={1}>
                    <title>{`${r.year}: ${r.trials} trials, ${r.reviews} reviews`}</title>
                  </rect>
                </g>
              );
            })}
            <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--color-line-strong)" />
            {ticks.map((t) => (
              <text key={t} x={x(t) + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-ink-2)">
                {t}
              </text>
            ))}
            {/* Large trials: one dot each, under the axis, sized by the number of people. */}
            {o.largeTrials.map((t, i) => (
              <circle key={`${t.pmid}-${i}`} cx={x(t.year) + bw / 2} cy={H + 18} r={3 + Math.sqrt(t.n / maxN) * 10} fill="none" stroke="var(--color-ink)" strokeWidth={1.5} opacity={0.7}>
                <title>{`${t.year}: ${t.title} (about ${n(t.n)} people)`}</title>
              </circle>
            ))}
          </svg>
        )}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: TRIAL_COLOR }} aria-hidden="true" /> Randomised trials
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: REVIEW_COLOR }} aria-hidden="true" /> Reviews and meta-analyses
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full border-2 border-ink" aria-hidden="true" /> Trials of 1,000+ people (bigger circle, more people)
        </span>
      </p>
      <More summary="Show as a table">
        <div className="max-h-64 overflow-y-auto">
          <table className="text-sm tabular-nums">
            <thead className="text-ink-2">
              <tr>
                <th className="py-1 pr-4 text-left font-medium">Year</th>
                <th className="py-1 pr-4 text-right font-medium">Trials</th>
                <th className="py-1 text-right font-medium">Reviews</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year}>
                  <td className="py-0.5 pr-4">{r.year}</td>
                  <td className="py-0.5 pr-4 text-right">{r.trials}</td>
                  <td className="py-0.5 text-right">{r.reviews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </More>
    </figure>
  );
}

