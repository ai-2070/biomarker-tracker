// Other teams in a team chat: #Team Name is highlighted like @Name, and a quote names the team.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { state } from '../../web/core.ts';
import { mentionPattern, renderTeamChat, senderName } from '../../web/teamchat.tsx';
import type { AppState, TeamMessage } from '../../shared/types.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const marked = (re: RegExp, text: string) => [...text.matchAll(re)].map((m) => m[0]);

describe('mentionPattern()', () => {
  it('marks @Names and #Teams, longest names first', () => {
    const re = mentionPattern(['Ana', 'everyone'], ['Design', 'Design Ops']);
    expect(marked(re, '@Ana ask #Design Ops, then #design')).toEqual(['@Ana', '#Design Ops', '#design']);
  });
  it('leaves links, longer words and headings alone', () => {
    const re = mentionPattern(['Ana'], ['Design']);
    expect(marked(re, 'see x.com/a#Design, a#Design, #Designers and # Design')).toEqual([]);
  });
  it('works with no other teams', () => {
    expect(marked(mentionPattern(['Ana'], []), '@Ana and #Design')).toEqual(['@Ana']);
  });
});

describe('senderName()', () => {
  const msg = (m: Partial<TeamMessage>): TeamMessage => ({ id: 'm', ts: 0, from: 'user', text: '', mentions: [], ...m });
  it('names another team, you, the Brain and agents', () => {
    expect(senderName(msg({ from: 'team:t1', relay: { teamId: 't1', teamName: 'Design', by: 'a1', byName: 'Ana' } }), () => 'x')).toBe('#Design');
    expect(senderName(msg({ from: 'user' }), () => 'x')).toBe('You');
    expect(senderName(msg({ from: 'brain' }), () => 'x')).toBe('Brain');
    expect(senderName(msg({ from: 'a1' }), (id) => (id === 'a1' ? 'Ana' : undefined))).toBe('Ana');
  });
});

describe('a team chat with other teams', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it("draws another team's message in its colour, marks #Teams, and suggests teams after #", async () => {
    state.data = { runs: [], approvals: [], agents: [{ id: 'ana', name: 'Ana', emoji: '🎨', color: '#fff' }] } as unknown as AppState;
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', async (url: string) =>
      url === '/api/teams/t2/chat'
        ? json({
            team: { id: 't2', name: 'Social', members: ['ana'], steps: [] },
            others: [{ id: 't1', name: 'Design', color: '#ff00aa', mark: 'D', description: 'Logos and banners' }],
            messages: [
              { id: 'm1', ts: 1, from: 'ana', text: 'Ask #Design for a banner', mentions: [] },
              { id: 'm2', ts: 2, from: 'team:t1', text: 'Here it is', mentions: [], relay: { teamId: 't1', teamName: 'Design', by: 'x', byName: 'Max', answers: true } },
            ],
            working: [],
            queued: [],
          })
        : json({}),
    );
    const el = document.createElement('div');
    document.body.append(el);
    const chat = renderTeamChat(el, 't2');
    await act(() => new Promise((r) => setTimeout(r, 40)));
    expect(el.querySelector('.tc-mention.tc-team')!.textContent).toBe('#Design');
    const relay = el.querySelector<HTMLElement>('.tc-msg.tc-relay')!;
    expect(relay.style.getPropertyValue('--team-color')).toBe('#ff00aa');
    expect(relay.querySelector('.tc-team-av')!.textContent).toBe('D');
    expect(relay.querySelector('b')!.textContent).toBe('#Design');
    expect(relay.querySelector('.tc-relay-tag')!.textContent).toBe('answered · Max');
    // # suggests the other teams; picking one writes #Name
    const box = el.querySelector('textarea')!;
    box.value = '#De';
    box.setSelectionRange(3, 3);
    await act(async () => box.dispatchEvent(new Event('input', { bubbles: true })));
    const opt = el.querySelector<HTMLButtonElement>('.tc-sopt')!;
    expect(opt.textContent).toContain('#Design');
    expect(opt.textContent).toContain('Logos and banners');
    await act(async () => opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(box.value).toBe('#Design ');
    act(() => chat.destroy());
  });
});
