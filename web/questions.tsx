// Questions agents asked you (ask_user): the card with the choices as buttons and a box for an answer in
// your own words. Shown in the Outbox, in the Needs you drawer, and in the chat while the agent waits there.
import { useState } from 'react';
import { POST, DEL, attempt, ago, md, refreshSoon } from './core.ts';
import { DomNode, mountReact, useAppState } from './ui/react.tsx';
import type { AgentQuestion } from '../shared/types.ts';

const STATUS: Record<AgentQuestion['status'], [string, string]> = {
  waiting: ['warn', 'asks you'],
  answered: ['ok', 'answered'],
  dismissed: ['', 'dismissed'],
  closed: ['', 'closed'],
};

/** Where your answer went, in plain words. */
export function deliveredText(q: AgentQuestion): string {
  const who = q.agentName || 'the agent';
  if (q.delivered === 'live') return `${who} got it right away.`;
  if (q.delivered === 'chat') return `Sent to ${who}'s chat as a new message.`;
  if (q.delivered === 'team') return `Sent to ${who} in the ${q.teamName || 'team'} chat.`;
  return q.note || '';
}

/** Whose chat a tool call is in: its question is that agent's, asked in that chat. */
export interface QuestionOwner {
  agentId: string;
  chatId: string | null;
}

/** The waiting question in the list that a chat's ask_user call made (matched by its text, newest first,
 *  and by the agent and chat it is in: two agents asking the same thing each answer their own). */
export function questionFor(list: readonly AgentQuestion[] | undefined, input: unknown, owner?: QuestionOwner | null): AgentQuestion | null {
  const asked = input && typeof input === 'object' ? String((input as { question?: unknown }).question ?? '').trim().slice(0, 2000) : '';
  if (!asked) return null;
  // (a question asked outside a known chat has no chatId: then the agent alone decides)
  const theirs = (q: AgentQuestion) => !owner || (q.agentId === owner.agentId && (!q.chatId || !owner.chatId || q.chatId === owner.chatId));
  return [...(list || [])].reverse().find((q) => q.status === 'waiting' && q.question === asked && theirs(q)) || null;
}

/** Where a card is shown: the Outbox page, under the tool call in a chat, or in the Needs you drawer. */
export type QuestionPlace = 'outbox' | 'chat' | 'drawer';
const CARD: Record<QuestionPlace, string> = { outbox: 'panel question', chat: 'question in-chat', drawer: 'approval question' };

/** One question: click a choice, or write an answer (or both: what you wrote goes along with the choice). */
export function QuestionCard({ q, place = 'outbox', changed }: { q: AgentQuestion; place?: QuestionPlace; changed?: () => void }) {
  const inChat = place === 'chat';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const waiting = q.status === 'waiting';
  const who = q.agentName || 'the agent';
  const answer = async (choice?: string) => {
    setBusy(true);
    const r = await attempt(() => POST<AgentQuestion>(`/questions/${q.id}/answer`, { choice: choice || '', text }), `Sent to ${who}`);
    setBusy(false);
    if (r) {
      setText('');
      changed?.();
    }
  };
  const dismiss = async () => {
    if (await attempt(() => POST(`/questions/${q.id}/dismiss`, {}))) changed?.();
  };
  const remove = async () => {
    if (await attempt(() => DEL(`/questions/${q.id}`))) changed?.();
  };
  const [tone, label] = STATUS[q.status] || ['', q.status];
  const after = q.status === 'answered' ? deliveredText(q) : q.note || '';
  return (
    <div className={`${CARD[place]}${waiting ? ' waiting' : ''}`} role="group" aria-label={`Question from ${who}`}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={`pill${tone ? ` ${tone}` : ''}`}>{label}</span>
        {inChat ? <span className="hint">Also in your Outbox</span> : <b>{q.agentName || 'An agent'}</b>}
        {inChat ? null : <span className="hint">{`${q.teamName ? `team ${q.teamName} · ` : ''}${ago(q.createdAt)}`}</span>}
      </div>
      <p className="text-[15px] font-semibold whitespace-pre-wrap">{q.question}</p>
      {q.detail ? <DomNode className="hint [&>:first-child>:first-child]:mt-0 [&>:first-child>:last-child]:mb-0" make={() => md(q.detail)} deps={[q.detail]} /> : null}
      {waiting ? (
        <>
          {q.choices.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {q.choices.map((c) => (
                <button key={c} className="btn small" disabled={busy} title={text.trim() ? 'Send this choice, with what you wrote' : 'Send this answer'} onClick={() => void answer(c)}>
                  {c}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            rows={2}
            aria-label={`Answer ${who}`}
            placeholder={q.choices.length ? 'Or answer in your own words… (goes along with a choice you click)' : `Answer ${who} in your own words…`}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() && void answer()}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <button className="btn ghost small" disabled={busy || !text.trim()} title="Send what you wrote (Ctrl+Enter)" onClick={() => void answer()}>Send answer</button>
            <span className="min-w-0 flex-1" />
            <button className="btn ghost tiny" disabled={busy} title={`Close it without answering: ${who} hears you passed`} onClick={() => void dismiss()}>Dismiss</button>
          </div>
        </>
      ) : (
        <>
          {q.status === 'answered' ? (
            <p>
              <span className="hint">You answered: </span>
              {[q.choice, q.reply].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          {after ? <p className="hint">{after}</p> : null}
          {place !== 'outbox' ? null : (
            <div className="flex flex-wrap items-center gap-2.5">
              <button className="btn tiny ghost" onClick={() => void remove()}>Remove</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The questions waiting for you, as cards in the Needs you drawer (it follows the app state by itself). */
function DrawerQuestions() {
  const asked = useAppState()?.questions || [];
  return (
    <>
      {asked.map((q) => (
        <QuestionCard key={q.id} q={q} place="drawer" changed={() => refreshSoon(0)} />
      ))}
    </>
  );
}

/** Draws the waiting questions into el (the drawer is plain DOM: it keeps el, so a half-typed answer stays). */
export function mountDrawerQuestions(el: HTMLElement): { unmount: () => void } {
  return mountReact(el, <DrawerQuestions />);
}
