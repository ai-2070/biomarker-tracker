import { useEffect, useLayoutEffect, useRef } from "react";
import { providerInfo, takesPictures } from "@bt/shared/core/aiProviders";
import { CloseIcon, FileIcon, PaperclipIcon, SendIcon, StopIcon } from "../components/icons";
import { cx } from "../components/ui";
import { ModelMenu, ToolsMenu, goToSettings, type BrainSettings } from "./menus";
import { addFiles, addPastedLabText, picturesToResend, removeAttachment, send, setDraft, stop, useBrain, type Attachment } from "./store";

function AttachmentChip({ a, noPictures }: { a: Attachment; /** The chosen model can't be given pictures: its label. */ noPictures?: string }) {
  const pictures = a.images?.length ?? 0;
  const blocked = pictures > 0 && a.status === "ready" && noPictures !== undefined;
  const status =
    a.status === "reading"
      ? `${a.stage ?? "Reading"}${a.fraction ? ` ${Math.round(a.fraction * 100)}%` : "…"}`
      : a.status === "error"
        ? a.error
        : blocked
          ? `${noPictures} can't read pictures. Choose another model.`
          : a.pictureOf === "pdf"
            ? `${pictures} scanned ${pictures === 1 ? "page" : "pages"} sent as pictures, including any names on them`
            : pictures
              ? "Sent as a picture, including any names on it"
              : "Its text is sent with your question";
  return (
    <span
      className={cx("flex max-w-full flex-col gap-1.5 rounded-lg border px-2 py-1 text-xs sm:max-w-sm", a.status === "error" ? "border-danger/40 bg-danger-soft" : "border-line bg-surface")}
      title={a.status !== "ready" ? undefined : pictures ? "Sent as it is, shrunk and with location data removed: the model sees everything printed on it, such as your name." : "Sent with your name taken out."}
    >
      <span className="flex items-center gap-2">
        <FileIcon className="size-4 shrink-0 text-ink-2" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-ink">{a.name}</span>
          <span className={cx("truncate", a.status === "error" ? "text-danger" : blocked ? "text-warn" : "text-ink-2")}>{status}</span>
        </span>
        {a.status !== "reading" && (
          <button type="button" onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`} className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink">
            <CloseIcon className="size-3.5" />
          </button>
        )}
      </span>
    </span>
  );
}

export function Composer({ settings, ready, model, onSettingsChange, closing }: { settings: BrainSettings | null | undefined; ready: boolean; model: string; onSettingsChange: () => void; closing: boolean }) {
  const brain = useBrain();
  const research = brain.scope === "research";
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reading = brain.attachments.some((a) => a.status === "reading");
  const hasDocs = brain.attachments.some((a) => a.status === "ready" && (a.images?.length || (a.text ?? "").trim()));
  const canSend = !brain.busy && !reading && (brain.draft.trim() !== "" || hasDocs);
  const provider = settings?.assistant.provider;
  const noPictures = provider && !takesPictures(provider) ? providerInfo(provider)?.label ?? provider : undefined;

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
      {!research && brain.attachments.every((a) => !a.images?.length) && picturesToResend(brain.turns, model) && (
        <p className="mb-2 px-1 text-xs text-ink-2">
          While the card above is open, your next question goes with the same pictures, so Brain can look again (for a row it missed or misread).
        </p>
      )}
      {!research && brain.attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {brain.attachments.map((a) => (
            <AttachmentChip key={a.id} a={a} {...(noPictures ? { noPictures } : {})} />
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
              if (!research) void addFiles(files);
              return;
            }
            // Lab result rows copied from a report or website: checked and saved in a review card.
            if (!research && addPastedLabText(e.clipboardData.getData("text/plain"))) e.preventDefault();
          }}
          placeholder={brain.busy ? "Brain is working…" : research ? "Ask about the evidence" : hasDocs ? "What should Brain do with this file?" : "Ask about your results, or drop a lab report"}
          className="block max-h-42 min-h-11 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-base text-ink outline-none placeholder:text-ink-2"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          {!research && (
            <>
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
            </>
          )}
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
