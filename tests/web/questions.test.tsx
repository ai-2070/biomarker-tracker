// Questions from agents (ask_user) in the Outbox and in the chat: choices you click, an answer in your own
// words, Dismiss, and what happened to an answered one.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DynamicToolUIPart } from 'ai';
import { state } from '../../web/core.ts';
import * as outbox from '../../web/views/outbox.tsx';
import { QuestionCard, deliveredText, mountDrawerQuestions, questionFor } from '../../web/questions.tsx';
import { ToolCard } from '../../web/chat/parts.tsx';
import type { AgentQuestion, AppState } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

const question = (over: Partial<AgentQuestion> = {}): AgentQuestion => ({ id: 'qn1', question: 'Which style?', choices: ['Flat', '3D'], status: 'waiting', agentId: 'a1', agentName: 'Designer', createdAt: Date.now(), ...over });
let list: AgentQuestion[];
let requests: { method: string; url: string; body: unknown }[];
let el: HTMLElement;
let root: Root | null = null;

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toasts"></div><section id="view"></section>';
  el = document.getElementById('view')!;
  list = [question(), question({ id: 'qn0', question: 'Old one?', status: 'answered', choice: 'Yes', delivered: 'chat' })];
  requests = [];
  state.data = { outboxPending: 0, questions: [list[0]], accounts: { x: [], reddit: [] } } as unknown as AppState;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method, url, body });
    const json = (v: unknown) => new Response(JSON.stringify(v));
    if (url === '/api/questions') return json(list);
    if (url === '/api/outbox') return json([]);
    if (url.endsWith('/answer')) return json({ ...list[0], status: 'answered', delivered: 'live' });
    return json({ ok: true });
  });
});
afterEach(() => {
  act(() => outbox.unmount());
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

const btn = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
const type = (input: HTMLTextAreaElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const show = async (node: React.ReactNode) => {
  root = createRoot(el);
  await act(async () => root!.render(node));
};

describe('a question card', () => {
  it('sends the choice you click, with what you wrote', async () => {
    await show(<QuestionCard q={question()} />);
    expect(el.textContent).toContain('Which style?');
    await type(el.querySelector('textarea')!, 'with a soft shadow');
    await act(async () => btn('3D').click());
    await settle();
    expect(requests.find((r) => r.url === '/api/questions/qn1/answer')!.body).toEqual({ choice: '3D', text: 'with a soft shadow' });
    expect(document.getElementById('toasts')!.textContent).toContain('Sent to Designer');
  });

  it('sends an answer in your own words, and can be dismissed', async () => {
    await show(<QuestionCard q={question({ choices: [] })} />);
    expect(btn('Send answer').disabled).toBe(true);
    await type(el.querySelector('textarea')!, 'Use the blue one');
    await act(async () => btn('Send answer').click());
    await settle();
    expect(requests.find((r) => r.url === '/api/questions/qn1/answer')!.body).toEqual({ choice: '', text: 'Use the blue one' });
    await act(async () => btn('Dismiss').click());
    await settle();
    expect(requests.some((r) => r.url === '/api/questions/qn1/dismiss' && r.method === 'POST')).toBe(true);
  });

  it('an answered one says what you answered and where it went', async () => {
    await show(<QuestionCard q={question({ status: 'answered', choice: 'Flat', reply: 'and bold', delivered: 'team', teamName: 'Brand' })} />);
    expect(el.textContent).toContain('You answered: Flat · and bold');
    expect(el.textContent).toContain('Sent to Designer in the Brand chat.');
    expect(el.querySelector('textarea')).toBeNull();
    expect(deliveredText(question({ delivered: 'live' }))).toBe('Designer got it right away.');
  });
});

describe('the Needs you drawer', () => {
  it('shows each waiting question with its choices to click and a box to answer, and keeps what you typed', async () => {
    let drawer: { unmount: () => void } | null = null;
    await act(async () => void (drawer = mountDrawerQuestions(el)));
    try {
      const card = el.querySelector('.approval.question')!;
      expect(card.textContent).toContain('Which style?');
      expect(card.textContent).toContain('Designer');
      await type(el.querySelector('textarea')!, 'bold please');
      // the app state refreshes (another question arrives): the card and what you typed stay
      await act(async () => {
        state.data = { ...state.data!, questions: [list[0], question({ id: 'qn2', question: 'Which font?', choices: ['Serif', 'Sans'] })] };
        for (const fn of state.listeners) fn(state.data);
      });
      expect(el.querySelectorAll('.approval.question')).toHaveLength(2);
      expect(el.querySelector('textarea')!.value).toBe('bold please');
      await act(async () => btn('Flat').click());
      await settle();
      expect(requests.find((r) => r.url === '/api/questions/qn1/answer')!.body).toEqual({ choice: 'Flat', text: 'bold please' });
      // (no Remove there: answered ones live in the Outbox)
      expect(btn('Remove')).toBeUndefined();
    } finally {
      act(() => drawer?.unmount());
    }
  });
});

describe('the Outbox', () => {
  it('shows waiting questions first, and the answered ones folded away', async () => {
    await act(async () => outbox.render(el));
    await settle();
    const heads = [...el.querySelectorAll('h2.section')].map((h) => h.textContent);
    expect(heads[0]).toBe('Questions from agents (1)');
    expect(el.querySelector('details > summary')!.textContent).toBe('Answered and closed (1)');
    expect(btn('Flat')).toBeTruthy();
  });
});

describe('in the chat', () => {
  const part = (input: unknown, state: DynamicToolUIPart['state'] = 'input-available') => ({ type: 'dynamic-tool', toolName: 'ask_user', toolCallId: 't1', input, state }) as DynamicToolUIPart;

  it('finds the waiting question an ask_user call made', () => {
    expect(questionFor(state.data!.questions, { question: ' Which style? ' })?.id).toBe('qn1');
    expect(questionFor(state.data!.questions, { question: 'Something else' })).toBeNull();
    expect(questionFor(undefined, {})).toBeNull();
  });

  it('two agents asking the same thing: each tool call shows its own agent’s question', () => {
    const qs = [question({ id: 'qa', agentId: 'a1', chatId: 'c1' }), question({ id: 'qb', agentId: 'a2', chatId: 'c2' })];
    expect(questionFor(qs, { question: 'Which style?' }, { agentId: 'a1', chatId: 'c1' })?.id).toBe('qa');
    expect(questionFor(qs, { question: 'Which style?' }, { agentId: 'a2', chatId: 'c2' })?.id).toBe('qb');
    // the same agent in another chat: not that one's
    expect(questionFor(qs, { question: 'Which style?' }, { agentId: 'a1', chatId: 'c9' })).toBeNull();
    // (one asked with no chat known still shows in the agent's chat)
    expect(questionFor([question({ id: 'qc', agentId: 'a1', chatId: null })], { question: 'Which style?' }, { agentId: 'a1', chatId: 'c1' })?.id).toBe('qc');
  });

  it('lets you answer right under the tool call while the agent waits', async () => {
    await show(<ToolCard part={part({ question: 'Which style?', choices: ['Flat', '3D'] })} variant="full" busy />);
    expect(el.querySelector('.question.in-chat')).toBeTruthy();
    expect(btn('Flat')).toBeTruthy();
  });

  it('shows no card once the call is done', async () => {
    await show(<ToolCard part={{ ...part({ question: 'Which style?' }, 'output-available'), output: 'The user answered: "Flat"' } as DynamicToolUIPart} variant="full" busy={false} />);
    expect(el.querySelector('.question')).toBeNull();
  });
});
