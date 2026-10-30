import { useState } from "react";
import { todayIso } from "../../core/dates";
import { NUTRIENT_OF_KEY, adultReference, mealTotals, shareOfReference, type FoodDb } from "../../core/meals";
import { findingCounts, sortFindings, type NutrientDef } from "../../core/nutrients";
import { ageAt } from "../../core/phenoageDraws";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import type { SafetyId } from "../../core/types";
import { formatValue } from "../../core/units";
import { FOOD_GROUPS, type FoodGroup, type ModernVerdict, type WholeFoodDef } from "../../core/wholeFoods";
import { AddToProtocol } from "../components/AddToProtocol";
import { StudyLink } from "../components/evidence";
import { EvidenceMap, hasEvidenceMap } from "../components/EvidenceMap";
import { Findings } from "../components/findings";
import { anchorId, jump } from "../components/glance";
import { SearchIcon } from "../components/icons";
import { LifestyleFigure } from "../components/LifestyleVisuals";
import { ResearchPanel } from "../components/ResearchPanel";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, Card, LinkButton, PageTitle, cx, inputStyles } from "../components/ui";
import { useFoodDb } from "../foodDb";
import { useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP, NUTRIENT_MAP, WHOLE_FOODS, WHOLE_FOOD_MAP, fullName } from "../knowledge";
import { href } from "../router";
import { NotFound } from "./NotFound";

const GROUP_LABEL: Record<FoodGroup, string> = {
  fruit: "Fruit",
  vegetables: "Vegetables",
  "oils and fats": "Oils and fats",
  "herbs and spices": "Herbs and spices",
  "nuts and seeds": "Nuts and seeds",
  fish: "Fish",
  "eggs and dairy": "Eggs and dairy",
  legumes: "Beans and lentils",
  grains: "Grains",
  drinks: "Drinks",
  sweets: "Sweets",
};

function countsText(f: WholeFoodDef): string {
  // findingCounts only reads `findings`, which food entries share with nutrients.
  const c = findingCounts({ findings: f.findings } as NutrientDef);
  return [
    c.helps && `${c.helps} ${c.helps === 1 ? "benefit" : "benefits"}`,
    c["no clear effect"] && `${c["no clear effect"]} no clear effect`,
    c.mixed && `${c.mixed} mixed`,
    c.harms && `${c.harms} ${c.harms === 1 ? "harm" : "harms"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Every word must start a word somewhere in the entry (name, other names, summary, what's in it, findings). */
function matches(f: WholeFoodDef, query: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = fold([f.name, ...f.otherNames, f.summary, ...f.inIt, ...f.findings.map((x) => x.outcome)].join(" "));
  return words.every((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(text));
}

/**
 * Knowledge → Foods: research on eating whole foods (extra virgin olive oil, blueberries, ginger…), not
 * their nutrients. A food holds thousands of compounds the food table doesn't track; a study of people
 * eating it captures all of them. General information, not a diet.
 */
export function WholeFoodsPage() {
  const [query, setQuery] = useState("");
  const shown = WHOLE_FOODS.filter((f) => matches(f, query));
  const searching = query.trim() !== "";
  return (
    <>
      <PageTitle sub="What research says about eating whole foods, not their nutrients one by one. A food holds thousands of compounds the food table doesn't measure, and a study of people eating it captures all of them. What's in each food, what studies found, what processing changes, and who should be careful. General information, not a diet.">
        Foods
      </PageTitle>

      <div role="search" className="relative mb-5 w-full sm:max-w-md">
        <SearchIcon width={18} height={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), setQuery(""))}
          placeholder="Search: olive oil, blood pressure, polyphenols"
          aria-label="Search foods"
          autoComplete="off"
          className={cx(inputStyles, "w-full pl-10")}
        />
      </div>

      {WHOLE_FOODS.length === 0 ? (
        <Card>
          <p className="text-ink-2">The foods knowledge base is being written.</p>
        </Card>
      ) : shown.length === 0 ? (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-ink-2">Nothing here matches “{query.trim()}”.</p>
          <Button variant="secondary" onClick={() => setQuery("")}>
            Clear the search
          </Button>
        </Card>
      ) : (
        <ul className={cx("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", !searching && "stagger")}>
          {[...shown]
            .sort((a, b) => FOOD_GROUPS.indexOf(a.group) - FOOD_GROUPS.indexOf(b.group) || a.name.localeCompare(b.name))
            .map((f) => (
              <li key={f.id}>
                <a
                  href={href({ name: "wholefood", id: f.id })}
                  className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-ink no-underline transition-[border-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-sm"
                >
                  <div>
                    <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">{GROUP_LABEL[f.group]}</p>
                    <h2 className="font-serif text-2xl font-normal">{f.name}</h2>
                  </div>
                  <p className="line-clamp-3 text-ink-2">{f.summary}</p>
                  <p className="mt-auto border-t border-line pt-3 text-sm text-ink-2">What studies found: {countsText(f)}</p>
                </a>
              </li>
            ))}
        </ul>
      )}

      <p className="mt-6 text-sm text-ink-2">
        Written from the cited studies and checked against their records; grades and wording are a first draft, not yet reviewed by a clinician.
        Most food research follows people over years rather than testing the food in a trial, and the grades say so.
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

/** One food: what's in it, what studies found, what processing changes, who should be careful. */
export function WholeFoodPage({ id }: { id: string }) {
  const f = WHOLE_FOOD_MAP.get(id);
  const profile = useProfile();
  const protocols = useProtocols() ?? [];
  const db = useFoodDb();
  if (!f) return <NotFound />;
  const notes = safetyNotes(safetyLabels(protocols, profile));
  const safety: SafetyId[] = notes.map((x) => x.id);
  const yours = f.whoShouldBeCareful.filter((x) => x.safetyId && safety.includes(x.safetyId));
  const watch = f.markers.find((m) => BIOMARKER_MAP.has(m));
  const mapId = `wholefood-${f.id}`;

  return (
    <>
      <a href={href({ name: "wholefoods" })} className="mb-3 inline-flex min-h-11 items-center gap-1 text-ink-2 no-underline hover:text-ink">
        <span aria-hidden="true">←</span> Foods
      </a>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">{GROUP_LABEL[f.group]}</p>
          <h1 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl">{f.name}</h1>
          {f.otherNames.length > 0 && <p className="mt-1 max-w-3xl text-ink-2">Also: {f.otherNames.slice(0, 3).join(", ")}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="secondary" href={href({ name: "habits", add: f.name, type: "diet", ...(watch ? { marker: watch } : {}) })}>
            Start as a habit
          </LinkButton>
          <AddToProtocol label={f.name} category="diet" amountHint="e.g. 2 tablespoons" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,48rem)_18rem] lg:gap-10">
        <Aside f={f} hasMap={hasEvidenceMap(mapId)} />
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

          {/* The answer first: the summary, then what studies found; the detail behind it follows. */}
          <p className="max-w-3xl text-lg">{f.summary}</p>

          <span id="findings" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
          <Findings
            prefix="finding"
            title="Main uses &amp; benefits"
            intro="Studies of people eating the food, strongest evidence first. Many follow people over years rather than testing the food in a trial, and people who eat a food often differ in other ways, so the grades say how sure the evidence is."
            findings={f.findings}
          />

          {f.visuals.length > 0 && (
            <Card className="flex flex-col gap-6">
              <H2 id="pictures">In pictures</H2>
              {f.visuals.map((v, i) => (
                <div key={v.title} className={cx(i > 0 && "border-t border-line pt-5")}>
                  <LifestyleFigure v={v} id={anchorId("visual", v.title)} />
                </div>
              ))}
            </Card>
          )}

          {(f.history || f.lore) && <History f={f} />}

          <Card id="in-it" className="flex scroll-mt-6 flex-col gap-4">
            <H2>What's in it</H2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
              {f.inIt.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {f.tableFoods.length > 0 && <Measured f={f} db={db} />}
          </Card>

          <Card className="flex flex-col gap-3">
            <H2 id="processing">What the studies used, and what changes it</H2>
            <p className="text-ink-2">{f.whatStudiesDid}</p>
            {f.processing.length > 0 && (
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
                {f.processing.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
          </Card>

          {(f.whoShouldBeCareful.length > 0 || f.cautions.length > 0) && (
            <Card id="careful" className="flex scroll-mt-6 flex-col gap-3">
              <H2>Who should be careful</H2>
              <SafetyNotices notes={notes.filter((x) => f.whoShouldBeCareful.some((w) => w.safetyId === x.id))} />
              {f.whoShouldBeCareful.length > 0 && (
                <dl className="flex flex-col gap-3">
                  {f.whoShouldBeCareful.map((x) => (
                    <div key={x.with} className={cx(x.safetyId && safety.includes(x.safetyId) && "rounded-lg bg-warn-soft p-2")}>
                      <dt className="font-medium">{x.with}</dt>
                      <dd className="text-ink-2">{x.note}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {f.cautions.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
                  {f.cautions.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card id="unknowns" className="flex scroll-mt-6 flex-col gap-2">
            <H2>What isn't known yet</H2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
              {f.unknowns.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </Card>

          {hasEvidenceMap(mapId) && (
            <Card id="evidence-map" className="flex scroll-mt-6 flex-col gap-4">
              <H2>How the evidence was found</H2>
              <EvidenceMap mapId={mapId} citedTitles={Object.fromEntries(f.findings.flatMap((x) => x.studies).flatMap((s) => (s.pmid ? [[s.pmid, s.title]] : [])))} />
            </Card>
          )}

          {watch && (
            <Card className="flex flex-col gap-3">
              <H2>Test it on yourself</H2>
              <p className="text-ink-2">
                Log it as a habit and pick markers to watch, such as your {fullName(BIOMARKER_MAP.get(watch)!).toLowerCase()}. The app compares your results before
                and after, allowing for normal variation. What it shows is what happened in you, including everything the food table doesn't measure.
              </p>
              <div>
                <LinkButton variant="secondary" href={href({ name: "habits", add: f.name, type: "diet", marker: watch })}>
                  Log a habit and watch a marker
                </LinkButton>
              </div>
            </Card>
          )}

          <span id="research" className="-mb-5 block scroll-mt-6" aria-hidden="true" />
          <ResearchPanel name={f.name} terms={[f.name]} question={`What does research say about eating ${f.name.toLowerCase()}, and is it relevant to my results?`} critical={false} />

          <Card>
            <h2 className="mb-2 font-semibold">General sources</h2>
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {f.sources.map((s) => (
                <li key={s.pmid ?? s.doi ?? s.title}>
                  <StudyLink s={s} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-2">
              General information, not a diagnosis or a diet for you. Grades and wording are a first draft, checked against the cited studies but not yet
              reviewed by a clinician.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

const VERDICT: Record<ModernVerdict, { label: string; className: string }> = {
  agrees: { label: "Studies agree", className: "bg-ok-soft text-ok" },
  partly: { label: "Partly", className: "bg-sunken text-ink" },
  "not tested": { label: "Not tested yet", className: "bg-accent-soft text-accent" },
  disagrees: { label: "Studies don't support it", className: "bg-warn-soft text-warn" },
  harmful: { label: "Can be harmful", className: "bg-danger-soft text-danger" },
};

/**
 * Then and now. First what people believed: myths, religion, symbols and folk beliefs, told as theirs with
 * where they're written. Then what people used the food for, set against what modern studies found:
 * generations of people eating a food and watching what followed tested the whole food, with every
 * compound in it, so old uses can point at effects no table explains; they can also be wrong.
 */
function History({ f }: { f: WholeFoodDef }) {
  const findingLink = (outcome: string | undefined) => {
    const to = outcome ? f.findings.find((x) => x.outcome === outcome) : undefined;
    return to ? anchorId("finding", `${to.outcome} ${to.population}`) : undefined;
  };
  return (
    <Card id="history" className="flex scroll-mt-6 flex-col gap-5">
      <div>
        <H2>Then and now</H2>
        <p className="mt-1 max-w-3xl text-ink-2">
          What people believed about {f.name.toLowerCase()} and used it for, long before laboratories. People judged a food by eating it and watching what
          followed, which tests everything in it, including what no food table measures; but watching without a comparison group is also fooled by
          illnesses that pass on their own, so each use is checked against the studies.
        </p>
      </div>

      {f.lore && (
        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">What people believed</h3>
          <ul className="flex flex-col gap-4">
            {f.lore.map((l) => {
              const anchor = findingLink(l.finding);
              return (
                <li key={`${l.who}|${l.belief}`} className="flex flex-col gap-1 border-l-2 border-line-strong pl-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-mono text-xs font-medium tracking-[0.1em] text-ink-2 uppercase">{l.who}</p>
                    {l.modern && <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", VERDICT[l.modern].className)}>{VERDICT[l.modern].label}</span>}
                  </div>
                  <p>{l.belief}</p>
                  {l.note && (
                    <p className="text-ink-2">
                      {l.note}
                      {anchor && (
                        <>
                          {" "}
                          <a href={`#${anchor}`} onClick={(e) => jump(e, anchor)} className="text-accent">
                            See the finding
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  <ul className="flex flex-col gap-0.5 text-sm text-ink-2">
                    {l.sources.map((src) => {
                      const href = src.url ?? (src.doi ? `https://doi.org/${src.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${src.pmid}/`);
                      return (
                        <li key={href}>
                          <span>{src.kind === "ancient text" ? "Text: " : "Source: "}</span>
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
                            {src.title}
                          </a>
                          {[src.author, src.when].filter(Boolean).length > 0 && <span> ({[src.author, src.when].filter(Boolean).join(", ")})</span>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {f.history && (
        <section className="flex flex-col gap-3">
          {f.lore && <h3 className="font-semibold">Uses, checked against studies</h3>}
          <ul className="flex flex-col gap-3">
            {f.history.map((h) => {
              const v = VERDICT[h.modern];
              const anchor = findingLink(h.finding);
              return (
                <li key={`${h.who}|${h.use}`} className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
                  <p className="font-mono text-xs font-medium tracking-[0.1em] text-ink-2 uppercase">{h.who}</p>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">{h.use}</p>
                    <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", v.className)}>{v.label}</span>
                  </div>
                  <p className="text-ink-2">
                    {h.note}
                    {anchor && (
                      <>
                        {" "}
                        <a href={`#${anchor}`} onClick={(e) => jump(e, anchor)} className="text-accent">
                          See the finding
                        </a>
                      </>
                    )}
                  </p>
                  <ul className="flex flex-col gap-0.5 text-sm text-ink-2">
                    {h.sources.map((src) => (
                      <li key={src.pmid ?? src.doi ?? src.title}>
                        <span>History: </span>
                        <StudyLink s={src} />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Card>
  );
}

/**
 * What the UK food table measured in an example portion: energy, fibre and sugars, and the vitamins and
 * minerals with the biggest share of a day's EU reference intake. The compounds the food is known for
 * aren't among them, and the note says so.
 */
function Measured({ f, db }: { f: WholeFoodDef; db: FoodDb | undefined }) {
  const profile = useProfile();
  const age = profile.birthMonth ? ageAt(profile.birthMonth, todayIso()) : undefined;
  if (!db) return <p className="text-sm text-ink-2">Loading the food table…</p>;
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-sunken p-3">
      <h3 className="font-semibold">What the food table measured</h3>
      {f.tableFoods.map((t) => {
        const total = mealTotals([{ foodId: t.id, grams: t.grams }], db);
        const name = db.foods.find((x) => x[0] === t.id)?.[1] ?? t.id;
        const unit = (k: string) => db.nutrients[k]?.unit ?? "";
        const amount = (k: string) => (total[k]?.measuredIn ? `${formatValue(total[k]!.amount)} ${k === "energyKcal" ? "kcal" : unit(k)}` : undefined);
        const top = Object.keys(NUTRIENT_OF_KEY)
          .flatMap((k) => {
            const n = NUTRIENT_MAP.get(NUTRIENT_OF_KEY[k]!);
            const share = n && total[k] ? shareOfReference(total[k]!, unit(k), adultReference(n, { sex: profile.sex, age })) : undefined;
            return share !== undefined && share >= 5 ? [{ k, n: n!, share }] : [];
          })
          .sort((a, b) => b.share - a.share)
          .slice(0, 4);
        const basics = (["energyKcal", "fibre", "sugars", "fat"] as const).flatMap((k) => (amount(k) ? [[db.nutrients[k]?.label ?? k, amount(k)!] as const] : []));
        return (
          <div key={t.id} className="flex flex-col gap-1.5 text-sm">
            <p>
              <span className="font-medium">{t.label}</span> <span className="text-ink-2">({name}, {formatValue(t.grams)} g)</span>
            </p>
            <p className="text-ink-2 tabular-nums">{basics.map(([label, v]) => `${label.replace(/ \(.*\)$/, "")} ${v}`).join(" · ")}</p>
            {top.length > 0 && (
              <p className="text-ink-2 tabular-nums">
                Most of a day's EU reference:{" "}
                {top.map((x, i) => (
                  <span key={x.k}>
                    {i > 0 && ", "}
                    <a href={href({ name: "nutrient", id: x.n.id })} className="text-ink underline underline-offset-2">
                      {x.n.name}
                    </a>{" "}
                    {x.share}%
                  </span>
                ))}
              </p>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink-2">
        The table measures about 30 nutrients. The compounds this food is known for, listed above, mostly aren't among them, so these numbers are
        only part of the story.{" "}
        <a href={href({ name: "meals", section: "dark-matter" })} className="text-accent">
          What food tables can't tell you
        </a>
      </p>
    </div>
  );
}

/** Side column on wide screens: what studies found, and where things are on the page. */
function Aside({ f, hasMap }: { f: WholeFoodDef; hasMap: boolean }) {
  const links: [string, string][] = [
    ["findings", "Main uses & benefits"],
    ...((f.visuals.length ? [["pictures", "In pictures"]] : []) as [string, string][]),
    ...((f.history || f.lore ? [["history", "Then and now"]] : []) as [string, string][]),
    ["in-it", "What's in it"],
    ["processing", "What changes it"],
    ...((f.whoShouldBeCareful.length > 0 || f.cautions.length > 0 ? [["careful", "Who should be careful"]] : []) as [string, string][]),
    ["unknowns", "What isn't known yet"],
    ...((hasMap ? [["evidence-map", "How the evidence was found"]] : []) as [string, string][]),
    ["research", "Search research"],
  ];
  return (
    <aside aria-label="Key facts" className="hidden lg:col-start-2 lg:row-start-1 lg:block">
      <div className="sticky top-6 flex flex-col gap-5 text-sm">
        <section>
          <h2 className="mb-1.5 text-xs font-medium text-ink-2">Main uses &amp; benefits</h2>
          <ul className="flex flex-col gap-1">
            {sortFindings(f.findings).map((x) => (
              <li key={`${x.outcome}|${x.population}`}>
                <a href={`#${anchorId("finding", `${x.outcome} ${x.population}`)}`} onClick={(e) => jump(e, anchorId("finding", `${x.outcome} ${x.population}`))} className="text-ink no-underline hover:underline">
                  {x.label ?? x.outcome}
                </a>
              </li>
            ))}
          </ul>
        </section>
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
