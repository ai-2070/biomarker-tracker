import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useState } from "react";
import { findingCounts, interactionsFor, searchNutrients, type NutrientDef, type NutrientKind, type NutrientMatch } from "../../core/nutrients";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { computeTrend, flagLatest, groupByBiomarker } from "../../core/trends";
import type { Measurement, Profile, SafetyId } from "../../core/types";
import { SearchIcon } from "../components/icons";
import { Button, Card, FlagBadge, PageTitle, cx, inputStyles } from "../components/ui";
import { displayUnitFor, showMeasurement } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, NUTRIENTS, nameInSentence } from "../knowledge";
import { href } from "../router";

const FILTERS: { value: "all" | NutrientKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "vitamin", label: "Vitamins" },
  { value: "mineral", label: "Minerals" },
];

/**
 * Supplementation: a research-based knowledge base of vitamins and minerals. General information, not
 * your data and not advice: kept apart from Health in the menu. Each card shows your latest status
 * result when the app has a marker for it, and a warning when your log or profile has an interaction.
 */
export function SupplementsPage({ kind }: { kind?: NutrientKind }) {
  const all = useAllMeasurements();
  const profile = useProfile();
  const protocols = useProtocols() ?? [];
  const safety: SafetyId[] = safetyNotes(safetyLabels(protocols, profile)).map((n) => n.id);
  const byMarker = groupByBiomarker(all ?? []);
  const [query, setQuery] = useState("");
  const inKind = NUTRIENTS.filter((n) => !kind || n.kind === kind);
  const shown = searchNutrients(inKind, query);
  const searching = query.trim() !== "";

  return (
    <>
      <PageTitle sub="What research says about vitamins and minerals: what they do, who tends to run low, where they come from in food, and what trials of supplements actually found. General information, not a dose for you.">
        Supplementation
      </PageTitle>


      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div role="search" className="relative w-full sm:max-w-md">
        <SearchIcon width={18} height={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))}
          placeholder="Search: a vitamin, a food, a symptom, a medicine"
          aria-label="Search vitamins and minerals"
          autoComplete="off"
          className={cx(inputStyles, "w-full pl-10")}
        />
      </div>
      <ToggleGroup
        aria-label="Show"
        value={[kind ?? "all"]}
        onValueChange={(v) => {
          const next = v[0] as "all" | NutrientKind | undefined;
          if (!next || next === (kind ?? "all")) return;
          location.replace(href(next === "all" ? { name: "supplements" } : { name: "supplements", kind: next }));
        }}
        className="flex w-full gap-1 rounded-xl border border-line bg-sunken p-1 sm:inline-flex sm:w-auto"
      >
        {FILTERS.map((f) => (
          <Toggle
            key={f.value}
            value={f.value}
            className={cx(
              "flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-soft)] sm:flex-none",
              "hover:text-ink data-pressed:bg-surface data-pressed:text-ink data-pressed:shadow-sm",
            )}
          >
            {f.label}
          </Toggle>
        ))}
      </ToggleGroup>
      </div>

      {!searching && (
      <Card className="mb-5 flex flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">Before you look at supplements</h2>
        <ol className="flex max-w-3xl list-decimal flex-col gap-2 pl-5 text-ink-2">
          <li>
            <span className="text-ink">Supplements help most when you're low.</span> In people who aren't, many large trials found no benefit, and
            a few found harm. A blood test shows your status for some of them.
          </li>
          <li>
            <span className="text-ink">Food and a supplement are different things.</span> Food tables track about 150 nutrients, but foods are
            estimated to hold more than 26,000 distinct chemicals, most of them never studied: researchers call this nutritional dark matter (
            <a href="https://doi.org/10.1038/s43016-019-0005-1" target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
              Barabási 2019
            </a>
            ). A supplement gives one nutrient on its own, without everything that comes with it in food, so findings for one don't carry over to
            the other. Diets rich in beta-carotene went with less lung cancer, yet beta-carotene pills raised lung cancer in smokers. That's why
            they're graded separately here.{" "}
            <a href={href({ name: "meals", section: "dark-matter" })} className="font-medium text-accent">
              More on what food tables can't tell you
            </a>
          </li>
          <li>
            <span className="text-ink">Talk to a doctor or pharmacist first</span> if you take medicines, are pregnant, or have kidney or liver
            disease. Some supplements interact with medicines or build up in the body.
          </li>
        </ol>
      </Card>
      )}

      <p aria-live="polite" className={cx("mb-3 text-sm text-ink-2", !searching && "sr-only")}>
        {searching ? `${shown.length} of ${inKind.length} ${shown.length === 1 ? "matches" : "match"} “${query.trim()}”` : ""}
      </p>

      {NUTRIENTS.length === 0 ? (
        <Card>
          <p className="text-ink-2">The vitamins and minerals knowledge base is being written.</p>
        </Card>
      ) : shown.length === 0 ? (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-ink-2">
            Nothing here matches “{query.trim()}”. Try a vitamin or mineral, a food (salmon, spinach), a sign (tiredness), or a medicine
            (warfarin).{kind && " Or look in all of them, not only " + (kind === "vitamin" ? "vitamins." : "minerals.")}
          </p>
          <Button variant="secondary" onClick={() => setQuery("")}>
            Clear the search
          </Button>
        </Card>
      ) : (
        <ul className={cx("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", !searching && "stagger")}>
          {shown.map(({ n, match }) => (
            <li key={n.id}>
              <NutrientCard n={n} match={match} byMarker={byMarker} safety={safety} profile={profile} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-sm text-ink-2">
        Evidence grades and wording are a first draft, checked against the cited studies but not yet reviewed by a clinician. Reference values
        are from the European Food Safety Authority (EFSA).
      </p>
    </>
  );
}

function NutrientCard({ n, match, byMarker, safety, profile }: { n: NutrientDef; match?: NutrientMatch; byMarker: Map<string, Measurement[]>; safety: SafetyId[]; profile: Profile }) {
  const units = useDisplayUnits();
  const counts = findingCounts(n);
  const warn = interactionsFor(n, safety);
  // Your latest status result, from the first of its markers you have results for.
  const markerId = n.status.biomarkerIds.find((id) => byMarker.has(id));
  const def = markerId ? BIOMARKER_MAP.get(markerId) : undefined;
  const ms = markerId ? byMarker.get(markerId)! : [];
  const latest = ms.length ? computeTrend(ms)?.latest : undefined;
  const flag = def && ms.length ? flagLatest(def, ms, profile) : undefined;
  const unit = def ? displayUnitFor(def, units[def.id]) : "";

  return (
    <a
      href={href({ name: "nutrient", id: n.id })}
      className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-ink no-underline transition-[border-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">{n.kind}</p>
          <h2 className="font-serif text-2xl font-normal">{n.name}</h2>
        </div>
        {warn.length > 0 && <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-sm font-medium text-warn">Check interactions</span>}
      </div>
      {/* When a search found it by something other than its name, say what. */}
      {match && match.label !== "About" ? (
        <div className="rounded-lg bg-accent-soft px-3 py-2 text-sm">
          <p className="line-clamp-2">
            <span className="text-ink-2">{match.label}:</span> {match.text}
          </p>
        </div>
      ) : null}
      <p className={cx("text-ink-2", match && match.label !== "About" ? "line-clamp-2" : "line-clamp-3")}>{n.summary}</p>
      <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3 text-sm">
        {def && latest && flag ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-ink-2">Your {nameInSentence(def)}:</span>
            <span className="font-medium tabular-nums">
              {showMeasurement(def, latest, unit)} {unit}
            </span>
            {flag !== "unknown" && <FlagBadge flag={flag} />}
          </p>
        ) : (
          <p className="text-ink-2">{n.status.biomarkerIds.length ? "No status result yet" : "No routine blood test for it in the app"}</p>
        )}
        <p className="text-ink-2">
          What supplement trials found:{" "}
          {[
            counts.helps && `${counts.helps} ${counts.helps === 1 ? "benefit" : "benefits"}`,
            counts["no clear effect"] && `${counts["no clear effect"]} no clear effect`,
            counts.mixed && `${counts.mixed} mixed`,
            counts.harms && `${counts.harms} ${counts.harms === 1 ? "harm" : "harms"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </a>
  );
}
