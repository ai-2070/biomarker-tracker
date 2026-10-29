import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { findingCounts, interactionsFor, type NutrientDef, type NutrientKind } from "../../core/nutrients";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { computeTrend, flagLatest, groupByBiomarker } from "../../core/trends";
import type { Measurement, Profile, SafetyId } from "../../core/types";
import { Chip, Fold, FoldGroup } from "../components/disclosure";
import { Card, FlagBadge, PageTitle, cx } from "../components/ui";
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
  const shown = NUTRIENTS.filter((n) => !kind || n.kind === kind);

  return (
    <>
      <PageTitle sub="What research says about 15 vitamins and minerals: what they do, who runs low, food sources and what supplement trials found. General information, not a dose for you.">
        Supplementation
      </PageTitle>

      <FoldGroup className="mb-6 max-w-3xl">
        <Fold title="Before you look at supplements" summary="They help most when you're low. With medicines, pregnancy or kidney disease, ask a doctor or pharmacist first.">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
            <li>
              <span className="text-ink">Supplements help most when you're low.</span> In people who aren't, many large trials found no benefit, and a few found
              harm. A blood test shows your status for some of them.
            </li>
            <li>
              <span className="text-ink">Food and a supplement are different things.</span> A food brings thousands of other compounds, so their findings are
              graded separately here.
            </li>
            <li>
              <span className="text-ink">Talk to a doctor or pharmacist first</span> if you take medicines, are pregnant, or have kidney or liver disease. Some
              supplements interact with medicines or build up in the body.
            </li>
          </ul>
        </Fold>
      </FoldGroup>

      <ToggleGroup
        aria-label="Show"
        value={[kind ?? "all"]}
        onValueChange={(v) => {
          const next = v[0] as "all" | NutrientKind | undefined;
          if (!next || next === (kind ?? "all")) return;
          location.replace(href(next === "all" ? { name: "supplements" } : { name: "supplements", kind: next }));
        }}
        className="mb-5 flex w-full gap-1 rounded-xl border border-line bg-sunken p-1 sm:inline-flex sm:w-auto"
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

      {NUTRIENTS.length === 0 ? (
        <Card>
          <p className="text-ink-2">The vitamins and minerals knowledge base is being written.</p>
        </Card>
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((n) => (
            <li key={n.id}>
              <NutrientCard n={n} byMarker={byMarker} safety={safety} profile={profile} />
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

function NutrientCard({ n, byMarker, safety, profile }: { n: NutrientDef; byMarker: Map<string, Measurement[]>; safety: SafetyId[]; profile: Profile }) {
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
        <h2 className="font-serif text-2xl font-normal">{n.name}</h2>
        {warn.length > 0 && <Chip tone="warn">Check interactions</Chip>}
      </div>
      <p className="line-clamp-2 text-ink-2">{n.summary}</p>
      <div className="mt-auto flex flex-col gap-2 pt-1 text-sm">
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
        <p className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-ink-2">Trials:</span>
          {counts.helps > 0 && <Chip tone="ok">{counts.helps} helped</Chip>}
          {counts["no clear effect"] + counts.mixed > 0 && <Chip>{counts["no clear effect"] + counts.mixed} unclear</Chip>}
          {counts.harms > 0 && <Chip tone="danger">{counts.harms} harmed</Chip>}
        </p>
      </div>
    </a>
  );
}
