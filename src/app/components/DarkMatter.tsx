import { coverage, type FoodDb } from "../../core/meals";
import type { Citation } from "../../core/types";
import { StudyLink } from "./evidence";
import { Card } from "./ui";

/**
 * Nutritional dark matter: what no food table can tell you. Shown in full on the Meals page and as a
 * short note under every meal's totals. The numbers about this app's table are counted from the table
 * itself; everything else cites a source (CLAUDE.md, Nutrition).
 */

const SOURCES: Record<string, Citation> = {
  barabasi: { doi: "10.1038/s43016-019-0005-1", title: "The unmapped chemical complexity of our diet", year: 2019, studyType: "review" },
  foodmine: { pmid: "33004889", doi: "10.1038/s41598-020-73105-0", title: "Exploring food contents in scientific literature with FoodMine", year: 2020, studyType: "review" },
  atbc: { pmid: "8127329", title: "The effect of vitamin E and beta carotene on the incidence of lung cancer and other cancers in male smokers", year: 1994, studyType: "rct", n: 29133 },
  caret: { pmid: "8602180", title: "Effects of a combination of beta carotene and vitamin A on lung cancer and cardiovascular disease", year: 1996, studyType: "rct", n: 18314 },
  carotenoids: { pmid: "18689373", title: "Carotenoids and the risk of developing lung cancer: a systematic review", year: 2008, studyType: "meta-analysis" },
};

function Ref({ id, n }: { id: keyof typeof SOURCES; n: number }) {
  return (
    <a href={SOURCES[id]!.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${SOURCES[id]!.pmid}/` : `https://doi.org/${SOURCES[id]!.doi}`} target="_blank" rel="noopener noreferrer" className="align-super text-xs text-ink-2 no-underline hover:text-ink">
      [{n}]
    </a>
  );
}

/** The full explainer, for the Meals page. */
export function DarkMatterExplainer({ db }: { db: FoodDb | undefined }) {
  const c = db ? coverage(db) : undefined;
  const total = db?.foods.length ?? 0;
  const pct = (k: string) => (c && total ? Math.round(((c[k] ?? 0) / total) * 100) : undefined);
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">Before you read the numbers</p>
        <h2 className="font-serif text-2xl font-normal">What food tables can't tell you</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h3 className="font-medium">Food tables measure a short list</h3>
          <p className="mt-1 text-ink-2">
            The numbers here come from the UK food composition table (CoFID 2021){total ? `: ${total.toLocaleString("en-GB")} foods` : ""}, about 30
            nutrients each. Even those aren't always measured
            {c && total
              ? `: vitamin K in ${pct("vitaminK1")}% of the foods, omega-3 EPA and DHA in ${pct("epaDha")}%, fibre in ${pct("fibre")}%, iodine in ${pct("iodine")}%`
              : ""}
            . A nutrient that wasn't measured counts as missing, never as zero, and every total says so.
          </p>
        </section>
        <section>
          <h3 className="font-medium">Food contains far more</h3>
          <p className="mt-1 text-ink-2">
            Researchers estimate that food contains more than 26,000 distinct chemicals, while standard food databases track about 150 nutrients
            <Ref id="barabasi" n={1} />. When a study searched the research literature for just two foods, garlic and cocoa, it found a lot of
            information about their chemicals that no database includes, much of it relevant to health
            <Ref id="foodmine" n={2} />. This is sometimes called nutritional dark matter.
          </p>
        </section>
        <section>
          <h3 className="font-medium">A food isn't its nutrient list</h3>
          <p className="mt-1 text-ink-2">
            Diets rich in carotenoid foods were linked to slightly less lung cancer<Ref id="carotenoids" n={3} />, but beta-carotene pills raised
            lung cancer in smokers in two large trials<Ref id="atbc" n={4} />
            <Ref id="caret" n={5} />. A food and an isolated nutrient are different things, so the app grades their evidence separately and never
            carries one over to the other.
          </p>
        </section>
        <section>
          <h3 className="font-medium">So the app does this</h3>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-ink-2">
            <li>Shows only measured amounts, and how many foods each total covers.</li>
            <li>Never calls a meal complete, balanced or best for you, and sets no targets.</li>
            <li>Lets you measure instead of predict: add a meal to a protocol, start it, and compare your results before and after. Your body responds to every compound, named or not.</li>
          </ul>
        </section>
      </div>

      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-2">Sources</summary>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-ink-2">
          {(["barabasi", "foodmine", "carotenoids", "atbc", "caret"] as const).map((k) => (
            <li key={k}>
              <StudyLink s={SOURCES[k]!} />
            </li>
          ))}
          <li>
            McCance and Widdowson's Composition of Foods Integrated Dataset (CoFID) 2021, UK Government, Open Government Licence v3.0.
          </li>
        </ol>
      </details>
    </Card>
  );
}

/** The short version, under a meal's totals. */
export function DarkMatterNote() {
  return (
    <p className="text-sm text-ink-2">
      These totals cover only the nutrients the food table measured (about 30 here, of more than 26,000 chemicals estimated in food). They
      say nothing about the rest, and nothing about how your body handles this meal: your own results before and after a change do.
    </p>
  );
}
