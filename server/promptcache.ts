// Prompt caching on OpenRouter: the start of a request that was sent a moment ago is read back from
// the provider's cache (much cheaper and faster) instead of being processed again.
import { createHash } from 'node:crypto';

/** Claude models on OpenRouter cache only when asked; the others (OpenAI, Gemini, DeepSeek, Grok…) cache by themselves. */
export const asksForCache = (providerId: string, model: string): boolean => providerId === 'openrouter' && /^~?anthropic\//i.test(model);

/** What an OpenRouter request adds so the start of a long chat is read from the prompt cache:
 *  the chat id keeps its requests on the same provider (where the cache is), and Claude models get a
 *  moving cache point (the whole request so far, written once and read back on the next step or turn). */
export function cacheFields(providerId: string, model: string, chatId: string | null | undefined): Record<string, unknown> {
  if (providerId !== 'openrouter') return {};
  return { ...(chatId ? { session_id: String(chatId).slice(0, 256) } : {}), ...(asksForCache(providerId, model) ? { cache_control: { type: 'ephemeral' } } : {}) };
}

/** A system message the Brain sends: for a Claude model, cached up to its end (its instructions are the
 *  same from call to call, while what follows changes every time). */
export function systemMessage(model: string, system: string): { role: 'system'; content: string | { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[] } {
  if (!asksForCache('openrouter', model)) return { role: 'system', content: system };
  return { role: 'system', content: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] };
}

/** The session the Brain's requests go in: one per set of instructions, so calls that start the same
 *  way go to the same provider and read its cache. (Without one, OpenRouter keys a session on the first
 *  user message too, and the Brain's changes every time: each call could land on a provider without the cache.) */
export const brainSession = (system: string): string => `brain-${createHash('sha256').update(system).digest('hex').slice(0, 32)}`;
