import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { providerInfo } from "@bt/shared/core/aiProviders";
import { computeTrend, flagMeasurement, groupByBiomarker, isCritical } from "@bt/shared/core/trends";
import { CitedAnswer } from "../components/CitedAnswer";
import { CriticalBanner, type CriticalItem } from "../components/CriticalBanner";
import { BrainIcon, CloseIcon, FileIcon, NewChatIcon } from "../components/icons";
import { Button, cx } from "../components/ui";
import { useAllMeasurements, useProfile } from "../hooks";
import { BIOMARKER_MAP } from "../knowledge";
import { Composer } from "./Composer";
import { INTERACTIVE_SELECTOR, brainShortcut } from "./logic";
import { goToSettings, modelLabel, useBrainSettings, type BrainSettings } from "./menus";
import { addFiles, backToMyChat, closeBrain, newConversation, openBrain, send, takePending, toggleBrain, useBrain, type Turn } from "./store";
import { HabitTurn } from "./turns/HabitTurn";
import { LiveTurn, StepList } from "./turns/LiveTurn";
import { MealTurn } from "./turns/MealTurn";
import { ProfileTurn } from "./turns/ProfileTurn";
import { ProtocolTurn } from "./turns/ProtocolTurn";
import { ReviewTurn } from "./turns/ReviewTurn";

const SUGGESTIONS = [
  "Which of my results are outside the usual range, and what can affect them?",
  "How has my LDL cholesterol changed, and was anything in my log going on at the time?",
  "Explain my biological age estimate and which markers push it up.",
  "What does research say about raising low ferritin with food?",
];

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
      className="fixed bottom-5 left-1/2 z-40 hidden -translate-x-1/2 animate-brain-pop items-center gap-2.5 rounded-full border border-line bg-surface/95 py-2.5 pr-3 pl-3.5 text-[15px] text-ink shadow-lg shadow-black/10 backdrop-blur transition-[translate,box-shadow] duration-200 ease-[var(--ease-soft)] hover:-translate-y-0.5 hover:shadow-xl lg:flex"
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

function PersonalCriticalBanner() {
  return <CriticalBanner items={useCritical()} />;
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
  const { settings, fresh, reload } = useBrainSettings(brain.open);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const research = brain.scope === "research";
  const ready = fresh && !!settings?.ready.ok;
  const model = settings ? modelLabel(settings.assistant) : "";

  // A question from a "Summarize with Brain" button goes out once the model is known.
  useEffect(() => {
    if (brain.pending && fresh) takePending(!!settings?.ready.ok, model);
  }, [brain.pending, brain.scope, settings, fresh, model]);

  // Keep the newest message in view, unless the person scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  }, [brain.turns.length, brain.busy, brain.scope]);

  useEffect(() => {
    setDragging(false);
    stickToEnd.current = true;
  }, [brain.scope]);

  const onDrag = (e: DragEvent, over: boolean) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    if (research) return;
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
        if (!research) void addFiles([...e.dataTransfer.files]);
      }}
      className={cx(
        "fixed z-50 flex flex-col overflow-hidden border-line bg-surface text-ink shadow-2xl shadow-black/15",
        closing ? "animate-brain-sheet-out lg:animate-brain-shrink" : "animate-brain-sheet-in lg:animate-brain-grow",
        "inset-0 sm:inset-x-3 sm:top-14 sm:bottom-3 sm:rounded-2xl sm:border",
        "lg:inset-auto lg:bottom-5 lg:left-1/2 lg:h-[min(76vh,700px)] lg:w-[min(720px,calc(100vw-3rem))] lg:origin-bottom lg:-translate-x-1/2",
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
          disabled={brain.turns.length === 0 && brain.attachments.length === 0 && !brain.draft && !brain.pending && !brain.busy}
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
      {research && (
        <div className="flex flex-wrap items-center gap-x-3 border-b border-line px-4 py-1">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-2">Research only · Profile and results excluded</p>
          <Button variant="link" onClick={backToMyChat} className="shrink-0">
            Back to my chat
          </Button>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={cx("flex-1 overflow-y-auto overscroll-contain px-4 py-4", closing ? "animate-brain-content-out" : "animate-brain-content [animation-delay:60ms] lg:[animation-delay:140ms]")}
      >
        {!research && <PersonalCriticalBanner />}
        {fresh && settings === null ? (
          <NoServer />
        ) : fresh && settings && !ready && brain.turns.length === 0 ? (
          <NeedsModel settings={settings} />
        ) : brain.turns.length === 0 ? (
          <Welcome settings={fresh ? settings ?? undefined : undefined} research={research} />
        ) : (
          <Conversation turns={brain.turns} busy={brain.busy} model={model} />
        )}
      </div>

      <Composer settings={settings} ready={ready} model={model} onSettingsChange={reload} closing={closing} />

      {dragging && !research && (
        <div className="pointer-events-none absolute inset-1.5 flex animate-fade items-center justify-center rounded-xl border-2 border-dashed border-accent bg-surface/90 text-center backdrop-blur-sm">
          <p className="max-w-xs">
            <span className="block font-medium text-ink">Drop a lab report or a document</span>
            <span className="text-sm text-ink-2">PDFs with text are read on this computer; photos and scans go to Brain as pictures. You check results before they're saved.</span>
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

function Welcome({ settings, research }: { settings: BrainSettings | undefined; research: boolean }) {
  const info = settings ? providerInfo(settings.assistant.provider) : undefined;
  if (research) {
    return (
      <div className="flex min-h-full flex-col justify-end gap-5">
        <div>
          <p className="font-serif text-3xl">Check the evidence</p>
          <p className="mt-1 text-ink-2">Ask about a claim or study. Brain looks for human research and explains what it supports, and what is still unknown.</p>
        </div>
        <p className="text-xs leading-relaxed text-ink-2">
          Only your question and this public research topic go to {info?.label ?? "your model"}
          {info?.retention === "depends" ? ", which keeps data according to your own login" : ""}.
          {" "}Your profile, results, personal chat and files are not included. Avoid typing private health details here.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col justify-end gap-5">
      <div>
        <p className="font-serif text-3xl">Ask Brain</p>
        <p className="mt-1 text-ink-2">
          Ask about your results, habits and research. Brain can fill missing profile details you state and draft a meal, protocol or habit when you ask. You review drafts before saving them.
        </p>
        <p className="mt-2 text-sm text-ink-2">Drop a lab report here, or use the paperclip, to review and add its results.</p>
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
        sent as text with your name taken out; lab report PDFs are read here. Photos and scanned pages are sent as pictures, so the model sees
        everything printed on them, such as your name. Only the values you confirm are saved.
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
      {busy && !turns.some((t) => t.role === "live") && (
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
          {t.photos ? (
            <span className="rounded-lg border border-line px-2 py-1 text-xs text-ink-2">
              {t.photos} {t.photos === 1 ? "picture" : "pictures"} {t.photosAgain ? "sent again so Brain can look again" : "sent to Brain"}
            </span>
          ) : null}
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
    case "live":
      return <LiveTurn turn={t} allowed={allowed} />;
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
    case "profile":
      return <ProfileTurn turn={t} />;
    case "habit":
      return <HabitTurn turn={t} />;
    case "protocol":
      return <ProtocolTurn turn={t} />;
    case "meal":
      return <MealTurn turn={t} />;
  }
}
