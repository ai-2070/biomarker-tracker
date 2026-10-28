// "Rich answers": an answer written in OpenUI Lang (an agent with Rich answers on) rendered as live
// components (cards, tables, charts, forms) with OpenUI's chat component library. Loaded only when an
// answer needs it: the library (charts, forms…) is big.
import { useCallback } from 'react';
import { BuiltinActionType, Renderer } from '@openuidev/react-lang';
import type { ActionEvent } from '@openuidev/react-lang';
// (from the package root, not its subpaths: the component library and the theme must be the same copy,
// or the components never see the theme — genui-lib and ThemeProvider/ each bundle their own)
import { ThemeProvider, createTheme, openuiChatLibrary } from '@openuidev/react-ui';

// OpenUI's stylesheet (copied next to the bundle by scripts/build-web.ts), linked once.
function linkStyles(): void {
  if (document.querySelector('link[data-openui]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/dist/openui.css';
  link.dataset.openui = '';
  document.head.append(link);
}

// The dashboard's look, as OpenUI theme tokens (its colors come from the page's own variables).
const dark = createTheme({
  background: 'var(--color-bg)',
  foreground: 'var(--color-panel)',
  popoverBackground: 'var(--color-panel-2)',
  textNeutralPrimary: 'var(--color-ink)',
  textNeutralSecondary: 'var(--color-dim)',
  textNeutralTertiary: 'var(--color-faint)',
  textAccentPrimary: 'var(--color-accent)',
  textNeutralLink: 'var(--color-accent)',
  interactiveAccentDefault: 'var(--color-accent)',
  interactiveAccentHover: 'var(--color-accent-hover)',
  interactiveAccentPressed: 'var(--color-accent-dim)',
  borderDefault: 'var(--color-line)',
  borderInteractive: 'var(--color-line-2)',
  borderAccent: 'var(--color-accent)',
  fontBody: 'inherit',
  fontHeading: 'inherit',
  fontLabel: 'inherit',
  fontCode: 'var(--font-mono)',
});

/** What an action on a rich answer sends back to the agent (as your next message). */
export function actionMessage(event: ActionEvent): string | null {
  if (event.type !== BuiltinActionType.ContinueConversation) return null;
  const form = event.formState && Object.keys(event.formState).length ? `\n\n(form: ${JSON.stringify(event.formState)})` : '';
  // (what the button carries: buttons with the same label tell apart by it)
  const context = event.params?.context;
  const about = context === undefined || context === null || context === '' ? '' : `\n\n(context: ${typeof context === 'string' ? context : JSON.stringify(context)})`;
  return `${event.humanFriendlyMessage || 'Continue'}${form}${about}`;
}

export default function RichAnswer({ code, streaming, onSend }: { code: string; streaming: boolean; onSend: (text: string) => void }) {
  linkStyles();
  const onAction = useCallback(
    (event: ActionEvent) => {
      if (event.type === BuiltinActionType.OpenUrl) {
        const url = event.params?.url;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
        return;
      }
      const text = actionMessage(event);
      if (text) onSend(text);
    },
    [onSend],
  );
  return (
    <ThemeProvider mode="dark" darkTheme={dark} cssSelector=".oc-rich">
      <div className="oc-rich text-[14px]">
        <Renderer response={code} library={openuiChatLibrary} isStreaming={streaming} onAction={onAction} />
      </div>
    </ThemeProvider>
  );
}
