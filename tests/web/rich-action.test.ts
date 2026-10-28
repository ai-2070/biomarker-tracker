// What a button in a Rich answer sends back: its label, the form, and what the button carries.
import { describe, expect, it } from 'vitest';
import { BuiltinActionType } from '@openuidev/react-lang';
import { actionMessage } from '../../web/chat/rich.tsx';

describe('actionMessage()', () => {
  it('two buttons with the same label send different messages by what they carry', () => {
    const a = actionMessage({ type: BuiltinActionType.ContinueConversation, params: { context: { plan: 'A' } }, humanFriendlyMessage: 'Pick this' });
    const b = actionMessage({ type: BuiltinActionType.ContinueConversation, params: { context: { plan: 'B' } }, humanFriendlyMessage: 'Pick this' });
    expect(a).toBe('Pick this\n\n(context: {"plan":"A"})');
    expect(a).not.toBe(b);
    expect(actionMessage({ type: BuiltinActionType.ContinueConversation, params: { context: 'row 3' }, humanFriendlyMessage: 'Open' })).toBe('Open\n\n(context: row 3)');
  });

  it('the form and no context as before; other actions send nothing', () => {
    expect(actionMessage({ type: BuiltinActionType.ContinueConversation, params: {}, humanFriendlyMessage: 'Go', formState: { name: 'x' } })).toBe('Go\n\n(form: {"name":"x"})');
    expect(actionMessage({ type: BuiltinActionType.ContinueConversation, params: {}, humanFriendlyMessage: '' })).toBe('Continue');
    expect(actionMessage({ type: BuiltinActionType.OpenUrl, params: { url: 'https://x' }, humanFriendlyMessage: 'Open' })).toBeNull();
  });
});
