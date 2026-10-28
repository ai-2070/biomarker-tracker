// How the chat views reach the dashboard with the Vercel AI SDK (its HTTP transport), for agent chats
// and the Brain. No React here: the Brain chat (dock.ts) uses it with the AI SDK's stream reader.
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { readUser } from './messages.ts';
import type { ChatMessage } from './messages.ts';
import { serverFetch } from '../client/http.ts';
import { apiUrl } from '../client/connection.ts';

/** fetch with the dashboard's headers, but a refusal (409 busy, 400…) carries just the server's message, so
 *  the AI SDK's error reads "This chat is already working on something." rather than the JSON it came in. */
export const dashFetch: typeof fetch = async (input, init) => {
  const res = await serverFetch(input, init);
  if (res.ok) return res;
  const body = await res.text();
  let message = body;
  try {
    const j = JSON.parse(body) as { error?: unknown };
    if (typeof j.error === 'string' && j.error) message = j.error;
  } catch {
    /* not JSON */
  }
  return new Response(message || `${res.status} ${res.statusText}`, { status: res.status, statusText: res.statusText });
};

export const streamUrl = (agentId: string, chatId: string): string => apiUrl(`/agents/${agentId}/chats/${chatId}/stream`);

/** One agent's chats: a send posts only the new message (the server keeps the history); a resume
 *  picks up the run going in the chat. accepted: the server took a request (it answered with a stream). */
export function chatTransport(agentId: string, chatId: () => string | null, accepted?: () => void): DefaultChatTransport<ChatMessage> {
  return new DefaultChatTransport<ChatMessage>({
    api: apiUrl('/agents'),
    fetch: accepted
      ? async (input, init) => {
          const res = await dashFetch(input, init);
          if (res.ok) accepted();
          return res;
        }
      : dashFetch,
    // (steer: sent while it works, it stops the run going now and goes next)
    prepareSendMessagesRequest: ({ messages, body }) => ({ api: streamUrl(agentId, chatId() || 'none'), body: { ...readUser(messages[messages.length - 1]), ...(body?.steer === true ? { steer: true } : {}) } }),
    prepareReconnectToStreamRequest: () => ({ api: streamUrl(agentId, chatId() || 'none') }),
  });
}

/** The Brain: one question, its answer streamed (server/uistream.ts streamBrain). */
export function brainTransport(body: { text: string; project: string | null; attachments: string[]; goal?: boolean }): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport<UIMessage>({ api: apiUrl('/brain/stream'), fetch: dashFetch, prepareSendMessagesRequest: () => ({ body }) });
}
