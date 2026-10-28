// Versions of skills, agents, teams and MEMORY.md files: the History window (every kept version, what it changed,
// compared with the current one, and Restore) and Recently deleted (bring one back).
import { h, mount, GET, POST, attempt, modal, ago, confirmBox } from './core.ts';
import { icon } from './icons.ts';
import type { Child, ModalHandle } from './core.ts';
import type { DeletedItem, VersionDetail, VersionHistory, VersionKind } from '../shared/types.ts';

const KIND_NAME: Record<VersionKind, string> = { skill: 'skill', agent: 'agent', team: 'team', memory: 'MEMORY.md' };
const byName = (by: string) => (by === 'brain' ? 'the Brain' : by === 'agent' ? 'the agent' : 'you');
const when = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// ---------- a line diff (old → new) ----------
export type DiffLine = { op: ' ' | '-' | '+'; text: string };
/** Lines of a and b, marked kept, removed (only in a) or added (only in b). Plain list when too big to compare. */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x.length * y.length > 4_000_000) return [...x.map((text): DiffLine => ({ op: '-', text })), ...y.map((text): DiffLine => ({ op: '+', text }))];
  // longest common subsequence, from the end
  const n = x.length;
  const m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) out.push({ op: ' ', text: x[i++] }), j++;
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: x[i++] });
    else out.push({ op: '+', text: y[j++] });
  }
  while (i < n) out.push({ op: '-', text: x[i++] });
  while (j < m) out.push({ op: '+', text: y[j++] });
  return out;
}

// a version's text, in a box of its own
const TEXT_BOX = 'm-0 max-h-[58vh] overflow-auto rounded-ctl border border-line bg-bg px-3.5 py-3 font-mono text-[12.5px] leading-[1.55] font-normal whitespace-pre-wrap wrap-anywhere';
const LINE = { kept: '-mx-1.5 px-1.5 text-dim', del: '-mx-1.5 bg-red/12 px-1.5 text-red', add: '-mx-1.5 bg-accent/10 px-1.5 text-accent' };

function diffView(older: string, newer: string): HTMLElement {
  const lines = diffLines(older, newer);
  if (!lines.some((l) => l.op !== ' ')) return h('div', h('p.hint', 'Same as the current one.'), h('pre', { class: TEXT_BOX }, older));
  return h(
    'div',
    h('p.hint', h('span', { class: LINE.del }, '- only in this version'), '   ', h('span', { class: LINE.add }, '+ added since')),
    h('pre', { class: TEXT_BOX }, lines.map((l) => h('div', { class: l.op === '-' ? LINE.del : l.op === '+' ? LINE.add : LINE.kept }, `${l.op} ${l.text}`))),
  );
}

// ---------- History ----------
/** The History window of one skill, agent or team. onRestored runs after a version is put back. */
export async function openHistory(kind: VersionKind, id: string, { onRestored }: { onRestored?: () => void } = {}): Promise<void> {
  const hist = await attempt(() => GET<VersionHistory>(`/versions/${kind}/${encodeURIComponent(id)}`));
  if (!hist) return;
  let m: ModalHandle;
  let picked: VersionDetail | null = null;
  let compare = true;
  const listEl = h('div', { class: 'flex max-h-[62vh] flex-col gap-1 overflow-auto pr-1 max-[761px]:max-h-[30vh]' });
  const view = h('div', { class: 'flex min-w-0 flex-col gap-2.5' });

  const pick = async (vid: string) => {
    const d = await attempt(() => GET<VersionDetail>(`/versions/${kind}/${encodeURIComponent(id)}/${vid}`));
    if (!d) return;
    picked = d;
    draw();
  };
  const restore = async () => {
    if (!picked) return;
    const what = hist.current === null ? `Bring back the ${KIND_NAME[kind]} "${picked.name}" as it was on ${when(picked.at)}?` : `Put back the version from ${when(picked.at)}? The current one is kept in the history, so you can switch back.`;
    if (!(await confirmBox(what, { ok: hist.current === null ? 'Bring it back' : 'Restore' }))) return;
    if (!(await attempt(() => POST(`/versions/${kind}/${encodeURIComponent(id)}/${picked!.id}/restore`), 'Restored'))) return;
    m.close();
    onRestored?.();
  };

  // a version in the list; the picked one is lit
  const row = (on: boolean, title: Child, sub: Child, onclick?: () => void) =>
    h(
      'button',
      {
        class: `block w-full cursor-pointer rounded-ctl border px-2.75 py-2.25 text-left text-ink enabled:hover:border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-line))] disabled:cursor-default ${on ? 'border-accent bg-accent/8' : 'border-line bg-transparent'}`,
        onclick,
        disabled: !onclick,
      },
      h('div', { class: 'flex items-center gap-2 font-semibold' }, title),
      h('div.hint', { class: 'mt-0.5 wrap-anywhere' }, sub),
    );

  const draw = () => {
    mount(
      listEl,
      row(!picked, hist.current === null ? 'Deleted' : 'Current', hist.current === null ? 'not in use any more' : 'what it is now', picked ? () => ((picked = null), draw()) : undefined),
      hist.versions.length
        ? hist.versions.map((v) =>
            row(
              picked?.id === v.id,
              h('span', ago(v.at), h('span', { class: 'inline-flex items-center gap-0.75 text-[11.5px] font-normal text-dim' }, v.by === 'brain' ? icon('brain', 11) : v.by === 'agent' ? icon('bot', 11) : null, byName(v.by))),
              v.deleted ? 'its last version, before it was deleted' : v.changes.length ? `then changed: ${v.changes.join(', ')}` : v.note || 'then saved',
              () => pick(v.id),
            ),
          )
        : h('p.hint', { class: 'px-0.5 py-2' }, 'No earlier versions yet. Each change keeps the version from before it.'),
    );
    if (!picked) {
      mount(view, hist.current === null ? h('p.hint', 'Pick a version to see it and bring it back.') : h('pre', { class: TEXT_BOX }, hist.current));
    } else {
      const older = picked.text;
      mount(
        view,
        h(
          'div',
          { class: 'flex flex-wrap items-center gap-3' },
          h('div', { class: 'min-w-0 flex-1' }, h('b', `Version from ${when(picked.at)}`), h('div.hint', `Replaced by ${byName(picked.by)}${picked.deleted ? ' (deleted)' : ''}${picked.note ? ` · ${picked.note}` : ''}`)),
          hist.current !== null ? h('label', { class: 'flex flex-wrap items-center gap-2.5' }, h('input', { type: 'checkbox', checked: compare, onchange: (e: Event) => ((compare = (e.target as HTMLInputElement).checked), draw()) }), h('span', 'Compare with current')) : null,
        ),
        compare && hist.current !== null ? diffView(older, hist.current) : h('pre', { class: TEXT_BOX }, older),
      );
    }
    restoreBtn.disabled = !picked;
    restoreBtn.textContent = hist.current === null ? 'Bring back this version' : 'Restore this version';
  };

  const restoreBtn = h('button.btn', { onclick: restore, disabled: true }, 'Restore this version');
  m = modal({
    title: `History · ${hist.name}`,
    body: h('div', { class: 'grid min-h-[360px] grid-cols-[minmax(200px,260px)_1fr] gap-3.5 max-[761px]:grid-cols-[1fr]' }, listEl, view),
    foot: [h('span.hint', { class: 'min-w-0 flex-1' }, `${hist.versions.length} earlier version${hist.versions.length === 1 ? '' : 's'} kept`), h('button.btn.ghost', { onclick: () => m.close() }, 'Close'), restoreBtn],
  });
  m.el.classList.add('wide');
  draw();
}

/** A History button for a skill, agent, team or MEMORY.md. */
export function historyButton(kind: VersionKind, id: string, onRestored?: () => void, label = 'History'): HTMLButtonElement {
  return h('button.btn.ghost.small', { type: 'button', title: 'Earlier versions: compare and restore', onclick: () => openHistory(kind, id, { onRestored }) }, icon('history', 13), label);
}

// ---------- Recently deleted ----------
/** Deleted skills, agents or teams that can come back. */
export async function openDeleted(kinds: VersionKind[], { onRestored }: { onRestored?: () => void } = {}): Promise<void> {
  let m: ModalHandle;
  const box = h('div.list');
  const load = async () => {
    // a list that couldn't load says so (it isn't "nothing deleted")
    const lists = await Promise.allSettled(kinds.map((k) => GET<DeletedItem[]>(`/versions/${k}`)));
    const items = lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).sort((a, b) => b.at - a.at);
    const failed = lists.flatMap((r, i) => (r.status === 'rejected' ? [{ kind: kinds[i], error: (r.reason as Error)?.message || 'failed' }] : []));
    mount(
      box,
      failed.length
        ? h(
            'div.list-row',
            icon('triangle-alert', 14),
            h('div', { class: 'min-w-0 flex-1' }, h('div.title', `Couldn't load the deleted ${failed.map((f) => `${KIND_NAME[f.kind]}s`).join(' and ')}`), h('div.hint', failed.map((f) => f.error).join('; '))),
            h('button.btn.ghost.small', { onclick: () => load() }, icon('rotate-cw', 13), 'Retry'),
          )
        : null,
      items.length
        ? items.map((it) =>
            h(
              'div.list-row',
              h('div.skill-ico', icon(it.kind === 'skill' ? 'puzzle' : it.kind === 'team' ? 'users' : 'bot', 16)),
              h('div', { class: 'min-w-0 flex-1' }, h('div.title', it.name), h('div.hint', `${KIND_NAME[it.kind]} · deleted ${ago(it.at)} by ${byName(it.by)}`)),
              h('button.btn.ghost.small', { onclick: () => openHistory(it.kind, it.id, { onRestored: () => (load(), onRestored?.()) }) }, icon('history', 13), 'History'),
              h('button.btn.small', {
                onclick: async (e: MouseEvent) => {
                  // (the button, kept: the event forgets it once this awaits)
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.disabled = true;
                  if (await attempt(() => POST(`/versions/${it.kind}/${encodeURIComponent(it.id)}/undelete`), `Brought back ${it.name}`)) {
                    onRestored?.();
                    load();
                  } else btn.disabled = false;
                },
              }, icon('archive-restore', 13), 'Bring back'),
            ),
          )
        : failed.length
          ? null
          : h('p.empty', 'Nothing deleted.'),
    );
  };
  m = modal({
    title: 'Recently deleted',
    body: h('div', { class: 'flex flex-col gap-2.5' }, h('p.hint', kinds.includes('skill') ? 'Deleted skills come back with their extra files. Bring one back and give it to whoever should have it again.' : 'An agent comes back without its teams (add it back to them); a team comes back with the members that still exist.'), box),
    foot: [h('button.btn', { onclick: () => m.close() }, 'Done')],
  });
  await load();
}

export function deletedButton(kinds: VersionKind[], onRestored?: () => void): HTMLButtonElement {
  return h('button.btn.ghost.small', { type: 'button', onclick: () => openDeleted(kinds, { onRestored }) }, icon('archive-restore', 14), 'Recently deleted');
}
