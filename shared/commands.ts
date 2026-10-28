// The / commands you can type in a chat (agent, team or Brain chat): what each one does, the
// suggestions shown while you type "/", and reading what follows a command.

export type ChatKind = 'agent' | 'team' | 'brain';

export interface SlashCommand {
  name: string;
  /** what goes after it, for the suggestions ('' when nothing does) */
  args: string;
  about: string;
  in: readonly ChatKind[];
}

const ALL: readonly ChatKind[] = ['agent', 'team', 'brain'];

export const COMMANDS: readonly SlashCommand[] = [
  { name: 'queue', args: 'message', about: 'Send it when the work going on now is done', in: ALL },
  { name: 'stop', args: '', about: 'Stop the work now (queued messages come back to the box)', in: ALL },
  { name: 'resume', args: '', about: 'Pick up work that was stopped or paused', in: ALL },
  { name: 'resend', args: '', about: 'Send your last message again', in: ALL },
  { name: 'loop', args: '[15m] [5x] message', about: 'Repeat a message: every so often, or again after each answer', in: ALL },
  { name: 'goal', args: 'what done looks like', about: 'Keep at it until the Brain says it is done (/goal clear to drop it)', in: ALL },
  { name: 'compact', args: '[summary]', about: 'Make the chat shorter so it fits the model', in: ['agent'] },
  { name: 'clear', args: '', about: 'Clear this chat (each agent also forgets it)', in: ['team'] },
];

/** The command typed (a known name) and what follows it, or null when the text isn't one. */
export function parseCommand(text: string, kind?: ChatKind): { name: string; rest: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const cmd = COMMANDS.find((c) => c.name === name);
  if (!cmd || (kind && !cmd.in.includes(kind))) return null;
  return { name, rest: (m[2] || '').trim() };
}

/** A suggestion: one of ours, or (harness) one of the agent's own harness commands, sent to it as typed. */
export interface SlashOption extends SlashCommand {
  harness?: boolean;
}

/** The commands to suggest while the box holds just "/" and the start of a name (ours first, then the
 *  harness's own: extra). */
export function slashSuggestions(text: string, kind: ChatKind, extra: readonly { name: string; about: string }[] = []): SlashOption[] {
  const m = /^\/([\w:.-]*)$/.exec(text);
  if (!m) return [];
  const q = m[1].toLowerCase();
  const ours: SlashOption[] = COMMANDS.filter((c) => c.in.includes(kind) && c.name.startsWith(q) && c.name !== q);
  const theirs: SlashOption[] = extra.filter((c) => c.name.toLowerCase().startsWith(q) && c.name.toLowerCase() !== q).map((c) => ({ name: c.name, args: '', about: c.about, in: [kind], harness: true }));
  return [...ours, ...theirs].slice(0, 40);
}

/** Follow-ups on your /goal before the Brain says it isn't reached (the Brain's own hand-offs get 2). */
export const GOAL_FOLLOW_UPS = 5;

// ---------- /loop ----------
export const LOOP_TIMES = 10;
export const LOOP_TIMES_MAX = 100;
export const LOOP_EVERY_MIN = 60_000;
export const LOOP_EVERY_MAX = 7 * 24 * 3600_000;

export interface LoopRequest {
  text: string;
  /** null: again right after each answer */
  every: number | null;
  times: number;
}

/** What follows /loop: an optional interval (30m, 2h, 1d) and count (5x), in either order, then the
 *  message. Returns an error text for the person when it can't be read. */
export function parseLoop(rest: string): LoopRequest | { error: string } {
  let every: number | null = null;
  let times = LOOP_TIMES;
  const words = rest.trim().split(/(\s+)/);
  let i = 0;
  for (let n = 0; n < 2 && i < words.length; n++) {
    const w = words[i];
    const t = /^(\d+)\s*(s|m|min|h|d)$/i.exec(w);
    const x = /^(\d+)x$/i.exec(w);
    if (t && every == null) {
      const unit = t[2].toLowerCase();
      every = Number(t[1]) * (unit === 's' ? 1000 : unit === 'h' ? 3600_000 : unit === 'd' ? 86400_000 : 60_000);
    } else if (x) times = Number(x[1]);
    else break;
    i += 2; // the word and the space after it
  }
  const text = words.slice(i).join('').trim();
  if (!text) return { error: 'Write the message after /loop, e.g. /loop 15m check the build' };
  if (every != null && every < LOOP_EVERY_MIN) return { error: 'Loop at most once a minute.' };
  if (every != null && every > LOOP_EVERY_MAX) return { error: 'Loop at least once a week.' };
  if (times < 1 || times > LOOP_TIMES_MAX) return { error: `Loop between 1 and ${LOOP_TIMES_MAX} times.` };
  return { text, every, times };
}

/** "every 15m" / "after each answer", for the loop chip. */
export function loopPace(every: number | null): string {
  if (every == null) return 'after each answer';
  const units: [number, string][] = [[86400_000, 'd'], [3600_000, 'h'], [60_000, 'm'], [1000, 's']];
  for (const [ms, u] of units) if (every % ms === 0) return `every ${every / ms}${u}`;
  return `every ${Math.round(every / 1000)}s`;
}
