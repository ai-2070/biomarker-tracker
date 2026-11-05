import { useState } from "react";
import { LIFESTYLE_CATEGORIES, type LifestyleCategory, type LifestyleDef } from "@bt/core/lifestyle";
import { safetyLabels, safetyNotes } from "@bt/core/protocols";
import { computeTrend, flagLatest, groupByBiomarker } from "@bt/core/trends";
import type { SafetyId } from "@bt/core/types";
import { AddToProtocol } from "../components/AddToProtocol";
import { Findings } from "../components/findings";
import { StudyLink } from "../components/evidence";
import { anchorId, jump } from "../components/glance";
import { SearchIcon } from "../components/icons";
import { EvidenceMap, hasEvidenceMap } from "../components/EvidenceMap";
import { LifestyleFigure } from "../components/LifestyleVisuals";
import { ResearchPanel } from "../components/ResearchPanel";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, Card, FlagBadge, LinkButton, PageTitle, cx, inputStyles } from "../components/ui";
import { displayUnitFor, formatDate, showMeasurement, valueUnit } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, LIFESTYLE, LIFESTYLE_MAP } from "../knowledge";
import { href } from "../router";
import { NotFound } from "./NotFound";
import { ClockNote } from "../components/ClockEvidence";
import names from "../../../../../knowledge/names.json";
import { searchKnowledgeNames } from "@bt/core/knowledgeNames";
import { KnowledgeName } from "../components/KnowledgeName";

const CATEGORY_LABEL: Record<LifestyleCategory, string> = {
  movement: "Movement",
  "heat and cold": "Heat and cold",
  light: "Light",
  sleep: "Sleep",
  "breathing and mind": "Breathing and mind",
};

/** Every word must start a word somewhere in the entry (name, other names, summary, findings). */
function matches(l: LifestyleDef, query: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fold([l.name, ...l.otherNames, l.summary, ...l.findings.map((f) => f.outcome)].join(" "));
  return words.every((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(text));
}

/**
 * Knowledge → Lifestyle: walking, sauna, red light, sleep, cold water. Research-based, like Supplementation,
 * with drawings from the studies' own numbers. General information, not a plan for you.
 */
export function LifestylePage() {
  const [query, setQuery] = useState("");
  const shown = LIFESTYLE.filter((l) => matches(l, query));
  const shownNames = searchKnowledgeNames(names.lifestyle, query);
  const searching = query.trim() !== "";

  return (
    <>
      <PageTitle sub="Explore the potential benefits of everyday habits, who the findings apply to, and important cautions. Start with walking, sleep, sauna, cold water or red light.">
        Lifestyle
      </PageTitle>

      <div role="search" className="relative mb-5 w-full sm:max-w-md">
        <SearchIcon width={18} height={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))}
          placeholder="Search: sauna, blood pressure, sleep"
          aria-label="Search lifestyle topics"
          autoComplete="off"
          className={cx(inputStyles, "w-full pl-10")}
        />
      </div>

      {LIFESTYLE.length === 0 && names.lifestyle.length === 0 ? (
        <Card>
          <p className="text-ink-2">The lifestyle knowledge base is being written.</p>
        </Card>
      ) : shown.length === 0 && shownNames.length === 0 ? (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-ink-2">Nothing here matches “{query.trim()}”.</p>
          <Button variant="secondary" onClick={() => setQuery("")}>
            Clear the search
          </Button>
        </Card>
      ) : (
        <ul className={cx("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", !searching && "stagger")}>
          {[...shown]
            .sort((x, y) => LIFESTYLE_CATEGORIES.indexOf(x.category) - LIFESTYLE_CATEGORIES.indexOf(y.category) || x.name.localeCompare(y.name))
            .map((l) => (
              <li key={l.id}>
                <a
                  href={href({ name: "lifestyle-item", id: l.id })}
                  className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-ink no-underline transition-[border-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-sm"
                >
                  <div>
                    <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">{CATEGORY_LABEL[l.category]}</p>
                    <h2 className="font-serif text-2xl font-normal">{l.name}</h2>
                  </div>
                  <p className="text-ink-2">{l.summary}</p>
                  <p className="mt-auto border-t border-line pt-3 text-sm text-ink-2">Explore benefits, cautions and the research</p>
                </a>
              </li>
            ))}
          {shownNames.map(({ name }) => <KnowledgeName key={`name:${name}`} name={name} />)}
        </ul>
      )}

      <p className="mt-6 text-sm text-ink-2">
        For guides with cited studies, grades and wording are a first draft, not yet reviewed by a clinician.
      </p>
    </>
  );
}

function H2({ children, id }: { children: string; id?: string }) {
  return (
    <h2 id={id} className="scroll-mt-6 font-serif text-2xl font-normal">
      {children}
    </h2>
  );
}

/** One lifestyle topic: what it is, how it's thought to work, the drawings, what studies found, who should be careful. */
export function LifestyleItemPage({ id }: { id: string }) {
  const l = LIFESTYLE_MAP.get(id);
  const all = useAllMeasurements();
  const profile = useProfile();
  const protocols = useProtocols() ?? [];
  if (!l) return <NotFound />;
  const notes = safetyNotes(safetyLabels(protocols, profile));
  const safety: SafetyId[] = notes.map((x) => x.id);
  const yours = l.whoShouldBeCareful.filter((x) => x.safetyId && safety.includes(x.safetyId));
  // The habit watches the first marker the topic can move (steps for walking, sleep for sleep…).
  const watch = l.markers.find((m) => BIOMARKER_MAP.has(m));

  return (
    <>
      <a href={href({ name: "lifestyle" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Lifestyle
      </a>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">{CATEGORY_LABEL[l.category]}</p>
          <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">{l.name}</h1>
          {l.otherNames.length > 0 && <p className="mt-1 max-w-3xl text-ink-2">Also called: {l.otherNames.slice(0, 3).join(", ")}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {l.asHabit === false ? (
            // Sleep isn't something you start or add to a protocol: show the person's own data instead.
            watch && (
              <LinkButton variant="secondary" href={href({ name: "marker", id: watch })}>
                See your {BIOMARKER_MAP.get(watch)!.name.toLowerCase()}
              </LinkButton>
            )
          ) : (
            <>
              <LinkButton variant="secondary" href={href({ name: "habits", add: l.name, type: "lifestyle", ...(watch ? { marker: watch } : {}) })}>
                Start as a habit
              </LinkButton>
              <AddToProtocol label={l.name} category="lifestyle" amountHint="e.g. 30 minutes" />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,48rem)_18rem] lg:gap-10">
        <Aside l={l} all={all ?? []} />
        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
          {yours.length > 0 && (
            <div role="note" className="flex flex-col gap-2 rounded-xl border-2 border-warn/50 bg-warn-soft p-4">
              <p className="font-semibold">Talk to your doctor first</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {yours.map((x) => (
                  <li key={x.with}>
                    <span className="font-medium">{x.with}:</span> {x.note}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink-2">Shown because of something in your habits or profile.</p>
            </div>
          )}

          {/* Uses and relevant cautions first; mechanisms and research detail follow. */}
          <p className="max-w-3xl text-lg">{l.summary}</p>

          <span id="findings" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
          <Findings
            prefix="finding"
            title="Main uses &amp; potential benefits"
            intro="See where this habit may help and who was studied. Open the research details for the full findings and sources."
            findings={l.findings}
          />
          {(l.whoShouldBeCareful.length > 0 || l.cautions.length > 0) && (
            <Card id="careful" className="flex scroll-mt-6 flex-col gap-3">
              <H2>Who should be careful</H2>
              <SafetyNotices notes={notes.filter((x) => l.whoShouldBeCareful.some((w) => w.safetyId === x.id))} />
              {l.whoShouldBeCareful.length > 0 && (
                <dl className="flex flex-col gap-3">
                  {l.whoShouldBeCareful.map((x) => (
                    <div key={x.with} className={cx(x.safetyId && safety.includes(x.safetyId) && "rounded-lg bg-warn-soft p-2")}>
                      <dt className="font-medium">{x.with}</dt>
                      <dd className="text-ink-2">{x.note}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {l.cautions.length > 0 && (
                <div>
                  <h3 className="mb-1 font-semibold">Also worth knowing</h3>
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
                    {l.cautions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          <ClockNote kind="lifestyle" id={l.id} />

          <Card className="flex flex-col gap-6">
            <H2 id="pictures">In pictures</H2>
            {l.visuals.map((v, i) => (
              <div key={v.title} className={cx(i > 0 && "border-t border-line pt-5")}>
                <LifestyleFigure v={v} id={anchorId("visual", v.title)} />
              </div>
            ))}
          </Card>

          <Card id="how" className="flex scroll-mt-6 flex-col gap-4">
            <H2>How it's thought to work</H2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
              {l.howItWorks.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <div>
              <h3 className="mb-1 font-semibold">What the studies had people do</h3>
              <p className="text-ink-2">{l.whatStudiesDid}</p>
            </div>
          </Card>


          <Card id="unknowns" className="flex scroll-mt-6 flex-col gap-2">
            <H2>What isn't known yet</H2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
              {l.unknowns.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </Card>

          {hasEvidenceMap(`lifestyle-${l.id}`) && (
            <Card id="evidence-map" className="flex scroll-mt-6 flex-col gap-4">
              <H2>How the evidence was found</H2>
              <EvidenceMap
                mapId={`lifestyle-${l.id}`}
                citedTitles={Object.fromEntries(l.findings.flatMap((f) => f.studies).flatMap((s) => (s.pmid ? [[s.pmid, s.title]] : [])))}
              />
            </Card>
          )}

          {watch && l.asHabit !== false && (
            <Card className="flex flex-col gap-3">
              <H2>Test it on yourself</H2>
              <p className="text-ink-2">
                Log it as a habit and pick markers to watch. The app compares your results before and after, allowing for normal day-to-day and
                test-to-test variation. What it shows is what happened in you, not proof for anyone else.
              </p>
              <div>
                <LinkButton variant="secondary" href={href({ name: "habits", add: l.name, type: "lifestyle", marker: watch })}>
                  Log a habit and watch a marker
                </LinkButton>
              </div>
            </Card>
          )}

          <span id="research" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
          <ResearchPanel name={l.name} terms={[l.name]} question={`What does research say about ${l.name.toLowerCase()}, and is it relevant to my results?`} critical={false} />

          <Card>
            <h2 className="mb-2 font-semibold">General sources</h2>
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {l.sources.map((s) => (
                <li key={s.pmid ?? s.doi ?? s.title}>
                  <StudyLink s={s} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-2">
              General information, not a diagnosis or a plan for you. Grades and wording are a first draft, checked against the cited studies but
              not yet reviewed by a clinician.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Side column on wide screens: your latest results for the markers it can move, what studies found, and jump links. */
function Aside({ l, all }: { l: LifestyleDef; all: Parameters<typeof groupByBiomarker>[0] }) {
  const profile = useProfile();
  const units = useDisplayUnits();
  const byMarker = groupByBiomarker(all);
  const mine = l.markers.filter((id) => BIOMARKER_MAP.has(id) && byMarker.has(id)).slice(0, 5);
  const links: [string, string][] = [
    ["findings", "Main uses & potential benefits"],
    ...((l.whoShouldBeCareful.length > 0 || l.cautions.length > 0 ? [["careful", "Who should be careful"]] : []) as [string, string][]),
    ["pictures", "In pictures"],
    ["how", "How it's thought to work"],
    ["unknowns", "What isn't known yet"],
    ...((hasEvidenceMap(`lifestyle-${l.id}`) ? [["evidence-map", "How the evidence was found"]] : []) as [string, string][]),
    ["research", "Search research"],
  ];
  return (
    <aside aria-label="Key facts" className="hidden lg:col-start-2 lg:row-start-1 lg:block">
      <div className="sticky top-6 flex flex-col gap-5 text-sm">
        {mine.length > 0 && (
          <section>
            <h2 className="mb-1.5 text-xs font-medium text-ink-2">Your latest</h2>
            <ul className="flex flex-col gap-1.5">
              {mine.map((id) => {
                const def = BIOMARKER_MAP.get(id)!;
                const ms = byMarker.get(id)!;
                const latest = computeTrend(ms)?.latest;
                const flag = flagLatest(def, ms, profile);
                const unit = displayUnitFor(def, units[def.id]);
                return (
                  <li key={id}>
                    <a href={href({ name: "marker", id })} className="block text-ink no-underline hover:underline">
                      {def.abbreviation ?? def.name}
                    </a>
                    {latest && (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-base tabular-nums">
                          {showMeasurement(def, latest, unit)} {valueUnit(def, unit)}
                        </span>
                        {flag && flag !== "unknown" && <FlagBadge flag={flag} />}
                        <span className="text-ink-2">{formatDate(latest.date)}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <nav aria-label="On this page">
          <h2 className="mb-1.5 text-xs font-medium text-ink-2">On this page</h2>
          <ul className="flex flex-col gap-1">
            {links.map(([to, label]) => (
              <li key={to}>
                <a href={`#${to}`} onClick={(e) => jump(e, to)} className="text-ink-2 no-underline hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
