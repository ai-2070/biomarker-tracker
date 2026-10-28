// The agents' voxel world tools (the "world" tool group). Building only touches the dashboard's own world
// and can be undone, so it is low risk; changing or deleting what someone else built asks first (high).
import { log } from '../store.ts';
import { withActor } from '../versions.ts';
import { VERBS, BuildError } from './ops.ts';
import { build, changeObject, findObject, findPrefab, ownsObject, undo } from './build.ts';
import { setEffect, setEnvironment, setLight, EFFECT_KINDS } from './scene.ts';
import { playAnimation, setAnimation, setSkin, skinTarget } from './characters.ts';
import { activeProject, getSettings, saveSettings, workflows } from '../store.ts';
import { requestApproval } from '../approvals.ts';
import { loadSandbox, runScript, SCRIPT_LIMITS } from './script.ts';
import { BUILD_ORDER, DIORAMA, DIORAMA_SHORT } from './diorama.ts';
import { requestLook } from './look.ts';
import { exportFiles, importVox, writeFiles, writePicture } from './exchange.ts';
import { objectMap } from './describe.ts';
import { changePrefab, deletePrefab, importPrefab, libraryList, prefabList, publishPrefab, savePrefabFrom } from './prefabs.ts';
import { shownWorld } from './link.ts';
import { worldInfo } from './describe.ts';
import { readWorldMd, worldMdStamp, writeWorldMd, writeWorldMdSection, worldMdContext } from './worldmd.ts';
import type { JSONSchema, Risk, ToolArgs, ToolContext, ToolDef, ToolResult, ToolRunInfo, ToolAgent } from '../tools.ts';
import type { WorldBuilder, WorldLookView } from '../../shared/types.ts';

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

type Gate = (agent: ToolAgent, name: string, risk: Risk, args: ToolArgs, ctx?: ToolRunInfo, detail?: string | null) => Promise<ToolResult | null>;

const str = (description: string): JSONSchema => ({ type: 'string', description });
const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({ type: 'object', properties, required });
const builderOf = (ctx: ToolContext): WorldBuilder => ({ kind: 'agent', id: ctx.agent.id, name: ctx.agent.name });
const failed = (e: unknown): ToolResult => ({ text: e instanceof Error ? e.message : String(e), isError: true });

// WORLD.md reads in a run, so a whole rewrite is only made over the version the agent saw.
const mdRead = new Map<string, number>();
const readKey = (ctx: ToolContext, worldId: string) => `${ctx.runId || ctx.agent.id}:${worldId}`;

/** The whole build language by topic (world_steps); world_build's description has the common part. */
export const STEP_TOPICS: Record<string, string> = {
  units: `Units: with "units": "map" on the call (recommended), every position and size in the steps is in map units, the same numbers world_info, WORLD.md and plans use: {"box": [4, 3, 6]} is 4 map units wide whatever the voxel size. Without it they are whole voxels of the current voxel size (at 0.25, 4 map units is 16 voxels). One step can say "units": "map" on its own. Drawings stay in voxels either way: "layers", heightmap "rows", extrude "rows" and text "scale" (one character = one voxel). Map units: a desk is 2.6 wide, a person 1.7 tall, the floor is y = 0, the cursor starts at the object's origin.`,
  state: `State steps: {"voxel_size": 0.1} (the next steps build at that size; one object can mix sizes), {"use": "stone"}, {"material": "name", "color": "#rrggbb", "ramp": ["#..", "#.."], "jitter": 0.08, "kind": "solid|glass|water|emissive|metal|leaf|snow", "emissive": 3, "opacity": 0.6} (define or change a material, then use it), {"at": [x, y, z]} (move the cursor), {"move": [dx, dy, dz]}, {"mirror": "x"} (or ["x", "z"], "none": mirror the following steps across the cursor), {"seed": 7}.`,
  shapes: `Shapes (each may take "at": offset from the cursor, "use": material, "erase": true, "keep": true to fill only empty voxels, "hollow": true): {"box": [w, h, d]} (from its corner; "frame": true for edges only), {"sphere": r}, {"ellipsoid": [rx, ry, rz]}, {"blob": [rx, ry, rz], "rough": 0.3, "holes": 0.2} (organic: crowns, bushes, clouds, rocks), {"cylinder": r, "height": h, "axis": "y"}, {"cone": r, "height": h, "down": false}, {"pyramid": [w, d], "height": h}, {"torus": R, "tube": r}, {"line": [x, y, z], "thickness": 1} (to that point), {"stairs": {"steps": n, "width": w, "dir": "+x", "rise": 1, "run": 1}} (rise and run: each step's height and depth), {"arch": {"width": w, "height": h, "thickness": 1, "depth": 1, "axis": "x"}}, {"set": [[x, y, z], …]}, {"layers": [["row", …] (bottom layer first; each row runs along x, rows along z)], "key": {"#": "stone", "o": "lantern"}} ("." is empty), {"text": "DINER", "facing": "+z", "scale": 1, "depth": 1}, {"heightmap": {"rows": ["0123", …]} or {"size": [w, d], "height": 6, "cell": 12}, "top": "grass"}, {"replace": {"from": "stone", "to": "moss", "chance": 0.3}, "in": [w, h, d]}, {"clear": true} (everything at this voxel size), {"scatter": {"count": 20, "area": [w, d], "step": {…any step…}}}.
Shape tools: {"revolve": [[radius, height], …], "sides": 0} (a profile turned around the vertical: columns, domes, vases, trunks, minarets; "sides": 4 for square, 8 for octagonal), {"extrude": {"points": [[x, z], …]} or {"rows": ["##..", …]}, "height": h, "wall": 1} (an outline raised: floor plans, walls, plazas, fields; "wall" for hollow walls that thick), {"path": [[x, z] or [x, y, z], …], "width": w, "height": 1} (a brush swept along points: roads, rivers, canals, walls).`,
  regions: `Region tools (a box w×h×d from the spot): {"copy": [w, h, d], "from": [x, y, z], "at": [x, y, z], "turn": 90, "mirror": "x"}, {"shift": [w, h, d], "from": […], "at": […]} (move it), {"rotate": [w, h, d], "at": […], "turn": 90} (in place), {"flip": [w, h, d], "at": […], "axis": "x"}.`,
  finishing: `Finishing (on everything at this voxel size, or "in": [w, h, d] from the spot): {"snow_cover": {"depth": 1, "chance": 0.9}} (snow on every ledge the sky can see), {"overgrow": {"chance": 0.25, "hang": 3}, "use": "moss"} (tufts on top, vines down walls), {"weather": {"amount": 0.3}} (wear and dirt, more near the ground).`,
  prefabs: `Prefabs (small models made once and placed many times; see world_prefab): {"place": "Palm tree", "at": [x, y, z], "turn": 30} places one copy (any angle; "tilt"/"roll" 0/90/180/270, "scale", "mirror": true, "swap": {"shirt": "cloth red"} to recolour a material in that copy). Many at once: "scatter": {"area": [w, d], "count": 60, "spacing": 6}, or "along": [[x, z], …] with "every": 12, "sides": 2, "offset": 4, "face": "along"|"across", or "grid": {"rows": 3, "cols": 5, "gap": [6, 8]}. "place" can be a list of prefabs to pick from, "turn": "random" or [min, max], "scale": [min, max], "mirror": "random", "swap": a list to pick from. Many copies stand on what is built below them ("on": "surface"); a single one stands exactly at "at" unless "on": "surface". "avoid": "solid" skips spots inside something built.
{"unplace": "Palm tree" (or a list, or "all"), "in": [w, h, d]} takes copies away. {"stamp": "Window", "at": [x, y, z], "turn": 90, "swap": {…}} bakes a prefab into this object's voxels (quarter turns), for parts of a building.`,
  characters: `Characters: build each part as its own prefab (a "pivot" of "top" for an arm that swings from the shoulder), then build the character prefab by placing the parts one at a time with "name": {"place": "Arm", "at": [0.3, 1.2, 0], "name": "left arm"} (in map units). world_animate moves the named parts; world_skin makes an agent take that form.`,
  materials: `Stock materials (by name, no need to define): grass, moss, dirt, sand, stone, dark stone, cobble, brick, white plaster, wood, dark wood, bark, leaves, pine needles, blossom, autumn leaves, bamboo, water, glass, ice, snow, cloud, red lacquer, roof tile, gold, iron, lantern, neon pink, neon blue, fire, cloth white, skin light, skin medium, skin dark.`,
};

/** The build language as world_build's description gives it: the common steps, and where the rest is. */
export const STEPS_HELP = `Steps run in order on one object (or one prefab), from a cursor that starts at its origin (y = 0 is the floor). Give "units": "map" so every position and size is in map units, like world_info's (a desk is 2.6 wide, a person 1.7 tall); without it they are voxels of the current voxel size.
State: {"voxel_size": 0.1}, {"use": "stone"}, {"material": "name", "color": "#rrggbb", "kind": "solid|glass|water|emissive|metal|leaf|snow"} (define one, then use it), {"at": [x, y, z]} (move the cursor), {"mirror": "x"}.
Shapes (each may take "at": offset from the cursor, "use", "erase": true, "hollow": true): {"box": [w, h, d]} (from its corner), {"sphere": r}, {"ellipsoid": [rx, ry, rz]}, {"blob": [rx, ry, rz], "rough": 0.3} (crowns, bushes, rocks), {"cylinder": r, "height": h}, {"cone": r, "height": h}, {"revolve": [[radius, height], …]} (columns, domes, trunks), {"extrude": {"points": [[x, z], …]}, "height": h, "wall": 1} (floor plans, walls, plazas), {"path": [[x, z], …], "width": w, "height": 1} (roads, rivers, walls).
Copies of a prefab: {"place": "Palm tree", "at": [x, y, z], "turn": 30}, or many with "scatter": {"area": [w, d], "count": 60}, "along": [[x, z], …] with "every": 12, or "grid": {"rows": 3, "cols": 5, "gap": [6, 8]}.
Stock materials include grass, dirt, sand, stone, cobble, brick, wood, leaves, water, glass, snow, lantern (glows), gold, iron.
More steps (pyramid, torus, line, stairs, arch, set, layers, text, heightmap, replace, clear, scatter of any step, copy/shift/rotate/flip regions, snow_cover/overgrow/weather finishing, unplace, stamp, characters with named parts, every stock material): world_steps. For anything repetitive or procedural (rows that differ, trees that branch, terrain from noise), world_script builds with a small JavaScript program instead.`;

// The Station in the classic look can't draw the world. A builder that wants to see it asks you to turn the
// voxel look on: always you (it changes how the Station looks in every project), once for builders asking together.
let askingForLook: Promise<boolean> | null = null;
function askForVoxelLook(agent: ToolAgent): Promise<boolean> {
  askingForLook ??= requestApproval({
    kind: 'setting',
    title: `${agent.name} wants to see the voxel world`,
    detail: 'The Station is in the classic look, which doesn\'t draw the world your agents build. Turn on the voxel look (Settings › Look › Station look) so they can look at their work? It shows the world on the Station in every project and uses more graphics power; Settings › Look switches it back.',
    agentId: agent.id,
    agentName: agent.name,
    data: { setting: 'stationLook', value: 'world', allow: 'Turn on the voxel look' },
  })
    .then((d) => {
      if (d.approved) {
        saveSettings({ look: { stationLook: 'world' } });
        log('settings', `Turned on the voxel look for ${agent.name}`, { agentId: agent.id });
      }
      return d.approved;
    })
    .finally(() => (askingForLook = null));
  return askingForLook;
}

/** How long a Station takes to switch to the voxel look and draw the world, at most (it is asked again meanwhile). */
export const LOOK_SWITCH_MS = 10_000;

/** The tools' own file checks (server/tools.ts): only the folders the agent may read or write. */
interface FileAccess {
  readable: (ctx: ToolContext, p: string | undefined) => string;
  writableDir: (ctx: ToolContext, p: string | undefined) => string;
}

export function worldTools(gate: Gate, files: FileAccess): ToolDef[] {
  // asks first when an agent changes what someone else built (the Brain and you never need to)
  const othersFirst = async (ctx: ToolContext, args: ToolArgs, ref: unknown, doing: string, kind: 'object' | 'prefab' = 'object'): Promise<ToolResult | null> => {
    const shown = shownWorld();
    if (!shown.world || shown.how === 'carried') return null;
    const o = kind === 'prefab' ? findPrefab(shown.world, ref) : findObject(shown.world, ref);
    if (!o || ownsObject(builderOf(ctx), o)) return null;
    return gate(ctx.agent, 'world_change_others', 'high', args, ctx, `${ctx.agent.name} wants to ${doing} "${o.name}", which ${o.by.name} built.`);
  };

  return [
    {
      name: 'world_info',
      group: 'world',
      risk: 'none',
      description: "The voxel world in words: its name, look, palette, every object (who built it, where, how big), recent changes, the map's layout (the Brain, team platforms, your team's plot) and what to keep clear. Pass map=<object name> for a top-down map of that object. Call it before building.",
      parameters: obj({ map: str('Optional: an object to map from above'), voxel_size: { type: 'number', description: 'Optional, with map: which of its voxel sizes to map' } }),
      run: async ({ map, voxel_size }: { map?: string; voxel_size?: number }, ctx) => ({ text: worldInfo({ agentId: ctx.agent.id, map, size: voxel_size }) }),
    },
    {
      name: 'world_build',
      group: 'world',
      risk: 'low',
      description: `Build in the voxel world, ${DIORAMA_SHORT}: run build steps on an object (made if there is no object by that name yet), or with "prefab" on a prefab: a small model (a palm tree, a person, a taxi, a lamp) you make once and then place many times with {"place": …}. Everything in the world is built by you and the other builders: nothing comes ready-made. Read WORLD.md and world_info first and build in the world's style; anchor things to your team ("team:<id>") so they move with its platform. A call can change up to 250,000 voxels and place 2,000 copies, and either works whole or changes nothing. Changing another builder's object or prefab asks the user first.\n${STEPS_HELP}`,
      parameters: obj(
        {
          object: str('The object to build or add to, by name (a new name makes a new object), e.g. "Koi pond". Leave out when building a prefab.'),
          prefab: str('Build this prefab instead of an object (a new name makes a new one), e.g. "Palm tree". Build it around the origin, standing on y = 0: its bottom centre is the spot copies stand on, and +z is its front.'),
          description: str('A prefab: one line saying what it is'),
          tags: { type: 'array', items: { type: 'string' }, description: 'A prefab: words to find it by' },
          pivot: { description: 'A prefab: the point it stands on and turns around: "bottom" (default), "top" (an arm hanging from its shoulder), "center", or [x, y, z] map units' },
          steps: { type: 'array', items: { type: 'object' }, description: 'The build steps, in order' },
          anchor: str('New objects: what it is pinned to: "world", "brain", "team:<team id>" or "agent:<agent id>" (default "world")'),
          position: { type: 'array', items: { type: 'number' }, description: 'New objects: [x, y, z] in map units from the anchor (default [0, 0, 0])' },
          voxel_size: { type: 'number', description: "The voxel size the steps start with, in map units (default: the world's, usually 0.25). Change it in the steps with {\"voxel_size\": …}." },
          units: str('"map": every position and size in the steps is in map units, like world_info\'s (recommended). Default "voxels": whole voxels of the current voxel size.'),
          seed: { type: 'number', description: 'Optional: another seed gives another variation of the same steps' },
        },
        ['steps'],
      ),
      run: async (args, ctx) => {
        const a = args as { object?: string; prefab?: string; description?: unknown; tags?: unknown; steps: unknown; anchor?: unknown; position?: unknown; voxel_size?: unknown; units?: unknown; seed?: unknown };
        const refused = a.prefab ? await othersFirst(ctx, args, a.prefab, 'change the prefab', 'prefab') : await othersFirst(ctx, args, a.object, 'change');
        if (refused) return refused;
        try {
          const r = build({ by: builderOf(ctx), object: a.object, prefab: a.prefab, description: a.description, tags: a.tags, pivot: (a as { pivot?: unknown }).pivot, steps: a.steps, units: a.units, anchor: a.anchor, position: a.position, voxelSize: a.voxel_size, seed: a.seed });
          log('world', `${ctx.agent.name} ${r.created ? 'built' : 'changed'} ${r.kind === 'prefab' ? 'the prefab ' : ''}"${r.object.name}" in the world`, { agentId: ctx.agent.id });
          return { text: `${r.text}${r.kind === 'object' ? '\nIf this made a new place or changed a character, update WORLD.md (world_md_section) and add a line to "Story so far".' : ''}` };
        } catch (e) {
          return failed(e instanceof BuildError ? new Error(`Nothing was built. ${e.message}`) : e);
        }
      },
    },
    {
      name: 'world_script',
      group: 'world',
      risk: 'low',
      description: `Build with a small JavaScript program instead of a list of steps: for anything repetitive or procedural (a lane of cottages that each differ, branching trees, terrain from noise, a wall of random bricks, a spiral stair). Same targets, limits, undo and all-or-nothing as world_build; it runs sealed off (no files, no network) for at most ${SCRIPT_LIMITS.ms / 1000} seconds. Everything is in map units from the cursor (it starts at the object's origin, y = 0 the floor).
Build: use(material), material(name, {color, ramp, jitter, kind, emissive, opacity}), voxelSize(s), at(x, y, z), move(dx, dy, dz), mirror("x"), box([x, y, z], [w, h, d], opts) (from its corner), sphere(p, r, opts), ellipsoid(p, [rx, ry, rz], opts), blob(p, [rx, ry, rz], opts), cylinder(p, r, height, opts), cone(p, r, height, opts), line(a, b, opts), path([[x, z], …], width, opts), extrude([[x, z], …], height, opts), revolve(p, [[radius, height], …], opts), place(prefab, p, opts), stamp(prefab, p, opts), set(x, y, z, material) and erase(x, y, z) for single voxels, step({…}) for any world_build step (world_steps lists them). opts are a step's own fields: {use, erase, hollow, keep, turn, scale, swap, height…}.
Read: solid(x, y, z), materialAt(x, y, z), top(x, z) (the height of what is built there, or null). random() (seeded: the same each run unless "seed" changes), noise(x, z, cell) (0 to 1, smooth over cell map units), log(…) (comes back to you), and Math.
Example: use("dark wood"); for (let i = 0; i < 6; i++) { const h = 2 + random() * 1.5; box([i * 4, 0, 0], [3, h, 3]); use("roof tile"); box([i * 4 - 0.25, h, -0.25], [3.5, 0.5, 3.5]); use("dark wood"); }`,
      parameters: obj(
        {
          object: str('The object to build or add to, by name (a new name makes a new object). Leave out when building a prefab.'),
          prefab: str('Build this prefab instead of an object (a new name makes a new one), around the origin, standing on y = 0'),
          code: str('The JavaScript program'),
          description: str('A prefab: one line saying what it is'),
          tags: { type: 'array', items: { type: 'string' }, description: 'A prefab: words to find it by' },
          pivot: { description: 'A prefab: "bottom" (default), "top", "center", or [x, y, z] map units' },
          anchor: str('New objects: "world", "brain", "team:<team id>" or "agent:<agent id>" (default "world")'),
          position: { type: 'array', items: { type: 'number' }, description: 'New objects: [x, y, z] in map units from the anchor' },
          voxel_size: { type: 'number', description: "The voxel size it starts with (default: the world's). Change it with voxelSize()." },
          seed: { type: 'number', description: 'The seed for random() and noise() (default 1)' },
        },
        ['code'],
      ),
      run: async (args, ctx) => {
        const a = args as { object?: string; prefab?: string; code?: unknown; description?: unknown; tags?: unknown; pivot?: unknown; anchor?: unknown; position?: unknown; voxel_size?: unknown; seed?: unknown };
        const refused = a.prefab ? await othersFirst(ctx, args, a.prefab, 'change the prefab', 'prefab') : await othersFirst(ctx, args, a.object, 'change');
        if (refused) return refused;
        try {
          const qjs = await loadSandbox();
          const seed = a.seed === undefined ? 1 : Math.round(Number(a.seed)) || 1;
          let printed: string[] = [];
          const r = build({ by: builderOf(ctx), object: a.object, prefab: a.prefab, description: a.description, tags: a.tags, pivot: a.pivot, steps: [], drive: (api) => void (printed = runScript(qjs, String(a.code ?? ''), api, seed).log), anchor: a.anchor, position: a.position, voxelSize: a.voxel_size, seed });
          log('world', `${ctx.agent.name} ${r.created ? 'built' : 'changed'} ${r.kind === 'prefab' ? 'the prefab ' : ''}"${r.object.name}" in the world with a script`, { agentId: ctx.agent.id });
          return { text: `${r.text}${printed.length ? `\nThe script's log:\n${printed.join('\n')}` : ''}` };
        } catch (e) {
          return failed(e instanceof BuildError ? new Error(`Nothing was built. ${e.message}`) : e);
        }
      },
    },
    {
      name: 'world_steps',
      group: 'world',
      risk: 'none',
      description: `Every build step world_build knows, by topic: ${Object.keys(STEP_TOPICS).join(', ')}, or "all". world_build's description has the common ones; look here for the rest before you use them.`,
      parameters: obj({ topic: str(`One of: ${Object.keys(STEP_TOPICS).join(', ')}, or "all" (default)`) }),
      run: async ({ topic }: { topic?: string }) => {
        const t = String(topic || 'all').trim().toLowerCase();
        if (t === 'all') return { text: Object.values(STEP_TOPICS).join('\n\n') };
        const text = STEP_TOPICS[t];
        return text ? { text } : { text: `No topic "${topic}". Topics: ${Object.keys(STEP_TOPICS).join(', ')}, or "all".`, isError: true };
      },
    },
    {
      name: 'world_object',
      group: 'world',
      // deleting is high; changing someone else's object asks too (see run)
      risk: ({ delete: del }: { delete?: boolean }) => (del === true ? 'high' : 'low'),
      description: 'Move, turn, scale, rename, hide or show, copy, re-anchor or delete an object in the voxel world. Only the fields you give change. A deleted object can be brought back with world_undo.',
      parameters: obj(
        {
          object: str('The object, by name or id'),
          name: str('A new name (or, with duplicate, the copy\'s name)'),
          position: { type: 'array', items: { type: 'number' }, description: '[x, y, z] in map units from its anchor' },
          move: { type: 'array', items: { type: 'number' }, description: '[dx, dy, dz] in map units' },
          rotation: { type: 'number', description: 'Degrees around the vertical' },
          scale: { type: 'number', description: '0.1 to 10' },
          anchor: str('"world", "brain", "team:<id>" or "agent:<id>"'),
          hidden: { type: 'boolean', description: 'Hide it (true) or show it again (false)' },
          duplicate: { type: 'boolean', description: 'Make a copy (with position or move for where)' },
          delete: { type: 'boolean', description: 'Delete it' },
        },
        ['object'],
      ),
      run: async (args, ctx) => {
        const a = args as Record<string, unknown> & { object: string };
        // a delete was already asked about (its risk is high); asking again for someone else's would be twice
        if (a.duplicate !== true && a.delete !== true) {
          const refused = await othersFirst(ctx, args, a.object, 'change');
          if (refused) return refused;
        }
        try {
          // only the tool's own fields: which project's world it changes is never the model's to pick
          const r = changeObject({ by: builderOf(ctx), object: String(a.object ?? ''), name: a.name, position: a.position, move: a.move, rotation: a.rotation, scale: a.scale, anchor: a.anchor, hidden: a.hidden, duplicate: a.duplicate, delete: a.delete });
          log('world', `${ctx.agent.name}: ${r.text.split('.')[0]}`, { agentId: ctx.agent.id });
          return { text: r.text };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_undo',
      group: 'world',
      risk: 'low',
      description: "Undo your last change in the voxel world (a build, a move, a delete). Call it again to go further back. It won't undo over someone else's later change to the same object.",
      parameters: obj({}),
      run: async (_args, ctx) => {
        try {
          return { text: undo(builderOf(ctx)).text };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_prefab',
      group: 'world',
      risk: ({ action }: { action?: string }) => (action === 'delete' ? 'high' : 'low'),
      description: 'Prefabs: small models made once and placed many times (people, trees, lamps, cars, boats, stalls, windows). Actions: "list" (this world\'s prefabs, where they are used), "save" (make a prefab from an object, or a box of it, in map units from its origin; "replace": true turns that part into a copy of the new prefab), "change" (name, description, tags), "delete" (only when no copy is placed), "publish" (share it with every world and project in the prefab library), "library" (what is in the library; "query" to search), "import" (take one from the library into this world). Build a new prefab with world_build and "prefab"; place copies with the "place" step.',
      parameters: obj(
        {
          action: str('"list", "save", "change", "delete", "publish", "library" or "import"'),
          prefab: str('The prefab (name or id); for save and import, the new name'),
          from: str('save: the object to take it from'),
          box: { type: 'object', description: 'save: {"min": [x, y, z], "max": [x, y, z]} in map units from the object\'s origin (default: all of it)' },
          replace: { type: 'boolean', description: 'save: put a copy of the new prefab where that part was' },
          name: str('change: a new name; import: the library prefab to take'),
          description: str('save, change: one line saying what it is'),
          tags: { type: 'array', items: { type: 'string' }, description: 'save, change: words to find it by' },
          query: str('library: words to search for'),
          pivot: { description: 'change: the point it stands on and turns around: "bottom", "top", "center" or [x, y, z]' },
        },
        ['action'],
      ),
      run: async (args, ctx) => {
        const a = args as { action?: string; prefab?: string; from?: string; box?: unknown; replace?: boolean; name?: string; description?: unknown; tags?: unknown; query?: string };
        const by = builderOf(ctx);
        try {
          const w = shownWorld().world;
          switch (a.action) {
            case 'list':
              return { text: w ? prefabList(w) : 'No world yet.' };
            case 'library':
              return { text: libraryList(a.query || '') };
            case 'save': {
              if (a.replace) {
                const refused = await othersFirst(ctx, args, a.from, 'change');
                if (refused) return refused;
              }
              return { text: savePrefabFrom({ by, name: String(a.prefab || a.name || ''), from: String(a.from || ''), box: a.box, description: a.description, tags: a.tags, replace: a.replace === true }).text };
            }
            case 'change': {
              const refused = await othersFirst(ctx, args, a.prefab, 'change the prefab', 'prefab');
              if (refused) return refused;
              return { text: changePrefab({ by, prefab: String(a.prefab || ''), name: a.name, description: a.description, tags: a.tags, pivot: (a as { pivot?: unknown }).pivot }).text };
            }
            case 'delete':
              return { text: deletePrefab({ by, prefab: String(a.prefab || '') }) };
            case 'publish':
              return { text: publishPrefab({ by, prefab: String(a.prefab || '') }) };
            case 'import':
              return { text: importPrefab({ by, name: String(a.name || a.prefab || ''), as: a.name && a.prefab ? a.prefab : undefined }).text };
            default:
              return { text: 'action is "list", "save", "change", "delete", "publish", "library" or "import".', isError: true };
          }
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_light',
      group: 'world',
      risk: ({ action }: { action?: string }) => (action === 'remove' ? 'high' : 'low'),
      description: 'Put up, change or take away a light in the voxel world. Glowing voxels (materials of kind "emissive": lanterns, windows, signs, headlights) already light what is around them; add a light for what voxels can\'t do: a warm light spilling out of a doorway, a spotlight on a statue, a fire\'s flicker, moonlight on water. A world has at most 32.',
      parameters: obj(
        {
          action: str('"add", "change" or "remove"'),
          light: str('change, remove: the light (name or id)'),
          name: str('A name, e.g. "Temple doorway"'),
          kind: str('"point" (shines all around) or "spot" (a cone towards target)'),
          color: str('#rrggbb, e.g. #ffb860 for warm lamplight'),
          intensity: { type: 'number', description: '0-10: 1 a lantern, 4 a street lamp, 10 a floodlight' },
          range: { type: 'number', description: 'How far it reaches, map units' },
          anchor: str('"world", "brain", "team:<id>" or "agent:<id>"'),
          object: str('Pin it to an object (name or id): position is then from that object, and it moves with it'),
          position: { type: 'array', items: { type: 'number' }, description: '[x, y, z] map units' },
          target: { type: 'array', items: { type: 'number' }, description: 'spot: the point it shines at' },
          angle: { type: 'number', description: 'spot: the cone, degrees' },
          flicker: { type: 'number', description: '0-1: flames and old neon flicker' },
        },
        ['action'],
      ),
      run: async (args, ctx) => {
        const { action, light, ...fields } = args as Record<string, unknown> & { action?: string; light?: string };
        if (action !== 'add' && action !== 'change' && action !== 'remove') return { text: 'action is "add", "change" or "remove".', isError: true };
        try {
          return { text: setLight({ by: builderOf(ctx), action, light, fields }).text };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_effect',
      group: 'world',
      risk: ({ action }: { action?: string }) => (action === 'remove' ? 'high' : 'low'),
      description: `Add, change or take away particles in an area of the voxel world: ${EFFECT_KINDS.join(', ')}. Petals under blossoming trees, fireflies over a pond at night, smoke from a chimney, steam from a street grate, embers from a fire, mist on the river, birds circling a tower. For weather over the whole map use world_environment instead. A world has at most 24.`,
      parameters: obj(
        {
          action: str('"add", "change" or "remove"'),
          effect: str('change, remove: the effect (name or id)'),
          kind: str(EFFECT_KINDS.join(', ')),
          name: str('A name, e.g. "Chimney smoke"'),
          size: { type: 'array', items: { type: 'number' }, description: 'The area [w, h, d] in map units, around position (its bottom centre)' },
          amount: { type: 'number', description: '0-1: how many' },
          colors: { type: 'array', items: { type: 'string' }, description: 'Colours to pick from (#rrggbb); each kind has its own when left out' },
          wind: { type: 'array', items: { type: 'number' }, description: '[x, y, z] which way it drifts, map units a second' },
          anchor: str('"world", "brain", "team:<id>" or "agent:<id>"'),
          object: str('Pin it to an object (name or id): it moves with it'),
          position: { type: 'array', items: { type: 'number' }, description: '[x, y, z] map units: the bottom centre of the area' },
        },
        ['action'],
      ),
      run: async (args, ctx) => {
        const { action, effect, ...fields } = args as Record<string, unknown> & { action?: string; effect?: string };
        if (action !== 'add' && action !== 'change' && action !== 'remove') return { text: 'action is "add", "change" or "remove".', isError: true };
        try {
          return { text: setEffect({ by: builderOf(ctx), action, effect, fields }).text };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_environment',
      group: 'world',
      risk: 'low',
      description: 'The voxel world\'s time of day, sky, sun, fog, weather and wind. Start from a preset (station, day, golden, dusk, night, overcast, snow) and change any part: {"preset": "dusk", "sun": {"elevation": 8}, "fog": {"density": 0.4}, "weather": "snow", "wind": [1, 0, 0.5]}. It eases from the old look to the new one. Match WORLD.md: a golden desert, a snowy city at dusk, a night market.',
      parameters: obj({
        preset: str('station, day, golden, dusk, night, overcast or snow'),
        sky: { type: 'object', description: '{"top", "horizon", "bottom"}: colours #rrggbb' },
        sun: { type: 'object', description: '{"color", "intensity" 0-8, "azimuth" degrees, "elevation" 2-90 degrees}' },
        fog: { type: 'object', description: '{"color", "density" 0-1}' },
        ambient: { type: 'object', description: '{"sky", "ground" colours, "intensity" 0-4}: the light from the sky and from the ground' },
        bloom: { type: 'number', description: '0-2: glow around bright things' },
        tiltShift: { type: 'number', description: '0-1: the miniature blur at the top and bottom' },
        exposure: { type: 'number', description: '0.3-3' },
        weather: str('none, snow, rain, petals, leaves or dust (over the whole map)'),
        wind: { type: 'array', items: { type: 'number' }, description: '[x, y, z] map units a second: drifts snow and petals, sways leaves' },
      }),
      run: async (args, ctx) => {
        try {
          return { text: setEnvironment({ by: builderOf(ctx), fields: args as Record<string, unknown> }).text };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_look',
      group: 'world',
      risk: 'none',
      description: 'See the voxel world: a picture of the whole of it, or of one thing (the Brain, a team, an agent, an object, or a prefab on its own), from the Station\'s angle or another. Look after you build and fix what looks wrong: proportions, colours that clash, things floating or sunk, gaps, too dark or too bright. The picture is made by an open Station page; when none is open you get a top-down map in words instead.',
      parameters: obj({
        target: str('"overview" (default), "brain", "team", "agent", "object" or "prefab"'),
        name: str('The team, agent, object or prefab (name or id)'),
        azimuth: { type: 'number', description: 'Degrees around (the Station looks from 45)' },
        elevation: { type: 'number', description: 'Degrees up (the Station looks from 35; 90 is straight down)' },
        zoom: { type: 'number', description: '1 fits the target (default); 2 is twice as close' },
        save: { type: 'boolean', description: 'Also save the picture to Artifacts (to show the user, or for a post)' },
      }),
      run: async (args, ctx) => {
        const a = args as { target?: string; name?: string; azimuth?: unknown; elevation?: unknown; zoom?: unknown };
        const shown = shownWorld();
        const w = shown.world;
        if (!w) return { text: 'There is no world yet: build something first.' };
        const target = (a.target || 'overview') as WorldLookView['target'];
        if (!['overview', 'brain', 'team', 'agent', 'object', 'prefab'].includes(target)) return { text: 'target is overview, brain, team, agent, object or prefab.', isError: true };
        let id: string | undefined;
        let label = target === 'overview' ? 'the whole world' : target === 'brain' ? 'the Brain' : '';
        try {
          if (target === 'team' || target === 'agent') {
            const t = skinTarget(target, a.name || (target === 'agent' ? ctx.agent.id : ''));
            id = t.id;
            label = t.name;
          } else if (target === 'object' || target === 'prefab') {
            const o = target === 'object' ? findObject(w, a.name) : findPrefab(w, a.name);
            if (!o) return { text: `There's no ${target} "${a.name || ''}". world_info lists them.`, isError: true };
            id = o.id;
            label = `${target === 'prefab' ? 'the prefab' : ''} "${o.name}"`.trim();
          }
        } catch (e) {
          return failed(e);
        }
        const n = (v: unknown, min: number, max: number) => (v === undefined || !Number.isFinite(Number(v)) ? undefined : Math.max(min, Math.min(max, Number(v))));
        const view: WorldLookView = { target, ...(id ? { id } : {}), azimuth: n(a.azimuth, -720, 720), elevation: n(a.elevation, 5, 90), zoom: n(a.zoom, 0.2, 8), width: 1024, height: 640 };
        let turnedOn = false;
        if (getSettings().look.stationLook !== 'world') {
          ctx.progress?.('Asking you to turn on the voxel look…');
          turnedOn = await askForVoxelLook(ctx.agent);
          if (!turnedOn) return { text: `No picture: the user kept the Station in the classic look, which doesn't draw the voxel world. Don't ask again in this task.${target === 'object' || target === 'prefab' ? `\nHere is a map from above instead.\n${objectMap(w, id!)}` : '\nworld_info has where everything stands.'}` };
        }
        ctx.progress?.(`Looking at ${label}…`);
        let r = await requestLook(w.id, activeProject().id, view);
        // just switched: the open Stations are still loading the world, so ask again for a few seconds
        for (const until = Date.now() + LOOK_SWITCH_MS; turnedOn && !r.image && r.note !== 'no page is open' && Date.now() < until; ) {
          await new Promise((done) => setTimeout(done, 1500));
          r = await requestLook(w.id, activeProject().id, view);
        }
        if (r.image) {
          let saved = '';
          if ((a as { save?: boolean }).save === true) {
            const { addArtifact } = await import('../artifacts.ts');
            const file = writePicture(files.writableDir(ctx, 'pictures'), `${w.name} ${label}`, r.image);
            addArtifact({ title: `${cap(label)} in ${w.name}`, path: file, note: 'A picture of the voxel world', agentId: ctx.agent.id });
            saved = ` Saved to Artifacts: ${file}`;
          }
          return { text: `${cap(label)} in "${w.name}" (${w.environment.preset}${view.azimuth !== undefined ? `, from ${view.azimuth}°` : ''}).${saved}`, images: [r.image] };
        }
        // no picture: why, so the user can be asked for the right thing, and the next best thing
        const why =
          getSettings().look.stationLook !== 'world'
            ? 'the Station is in the classic look, which doesn\'t draw the voxel world. Ask the user to turn on Settings › Look › Station look › Voxel world.'
            : r.note === 'no page is open'
              ? 'the dashboard isn\'t open in any window. Ask the user to open the Station.'
              : `no open Station could draw it (${r.note || 'no answer'}). Ask the user to open the Station with this project open.`;
        const map = target === 'object' || target === 'prefab' ? `\nHere is a map from above instead.\n${objectMap(w, id!)}` : '\nworld_info has where everything stands in the meantime.';
        return { text: `No picture: ${why}${map}` };
      },
    },
    {
      name: 'world_import',
      group: 'world',
      risk: 'low',
      description: 'Bring a MagicaVoxel .vox file into the voxel world, as a prefab (to place copies of) or an object. Every model in the file comes in where the file places it; its colours become materials named "<name> 1", "<name> 2"… (change them with {"material": …} steps). The file must be in a folder you may read (your workspace, files the user gave you).',
      parameters: obj(
        {
          file: str('The .vox file'),
          as: str('"prefab" (default) or "object"'),
          name: str('Its name in the world (default: the file\'s)'),
          voxel_size: { type: 'number', description: 'Map units per voxel (default 0.1 for a prefab, the world\'s for an object)' },
          anchor: str('object: "world", "brain", "team:<id>" or "agent:<id>"'),
          position: { type: 'array', items: { type: 'number' }, description: 'object: [x, y, z] map units' },
        },
        ['file'],
      ),
      run: async (args, ctx) => {
        const a = args as { file?: string; as?: string; name?: string; voxel_size?: unknown; anchor?: unknown; position?: unknown };
        try {
          const file = files.readable(ctx, a.file);
          return { text: importVox({ by: builderOf(ctx), file, as: a.as === 'object' ? 'object' : 'prefab', name: String(a.name || ''), voxelSize: a.voxel_size, anchor: a.anchor, position: a.position }) };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_export',
      group: 'world',
      risk: 'low',
      description: 'Save an object, a prefab or the whole voxel world as a file, to Artifacts (and your workspace\'s exports folder): "glb" is a glTF 3D model for Blender, game engines and the web (placed copies stay copies); "vox" is a MagicaVoxel file (one per voxel size; not for the whole world).',
      parameters: obj(
        {
          what: str('"object", "prefab" or "world"'),
          name: str('The object or prefab (name or id)'),
          format: str('"glb" (default) or "vox"'),
        },
        ['what'],
      ),
      run: async (args, ctx) => {
        const a = args as { what?: string; name?: string; format?: string };
        const w = shownWorld().world;
        if (!w) return { text: 'There is no world yet.', isError: true };
        if (a.what !== 'object' && a.what !== 'prefab' && a.what !== 'world') return { text: 'what is "object", "prefab" or "world".', isError: true };
        try {
          const out = exportFiles(w, a.what, a.name, a.format === 'vox' ? 'vox' : 'glb');
          const paths = writeFiles(files.writableDir(ctx, 'exports'), out.files);
          const { addArtifact } = await import('../artifacts.ts');
          for (const p of paths) addArtifact({ title: out.files.length > 1 ? `${out.title}: ${p.split(/[\\/]/).pop()}` : out.title, path: p, note: out.note || 'Made from the voxel world', agentId: ctx.agent.id });
          return { text: `Saved ${paths.join(', ')} (${out.files.map((f) => `${Math.round(f.bytes.length / 1024)} KB`).join(', ')}) and added ${paths.length > 1 ? 'them' : 'it'} to Artifacts.${out.note ? ` ${out.note}` : ''}` };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_skin',
      group: 'world',
      // dressing yourself or your own team is yours to do; anyone else, or the Brain, asks first (see run)
      risk: 'low',
      description: 'Dress the Brain, a team or an agent in the voxel world, or take them off the map (artistic freedom). An agent: its "character", whatever form it takes in this world (any prefab: a person, an animal, a tree, a lamp, a floating crystal; with named parts for world_animate to move, or moved whole), in the classic person\'s place, its "desk" (a prefab; the live screen stays), and "states": which animation plays when it is idle, working or waiting for the user (default: the character\'s "idle", "working" and "needs"). A team: its "platform" and the "hub" in its middle (prefabs; a platform\'s radius is in world_info). The Brain: a "shell" prefab around it, "globe": false to hide the particle globe. Any of them: "offset" [x, y, z] map units, "turn" degrees, "scale", "hidden": true to take it off the map (it still works: click its name), "label": false to hide its name too, "clear": true to look classic again. Dressing yourself or your own team needs no OK; anyone else, or the Brain, asks the user first.',
      parameters: obj(
        {
          to: str('"agent", "team" or "brain"'),
          id: str('The agent or team (name or id); not for the Brain'),
          character: str('agent: the prefab it takes the form of (a person, an animal, a tree, an object…)'),
          desk: str('agent: a prefab name'),
          states: { type: 'object', description: 'agent: {"idle": "clip", "working": "clip", "needs": "clip"}' },
          platform: str('team: a prefab name'),
          hub: str('team: a prefab name'),
          shell: str('brain: a prefab name'),
          globe: { type: 'boolean', description: 'brain: keep the particle globe (default true)' },
          offset: { type: 'array', items: { type: 'number' }, description: '[x, y, z] map units from the classic model\'s spot' },
          turn: { type: 'number', description: 'Degrees around the vertical' },
          scale: { type: 'number', description: '0.1 to 10' },
          hidden: { type: 'boolean', description: 'Take it off the map' },
          label: { type: 'boolean', description: 'false: no name label on the map either' },
          clear: { type: 'boolean', description: 'Back to the classic look' },
        },
        ['to'],
      ),
      run: async (args, ctx) => {
        const { to, id, ...fields } = args as Record<string, unknown> & { to?: string; id?: string };
        try {
          if (to !== 'agent' && to !== 'team' && to !== 'brain') return { text: 'to is "agent", "team" or "brain".', isError: true };
          const target = skinTarget(to, to === 'agent' ? id || ctx.agent.id : id);
          const mine = to === 'agent' ? target.id === ctx.agent.id : to === 'team' ? (workflows.get(target.id)?.members || []).includes(ctx.agent.id) : false;
          if (!mine) {
            const refused = await gate(ctx.agent, 'world_skin_others', 'high', args, ctx, `${ctx.agent.name} wants to change how ${target.name} looks in the voxel world${fields.hidden === true ? ' (take it off the map)' : ''}.`);
            if (refused) return refused;
          }
          return { text: setSkin({ by: builderOf(ctx), to, id: target.id, fields }).text };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_animate',
      group: 'world',
      risk: 'low',
      description: 'Design animations for a prefab an agent takes the form of (a person, an animal, a tree, an object), or play one. Its parts are copies of part prefabs placed with "name" ("head", "left arm", "branch", "lid"); each part turns around its pivot (give an arm the pivot "top" so it swings from the shoulder). A prefab without parts can still move whole with "self" (a lamp that pulses, a tree that sways, a crystal that spins and bobs). An animation is keys per part over time: {"duration": 1.2, "loop": true, "tracks": {"left arm": [{"t": 0, "turn": [0, 0, 0]}, {"t": 0.5, "turn": [-40, 0, 0], "ease": "smooth"}, {"t": 1, "turn": [0, 0, 0], "ease": "smooth"}], "self": [{"t": 0, "move": [0, 0, 0]}, {"t": 0.5, "move": [0, 0.05, 0]}, {"t": 1, "move": [0, 0, 0]}]}}. "t" goes from 0 to 1 over the duration; "turn" is degrees [x, y, z] (x tips forward and back), "move" map units, "scale", "ease" linear, smooth, step or bounce; "self" moves the whole character. Name them "idle", "working" and "needs" to play when the agent is idle, working or waiting for the user, or anything else and pick it with world_skin "states". Actions: "set" (save one), "remove", "list" (parts and animations), "play" (play one once on an agent wearing the character: a cheer when work is done, a bow).',
      parameters: obj(
        {
          action: str('"set", "remove", "list" or "play"'),
          prefab: str('The character prefab (set, remove, list)'),
          clip: str('The animation\'s name'),
          duration: { type: 'number', description: 'set: seconds' },
          loop: { type: 'boolean', description: 'set: loop (default true)' },
          tracks: { type: 'object', description: 'set: {"part name": [keys], "self": [keys]}' },
          agent: str('play: the agent (name or id); default: you'),
          times: { type: 'number', description: 'play: how many times (default 1)' },
        },
        ['action'],
      ),
      run: async (args, ctx) => {
        const a = args as { action?: string; prefab?: string; clip?: string; duration?: unknown; loop?: unknown; tracks?: unknown; agent?: string; times?: unknown };
        try {
          if (a.action === 'play') return { text: playAnimation({ by: builderOf(ctx), agent: a.agent || ctx.agent.id, clip: String(a.clip || ''), times: a.times }) };
          if (a.action !== 'set' && a.action !== 'remove' && a.action !== 'list') return { text: 'action is "set", "remove", "list" or "play".', isError: true };
          if (a.action !== 'list') {
            const refused = await othersFirst(ctx, args, a.prefab, 'change the animations of', 'prefab');
            if (refused) return refused;
          }
          return { text: setAnimation({ by: builderOf(ctx), prefab: String(a.prefab || ''), action: a.action, clip: a.clip, fields: { duration: a.duration, loop: a.loop, tracks: a.tracks } }).text };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_md_read',
      group: 'world',
      risk: 'none',
      description: "Read the world's WORLD.md as it is now: its theme and meaning, look, feel, places, characters, story and rules (your instructions have it as it was when this chat started, maybe cut short).",
      parameters: obj({}),
      run: async (_args, ctx) => {
        const w = shownWorld().world;
        if (!w) return { text: 'There is no world yet: your first world_build starts one, with a WORLD.md to fill in.' };
        mdRead.set(readKey(ctx, w.id), worldMdStamp(w.id));
        return { text: readWorldMd(w.id) };
      },
    },
    {
      name: 'world_md_section',
      group: 'world',
      risk: 'low',
      description: 'Change one section of WORLD.md: replace it, or add to its end with append. Name it by its heading, or a path of headings: "Places › Koi pond", "Characters › Mira", "Story so far". A section that isn\'t there yet is added. Use this after you build a place or dress a character, and add one line to "Story so far" (append) after each build. The earlier version is kept.',
      parameters: obj(
        {
          section: str('The heading, or a path: "Places › Koi pond"'),
          content: str('The new text of the section (Markdown), or with append the text to add'),
          append: { type: 'boolean', description: 'Add to the end of the section instead of replacing it' },
        },
        ['section', 'content'],
      ),
      run: async ({ section, content, append }: { section: string; content: string; append?: boolean }, ctx) => {
        const w = shownWorld().world;
        if (!w || shownWorld().how === 'carried') return { text: "This project has no world of its own yet: build something first (it makes this project's world), then write its WORLD.md.", isError: true };
        try {
          // only a builder that had read the version it changed has read the result (it never sees the rest)
          const key = readKey(ctx, w.id);
          const fresh = mdRead.has(key) && mdRead.get(key) === worldMdStamp(w.id);
          const r = withActor('agent', () => writeWorldMdSection(w.id, String(section), content, append === true));
          if (fresh) mdRead.set(key, r.updatedAt);
          return { text: `Saved WORLD.md (${r.text.length.toLocaleString('en-US')} characters).` };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: 'world_md_write',
      group: 'world',
      risk: 'low',
      description: 'Replace the whole WORLD.md (Markdown). Read it with world_md_read first in this chat: a rewrite over a version you haven\'t seen is refused. For one section, use world_md_section instead. The earlier version is kept.',
      parameters: obj({ content: str('The whole new WORLD.md') }, ['content']),
      run: async ({ content }: { content: string }, ctx) => {
        const w = shownWorld().world;
        if (!w || shownWorld().how === 'carried') return { text: "This project has no world of its own yet: build something first (it makes this project's world), then write its WORLD.md.", isError: true };
        const seen = mdRead.get(readKey(ctx, w.id));
        if (seen === undefined) return { text: 'Read WORLD.md with world_md_read first, so nothing in it is lost.', isError: true };
        if (seen !== worldMdStamp(w.id)) return { text: 'WORLD.md changed since you read it. Read it again with world_md_read, then write.', isError: true };
        try {
          const r = withActor('agent', () => writeWorldMd(w.id, content));
          mdRead.set(readKey(ctx, w.id), r.updatedAt);
          return { text: `Saved WORLD.md (${r.text.length.toLocaleString('en-US')} characters).` };
        } catch (e) {
          return failed(e);
        }
      },
    },
  ];
}

/** For a builder's instructions: the world's WORLD.md (only for agents with the world tools). */
export function worldPrompt(toolNames: string[]): string {
  if (!toolNames.includes('world_build')) return '';
  const shown = shownWorld();
  if (!shown.world) return `\n# The voxel world\n${DIORAMA}\n${BUILD_ORDER}\nThere is no world yet. Your first world_build starts this project's world; then fill in its WORLD.md (world_md_section) with what it is.`;
  return worldMdContext(shown.world.id, shown.world.name);
}

export { VERBS };
