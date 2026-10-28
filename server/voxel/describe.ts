// The world in words, for builders (world_info) and the Brain's snapshot: what is there, who built it,
// where the caller's team stands, and a top-down map of one object when asked.
import { DIORAMA_SHORT } from './diorama.ts';
import { agents, listProjects, projectData, workflows } from '../store.ts';
import { readPlain } from '../util.ts';
import { DESK_REACH, benchSpot, platformRadius, teamSpots } from '../../shared/stationlayout.ts';
import { getVoxel } from '../../shared/voxel.ts';
import { loadGrids } from './ops.ts';
import { readObject, readPrefab, worldVoxels } from './store.ts';
import { shownWorld } from './link.ts';
import { anchorText, boxText, findObject, findPrefab, placedCopies, prefabSize, recentChanges, WORLD_LIMITS } from './build.ts';
import { sceneText } from './scene.ts';
import { skinsText } from './characters.ts';
import type { VoxelWorld } from '../../shared/types.ts';

export { platformRadius };

const ago = (ts: number) => {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

/** Where things are on the map, and where a builder should and shouldn't build: the same layout the Station
 *  draws (shared/stationlayout.ts), in the order it draws the teams. */
function layoutText(agentId?: string): string {
  // as the page gets them: teams by name, their members still here; agents pinned first, then by name
  const teams = workflows
    .list()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ ...t, members: (Array.isArray(t.members) ? t.members : [...new Set((t.steps || []).filter((x) => x.type === 'agent' && x.agentId).map((x) => x.agentId as string))]).filter((id) => agents.get(id)) }));
  const all = agents.list().sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  const onTeams = new Set(teams.flatMap((t) => t.members));
  const benched = all.filter((a) => !onTeams.has(a.id)).map((a) => a.id);
  const saved = readPlain<{ bench?: { x: number; z: number } | null }>(projectData('layout.json'), {}).bench;
  const spots = teamSpots(teams, { benchCount: benched.length, hasAgent: (id) => !!agents.get(id) });
  const bench = benchSpot(benched, saved);
  const xz = (p: [number, number]) => `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`;
  const who = (id: string) => agents.get(id)?.name || id;
  const lines = [
    'Map: map units, y up, the floor at y = 0; positions below are (x, z) on the ground. The Brain stands at the middle (0, 0) on a pedestal about 4.5 wide with a beam of light above it: keep 6 map units around it clear.',
    `Team platforms are round, around the Brain, their top at y = 0.5; anchor builds to a team ("team:<id>") so they move when the platform is dragged (positions are then from its centre). The desks sit in a ring near the edge and turn to face the camera, so each takes a circle of ${DESK_REACH} map units around its spot (2 for the lead's), about 2.7 tall: build outside the platform (more than its radius from its centre), or under it (y < 0). A build anchored to "agent:<id>" is measured from that agent's desk.`,
  ];
  teams.forEach((t, i) => {
    const sp = spots[i];
    lines.push(`- team "${t.name}" (anchor team:${t.id}): centre ${xz(sp.center)}, platform radius ${sp.radius.toFixed(1)}, ${t.members.length} agent${t.members.length === 1 ? '' : 's'}${agentId && t.members.includes(agentId) ? ' ← your team' : ''}${sp.desks.length ? `; desks: ${sp.desks.map((d) => `${who(d.agentId)}${d.lead ? ' (lead)' : ''} at ${xz(d.at)}`).join(', ')}` : ''}`);
  });
  if (bench) lines.push(`- the Bench (agents on no team): centre ${xz(bench.center)}, a slab about ${bench.size[0].toFixed(1)} across and ${bench.size[1].toFixed(1)} deep, turned to face the Brain; desks: ${bench.desks.map((d) => `${who(d.agentId)} at ${xz(d.at)}`).join(', ')}`);
  const mine = agentId ? spots.find((sp) => sp.desks.some((d) => d.agentId === agentId)) : undefined;
  if (agentId && !mine) lines.push('You are not on a team: you sit on the Bench, in front of the Brain. Build where the user or the Brain asks, anchored to "agent:<your id>" for things that belong to you.');
  else if (mine) lines.push(`Your plot: the ring from ${mine.radius.toFixed(1)} to ${(mine.radius + 8).toFixed(1)} map units around your team's platform (anchor team:${mine.id}, centre ${xz(mine.center)}). Build there unless asked otherwise.`);
  return lines.join('\n');
}

export function worldText(w: VoxelWorld, { how, fromProject, agentId, builder = false }: { how: string; fromProject?: string; agentId?: string; builder?: boolean }): string {
  const objects = w.objects.map((o) => `- "${o.name}" (id ${o.id}) by ${o.by.name}${o.lastBy && o.lastBy.name !== o.by.name ? `, last changed by ${o.lastBy.name}` : ''} ${ago(o.updatedAt)}: ${o.volumes.reduce((n, v) => n + v.count, 0).toLocaleString('en-US')} voxels at voxel size ${[...new Set(o.volumes.map((v) => v.voxelSize))].join(' and ') || '-'}, ${boxText(o)}, at ${o.position.join(', ')} from ${anchorText(o.anchor)}${o.rotation ? `, turned ${o.rotation}°` : ''}${o.scale !== 1 ? `, scale ${o.scale}` : ''}${o.instances ? `, ${o.instances} prefab copies placed in it` : ''}${o.hidden ? ' (hidden)' : ''}`);
  const prefabs = w.prefabs.map((p) => `- "${p.name}" by ${p.by.name}: ${p.description || 'no description'} | ${prefabSize(w, p)} map units, ${p.volumes.reduce((n, v) => n + v.count, 0).toLocaleString('en-US')} voxels${p.instances ? ` and ${p.instances} ${p.instances === 1 ? 'copy' : 'copies'} of other prefabs` : ''}`);
  const changes = recentChanges(w.id, 6).map((c) => `- ${ago(c.at)}: ${c.by} ${c.what}`);
  return [
    `World "${w.name}" (${how === 'carried' ? `carried over from another project${fromProject ? ` (${fromProject})` : ''}: your first build makes this project its own copy` : how === 'shared' ? 'shared with another project: changes show there too' : "this project's own"}).`,
    `Default voxel size ${w.voxelSize} map units. Time of day: ${w.environment.preset}. ${worldVoxels(w).toLocaleString('en-US')} of ${WORLD_LIMITS.voxels.toLocaleString('en-US')} voxels, ${w.objects.length} of ${WORLD_LIMITS.objects} objects, ${placedCopies(w).toLocaleString('en-US')} of ${WORLD_LIMITS.copies.toLocaleString('en-US')} placed copies.`,
    `Palette: ${w.palette.map((m) => `${m.name} (${m.kind}, ${m.color})`).join(', ') || 'empty (stock materials are added when first used)'}.`,
    '',
    layoutText(agentId),
    '',
    objects.length ? `Objects:\n${objects.join('\n')}` : 'No objects yet.',
    prefabs.length ? `\nPrefabs (place copies with {"place": "<name>"}; world_prefab "list" says where each is used):\n${prefabs.join('\n')}` : '\nNo prefabs yet: make the small things you need many of (people, trees, lamps…) as prefabs, then place them.',
    `\n${sceneText(w, { builder })}`,
    `\n${skinsText(w)}`,
    changes.length ? `\nRecent changes:\n${changes.join('\n')}` : '',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** A top-down map of an object at one of its voxel sizes: each cell is the top voxel's material (a key letter), "." empty. */
export function objectMap(w: VoxelWorld, ref: string, size?: number): string {
  const o = findObject(w, ref) || findPrefab(w, ref);
  if (!o) return `No object or prefab "${ref}".`;
  const grids = loadGrids('anchor' in o ? readObject(w.id, o.id) : readPrefab(w.id, o.id));
  const g = (size !== undefined ? grids.find((x) => Math.abs(x.voxelSize - size) < 1e-6) : null) || [...grids].sort((a, b) => b.vol.chunks.size - a.vol.chunks.size)[0];
  const v = o.volumes.find((x) => x.id === g?.id);
  if (!g || !v?.min || !v.max) return `"${o.name}" is empty.`;
  const [x0, y0, z0] = v.min;
  const [x1, y1, z1] = v.max;
  // at most 80 columns: wider objects are sampled
  const step = Math.max(1, Math.ceil(Math.max(x1 - x0 + 1, z1 - z0 + 1) / 80));
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const key = new Map<number, string>();
  const rows: string[] = [];
  for (let z = z0; z <= z1; z += step) {
    let row = '';
    for (let x = x0; x <= x1; x += step) {
      let ch = '.';
      for (let y = y1; y >= y0; y--) {
        const m = getVoxel(g.vol, x, y, z);
        if (!m) continue;
        if (!key.has(m)) key.set(m, letters[key.size % letters.length]);
        ch = key.get(m)!;
        break;
      }
      row += ch;
    }
    rows.push(row);
  }
  return [
    `Top view of "${o.name}" at voxel size ${g.voxelSize}${step > 1 ? ` (every ${step}th voxel)` : ''}: x ${x0}..${x1} left to right, z ${z0}..${z1} top to bottom, heights y ${y0}..${y1}.`,
    `Key: ${[...key].map(([m, ch]) => `${ch} = ${w.palette[m - 1]?.name || `material ${m}`}`).join(', ')}`,
    ...rows,
  ].join('\n');
}

export function worldInfo({ project, agentId, map, size }: { project?: string; agentId?: string; map?: string; size?: number } = {}): string {
  const shown = shownWorld(project);
  if (!shown.world) return `No world yet. Your first world_build starts one for this project. It will be ${DIORAMA_SHORT}.\n\n${layoutText(agentId)}`;
  const from = listProjects().find((p) => p.id === shown.fromProject)?.name;
  const text = `${worldText(shown.world, { how: shown.how, fromProject: from, agentId, builder: true })}\nThe world is ${DIORAMA_SHORT}.`;
  return map ? `${text}\n\n${objectMap(shown.world, map, size)}` : text;
}
