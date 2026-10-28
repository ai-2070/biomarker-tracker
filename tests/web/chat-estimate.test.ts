// A message's guessed height before it draws (web/chat/estimate.ts): close guesses let a long chat's
// jump to the top land on the first message.
import { describe, expect, it } from 'vitest';
import { charsPerLine, estimateHeight, messageSig, wrappedLines } from '../../web/chat/estimate.ts';
import { rememberHeight, rememberedHeight } from '../../web/chat/window.tsx';
import type { ChatMessage } from '../../web/chat/messages.ts';

const msg = (role: 'user' | 'assistant', parts: ChatMessage['parts']): ChatMessage => ({ id: 'm', role, parts }) as ChatMessage;
const text = (t: string) => ({ type: 'text' as const, text: t });

describe('wrappedLines()', () => {
  it('wraps each paragraph on its own and skips blank lines', () => {
    expect(wrappedLines('a\n\nb', 100)).toBe(2);
    expect(wrappedLines('x'.repeat(250), 100)).toBe(3);
    expect(wrappedLines('', 100)).toBe(0);
  });
});

describe('estimateHeight()', () => {
  it('fits fewer characters on a line in a narrow list', () => {
    expect(charsPerLine(900)).toBe(120);
    expect(charsPerLine(400)).toBe(49);
    expect(charsPerLine(50)).toBe(24);
  });

  // measured in the app: an answer of 4 short lines was 129 px wide, one of 14 lines 401 px narrow
  it('comes close to what the app measured', () => {
    const answer = msg('assistant', [text(`Answer 1\n\n${'word '.repeat(14).trim()}\n\n- point one\n- point two`)]);
    expect(Math.abs(estimateHeight(answer, 899) - 129)).toBeLessThan(20);
    const long = msg('assistant', [text(`Answer 9\n\n${'word '.repeat(100).trim()}\n\n- point one\n- point two`)]);
    expect(Math.abs(estimateHeight(long, 399) - 401)).toBeLessThan(40);
    const question = msg('user', [text(`Question 3: ${'word '.repeat(20).trim()}`)]);
    expect(Math.abs(estimateHeight(question, 899) - 69)).toBeLessThan(25);
  });

  it('adds room for tool calls and attached files, and is smaller in the compact window', () => {
    const plain = msg('assistant', [text('Done.')]);
    const withTool = msg('assistant', [text('Done.'), { type: 'dynamic-tool', toolName: 'read_file', toolCallId: 't', state: 'output-available', input: {}, output: {} } as ChatMessage['parts'][number]]);
    const withFile = msg('user', [text('Look'), { type: 'file', mediaType: 'image/png', url: '/api/file?path=a.png' }]);
    expect(estimateHeight(withTool, 900) - estimateHeight(plain, 900)).toBe(44);
    expect(estimateHeight(withFile, 900)).toBeGreaterThan(250);
    expect(estimateHeight(plain, 900, true)).toBeLessThan(estimateHeight(plain, 900));
  });
});

describe('remembered heights', () => {
  it('are kept per message content, so the same id in another chat or after a compaction is guessed again', () => {
    const long = msg('assistant', [text('word '.repeat(400))]);
    const short = msg('assistant', [text('ok')]);
    expect(messageSig(long)).not.toBe(messageSig(short));
    expect(messageSig(short)).toBe(messageSig(msg('assistant', [text('no')])));
    rememberHeight(`a1/chatA/m-10/${messageSig(long)}`, 800, 900);
    expect(rememberedHeight(`a1/chatA/m-10/${messageSig(long)}`, 810)).toBe(900);
    // (another chat, or the same chat with other text at that place)
    expect(rememberedHeight(`a1/chatB/m-10/${messageSig(short)}`, 800)).toBeUndefined();
    expect(rememberedHeight(`a1/chatA/m-10/${messageSig(short)}`, 800)).toBeUndefined();
    // (a much narrower list: measured again)
    expect(rememberedHeight(`a1/chatA/m-10/${messageSig(long)}`, 400)).toBeUndefined();
  });
});
