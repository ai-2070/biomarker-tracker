// The Outbox: questions agents asked you, and posts, comments and DMs they drafted, waiting for you to
// answer, or to approve, edit, discuss or reject.
// A page of its own (the left menu) and a tab in Settings > Connections.
import { useCallback, useEffect, useRef, useState } from 'react';
import { GET, POST, PUT, DEL, attempt, toast, ago, refreshSoon } from '../core.ts';
import { fetchFile } from '../client/http.ts';
import { fileUrl } from '../client/connection.ts';
import { reactPage, useAppState, useServerEvents } from '../ui/react.tsx';
import { QuestionCard } from '../questions.tsx';
import type { AgentQuestion, OutboxPost } from '../../shared/types.ts';

/** X's limit for one post. */
const LIMIT = 280;
/** Characters as X counts them (an emoji is one). */
export const chars = (text: string): number => [...text].length;

/** Puts an image on the clipboard (as a PNG, which is what pasting into a post accepts). */
async function copyImage(url: string): Promise<void> {
  try {
    let blob = await (await fetchFile(url)).blob();
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext('2d')!.drawImage(bmp, 0, 0);
      blob = await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('no image'))), 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied');
  } catch {
    toast("Couldn't copy the image here. Use Save instead.", 'error');
  }
}

export function Outbox() {
  const data = useAppState();
  const [list, setList] = useState<OutboxPost[] | null>(null);
  const reload = useCallback(() => GET<OutboxPost[]>('/outbox').then(setList), []);
  useEffect(() => void reload().catch(() => setList([])), [reload]);
  useServerEvents((ev) => (ev.type === 'outbox' || ev.type === 'project') && void reload().catch(() => {}));
  if (!list || !data) return null;
  const pending = list.filter((p) => ['pending', 'failed', 'posting'].includes(p.status));
  const done = list.filter((p) => p.status === 'posted' || p.status === 'rejected' || p.status === 'returned');
  const changed = () => (void reload(), refreshSoon(0));
  return (
    <>
      <Questions />
      {data.accounts.x.length ? <Compose accounts={data.accounts.x.map((a) => a.username)} added={() => void reload()} /> : null}
      <h2 className="section">{`Waiting for you (${pending.length})`}</h2>
      {pending.length ? (
        <div className="flex flex-col gap-2.5">
          {pending.map((p) => <PostCard key={p.id} p={p} changed={changed} />)}
        </div>
      ) : (
        <div className="empty box">No posts waiting. Agents with the Social tools put their drafts here.</div>
      )}
      {done.length ? (
        <>
          <h2 className="section">History</h2>
          <div className="flex flex-col gap-2.5">
            {done.slice(0, 40).map((p) => <PostCard key={p.id} p={p} changed={changed} />)}
          </div>
        </>
      ) : null}
    </>
  );
}

/** What agents asked you (ask_user): the waiting ones first, then the last ones you answered. */
function Questions() {
  const [list, setList] = useState<AgentQuestion[] | null>(null);
  const reload = useCallback(() => GET<AgentQuestion[]>('/questions').then(setList), []);
  useEffect(() => void reload().catch(() => setList([])), [reload]);
  useServerEvents((ev) => (ev.type === 'questions' || ev.type === 'project') && void reload().catch(() => {}));
  if (!list?.length) return null;
  const waiting = list.filter((q) => q.status === 'waiting').reverse();
  const done = list.filter((q) => q.status !== 'waiting').slice(0, 20);
  const changed = () => void reload().catch(() => {});
  return (
    <>
      <h2 className="section">{`Questions from agents (${waiting.length})`}</h2>
      {waiting.length ? (
        <div className="flex flex-col gap-2.5">
          {waiting.map((q) => <QuestionCard key={q.id} q={q} changed={changed} />)}
        </div>
      ) : (
        <div className="empty box">No questions waiting. When an agent needs you to choose or is stuck, it asks here.</div>
      )}
      {done.length ? (
        <details className="mt-3.5">
          <summary className="hint">{`Answered and closed (${done.length})`}</summary>
          <div className="flex flex-col gap-2.5 mt-3.5">
            {done.map((q) => <QuestionCard key={q.id} q={q} changed={changed} />)}
          </div>
        </details>
      ) : null}
      <div className="mt-7" />
    </>
  );
}

function Compose({ accounts, added }: { accounts: string[]; added: () => void }) {
  const [text, setText] = useState('');
  const [account, setAccount] = useState(accounts[0]);
  const save = async () => {
    if (await attempt(() => POST('/outbox', { platform: 'x', account, text }), 'Added to the Outbox')) {
      setText('');
      added();
    }
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>New post</h2>
      </div>
      <textarea rows={3} aria-label="New post" placeholder="Write a post yourself…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
        <select aria-label="Post as" value={account} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a} value={a}>{`@${a}`}</option>
          ))}
        </select>
        <span className="hint flex-1 min-w-0" />
        <button className="btn ghost small" onClick={() => void save()}>Save to Outbox</button>
      </div>
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  pending: ['warn', 'waiting'],
  failed: ['bad', 'failed'],
  posting: ['info', 'posting…'],
  posted: ['ok', 'posted'],
  rejected: ['', 'rejected'],
  returned: ['info', 'sent back'],
};

function PostCard({ p, changed }: { p: OutboxPost; changed: () => void }) {
  const editable = p.status === 'pending' || p.status === 'failed';
  const serverTitle = p.platform === 'reddit' && p.reddit?.kind === 'post' ? p.reddit.title || '' : null;
  const [parts, setPartsNow] = useState(p.parts);
  // images that go with the first part; an ✕ on a thumbnail takes it off before approving
  const [images, setImagesNow] = useState(p.images || []);
  const [title, setTitleNow] = useState(serverTitle);
  // changed here and not saved yet: until then, a newer version from the server (saved in another
  // tab, a thread partly posted) replaces what the card shows, so Approve never sends an old copy
  const edited = useRef(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    edited.current = true;
    set(v);
  };
  const setParts = touch(setPartsNow);
  const setImages = touch(setImagesNow);
  const setTitle = touch(setTitleNow);
  const fromServer = JSON.stringify([p.parts, p.images || [], serverTitle]);
  useEffect(() => {
    if (edited.current) return;
    setPartsNow(p.parts);
    setImagesNow(p.images || []);
    setTitleNow(serverTitle);
    // (fromServer stands for all three)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromServer]);
  const [discussing, setDiscussing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const edits = () => ({ parts, ...(p.images ? { images } : {}), ...(title !== null ? { title } : {}) });

  const approve = async () => {
    setBusy(true);
    const r = await attempt(() => POST<OutboxPost>(`/outbox/${p.id}/approve`, edits()));
    if (r?.status === 'posted') toast('Posted ✓');
    else if (r?.status === 'failed') toast(r.error as string, 'error', 8000);
    setBusy(false);
    changed();
  };
  const discuss = async () => {
    setBusy(true);
    const r = await attempt(() => POST<OutboxPost>(`/outbox/${p.id}/discuss`, { text: note }), `Sent back to ${p.teamName || 'the team'}`);
    setBusy(false);
    if (r) changed();
  };
  const [tone, label] = STATUS[p.status] || ['', p.status];
  const link = p.platform === 'reddit' ? 'View on Reddit' : p.platform === 'x_dm' ? 'Open messages' : 'View on X';
  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={`pill${tone ? ` ${tone}` : ''}`}>{label}</span>
        <b>{p.accountLabel}</b>
        <span className="hint">{`by ${p.agentName || 'you'}${p.teamName ? ` · team ${p.teamName}` : ''} · ${ago(p.createdAt)}`}</span>
        {p.parts.length > 1 ? <span className="pill info">{`thread of ${p.parts.length}`}</span> : null}
        {p.url ? <a className="btn tiny ghost ml-auto" href={p.url} target="_blank" rel="noopener">{link}</a> : null}
      </div>
      {p.platform === 'reddit' ? <div className="hint mt-3.5">{p.reddit?.kind === 'comment' ? `Comment replying to ${p.reddit.parent}` : `Post in r/${p.reddit?.subreddit}${p.reddit?.link ? ` · link: ${p.reddit.link}` : ''}`}</div> : null}
      {title !== null ? (
        <div className="mt-3.5">
          <input aria-label="Title" placeholder="Title" value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
        </div>
      ) : null}
      {p.note ? <p className="hint mt-3.5">{p.note}</p> : null}
      {p.error ? <p className="text-red mt-3.5">{p.error as string}</p> : null}
      {p.status === 'returned' && p.reason ? <p className="hint mt-3.5">{`Sent back to the team: ${p.reason}`}</p> : null}
      {images.length ? (
        <div className="flex flex-wrap items-start gap-3 mt-3.5">
          {images.map((f) => {
            const url = fileUrl(f);
            const name = f.split(/[\\/]/).pop() || 'image';
            return (
              <div key={f} className="flex flex-col gap-1.5">
                <div className="relative">
                  <img className="max-h-30 max-w-45 rounded-[8px] block" src={url} alt={name} title={f} />
                  {editable ? (
                    <button className="btn tiny ghost absolute top-1 right-1" title="Take this image off the post" aria-label={`Take ${name} off the post`} onClick={() => setImages(images.filter((x) => x !== f))}>
                      ✕
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button className="btn ghost tiny" title="Copy the image, to paste it into a post yourself" onClick={() => void copyImage(url)}>Copy</button>
                  <a className="btn ghost tiny" href={url} download={name} title="Save the image file">Save</a>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {editable ? (
        <div className="flex flex-col gap-2.5 mt-3.5">
          {parts.map((t, i) => (
            <div key={i}>
              <textarea
                aria-label={parts.length > 1 ? `Part ${i + 1}` : 'Text'}
                rows={Math.min(6, Math.ceil(t.length / 70) + 1)}
                value={t}
                onChange={(e) => setParts(parts.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <div className="flex flex-wrap items-center gap-2.5 justify-between">
                <span className="hint">{parts.length > 1 ? `Part ${i + 1}` : ''}</span>
                <span className={chars(t) > LIMIT ? 'hint mono font-mono red' : 'hint mono font-mono'}>{`${chars(t)}/${LIMIT}`}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 mt-3.5">
          {p.parts.map((t, i) => (
            <div key={i} className="whitespace-pre-wrap">{t}</div>
          ))}
        </div>
      )}
      {editable ? (
        <>
          <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
            <button className="btn small" disabled={busy} onClick={() => void approve()}>{p.platform === 'x' ? 'Approve & post' : 'Approve & send'}</button>
            <button className="btn ghost small" onClick={() => void attempt(() => PUT(`/outbox/${p.id}`, edits()), 'Saved').then((r) => r && (edited.current = false))}>Save edits</button>
            <button className="btn ghost small" aria-expanded={discussing} title="Talk it over with the team that wrote it: your note goes into their chat and the draft is sent back" onClick={() => setDiscussing(!discussing)}>Discuss with team</button>
            <button className="btn danger small" onClick={() => void attempt(() => POST(`/outbox/${p.id}/reject`, {})).then(changed)}>Reject</button>
          </div>
          {/* what should change: goes to the team's chat as a message to the agent who wrote it, and the draft leaves the Outbox */}
          {discussing ? (
            <div className="flex flex-col gap-2.5 mt-3.5">
              <textarea rows={3} aria-label="What should change" placeholder={`What should change? This goes to ${p.agentName || 'the team'}${p.teamName ? ` in the ${p.teamName} chat` : ''}.`} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2.5">
                <button className="btn small" disabled={busy} onClick={() => void discuss()}>Send to team</button>
                <button className="btn ghost small" onClick={() => setDiscussing(false)}>Cancel</button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
          <button className="btn tiny ghost" onClick={() => void attempt(() => DEL(`/outbox/${p.id}`)).then(changed)}>Remove</button>
        </div>
      )}
    </div>
  );
}

export const title = () => 'Outbox';
export const { render, unmount } = reactPage(() => <Outbox />);
