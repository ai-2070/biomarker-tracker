// Chat with one agent: the agent and its chats on the left; the conversation itself is the AI SDK chat
// (web/chat): streaming answers, tool calls you can open, images, file previews, COMPACTED marks.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GET, POST, PUT, DEL, attempt, navigate, ago, confirmBox, promptBox, ENGINE_LABEL } from '../core.ts';
import { openTerminal } from './agents.tsx';
import { memoryButton } from '../memory.ts';
import { modelChip, modelInfo } from '../models.ts';
import { kTokens } from '../../shared/compaction.ts';
import { attachTray } from '../attach.ts';
import { Avatar, DomNode, reactPage } from '../ui/react.tsx';
import type { PageContext } from '../ui/react.tsx';
import type { AgentDetail } from './agents.tsx';
import type { ChatViewApi } from '../chat/ChatView.tsx';
import type { Chat, ChatSummary } from '../../shared/types.ts';

// The conversation (and the AI SDK) loads only when a chat opens.
const ChatView = lazy(() => import('../chat/ChatView.tsx').then((m) => ({ default: m.ChatView })));

/** GET /api/agents/:id/chats/:cid/memory */
interface MemoryInfo {
  tokens: number;
  window: number;
  compactAt: number;
  percent: number;
  auto: boolean;
  /** the engine compacts this chat by itself (compactAt is then the whole window) */
  own?: boolean;
}

type Loaded = { kind: 'gone' } | { kind: 'ready'; agent: AgentDetail; chat: Chat; chats: ChatSummary[] };

function ChatPage({ agentId, chatId, view }: { agentId: string; chatId?: string; view: PageContext }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const agent = await GET<AgentDetail>(`/agents/${agentId}`).catch(() => null);
      if (!live) return;
      if (!agent) return setLoaded({ kind: 'gone' });
      view.setTitle(`${agent.emoji || ''} ${agent.name}`);
      const chats = await GET<ChatSummary[]>(`/agents/${agentId}/chats`);
      if (!live) return;
      if (!chatId) {
        // no chat in the address: the latest one, or a new one
        const target = chats[0] || (await POST<Chat>(`/agents/${agentId}/chats`));
        if (live) location.replace(`#/agents/${agentId}/${target.id}`);
        return;
      }
      const chat = await GET<Chat>(`/agents/${agentId}/chats/${chatId}`).catch(() => null);
      if (!live) return;
      if (!chat) return void location.replace(`#/agents/${agentId}`);
      setLoaded({ kind: 'ready', agent, chat, chats });
    })();
    return () => void (live = false);
  }, [agentId, chatId, view]);
  if (!loaded) return null;
  if (loaded.kind === 'gone')
    return (
      <div className="p-7">
        <p>That agent no longer exists. </p>
        <a href="#/agents">Back to agents</a>
      </div>
    );
  return <ChatScreen agent={loaded.agent} first={loaded.chat} firstChats={loaded.chats} />;
}

function ChatScreen({ agent, first, firstChats }: { agent: AgentDetail; first: Chat; firstChats: ChatSummary[] }) {
  const [chat, setChat] = useState(first);
  const [chats, setChats] = useState(firstChats);
  const [memory, setMemory] = useState<MemoryInfo | null>(null);
  const api = useRef<ChatViewApi | null>(null);
  // files waiting to go with the next message: the whole page takes dropped files, and they go when you leave
  const tray = useMemo(() => attachTray(), []);
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = tray.dropZone(page.current!, `Drop files or folders for ${agent.name}`);
    // the message box gets focus as soon as it is on the page (the conversation loads lazily, and
    // ChatView hands over its api while drawing, before the box exists)
    let tries = 0;
    const focus = setInterval(() => {
      const ready = !!page.current?.querySelector('.chat-body textarea');
      if ((ready && api.current) || ++tries > 80) {
        clearInterval(focus);
        api.current?.focus();
      }
    }, 50);
    return () => {
      clearInterval(focus);
      off();
      tray.discard();
    };
  }, [tray, agent.name]);
  const footer = useMemo(() => modelChip(agent, { onChange: () => void api.current?.reload() }), [agent]);

  const loadMemory = useCallback(
    (c: Chat) =>
      GET<MemoryInfo>(`/agents/${agent.id}/chats/${c.id}/memory`)
        .then(setMemory)
        .catch(() => {}),
    [agent.id],
  );
  useEffect(() => void loadMemory(first), [loadMemory, first]);
  const onChat = useCallback(
    (c: Chat) => {
      setChat(c);
      void loadMemory(c);
      void GET<ChatSummary[]>(`/agents/${agent.id}/chats`).then(setChats).catch(() => {});
    },
    [agent.id, loadMemory],
  );

  const newChat = async () => {
    const c = await attempt(() => POST<Chat>(`/agents/${agent.id}/chats`));
    if (c) navigate(`#/agents/${agent.id}/${c.id}`);
  };
  const rename = async () => {
    const t = await promptBox('Rename chat', { value: chat.title });
    if (t && (await attempt(() => PUT(`/agents/${agent.id}/chats/${chat.id}`, { title: t })))) await api.current?.reload();
  };
  const resetMemory = async () => {
    if (await attempt(() => PUT(`/agents/${agent.id}/chats/${chat.id}`, { reset: true }), 'The agent will start fresh from your next message')) await api.current?.reload();
  };
  const removeChat = async () => {
    if (!(await confirmBox('Delete this chat?', { ok: 'Delete', danger: true }))) return;
    await attempt(() => DEL(`/agents/${agent.id}/chats/${chat.id}`));
    navigate(`#/agents/${agent.id}`);
  };

  const tools = agent.tools || [];
  const info = modelInfo(agent);
  const how = memory ? (memory.own ? `${ENGINE_LABEL[agent.engine] || 'Its engine'} compacts it by itself when it is nearly full` : memory.auto ? `Compacts by itself at ${kTokens(memory.compactAt)}` : 'Automatic compaction is off') : '';
  return (
    <div className="grid h-[calc(100vh-61px)] grid-cols-[270px_minmax(0,1fr)] max-md:h-auto max-md:min-h-[calc(100vh-57px)] max-md:grid-cols-1" ref={page}>
      <div className="flex min-h-0 flex-col border-r border-line bg-panel max-md:max-h-60 max-md:border-r-0 max-md:border-b">
        <div className="border-b border-line p-4">
          <div className="flex items-center gap-2.5">
            <Avatar agent={agent} lg />
            <div className="min-w-0 flex-1">
              <div className="text-[16px] leading-[1.25] font-bold">{agent.name}</div>
              <div className="hint mt-0.5">{agent.specialty || ''}</div>
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
            <span className="pill">{info.name}</span>
            <span className="pill">{info.where}</span>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
            <button className="btn small" onClick={() => void newChat()}>+ New chat</button>
            <a className="btn ghost small" href={`#/agents/${agent.id}/edit`}>Edit</a>
            <DomNode as="span" make={() => memoryButton(agent.id, agent.name)} deps={[agent.id]} />
            {agent.engine !== 'openai' ? (
              <button className="btn ghost small" title="Open this agent in a live terminal" onClick={() => void openTerminal(agent)}>Terminal</button>
            ) : null}
          </div>
          <details className="mt-3.5">
            <summary className="label cursor-pointer">{`${tools.length} tools`}</summary>
            <div className="hint chat-tools mt-1.5 font-mono text-[11px] leading-[1.7]">{tools.join(' · ')}</div>
          </details>
        </div>
        <nav className="flex-1 overflow-y-auto py-1.5" aria-label="Chats">
          {chats.map((c) => (
            <a key={c.id} className={c.id === chat.id ? 'on block border-l-2 border-accent bg-panel-2 px-4 py-2.25 text-[13.5px] text-ink' : 'block border-l-2 border-transparent px-4 py-2.25 text-[13.5px] text-dim hover:bg-panel-2 hover:text-ink'} aria-current={c.id === chat.id ? 'page' : undefined} href={`#/agents/${agent.id}/${c.id}`}>
              <span className="t block truncate">{c.title || 'Chat'}</span>
              <span className="font-mono text-[10.5px] leading-[normal] text-faint">{`${ago(c.updatedAt)} · ${c.count} items`}</span>
            </a>
          ))}
        </nav>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="chat-head flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-7 py-2.5">
          <div className="min-w-0 flex-1">
            <span className="chat-title font-mono text-[12px] text-dim">{chat.title || 'Chat'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {memory ? (
              <span className={memory.tokens >= memory.compactAt * 0.8 ? 'pill mem warn' : 'pill mem'} title={`About ${kTokens(memory.tokens)} of ${kTokens(memory.window)} tokens. ${how} (Settings > Chat memory).`}>
                {`Memory ${memory.percent}%`}
              </span>
            ) : null}
            <button className="btn tiny ghost" title="Compact the agent’s memory of this chat now: older messages become a short history, the latest stay in full (or type /compact)" onClick={() => void api.current?.compact()}>Compact</button>
            <button className="btn tiny ghost" onClick={() => void rename()}>Rename</button>
            <button className="btn tiny ghost" title="Keep the messages here but start the agent fresh" onClick={() => void resetMemory()}>Clear memory</button>
            <button className="btn tiny danger" onClick={() => void removeChat()}>Delete</button>
          </div>
        </div>
        <div className="chat-body contents">
          <Suspense fallback={null}>
            <ChatView agent={{ id: agent.id, name: agent.name, emoji: agent.emoji, specialty: agent.specialty, tools: agent.tools }} chatId={chat.id} tray={tray} footer={footer} onChat={onChat} apiRef={api} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export const flush = true;
export const title = (): string => 'Chat';
export const { render, unmount } = reactPage((params, view) => <ChatPage agentId={params[0]} chatId={params[1]} view={view} />);
