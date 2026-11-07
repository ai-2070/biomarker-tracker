import type { NutrientDef } from "@bt/shared/core/nutrients";
import type { ReactNode } from "react";
import { askResearchBrain } from "../brain/store";
import { formatDate } from "../format";
import { ClaimEvidencePanel } from "./ClaimEvidencePanel";
import { More } from "./disclosure";
import { StudyLink } from "./evidence";
import { ResearchPanel } from "./ResearchPanel";
import { Button, Card } from "./ui";

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
        {guide.factsReviewedOn && (
          <p className="text-sm text-ink-2">
            Ingredient &amp; safety facts reviewed {formatDate(guide.factsReviewedOn)}. Claim checks below have their own dates.
          </p>
        )}
      </Card>

      {guide.claimTopics ? (
        <ClaimEvidencePanel n={n} guide={guide} critical={critical} />
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

      <Card id="dosage-safety" className="flex scroll-mt-6 flex-col gap-4">
        <h2 className="font-serif text-2xl font-normal">Dosage &amp; safety</h2>
        {guide.dosage.map((text) => (
          <p key={text}>{text}</p>
        ))}
        {reference}
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
        {n.forms.length > 0 && (
          <More summary={<>Supplement forms &amp; label checks</>} id="forms" tone="plain">
            <dl className="mt-2 flex flex-col gap-3">
              {n.forms.map((form) => (
                <div key={form.name}>
                  <dt className="font-medium">{form.name}</dt>
                  <dd className="text-ink-2">{form.note}</dd>
                </div>
              ))}
            </dl>
          </More>
        )}

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
