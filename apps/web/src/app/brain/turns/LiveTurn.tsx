import { CitedAnswer } from "../../components/CitedAnswer";
import { More } from "../../components/disclosure";
import { BrainIcon } from "../../components/icons";
import type { Step, Turn } from "../store";

export const TOOL_TEXT: Record<string, string> = {
  get_results: "Looked at your results",
  get_marker: "Read a marker's history and knowledge entry",
  get_test_summary: "Read the app's summary of a blood test",
  get_year_summary: "Read the app's summary of a year of blood tests",
  get_levers: "Checked evidence-graded diet and habit levers",
  get_biological_age: "Checked your biological age estimate",
  get_body_summary: "Read the app's body calculations (BMI, heart age, averages)",
  get_log: "Read your habits",
  compare_before_after: "Checked what changed in your habits",
  propose_habit: "Suggested a habit for you to confirm",
  save_profile_details: "Prepared missing profile details from your message",
  search_research: "Searched Europe PMC",
  get_study: "Read a study on Europe PMC",
  get_nutrient: "Read the vitamins and minerals knowledge base",
  get_protocols: "Read your protocols",
  propose_protocol: "Wrote down a protocol for you to create",
  find_foods: "Searched the food table",
  propose_meal: "Wrote down a meal for you to save",
  get_meals: "Read your meals",
  read_skill: "Followed a skill",
  research_tools: "Listed a research source's tools",
};

/** The answer while it streams. Citations count as checked only once a tool in this answer returned them. */
export function LiveTurn({ turn, allowed }: { turn: Extract<Turn, { role: "live" }>; allowed: ReadonlySet<string> }) {
  const checked = new Set([...allowed, ...turn.studyIds]);
  const status = turn.status ?? (turn.text ? "Writing…" : "Brain is looking things up. This can take a few minutes…");
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <p className="flex items-center gap-2 text-sm">
        <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-accent">
          <BrainIcon className="size-3.5" />
        </span>
        <span className="font-medium">Brain</span>
        <span className="truncate font-mono text-[11px] text-ink-2">{turn.model}</span>
      </p>
      {turn.critical && (
        <p role="alert" className="rounded-xl border-2 border-danger-strong bg-danger-soft p-3 text-ink">
          <span className="font-semibold">A result in the picture looks far outside the usual range.</span> Please contact a doctor soon, or your local
          emergency number if you feel unwell. Check the value against the report in the card that follows.
        </p>
      )}
      {/* Not read out word by word; the status line below says what is happening. */}
      {turn.text && (
        <div aria-live="off">
          <CitedAnswer text={turn.text} allowed={checked} />
        </div>
      )}
      {turn.steps.length > 0 && (
        <ul aria-live="off" className="flex flex-col gap-1 border-l-2 border-line pl-3 text-sm text-ink-2">
          {turn.steps.map((step, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span aria-hidden="true" className={step.success === undefined ? "text-accent" : step.success ? "text-ok" : "text-warn"}>
                {step.success === undefined ? "•" : step.success ? "✓" : "!"}
              </span>
              <span>{step.server ? `Using ${step.server}: ${step.tool}` : (TOOL_TEXT[step.tool] ?? step.tool)}</span>
              <span className="sr-only">{step.success === undefined ? "running" : step.success ? "done" : "didn't work"}</span>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="flex items-center gap-3 text-sm text-ink-2">
        <span aria-hidden="true" className="flex gap-1">
          <span className="size-2 animate-dot rounded-full bg-accent" />
          <span className="size-2 animate-dot rounded-full bg-accent [animation-delay:160ms]" />
          <span className="size-2 animate-dot rounded-full bg-accent [animation-delay:320ms]" />
        </span>
        {status}
      </p>
    </div>
  );
}

export function StepList({ steps, failed }: { steps: Step[]; failed: { name: string; error: string }[] }) {
  if (steps.length === 0 && failed.length === 0) return null;
  return (
    <More
      summary={
        <>
          {steps.length} {steps.length === 1 ? "step" : "steps"}
        </>
      }
      tone="label"
      className="text-sm text-ink-2"
    >
      <ul className="flex flex-col gap-1 border-l-2 border-line pb-1 pl-3">
        {steps.map((s, i) => (
          <li key={i}>
            {s.server ? `Used ${s.server}: ${s.tool}` : (TOOL_TEXT[s.tool] ?? s.tool)}{" "}
            {s.input !== "{}" && <span className="font-mono text-xs break-all">{s.input}</span>}
          </li>
        ))}
        {failed.map((f) => (
          <li key={f.name} className="text-warn">
            {f.name} couldn't start: {f.error}
          </li>
        ))}
      </ul>
    </More>
  );
}
