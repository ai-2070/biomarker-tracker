// The Skills page's dialogs (plain DOM in Base UI dialogs): write or edit a skill, with the Brain's help
// in plain words; install from GitHub; import from Claude Code. Each takes the page's reload().
import { h, mount, GET, POST, PUT, attempt, modal, field, toast } from './core.ts';
import { icon } from './icons.ts';
import { historyButton } from './history.ts';
import { attachTray } from './attach.ts';
import type { ClaudeSkill, Skill, SkillInstallResult } from '../shared/types.ts';
import type { ModalHandle } from './core.ts';

/** The skill editor: new or existing, with the Brain writing or changing it from plain words. */
export async function openEditor(slug: string | null, reload: () => unknown): Promise<void> {
  const s = slug ? await GET<Skill>(`/skills/${slug}`).catch(() => null) : null;
  // (dimmed while the Brain writes them: lock() below)
  const BUSY = 'in-[.skill-ask.busy~label.field]:opacity-55 in-[.skill-ask.busy~label.field]:cursor-progress';
  const name = h('input', { class: BUSY, value: s?.name || '', placeholder: 'e.g. Brand voice, Email to clients, YouTube thumbnail checklist' });
  const desc = h('textarea', { class: BUSY, rows: 2, value: s?.description || '', placeholder: 'When should an agent use it? e.g. "Use when writing any post, email or reply for the NET brand."' });
  const body = h('textarea.code', { class: BUSY, rows: 16, value: s?.body?.trim() || '', placeholder: '# How to do it\n\n1. …\n2. …\n\n## Rules\n- …\n\n## Example\n…' });

  // Plain words: describe a new skill, or say what to change, and the Brain writes it into the fields
  // below. Nothing is saved until Save (and saving keeps the version from before, in History).
  const ask = h('textarea.skill-ask-input', {
    class: 'resize-y min-h-13',
    rows: 2,
    placeholder: slug
      ? 'What should change? e.g. "Add a section on thumbnails", "Make the rules shorter", "Write it for LinkedIn instead of X"'
      : 'Describe the skill in your own words. e.g. "How we write release notes: short bullets, user-facing changes first, no jargon, link the PR"',
  });
  const tray = attachTray();
  const askStatus = h('span.hint', { class: 'flex-1 min-w-0 wrap-anywhere' });
  let before: { name: string; description: string; body: string } | null = null;
  const undoBtn = h('button.btn.ghost.small.hidden', {
    type: 'button',
    title: 'Put back what the fields said before',
    onclick: () => {
      if (!before) return;
      [name.value, desc.value, body.value] = [before.name, before.description, before.body];
      before = null;
      undoBtn.classList.add('hidden');
      askStatus.textContent = 'Undone.';
    },
  }, icon('rotate-ccw', 13), 'Undo');
  const fields = () => ({ name: name.value, description: desc.value, body: body.value });
  let asking = false;
  const runAsk = async () => {
    if (asking) return;
    const text = ask.value.trim();
    if (!text && !tray.count()) return toast(slug ? 'Say what to change first.' : 'Describe the skill first.', 'warn');
    asking = askBtn.disabled = true;
    // the Brain answers with all three fields: typing in them meanwhile would be lost, so they wait (and so does Save)
    const lock = (on: boolean) => {
      for (const f of [name, desc, body]) f.readOnly = on;
      saveBtn.disabled = on;
      askBox.classList.toggle('busy', on);
    };
    lock(true);
    try {
      askStatus.textContent = tray.busy() ? 'Uploading files…' : '';
      const attachments = await tray.ready();
      if (!attachments) return void (askStatus.textContent = '');
      askStatus.textContent = slug || name.value || body.value ? 'The Brain is changing the skill…' : 'The Brain is writing the skill…';
      const now = fields();
      const draft = await attempt(() => POST<{ name: string; description: string; body: string; note: string }>('/assist/skill', { text, slug: slug || undefined, current: now, attachments }));
      if (!draft) return void (askStatus.textContent = '');
      // (locked, so they match; if they somehow don't, what you typed wins)
      const still = fields();
      if (still.name !== now.name || still.description !== now.description || still.body !== now.body) return void (askStatus.textContent = 'You changed the skill meanwhile, so the answer was not used. Ask again.');
      before = now;
      [name.value, desc.value, body.value] = [draft.name, draft.description, draft.body];
      undoBtn.classList.remove('hidden');
      askStatus.textContent = `${draft.note || 'Done.'} Look it over, then ${slug ? 'Save' : 'Add skill'}.`;
      ask.value = '';
    } finally {
      lock(false);
      asking = askBtn.disabled = false;
    }
  };
  const askBtn = h('button.btn.small', { type: 'button', onclick: () => void runAsk() }, icon('sparkles', 13), slug ? 'Change it' : 'Write it');
  ask.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void runAsk();
    }
  });
  const askBox = h(
    'div.skill-ask',
    { class: 'flex flex-col gap-2 py-3 px-3.5 border border-[color-mix(in_srgb,var(--color-accent)_30%,var(--color-line))] rounded-[12px] bg-[color-mix(in_srgb,var(--color-accent)_5%,var(--color-panel))]' },
    h('div.label', { class: 'flex items-center gap-1.5 text-accent' }, icon('sparkles', 13), slug ? ' Change it in plain words' : ' Write it in plain words'),
    ask,
    tray.el,
    h('div', { class: 'flex flex-wrap items-center gap-2' }, askBtn, tray.picker, undoBtn, askStatus),
    h('p.hint', { class: 'm-0' }, `${slug ? 'The Brain rewrites the fields below as you ask (what you typed there counts too).' : 'The Brain fills in the fields below.'} Drop examples or notes to learn from. Nothing is saved until you press ${slug ? 'Save' : 'Add skill'}. Ctrl+Enter sends.`),
  );
  let m: ModalHandle;
  const saveBtn: HTMLButtonElement = h('button.btn', { onclick: (e: MouseEvent) => save(e.currentTarget as HTMLButtonElement) }, slug ? 'Save' : 'Add skill');
  const save = async (btn: HTMLButtonElement) => {
    btn.disabled = true;
    const r = await attempt(() => (slug ? PUT(`/skills/${slug}`, { name: name.value, description: desc.value, body: body.value }) : POST('/skills', { name: name.value, description: desc.value, body: body.value })), slug ? 'Saved' : 'Skill added');
    btn.disabled = false;
    if (!r) return;
    m.close();
    reload();
  };
  m = modal({
    title: slug ? `Edit skill · ${s?.name || slug}` : 'New skill',
    body: h(
      'div',
      { class: 'flex flex-col gap-2.5' },
      askBox,
      field('Name', name),
      field('When to use it', desc, 'Agents decide from this line whether the skill fits, so be specific.'),
      field('Instructions', body, 'Markdown. Steps, rules, examples, what good output looks like. The agent reads this when it uses the skill.'),
      s?.files?.length ? h('div', h('div.label', `Files with this skill (${s.files.length})`), h('div', { class: 'flex flex-wrap gap-1.25 mt-1.5' }, s.files.map((f) => h('span.pill', f.path)))) : null,
      s ? h('p.hint', `Saved as data/skills/${s.slug}/SKILL.md, in the same format Claude Code uses. Every change keeps the version from before it (History).`) : null,
    ),
    foot: [
      slug ? historyButton('skill', slug, () => (m.close(), void reload(), void openEditor(slug, reload))) : null,
      h('span', { class: 'flex-1 min-w-0' }),
      h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'),
      saveBtn,
    ],
    // the files were only for the Brain to read: they go with the dialog
    onClose: () => tray.discard(),
  });
  tray.dropZone(m.el.querySelector<HTMLElement>('.modal')!, 'Drop examples or notes for the Brain');
  setTimeout(() => ask.focus(), 40);
}

/** Install skills from a GitHub link: a repo, a folder or a SKILL.md. */
export function openGitHub(reload: () => unknown): void {
  let m: ModalHandle;
  const url = h('input', { placeholder: 'https://github.com/owner/repo/tree/main/skills/my-skill' });
  const out = h('div', { class: 'flex flex-col gap-2.5' });
  const go = async (btn: HTMLButtonElement) => {
    if (!url.value.trim()) return url.focus();
    btn.disabled = true;
    btn.textContent = 'Installing…';
    const r = await attempt(() => POST<SkillInstallResult>('/skills/install', { url: url.value.trim() }));
    btn.disabled = false;
    btn.textContent = 'Install';
    if (!r) return;
    mount(
      out,
      r.installed.map((x) => h('div.list-row', icon('check', 14), h('div', { class: 'flex-1 min-w-0' }, h('b', x.name), h('span.hint', ` · ${x.updated ? 'updated' : 'installed'}, ${x.files} file${x.files === 1 ? '' : 's'}`)))),
      r.skipped.map((x) => h('div.list-row', icon('triangle-alert', 14), h('div.hint', { class: 'flex-1 min-w-0' }, x))),
      r.installed.length ? h('p.hint', 'Give them to an agent, a team or the project with "Give to…" on each card.') : null,
    );
    if (r.installed.length) reload();
  };
  url.addEventListener('keydown', (e) => e.key === 'Enter' && go(m.el.querySelector<HTMLButtonElement>('.gh-install')!));
  m = modal({
    title: 'Install skills from GitHub',
    body: h(
      'div',
      { class: 'flex flex-col gap-2.5' },
      field('GitHub link', url, 'A repo, a folder or a SKILL.md. Every folder with a SKILL.md at or under the link is installed, with its files (up to 20 skills). Installing from the same place again updates them; the old version stays in History.'),
      h('p.hint', 'Skills are instructions your agents follow: install them only from people you trust. Private repos work once you sign in with the GitHub CLI (gh auth login).'),
      out,
    ),
    foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Close'), h('button.btn.gh-install', { onclick: (e) => go(e.currentTarget) }, 'Install')],
  });
  setTimeout(() => url.focus(), 40);
}

/** Copy skills from ~/.claude/skills into the library. */
export function openImport(claude: ClaudeSkill[], reload: () => unknown): void {
  let m: ModalHandle;
  const rows = h('div.list');
  const drawRows = () =>
    mount(
      rows,
      claude.map((c) =>
        h(
          'div.list-row',
          h('div.skill-ico', icon('puzzle', 16)),
          h('div', { class: 'flex-1 min-w-0' }, h('div.title', c.name), h('div.hint', c.description.slice(0, 160))),
          c.inLibrary
            ? h('span.pill.ok', 'in library')
            : h('button.btn.small', {
                onclick: async (e) => {
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  const r = await attempt(() => POST('/skills/import', { name: c.slug }), `Imported ${c.name}`);
                  if (!r) {
                    btn.disabled = false; // failed: let them try again
                    return;
                  }
                  c.inLibrary = true;
                  drawRows();
                  reload();
                },
              }, 'Import'),
        ),
      ),
    );
  drawRows();
  m = modal({ title: 'Import from Claude Code', body: h('div', { class: 'flex flex-col gap-2.5' }, h('p.hint', 'Your Claude Code skills (~/.claude/skills). Importing copies the skill and its files into the dashboard library; the original stays where it is.'), rows), foot: [h('button.btn', { onclick: () => m.close() }, 'Done')] });
}
