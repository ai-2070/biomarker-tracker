// @ in an agent chat: which agents fit what is typed, and the picked name going into the text.
import { describe, expect, it } from 'vitest';
import { agentMentions, insertMention } from '../../web/chat/mention.ts';

const AGENTS = [
  { id: 'me', name: 'Renderer' },
  { id: 'a', name: 'Video Editor' },
  { id: 'b', name: 'Trend Scout' },
  { id: 'c', name: 'Editor' },
  { id: 'd', name: 'Scout' },
];
const names = (text: string, caret = text.length) => agentMentions(text, caret, AGENTS, 'me')?.options.map((a) => a.name) ?? null;

describe('agentMentions()', () => {
  it('offers everyone but the agent you talk to after a bare @', () => {
    expect(names('@')).toEqual(['Video Editor', 'Trend Scout', 'Editor', 'Scout']);
    expect(names('hi @')).toEqual(['Video Editor', 'Trend Scout', 'Editor', 'Scout']);
  });

  it('puts names that start with it first, then a word that does, then the rest', () => {
    expect(names('@ed')).toEqual(['Editor', 'Video Editor']);
    expect(names('@sc')).toEqual(['Scout', 'Trend Scout']);
    expect(names('@ou')).toEqual(['Trend Scout', 'Scout']);
    expect(names('@trend s')).toEqual(['Trend Scout']);
  });

  it('nothing when the caret is not in an @…, or nobody fits', () => {
    expect(names('no mention')).toBeNull();
    expect(names('mail me@ed')).toBeNull();
    expect(names('@zzz')).toBeNull();
    expect(names('@Rendere')).toBeNull();
    expect(names('@ed then more', 3)).toEqual(['Editor', 'Video Editor']);
    expect(agentMentions('hi @ed', 6, AGENTS, 'me')!.start).toBe(3);
  });
});

describe('insertMention()', () => {
  it('replaces the @… with the name and a space, caret after it', () => {
    expect(insertMention('ask @tr', 4, 7, 'Trend Scout')).toEqual({ text: 'ask @Trend Scout ', caret: 17 });
  });

  it('keeps what comes after, and takes the rest of a half-typed word', () => {
    expect(insertMention('ask @tr about it', 4, 7, 'Trend Scout')).toEqual({ text: 'ask @Trend Scout about it', caret: 17 });
    expect(insertMention('@Tre', 0, 2, 'Trend Scout')).toEqual({ text: '@Trend Scout ', caret: 13 });
  });

  it('keeps punctuation that follows, without a space before it', () => {
    expect(insertMention('ask @t, then go', 4, 6, 'Trend Scout')).toEqual({ text: 'ask @Trend Scout, then go', caret: 16 });
    expect(insertMention('hi @ed.', 3, 6, 'Editor')).toEqual({ text: 'hi @Editor.', caret: 10 });
  });

  it('with the caret partway through a name, takes the rest of it instead of leaving words behind', () => {
    expect(insertMention('@Tre and Scout hi', 0, 4, 'Trend Scout')).toEqual({ text: '@Trend Scout and Scout hi', caret: 13 });
    expect(insertMention('@Trend Scout hi', 0, 4, 'Trend Scout')).toEqual({ text: '@Trend Scout hi', caret: 13 });
    expect(insertMention('ask @Trend Scout, now', 4, 13, 'Trend Scout')).toEqual({ text: 'ask @Trend Scout, now', caret: 16 });
    expect(insertMention('@editorial', 0, 3, 'Editor')).toEqual({ text: '@Editor ', caret: 8 });
  });
});
