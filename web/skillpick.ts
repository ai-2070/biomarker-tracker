// A small skill picker: the skills given here as chips (✕ to remove) and "+ Add skill" with the library.
// Used for an agent, a team and the project.
import { h, mount, GET, navigate } from './core.ts';
import { icon } from './icons.ts';
import { uiZoom } from './look.ts';
import { SEARCH } from './models.ts';
import type { ClaudeSkill, SkillListing } from '../shared/types.ts';

/** A skill another level gives (the project, a team), shown greyed. */
export interface InheritedSkill {
  slug: string;
  from: string;
}

let cache: SkillListing[] | null = null;
let loading: Promise<SkillListing[]> | null = null;
export async function loadSkills(force = false): Promise<SkillListing[]> {
  if (cache && !force) return cache;
  loading ||= GET<{ skills: SkillListing[]; claude: ClaudeSkill[] }>('/skills')
    .then((r): SkillListing[] => (cache = r.skills))
    // not cached, so the next load tries again
    .catch((): SkillListing[] => [])
    .finally(() => (loading = null));
  return loading;
}
export const skillsCache = (): SkillListing[] => cache || [];
export const forgetSkills = (): null => (cache = null);

// current: slugs. onChange(slugs) saves. inherited: [{ slug, from: 'project' | 'team name' }] shown greyed.
export function skillPicker(current: readonly string[] | null | undefined, onChange: (slugs: string[]) => void, { inherited = [], empty = 'No skills yet.' }: { inherited?: InheritedSkill[]; empty?: string } = {}): HTMLDivElement {
  const box = h('div');
  let list = [...(current || [])];
  const draw = () => {
    const lib = skillsCache();
    const by = new Map(lib.map((s) => [s.slug, s]));
    const add = h('button', { class: 'inline-flex items-center gap-1.25 py-1 px-2.5 border border-dashed border-line-2 rounded-full text-dim cursor-pointer text-[12.5px] hover:text-accent hover:border-accent', type: 'button', onclick: (e) => openMenu(e.currentTarget) }, icon('plus', 13), 'Add skill');
    mount(
      box,
      h(
        'div',
        { class: 'flex flex-wrap gap-1.5 items-center' },
        list.map((slug) =>
          h(
            'span',
            { class: 'inline-flex items-center gap-1.5 py-1 pr-1.5 pl-2.25 border border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-line))] rounded-full bg-accent/9 text-[12.5px] text-ink', title: by.get(slug)?.description || slug },
            icon('puzzle', 12),
            by.get(slug)?.name || slug,
            h('button', { class: 'text-dim cursor-pointer text-[10px] px-0.75 hover:text-ink', type: 'button', title: 'Remove', onclick: () => ((list = list.filter((x) => x !== slug)), onChange(list), draw()) }, '✕'),
          ),
        ),
        inherited
          .filter((x) => !list.includes(x.slug))
          .map((x) => h('span', { class: 'inline-flex items-center gap-1.5 py-1 px-2.25 border border-dashed border-line-2 rounded-full text-[12.5px] text-dim', title: `${by.get(x.slug)?.description || ''}\nComes from ${x.from}` }, icon('puzzle', 12), by.get(x.slug)?.name || x.slug, h('span', { class: 'text-[10.5px] text-faint font-mono' }, x.from))),
        add,
      ),
      !list.length && !inherited.length ? h('div.hint', { class: 'mt-1.5' }, empty) : null,
    );
  };
  const openMenu = (anchor: Element) => {
    document.querySelector('.skp-menu')?.remove();
    const lib = skillsCache().filter((s) => !list.includes(s.slug));
    const r = anchor.getBoundingClientRect();
    const z = uiZoom();
    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e: PointerEvent) => !menu.contains(e.target as Node | null) && close();
    const search = h('input', { class: SEARCH, placeholder: 'Search skills…' });
    const items = h('div.model-list', { class: 'max-h-70' });
    const fill = () => {
      const q = search.value.toLowerCase();
      const shown = lib.filter((s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q)).slice(0, 40);
      mount(
        items,
        shown.length
          ? shown.map((s) => h('button.st-menu-item', { onclick: () => (close(), (list = [...list, s.slug]), onChange(list), draw()) }, icon('puzzle', 14), h('span', { class: 'flex-1 min-w-0' }, s.name, h('span.model-sub', s.description.slice(0, 90)))))
          : h('div.hint', { style: { padding: '8px 10px' } }, lib.length ? 'No match.' : 'No more skills in the library.'),
      );
    };
    search.addEventListener('input', fill);
    // (skp-menu marks it, so opening another closes this one)
    const menu = h('div.st-menu.skp-menu', { class: 'max-w-75' }, h('div.st-menu-head', 'Add a skill'), search, items, h('div.st-menu-sep'), h('button.st-menu-item', { onclick: () => (close(), navigate('#/skills')) }, icon('plus', 14), 'Make or import a skill…'));
    document.body.append(menu);
    fill();
    Object.assign(menu.style, { position: 'fixed', left: `${Math.min(r.left / z, window.innerWidth / z - 340)}px`, top: `${Math.min(r.bottom / z + 6, window.innerHeight / z - 380)}px`, transform: 'none', zIndex: 96, width: '320px' });
    setTimeout(() => (document.addEventListener('pointerdown', outside, true), search.focus()), 0);
  };
  draw();
  loadSkills().then(draw);
  return box;
}
