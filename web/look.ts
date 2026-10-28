// How the dashboard looks: UI scale, accent colour, animations, chat font, Station quality. Saved in settings.look and
// remembered in this browser so the page opens at the right size straight away.
import type { LookSetting } from '../shared/types.ts';
import { chatFont } from '../shared/look.ts';
export { CHAT_FONTS, chatFont, STATION_QUALITY, stationLevel } from '../shared/look.ts';
export type { ChatFont } from '../shared/look.ts';

export interface Accent {
  id: string;
  label: string;
  c: string;
  hover: string;
  dim: string;
  on: string;
}
export const ACCENTS: Accent[] = [
  { id: 'lime', label: 'Lime', c: '#c4ff3d', hover: '#d4ff6e', dim: '#7a9a2c', on: '#0b0c0b' },
  { id: 'ice', label: 'Ice', c: '#7fd6f0', hover: '#a6e4f6', dim: '#4a8597', on: '#071014' },
  { id: 'amber', label: 'Amber', c: '#f5b54a', hover: '#f8ca78', dim: '#9a7130', on: '#120c03' },
  { id: 'rose', label: 'Rose', c: '#ff7a9a', hover: '#ff9cb4', dim: '#a04d61', on: '#14070a' },
  { id: 'violet', label: 'Violet', c: '#b69cff', hover: '#cbb8ff', dim: '#6f5fa3', on: '#0c0814' },
  { id: 'mint', label: 'Mint', c: '#5fe3c0', hover: '#89ecd2', dim: '#3a8c77', on: '#04110d' },
];
export const DEFAULT_LOOK: LookSetting = { scale: 100, accent: 'lime', motion: 'full', chatFont: 'serif', station: 'balanced', sidebar: 'status', stationLook: 'classic', worldQuality: 'medium' };
let current: LookSetting = DEFAULT_LOOK;
/** The look in use now (the Station reads its quality from here every frame). */
export const currentLook = (): LookSetting => current;
const KEY = 'dash-look';

// With a UI scale, mouse and box positions are in screen pixels but CSS pixels are scaled:
// divide by this when placing a popup at the mouse or next to a button.
export const uiZoom = (): number => parseFloat(document.documentElement.style.zoom) || 1;

export function applyLook(look: Partial<LookSetting> = {}): LookSetting {
  const l: LookSetting = { ...DEFAULT_LOOK, ...look };
  current = l;
  const root = document.documentElement;
  const scale = Math.max(70, Math.min(160, Number(l.scale) || 100));
  root.style.zoom = scale === 100 ? '' : String(scale / 100);
  const a = ACCENTS.find((x) => x.id === l.accent) || ACCENTS[0];
  root.style.setProperty('--color-accent', a.c);
  root.style.setProperty('--color-accent-hover', a.hover);
  root.style.setProperty('--color-accent-dim', a.dim);
  root.style.setProperty('--color-on-accent', a.on);
  root.classList.toggle('reduce-motion', l.motion === 'reduced');
  const font = chatFont(l.chatFont);
  // the default is the stylesheet's own --font-chat
  if (font.id === DEFAULT_LOOK.chatFont) root.style.removeProperty('--font-chat');
  else root.style.setProperty('--font-chat', font.stack);
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* private window */
  }
  // the Station canvas sizes itself from the window
  window.dispatchEvent(new Event('resize'));
  return l;
}

// Before the first paint: what this browser used last time.
export function applySavedLook(): void {
  try {
    const l: Partial<LookSetting> | null = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (l) applyLook(l);
  } catch {
    /* nothing saved */
  }
}
