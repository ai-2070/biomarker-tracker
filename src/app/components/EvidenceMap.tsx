import { useEffect, useRef, useState } from "react";
import type { Chosen, EvidenceMapFile, EvidenceMapOutcome } from "../../core/evidenceMap";
import { formatDate } from "../format";
import { useWidth } from "./timeControls";
import { cx } from "./ui";

/**
 * How the evidence behind a nutrient's findings was found: every PubMed record searched, the counts left
 * at each step, and per outcome the reviews and trials chosen by written rules, a timeline, how much the
 * chosen reviews share trials, and how the page's own citations compare. Data from
 * knowledge/evidence-maps (built by tools/evidence), loaded only when this section is shown.
 */

const maps = import.meta.glob<EvidenceMapFile>("../../../knowledge/evidence-maps/*.json", { import: "default" });

export function useEvidenceMap(nutrientId: string): EvidenceMapFile | undefined {
  const [map, setMap] = useState<EvidenceMapFile>();
  useEffect(() => {
    const load = Object.entries(maps).find(([path]) => path.endsWith(`/${nutrientId}.json`))?.[1];
    if (load) void load().then(setMap);
  }, [nutrientId]);
  return map;
}

/** Whether a nutrient has an evidence map (without loading it). */
export const hasEvidenceMap = (nutrientId: string) => Object.keys(maps).some((p) => p.endsWith(`/${nutrientId}.json`));

const n = (x: number) => x.toLocaleString("en-GB");
const REVIEW_COLOR = "var(--color-age-heart)";
const TRIAL_COLOR = "var(--color-age-blood)";

function PaperLink({ c }: { c: Pick<Chosen, "pmid" | "doi" | "title"> }) {
  const url = c.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/` : `https://doi.org/${c.doi}`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-ink underline-offset-2 hover:underline">
      {c.title}
    </a>
  );
}

export function EvidenceMap({ nutrientId, citedTitles }: { nutrientId: string; citedTitles: Record<string, string> }) {
  const map = useEvidenceMap(nutrientId);
  const [outcomeId, setOutcomeId] = useState<string>();
  if (!map) return <p className="text-ink-2">Loading the evidence map…</p>;
  const o = map.outcomes.find((x) => x.id === outcomeId) ?? map.outcomes[0]!;
  const c = map.counts;
  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-3xl">
        <p className="text-ink-2">
          Instead of picking studies by hand, every PubMed record was searched and the studies for each finding were chosen by written rules.
          Built {formatDate(map.builtAt)} from {map.source}.
        </p>
      </div>

      <ol className="grid gap-2 sm:grid-cols-4" aria-label="From every record to the studies used">
        <Step big={n(c.all)} text="records mention vitamin D" />
        <Step big={n(c.retrieved)} text="are reviews, randomised trials or guidelines: all downloaded" />
        <Step big={`${n(c.reviews)} · ${n(c.trials)}`} text={`reviews · trials in people (${c.animal} animal studies and ${c.retracted} retracted papers left out)`} />
        <Step big={`${o.counts.trialReviews}`} text={`reviews of vitamin D trials on ${o.label.toLowerCase()}, after the rules below`} />
      </ol>

      <div role="tablist" aria-label="Outcome" className="flex flex-wrap gap-1 self-start rounded-xl border border-line bg-sunken p-1">
        {map.outcomes.map((x) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={x.id === o.id}
            onClick={() => setOutcomeId(x.id)}
            className={cx("min-h-9 rounded-lg px-3 text-sm transition-colors duration-150", x.id === o.id ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}
          >
            {x.label}
          </button>
        ))}
      </div>

      <Outcome o={o} citedTitles={citedTitles} />

      <details className="max-w-3xl">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">The rules, and what they can't do yet</summary>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ink-2">
          {map.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
        <p className="mt-3 font-medium">What the rules can't do yet</p>
        <ul className="mt-1 flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
          <li>They read titles and abstracts, not the papers: a review of blood-sugar control in people who already have diabetes can be chosen for "preventing diabetes", and a review that mentions death only as a side effect for "death".</li>
          <li>They don't judge quality (risk of bias), which needs reading each paper's methods.</li>
          <li>They don't say which way the evidence points: that comes from reading the chosen reviews, as the findings above do.</li>
          <li>Trial sizes and the number of trials a review pooled are read from abstracts and can be missing or off.</li>
        </ul>
        <p className="mt-3 text-sm text-ink-2">The searches, rules and the code that applies them are in the app's repository, so anyone can run them again and check.</p>
      </details>
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

function Outcome({ o, citedTitles }: { o: EvidenceMapOutcome; citedTitles: Record<string, string> }) {
  const reviewLetter = (pmid: string) => String.fromCharCode(65 + o.chosenReviews.findIndex((r) => r.pmid === pmid));
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl">
        {n(o.counts.reviews)} reviews and {n(o.counts.trials)} randomised trials in people have {o.label.toLowerCase()} in their title;{" "}
        {o.counts.trialReviews} are reviews of vitamin D trials that fit the question, and {o.counts.largeTrials} trials had 1,000 people or
        more.
      </p>

      <Timeline o={o} />

      <section className="flex flex-col gap-2">
        <h3 className="font-serif text-xl font-normal">Reviews chosen by the rules</h3>
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
        {o.newerLargeTrials.length > 0 && (
          <>
            <h4 className="mt-2 font-medium">Large trials as new as these reviews</h4>
            <p className="text-sm text-ink-2">The reviews may not include them yet, so they're listed apart.</p>
            <ul className="flex flex-col gap-1.5">
              {o.newerLargeTrials.map((t) => (
                <li key={t.pmid ?? t.title}>
                  <PaperLink c={t} />
                  <span className="text-sm text-ink-2"> · {t.year} · about {n(t.n ?? 0)} people</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {o.overlap && <Overlap o={o} letter={reviewLetter} />}

      <section className="flex max-w-3xl flex-col gap-2 rounded-lg bg-sunken p-3">
        <h3 className="font-medium">Compared with this page</h3>
        {o.finding ? (
          <>
            <p className="text-sm text-ink-2">The finding "{o.finding}" cites:</p>
            <ul className="flex flex-col gap-1 text-sm">
              {[...o.page.alsoChosen, ...o.page.citedNotChosen].map((p) => (
                <li key={p}>
                  <a href={`https://pubmed.ncbi.nlm.nih.gov/${p}/`} target="_blank" rel="noopener noreferrer" className="text-ink underline-offset-2 hover:underline">
                    {citedTitles[p] ?? `PMID ${p}`}
                  </a>{" "}
                  <span className="text-ink-2">· {o.page.alsoChosen.includes(p) ? "also chosen by the rules" : "not chosen by the rules"}</span>
                </li>
              ))}
            </ul>
            {o.page.chosenNotCited.length > 0 && (
              <p className="text-sm">
                <span className="font-medium">To check:</span> {o.page.chosenNotCited.length} chosen {o.page.chosenNotCited.length === 1 ? "study isn't" : "studies aren't"} on the
                page yet. A newer review can change a finding; until someone reads them, the finding above stays as written.
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
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-2">Show as a table</summary>
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
      </details>
    </figure>
  );
}

/** Which trials each chosen review pooled (from its reference list), and the overlap measure. */
function Overlap({ o, letter }: { o: EvidenceMapOutcome; letter: (pmid: string) => string }) {
  const ov = o.overlap!;
  const [all, setAll] = useState(false);
  const shown = all ? ov.shared : ov.shared.slice(0, 12);
  const cols = ov.reviews;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-serif text-xl font-normal">Do the reviews share their trials?</h3>
      <p className="max-w-3xl text-ink-2">
        Reviews that pool the same trials aren't independent confirmations: agreement between them can be one body of evidence counted more
        than once. Overlap here is <span className="font-medium text-ink">{Math.round(ov.cca * 100)} %</span> ({n(ov.trials)} different trials,{" "}
        {n(ov.inclusions)} inclusions), measured as the corrected covered area (Pieper 2014; the median in 60 published overviews was 4 %).
        Trials are matched from each review's reference list.
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <caption className="sr-only">Trials pooled by each chosen review</caption>
          <thead>
            <tr>
              <th className="py-1 pr-3 text-left font-medium text-ink-2">Trial</th>
              {cols.map((c) => (
                <th key={c.pmid} className="w-10 py-1 text-center font-medium" title={`${c.trials} vitamin D trials in its references`}>
                  {letter(c.pmid)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((t) => (
              <tr key={t.pmid}>
                <td className="max-w-[28rem] py-1.5 pr-3">
                  <a href={`https://pubmed.ncbi.nlm.nih.gov/${t.pmid}/`} target="_blank" rel="noopener noreferrer" className="line-clamp-1 text-ink underline-offset-2 hover:underline" title={t.title}>
                    {t.title}
                  </a>
                  <span className="text-xs text-ink-2">
                    {t.year}
                    {t.n ? ` · about ${n(t.n)} people` : ""}
                  </span>
                </td>
                {cols.map((c) => (
                  <td key={c.pmid} className="text-center">
                    {t.inReviews.includes(c.pmid) ? (
                      <span className="inline-block size-3 rounded-full" style={{ background: REVIEW_COLOR }} aria-label="included" />
                    ) : (
                      <span className="inline-block size-3 rounded-full border border-line" aria-label="not included" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ov.shared.length > 12 && !all && (
        <button type="button" onClick={() => setAll(true)} className="self-start text-sm text-accent">
          Show all {ov.shared.length} trials
        </button>
      )}
      {ov.reviewsWithoutReferences.length > 0 && <p className="text-sm text-ink-2">Review {ov.reviewsWithoutReferences.map(letter).join(", ")}: no reference list in Europe PMC, so not shown.</p>}
    </section>
  );
}
