// How tall a chat message will be before it has drawn, from what it holds and how wide the list is.
// A long chat draws only the messages near the screen (window.tsx); the rest keep this guess until
// they draw. A flat guess made messages grow as you scrolled up, and the list moved the view to keep
// it steady, so a jump to the top (Home, a flick) stopped short of the first message.
import type { ChatMessage } from './messages.ts';

/** Measured in the app (Inter at the chat's size): px per character, line heights, a message's own space. */
const CHAR_PX = 7;
const SIDE_PADDING = 56;
const LINE = { user: 23, assistant: 25 };
const BASE = { user: 46, assistant: 40 };
/** A user message is a bubble, narrower than the list. */
const USER_SHARE = 0.85;
const TOOL_PX = 44;
const FILE_PX = 220;
const OTHER_PX = 110;
/** The floating window and the Station's panel use smaller type and less room around it. */
const COMPACT = 0.8;

/** Characters that fit on one line of a message at this list width. */
export const charsPerLine = (width: number): number => Math.max(24, Math.floor((width - SIDE_PADDING) / CHAR_PX));

/** Lines a text takes: each paragraph wraps on its own; blank lines are paragraph breaks, not lines. */
export function wrappedLines(text: string, perLine: number): number {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
}

/** The guessed height of a message, in px. width: the message list's width. */
export function estimateHeight(m: ChatMessage, width: number, compact = false): number {
  const user = m.role === 'user';
  const perLine = Math.floor(charsPerLine(width) * (user ? USER_SHARE : 1));
  let lines = 0;
  let extra = 0;
  for (const p of m.parts) {
    if (p.type === 'text' || p.type === 'reasoning') lines += wrappedLines(p.text || '', perLine);
    else if (p.type === 'dynamic-tool' || p.type.startsWith('tool-')) extra += TOOL_PX;
    else if (p.type === 'file') extra += FILE_PX;
  }
  if (!lines && !extra) return Math.round(OTHER_PX * (compact ? COMPACT : 1));
  const h = (user ? BASE.user : BASE.assistant) + lines * (user ? LINE.user : LINE.assistant) + extra;
  return Math.round(h * (compact ? COMPACT : 1));
}

/**
 * A short mark of what a message holds (its parts' kinds and text lengths), cheap to make: a height
 * remembered under it is only reused while the message would still draw the same.
 */
export function messageSig(m: ChatMessage): string {
  let s = m.role === 'user' ? 'u' : 'a';
  for (const p of m.parts) s += `.${p.type === 'text' || p.type === 'reasoning' ? (p.text || '').length : p.type.slice(0, 6)}`;
  return s;
}
