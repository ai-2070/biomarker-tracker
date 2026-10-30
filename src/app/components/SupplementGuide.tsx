import type { NutrientDef } from "../../core/nutrients";
import { askResearchBrain } from "../brain/store";
import { StudyLink } from "./evidence";
import { Button, Card } from "./ui";

/** A concise claim guide; evidence is retrieved on demand, never implied by a static grade. */
export function SupplementGuide({ n, guide }: { n: NutrientDef; guide: NonNullable<NutrientDef["simpleGuide"]> }) {
  return (
    <>
      <Card>
        <p className="text-lg">{n.summary}</p>
      </Card>

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
                aria-label={`Check evidence with Brain: ${claim}`}
                onClick={() => askResearchBrain(`Check the current human evidence for this claim about oral ${n.name.toLowerCase()} on its own: "${claim}".`)}
              >
                Check evidence
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="origin" className="flex scroll-mt-6 flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">What it is &amp; where it comes from</h2>
        {guide.origin.map((text) => <p key={text} className="text-ink-2">{text}</p>)}
      </Card>

      <Card id="dosage-safety" className="flex scroll-mt-6 flex-col gap-4">
        <h2 className="font-serif text-2xl font-normal">Dosage &amp; safety</h2>
        {guide.dosage.map((text) => <p key={text}>{text}</p>)}
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
            {n.cautions.map((text) => <li key={text}>{text}</li>)}
          </ul>
        )}
      </Card>

      {n.forms.length > 0 && (
        <Card id="forms" className="scroll-mt-6">
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">Supplement forms &amp; label checks</summary>
            <dl className="mt-2 flex flex-col gap-3">
              {n.forms.map((form) => (
                <div key={form.name}>
                  <dt className="font-medium">{form.name}</dt>
                  <dd className="text-ink-2">{form.note}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Card>
      )}

      <Card id="sources" className="scroll-mt-6">
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Ingredient &amp; safety sources</summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-ink-2">
            {n.sources.map((source) => <li key={source.pmid ?? source.doi}><StudyLink s={source} /></li>)}
          </ul>
        </details>
      </Card>
    </>
  );
}
