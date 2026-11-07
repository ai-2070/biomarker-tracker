import { todayIso } from "@bt/shared/core/dates";
import { selectFoods } from "@bt/shared/core/foods";
import { dailyReference } from "@bt/shared/core/meals";
import { ageAt } from "@bt/shared/core/phenoageDraws";
import { interactionsFor, type NutrientDef } from "@bt/shared/core/nutrients";
import { safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import { computeTrend, flagLatest, groupByBiomarker, isCritical } from "@bt/shared/core/trends";
import type { SafetyId } from "@bt/shared/core/types";
import { formatValue } from "@bt/shared/core/units";
import { Findings } from "../components/findings";
import { GradeBadge, StudyLink } from "../components/evidence";
import { AddToProtocol } from "../components/AddToProtocol";
import { EvidenceMap, hasEvidenceMap } from "../components/EvidenceMap";
import { jump } from "../components/glance";
import { ResearchPanel } from "../components/ResearchPanel";
import { SafetyNotices } from "../components/SafetyNotices";
import { Card, FlagBadge, LinkButton, Notice, cx, eyebrowStyles } from "../components/ui";
import { displayUnitFor, formatDate, lowerFirst, showMeasurement } from "../format";
import { useAllMeasurements, useDisplayUnits, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, EVIDENCE, FOODS, NUTRIENT_MAP, fullName } from "../knowledge";
import { href } from "../router";
import { NotFound } from "./NotFound";
import { ClockNote } from "../components/ClockEvidence";
import { SupplementGuide } from "../components/SupplementGuide";
import { PaperLink } from "../components/PaperLink";
import { More } from "../components/disclosure";


const INTAKE_TYPE = {
  PRI: "Population reference intake",
  AI: "Adequate intake",
} as const;

function H2({ children }: { children: string }) {
  return <h2 className="font-serif text-2xl font-normal">{children}</h2>;
}

/**
 * One nutrient or supplement: its roles and studied benefits, cautions, status and food sources,
 * with supplement and food evidence kept apart.
 */
export function NutrientPage({ id }: { id: string }) {
  const n = NUTRIENT_MAP.get(id);
  const all = useAllMeasurements();
  const profile = useProfile();
  const protocols = useProtocols() ?? [];
  if (!n) return <NotFound />;
  const notes = safetyNotes(safetyLabels(protocols, profile));
  const safety: SafetyId[] = notes.map((x) => x.id);
  const yours = interactionsFor(n, safety);
  const basic = n.researchStatus === "not-reviewed";
  const grouped = groupByBiomarker(all ?? []);
  const critical = n.status.biomarkerIds.some((id) => {
    const def = BIOMARKER_MAP.get(id);
    const readings = grouped.get(id);
    return def && readings?.length ? isCritical(flagLatest(def, readings, profile)) : false;
  });

  return (
    <>
      <a href={href({ name: "supplements" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Supplementation
      </a>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={eyebrowStyles}>{n.kind === "supplement" ? "Other supplement" : n.kind}</p>
          <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">{n.name}</h1>
          {n.otherNames.length > 0 && <p className="mt-1 max-w-3xl text-ink-2">Also called: {n.otherNames.join(", ")}</p>}
          {basic && !n.simpleGuide && <p className="mt-2 text-sm font-medium text-ink-2">Basic guide · Benefits not yet reviewed</p>}
        </div>
        {!critical && <div className="flex flex-wrap gap-2">
          {/* A habit with the nutrient's blood test picked to watch, when the app has one. */}
          <LinkButton variant="secondary" href={href({ name: "habits", add: n.name, ...(n.status.biomarkerIds[0] ? { marker: n.status.biomarkerIds[0] } : {}) })}>
            Start as a habit
          </LinkButton>
          <AddToProtocol label={n.name} />
        </div>}
      </div>
      {critical && <Notice role="alert" tone="danger" title="Contact a doctor now" className="mb-5">Your latest linked blood result is critically out of range. Contact a doctor urgently before changing food or supplements. Food-increase ideas and research handoff to Brain are not shown.</Notice>}

      {/* Wide screens: the cards at a readable width, key facts and jump links in a side column. Phones: cards only. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,48rem)_18rem] lg:gap-10">
      <Aside n={n} all={all ?? []} hasInteractions={n.interactions.length > 0 || n.cautions.length > 0} />
      <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
        {yours.length > 0 && (
          <div role="note" className="flex flex-col gap-2 rounded-xl border-2 border-warn/50 bg-warn-soft p-4">
            <p className="font-semibold">Talk to your doctor or pharmacist about {n.name.toLowerCase()}</p>
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
        {n.simpleGuide ? <SupplementGuide n={n} guide={n.simpleGuide} critical={critical} reference={<Reference n={n} bare />} /> : (
          <>

        <Card className="flex flex-col gap-4">
          <p className="text-lg">{n.summary}</p>
          <div>
            <h2 className="mb-1 font-semibold">{basic ? "About the ingredient" : n.kind === "supplement" ? "What it does" : "Roles in your body"}</h2>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
              {n.roles.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {!basic && (
              <p className="mt-3 text-sm text-ink-2">
                {n.kind === "supplement"
                  ? "The findings below show which uses were studied in people, what changed and how strong the evidence is."
                  : "These roles explain why your body needs the nutrient. Supplement benefits depend on your status and the use being studied."}
              </p>
            )}
          </div>
        </Card>

        {basic ? (
          <Card id="uses" className="flex scroll-mt-6 flex-col gap-3">
            <H2>Common uses</H2>
            <p className="text-sm text-ink-2">These are purposes people use it for. Benefits and study quality have not been reviewed here.</p>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {n.commonUses?.map((use) => <li key={use}>{use}</li>)}
            </ul>
          </Card>
        ) : (
          <>
            <span id="trials" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
            <Findings
              prefix="trial"
              title="Main uses & potential benefits"
              intro="See what this supplement may help with and who was studied. Benefits depend on the use and the people taking it."
              findings={n.findings}
            />
          </>
        )}
        {(n.interactions.length > 0 || n.cautions.length > 0) && (
          <Card id="interactions" className="flex scroll-mt-6 flex-col gap-3">
            <H2>Interactions and cautions</H2>
            <SafetyNotices notes={notes.filter((x) => n.interactions.some((i) => i.safetyId === x.id))} />
            {n.interactions.length > 0 && (
              <dl className="flex flex-col gap-3">
                {n.interactions.map((x) => (
                  <div key={x.with} className={cx(x.safetyId && safety.includes(x.safetyId) && "rounded-lg bg-warn-soft p-2")}>
                    <dt className="font-medium">{x.with}</dt>
                    <dd className="text-ink-2">{x.note}</dd>
                  </div>
                ))}
              </dl>
            )}
            {n.cautions.length > 0 && <List title="Cautions" items={n.cautions} />}
          </Card>
        )}
        {!basic && (
          <>
        <span id="status" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
        <Status n={n} all={all ?? []} />

        <span id="low-high" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
        <Card className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <H2>Too little</H2>
            <List title="Signs" items={n.low.signs} />
            <List title="Who tends to run low" items={n.low.atRisk} />
          </div>
          <div className="flex flex-col gap-3">
            <H2>Too much</H2>
            <p className="text-ink-2">{n.high.note}</p>
            {n.high.signs.length > 0 && <List title="Signs" items={n.high.signs} />}
          </div>
        </Card>
          </>
        )}

        {!basic && <ClockNote kind="nutrient" id={n.id} />}

        {n.foodFindings && n.foodFindings.length > 0 && (
          <Findings
            prefix="food"
            title="What studies of foods found"
            intro="Foods rich in it, not the supplement. A food brings many other compounds, so these findings don't carry over to supplements, or the other way round."
            findings={n.foodFindings}
          />
        )}

        {!critical && (!basic || n.foodSources.examples.length > 0) && (
          <>
            <span id="food" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
            <Foods n={n} safety={safety} />
          </>
        )}

        {n.forms.length > 0 && (
          <Card id="forms" className="flex scroll-mt-6 flex-col gap-3">
            <H2>Supplement forms</H2>
            <dl className="flex flex-col gap-3">
              {n.forms.map((f) => (
                <div key={f.name}>
                  <dt className="font-medium">{f.name}</dt>
                  <dd className="text-ink-2">{f.note}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        {!basic && (
          <>
            <span id="reference" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
            <Reference n={n} />
          </>
        )}


        {!critical && <Levers n={n} />}

        {!critical && n.status.biomarkerIds.length > 0 && (
          <Card className="flex flex-col gap-3">
            <H2>Test it on yourself</H2>
            <p className="text-ink-2">
              If you and your doctor decide to try a change (a food or a supplement), log it as a habit and watch your{" "}
              {lowerFirst(BIOMARKER_MAP.get(n.status.biomarkerIds[0]!)?.name ?? n.name)}. The app compares results before and after, allowing for
              normal test-to-test variation.
            </p>
            <div>
              <LinkButton variant="secondary" href={href({ name: "habits", add: n.name, marker: n.status.biomarkerIds[0] })}>
                Log a habit and watch the marker
              </LinkButton>
            </div>
          </Card>
        )}

        {!basic && hasEvidenceMap(n.id) && (
          <Card id="evidence-map" className="flex scroll-mt-6 flex-col gap-4">
            <H2>How the evidence was found</H2>
            <EvidenceMap mapId={n.id} citedTitles={Object.fromEntries([...n.findings, ...(n.foodFindings ?? [])].flatMap((f) => f.studies).flatMap((s) => (s.pmid ? [[s.pmid, s.title]] : [])))} />
          </Card>
        )}

        <span id="research" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
        <ResearchPanel
          name={n.name}
          terms={[n.name]}
          topic="supplementation"
          question={`What does research say about ${n.name.toLowerCase()} supplements, and is it relevant to my results?`}
          critical={critical}
        />

        <Card>
          <h2 className="mb-2 font-semibold">General sources</h2>
          {n.sources.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-ink-2">
            {n.sources.map((s) => (
              <li key={s.pmid ?? s.doi}>
                <StudyLink s={s} />
              </li>
            ))}
          </ul>
          )}
          {n.basicSources && (
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {n.basicSources.map((s) => (
                <li key={s.url}>
                  <PaperLink href={s.url} source={{ title: s.title, year: s.year }} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">{s.title}</PaperLink> ({s.year})
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-ink-2">
            {basic
              ? "Basic reference information, with sources for descriptions and cautions. Benefits have not been reviewed here. Not a diagnosis or a dose for you."
              : "General information, not a diagnosis or a dose for you. Grades and wording are a first draft, checked against the cited studies but not yet reviewed by a clinician."}
          </p>
        </Card>
          </>
        )}
      </div>
      </div>
    </>
  );
}

/** The side column on wide screens: your result, EU reference values and links in reading order. */
function Aside({ n, all, hasInteractions }: { n: NutrientDef; all: Parameters<typeof groupByBiomarker>[0]; hasInteractions: boolean }) {
  const profile = useProfile();
  const units = useDisplayUnits();
  const basic = n.researchStatus === "not-reviewed";
  const byMarker = groupByBiomarker(all);
  const ref = basic ? undefined : dailyReference(n, { sex: profile.sex, age: profile.birthMonth ? ageAt(profile.birthMonth, todayIso()) : undefined });
  const links = (n.simpleGuide ? [
    ["origin", "What it is"],
    ["uses", "Potential benefits & common claims"],
    ["dosage-safety", "Dosage & safety"],
    ["research", "Research"],
  ] : [
    basic ? ["uses", "Common uses"] : ["trials", "Main uses & potential benefits"],
    hasInteractions && ["interactions", "Interactions and cautions"],
    !basic && ["status", "How status is measured"],
    !basic && ["low-high", "Too little, too much"],
    (!basic || n.foodSources.examples.length > 0) && ["food", "Food sources"],
    n.forms.length > 0 && ["forms", "Supplement forms"],
    !basic && ["reference", "Reference intakes"],
    !basic && hasEvidenceMap(n.id) && ["evidence-map", "How the evidence was found"],
    ["research", "Search research"],
  ]).filter((x): x is [string, string] => Boolean(x));
  return (
    <aside aria-label="Key facts" className="hidden lg:col-start-2 lg:row-start-1 lg:block">
      <div className="sticky top-6 flex flex-col gap-5 text-sm">
        {n.status.biomarkerIds.length > 0 && (
          <section>
            <h2 className="mb-1.5 text-xs font-medium text-ink-2">Your result</h2>
            <ul className="flex flex-col gap-1.5">
              {n.status.biomarkerIds.map((id) => {
                const def = BIOMARKER_MAP.get(id);
                if (!def) return null;
                const ms = byMarker.get(id) ?? [];
                const latest = ms.length ? computeTrend(ms)?.latest : undefined;
                const flag = ms.length ? flagLatest(def, ms, profile) : undefined;
                const unit = displayUnitFor(def, units[def.id]);
                return (
                  <li key={id}>
                    <a href={href({ name: "marker", id })} className="block text-ink no-underline hover:underline">
                      {def.abbreviation ?? def.name}
                    </a>
                    {latest ? (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-base tabular-nums">
                          {showMeasurement(def, latest, unit)} {unit}
                        </span>
                        {flag && flag !== "unknown" && <FlagBadge flag={flag} />}
                        <span className="text-ink-2">{formatDate(latest.date)}</span>
                      </span>
                    ) : (
                      <span className="text-ink-2">No results yet</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {ref && (ref.intake || ref.bySex || ref.upperLimit || n.reference.noUpperLimit) && (
          <section>
            <h2 className="mb-1.5 text-xs font-medium text-ink-2">EU values for a day</h2>
            <dl className="flex flex-col gap-1.5">
              {ref.intake && (
                <div>
                  <dt className="text-ink-2">{ref.intake.type === "PRI" ? "Reference intake" : "Adequate intake"}, {lowerFirst(ref.intake.group)}</dt>
                  <dd className="text-base tabular-nums">
                    {formatValue(ref.intake.amount)} {ref.intake.unit}
                  </dd>
                </div>
              )}
              {ref.bySex && (
                <div>
                  <dt className="text-ink-2">Reference intake</dt>
                  <dd className="tabular-nums">
                    Men {formatValue(ref.bySex.men.amount)} {ref.bySex.men.unit}, women {formatValue(ref.bySex.women.amount)} {ref.bySex.women.unit}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-ink-2">Upper limit</dt>
                <dd className={cx(ref.upperLimit && "text-base tabular-nums")}>
                  {ref.upperLimit ? `${formatValue(ref.upperLimit.amount)} ${ref.upperLimit.unit}` : "None set"}
                </dd>
                {ref.upperLimit && <dd className="mt-1 text-xs text-ink-2">{ref.upperLimit.note}</dd>}
              </div>
            </dl>
            <p className="mt-1.5 text-xs text-ink-2">Reference intakes include food and supplements. Upper limits cover only the sources stated above. Population values, not a target or a dose for you.</p>
          </section>
        )}


        <nav aria-label="On this page">
          <h2 className="mb-1 text-xs font-medium text-ink-2">On this page</h2>
          <ul className="flex flex-col border-l border-line">
            {links.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} onClick={(e) => jump(e, id)} className="-ml-px block border-l border-transparent py-1 pl-3 text-ink-2 no-underline hover:border-ink hover:text-ink">
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

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-1 font-medium">{title}</h3>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** Your latest result for each of its status markers, and how status is measured. */
function Status({ n, all }: { n: NutrientDef; all: Parameters<typeof groupByBiomarker>[0] }) {
  const profile = useProfile();
  const units = useDisplayUnits();
  const byMarker = groupByBiomarker(all);
  return (
    <Card className="flex flex-col gap-3">
      <H2>How status is measured</H2>
      <p className="text-ink-2">{n.status.note}</p>
      {n.status.biomarkerIds.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {n.status.biomarkerIds.map((id) => {
            const def = BIOMARKER_MAP.get(id);
            if (!def) return null;
            const ms = byMarker.get(id) ?? [];
            const latest = ms.length ? computeTrend(ms)?.latest : undefined;
            const flag = ms.length ? flagLatest(def, ms, profile) : undefined;
            const unit = displayUnitFor(def, units[def.id]);
            return (
              <li key={id}>
                <a href={href({ name: "marker", id })} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 text-ink no-underline hover:bg-sunken">
                  <span>{fullName(def)}</span>
                  {latest ? (
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">
                        {showMeasurement(def, latest, unit)} {unit}
                      </span>
                      <span className="text-sm text-ink-2">{formatDate(latest.date)}</span>
                      {flag && flag !== "unknown" && <FlagBadge flag={flag} />}
                    </span>
                  ) : (
                    <span className="text-sm text-ink-2">No results yet</span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}


/** Food sources in words, and measured amounts per portion where the food table has the nutrient. */
function Foods({ n, safety }: { n: NutrientDef; safety: SafetyId[] }) {
  const key = n.foodSources.cofidNutrient;
  const sel = key ? selectFoods(FOODS, key, FOODS.foods.map((f) => f.id), safety) : undefined;
  const unit = key ? FOODS.nutrients[key]?.unit : undefined;
  const rows = sel?.shown.filter((r) => r.amount > 0).slice(0, 8) ?? [];
  return (
    <Card className="flex flex-col gap-3">
      <H2>Food sources</H2>
      <ul className="flex flex-wrap gap-2">
        {n.foodSources.examples.map((x) => (
          <li key={x} className="rounded-full bg-sunken px-3 py-1 text-sm">
            {x}
          </li>
        ))}
      </ul>
      {n.foodSources.note && <p className="text-ink-2">{n.foodSources.note}</p>}
      {rows.length > 0 && (
        <div>
          <h3 className="mb-1 font-medium">Measured amounts in example portions</h3>
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((r) => (
              <li key={r.food.id} className="flex items-baseline justify-between gap-3 py-2">
                <span>
                  {r.food.name} <span className="text-sm text-ink-2">· {r.food.portion.label}, {r.food.portion.grams} g</span>
                </span>
                <span className="tabular-nums whitespace-nowrap">
                  {formatValue(r.amount)} {unit}
                </span>
              </li>
            ))}
          </ul>
          {sel && sel.hidden.length > 0 && (
            <p className="mt-2 text-sm text-ink-2">
              Not shown because of your habits or profile: {sel.hidden.map((h) => `${h.food.name} (${h.reason})`).join("; ")}.
            </p>
          )}
          <p className="mt-2 text-sm text-ink-2">
            From the UK food composition table (CoFID 2021). Portions are examples. Nutrient numbers cover ~150 measured compounds; foods contain
            thousands more that aren't tracked.
          </p>
        </div>
      )}
    </Card>
  );
}

function Reference({ n, bare = false }: { n: NutrientDef; bare?: boolean }) {
  const r = n.reference;
  const types = [...new Set(r.intake.map((x) => x.type))];
  const Box = bare ? "div" : Card;
  return (
    <Box className="flex flex-col gap-3">
      <div>
        {bare ? <h3 className="font-semibold">Reference intakes and upper limit</h3> : <H2>Reference intakes and upper limit</H2>}
        <p className="mt-1 text-ink-2">
          {bare && r.intake.length === 0
            ? "No daily reference intake is listed for this ingredient. A safety assessment is not a recommended intake or a general upper limit."
            : "Set by the European Food Safety Authority (EFSA) for healthy adults, from food and supplements together unless it says otherwise. They describe groups of people, not a target or a dose for you."}
        </p>
      </div>
      {r.intake.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-sm text-ink-2">
              <tr>
                <th className="py-2 pr-3 font-medium">Group</th>
                <th className="py-2 pr-3 font-medium">A day</th>
                <th className="py-2 font-medium">Kind</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.intake.map((x) => (
                <tr key={`${x.group}-${x.type}`}>
                  <td className="py-2 pr-3">{x.group}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatValue(x.amount)} {x.unit}
                  </td>
                  <td className="py-2 text-sm text-ink-2">{INTAKE_TYPE[x.type]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className="flex flex-col gap-1 text-sm text-ink-2">
        {types.includes("PRI") && <li>Population reference intake: enough for almost everyone in the group.</li>}
        {types.includes("AI") && <li>Adequate intake: the amount healthy people usually get, used when there wasn't enough data for a reference intake.</li>}
      </ul>
      <div className="rounded-lg bg-sunken p-3">
        <p className="font-medium">
          Tolerable upper intake level:{" "}
          {r.upperLimit ? (
            <span className="tabular-nums">
              {formatValue(r.upperLimit.amount)} {r.upperLimit.unit} a day
            </span>
          ) : (
            "none set"
          )}
        </p>
        <p className="mt-1 text-ink-2">{r.upperLimit ? r.upperLimit.note : r.noUpperLimit}</p>
        {(!bare || r.upperLimit) && <p className="mt-1 text-sm text-ink-2">The highest daily intake over a long time that is unlikely to cause harm in healthy adults.</p>}
      </div>
      <More summary="Sources">
        <ul className="flex flex-col gap-1 text-sm text-ink-2">
          {r.sources.map((s) => (
            <li key={s.pmid ?? s.doi}>
              <StudyLink s={s} />
            </li>
          ))}
        </ul>
      </More>
    </Box>
  );
}

/** The levers from the evidence base that concern this nutrient, linking to the marker pages that show them. */
function Levers({ n }: { n: NutrientDef }) {
  const claims = EVIDENCE.filter((c) => n.evidenceClaims.includes(c.id));
  if (claims.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <H2>On your marker pages</H2>
      <p className="text-ink-2">These also appear under "What is known to affect it" on the marker they concern.</p>
      <ul className="flex flex-col divide-y divide-line">
        {claims.map((c) => {
          const marker = BIOMARKER_MAP.get(c.markers[0]!.biomarkerId);
          return (
            <li key={c.id}>
              <a href={href({ name: "marker", id: c.markers[0]!.biomarkerId })} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 text-ink no-underline hover:bg-sunken">
                <span>
                  {c.lever}
                  {marker && <span className="text-sm text-ink-2"> · {marker.name}</span>}
                </span>
                <GradeBadge grade={c.grade} />
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
