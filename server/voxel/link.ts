// Which voxel world a project shows and builds in (VOXEL_WORLD_PLAN.md §3a):
//   1. the world the user picked for it (own or shared)
//   2. its own world, once something is built in it
//   3. carried over: the default world (Settings › defaultWorld), or else the most recently built one
//   4. nothing (the Station without a world)
// The first build on a carried-over world gives the project its own copy, so the other project's world
// stays as it was. Only a world the user chose to share takes builds from two projects.
import { activeProject, getSettings, listProjects, saveProjects, saveSettings, emit } from '../store.ts';
import { copyWorld, deleteWorld as removeWorldFiles, getWorld, listWorlds, newWorld, saveCount, saveWorld, worldVoxels } from './store.ts';
import type { Project, ProjectWorldLink, ShownWorld, VoxelWorld, WorldListing } from '../../shared/types.ts';

const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

function project(pid: string): Project {
  const p = listProjects().find((x) => x.id === pid);
  if (!p) throw bad('No such project.', 404);
  return p;
}

/** Points a project at a world (or at none). */
export function setLink(pid: string, link: ProjectWorldLink | undefined): void {
  const list = listProjects();
  const p = list.find((x) => x.id === pid);
  if (!p) throw bad('No such project.', 404);
  if (link) p.world = link;
  else delete p.world;
  saveProjects(list);
  emit('world', { project: pid, linked: link?.id || null });
}

/** The world projects without their own carry over: the default, or the most recently built one (not `except`). */
export function carryOver(except?: string): VoxelWorld | null {
  const want = getSettings().defaultWorld;
  const def = want ? getWorld(want) : null;
  if (def && def.built && def.id !== except) return def;
  return (
    listWorlds()
      .filter((w) => w.built && w.id !== except)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null
  );
}

/** The world a project shows, and why. */
export function shownWorld(pid: string = activeProject().id): ShownWorld {
  const link = project(pid).world;
  const linked = link ? getWorld(link.id) : null;
  if (linked && (link?.chosen || link?.mode === 'shared')) return { world: linked, how: link?.mode === 'shared' ? 'shared' : 'own', ...(link?.mode === 'shared' ? { fromProject: linked.homeProject } : {}) };
  if (linked?.built) return { world: linked, how: 'own' };
  const carried = carryOver(linked?.id);
  if (carried) return { world: carried, how: 'carried', fromProject: carried.homeProject };
  return linked ? { world: linked, how: 'own' } : { world: null, how: 'none' };
}

/** The world a build in this project goes into: its own or shared one, a copy of a carried-over one, or a new one. */
export function worldForBuild(pid: string = activeProject().id): VoxelWorld {
  const r = prepare(pid);
  r.keep?.();
  return r.world;
}

/** The world to change, and (when it was just made: a copy or a new one) how to keep it or drop it again. */
function prepare(pid: string): { world: VoxelWorld; keep?: () => void; drop?: () => void } {
  const shown = shownWorld(pid);
  if (shown.world && (shown.how === 'own' || shown.how === 'shared')) return { world: shown.world };
  const p = project(pid);
  const before = p.world;
  const made = shown.world && shown.how === 'carried' ? copyWorld(shown.world.id, pid, shown.world.name) : newWorld(pid, `${p.name}'s world`);
  // linked straight away, so whatever the change calls sees the same world
  setLink(pid, { id: made.id, mode: 'own' });
  return {
    world: made,
    keep: () => {
      // its own unbuilt world isn't needed any more
      const own = before ? getWorld(before.id) : null;
      if (own && own.id !== made.id && !own.built && own.homeProject === pid && !usedBy(own.id).some((id) => id !== pid)) removeWorldFiles(own.id);
    },
    drop: () => {
      setLink(pid, before);
      removeWorldFiles(made.id);
    },
  };
}

/**
 * Runs a change on the world a build in this project goes into. When that world had to be made first (a copy
 * of a carried-over world, or a new one), it's kept only if the change saved it: a change that fails or finds
 * nothing to do leaves the project showing the world it showed before.
 */
export function changeWorld<T>(pid: string, change: (w: VoxelWorld) => T): T {
  const r = prepare(pid);
  if (!r.keep) return change(r.world);
  const saved = saveCount(r.world.id);
  let ok = false;
  try {
    const out = change(r.world);
    ok = saveCount(r.world.id) > saved;
    return out;
  } finally {
    if (ok) r.keep();
    else r.drop?.();
  }
}

/** Projects that point at a world. */
export function usedBy(worldId: string): string[] {
  return listProjects()
    .filter((p) => p.world?.id === worldId)
    .map((p) => p.id);
}

export function listWorldsFor(): WorldListing[] {
  const def = getSettings().defaultWorld;
  return listWorlds()
    .map((w) => ({ id: w.id, name: w.name, homeProject: w.homeProject, built: w.built, objects: w.objects.length, voxels: worldVoxels(w), usedBy: usedBy(w.id), isDefault: w.id === def, updatedAt: w.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export type WorldChoice = 'share' | 'copy' | 'new' | 'auto';

/** The user picks a project's world: share one, start from a copy, a new empty one, or back to carry-over. */
export function chooseWorld(pid: string, choice: WorldChoice, worldId?: string | null): ShownWorld {
  const p = project(pid);
  if (choice === 'new') {
    const w = newWorld(pid, `${p.name}'s world`);
    setLink(pid, { id: w.id, mode: 'own', chosen: true });
  } else if (choice === 'auto') {
    // keep its own world (built or not), forget a shared one
    const own = p.world && getWorld(p.world.id)?.homeProject === pid ? p.world.id : null;
    setLink(pid, own ? { id: own, mode: 'own' } : undefined);
  } else {
    const w = getWorld(worldId);
    if (!w) throw bad('No such world.', 404);
    if (choice === 'copy') {
      const copy = copyWorld(w.id, pid);
      setLink(pid, { id: copy.id, mode: 'own', chosen: true });
    } else if (choice === 'share') setLink(pid, { id: w.id, mode: w.homeProject === pid ? 'own' : 'shared', chosen: true });
    else throw bad('Choose share, copy, new or auto.');
  }
  return shownWorld(pid);
}

export function setDefaultWorld(worldId: string | null): void {
  if (worldId && !getWorld(worldId)) throw bad('No such world.', 404);
  saveSettings({ defaultWorld: worldId || '' });
  emit('world', { defaultWorld: worldId || null });
}

export function renameWorld(worldId: string, name: unknown): VoxelWorld {
  const w = getWorld(worldId);
  if (!w) throw bad('No such world.', 404);
  const n = String(name ?? '').trim().slice(0, 80);
  if (!n) throw bad('Give the world a name.');
  w.name = n;
  return saveWorld(w, { renamed: true });
}

/** Deletes a world no project uses. */
export function deleteUnusedWorld(worldId: string): void {
  if (!getWorld(worldId)) throw bad('No such world.', 404);
  const users = usedBy(worldId);
  if (users.length) throw bad(`A project still uses this world (${users.map((id) => listProjects().find((p) => p.id === id)?.name || id).join(', ')}). Pick another world there first.`, 409);
  if (getSettings().defaultWorld === worldId) saveSettings({ defaultWorld: '' });
  removeWorldFiles(worldId);
}
