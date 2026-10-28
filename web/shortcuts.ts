// Opening the Brain chat from the keyboard: Ctrl+K (⌘K on a Mac) anywhere, and Space on the Station
// (the main screen) when you are not typing or on a button.

/** A Mac (or iPad): shortcuts read ⌘ there. */
export function isMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');
}

/** What the "Ask the Brain" button shows: Space on the Station, else Ctrl K (⌘ K on a Mac). */
export const brainKeyLabel = (onStation: boolean, mac = isMac()): string => (onStation ? 'Space' : mac ? '⌘ K' : 'Ctrl K');

/** The button's tooltip: every way to open the Brain chat. */
export const brainKeyTitle = (mac = isMac()): string => `Ask the Brain (${mac ? '⌘K' : 'Ctrl+K'}, or Space on the Station)`;

// Where Space already means something: typing, or pressing a button, link or control.
const TAKES_SPACE = 'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], [role="checkbox"], [role="switch"]';

/** What a key press does to the Brain chat: toggle it (Ctrl+K / ⌘K), open it (Space on the Station), or nothing. */
export function brainShortcut(e: KeyboardEvent, { open, onStation }: { open: boolean; onStation: boolean }): 'toggle' | 'open' | null {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') return 'toggle';
  if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing || e.defaultPrevented) return null;
  if (open || !onStation) return null;
  if ((e.target as Element | null)?.closest?.(TAKES_SPACE)) return null;
  // a dialog or menu is open: Space belongs to it
  if (document.querySelector('.modal-back, .model-menu, .proj-menu')) return null;
  return 'open';
}
