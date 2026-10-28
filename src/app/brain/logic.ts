// Brain's rules that don't need React: the keyboard shortcut, and what an attached file adds to a question.

/** Elements where Space already means something (typing, pressing, choosing). Space never opens Brain there. */
export const INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  ...["button", "textbox", "checkbox", "switch", "slider", "menuitem", "option", "tab", "radio", "combobox", "listbox", "menu"].map((r) => `[role="${r}"]`),
].join(", ");

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}

/**
 * Ctrl+K (⌘K) toggles Brain anywhere. Space opens it when nothing else uses the key:
 * no modifiers, not held down, not on a field or button, and no dialog or menu is open.
 */
export function brainShortcut(e: KeyLike, ctx: { open: boolean; onInteractive: boolean; overlayOpen: boolean }): "open" | "toggle" | null {
  if (e.defaultPrevented || e.isComposing || ctx.overlayOpen) return null;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") return "toggle";
  if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat && !ctx.open && !ctx.onInteractive) return "open";
  return null;
}

/** How much of attached documents goes with one question (the local server accepts 20,000 characters a message). */
export const ATTACHED_TEXT_LIMIT = 14_000;

/** Replaces the person's name (full, and each part of 3+ letters) so it isn't sent to a model with a document. */
export function redactName(text: string, name: string | undefined): string {
  const parts = (name ?? "")
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}'-]/gu, ""))
    .filter((p) => p.length >= 3);
  if (parts.length === 0) return text;
  // Parts hold only letters, apostrophes and dashes, so they are safe inside a pattern.
  const escaped = [...parts].sort((a, b) => b.length - a.length);
  return text.replace(new RegExp(`(?<!\\p{L})(${escaped.join("|")})(?!\\p{L})`, "giu"), "[name]");
}

/** The question as sent: what was typed, then the text of each attached document, shortened to fit. */
export function questionWithFiles(question: string, files: { name: string; text: string }[]): string {
  if (files.length === 0) return question;
  const each = Math.floor(ATTACHED_TEXT_LIMIT / files.length);
  const blocks = files.map((f) => {
    const text = f.text.trim();
    const cut = text.length > each ? `${text.slice(0, each).trimEnd()}\n[… the rest of this file was left out to keep the question short]` : text;
    return `--- Attached file: ${f.name} (text read on the user's computer) ---\n${cut}\n--- End of ${f.name} ---`;
  });
  return `${question.trim() || "Please look at the attached file."}\n\n${blocks.join("\n\n")}`;
}

/** Text files Brain reads directly; PDFs and pictures go through the lab report reader. */
export const isTextFile = (name: string, type: string) => type.startsWith("text/") || /\.(txt|csv|tsv|md|json)$/i.test(name);
