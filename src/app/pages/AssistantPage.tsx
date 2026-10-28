import { useEffect, useRef, useState } from "react";
import { Field } from "@base-ui/react/field";
import { providerInfo } from "../../core/aiProviders";
import { assistantProfile } from "../../core/profile";
import { safetyLabels, safetyNotes } from "../../core/protocols";
import { computeTrend, flagMeasurement, groupByBiomarker, isCritical } from "../../core/trends";
import { db, getProfile } from "../../db/db";
import { api, useServerStatus } from "../api";
import { CitedAnswer } from "../components/CitedAnswer";
import { CriticalBanner, type CriticalItem } from "../components/CriticalBanner";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, LinkButton, Notice, PageTitle, cx, inputStyles } from "../components/ui";
import { useAllMeasurements, useProfile, useProtocols } from "../hooks";
import { BIOMARKER_MAP } from "../knowledge";
import { href } from "../router";

interface Step {
  tool: string;
  server?: string;
  input: string;
}

type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; steps: Step[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; note?: string }
  | { role: "error"; content: string };

type Reply =
  | { ok: true; text: string; steps: Step[]; studyIds: string[]; truncated: boolean; failedServers: { name: string; error: string }[]; note?: string }
  | { ok: false; error: string };

// Kept outside the component so the conversation survives moving between pages (not reloads).
let conversation: Turn[] = [];

const SUGGESTIONS = [
  "Which of my results are outside the usual range, and what can affect them?",
  "What does research say about raising low ferritin with food?",
  "How has my LDL cholesterol changed, and was anything in my log going on at the time?",
  "Explain my biological age estimate and which markers push it up.",
];

const TOOL_TEXT: Record<string, string> = {
  get_results: "Looked at your results",
  get_marker: "Read a marker's history and knowledge entry",
  get_levers: "Checked evidence-graded diet and habit levers",
  get_biological_age: "Checked your biological age estimate",
  get_log: "Read your log",
  compare_before_after: "Compared before and after in your experiments",
  search_research: "Searched Europe PMC",
  read_skill: "Followed a skill",
};

/** What the assistant may read: everything in this browser. Birth month only becomes an age on the local server. */
async function snapshot() {
  const [measurements, protocols, experiments, profile] = await Promise.all([db.measurements.toArray(), db.protocols.toArray(), db.experiments.toArray(), getProfile()]);
  // The name and private notes never leave this page.
  return { measurements, protocols, experiments, profile: assistantProfile(profile) };
}

function StepList({ steps, failed }: { steps: Step[]; failed: { name: string; error: string }[] }) {
  if (steps.length === 0 && failed.length === 0) return null;
  return (
    <details className="text-sm text-ink-2">
      <summary className="min-h-11 cursor-pointer py-2 font-mono text-xs tracking-[0.14em] uppercase">
        {steps.length} {steps.length === 1 ? "step" : "steps"}
      </summary>
      <ul className="flex flex-col gap-1 pb-2">
        {steps.map((s, i) => (
          <li key={i}>
            {s.server ? `Used ${s.server}: ${s.tool}` : (TOOL_TEXT[s.tool] ?? s.tool)} {s.input !== "{}" && <span className="font-mono text-xs break-all">{s.input}</span>}
          </li>
        ))}
        {failed.map((f) => (
          <li key={f.name} className="text-warn">
            {f.name} couldn't start: {f.error}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AssistantPage({ ask }: { ask?: string }) {
  const status = useServerStatus();
  const all = useAllMeasurements();
  const profile = useProfile();
  const protocols = useProtocols() ?? [];
  const [turns, setTurns] = useState<Turn[]>(conversation);
  const [draft, setDraft] = useState(ask ?? "");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversation = turns;
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  const critical: CriticalItem[] = [];
  for (const [id, ms] of groupByBiomarker(all ?? [])) {
    const def = BIOMARKER_MAP.get(id);
    const latest = computeTrend(ms)?.latest;
    if (!def || !latest) continue;
    const flag = flagMeasurement(def, latest, profile);
    if (isCritical(flag)) critical.push({ def, measurement: latest, low: flag === "critical-low" });
  }

  // Every study the assistant retrieved in this conversation; only these citations count as checked.
  const allowed = new Set(turns.flatMap((t) => (t.role === "assistant" ? t.studyIds : [])));

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    try {
      const messages = next.filter((t) => t.role !== "error").map((t) => ({ role: t.role, content: t.content }));
      const r = await api<Reply>("POST", "/api/assistant", { messages, snapshot: await snapshot() });
      setTurns([...next, r.ok ? { role: "assistant", content: r.text, steps: r.steps, studyIds: r.studyIds, truncated: r.truncated, failedServers: r.failedServers, ...(r.note ? { note: r.note } : {}) } : { role: "error", content: r.error }]);
    } catch (e) {
      setTurns([...next, { role: "error", content: e instanceof Error ? e.message : "Something went wrong." }]);
    } finally {
      setBusy(false);
    }
  }

  const title = (
    <PageTitle sub="Ask about your results, your log and the research. It explains; it doesn't diagnose or prescribe.">Assistant</PageTitle>
  );
  if (status === undefined) return title;
  if (status === null)
    return (
      <>
        {title}
        <Notice tone="warn" title="The assistant's server isn't running">
          The assistant runs through the app's small local server. Start the app with <span className="font-mono text-sm">bun run start</span> and open the
          address it shows. Everything else in the app works without it.
        </Notice>
      </>
    );

  return (
    <>
      <CriticalBanner items={critical} />
      {title}
      <div className="mb-5 flex flex-col gap-3 empty:hidden">
        <SafetyNotices notes={safetyNotes(safetyLabels(protocols, profile))} />
      </div>

      {!status.ready.ok ? (
        <Notice tone="warn" title="Choose a model first">
          <p>{status.ready.reason}</p>
          <LinkButton href={href({ name: "data", tab: "models" })} className="mt-3">
            Set up a model
          </LinkButton>
        </Notice>
      ) : (
        <p className="mb-5 rounded-lg bg-sunken p-3 text-sm text-ink-2">
          When you send a question, your results, log and experiments (with your age, not your birth month) go to{" "}
          <span className="font-medium text-ink">
            {[providerInfo(status.assistant?.provider ?? "")?.label, status.assistant?.model].filter(Boolean).join(" · ")}
          </span>{" "}
          from your settings
          {providerInfo(status.assistant?.provider ?? "")?.retention === "depends" ? ", which keeps data according to your own login." : "."} Research searches go to Europe PMC and any MCP servers you
          switched on; those get search terms only.{" "}
          <a href={href({ name: "data", tab: "models" })} className="underline underline-offset-2">
            Change
          </a>
        </p>
      )}

      {turns.length === 0 && status.ready.ok && (
        <div className="mb-5 flex flex-col gap-2">
          <p className="font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase">Try asking</p>
          <ul className="flex flex-col gap-2">
            {SUGGESTIONS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setDraft(s)}
                  className="min-h-11 w-full rounded-xl border border-line bg-surface px-4 py-2 text-left transition-colors hover:border-line-strong hover:bg-sunken"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="flex flex-col gap-4" aria-live="polite">
        {turns.map((t, i) => (
          <li
            key={i}
            className={cx(
              "rounded-xl p-4",
              t.role === "user" ? "ml-auto max-w-[85%] bg-accent-soft" : t.role === "error" ? "border border-danger/40 bg-danger-soft" : "border border-line bg-surface",
            )}
          >
            <p className="sr-only">{t.role === "user" ? "You:" : "Assistant:"}</p>
            {t.role === "assistant" ? (
              <>
                {t.note && <p className="mb-3 rounded-lg bg-warn-soft p-2 text-sm text-warn">{t.note}</p>}
                <CitedAnswer text={t.content} allowed={allowed} truncated={t.truncated} />
                <StepList steps={t.steps} failed={t.failedServers} />
              </>
            ) : (
              <p className="whitespace-pre-wrap">{t.content}</p>
            )}
          </li>
        ))}
        {busy && (
          <li role="status" className="rounded-xl border border-line bg-surface p-4 text-ink-2">
            Working on it. Looking things up can take a few minutes…
          </li>
        )}
      </ol>
      <div ref={endRef} />

      {status.ready.ok && (
        <form
          className="sticky bottom-0 mt-5 flex flex-col gap-2 border-t border-line bg-page py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <Field.Root className="flex flex-col gap-1">
            <Field.Label className="sr-only">Your question</Field.Label>
            <Field.Control
              render={<textarea rows={3} />}
              value={draft}
              onValueChange={setDraft}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder="Ask a question"
              className={`${inputStyles} py-2`}
            />
          </Field.Root>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || !draft.trim()}>
              Send
            </Button>
            {turns.length > 0 && (
              <Button variant="quiet" disabled={busy} onClick={() => setTurns([])}>
                New conversation
              </Button>
            )}
            <span className="text-xs text-ink-2">Not medical advice. Check anything important with your doctor.</span>
          </div>
        </form>
      )}
    </>
  );
}
