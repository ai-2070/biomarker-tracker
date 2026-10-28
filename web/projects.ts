// Project switcher and "New project" dialog.
import { h, mount, state, GET, POST, PUT, attempt, promptBox, confirmBox, modal, seg, field, toast, refreshSoon, ago } from './core.ts';
import { icon } from './icons.ts';
import { projectMark } from './projectlogo.ts';
import { moveId } from './projectnav.ts';
import { uiZoom } from './look.ts';
import { askBrain } from './dock.tsx';
import { BACKUP_EXT, backupProject, backupAgo, fileSize, listBackups, readBackupSummary, restoreBackup, restoredText, summaryLine } from './backup.ts';
import type { BackupListing, BackupSummary } from './backup.ts';
import { attachTray } from './attach.ts';
import type { ModalHandle } from './core.ts';
import type { Project } from '../shared/types.ts';

export type NewProjectMode = 'new' | 'existing' | 'github' | 'backup';
/** A saved copy the dashboard found in a folder (.dashboard/project.json). */
export interface ProjectPeek {
  name: string;
  description: string;
  agents: number;
  teams: number;
  savedAt: number;
}
/** POST /api/projects: the project, plus what was loaded back from its folder. */
export interface CreatedProject extends Project {
  restored: { agents: number; teams: number; project?: unknown } | null;
}
/** GET /api/projects */
interface ProjectList {
  active: Project;
  projects: Project[];
  root: string;
}
/** GET /api/projects/overview: the start screen. */
interface ProjectsOverview {
  active: string;
  root: string;
  projects: (Project & { agents: number; teams: number; hasProjectMd: boolean; saved: ProjectPeek | null })[];
  found: { name: string; folder: string; brief?: string; saved: ProjectPeek | null }[];
  showLauncher: boolean;
}

const slug = (s: string | null | undefined) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

// A small menu under the project name: switch, create, or manage.
// ---------- what you can do with a project: rename, clone, delete (in the project menu and on the All projects screen) ----------
type ProjectRef = Pick<Project, 'id' | 'name'>;

/** Asks for a new name and saves it (only the name: the folder and files keep theirs). */
export async function renameProject(p: ProjectRef): Promise<boolean> {
  const name = (await promptBox('Rename project', { value: p.name }))?.trim();
  if (!name || name === p.name) return false;
  const r = await attempt(() => PUT(`/projects/${encodeURIComponent(p.id)}`, { name }), `Renamed to ${name}`);
  refreshSoon(0);
  return !!r;
}

/** A copy as a new project (agents, teams, routines, notes, skills and chats; schedules start paused), which is opened. */
export async function cloneProject(p: ProjectRef): Promise<boolean> {
  const name = (await promptBox('Clone project', { label: 'Name of the copy', value: `${p.name} (copy)`, ok: 'Clone' }))?.trim();
  if (!name) return false;
  const made = await attempt(() => POST<CreatedProject>(`/projects/${encodeURIComponent(p.id)}/clone`, { name }), (r) => `Cloned as ${r.name}: ${r.restored?.agents ?? 0} agents, ${r.restored?.teams ?? 0} teams`);
  if (!made) return false;
  await attempt(() => POST(`/projects/${encodeURIComponent(made.id)}/activate`));
  refreshSoon(0);
  return true;
}

/** Deletes a project after a backup that is made and checked first. Its folder and files on the PC are never touched. */
export async function deleteProject(p: ProjectRef): Promise<boolean> {
  const sure = await confirmBox(
    h(
      'div',
      h('p', `Delete the project "${p.name}"?`),
      h('p.hint', 'First a backup is made in My Dashboard Backups and checked. Only if it is complete is the project removed: its agents, teams, chats and settings leave the dashboard (set aside on this PC, not erased). The project\'s own folder and files are not touched.'),
    ),
    { ok: 'Back up and delete', danger: true },
  );
  if (!sure) return false;
  const r = await attempt(() => POST<{ backup: { name: string } }>(`/projects/${encodeURIComponent(p.id)}/delete`), (x) => `Deleted ${p.name}. Backup: ${x.backup.name}`);
  refreshSoon(0);
  return !!r;
}

const ROW =
  "group relative flex items-center [&.dragging]:opacity-40 [&.drop-above]:before:absolute [&.drop-above]:before:-top-px [&.drop-above]:before:right-2.5 [&.drop-above]:before:left-2.5 [&.drop-above]:before:h-0.5 [&.drop-above]:before:rounded-[1px] [&.drop-above]:before:bg-accent [&.drop-below]:after:absolute [&.drop-below]:after:right-2.5 [&.drop-below]:after:-bottom-px [&.drop-below]:after:left-2.5 [&.drop-below]:after:h-0.5 [&.drop-below]:after:rounded-[1px] [&.drop-below]:after:bg-accent";
const RENAME_BTN =
  'mr-1 grid h-6.5 w-6.5 flex-none cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent p-0 text-faint opacity-0 [transition:opacity_0.15s] group-hover:opacity-100 hover:bg-panel-2 hover:text-accent focus-visible:opacity-100';

export function openProjectMenu(anchor: Element): void {
  document.querySelector('.proj-menu')?.remove();
  const d = state.data!;
  const r = anchor.getBoundingClientRect();
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: PointerEvent) => !menu.contains(e.target as Node) && !anchor.contains(e.target as Node) && close();
  const switchTo = async (p: Project) => {
    close();
    if (p.id === d.project.id) return;
    await attempt(() => POST(`/projects/${p.id}/activate`), `Opened ${p.name}`);
    refreshSoon(0);
  };
  // the projects in their order (the floors): drag one, or Alt+Up / Alt+Down on it, to move it; the pencil (or F2) renames it
  const list = h('div', { class: 'flex flex-col' });
  const rows = new Map<string, HTMLElement>();
  const order = () => [...list.children].map((c) => (c as HTMLElement).dataset.id!);
  const save = (ids: string[]) => {
    for (const id of ids) list.append(rows.get(id)!);
    void attempt(() => POST('/projects/order', { ids })).then(() => refreshSoon(0));
  };
  let dragId = '';
  const clearMarks = () => list.querySelectorAll('.drop-above, .drop-below, .dragging').forEach((el) => el.classList.remove('drop-above', 'drop-below', 'dragging'));
  // the name turns into a box: Enter or leaving it saves, Esc keeps the old name
  const startRename = (p: Project, row: HTMLElement, item: HTMLElement, label: HTMLElement) => {
    if (row.querySelector('.proj-rename-row')) return;
    const input = h('input', { class: 'min-w-0 flex-1', value: p.name, maxlength: 80, 'aria-label': `New name for ${p.name}` });
    const box = h('div.proj-rename-row', { class: 'flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.25' }, projectMark(p, 16), input);
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      box.remove();
      item.classList.remove('hidden');
      row.draggable = true;
      const next = input.value.trim();
      if (!commit || !next || next === p.name) return;
      label.textContent = next;
      p.name = next;
      void attempt(() => PUT(`/projects/${encodeURIComponent(p.id)}`, { name: next }), `Renamed to ${next}`).then(() => refreshSoon(0));
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
        setTimeout(() => item.focus(), 0);
      } else if (e.key === 'Escape') {
        e.preventDefault(); // (the menu itself stays open)
        finish(false);
        setTimeout(() => item.focus(), 0);
      }
    });
    input.addEventListener('blur', () => finish(true));
    row.draggable = false;
    item.classList.add('hidden');
    row.prepend(box);
    input.focus();
    input.select();
  };
  for (const p of d.projects || []) {
    const label = h('span', { class: 'min-w-0 flex-1' }, p.name);
    const item = h(
      `button.st-menu-item${p.id === d.project.id ? '.on' : ''}`,
      { class: 'min-w-0 flex-1', title: 'Drag to change the order (or Alt+Up / Alt+Down)', onclick: () => switchTo(p) },
      // the grip: stays faint, even when the item lights up
      icon('grip-vertical', 13, 'flex-none cursor-grab text-faint'),
      projectMark(p, 16),
      label,
      p.id === d.project.id ? icon('check', 14) : null,
    );
    // dragging and drop-above / drop-below are set while you drag: a faded row, a line where it will land
    const row = h('div', { class: ROW, draggable: 'true', 'data-id': p.id }, item);
    // the rename pencil: there when you point at the project (or tab to it)
    row.append(h('button', { class: RENAME_BTN, title: `Rename ${p.name} (F2)`, 'aria-label': `Rename ${p.name}`, onclick: () => startRename(p, row, item, label) }, icon('pencil', 13)));
    row.addEventListener('dragstart', (e) => {
      dragId = p.id;
      e.dataTransfer?.setData('text/plain', p.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    row.addEventListener('dragend', clearMarks);
    row.addEventListener('dragover', (e) => {
      if (!dragId || dragId === p.id) return;
      e.preventDefault();
      const r2 = row.getBoundingClientRect();
      const below = e.clientY > r2.top + r2.height / 2;
      list.querySelectorAll('.drop-above, .drop-below').forEach((el) => el.classList.remove('drop-above', 'drop-below'));
      row.classList.add(below ? 'drop-below' : 'drop-above');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const below = row.classList.contains('drop-below');
      clearMarks();
      const dragged = dragId;
      dragId = '';
      if (!dragged || dragged === p.id) return;
      const without = order().filter((x) => x !== dragged);
      const at = without.indexOf(p.id) + (below ? 1 : 0);
      save([...without.slice(0, at), dragged, ...without.slice(at)]);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        return startRename(p, row, item, label);
      }
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const ids = order();
      const i = ids.indexOf(p.id);
      save(moveId(ids, p.id, e.key === 'ArrowUp' ? i - 1 : i + 1));
      setTimeout(() => item.focus(), 0);
    });
    rows.set(p.id, row);
    list.append(row);
  }
  const menu = h(
    'div.st-menu.proj-menu',
    { class: 'z-80', style: { position: 'fixed', left: `${r.left / uiZoom()}px`, top: `${r.bottom / uiZoom() + 6}px`, transform: 'none' } },
    h('div.st-menu-head', 'Projects'),
    h('div', { class: 'max-w-[260px] px-3.5 pb-2 font-mono text-[10.5px] leading-[1.4] font-normal text-faint' }, 'Drag to reorder, the pencil renames. On the Station, Up and Down switch between them.'),
    list,
    h('div.st-menu-sep'),
    h('button.st-menu-item', { onclick: () => (close(), openLauncher({ force: true })) }, icon('folder-open', 15), 'All projects…'),
    h('button.st-menu-item', { onclick: () => (close(), openNewProject()) }, icon('plus', 15), 'New project'),
    h('button.st-menu-item', { onclick: () => (close(), void cloneProject(d.project)) }, icon('copy', 15), 'Clone this project…'),
    h('button.st-menu-item', { onclick: () => (close(), void import('./views/worldpanel.tsx').then((m) => m.openWorldPicker())) }, icon('globe', 15), 'Voxel world…'),
    h('div.st-menu-sep'),
    h('button.st-menu-item', { onclick: () => (close(), backupProject(d.project)) }, icon('archive', 15), 'Back up this project'),
    h('button.st-menu-item', { onclick: () => (close(), openNewProject({ mode: 'backup' })) }, icon('upload', 15), 'Restore a backup…'),
    h('div.st-menu-sep'),
    h('button.st-menu-item.danger', { onclick: () => (close(), void deleteProject(d.project)) }, icon('trash-2', 15), 'Delete this project…'),
  );
  document.body.append(menu);
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

// From backup: the drop zone (over: a file is dragged onto it), empty or showing the picked backup
const DROP_EMPTY =
  'flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[12px] border-[1.5px] border-dashed border-line-2 bg-panel-2/70 p-4.5 text-center text-dim [transition:border-color_0.18s,background_0.18s,color_0.18s] hover:border-accent hover:text-ink focus-visible:border-accent focus-visible:text-ink focus-visible:outline-none [&.over]:border-solid [&.over]:border-accent [&.over]:bg-[color-mix(in_srgb,var(--color-accent)_9%,var(--color-panel))] [&.over]:text-ink';
const DROP_HAS =
  'flex min-h-0 cursor-pointer flex-row items-start justify-start gap-3.5 rounded-[12px] border-[1.5px] border-solid border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))] bg-panel-2/70 p-4.5 text-left text-dim [transition:border-color_0.18s,background_0.18s,color_0.18s] hover:text-ink focus-visible:text-ink focus-visible:outline-none [&.over]:bg-[color-mix(in_srgb,var(--color-accent)_9%,var(--color-panel))] [&.over]:text-ink';
const DROP_ICO = 'grid h-11 w-11 flex-none place-items-center rounded-box bg-accent/10 text-accent';
const DROP_TITLE = 'text-[15px] font-semibold text-ink';
const DROP_META = 'mt-0.75 text-[12.5px] wrap-anywhere text-dim';
const BACKUP_ITEM =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] border border-line bg-transparent px-2.75 py-2 text-left text-ink [transition:border-color_0.15s,background_0.15s] hover:border-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-panel))] focus-visible:border-accent focus-visible:bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-panel))] focus-visible:outline-none [&>svg]:flex-none [&>svg]:text-accent';
const ITEM_META = 'text-[11.5px] whitespace-nowrap text-faint';

export async function openNewProject({ mode: startMode = 'new', onDone }: { mode?: NewProjectMode; onDone?: (p: CreatedProject) => unknown } = {}): Promise<void> {
  const info = await GET<ProjectList>('/projects').catch(() => ({ root: '' }));
  const sep = info.root.includes('\\') ? '\\' : '/';
  let mode: NewProjectMode = startMode;
  let touchedFolder = false;
  const name = h('input', { placeholder: 'e.g. NET launch, Client X, My game' });
  const folder = h('input.code', { placeholder: info.root ? `${info.root}${sep}…` : 'Folder path' });
  const repo = h('input.code', { placeholder: 'owner/repo or https://github.com/owner/repo' });
  const about = h('textarea', { rows: 4, placeholder: 'What is it, who is it for, what should come out of it? e.g. "Launch campaign for my app NET: X and Reddit posts, a 30s promo video and thumbnails, in a calm, technical voice."' });
  const kickoff = h('input', { type: 'checkbox', checked: true });
  // the project's folder doesn't exist yet: the files wait and go into it once it is created
  const tray = attachTray({ deferred: true });
  const extra = h('div', { class: 'flex flex-col gap-2.5' });
  const hint = h('p.hint');
  // a blank name falls back to the repo's name (GitHub only); otherwise the server asks for one
  const repoName = () => (mode === 'github' && repo.value.trim().split('/').pop()?.replace(/\.git$/, '')) || '';
  const namePlaceholder = name.placeholder;
  const suggest = () => {
    name.placeholder = repoName() || namePlaceholder;
    if (!touchedFolder && mode !== 'existing' && mode !== 'backup') folder.value = info.root ? `${info.root}${sep}${slug(name.value || repo.value.split('/').pop())}` : '';
  };
  name.addEventListener('input', suggest);
  repo.addEventListener('input', suggest);
  folder.addEventListener('input', () => (touchedFolder = true));
  let touchedName = false;
  let touchedAbout = false;
  name.addEventListener('input', () => (touchedName = true));
  about.addEventListener('input', () => (touchedAbout = true));

  // From backup: a dropped or chosen .dashbackup file, or one from the backups folder
  let picked: { file: File } | { listed: string } | null = null;
  let pickedSummary: BackupSummary | null = null;
  let pickedLabel = '';
  let backups: BackupListing[] | null = null;
  const chooser = h('input', { type: 'file', accept: BACKUP_EXT, style: { display: 'none' } });
  chooser.addEventListener('change', () => {
    const f = chooser.files?.[0];
    chooser.value = '';
    if (f) void pickFile(f);
  });
  const usePicked = (src: NonNullable<typeof picked>, sum: BackupSummary | null, label: string) => {
    picked = src;
    pickedSummary = sum;
    pickedLabel = label;
    // the backup's name and description, unless you typed your own
    if (sum && !touchedName) name.value = sum.name;
    if (sum && !touchedAbout) about.value = sum.description;
    draw();
  };
  const pickFile = async (f: File) => {
    const sum = await readBackupSummary(f).catch(() => null);
    if (!sum) return toast(`${f.name} isn't a dashboard backup (a ${BACKUP_EXT} file).`, 'error');
    usePicked({ file: f }, sum, `${f.name} · ${fileSize(f.size)}`);
  };
  const dropZone = () => {
    const zone: HTMLDivElement = h(
      'div',
      {
        class: picked ? DROP_HAS : DROP_EMPTY,
        role: 'button',
        tabindex: 0,
        'aria-label': 'Choose a backup file',
        onclick: () => chooser.click(),
        onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), chooser.click()),
        ondragenter: (): void => zone.classList.add('over'),
        ondragleave: (e: DragEvent): void => {
          if (!zone.contains(e.relatedTarget as Node | null)) zone.classList.remove('over');
        },
        ondrop: (): void => zone.classList.remove('over'),
      },
      picked && pickedSummary
        ? [
            h('div', { class: DROP_ICO }, icon('archive', 22)),
            h(
              'div',
              { class: 'min-w-0 flex-1' },
              h('div', { class: DROP_TITLE }, pickedSummary.name || 'Backup'),
              h('div', { class: DROP_META }, summaryLine(pickedSummary)),
              pickedSummary.agentList.length ? h('div', { class: 'mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-ink' }, pickedSummary.agentList.map((a) => h('span', { title: a.name }, a.emoji, ' ', a.name))) : null,
              h('div', { class: DROP_META }, `Backed up ${ago(pickedSummary.createdAt)} · ${pickedLabel}`),
            ),
            h('span.btn.tiny.ghost', 'Change'),
          ]
        : [h('div', { class: DROP_ICO }, icon('upload', 24)), h('div', { class: DROP_TITLE }, 'Drop a backup here'), h('div.hint', `or click to choose a ${BACKUP_EXT} file`)],
    );
    return zone;
  };
  const recent = () => {
    if (picked || !backups?.length) return null;
    return h(
      'div',
      { class: 'flex flex-col gap-2.5' },
      h('div.label', 'In your backups folder'),
      h(
        'div',
        { class: 'flex max-h-[210px] flex-col gap-1.5 overflow-y-auto p-px' },
        backups.slice(0, 6).map((b) =>
          h(
            'button',
            { class: BACKUP_ITEM, type: 'button', onclick: () => usePicked({ listed: b.name }, b.summary, `${b.name} · ${fileSize(b.size)}`) },
            icon('archive', 15),
            h('span', { class: 'flex min-w-0 flex-1 flex-col' }, h('span', { class: 'truncate text-[13.5px] font-semibold' }, b.summary?.name || b.name), b.summary ? h('span', { class: ITEM_META }, summaryLine(b.summary)) : null),
            h('span', { class: ITEM_META }, backupAgo(b.summary, b.modifiedAt)),
          ),
        ),
      ),
    );
  };

  // set once the dialog exists: the tray takes drops in every mode but "From backup"
  let syncDrop = () => {};
  const draw = () => {
    if (mode === 'backup') {
      if (backups === null) {
        backups = [];
        void listBackups()
          .then((r) => ((backups = r.backups), mode === 'backup' && draw()))
          .catch(() => {});
      }
      folder.placeholder = info.root ? `A new folder in ${info.root}` : 'Folder path';
      mount(
        extra,
        dropZone(),
        chooser,
        recent(),
        field('Brain folder', folder, 'Leave empty for a new folder. In a folder you already have, files there are never overwritten.'),
      );
      hint.textContent = 'Brings back its agents, teams, routines, chats, knowledge files and notes, and adds its skills and saved presets to your library (yours stay as they are).';
      kickoffRow.style.display = 'none';
      filesRow.style.display = 'none';
      syncDrop();
      createBtn.textContent = 'Restore project';
      createBtn.disabled = !picked;
      if (!touchedFolder) folder.value = '';
      return;
    }
    folder.placeholder = info.root ? `${info.root}${sep}…` : 'Folder path';
    kickoffRow.style.display = '';
    filesRow.style.display = '';
    syncDrop();
    createBtn.textContent = created ? 'Try the files again' : 'Create project';
    createBtn.disabled = false;
    mount(
      extra,
      mode === 'github' ? field('GitHub repo', repo, 'Cloned with your GitHub login (gh) so private repos work too.') : null,
      field(mode === 'existing' ? 'Your folder' : 'Brain folder', folder, mode === 'existing' ? 'The project Brain is this folder: agents read it and work in it.' : 'A new folder for the project: its files, notes and what the agents make.'),
    );
    hint.textContent =
      (mode === 'new' ? 'Starts with a BRAIN.md and a notes folder.' : mode === 'existing' ? 'If the dashboard saved this folder before, its agents, teams and chats load back in.' : 'Agents work right inside the repo, so they see its code, README and CLAUDE.md.') +
      ' Everything is auto-saved into the folder (.dashboard).';
    if (mode === 'existing' && !touchedFolder) folder.value = '';
    suggest();
  };
  let m: ModalHandle;
  // made already (its files failed to upload): the next click only tries the files again
  let created: CreatedProject | null = null;
  const restore = async (btn: HTMLButtonElement) => {
    if (!picked) return toast('Drop a backup file first.', 'error');
    btn.disabled = true;
    btn.textContent = 'Restoring…';
    const p = await attempt(() => restoreBackup(picked!, { name: name.value.trim(), folder: touchedFolder ? folder.value.trim() : '', description: about.value.trim() }));
    btn.disabled = false;
    btn.textContent = 'Restore project';
    if (!p) return;
    m.close();
    toast(restoredText(p.name, p.restored), p.restored.paused ? 'warn' : 'info', 8000);
    await refreshSoon(0);
    onDone?.(p);
  };
  const create = async (btn: HTMLButtonElement) => {
    if (mode === 'backup') return restore(btn);
    btn.disabled = true;
    btn.textContent = created ? 'Uploading files…' : mode === 'github' ? 'Cloning…' : 'Creating…';
    const p = created || (await attempt(() => POST<CreatedProject>('/projects', { name: name.value.trim() || repoName(), mode, folder: folder.value.trim(), repo: repo.value.trim(), description: about.value.trim() })));
    if (!p) {
      btn.disabled = false;
      btn.textContent = 'Create project';
      return;
    }
    if (!created) {
      created = p;
      // the project exists now: only its files can still change
      for (const f of [name, folder, repo, about]) f.disabled = true;
    }
    // the new project is the active one now, so the files land in its folder (uploads/), shown here while they go
    let files: string[] = [];
    if (tray.count()) {
      btn.textContent = 'Uploading files…';
      const up = await tray.ready();
      if (!up) {
        // stay open: try again, or remove the ones that failed and go on
        btn.disabled = false;
        btn.textContent = 'Try the files again';
        return;
      }
      files = up;
    }
    m.close();
    toast(p.restored ? `Loaded "${p.name}": ${p.restored.agents} agents and ${p.restored.teams} teams from the folder` : `Project "${p.name}" is open`);
    if (files.length && !kickoff.checked) toast(`Added ${files.length} file${files.length === 1 ? '' : 's'} to the project folder (uploads/)`);
    await refreshSoon(0);
    onDone?.(p);
    // the Brain studies the new project, asks what it needs, then writes PROJECT.md and sets up teams
    if (kickoff.checked)
      setTimeout(
        () =>
          askBrain(
            `I just created the project "${p.name}".${about.value.trim() ? ` What it is: ${about.value.trim()}` : ''}${files.length ? ' I attached files for it: study them too.' : ''}
Look at the project folder and help me set it up: ask me what you need to know first, then write PROJECT.md and create the teams and agents it needs.`,
            files,
          ),
        600,
      );
  };
  const createBtn = h('button.btn', { onclick: (e) => create(e.currentTarget) }, 'Create project');
  const kickoffRow = h('label', { class: 'flex cursor-pointer flex-wrap items-center gap-2' }, kickoff, h('span', 'Let the Brain set it up (PROJECT.md, teams and agents)'));
  const filesRow = h('div', h('div.label', 'Files'), h('div', { class: 'mt-3.5 flex flex-col gap-2' }, tray.el, h('div', { class: 'flex flex-wrap items-center gap-2' }, tray.picker, h('span.hint', 'Briefs, docs, assets: drop or paste files or folders anywhere here. They go into the project folder and the Brain reads them.'))));
  const modes = () =>
    seg(
      [
        { value: 'new', label: 'New folder' },
        { value: 'existing', label: 'Existing folder' },
        { value: 'github', label: 'From GitHub' },
        { value: 'backup', label: 'From backup' },
      ],
      mode,
      (v) => {
        if (created) return void mount(modeBox, modes());
        mode = v;
        draw();
      },
    );
  const modeBox = h('div', modes());
  m = modal({
    title: 'New project',
    narrow: true,
    body: h(
      'div',
      { class: 'flex flex-col gap-2.5' },
      h('p.hint', 'A project has its own agents, teams and chats, and a Brain: a folder with all its files and info.'),
      field('Name', name),
      field('What is this project?', about, 'The Brain reads this, looks at the folder and asks you what it needs to know.'),
      modeBox,
      extra,
      hint,
      filesRow,
      kickoffRow,
    ),
    foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), createBtn],
    // closed after the project was made but before its files went: it is still open in the dashboard
    onClose: () => created && refreshSoon(0),
  });
  // Dropped files go to the tray, except a backup: in "From backup" anything dropped is taken as the
  // backup, and a lone .dashbackup dropped in another mode switches to "From backup".
  const modalEl = m.el.querySelector<HTMLElement>('.modal')!;
  let stopTrayDrop: (() => void) | null = null;
  syncDrop = () => {
    if (mode === 'backup') {
      stopTrayDrop?.();
      stopTrayDrop = null;
    } else stopTrayDrop ||= tray.dropZone(modalEl, 'Drop files or folders for the new project');
  };
  m.el.addEventListener('dragover', (e) => {
    if (mode !== 'backup' || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  m.el.addEventListener(
    'drop',
    (e) => {
      const files = e.dataTransfer?.files;
      const f = files?.[0];
      if (!f || (mode !== 'backup' && !(files.length === 1 && f.name.toLowerCase().endsWith(BACKUP_EXT)))) return;
      // before the tray sees it (it listens further down, on the dialog itself)
      e.preventDefault();
      e.stopPropagation();
      if (created) return;
      if (mode !== 'backup') {
        mode = 'backup';
        mount(modeBox, modes());
        draw();
      }
      void pickFile(f);
    },
    true,
  );
  draw();
  setTimeout(() => name.focus(), 30);
}

// The start screen's project cards. They rise in one after another (the first few, a little apart).
const L_LIST = 'flex max-h-[52vh] flex-col gap-2 overflow-y-auto p-0.5';
const L_CARD =
  'flex w-full cursor-pointer items-center gap-3.5 rounded-[12px] border bg-panel/80 px-3.5 py-3 text-left text-ink [transition:border-color_0.18s,transform_0.18s,background_0.18s] hover:bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-panel))] hover:[transform:translateY(-1px)]';
const L_CARD_PLAIN = 'border-line hover:border-accent';
// the project open now: its border stays lit
const L_CARD_CUR = 'border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-line))]';
const L_RISE = [
  'animate-[rise-in_0.25s_var(--ease-soft)_both]',
  'animate-[rise-in_0.25s_var(--ease-soft)_0.04s_both]',
  'animate-[rise-in_0.25s_var(--ease-soft)_0.08s_both]',
  'animate-[rise-in_0.25s_var(--ease-soft)_0.12s_both]',
  'animate-[rise-in_0.25s_var(--ease-soft)_0.16s_both]',
];
const L_ICO = 'grid h-10 w-10 flex-none place-items-center rounded-box bg-accent/10 text-accent';
const L_ICO_LOGO = 'grid h-13 w-13 flex-none place-items-center rounded-box bg-ink/5 text-accent [&_.proj-logo]:rounded-[8px]';
const L_NAME = 'flex items-center gap-2 text-[15px] font-semibold';
const L_META = 'mt-1.25 flex flex-wrap gap-3 text-[12px] text-dim *:inline-flex *:items-center *:gap-1';
const L_PATH = 'mt-0.75 max-w-[480px] truncate font-mono text-[11px] leading-[normal] font-normal text-faint';
const L_ACT = 'grid h-7 w-7 cursor-pointer place-items-center rounded-[6px] border border-line-2 bg-panel p-0 text-dim';

// The start screen: pick a project you already have (with its agents and teams), add a project
// folder found on this PC, or create a new one. Shown once each time the dashboard starts.
export async function openLauncher({ force = false }: { force?: boolean } = {}): Promise<void> {
  const o = await GET<ProjectsOverview>('/projects/overview').catch(() => null);
  if (!o || (!force && !o.showLauncher)) return;
  if (document.querySelector('.launcher')) return;
  const done = () => POST('/projects/launcher-done').catch(() => {});
  let m: ModalHandle;
  const open = async (p: Project) => {
    if (p.id !== o.active) {
      const r = await attempt(() => POST(`/projects/${p.id}/activate`), `Opened ${p.name}`);
      if (!r) return;
    } else done();
    m.close();
    refreshSoon(0);
  };
  const addFound = async (f: ProjectsOverview['found'][number]) => {
    const p = await attempt(() => POST<CreatedProject>('/projects', { name: f.name, mode: 'existing', folder: f.folder }), (r) => (r.restored ? `Loaded ${f.name}: ${r.restored.agents} agents, ${r.restored.teams} teams` : `Added ${f.name}`));
    if (!p) return;
    m.close();
    refreshSoon(0);
  };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const card = (p: ProjectsOverview['projects'][number], i: number) =>
    h(
      'button',
      { class: `${L_CARD} ${p.id === o.active ? L_CARD_CUR : L_CARD_PLAIN} ${L_RISE[i] ?? L_RISE[0]}`, type: 'button', onclick: () => open(p) },
      h('div', { class: p.logoAt ? L_ICO_LOGO : L_ICO }, projectMark(p, p.logoAt ? 40 : 20, p.repo ? 'git-branch' : 'folder-open')),
      h(
        'div',
        { class: 'min-w-0 flex-1' },
        h('div', { class: L_NAME }, p.name, p.id === o.active ? h('span.pill.ok', 'last open') : null),
        p.description ? h('div', { class: 'mt-0.5 text-[13px] text-dim' }, p.description.length > 120 ? `${p.description.slice(0, 120)}…` : p.description) : null,
        h('div', { class: L_META }, h('span', icon('bot', 12), plural(p.agents, 'agent')), h('span', icon('users', 12), plural(p.teams, 'team')), p.hasProjectMd ? h('span', icon('file-text', 12), 'PROJECT.md') : null, p.openedAt || p.createdAt ? h('span', icon('clock', 12), ago(p.openedAt || p.createdAt)) : null),
        h('div', { class: L_PATH }, p.brainPath),
      ),
      icon('chevron-right', 18),
    );
  // the card, with rename / clone / delete beside it (they close this screen, do their thing, and bring it back with the new list)
  const row = (p: ProjectsOverview['projects'][number], i: number) => {
    const again = async (action: (x: ProjectRef) => Promise<boolean>) => {
      m.close();
      await action(p);
      void openLauncher({ force: true });
    };
    const btn = (ico: string, title: string, action: (x: ProjectRef) => Promise<boolean>, danger = false) =>
      h('button', { class: `${L_ACT} ${danger ? 'hover:border-red hover:text-red' : 'hover:border-accent-dim hover:text-accent'}`, type: 'button', title: `${title} ${p.name}`, 'aria-label': `${title} ${p.name}`, onclick: () => void again(action) }, icon(ico, 14));
    // the actions show when you point at the card (or tab to them)
    return h(
      'div',
      { class: 'group relative' },
      card(p, i),
      h('div', { class: 'absolute top-2 right-11 flex gap-1 opacity-0 [transition:opacity_0.15s] group-hover:opacity-100 focus-within:opacity-100' }, btn('pencil', 'Rename', renameProject), btn('copy', 'Clone', cloneProject), btn('trash-2', 'Delete', deleteProject, true)),
    );
  };
  m = modal({
    title: 'Open a project',
    onClose: done,
    body: h(
      'div.launcher',
      { class: 'flex min-w-[min(620px,86vw)] flex-col gap-2.5' },
      h('p.hint', 'Each project has its own agents, teams, chats and a Brain folder, and is auto-saved into that folder. Pick one to load it, open a folder you saved before, or start a new one.'),
      h('div', { class: L_LIST }, o.projects.map(row)),
      o.found.length
        ? h(
            'div',
            { class: 'mt-3.5' },
            h('div.label', 'Found on this PC'),
            h(
              'div',
              { class: L_LIST },
              o.found.map((f, i) =>
                h(
                  'button',
                  { class: `${L_CARD} ${L_CARD_PLAIN} border-dashed ${(i < 4 && L_RISE[i]) || L_RISE[0]}`, type: 'button', onclick: () => addFound(f) },
                  h('div', { class: L_ICO }, icon('folder', 20)),
                  h('div', { class: 'min-w-0 flex-1' }, h('div', { class: L_NAME }, f.name), h('div', { class: L_META }, f.saved ? [h('span', icon('bot', 12), plural(f.saved.agents, 'agent')), h('span', icon('users', 12), plural(f.saved.teams, 'team')), h('span', icon('clock', 12), `saved ${ago(f.saved.savedAt)}`)] : null, f.brief ? h('span', icon('file-text', 12), f.brief) : null), h('div', { class: L_PATH }, f.folder)),
                  h('span.btn.tiny', 'Add'),
                ),
              ),
            ),
          )
        : null,
    ),
    foot: [
      h('button.btn.ghost', { onclick: () => (m.close(), openNewProject({ mode: 'backup' })) }, icon('upload', 15), ' Restore a backup…'),
      h('button.btn.ghost', { onclick: () => (m.close(), openNewProject({ mode: 'existing' })) }, icon('folder-open', 15), ' Open a folder…'),
      h('button.btn', { onclick: () => (m.close(), openNewProject()) }, icon('plus', 15), ' New project'),
    ],
  });
}
