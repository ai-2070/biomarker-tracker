import { useRef, useState, type FormEvent } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { checkCitations, type CitationCheck } from "../../ai/citations";
import { buildAiContext, trendLines, type ContextResult } from "../../ai/context";
import { askModel, isCloud, type AiConfig } from "../../ai/providers";
import { todayIso } from "../../core/dates";
import { ageAt, isBirthMonth } from "../../core/phenoageDraws";
import { activeOn, safetyNotes } from "../../core/protocols";
import { computeTrend, flagMeasurement, resolveRange, sortByDate } from "../../core/trends";
import type { BiomarkerDef, Measurement, Profile, ProtocolEntry } from "../../core/types";
import { markerTerms, searchPapers, type Paper, type SearchFilter, type SearchResult } from "../../research/papers";
import { CATEGORY_LABEL, showChange, showMeasurement, showRange } from "../format";
import { useAiConfig } from "../hooks";
import { nameInSentence } from "../knowledge";
import { href } from "../router";
import { ChoiceGroup } from "./ChoiceGroup";
import { Button, Card, CheckIcon, Notice, cx, helpStyles, inputStyles, labelStyles } from "./ui";

const KIND_LABEL: Record<Paper["kind"], string> = {
  guideline: "Guideline",
  "meta-analysis": "Meta-analysis",
  "systematic review": "Systematic review",
  "randomised trial": "Randomised trial",
  review: "Review",
  observational: "Observational",
  other: "Study",
};

/** Research search for one marker, with optional AI questions about the results. */
export function ResearchPanel({
  def,
  measurements,
  profile,
  protocols,
  unit,
  critical,
}: {
  def: BiomarkerDef;
  measurements: Measurement[];
  profile: Profile;
  protocols: ProtocolEntry[];
  unit: string;
  critical: boolean;
}) {
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
        <h2 className="text-lg font-semibold">Research</h2>
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
            <AskAi def={def} measurements={measurements} profile={profile} protocols={protocols} unit={unit} papers={papers} critical={critical} />
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

function SmallCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <Checkbox.Root
        checked={checked}
        onCheckedChange={onChange}
        className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
      >
        <Checkbox.Indicator className="flex data-unchecked:hidden">
          <CheckIcon />
        </Checkbox.Indicator>
      </Checkbox.Root>
      {label}
    </label>
  );
}

function providerName(c: AiConfig): string {
  return c.provider === "anthropic" ? `Anthropic (${c.model})` : c.provider === "openai" ? `OpenAI (${c.model})` : `Ollama on this computer (${c.model})`;
}

function AskAi({
  def,
  measurements,
  profile,
  protocols,
  unit,
  papers,
  critical,
}: {
  def: BiomarkerDef;
  measurements: Measurement[];
  profile: Profile;
  protocols: ProtocolEntry[];
  unit: string;
  papers: Paper[];
  critical: boolean;
}) {
  const config = useAiConfig();
  const [question, setQuestion] = useState("");
  const [includeResults, setIncludeResults] = useState(true);
  const [includeLog, setIncludeLog] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof buildAiContext> | null>(null);
  const [answer, setAnswer] = useState<{ check: CitationCheck; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  if (config === undefined) return null;

  // Safety rule: no AI commentary when the latest value is critical.
  if (critical) {
    return (
      <Notice tone="danger" title="AI answers are off for this marker">
        Your latest result is far outside the usual range. Please contact a doctor rather than relying on an AI summary.
      </Notice>
    );
  }
  if (config === null) {
    return (
      <Notice title="Ask questions about these studies">
        Set up an AI assistant on the{" "}
        <a href={href({ name: "data" })} className="underline underline-offset-2">
          Data page
        </a>{" "}
        to get a plain-language summary that cites these studies. This is optional.
      </Notice>
    );
  }

  const ongoing = protocols.filter((p) => !p.end);
  const cautious = safetyNotes(ongoing.map((p) => p.label)).length > 0;

  function makePreview() {
    if (!question.trim()) {
      setError("Type a question first.");
      return;
    }
    setError(null);
    setAnswer(null);
    const sorted = sortByDate(measurements);
    const results: ContextResult[] = sorted.map((m) => ({
      date: m.date,
      value: showMeasurement(def, m, unit),
      flag: flagMeasurement(def, m, profile),
      range: showRange(def, resolveRange(def, m, profile), unit),
    }));
    const trend = computeTrend(measurements);
    const today = todayIso();
    const age = profile.birthMonth && isBirthMonth(profile.birthMonth) ? ageAt(profile.birthMonth, today) : undefined;
    const relevant = protocols.filter((p) => sorted.some((m) => activeOn([p], m.date).length > 0) || !p.end);
    setPreview(
      buildAiContext({
        def,
        unit,
        question,
        papers,
        results: includeResults ? results : undefined,
        trendLines: includeResults
          ? trendLines(
              trend,
              trend?.change !== undefined ? `${showChange(def, trend.change, unit)} ${unit}` : undefined,
              trend?.ratePerYear !== undefined ? `${showChange(def, trend.ratePerYear, unit)} ${unit}` : undefined,
            )
          : undefined,
        range: includeResults ? resolveRange(def, trend?.latest ?? {}, profile) : undefined,
        age: includeResults ? age : undefined,
        sex: includeResults ? profile.sex : undefined,
        logLines: includeLog
          ? relevant.map((p) => `${p.label} (${CATEGORY_LABEL[p.category].toLowerCase()}), ${p.start} to ${p.end ?? "now"}`)
          : undefined,
        cautious,
      }),
    );
  }

  async function send() {
    if (!preview || !config) return;
    setBusy(true);
    setError(null);
    abort.current = new AbortController();
    try {
      const r = await askModel(config, preview.system, preview.user, (u, i) => fetch(u, i), abort.current.signal);
      if (r.ok) {
        setAnswer({ check: checkCitations(r.text, preview.allowedIds), truncated: r.truncated });
        setPreview(null);
      } else setError(r.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ask-ai" className="flex flex-col gap-3 rounded-xl border border-line-strong p-4">
      <h3 id="ask-ai" className="font-semibold">
        Ask about these studies
      </h3>
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className="sr-only">Your question</Field.Label>
        <Field.Control
          render={<textarea rows={3} />}
          value={question}
          onValueChange={(v) => {
            setQuestion(v);
            setPreview(null);
          }}
          placeholder={`e.g. What do these studies say about what affects ${nameInSentence(def)}?`}
          className={`${inputStyles} py-2`}
        />
      </Field.Root>
      <div className="flex flex-col">
        <SmallCheckbox
          checked={includeResults}
          onChange={(v) => {
            setIncludeResults(v);
            setPreview(null);
          }}
          label={`Include my ${def.name} results, age and sex`}
        />
        <SmallCheckbox
          checked={includeLog}
          onChange={(v) => {
            setIncludeLog(v);
            setPreview(null);
          }}
          label="Include my log (supplements, diet, medicines)"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {!preview ? (
        <div>
          <Button variant="secondary" onClick={makePreview}>
            Review what will be sent
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Notice tone={isCloud(config.provider) ? "warn" : "info"} title={`This exact text will be sent to ${providerName(config)}`}>
            {isCloud(config.provider)
              ? "It leaves your device and is handled under that company's privacy terms. No name, birth date, lab name, notes or IDs are included."
              : "It stays on this computer."}
          </Notice>
          <pre className="max-h-80 overflow-auto rounded-lg bg-sunken p-3 font-mono text-xs whitespace-pre-wrap text-ink-2">
            {`--- Instructions for the AI ---\n${preview.system}\n\n--- Message ---\n${preview.user}`}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? "Waiting for the answer…" : "Send"}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                abort.current?.abort();
                setPreview(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {answer && <AiAnswer check={answer.check} truncated={answer.truncated} papers={papers} />}
    </section>
  );
}

function AiAnswer({ check, truncated, papers }: { check: CitationCheck; truncated: boolean; papers: Paper[] }) {
  const byId = new Map(papers.map((p) => [p.id, p]));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
      <p className="text-sm font-medium text-ink-2">AI summary. It can be wrong; check the studies it cites.</p>
      <div className="whitespace-pre-line">
        {check.segments.map((s, i) =>
          s.type === "text" ? (
            <span key={i}>{s.text}</span>
          ) : s.valid ? (
            <a
              key={i}
              href={byId.get(s.id)?.url ?? `#paper-${s.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title={byId.get(s.id)?.title}
              className="mx-0.5 inline-flex items-center rounded bg-accent-soft px-1.5 font-mono text-xs text-accent no-underline"
            >
              {s.id}
            </a>
          ) : (
            <span key={i} className="mx-0.5 inline-flex items-center rounded bg-danger-soft px-1.5 font-mono text-xs text-danger line-through" title="Not one of the retrieved studies">
              {s.id}
            </span>
          ),
        )}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        <li className={cx(check.verified.length ? "text-ok" : "text-ink-2")}>
          {check.verified.length} {check.verified.length === 1 ? "citation" : "citations"} checked against the retrieved studies.
        </li>
        {check.unverified.length > 0 && (
          <li className="font-medium text-danger">
            {check.unverified.length} {check.unverified.length === 1 ? "citation is" : "citations are"} not among the retrieved studies (struck
            through). Don't rely on {check.unverified.length === 1 ? "it" : "them"}.
          </li>
        )}
        {check.looseReferences.length > 0 && (
          <li className="font-medium text-warn">
            The answer mentions {check.looseReferences.join(", ")} without an ID, so it can't be checked.
          </li>
        )}
        {check.verified.length === 0 && check.unverified.length === 0 && (
          <li className="text-warn">The answer cites no studies, so nothing in it is backed by the search results.</li>
        )}
        {truncated && <li className="text-warn">The answer was cut off because it was too long.</li>}
      </ul>
      <p className="text-sm text-ink-2">Not medical advice. Talk to your doctor before making changes.</p>
    </div>
  );
}
