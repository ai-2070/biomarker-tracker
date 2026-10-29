import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { providerInfo } from "../../core/aiProviders";
import { computeTrend, flagMeasurement, groupByBiomarker, isCritical } from "../../core/trends";
import type { Measurement } from "../../core/types";
import { CitedAnswer } from "../components/CitedAnswer";
import { CriticalBanner, type CriticalItem } from "../components/CriticalBanner";
import { BrainIcon, CloseIcon, FileIcon, NewChatIcon, PaperclipIcon, SendIcon, StopIcon } from "../components/icons";
import { Review } from "../components/LabReview";
import { Button, FlagBadge, cx } from "../components/ui";
import { formatDate, showMeasurement } from "../format";
import { useAllMeasurements, useProfile } from "../hooks";
import { BIOMARKER_MAP, fullName } from "../knowledge";
import { uploadFile, useProfiles } from "../profiles";
import { href } from "../router";
import { INTERACTIVE_SELECTOR, brainShortcut } from "./logic";
import { ModelMenu, ToolsMenu, goToSettings, modelLabel, useBrainSettings, type BrainSettings } from "./menus";
import {
  addFiles,
  closeBrain,
  newConversation,
  openBrain,
  removeAttachment,
  send,
  takePending,
  setDraft,
  stop,
  toggleBrain,
  updateTurn,
  useBrain,
  type Attachment,
  type Step,
  type Turn,
} from "./store";

const SUGGESTIONS = [
  "Which of my results are outside the usual range, and what can affect them?",
  "How has my LDL cholesterol changed, and was anything in my log going on at the time?",
  "Explain my biological age estimate and which markers push it up.",
  "What does research say about raising low ferritin with food?",
];

const TOOL_TEXT: Record<string, string> = {
  get_results: "Looked at your results",
  get_marker: "Read a marker's history and knowledge entry",
  get_levers: "Checked evidence-graded diet and habit levers",
  get_biological_age: "Checked your biological age estimate",
  get_body_summary: "Read the app's body calculations (BMI, heart age, averages)",
  get_log: "Read your habits",
  compare_before_after: "Compared before and after in your experiments",
  search_research: "Searched Europe PMC",
  get_study: "Read a study on Europe PMC",
  read_skill: "Followed a skill",
  research_tools: "Listed a research source's tools",
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Brain: the assistant in a window at the bottom of every page. Space or Ctrl+K opens it. */
export function Brain() {
  const brain = useBrain();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof Element ? e.target : null;
      const panel = panelRef.current;
      // Dialogs and menus elsewhere on the page keep their keys.
      const overlayOpen = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')].some((el) => !panel?.contains(el));
      const action = brainShortcut(e, { open: brain.open, onInteractive: !!target?.closest(INTERACTIVE_SELECTOR), overlayOpen });
      if (!action) return;
      e.preventDefault();
      if (!brain.open) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (action === "open") openBrain();
      else toggleBrain();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [brain.open]);

  // Back to where you were when Brain closes.
  const wasOpen = useRef(brain.open);
  useEffect(() => {
    if (wasOpen.current && !brain.open) {
      const el = returnFocus.current;
      if (el?.isConnected) el.focus();
      returnFocus.current = null;
    }
    wasOpen.current = brain.open;
  }, [brain.open]);

  // The window stays on screen while it folds away, then the pill comes back.
  const [shown, setShown] = useState(brain.open);
  if (brain.open && !shown) setShown(true);
  const closing = shown && !brain.open;
  const onClosed = useCallback(() => setShown(false), []);

  return (
    <>
      {!shown && <Launcher onOpen={() => (returnFocus.current = document.activeElement as HTMLElement | null)} />}
      {shown && <Panel panelRef={panelRef} closing={closing} onClosed={onClosed} />}
    </>
  );
}

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("rounded border border-line bg-sunken px-1.5 font-mono text-[11px] leading-5 text-ink-2", className)}>{children}</kbd>;
}

/** The pill at the bottom of large screens. Small screens open Brain from the bottom tabs. */
function Launcher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        onOpen();
        openBrain();
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) openBrain();
      }}
      title={`Ask Brain (Space, or ${isMac ? "⌘K" : "Ctrl+K"})`}
      className="fixed bottom-5 left-[calc(50%+8rem)] z-40 hidden -translate-x-1/2 animate-brain-pop items-center gap-2.5 rounded-full border border-line bg-surface/95 py-2.5 pr-3 pl-3.5 text-[15px] text-ink shadow-lg shadow-black/10 backdrop-blur transition-[translate,box-shadow] duration-200 ease-[var(--ease-soft)] hover:-translate-y-0.5 hover:shadow-xl lg:flex"
    >
      <BrainIcon className="text-accent" />
      <span>Ask Brain…</span>
      <Kbd>Space</Kbd>
    </button>
  );
}

function useCritical(): CriticalItem[] {
  const all = useAllMeasurements();
  const profile = useProfile();
  const items: CriticalItem[] = [];
  for (const [id, ms] of groupByBiomarker(all ?? [])) {
    const def = BIOMARKER_MAP.get(id);
    const latest = computeTrend(ms)?.latest;
    if (!def || !latest) continue;
    const flag = flagMeasurement(def, latest, profile);
    if (isCritical(flag)) items.push({ def, measurement: latest, low: flag === "critical-low" });
  }
  return items;
}

function Panel({ panelRef, closing, onClosed }: { panelRef: React.RefObject<HTMLDivElement | null>; closing: boolean; onClosed: () => void }) {
  // Unmount once the closing animation ends (with a fallback in case no animation runs).
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(onClosed, 400);
    return () => window.clearTimeout(t);
  }, [closing, onClosed]);

  const brain = useBrain();
  const titleId = useId();
  const { settings, reload } = useBrainSettings(true);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const critical = useCritical();
  const ready = !!settings?.ready.ok;
  const model = settings ? modelLabel(settings.assistant) : "";

  // A question from a "Summarize with Brain" button goes out once the model is known.
  useEffect(() => {
    if (brain.pending && settings !== undefined) takePending(!!settings?.ready.ok, model);
  }, [brain.pending, settings, model]);

  // Keep the newest message in view, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  }, [brain.turns.length, brain.busy]);

  const onDrag = (e: DragEvent, over: boolean) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    if (over) setDragging(true);
    else if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      inert={closing}
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) onClosed();
      }}
      onKeyDown={(e) => {
        // Escape inside a menu or list (they sit outside this box) closes only that.
        if (e.key === "Escape" && !e.defaultPrevented && e.currentTarget.contains(e.target as Node)) {
          e.preventDefault();
          closeBrain();
        }
      }}
      onDragEnter={(e) => onDrag(e, true)}
      onDragOver={(e) => onDrag(e, true)}
      onDragLeave={(e) => onDrag(e, false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles([...e.dataTransfer.files]);
      }}
      className={cx(
        "fixed z-50 flex flex-col overflow-hidden border-line bg-surface text-ink shadow-2xl shadow-black/15",
        closing ? "animate-brain-sheet-out lg:animate-brain-shrink" : "animate-brain-sheet-in lg:animate-brain-grow",
        "inset-0 sm:inset-x-3 sm:top-14 sm:bottom-3 sm:rounded-2xl sm:border",
        "lg:inset-auto lg:bottom-5 lg:left-[calc(50%+8rem)] lg:h-[min(76vh,700px)] lg:w-[min(720px,calc(100vw-19rem))] lg:origin-bottom lg:-translate-x-1/2",
      )}
    >
      <header className={cx("flex items-center gap-2 border-b border-line py-2 pr-2 pl-4", closing ? "animate-brain-content-out" : "animate-brain-content lg:[animation-delay:90ms]")}>
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent">
          <BrainIcon className="size-[18px]" />
        </span>
        <h2 id={titleId} className="flex-1 font-serif text-xl">
          Brain
        </h2>
        <button
          type="button"
          onClick={newConversation}
          disabled={brain.turns.length === 0 && brain.attachments.length === 0}
          title="New conversation"
          aria-label="New conversation"
          className="flex size-10 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <NewChatIcon className="size-[18px]" />
        </button>
        <button
          type="button"
          onClick={closeBrain}
          title="Close (Esc)"
          aria-label="Close Brain"
          className="flex size-10 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink"
        >
          <CloseIcon />
        </button>
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={cx("flex-1 overflow-y-auto overscroll-contain px-4 py-4", closing ? "animate-brain-content-out" : "animate-brain-content [animation-delay:60ms] lg:[animation-delay:140ms]")}
      >
        <CriticalBanner items={critical} />
        {settings === null ? (
          <NoServer />
        ) : settings && !ready && brain.turns.length === 0 ? (
          <NeedsModel settings={settings} />
        ) : brain.turns.length === 0 ? (
          <Welcome settings={settings} />
        ) : (
          <Conversation turns={brain.turns} busy={brain.busy} model={model} />
        )}
      </div>

      <Composer settings={settings} ready={ready} model={model} onSettingsChange={reload} closing={closing} />

      {dragging && (
        <div className="pointer-events-none absolute inset-1.5 flex animate-fade items-center justify-center rounded-xl border-2 border-dashed border-accent bg-surface/90 text-center backdrop-blur-sm">
          <p className="max-w-xs">
            <span className="block font-medium text-ink">Drop a lab report or a document</span>
            <span className="text-sm text-ink-2">It's read on this computer. You check lab results before they're saved.</span>
          </p>
        </div>
      )}
    </div>
  );
}

function NoServer() {
  return (
    <div className="rounded-xl border border-warn/30 bg-warn-soft p-4">
      <p className="font-medium">Brain needs the app's local server</p>
      <p className="mt-1 text-sm text-ink-2">
        Brain runs through the app's small server on this computer. Start the app with <code className="font-mono">bun run start</code> and open the address it
        shows. Everything else in the app works without it.
      </p>
    </div>
  );
}

function NeedsModel({ settings }: { settings: BrainSettings }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-sunken p-5">
      <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
        <BrainIcon />
      </span>
      <div>
        <p className="font-serif text-2xl">Set up a model first</p>
        <p className="mt-1 text-ink-2">
          Brain answers with an AI model you choose: a program on this computer (Claude Code, Codex…), a provider with zero data retention, or a model running
          locally.
        </p>
        <p className="mt-2 text-sm text-warn">{settings.ready.reason}</p>
      </div>
      <Button onClick={() => goToSettings("models")}>Set up a model</Button>
    </div>
  );
}

function Welcome({ settings }: { settings: BrainSettings | undefined }) {
  const info = settings ? providerInfo(settings.assistant.provider) : undefined;
  return (
    <div className="flex min-h-full flex-col justify-end gap-5">
      <div>
        <p className="font-serif text-3xl">Ask Brain</p>
        <p className="mt-1 text-ink-2">
          About your results, your habits and the research. Drop a lab report here, or use the paperclip, to add it to your blood tests.
        </p>
      </div>
      <ul className="stagger flex flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              disabled={!settings}
              onClick={() => settings && void send(modelLabel(settings.assistant), s)}
              className="min-h-11 w-full rounded-xl border border-line bg-surface px-3.5 py-2 text-left text-[15px] transition-colors hover:border-line-strong hover:bg-sunken"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-ink-2">
        When you ask, your results, log and experiments (with your age, not your name or birth month) go to {info?.label ?? "your model"}
        {info?.retention === "depends" ? ", which keeps data according to your own login" : ""}. Research searches send search terms only. Documents you attach are
        sent as text with your name taken out; lab reports are read here and only the values you confirm are saved.
      </p>
    </div>
  );
}

function Conversation({ turns, busy, model }: { turns: Turn[]; busy: boolean; model: string }) {
  // Only studies that a tool returned in this conversation count as checked citations.
  const allowed = new Set(turns.flatMap((t) => (t.role === "assistant" ? t.studyIds : [])));
  return (
    <ol className="flex flex-col gap-4" aria-live="polite">
      {turns.map((t) => (
        <li key={t.id} className="animate-enter">
          <TurnView turn={t} allowed={allowed} model={model} />
        </li>
      ))}
      {busy && (
        <li role="status" className="flex animate-enter items-center gap-3 text-ink-2">
          <span aria-hidden="true" className="flex gap-1">
            <span className="size-2 animate-dot rounded-full bg-accent" />
            <span className="size-2 animate-dot rounded-full bg-accent [animation-delay:160ms]" />
            <span className="size-2 animate-dot rounded-full bg-accent [animation-delay:320ms]" />
          </span>
          Brain is looking things up. This can take a few minutes…
        </li>
      )}
    </ol>
  );
}

function TurnView({ turn: t, allowed, model }: { turn: Turn; allowed: ReadonlySet<string>; model: string }) {
  switch (t.role) {
    case "user":
      return (
        <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5">
          <p className="sr-only">You:</p>
          {t.content && <p className="rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2.5 whitespace-pre-wrap">{t.content}</p>}
          {t.files.map((f) => (
            <span key={f} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs text-ink-2">
              <FileIcon className="size-3.5" />
              {f}
            </span>
          ))}
        </div>
      );
    case "assistant":
      return (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm">
            <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-accent">
              <BrainIcon className="size-3.5" />
            </span>
            <span className="font-medium">Brain</span>
            <span className="truncate font-mono text-[11px] text-ink-2">{t.model}</span>
          </p>
          {t.note && <p className="rounded-lg bg-warn-soft p-2 text-sm text-warn">{t.note}</p>}
          <CitedAnswer text={t.content} allowed={allowed} truncated={t.truncated} />
          <StepList steps={t.steps} failed={t.failedServers} />
        </div>
      );
    case "error":
      return (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm">
          <span className="font-medium">Brain couldn't answer.</span> {t.content}
        </p>
      );
    case "stopped":
      return <p className="text-center text-sm text-ink-2">Stopped. Ask again when you're ready.</p>;
    case "review":
      return <ReviewTurn turn={t} model={model} />;
  }
}

function StepList({ steps, failed }: { steps: Step[]; failed: { name: string; error: string }[] }) {
  if (steps.length === 0 && failed.length === 0) return null;
  return (
    <details className="text-sm text-ink-2">
      <summary className="min-h-9 cursor-pointer py-1.5 font-mono text-[11px] tracking-[0.12em] uppercase">
        {steps.length} {steps.length === 1 ? "step" : "steps"}
      </summary>
      <ul className="flex flex-col gap-1 border-l-2 border-line pb-1 pl-3">
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

/** A lab report dropped into Brain: check the values, then save them to the blood tests. */
function ReviewTurn({ turn, model }: { turn: Extract<Turn, { role: "review" }>; model: string }) {
  const { mode, active } = useProfiles();

  async function saved(list: Measurement[], skipped: number, date: string) {
    let kept: string | undefined;
    let keepError: string | undefined;
    if (turn.file && mode === "folders" && active) {
      try {
        kept = (await uploadFile(active.id, turn.file, `${turn.kind === "body" ? "Health app screenshot" : "Lab report"} from ${date}, ${list.length} ${list.length === 1 ? "value" : "values"} saved (via Brain)`)).originalName;
      } catch (e) {
        keepError = e instanceof Error ? e.message : "unknown error";
      }
    }
    updateTurn(turn.id, { state: "saved", saved: list, skipped, date, ...(kept ? { kept } : {}), ...(keepError ? { keepError } : {}) });
  }

  if (turn.state === "dismissed") return <p className="text-center text-sm text-ink-2">Nothing saved from {turn.fileName}.</p>;
  if (turn.state === "saved") return <SavedResults turn={turn} model={model} />;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sunken p-3">
      <p className="flex items-center gap-2 px-1 text-sm">
        <FileIcon className="size-4 shrink-0 text-ink-2" />
        <span className="min-w-0 truncate font-medium">{turn.fileName}</span>
        <span className="shrink-0 text-ink-2">· read on this computer</span>
      </p>
      <Review fileName={turn.fileName} ocr={turn.ocr} report={turn.report} inChat kind={turn.kind ?? "lab"} onCancel={() => updateTurn(turn.id, { state: "dismissed" })} onSaved={(l, s, d) => void saved(l, s, d)} />
    </div>
  );
}

function SavedResults({ turn, model }: { turn: Extract<Turn, { role: "review" }>; model: string }) {
  const profile = useProfile();
  const list = (turn.saved ?? []).flatMap((m) => {
    const def = BIOMARKER_MAP.get(m.biomarkerId);
    return def ? [{ m, def, flag: flagMeasurement(def, m, profile) }] : [];
  });
  const critical = list.filter((x) => isCritical(x.flag)).map((x) => ({ def: x.def, measurement: x.m, low: x.flag === "critical-low" }));
  const when = turn.date ? formatDate(turn.date) : "";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
      <CriticalBanner items={critical} />
      <p>
        <span className="font-medium">
          Saved {list.length} {list.length === 1 ? "result" : "results"}
        </span>{" "}
        {turn.kind === "body" ? `measured on ${when}` : `from the blood test on ${when}`}.{(turn.skipped ?? 0) > 0 && ` ${turn.skipped} ${turn.skipped === 1 ? "was" : "were"} already saved.`}
        {turn.kept && <span className="text-ink-2"> The report is kept in this profile's folder.</span>}
      </p>
      {turn.keepError && <p className="text-sm text-warn">The report itself couldn't be kept in the profile folder: {turn.keepError}</p>}
      {list.length > 0 && (
        <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {list.map(({ m, def, flag }) => (
            <li key={m.id}>
              <a
                href={href({ name: "marker", id: def.id })}
                onClick={() => window.matchMedia("(max-width: 1023px)").matches && closeBrain()}
                className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5 text-sm text-ink no-underline hover:bg-sunken"
              >
                <span className="min-w-0 truncate">{fullName(def)}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums">
                    {showMeasurement(def, m, def.canonicalUnit)} {def.canonicalUnit}
                  </span>
                  {flag !== "normal" && <FlagBadge flag={flag} />}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && critical.length === 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              void send(
                model,
                turn.kind === "body"
                  ? `Explain the body measurements from ${when} that I just added, compared with my earlier ones.`
                  : `Explain my results from the blood test on ${when} that I just added. Which are outside the range, and what can affect them?`,
              )
            }
          >
            Explain these results
          </Button>
          <Button variant="quiet" onClick={() => void send(model, turn.kind === "body" ? `How do my body measurements from ${when} compare with the weeks before?` : `What changed in my blood test on ${when} compared with my earlier tests?`)}>
            What changed?
          </Button>
        </div>
      )}
    </div>
  );
}

function AttachmentChip({ a }: { a: Attachment }) {
  return (
    <span
      className={cx(
        "flex max-w-64 items-center gap-2 rounded-lg border px-2 py-1 text-xs",
        a.status === "error" ? "border-danger/40 bg-danger-soft" : "border-line bg-surface",
      )}
      title={a.status === "ready" ? "Its text is sent with your question, with your name taken out." : undefined}
    >
      <FileIcon className="size-4 shrink-0 text-ink-2" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-ink">{a.name}</span>
        <span className={cx("truncate", a.status === "error" ? "text-danger" : "text-ink-2")}>
          {a.status === "reading" ? `${a.stage ?? "Reading"}${a.fraction ? ` ${Math.round(a.fraction * 100)}%` : "…"}` : a.status === "error" ? a.error : "Sent as text with your question"}
        </span>
      </span>
      {a.status !== "reading" && (
        <button type="button" onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`} className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink">
          <CloseIcon className="size-3.5" />
        </button>
      )}
    </span>
  );
}

function Composer({ settings, ready, model, onSettingsChange, closing }: { settings: BrainSettings | null | undefined; ready: boolean; model: string; onSettingsChange: () => void; closing: boolean }) {
  const brain = useBrain();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reading = brain.attachments.some((a) => a.status === "reading");
  const hasDocs = brain.attachments.some((a) => a.status === "ready");
  const canSend = !brain.busy && !reading && (brain.draft.trim() !== "" || hasDocs);

  useEffect(() => {
    textRef.current?.focus();
  }, [brain.focusTick]);

  // Grow with the text, up to about six lines.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [brain.draft]);

  function submit() {
    if (!canSend) return;
    if (!ready) return goToSettings("models");
    void send(model);
  }

  return (
    <div className={cx("border-t border-line bg-surface px-3 pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]", closing ? "animate-brain-content-out" : "animate-brain-content [animation-delay:100ms] lg:[animation-delay:180ms]")}>
      {brain.attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {brain.attachments.map((a) => (
            <AttachmentChip key={a.id} a={a} />
          ))}
        </div>
      )}
      <div className="rounded-xl border border-line-strong bg-surface transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
        <label className="sr-only" htmlFor="brain-question">
          Your question
        </label>
        <textarea
          id="brain-question"
          ref={textRef}
          rows={1}
          value={brain.draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          placeholder={brain.busy ? "Brain is working…" : hasDocs ? "What should Brain do with this file?" : "Ask about your results, or drop a lab report"}
          className="block max-h-42 min-h-11 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-base text-ink outline-none placeholder:text-ink-2"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept="application/pdf,.pdf,image/*,.txt,.csv,.tsv,.md,.json,text/plain,text/csv"
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Attach a lab report or document (or drop or paste it)"
            aria-label="Attach a lab report or document"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink"
          >
            <PaperclipIcon className="size-[18px]" />
          </button>
          {settings && (
            <>
              <ModelMenu settings={settings} onChange={onSettingsChange} />
              <span className="hidden sm:contents">
                <ToolsMenu active />
              </span>
            </>
          )}
          <span className="flex-1" />
          {brain.busy ? (
            <button type="button" onClick={stop} aria-label="Stop" title="Stop" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink text-surface hover:opacity-85">
              <StopIcon className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label={ready ? "Send (Enter)" : "Set up a model to send"}
              title={ready ? "Send (Enter)" : "Set up a model to send"}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink transition-[filter,opacity] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
            >
              <SendIcon className="size-[18px]" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 flex justify-between gap-3 px-1 text-xs text-ink-2">
        <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line · Esc to close</span>
        <span className="sm:hidden">
          <span className="contents">
            <MobileTools settings={settings} />
          </span>
        </span>
        <span>Not medical advice.</span>
      </p>
    </div>
  );
}

/** On phones the skills and sources menu sits under the box, so the row above fits 360px. */
function MobileTools({ settings }: { settings: BrainSettings | null | undefined }) {
  if (!settings) return null;
  return (
    <span className="-my-2 -ml-2 inline-flex">
      <ToolsMenu active />
    </span>
  );
}
