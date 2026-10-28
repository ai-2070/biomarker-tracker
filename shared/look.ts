// Settings > Look choices both sides use: the chat fonts (here so the build's font test can check they all ship)
// and how hard the Station's map works.
import type { StationQuality } from './types.ts';

/** A font for chat messages; like: whose look it matches. They all come with the app (scripts/build-fonts.ts)
 *  or are on the computer already. */
export interface ChatFont {
  id: string;
  label: string;
  like: string;
  stack: string;
}
export const CHAT_FONTS: ChatFont[] = [
  { id: 'serif', label: 'Merriweather', like: 'A book-like serif (the default)', stack: "'Merriweather', Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'JetBrains Mono', like: 'Like Claude Code in a terminal', stack: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace" },
  { id: 'system', label: 'System font', like: 'Like ChatGPT: your computer’s own font (Segoe UI on Windows, San Francisco on a Mac)', stack: "ui-sans-serif, -apple-system, system-ui, 'Segoe UI', Helvetica, Arial, sans-serif" },
  { id: 'google', label: 'Google Sans', like: 'Like Gemini and Google Search', stack: "'Google Sans', 'Segoe UI', system-ui, sans-serif" },
  { id: 'roboto', label: 'Roboto', like: 'Like Android', stack: "'Roboto', 'Segoe UI', system-ui, sans-serif" },
  // San Francisco can only be used on Apple devices; Inter is the closest free match
  { id: 'apple', label: 'San Francisco', like: 'Like iPhone and Mac (Inter, a close match, on Windows)', stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', sans-serif" },
  { id: 'sans', label: 'Archivo', like: 'The same font as the rest of the page', stack: "'Archivo', 'Segoe UI', system-ui, sans-serif" },
];
export const chatFont = (id: string | undefined): ChatFont => CHAT_FONTS.find((f) => f.id === id) || CHAT_FONTS[0];

/** How the Station's map is drawn. fps: frames a second while you move around it (null: as fast as the
 *  screen shows), when nothing moves, and when the window isn't in front; pixelRatio: the most pixels drawn
 *  per screen pixel (sharpness on high-DPI screens); screenPx: how wide a desk's screen must look before its
 *  animation is drawn (every redraw sends a new picture to the graphics card). */
export interface StationLevel {
  id: StationQuality;
  label: string;
  hint: string;
  fps: { moving: number | null; still: number; away: number };
  pixelRatio: number;
  screenPx: number;
}
export const STATION_QUALITY: StationLevel[] = [
  { id: 'smooth', label: 'Smooth', hint: 'As many frames as your screen shows and full sharpness. Uses the most power.', fps: { moving: null, still: 60, away: 30 }, pixelRatio: 2, screenPx: 32 },
  { id: 'balanced', label: 'Balanced', hint: '60 frames a second while you move around, 30 when nothing moves, fewer when the window is in the back.', fps: { moving: 60, still: 30, away: 15 }, pixelRatio: 1.5, screenPx: 40 },
  { id: 'saver', label: 'Battery saver', hint: '30 frames a second at most and a little softer. For laptops on battery and older PCs, and many agents.', fps: { moving: 30, still: 20, away: 8 }, pixelRatio: 1, screenPx: 110 },
];
export const stationLevel = (id: string | undefined): StationLevel => STATION_QUALITY.find((q) => q.id === id) || STATION_QUALITY[1];
