// How a chat message's parts look (Vercel AI SDK UI message parts), in every chat view: text as
// markdown (or a Rich answer as live components), tool calls you can open (input, result, images),
// file previews with Show in Explorer / Finder, and our own rows (COMPACTED marks, errors, notes).
// Sizes: full (the chat page), compact (the floating window), mini (the Station panel, team turns).
import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { DynamicToolUIPart } from 'ai';
import { md, lightbox } from '../core.ts';
import { compactionMark } from '../compactmark.ts';
import { filePreviews } from '../filepreview.ts';
import { findFileMentions } from '../mentions.ts';
import { readOutput, readUser } from './messages.ts';
import { useAppState } from '../ui/react.tsx';
import { QuestionCard, questionFor } from '../questions.tsx';
import type { QuestionOwner } from '../questions.tsx';
import type { ChatMessage, ChatPart } from './messages.ts';
import type { CompactionItem } from '../../shared/types.ts';

const RichAnswer = lazy(() => import('./rich.tsx'));

// A message's look in the floating window (compact) and the Station panel / team turns (mini); the chat
// page's messages are the shared msg pieces. A message drawn again (scrolled back to) doesn't rise in again.
const AC = 'max-w-[88%] rounded-[12px] px-3 py-2.25 text-[14px] leading-[1.5] animate-[rise-in_0.2s_ease-out] in-[.again]:animate-none';
const AC_AGENT = `${AC} font-chat self-start border border-line bg-panel`;
const AC_USER = `${AC} font-chat self-end border border-[color-mix(in_srgb,var(--color-accent)_25%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-accent)_14%,var(--color-panel-2))] whitespace-pre-wrap`;
const AC_ERR = `${AC} self-stretch border border-[color-mix(in_srgb,var(--color-red)_40%,var(--color-line))] text-red`;
// (Markdown: no space above the first block or below the last)
const AC_TEXT = '[&>:first-child]:mt-0 [&>:last-child]:mb-0';
const ST = 'st-msg text-[13.5px] leading-[1.5] wrap-anywhere';
const ST_ASSISTANT = `${ST} assistant font-chat [&_p]:mb-1.5 [&_pre]:max-h-45`;
const ST_USER = `${ST} user font-chat self-end max-w-[90%] border border-line-2 bg-panel-2 px-2.5 py-1.5 whitespace-pre-wrap`;
const ST_ERR = `${ST} text-red`;
const ST_CMP = 'st-msg cmp self-stretch border-t border-dashed border-accent/35 pt-1 text-center font-mono text-[10.5px] leading-[normal] tracking-[0.08em] text-accent-dim wrap-anywhere';

export type Variant = 'full' | 'compact' | 'mini';

/** A piece of the page built with plain DOM (approval cards, the COMPACTED mark, file previews…). */
export const Dom = memo(
  function Dom({ make, deps, className }: { make: () => Node | null; deps: readonly unknown[]; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const node = make();
      ref.current?.replaceChildren(...(node ? [node] : []));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return <div ref={ref} className={className} style={className ? undefined : { display: 'contents' }} />;
  },
  (a, b) => a.className === b.className && a.deps.length === b.deps.length && a.deps.every((d, i) => Object.is(d, b.deps[i])),
);

export const Markdown = memo(function Markdown({ text, className }: { text: string; className: string }) {
  // (md() is marked + DOMPurify, as everywhere in the dashboard)
  const html = useMemo(() => md(text).innerHTML, [text]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
});

export function Previews({ paths, small }: { paths: readonly string[]; small?: boolean }) {
  const key = paths.join('\n');
  if (!paths.length) return null;
  return <Dom make={() => filePreviews(paths, { compact: small })} deps={[key, small]} />;
}

/** OpenUI Lang (a Rich answer) rather than markdown: it starts with a statement ("root = Card(…)", or
 *  another name = Component(…)) and has a root. Markdown that shows an example after some prose is not. */
export const isRichCode = (text: string): boolean => /^\s*[A-Za-z_]\w*\s*=\s*[A-Z]\w*\(/.test(text) && /^\s*root\s*=\s*[A-Z]\w*\(/m.test(text);

/** An image that opens big: a button to the keyboard (Enter / Space) and to screen readers. */
function ZoomImg({ src, label }: { src: string; label: string }) {
  return (
    <img
      src={src}
      alt={label}
      role="button"
      tabIndex={0}
      aria-label={`Show ${label} bigger`}
      onClick={() => lightbox(src)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        lightbox(src);
      }}
    />
  );
}

const brief = (input: unknown): string =>
  input && typeof input === 'object' ? Object.values(input as Record<string, unknown>).filter((v) => typeof v === 'string').join(' · ').slice(0, 140) : typeof input === 'string' ? input.slice(0, 140) : '';

// the tool calls you opened: a long chat draws a message again when you scroll back to it, still open
const openTools = new Set<string>();

/** A tool call: its name and what it was about, opening to its input and result (and images below). */
export function ToolCard({ part, variant, busy, owner }: { part: DynamicToolUIPart; variant: Variant; busy: boolean; owner?: QuestionOwner | null }) {
  const [open, setOpen] = useState(() => openTools.has(part.toolCallId));
  const done = part.state === 'output-available' || part.state === 'output-error';
  const failed = part.state === 'output-error';
  const out = part.state === 'output-available' ? readOutput(part.output) : null;
  const images = out?.images || [];
  const running = !done && busy;
  const mark = running ? <span className="dot busy" /> : failed ? <span className="text-red">✕</span> : done ? <span className="text-accent">✓</span> : <span className="text-faint">·</span>;
  let input = '';
  try {
    input = typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}, null, 2);
  } catch {
    input = String(part.input);
  }
  const small = variant !== 'full';
  // ask_user while the agent waits: answer right here (it's in the Outbox too)
  const asked = useAppState()?.questions;
  const question = part.toolName === 'ask_user' && !done ? questionFor(asked, part.input, owner) : null;
  return (
    <div className={small ? 'flex flex-col gap-1' : 'flex flex-col gap-1.5'}>
      {question ? <QuestionCard q={question} place="chat" /> : null}
      <details
        className={`tool${failed ? ' error' : ''}${small ? ' small' : ''}`}
        open={open}
        onToggle={(e) => {
          const now = e.currentTarget.open;
          if (now) openTools.add(part.toolCallId);
          else openTools.delete(part.toolCallId);
          setOpen(now);
        }}
      >
        <summary>
          {mark}
          <span className="tname">{part.toolName}</span>
          <span className="targ">{brief(part.input)}</span>
        </summary>
        <div className="tbody">
          <div className="label">Input</div>
          <pre>{input}</pre>
          {done ? (
            <>
              <div className="label">{failed ? 'Error' : 'Result'}</div>
              <pre>{failed ? part.errorText : out?.text || '(empty)'}</pre>
            </>
          ) : (
            <div className="hint">{running ? 'Running…' : 'Did not finish.'}</div>
          )}
        </div>
      </details>
      {images.length ? (
        <div className={small ? 'flex w-full gap-1 [&_img]:size-20 [&_img]:border [&_img]:border-line-2 [&_img]:object-cover' : 'tool-images'}>
          {images.slice(0, small ? 6 : 24).map((src, i) => (
            <ZoomImg key={src} src={src} label={`${part.toolName} image ${i + 1}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TextPart({ text, variant, streaming, dim, onSend }: { text: string; variant: Variant; streaming: boolean; dim: boolean; onSend: (t: string) => void }) {
  const rich = !!text && isRichCode(text);
  const mentions = useMemo(() => (rich ? [] : findFileMentions(text)), [text, rich]);
  const cls = dim ? ' compacted' : '';
  if (!text) return null;
  return (
    <>
      {rich ? (
        <div className={`${variant === 'compact' ? AC_AGENT : variant === 'mini' ? ST_ASSISTANT : 'msg assistant'} rich${cls}`}>
          <Suspense fallback={<pre className="hint">{text}</pre>}>
            <RichAnswer code={text} streaming={streaming} onSend={onSend} />
          </Suspense>
        </div>
      ) : variant === 'compact' ? (
        <div className={`${AC_AGENT}${cls}`}>
          <Markdown text={text} className={AC_TEXT} />
        </div>
      ) : variant === 'mini' ? (
        <Markdown text={text.length > 4000 ? `${text.slice(0, 4000)}…` : text} className={`${ST_ASSISTANT}${cls}`} />
      ) : (
        <Markdown text={text} className={`msg assistant${streaming ? ' cursor' : ''}${cls}`} />
      )}
      {mentions.length ? <Previews paths={mentions} small={variant !== 'full'} /> : null}
    </>
  );
}

export interface MessageViewProps {
  m: ChatMessage;
  variant: Variant;
  /** a run is going in this chat */
  busy: boolean;
  /** this message is the one streaming in */
  streaming: boolean;
  /** shown dimmed (only remembered as the compacted history) */
  dim: boolean;
  /** what a Rich answer's buttons send */
  onSend: (text: string) => void;
  /** for the COMPACTED mark's edit */
  chatPath?: string;
  latestCompaction?: string | null;
  onCompactionSaved?: () => void;
  /** whose chat this is (an ask_user card shows that agent's question) */
  owner?: QuestionOwner | null;
}

export function MessageView({ m, variant, busy, streaming, dim, onSend, chatPath, latestCompaction, onCompactionSaved, owner }: MessageViewProps) {
  if (m.role === 'user') {
    const { text, attachments } = readUser(m);
    const paths = [...attachments, ...findFileMentions(text)];
    const cls = variant === 'compact' ? AC_USER : variant === 'mini' ? ST_USER : 'msg user';
    return (
      <>
        <div className={`${cls}${dim ? ' compacted' : ''}`}>
          {m.metadata?.from && variant === 'full' ? <div className="from">from {m.metadata.from}</div> : null}
          {text ? variant === 'compact' ? <div>{text}</div> : text : null}
        </div>
        {paths.length ? <Previews paths={paths} small={variant !== 'full'} /> : null}
      </>
    );
  }
  const lastText = m.parts.findLastIndex((p) => p.type === 'text');
  return (
    <>
      {m.parts.map((p: ChatPart, i) => {
        const key = `${m.id}:${i}`;
        if (p.type === 'text') return <TextPart key={key} text={p.text} variant={variant} streaming={streaming && i === lastText && p.state === 'streaming'} dim={dim} onSend={onSend} />;
        if (p.type === 'dynamic-tool') return <ToolCard key={key} part={p} variant={variant} busy={busy} owner={owner} />;
        if (p.type === 'data-compaction') {
          const it = p.data as CompactionItem;
          if (variant === 'mini') return <div key={key} className={ST_CMP} title="The agent’s memory of the messages above was compacted. Open the full chat to see or edit it.">— COMPACTED —</div>;
          return <Dom key={key} make={() => compactionMark(it, { chatPath, latest: latestCompaction === it.id, busy, compact: variant === 'compact', onSaved: onCompactionSaved })} deps={[it.id, it.text, latestCompaction, busy, chatPath]} />;
        }
        if (p.type === 'data-error') return <div key={key} className={variant === 'full' ? 'msg error' : variant === 'compact' ? AC_ERR : ST_ERR}>{(p.data as { text: string }).text}</div>;
        if (p.type === 'data-meta') return variant === 'full' ? <div key={key} className="msg meta">{(p.data as { text: string }).text}</div> : null;
        return null;
      })}
    </>
  );
}
