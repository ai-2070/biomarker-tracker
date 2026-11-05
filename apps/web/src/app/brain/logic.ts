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
  const full = (name ?? "").normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!full) return text;
  const parts = full.split(/\s+/u).filter((p) => [...p].length >= 3);
  const escaped = [...new Set([full, ...parts])]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/gu, "\\s+"));
  return text.normalize("NFC").replace(new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu"), "[name]");
}

/** The question as sent: what was typed, then the text of each attached document, shortened to fit. */
export function questionWithFiles(question: string, files: { name: string; text: string }[]): string {
  const limit = 20_000;
  const base = question.trim() || (files.length ? "Please look at the attached file." : "");
  if (base.length > limit) throw new Error("Keep the question under 20,000 characters.");
  if (files.length === 0) return base;
  const notice = "\n[… the rest of this file was left out to keep the question short]";
  const wrappers = files.map((f) => ({
    before: `--- Attached file: ${f.name} (text read on the user's computer) ---\n`,
    after: `\n--- End of ${f.name} ---`,
    text: f.text.trim(),
  }));
  // Reserve all headings, separators and shortening notices before assigning text space.
  const overhead = base.length + 2 + (files.length - 1) * 2 + wrappers.reduce((n, f) => n + f.before.length + f.after.length + notice.length, 0);
  if (overhead > limit) throw new Error("The question and file names are too long. Shorten the question or attach fewer files.");
  const each = Math.floor(Math.min(ATTACHED_TEXT_LIMIT, limit - overhead) / files.length);
  const blocks = wrappers.map((f) => `${f.before}${f.text.length > each ? f.text.slice(0, each).trimEnd() + notice : f.text}${f.after}`);
  return `${base}\n\n${blocks.join("\n\n")}`;
}

/** Text files Brain reads directly; PDFs and pictures go through the lab report reader. */
export const isTextFile = (name: string, type: string) => type.startsWith("text/") || /\.(txt|csv|tsv|md|json)$/i.test(name);
