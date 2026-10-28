// Artifacts: what the teams finished that isn't an outgoing post (a written result, a file, a folder),
// with a preview of each (images, video, audio, 3D models) and a search for when there are many.
import { useCallback, useEffect, useState } from 'react';
import { GET, DEL, attempt, md, copy, confirmBox } from '../core.ts';
import { filePreviews } from '../filepreview.ts';
import { fileUrl } from '../client/connection.ts';
import { DomNode, Icon, reactPage, useServerEvents } from '../ui/react.tsx';
import type { Artifact } from '../../shared/types.ts';

const when = (ts?: number) => (ts ? new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

/** Everything you can search an artifact by, in lower case. */
const haystack = (a: Artifact): string => [a.title, a.note, a.agentName, a.teamName, a.kind, a.path, (a.text || '').slice(0, 20_000)].filter(Boolean).join('\n').toLowerCase();

/** The artifacts that match every word typed (any order, any case). */
export function matching(list: readonly Artifact[], query: string): Artifact[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? list.filter((a) => {
    const hay = haystack(a);
    return words.every((w) => hay.includes(w));
  }) : [...list];
}

// kept while you move around the app, as before
let lastQuery = '';

function ArtifactsPage() {
  const [all, setAll] = useState<Artifact[] | null>(null);
  const [query, setQuery] = useState(lastQuery);
  const reload = useCallback(() => GET<Artifact[]>('/artifacts').then(setAll), []);
  useEffect(() => void reload().catch(() => setAll([])), [reload]);
  useServerEvents((ev) => (ev.type === 'artifacts' || ev.type === 'project') && void reload());

  const list = matching(all || [], query);
  const total = all?.length || 0;
  const remove = async (a: Artifact) => {
    if (!(await confirmBox(`Remove "${a.title}" from the list? The file or folder itself stays where it is.`, { ok: 'Remove', danger: true }))) return;
    await attempt(() => DEL(`/artifacts/${a.id}`));
    await reload();
  };
  return (
    <>
      <div className="art-search flex flex-wrap items-center gap-3 mb-3.5">
        <div className="flex-1 min-w-0">
          <input type="search" className="w-full" placeholder="Search by name, note, team, who made it, file name…" aria-label="Search artifacts" value={query} onChange={(e) => setQuery((lastQuery = e.target.value))} />
        </div>
        <span className="hint">{query.trim() ? `${list.length} of ${total}` : total ? `${total}` : ''}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {all === null ? null : list.length ? (
          list.map((a) => <ArtifactCard key={a.id} a={a} onRemove={() => void remove(a)} />)
        ) : (
          <div className="empty box">{total ? `Nothing matches "${query.trim()}".` : 'Nothing yet. When a team finishes a result that is not a post or email, an agent saves it here with save_artifact.'}</div>
        )}
      </div>
    </>
  );
}

function ArtifactCard({ a, onRemove }: { a: Artifact; onRemove: () => void }) {
  const kindIcon = a.kind === 'folder' ? 'folder' : a.kind === 'file' ? 'file' : 'file-text';
  const who = [a.agentName ? `by ${a.agentName}` : '', a.teamName ? `team ${a.teamName}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-2.5">
        <Icon name={kindIcon} />
        <b>{a.title}</b>
        <span className="pill">{a.kind}</span>
        <span className="flex-1 min-w-0" />
        <span className="hint" title={when(a.createdAt)}>{`done ${when(a.createdAt)}`}</span>
      </div>
      {who ? <div className="hint mt-3.5">{who}</div> : null}
      {a.note ? <p className="hint mt-3.5">{a.note}</p> : null}
      {a.path ? <div className="hint font-mono mt-3.5 break-all">{a.path}</div> : null}
      {/* the same preview the chats show: image, video, audio, a 3D model you can turn, or a card for other files and folders */}
      {a.path ? <DomNode className="mt-3.5" make={() => filePreviews([a.path!])} deps={[a.path]} /> : null}
      {a.kind === 'text' && a.text ? (
        <details className="mt-3.5">
          <summary>Show the result</summary>
          <DomNode make={() => md(a.text!)} deps={[a.text]} />
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
        {a.kind === 'file' && a.path ? <a className="btn ghost small" href={fileUrl(a.path)} target="_blank" rel="noopener">Open</a> : null}
        {a.path ? <button className="btn ghost small" onClick={() => copy(a.path!)}>Copy path</button> : null}
        {a.text ? <button className="btn ghost small" onClick={() => copy(a.text!)}>Copy text</button> : null}
        <span className="flex-1 min-w-0" />
        <button className="btn danger small" onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

export const title = () => 'Artifacts';
export const { render, unmount } = reactPage(() => <ArtifactsPage />);
