// Rich answers (an agent setting): in your own chats with the agent, it answers in OpenUI Lang, which
// the chat shows as live components (cards, tables, charts, forms). Its instructions then carry
// OpenUI's component prompt (from the same component library the chat renders with).
// Only where you read the answer yourself: not in team chats, routines or for other agents.
import { log } from './store.ts';
import type { Agent, Chat } from '../shared/types.ts';

let cached: Promise<string> | null = null;

/** OpenUI's chat component prompt (built once, about 13k tokens). */
export function openuiPrompt(): Promise<string> {
  cached ??= import('@openuidev/react-ui/genui-lib')
    .then((m) => m.openuiChatLibrary.prompt(m.openuiChatPromptOptions))
    .catch((e: Error) => {
      cached = null;
      throw e;
    });
  return cached;
}

/** Whether this run answers with Rich answers: the agent has them on, and you are its only reader. */
export const richFor = (agent: Pick<Agent, 'richAnswers'>, chat: Pick<Chat, 'teamId'>, depth: number): boolean => !!agent.richAnswers && depth === 0 && !chat.teamId;

/** What goes at the end of the agent's instructions for this run ('' when it answers in markdown). */
export async function richSection(agent: Pick<Agent, 'richAnswers'>, chat: Pick<Chat, 'teamId'>, depth: number): Promise<string> {
  if (!richFor(agent, chat, depth)) return '';
  const prompt = await openuiPrompt().catch((e: Error) => {
    // (it answers in markdown this time; say why)
    log('error', `Rich answers are off for this message: OpenUI's component prompt didn't load (${e.message || e})`);
    return '';
  });
  if (!prompt) return '';
  return `\n\n# How to write your answers (Rich answers)
Use your tools as usual. Write the text you answer the user with in openui-lang, as described below: the chat shows it as live components (cards, tables, charts, forms, buttons). Keep it readable as a whole: a short answer can be a single Card with TextContent.

${prompt}`;
}
