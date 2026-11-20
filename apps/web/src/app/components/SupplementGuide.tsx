import { gramsForAmount, type NutrientDef } from "@bt/shared/core/nutrients";
import type { ReactNode } from "react";
import { askResearchBrain } from "../brain/store";
import { formatDate } from "../format";
import { ClaimEvidencePanel } from "./ClaimEvidencePanel";
import { More } from "./disclosure";
import { EvidenceMap, hasEvidenceMap } from "./EvidenceMap";
import { StudyLink } from "./evidence";
import { ResearchPanel } from "./ResearchPanel";
import { Button, Card } from "./ui";

/** 3000 mg reads as 3 g; small amounts stay in mg. */
const amount = (mg: number) => (mg >= 1000 ? `${mg / 1000} g` : mg >= 1 ? `${mg} mg` : `${Math.round(mg * 1e5) / 100} µg`);
/** A per-100 g range in one unit: 8–19 µg, 1.4–2.1 mg. */
const perRange = (a: number, b: number) => {
  if (a === b) return amount(a);
  if (b >= 1000 || b >= 1 !== a >= 1) return `${amount(a)}–${amount(b)}`;
  return `${amount(a).replace(/ (mg|µg)$/, "")}–${amount(b)}`;
};
/** One amount, or a range in a shared unit: 210–310 g, 1–1.3 kg. */
const gramRange = (a: number, b: number) => {
  const unit = b >= 1000 ? "kg" : "g";
  const f = (g: number) => (unit === "kg" ? Math.round(g / 100) / 10 : g);
  return a === b ? `${f(a)} ${unit}` : `${f(a)}–${f(b)} ${unit}`;
};

/** A concise claim guide; evidence is retrieved on demand, never implied by a static grade. */
export function SupplementGuide({
  n,
  guide,
  critical,
  reference,
}: {
  n: NutrientDef;
  guide: NonNullable<NutrientDef["simpleGuide"]>;
  critical: boolean;
  reference: ReactNode;
}) {
  return (
    <>
      <Card id="origin" className="flex scroll-mt-6 flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">What it is</h2>
        <p className="text-lg">{n.summary}</p>
        <div>
          <h3 className="mb-1 font-semibold">Where it comes from</h3>
          <div className="flex flex-col gap-2 text-ink-2">
            {guide.origin.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </div>
        </div>
        {n.roles.length > 0 && (
          <div>
            <h3 className="mb-1 font-semibold">Roles in your body</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
              {n.roles.map((role) => (
                <li key={role}>{role}</li>
              ))}
            </ul>
          </div>
        )}
        {n.forms.length > 0 && (
          <div>
            <h3 className="mb-1 font-semibold">Forms</h3>
            <dl className="flex flex-col gap-2">
              {n.forms.map((form) => (
                <div key={form.name}>
                  <dt className="font-medium">{form.name}</dt>
                  <dd className="text-ink-2">{form.note}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {guide.factsReviewedOn && (
          <p className="text-sm text-ink-2">
            Ingredient &amp; safety facts reviewed {formatDate(guide.factsReviewedOn)}. Claim checks below have their own dates.
          </p>
        )}
      </Card>

      {guide.claimTopics ? (
        <ClaimEvidencePanel
          id={n.id}
          name={n.name}
          critical={critical}
          claims={(n.commonUses ?? []).flatMap((claim) => {
            const topic = guide.claimTopics?.[claim];
            return topic ? [{ claim, topic, category: guide.claimCategories?.[claim] ?? "health", label: guide.claimLabels?.[claim] ?? claim }] : [];
          })}
        />
      ) : (
        <Card id="uses" className="scroll-mt-6">
          <h2 className="font-serif text-2xl font-normal">Potential benefits &amp; common claims</h2>
          <p className="mt-2 text-sm text-ink-2">Brain can look up current evidence for each claim, using your chosen model and research sources.</p>
          <ul className="mt-4 divide-y divide-line">
            {n.commonUses?.map((claim) => (
              <li key={claim} className="flex flex-col items-start gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="font-medium">{claim}</span>
                <Button
                  variant="secondary"
                  className="shrink-0"
                  disabled={critical}
                  aria-label={`Check evidence with Brain: ${claim}`}
                  onClick={() => askResearchBrain(`Check the current human evidence for this claim about oral ${n.name.toLowerCase()} on its own: "${claim}".`)}
                >
                  Check evidence
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card id="dosage" className="flex scroll-mt-6 flex-col gap-4">
        <h2 className="font-serif text-2xl font-normal">Dosage</h2>
        {guide.dosage.map((text) => (
          <p key={text}>{text}</p>
        ))}
        {reference}
      </Card>

      {(n.foodSources.examples.length > 0 || guide.foodAmounts) && (
        <Card id="food" className="flex scroll-mt-6 flex-col gap-3">
          <h2 className="font-serif text-2xl font-normal">Food sources</h2>
          {n.foodSources.examples.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {n.foodSources.examples.map((x) => (
                <li key={x} className="rounded-full bg-sunken px-3 py-1 text-sm">
                  {x}
                </li>
              ))}
            </ul>
          )}
          {n.foodSources.note && <p className="text-ink-2">{n.foodSources.note}</p>}
          {guide.foodAmounts && (
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold">Could you get the studied amount from food?</h3>
              {guide.foodAmounts.foods.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <caption className="sr-only">Grams of each food needed to reach each amount</caption>
                    <thead>
                      <tr className="border-b border-line text-ink-2">
                        <th scope="col" className="py-2 pr-3 font-medium">
                          Food
                        </th>
                        <th scope="col" className="py-2 pr-3 font-medium">
                          Contains per 100 g
                        </th>
                        {guide.foodAmounts.targets.map((t) => (
                          <th key={t.label} scope="col" className="py-2 pr-3 font-medium">
                            Food needed for {amount(t.mg)}
                            <span className="block text-xs font-normal">{t.label}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {guide.foodAmounts.foods.map((f) => (
                        <tr key={f.name}>
                          <th scope="row" className="py-2 pr-3 align-top font-medium">
                            {f.name}
                            {f.note && <span className="block text-xs font-normal text-ink-2">{f.note}</span>}
                          </th>
                          <td className="py-2 pr-3 align-top">{perRange(f.mgPer100g[0], f.mgPer100g[1])}</td>
                          {guide.foodAmounts!.targets.map((t) => {
                            const best = gramsForAmount(t.mg, f.mgPer100g[1]);
                            const worst = gramsForAmount(t.mg, f.mgPer100g[0]);
                            return (
                              <td key={t.label} className="py-2 pr-3 align-top">
                                {gramRange(best, worst)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p>{guide.foodAmounts.verdict}</p>
              {guide.foodAmounts.notChecked && <p className="text-sm text-ink-2">{guide.foodAmounts.notChecked}</p>}
              {guide.foodAmounts.foods.length > 0 && (
                <p className="text-sm text-ink-2">
                  Amounts are worked out by the app from the published figures for the raw food and rounded to 10 g. Real foods vary by source, season and
                  cooking, and eating a food is not the same intervention as taking an isolated supplement.
                </p>
              )}
              <ul className="flex flex-col gap-1 text-sm text-ink-2">
                {guide.foodAmounts.sources.map((source) => (
                  <li key={source.pmid ?? source.doi}>
                    <StudyLink s={source} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card id="safety" className="flex scroll-mt-6 flex-col gap-4">
        <h2 className="font-serif text-2xl font-normal">Safety</h2>
        {n.interactions.length > 0 && (
          <dl className="flex flex-col gap-3">
            {n.interactions.map((interaction) => (
              <div key={interaction.with}>
                <dt className="font-semibold">{interaction.with}</dt>
                <dd className="text-ink-2">{interaction.note}</dd>
              </div>
            ))}
          </dl>
        )}
        {n.cautions.length > 0 && (
          <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
            {n.cautions.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        )}
        <More summary={<>Requirement &amp; excess</>} id="low-high" tone="plain">
          <div className="mt-2 grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Too little</h3>
              {n.low.note && <p className="text-ink-2">{n.low.note}</p>}
              {n.low.signs.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
                  {n.low.signs.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
              {n.low.atRisk.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
                  {n.low.atRisk.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">Too much</h3>
              <p className="text-ink-2">{n.high.note}</p>
              {n.high.signs.length > 0 && (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
                  {n.high.signs.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </More>
        <More summary={<>Ingredient &amp; safety sources</>} id="sources" tone="plain">
          <ul className="mt-2 flex flex-col gap-2 text-sm text-ink-2">
            {n.sources.map((source) => (
              <li key={source.pmid ?? source.doi}>
                <StudyLink s={source} />
              </li>
            ))}
          </ul>
        </More>
      </Card>

      {hasEvidenceMap(n.id) && (
        <Card id="evidence-map" className="flex scroll-mt-6 flex-col gap-4">
          <h2 className="font-serif text-2xl font-normal">How the evidence was found</h2>
          <EvidenceMap mapId={n.id} citedTitles={{}} />
        </Card>
      )}

      <Card id="research" className="flex scroll-mt-24 flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">Research</h2>
        <ResearchPanel
          bare
          name={n.name}
          terms={[n.name]}
          topic="supplementation"
          question={`What does research say about ${n.name.toLowerCase()} supplements?`}
          critical={critical}
        />
      </Card>
    </>
  );
}
