// One agent's turn in another chat's view (a team chat; the Brain chat's handoffs): its steps and tool
// calls, on the Vercel AI SDK. live: the turn going now, streamed in (a resume of the agent's chat);
// else a finished turn, read from the agent's saved chat (items from..to).
import { useEffect, useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { GET } from '../core.ts';
import { MessageView } from './parts.tsx';
import { chatTransport } from './transport.ts';
import { toUIMessages } from './messages.ts';
import type { ChatMessage } from './messages.ts';
import type { Chat } from '../../shared/types.ts';

export interface TurnViewProps {
  agentId: string;
  chatId: string;
  /** the turn going now (streamed in) */
  live?: boolean;
  /** a finished turn: these items of the chat */
  from?: number;
  to?: number;
  /** what to show when there is nothing (yet) */
  empty?: string;
  /** the live turn ended (the stream is over) */
  onEnd?: () => void;
  /** a Rich answer's buttons: what they send */
  onSend?: (text: string) => void;
}

export function TurnView({ agentId, chatId, live, from, to, empty, onEnd, onSend }: TurnViewProps) {
  const transport = useMemo(() => chatTransport(agentId, () => chatId), [agentId, chatId]);
  const [viewId] = useState(() => `turn-${chatId}-${Math.random().toString(36).slice(2, 8)}`);
  const { messages, setMessages, resumeStream, status } = useChat<ChatMessage>({ id: viewId, transport });
  const [loaded, setLoaded] = useState(false);
  const owner = useMemo(() => ({ agentId, chatId }), [agentId, chatId]);
  const streaming = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (live) {
        await resumeStream();
        if (!alive) return;
        onEnd?.();
      }
      // a finished turn, or the live one once it ended (or had ended before it could be picked up):
      // as saved. Only the agent's side: the message to it is what the team or the Brain already shows.
      const chat = await GET<Chat>(`/agents/${agentId}/chats/${chatId}`).catch(() => null);
      if (!alive) return;
      // (a chat that is gone, or not one: nothing to show)
      if (chat && Array.isArray(chat.items)) {
        const last = chat.items.findLastIndex((i) => i.type === 'user');
        const a = live || from == null ? last : from;
        const b = live || to == null ? chat.items.length : to;
        setMessages(toUIMessages(chat.items, a, b).filter((m) => m.role !== 'user'));
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!messages.length) return loaded && empty ? <div className="hint text-[11.5px]">{empty}</div> : null;
  const lastId = messages[messages.length - 1]?.id;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {messages.map((m) => (
        <MessageView key={m.id} m={m} variant="mini" busy={streaming} streaming={streaming && m.id === lastId} dim={false} onSend={(t) => onSend?.(t)} owner={owner} />
      ))}
    </div>
  );
}
