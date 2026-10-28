import { useState, type FormEvent } from "react";
import { Field } from "@base-ui/react/field";
import type { BiomarkerDef } from "../../core/types";
import { useServerStatus } from "../api";
import { markerTerms, searchPapers, type Paper, type SearchFilter, type SearchResult } from "../../research/papers";
import { nameInSentence } from "../knowledge";
import { openBrain } from "../brain/store";
import { ChoiceGroup } from "./ChoiceGroup";
import { Button, Card, Notice, helpStyles, inputStyles, labelStyles } from "./ui";

const KIND_LABEL: Record<Paper["kind"], string> = {
  guideline: "Guideline",
  "meta-analysis": "Meta-analysis",
  "systematic review": "Systematic review",
  "randomised trial": "Randomised trial",
  review: "Review",
  observational: "Observational",
  other: "Study",
};

/** Research search for one marker, with a hand-off to the assistant. */
export function ResearchPanel({ def, critical }: { def: BiomarkerDef; critical: boolean }) {
  const [filter, setFilter] = useState<SearchFilter>("reviews");
  const [topic, setTopic] = useState("");
  const [state, setState] = useState<{ status: "idle" | "loading" | "error"; error?: string; result?: SearchResult; query?: string }>({
    status: "idle",
  });
  const terms = markerTerms(def.name, def.abbreviation);

  async function search(e: FormEvent) {
    e.preventDefault();
    setState({ status: "loading" });
    try {
      const result = await searchPapers(terms, filter, topic, (u, i) => fetch(u, i), AbortSignal.timeout(20_000));
      setState({ status: "idle", result, query: [terms.join(" / "), topic.trim()].filter(Boolean).join(" + ") });
    } catch {
      setState({ status: "error", error: "The research databases couldn't be reached. Check your internet connection and try again." });
    }
  }

  const papers = state.result?.papers ?? [];
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">Research</h2>
        <p className="mt-1 text-ink-2">
          Search published studies about {def.name}. Only the search words are sent, to Europe PMC (or PubMed if it's down). Your
          results are not.
        </p>
      </div>

      <form onSubmit={search} className="flex flex-col gap-4">
        <ChoiceGroup<SearchFilter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "reviews", label: "Reviews & guidelines" },
            { value: "trials", label: "Trials" },
            { value: "all", label: "Everything" },
          ]}
        />
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Narrow it down (optional)</Field.Label>
          <Field.Control value={topic} onValueChange={setTopic} placeholder="e.g. vitamin C, pregnancy, exercise" autoComplete="off" maxLength={80} className={inputStyles} />
          <Field.Description className={helpStyles}>Don't type personal details here; these words are sent to the search service.</Field.Description>
        </Field.Root>
        <div>
          <Button type="submit" disabled={state.status === "loading"}>
            {state.status === "loading" ? "Searching…" : "Search studies"}
          </Button>
        </div>
      </form>

      {state.status === "error" && (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      )}

      {state.result && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-sm text-ink-2">
            {papers.length === 0
              ? "No studies found. Try fewer or different words."
              : `Top ${papers.length} of ${state.result.total.toLocaleString()} for "${state.query}", from ${state.result.source === "europepmc" ? "Europe PMC" : "PubMed"}.`}
            {state.result.source === "pubmed" && papers.length > 0 && " Abstracts aren't available from the backup source."}
          </p>
          <ul className="flex flex-col gap-3">
            {papers.map((p) => (
              <li key={p.id} id={`paper-${p.id}`}>
                <PaperItem paper={p} />
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-2">
            Search results are sorted by relevance, not quality. A single study rarely settles a question; reviews and guidelines weigh
            many studies together.
          </p>
          {papers.length > 0 && (
            <AskAssistantLink def={def} critical={critical} />
          )}
        </div>
      )}
    </Card>
  );
}

function PaperItem({ paper: p }: { paper: Paper }) {
  return (
    <article className="rounded-lg border border-line p-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <span className="rounded-full bg-sunken px-2 py-0.5 font-medium text-ink">{KIND_LABEL[p.kind]}</span>
        {p.year && <span>{p.year}</span>}
        {p.journal && <span>· {p.journal}</span>}
        {p.openAccess && <span className="rounded-full bg-ok-soft px-2 py-0.5 font-medium text-ok">Free full text</span>}
      </p>
      <h3 className="mt-1 font-medium">
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-ink underline-offset-2 hover:underline">
          {p.title}
        </a>
      </h3>
      {p.authors && <p className="truncate text-sm text-ink-2">{p.authors}</p>}
      {p.abstract && (
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-2">Abstract</summary>
          <p className="text-sm whitespace-pre-line text-ink-2">{p.abstract}</p>
        </details>
      )}
      <p className="mt-1 font-mono text-xs text-muted">{p.id}</p>
    </article>
  );
}

/** Hand questions about these studies to the assistant (it can search and cite on its own). */
function AskAssistantLink({ def, critical }: { def: BiomarkerDef; critical: boolean }) {
  const server = useServerStatus();
  // Safety rule: no AI commentary first when the latest value is critical.
  if (critical) {
    return (
      <Notice tone="danger" title="AI answers are off for this marker">
        Your latest result is far outside the usual range. Please contact a doctor rather than relying on an AI summary.
      </Notice>
    );
  }
  if (server === undefined) return null;
  return (
    <Notice title="Questions about these studies?">
      <p>Brain can read studies, weigh the evidence and explain it, citing only studies it actually retrieved.</p>
      <div className="mt-3">
        {server ? (
          <Button variant="secondary" onClick={() => openBrain({ draft: `What does research say about what affects my ${nameInSentence(def)}?` })}>
            Ask Brain
          </Button>
        ) : (
          <span className="text-sm">Start the app with <code className="font-mono">bun run start</code> to use Brain.</span>
        )}
      </div>
    </Notice>
  );
}
