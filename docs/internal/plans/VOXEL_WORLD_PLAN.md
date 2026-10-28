# Voxel world: plan

The Brain and the agents build a voxel world around themselves on the Station, and can rebuild the Brain's orb,
the team platforms and the agents themselves as voxel characters and objects. Voxel size is per object and can
change in the middle of a build. Lights and effects (glow, particles, water, weather, time of day) are part of
the world, so a build can look like the references: a floating island with a pagoda and falling petals, a
lit waterwheel workshop, a snowy street at dusk with neon and headlights.

Each world has a **WORLD.md**: the world's theme, meaning, look, feel, places and characters in plain words.
Every builder reads it before building and keeps it up to date, and the user can edit it too.

Status: plan, nothing built yet. Written 2026-10-27, decisions from the first review added the same day (§14).

---

## 1. What makes the references look good (and what we copy)

Looking at the four images, the look comes from a few things, and most of them are cheap:

| What you see | How we get it |
|---|---|
| Every cube a slightly different shade (grass, brick, wood grain, snow) | **Per-voxel color jitter** from a seeded hash, plus palette "ramps" (3-5 shades per material). Done at build time on the server, so LLMs never pick 50,000 colors by hand. |
| Soft dark creases where cubes meet | **Per-vertex ambient occlusion** baked into the mesh (the classic voxel AO), plus screen-space AO in post. |
| Warm lanterns, neon signs, lit windows, headlights | **Emissive materials** that glow (bloom) and, in clusters, **become real point lights** (capped budget). |
| Long sun shadows, golden or blue hour | One **sun with soft shadows**, **hemisphere sky light**, **tone mapping** and a **time-of-day preset**. |
| Miniature, toy-like feel | **Tilt-shift** depth of field in post, plus the orthographic camera the Station already uses. |
| Petals, snow, waterfall foam, red smoke, birds | **Particle effects** made of tiny cubes (they match the style), and a few simple flocks. |
| Water, glass, ice | **Transparent / animated materials** per palette entry (water scrolls and shimmers). |
| Snow on every ledge | A **`snow_cover` op** that puts snow on top faces of an area. Same idea for moss and vines (`overgrow`). |
| Big, believable structures | **Shape tools** that do the voxel-by-voxel work (revolve a profile into a column or dome, extrude a floor plan into walls, sweep a path into a road or river, noise terrain, rough organic blobs), driven by the agent's design. |
| Hundreds of people, palms, lamps, taxis, boats | **Prefabs the agents make themselves**, then **placed many times** (along a street, in a grid, scattered on the ground), turned, mirrored and recoloured per copy. Drawn as instances, so a crowd costs almost nothing. |

The design below follows from that: a declarative **op language** runs on the server, with no built-in content:
everything on screen is something an agent built (§4b). A renderer upgrade (lighting, AO, bloom, tilt-shift,
particles) runs in the page.

---

## 2. Core ideas

1. **A world per project, and worlds can carry over.** Worlds are kept in a library of their own
   (`data/worlds/<worldId>/`), and each project points at one. A project whose own world is still unbuilt
   shows a built world from another project, and the user can pick which world each project uses (§3a).
   The world a project uses is auto-saved into `<project>/.dashboard` like the layout is, and is part of backups.
2. **Objects, each with its own voxel grid.** An object is a group of *volumes*; each volume has its own
   voxel size. That is what makes voxel size "dynamic and settable during building": a build can say
   `{"voxel_size": 0.5}` for the island's ground, then `{"voxel_size": 0.125}` for the lanterns on it, and
   both end up in one object. Terrain can be coarse, characters fine.
3. **Declarative ops, no code.** Builders send JSON ops (`box`, `sphere`, `layers`, `tree`, `island`, …).
   The server checks, caps and runs them. Nothing is evaluated as code.
4. **Anchors.** An object can be pinned to the world, the Brain, a team platform or an agent, so it moves
   when you drag a team around the map.
5. **Skins.** The Brain, each team platform and each agent (character + desk) can have a voxel skin. Skins
   replace today's meshes but keep everything the map does with them: picking, labels, rings, the desk
   monitor, status animations, drag and drop.
6. **Plots.** Each team "owns" the ring of ground around its platform; the Brain owns the middle. Agents build
   in their own plot by default. Changing someone else's build asks first (see Risk).
7. **Look and lights are data too.** Lights, effects and the environment (sky, fog, sun, time of day,
   weather) are stored in the world and changed with tools, so an agent can say "make it dusk and snowing".
8. **WORLD.md gives the world a meaning.** It says what the world *is*: theme, meaning, look, feel, places,
   characters, rules. Builders read it first and update it as they build (§3b). It travels with the world,
   not with the project.
9. **Agents build, people steer.** There is no building by hand. The user shapes the world by talking to the
   Brain and agents, editing WORLD.md, and hiding, undoing or deleting objects.

---

## 3. Data model (`shared/types.ts`)

Sketch, not final names:

```ts
/** A voxel world (data/worlds/<id>/world.json). Projects point at one (§3a). */
export interface VoxelWorld {
  format: 1;
  id: string;
  name: string;                 // "Hanami garden"; the user can rename it
  /** the project it was first made for (its "home"); other projects may share or copy it */
  homeProject: string;
  /** false until the first object, skin, light or effect: an unbuilt world can be replaced by a carried-over one */
  built: boolean;
  /** voxel size new objects start with, in map units (a desk is 2.6 wide). Settable any time. */
  voxelSize: number;            // default 0.25, range 0.05..4
  palette: VoxelMaterial[];     // index 0 = empty; up to 255
  objects: VoxelObjectMeta[];   // voxel data lives in objects/<id>.json
  lights: WorldLight[];
  effects: WorldEffect[];
  environment: WorldEnvironment;
  skins: { brain?: Skin; teams: Record<string, Skin>; agents: Record<string, Skin> };
  updatedAt: number;
}

export interface VoxelMaterial {
  name: string;                 // "grass", "red lacquer", "neon pink"
  color: string;                // #rrggbb base
  ramp?: string[];              // extra shades picked by jitter
  jitter?: number;              // 0..0.3 brightness variation per voxel
  kind: 'solid' | 'glass' | 'water' | 'emissive' | 'metal' | 'leaf' | 'snow';
  emissive?: number;            // 0..8 (emissive kind): how bright it glows
  opacity?: number;             // glass / water
  roughness?: number;
}

export interface VoxelObjectMeta {
  id: string;
  name: string;
  by: { kind: 'brain' | 'agent' | 'user'; id?: string; name: string };
  anchor: Anchor;               // { to: 'world' } | { to: 'brain' } | { to: 'team', id } | { to: 'agent', id }
  position: Vec3; rotationY: number; scale: number;
  /** where it last stood in the world: used when its anchor (a team or agent) isn't in the project showing it */
  lastWorldPos?: Vec3;
  volumes: { id: string; voxelSize: number; offset: Vec3; size: Vec3; count: number }[];
  hidden?: boolean;
  /** a skin or prop built from a recipe is rebuilt when its parameters change (a platform's radius) */
  recipe?: { generator: string; params: Record<string, unknown> };
  createdAt: number; updatedAt: number;
}

/** Voxel data: sparse 16³ chunks, palette indices, run-length encoded, base64 (objects/<id>.json). */
export interface VoxelVolumeData { voxelSize: number; chunks: Record<string /* "cx,cy,cz" */, string> }

export interface WorldLight {
  id: string; kind: 'point' | 'spot' | 'area' | 'sun';
  color: string; intensity: number; range?: number;
  anchor: Anchor; position: Vec3; target?: Vec3; angle?: number;
  flicker?: number;             // 0..1, for lanterns and neon
  shadows?: boolean;            // only a few may cast shadows
  by: VoxelObjectMeta['by'];
}

export interface WorldEffect {
  id: string;
  kind: 'petals' | 'leaves' | 'snow' | 'rain' | 'fireflies' | 'embers' | 'sparks' | 'smoke'
      | 'steam' | 'mist' | 'foam' | 'birds' | 'clouds' | 'god_rays';
  anchor: Anchor; area: { min: Vec3; max: Vec3 } | { at: Vec3; radius: number };
  rate: number; color?: string | string[]; size?: number; wind?: Vec3; by: VoxelObjectMeta['by'];
}

export interface WorldEnvironment {
  preset: 'station' | 'day' | 'golden' | 'dusk' | 'night' | 'overcast' | 'snow';
  sky: { top: string; horizon: string; bottom: string };
  fog: { color: string; density: number };
  sun: { color: string; intensity: number; azimuth: number; elevation: number };
  ambient: { sky: string; ground: string; intensity: number };
  bloom: number; tiltShift: number; ao: number; exposure: number;
  weather?: 'none' | 'snow' | 'rain' | 'petals';
}

/** A skin: a stored object, or a recipe re-run when the thing it dresses changes. */
export type Skin = { objectId: string } | { recipe: { generator: string; params: Record<string, unknown> } };
```

Units: the Station's own units. Today a desk is 2.6 × 1.3, an agent is about 1.7 tall, a platform's radius is
6+. So voxel size 0.25 gives a desk about 10 voxels wide; a character at 0.1 is about 17 voxels tall, which is
the detail level in the snowy street images.

Limits (checked on the server, numbers to tune in the spike):
- 256 voxels per side per volume, 16 volumes per object, 300 objects per world.
- 250,000 voxels changed per tool call, 4,000,000 voxels per world.
- 32 lights stored (the renderer picks the 8-12 nearest to show as real lights), 24 effects.

---

## 3a. Which world a project shows

Worlds live in `data/worlds/<worldId>/` (world data, objects, history, WORLD.md and its kept versions).
A project holds a link, stored with the project (`Project.world` in `shared/types.ts`):

```ts
/** Which world a project uses. Missing = it has none yet (it gets its own on first build). */
export interface ProjectWorldLink {
  id: string;
  /** own: made for this project. shared: another project's world, changes show in both. */
  mode: 'own' | 'shared';
  /** set when the user picked it, so carry-over never replaces their choice */
  chosen?: boolean;
}
```

What a project shows, first match wins:
1. **The world the user picked** for it (`chosen`), own or shared.
2. **Its own world**, if it is built (has at least one object, skin, light or effect).
3. **Carry-over**: its own world is missing or unbuilt, so it shows the world the user marked as the
   **default** (`Settings.defaultWorld`, global), or, with no default marked, the most recently built world of
   another project. It is shown as it is, with the project's own Brain, teams and agents on it.
4. Nothing built anywhere: the classic Station with no world.

**Building on a carried-over world.** The first build in a project that is only showing a carried-over world
gives that project **its own copy** of it (objects, lights, effects, environment, WORLD.md), and the build goes
into the copy. The other project's world doesn't change, which keeps "one world per project". To have two
projects really build in one world, the user picks it with **Share**.

**Picking a world** (the World menu on the Station, and the project's settings on the Projects page):
- Lists every world: name, picture (from the last render), which projects use it, how many objects, last built.
- For a world, **Share it** (both projects build in the same world) or **Start from a copy** (a new world of
  this project's own, starting as a copy).
- Also **New empty world**, and **Back to carry-over** (forget the choice).
- **Make this the default**: the world unbuilt projects carry over. Only one world is the default; marking
  another moves it, and "No default" goes back to the most recently built.
- A world no project uses any more is kept and listed under "Not used" until the user deletes it (deleting
  asks first and can't be undone).

**Things that belong to another project.** Skins are stored by agent and team id, so in a project that shares
or copies a world, its own Brain gets the world's Brain skin, but its agents and teams get default skins until
someone dresses them. Objects anchored to a team or agent the project doesn't have stand at their
`lastWorldPos` and can't be dragged with a team. Characters in WORLD.md for agents of another project stay in
the file, marked "(from <project>)".

**API**: `GET /api/worlds` (the list), `PUT /api/project-world` `{ worldId, mode: 'share' | 'copy' | 'new' | 'auto' }`,
`PUT /api/worlds/default` `{ worldId | null }`,
`PATCH /api/worlds/:id` (rename), `DELETE /api/worlds/:id` (only when no project uses it).

**Runs**: a tool call writes to the world of the run's own project, resolved when it writes. In a shared world
both projects' Stations update: the `world` event carries the world id and each page keeps the events for the
world it shows.

**Project sync and backups**: `<project>/.dashboard/world/` holds the world the project uses (with its id and
whether it is shared). Restoring links to the world with that id if this computer has it, and otherwise
recreates it from the files.

---

## 3b. WORLD.md

A Markdown file kept with each world (`data/worlds/<worldId>/WORLD.md`) that tells agents what the world is
about, so that builds by different agents on different days feel like one place. Like PROJECT.md is for the
project and MEMORY.md for an agent, but for the world, and every builder may edit it.

**What it holds** (the template a new world starts with; the Brain fills it in with the user):

```markdown
# <World name>

## Theme and meaning
What this world is and why it looks this way. What it stands for in this project
(e.g. "the garden grows as the research does: each finished report becomes a new tree").

## Look
Era and style, palette (by the material names used in the world), materials, voxel sizes
(terrain 0.5, buildings 0.25, characters 0.1), the light and time of day, the weather.

## Feel
Mood, pace, sounds you'd imagine, what should never appear.

## Places
### <Place name>
Where it is (near the Brain, the Writers' platform…), what it is for, who built it, what it means.

## Characters
### <Agent name>
How they look (hair, clothes, accessory, colors), how they carry themselves, their role in the world.

## Story so far
Short dated lines: what was built, by whom, and why.

## Rules
House rules for builders: scale, what goes where, keep-out zones, what to ask the user about first.
```

**Who reads it**
- Every agent with the `world` tools gets it in its instructions (cut to ~8,000 characters, like MEMORY.md is,
  with a note to read the rest with `world_md_read`).
- The Brain's snapshot gets it in its WORLD section.
- The Voxel building skill says: read WORLD.md before building; build in its style; after building a place or
  dressing a character, update its section and add one line to "Story so far".

**Who edits it**
- **Agents**: `world_md_read`, `world_md_section` (replace or append one section by its heading; the usual
  edit, so two agents changing different sections don't overwrite each other) and `world_md_write` (the whole
  file; refused unless the agent has read the current version in this run, the same rule the Brain has for
  rewriting skills). Risk `low`: the earlier version is always kept.
- **The Brain**: `write_world_md` and `update_world_md` (one section) actions. When the user describes a new
  world, the Brain asks a few short questions (theme, mood, era, palette, what it should mean), writes
  WORLD.md, and only then starts building, the same way it sets up a project and PROJECT.md.
- **The user**: an editor in the World panel, with its history (who changed what, and going back to an earlier
  version), using the same version keeping as MEMORY.md (`server/versions.ts`).

**Kept in step with the world**
- A character's section and the agent's `character` skin describe the same person. `world_skin` answers with
  a reminder to update the section if it changed, and the `character` recipe can take its colors and features
  from the section's words when no params are given.
- Places name objects. `world_info` lists objects with no place in WORLD.md, and places whose objects were
  deleted, so builders can tidy up.
- Size limit 50,000 characters, the same as MEMORY.md; no secrets (the same warning text).

---

## 4. The op language

One list of ops, run in order. The same ops are used by the agents' tool, the Brain's action and the skin
recipes. Every op is plain JSON; positions are in voxels of the current volume unless `"units": "map"`.

**State ops**
- `{"voxel_size": 0.125}`: the next ops go into a volume of this size (new, or the existing one with that size).
  This is the "change voxel size while building" switch.
- `{"material": "lantern", "color": "#ffcf7a", "kind": "emissive", "emissive": 3}`: add or change a palette entry.
- `{"use": "red lacquer"}`: the material for the following ops.
- `{"seed": 7}`: makes jitter and generators repeatable.
- `{"at": [x, y, z]}`: moves the cursor; `{"mirror": "x"}` mirrors following ops (symmetry for buildings and faces).

**Shapes**
- `box` (filled, hollow, or frame), `sphere`/`ellipsoid`, `cylinder`, `cone`, `pyramid`, `torus`,
  `line` (with thickness), `stairs`, `arch`, `plane`.
- `set`: a short list of single voxels.
- `layers`: ASCII slices, one string grid per y-level with a character → material map. This is how a model
  draws small detailed things (a face, a sign, a lantern) without coordinates:
  ```json
  {"layers": [["..##..", ".#oo#.", "..##.."]], "key": {"#": "dark wood", "o": "lantern"}}
  ```
- `text`: 3D pixel letters ("DINER", the team's name) in a 5×7 font.
- `heightmap`: terrain from a small grid or from noise parameters.
- `erase` (any shape), `replace` (material A → B inside a shape), `paint` (recolor surfaces with noise).

**Finishing passes** (what gives the references their texture)
- `jitter`: re-roll color variation in an area.
- `weather`: wear and dirt, darker at the bottom, lighter at top edges.
- `snow_cover`: snow on every top face (depth, coverage).
- `overgrow`: moss, grass tufts, hanging vines on edges and walls.
- `scatter`: drop a small object or generator many times on the surface of an area (flowers, stones, tufts).

**No built-in content.** An early version (Phase 1) shipped generators for trees, islands, gates and bridges.
They are taken out (2026-10-27): everything on screen should be built by the agents, and fixed generators
cap every world at the same vocabulary and make worlds look alike. The power moves into general tools (below)
and into prefabs the agents make for themselves (§4b).

**Shape tools** (general, no content in them)
- `revolve`: a profile (radius by height) turned around an axis: columns with capitals, domes, minarets,
  vases, tree trunks, lamp posts.
- `extrude`: a 2D outline (points, or rows of characters) raised to a height: floor plans into walls,
  pools, plazas, roads, fields.
- `path`: a brush swept along points with a width and depth: roads, rivers, canals, walls, fences, rails.
- `blob`: an ellipsoid with roughness and holes: tree crowns, bushes, clouds, rocks.
- `heightmap` / `terrain`: from rows, or from noise (hills, dunes, cliffs).

**Region tools** (on what is already built)
- `copy` a box to another spot, turned 90/180/270 and mirrored; `move` a box; `turn` a box in place; `flip`.
- `stamp` a prefab into the object's own voxels (turned in 90° steps), for things that are part of a building.

---

## 4b. Prefabs and placing (the scenes in the reference dioramas)

Busy scenes (the stock exchange, the Nile) are a few big builds and hundreds of repeated small things:
people, palm trees, lamps, taxis, boats, market stalls, benches. Agents make each small thing once, as a
prefab, and then place it many times.

**Prefabs**
- A prefab is a small voxel model with a name, a short description, tags, its own voxel size(s), its pivot
  (default: bottom centre, so it stands on what it is placed on) and its size. It can hold other prefabs
  placed inside it (a street block with its lamps and benches), up to 4 levels deep.
- Agents build a prefab like an object: `world_build` with `prefab: "Palm tree"` builds into the prefab
  instead of into the scene. Or save part of an object as one (`world_prefab` with `from`, a box).
- Prefabs belong to the world. An agent can also **publish** one to the shared prefab library (all
  worlds, all projects; like presets) and **import** one from it. Building is still the agents' work: the
  library starts empty.
- **Variants**: a prefab names some of its materials as slots (`shirt`, `hull`, `roof`); each copy can
  swap them (`{"shirt": "cloth red"}`), so one person prefab makes a varied crowd.
- Changing a prefab changes every copy of it (the page re-meshes it once).

**Placing** (steps in `world_build`, on the object being built)
- `{"place": "Palm tree", "at": [x, y, z], "turn": 30}`: one copy. `turn` is any angle around the vertical;
  `tilt`/`roll` in 90° steps; `scale`; `mirror`; `swap` (variants).
- `{"place": ["Person A", "Person B"], "scatter": {"area": [w, d], "count": 60}, "turn": "random", "swap": [{…}, {…}]}`:
  many copies, picked from a list, turned at random, each on the ground below it (`"on": "surface"`, the default).
- `{"place": "Street lamp", "along": [[x, z], …], "every": 12, "face": "path"}`: along a path, facing along it
  or across it, on one side or both (`"sides": 2`, `"offset": 3`).
- `{"place": "Market stall", "grid": {"rows": 3, "cols": 5, "gap": [6, 8]}}`.
- `{"place": …, "in": [w, h, d], "avoid": "solid"}`: only where nothing is built.
- Placed copies are not voxels: they are a list on the object (prefab, position, turn, scale, swaps), and the
  page draws each prefab once and repeats it on the GPU, so a crowd of 500 is as cheap as one person.
  They can be at any angle, unlike voxels (a taxi parked at 20°).
- `{"unplace": "Person A", "in": [w, h, d]}` takes copies away; `world_object` moves a whole object of them.

**Limits**: 20,000 placed copies per world, 2,000 per call; a prefab up to 128 voxels a side, 200,000 voxels.
Copies don't count towards the world's voxel limit (their prefab does, once).

**What it does to the rest of the plan**
- §9 Skins: the characters, desks, platforms and the Brain's shell are prefabs the agents build (a
  "character" is a prefab with parts for head, body, arms, legs). Until an agent builds one, the classic
  meshes stay.
- §7 The Brain: it plans the scene and hands out the prefabs to build ("Mira: a palm tree and a felucca;
  Kenji: three people and a camel"), then places them, or has a builder do it.
- The Voxel building skill teaches how to build good small things (a palm from a leaning revolve and drooping
  path fronds; a person 16 voxels tall at 0.1; a taxi at 0.125) and how to compose a scene.

---

## 5. Server

New files:

| File | What it does |
|---|---|
| `server/voxel/store.ts` | Load and save worlds through `store.ts` helpers (`dataPath('worlds', id, …)`, `readJSON`/`writeJSON`). One write queue per world so two agents (or two projects sharing it) building at once don't clobber each other. Emits `world` events with the world id. |
| `server/voxel/link.ts` | Which world a project shows (§3a): the user's pick, its own built world, or the carry-over; copy on first build; share, copy, new, rename and delete. |
| `server/voxel/worldmd.ts` | WORLD.md: read, write, replace or append a section by heading, the template, the size limit, kept versions (`versions.ts`), the "read before rewrite" check. |
| `server/voxel/grid.ts` | Sparse chunked volumes, RLE + base64 encoding, bounds, counts. Pure, no Node or DOM types (could live in `shared/` so the page decodes with the same code). |
| `server/voxel/ops.ts` | Checks and runs an op list against an object. Caps, clamping, repeatable randomness. Returns a diff (changed chunks) and a one-paragraph summary. |
| `server/voxel/generators/*.ts` | The generators above. |
| `server/voxel/history.ts` | Every build call keeps the chunks it replaced: undo per object and per builder, last 50 builds. |
| `server/voxel/describe.ts` | Text views for models: object list with bounds, a top-down map of the area (ASCII heights and materials), the plots and keep-out zones (desks, paths). |
| `server/voxel/vox.ts` | (later) MagicaVoxel `.vox` import and export. |

**API** (`server/index.ts`, all under the existing security checks; these act on the world the open project
shows, and the world routes of §3a pick and manage worlds):
- `GET /api/world`: world meta (no voxel data), with its id, name and whether it is carried over.
- `GET /api/world/md`, `PUT /api/world/md`, `GET /api/world/md/versions`: WORLD.md and its history.
- `GET /api/world/objects/:id`: an object's voxel data.
- `PUT /api/world/objects/:id`, `DELETE …`: move, hide, rename, delete (from the page).
- `PUT /api/world/environment`, `/lights/:id`, `/effects/:id`.
- `POST /api/world/undo`.
- `POST /api/world/snapshot/:requestId`: the page sends back a rendered picture (see `world_look`).

**Events**: `emit('world', { objects: [ids], chunks?: {...small diffs...}, lights?, effects?, env? })`. Small
changes travel in the event so the map updates without a fetch; big ones say "reload object X". Add `world` and
`world-md` to `WATCH` in `server/projectsync.ts` and save the project's world (WORLD.md included) into
`<project>/.dashboard/world/`, and into backups (§3a).

**Runs stay in their project.** A tool call writes to the run's own project (`withProject`), not the one open
on screen, as AGENTS.md asks.

---

## 6. Agent tools (new group `world`, "Voxel world")

Added to `TOOL_GROUPS` in `server/tools.ts`:

| Tool | Risk | What it does |
|---|---|---|
| `world_info` | none | The world in words: environment, voxel size, objects (who built what, where, size), lights, effects, the caller's plot and the keep-out zones. Optional `area` gives a top-down ASCII map of it. |
| `world_build` | low; **high** when it changes or erases an object someone else built | Runs an op list on an object (made if new): `object`, `anchor`, `position`, `voxel_size`, `ops`. Answers with what changed and the new bounds. |
| `world_object` | low; high for delete | Move, turn, scale, rename, hide, duplicate, re-anchor, delete an object. |
| `world_light` | low | Add, change or remove a light. |
| `world_effect` | low | Add, change or remove an effect. |
| `world_environment` | low | Time of day, sky, fog, sun, weather, bloom, tilt-shift, default voxel size. |
| `world_skin` | low (own skin, own team's platform); high for others and the Brain | Dress the Brain, a team platform or an agent: a recipe (`character`, `platform`, `orb` with params) or ops. |
| `world_look` | none | A picture of the world from a named view (`overview`, `brain`, `team:<id>`, `agent:<id>`, or a camera). Returned as an image so the model can see what it built and fix it. |
| `world_undo` | low | Undo the caller's last build (or the last N). |
| `world_md_read` | none | The whole WORLD.md as it is now (its instructions have it as it was when the chat started). |
| `world_md_section` | low | Replace or append one section of WORLD.md by its heading (`## Places` › `### Lantern bridge`). The usual way to edit it. |
| `world_md_write` | low | Replace the whole WORLD.md. Refused unless the agent read the current version in this run. The earlier version is kept. |

Risk follows AGENTS.md: building only touches the dashboard's own world and can be undone, so `low`;
anything that deletes, or changes another builder's work, is `high`. The risk function looks up the target
object's owner (it is a server function, so it can read the store).

`world_look` needs a renderer, and the server has none. The server asks an open Station tab over the WebSocket
to render an offscreen frame and post it back to `/api/world/snapshot/:requestId`; it waits up to ~10 s. With
no tab open it falls back to the text view from `describe.ts` and says so. (Rendering in the desktop app works
the same way: its window is a tab.)

The MCP bridge needs no change: it already exposes whatever `toolDefs()` returns, so Claude Code and Codex
agents get these tools too.

**Desk monitor**: `describeTool` in `station.ts` learns the world tools, so a desk shows "Building · Torii
gate" with a cube icon while an agent works.

---

## 7. The Brain

The Brain answers with a JSON `actions` block (`server/overseer.ts`) and can't call tools, and its answer is
capped at a few thousand tokens. So:

- New actions: `{"do":"build", "object":…, "anchor":…, "voxel_size":…, "ops":[…]}`, `{"do":"skin", "to":"brain"|"team"|"agent", "id":…, "recipe":{…}}`,
  `{"do":"world_env", …}`, `{"do":"world_light", …}`, `{"do":"world_effect", …}`. They run through the same
  `ops.ts`, so the Brain's builds follow the same limits.
- WORLD.md actions: `{"do":"write_world_md","content":…}` and `{"do":"update_world_md","section":"## Places › ### Koi pond","content":…,"append":true|false}`.
  A new world starts with WORLD.md: the Brain asks a few short questions (theme, meaning, mood, era, palette),
  writes it, then builds (§3b). It keeps WORLD.md up to date when the user says something new about the world.
- The Brain is good at the big moves (set the scene, pick a style, place generators, dress teams) and hands
  detailed work to a builder: `delegate` to a **World Builder** agent.
- New starter in `server/library.ts`: **World Builder** (tool groups `world`, `files`, `assets`), with the skill below.
- New built-in skill in `server/skills.ts` (`BUILTIN`): **Voxel building**. The op language, the
  generators and their parameters, scale (desk = 2.6, person = 1.7), palette advice (ramps, jitter, warm
  lights against cool shadows), how to light a scene, effects to reach for, "look at it with `world_look`,
  then fix", and the plot rules. Given to the Brain and the World Builder by default.
- The Brain's snapshot gets one short WORLD section (which world and whether it is carried over or shared,
  WORLD.md, environment, object count, who built what, open plots), so it can answer "what did the team
  build?" and plan around what is there.

Example: "Make the Station a floating cherry garden at golden hour" turns into: (after a couple of questions)
`write_world_md` with the theme, look and a character line per agent; `world_env` golden;
`build` an island under the Brain (`island` + `tree` cherry × 3 + `pond` + `torii`); `world_effect` petals;
`skin` the Brain as a voxel orb with gold rings; then `delegate` to the World Builder: "dress every team
platform as a small matching island, and every agent as a character that suits their job".

---

## 8. Rendering (web)

New folder `web/voxel/` so `station.ts` (3,361 lines) only gains hooks:

| File | What it does |
|---|---|
| `web/voxel/mesher.ts` | Chunk → geometry. Hidden faces culled, quads merged only when color and AO match, per-vertex AO, colors from the palette. Separate geometry per material kind (opaque, transparent, water, emissive, leaf). Pure, tested in happy-dom. |
| `web/voxel/mesh.worker.ts` | Runs the mesher off the main thread. Needs a second entry in `scripts/build-web.ts` (it has one entry today) and in `scripts/build-desktop.ts`. |
| `web/voxel/world.ts` | Keeps world objects in the scene: loads them, applies `world` events, anchors (follows a team's pod group), hides, picks (`userData.pick = {type: 'world', id}`). |
| `web/voxel/materials.ts` | Standard material with vertex colors; water (scrolling normals, shimmer, see-through); glass; emissive (not tone-mapped, feeds bloom); leaf (gentle wind sway in the vertex shader). |
| `web/voxel/lights.ts` | World lights → three.js lights within a budget (nearest to the camera's target wins), flicker. Emissive voxels grouped into clusters, and the brightest clusters each get a cheap point light, so lanterns and signs light up what is around them. |
| `web/voxel/effects.ts` | Particles as instanced tiny cubes (petals, leaves, snow, embers, sparks, foam) or soft sprites (smoke, steam, mist); birds as a small flock; drifting voxel clouds; god rays as additive cones. One pool, a cap on particles per quality level. |
| `web/voxel/post.ts` | Post-processing with `three/examples/jsm/postprocessing`: render → AO (GTAO) → bloom → tilt-shift (Bokeh) → output (tone mapping, a light color grade, vignette). |
| `web/voxel/environment.ts` | Sky gradient, fog, sun position and color, hemisphere light, presets and smooth blends between them (dusk fades in). |
| `web/voxel/skins.ts` | Builds the voxel Brain, platforms and agents, keeping what the map needs (see below). |
| `web/voxel/rig.ts` | Animates characters part by part: typing (working), raising a hand and the status orb (needs you), breathing and looking around (idle), a small walk when dragged to another team. |

**Renderer changes in `station.ts`** (behind the "Look" setting so the classic Station stays as it is):
ACES tone mapping and sRGB output, soft shadows from the sun (the shadow camera is fitted to the world's
bounds; the orthographic view makes that easy), hemisphere light instead of the flat ambient, the composer
in place of `renderer.render`, and the sky instead of the flat `#070807` with dots.

**Build animation**: new voxels rise into place in a quick sweep (a per-chunk "built at" time in the shader),
with a puff of cube particles and a short beam from the builder's desk to the site. A build is visible as it
happens, which suits the Station's "watch your agents work" idea.

**Quality levels** (Settings › Station): Low (no shadows, no AO, few particles), Medium, High (all of it).
The page drops a level by itself if frames stay slow, and `prefers-reduced-motion` turns particles and the
build sweep down.

**Performance target**: 60 fps with ~1M visible voxels on a mid-range laptop GPU at Medium, WebGL2 (the
desktop app's WebView2 has it). Chunks are 16³ so a small edit re-meshes a small piece.

---

## 9. Skins: voxel Brain, platforms and agents

The map does a lot with these today: the Brain's globe pulses when agents work and opens when files are held
over it; desks have a live monitor, a status orb, run and focus rings, and the person bobs while working;
platforms have a hub, a rim, a lead seat and spokes. A skin replaces the **look**, not these behaviors.

- **Brain**: the `orb` recipe (a voxel shell around a glowing core). The existing particle cloud, halo and
  beam stay (they read well with bloom); the project's logo or 3D model still floats inside. Busy = the core
  brightens and the shell turns faster.
- **Team platform**: the `platform` recipe in the team's color (round deck, octagon, floating island…). It is
  a recipe, not a fixed object, because the radius changes with the number of members: the platform is
  rebuilt when a member joins or leaves. The hub becomes a voxel object of the team's choice; the team's
  mark still shows above it.
- **Agent**: a `character` (rigged) at a voxel `desk`. The monitor keeps today's canvas screen, mapped onto
  the voxel monitor's face, so the live activity text stays readable. The status orb and rings stay.
- **Defaults**: when the Look is "Voxel world", everything without a skin gets a default one: each agent's
  character comes from its color and emoji (a seeded choice of hair, clothes and accessory, so it is stable),
  so the map turns voxel at once and agents can then restyle themselves.
- **Picking and dragging**: skin meshes carry the same `userData.pick` as the meshes they replace, so clicks,
  hovers, the right-click menu and drag and drop keep working.

---

## 10. In the page

- **Header**: a "World" control next to the zoom buttons: Look (Classic, the default / Voxel world), which
  world (§3a, with "carried over from <project>" when it is), time of day, effects on or off, quality. Like the
  "Orbit / Light / Petal gust" buttons in the first reference.
- **Side panel**: a World section in `stationpanel.tsx` (React) with three tabs:
  - **WORLD.md**: read it, edit it, see its history and go back to an earlier version.
  - **Objects**: grouped by who built them, with show, hide, undo and delete. Clicking an object on the map
    selects it here, with its place in WORLD.md.
  - **Look**: environment, lights and effects.
- **Projects page**: each project shows which world it uses, and its settings have the world picker.
- **Right-click** on a world object: who built it and when, hide, undo the last change, delete, "Ask its
  builder to change it" (opens a chat with that agent, the object named).
- **Brain chat**: works as is ("build…", "make it night", "dress the Writers team as a lighthouse").
- **No building by hand**: the user steers through chat and WORLD.md (§2, point 9).

UI copy stays in plain words: "World", "Built by Mira", "Undo the last build", "Voxel size", "Carried over
from Hanami", "Share this world", "Start from a copy".

---

## 11. Phases

Each phase ends with `bun run check` and `bun run build` green and something visible on the map.

**Phase 0: look spike (small, de-risks the rest).** *Done 2026-10-27.*
Renderer upgrade behind the Look setting: tone mapping, sun shadows, hemisphere light, sky, fog, composer with
AO, bloom and tilt-shift. A hard-coded test island from a handful of boxes and per-voxel jitter. Measure fps
at 250k, 1M and 2M voxels on a Windows laptop and in the desktop app. Decide the limits in §3 from this.

What was built: Settings › Look › Station look (Classic, the default / Voxel world) and its quality (Low / Medium /
High); `shared/voxel.ts` (chunks, run-length storage, per-voxel shades); `web/voxel/mesher.ts` (hidden faces
skipped, corner AO, split into solid / glowing / see-through); `environment.ts` (seven times of day);
`post.ts` (AO on High, glow, tilt-shift with vignette, tone mapping); `view.ts` (sky, fog, sun with shadows,
sky light; the classic lights come back when it is off); `bench.ts` (the test island). From the browser
console on the Station: `await __voxelBench({ radius: 90 })`, `__voxelEnv('dusk')`, `__voxelBench(null)`;
or open `#/station?voxelbench=90`.

Measured on an Apple M1 Max (Chrome, Metal), 1542×1000, frame cap off, fps:

| Voxels (faces) | Low 1× | Medium 1× | High 1× | Medium 2× | High 2× |
|---|---|---|---|---|---|
| 0.29M (56k) | 536 | 340 | 137 | 165 | 44 → 177* |
| 0.94M (157k) | 473 | 292 | 122 | 146 → 177* | 39 → 131* |
| 3.4M (512k) | 375 | 196 | 88 | 113 → 123* | 31 → 103* |

\* after capping the passes at 1.5× pixel density and dropping MSAA on sharp screens.

What it says:
- **Voxel count is not the limit**: 3.4M voxels still draw at 375 fps on Low. The finishing passes, paid per
  pixel, are. So the passes run at a capped resolution (labels are HTML and stay sharp).
- **Meshing on the main thread is too slow for big builds**: ~0.2 ms per 1,000 voxels (0.7 s for 3.4M), so
  the worker in Phase 1 is needed, and edits must re-mesh only the 32³ regions they touch.
- 32³ regions are a good size: 321 meshes for 3.4M voxels.
- The crease pass (AO) had to be taught to skip sprites, glows and the map's invisible boxes, or they
  darkened the ground like boards.
- Limits in §3 stand (4M voxels per world, 250k per call). **Still to do**: measure on a mid-range Windows
  laptop and in the desktop app (WebView2). A GPU 5-8× slower than the M1 Max should still hold 60 fps on
  Medium at 1×; High may need auto step-down (Phase 2).

**Phase 1: build with voxels.**
Types, grid and RLE, op engine with shapes, `layers`, `text`, `heightmap`, `replace`, `erase`, `jitter`;
the world library and project links with carry-over and copy on first build (§3a, picker UI comes in Phase 4);
WORLD.md with its template, versions and tools (`world_md_read`, `world_md_section`, `world_md_write`) and the
Brain's WORLD.md actions; storage, API, events, project sync and backups; mesher and worker; world objects on
the map with anchors. Tools `world_info`, `world_build`, `world_object`, `world_undo`. The Brain's `build`
action. Starter generators: `tree`, `rock`, `island`, `cloud`, `lantern`, `bridge`, `torii`. The Voxel
building skill and the World Builder starter.

*Phase 1 done 2026-10-27.* Built as planned, with these notes:
- Worlds live in `data/worlds/<id>/` with a project link (`Project.world`); carry-over, copy on first build,
  share / copy / new / back to carry-over, and the default world work on the server (`server/voxel/link.ts`).
  The picker in the page is still Phase 4: for now the API (`/api/worlds`, `/api/project-world`,
  `/api/worlds/default`) is all there is.
- The build engine checks every step and puts everything back when one fails. Stock materials (34) can be
  used by name. Generators take sizes in map units; a misspelled material is an error, not a quiet swap.
- `jitter` as a step became the material's `jitter` field; `weather`, `snow_cover`, `overgrow` and `paint`
  move to Phase 2 with the other finishing passes.
- Undo history is per world (last 50 changes), and refuses to undo over someone else's later change.
- Objects pinned to a team or agent that the project showing the world doesn't have are placed from the
  middle of the map; recording `lastWorldPos` from the page is left for Phase 4.
- Live test: agents' tool calls (through the same route as the MCP bridge) built an island, a grove, a
  gate, lanterns, a bridge and a watchtower; the open Station showed each build within a second.

**Phase 1b: prefabs and placing (replaces the generators).** *Done 2026-10-27.*
Take the generators out (code, tests, the skill and the Brain's prompt). Add the shape tools (`revolve`,
`extrude`, `path`, `blob`, noise terrain), the region tools (`copy`, `move`, `turn`, `flip`, `stamp`),
prefabs (build into one, save from a box, variants, nested, publish and import), and placing (one, scatter,
along a path, grid; any turn; swaps; on the surface). The page draws placed copies as instances. The
skill and the Brain's prompt teach making prefabs and composing scenes. Test with a small scene in the
style of the references: a street with a building, lamps, trees, people and taxis, all made by tool calls.

Built as planned. Notes:
- The "Voxel world" tool group stays something you turn on per agent (the World Builder starter has it).
- `world_prefab` lists, saves (from a box of an object, optionally putting a copy back in its place), renames,
  deletes (only when no copy is placed), publishes to and imports from the prefab library
  (`data/prefab-library/`, every world and project). A published prefab must stand alone (no copies inside).
- Stamping turns in quarter turns, like a placed copy's turn (+x goes to -z at 90°).
- Live test: three agents built Walker, Lamp post, Street tree and Taxi prefabs, a plaza with a road and a
  crosswalk, and a columned exchange, then placed 142 copies (115 people in six colours from one prefab):
  it reads like the stock exchange reference, at full speed.
- The prefab library goes into every backup like the presets (fixed after Phase 5); a world picker and prefab
  browser in the page are Phase 4.

**Phase 2: light and effects.**
Material kinds (emissive, glass, water, leaf, snow), world lights with the light budget and emissive clusters,
environment presets with blending, effects (petals, snow, rain, fireflies, embers, smoke, mist, foam, birds,
clouds), `snow_cover`, `overgrow`, `weather`. Tools `world_light`, `world_effect`, `world_environment` and
their Brain actions. Quality levels.

*Phase 2 done 2026-10-27.* Notes:
- Glowing voxels light their surroundings: the page finds glow spots in objects and in every placed copy, adds
  the builders' lights, and gives a fixed pool of lights (4 / 8 / 8 points by quality, plus spots) to the
  strongest ones near the view. Lamps make pools of light on the street; headlights shine.
- Draw classes: solid, glowing (strength per voxel), glass, water (moving ripples), metal, leaf (sways with the
  wind; shadows stay still). Per-material opacity for glass and water is not used yet (0.38 and 0.72).
- Particles: petals, leaves, snow, dust (tiny tumbling cubes), rain (streaks), fireflies, embers, sparks
  (glowing points), smoke, steam, mist (soft puffs), birds (a flock). Capped by quality, a quarter with reduced
  motion. Weather over the whole map follows the camera.
- Time of day eases over 2.5 s. When frames stay slow the Station steps down one quality level for the visit.
- Server: `world_light`, `world_effect`, `world_environment` (a preset, then any part), the Brain's actions,
  `snow_cover`, `overgrow`, `weather` steps, undo for all of it. Limits: 32 lights, 24 effects.
- Measured (M1 Max, street scene with lights and effects): Medium 119 fps (71 at Retina), High 52.
- Live test: a Nile scene (river, pyramids, temple, obelisk; palms, feluccas, villagers and torches placed as
  copies; golden hour, birds, mist, a temple light) built entirely by tool calls.

**Phase 3: skins.**
`character` with its rig and animations, `desk`, `orb`, `platform`; default skins; `world_skin` and the
Brain's `skin` action; the desk monitor on voxel desks; platforms rebuilt when members change.

*Phase 3 done 2026-10-27.* Changed from the plan above: no built-in character, orb or platform recipes.
- An agent's form ("character") is any prefab a builder makes: a person, an animal, a tree, a lamp, a crystal.
  It may be one piece (moved whole by the "self" track) or made of named parts (copies placed with "name"),
  each turning around its prefab's pivot ("pivot": "top" for an arm that hangs from a shoulder).
- Builders design the animations (`world_animate`): keys per part over time (turn, move, scale; linear,
  smooth, step or bounce), looping or once. Clips named idle / working / needs play in those states unless
  the skin picks others; "play" runs one once (a cheer), live on every open Station.
- `world_skin` dresses an agent (form, desk; the live screen stays), a team (platform, hub) or the Brain
  (shell, with or without the particle globe), with offset, turn and scale, and can take any of them off the
  map (`hidden`) and hide their name (`label: false`): artistic freedom. Dressing yourself or your own team
  needs no OK; anyone else, or the Brain, asks first. Voxel look only; the classic models are hidden, never
  removed, so the classic look is untouched.
- Page: `web/voxel/animate.ts` (sampling, easing, crossfades), `rig.ts` (part trees), `skins.ts` (what a skin
  hides and draws). 107 fps at Medium with skins and animations on.
- Not yet: glowing voxels in skins don't feed the light pool; dragging a skinned team wasn't checked by hand.

**Phase 4: seeing and polish.**
`world_look` (render in an open tab, text fallback), build animation and beams, the World side panel (WORLD.md
editor and history, objects, look) and right-click menu, the world picker on the Station and the Projects page
(with world pictures from the last render), history and undo in the page, more generators (`pagoda`,
`facade`, `car`, `wheel`, `waterfall`, `river`), prefabs (save an object and reuse it across worlds, global
like presets).

*Phase 4 done 2026-10-27.* Notes:
- `world_look`: the server asks open Station pages ('world-look' event); a page in the voxel look showing that
  world renders an offscreen picture (overview, the Brain, a team, an agent, an object, or a prefab alone, any
  angle and zoom) and posts it back; the agent gets the image (Claude Code and Codex see it through the MCP
  bridge). No page open: words at once (a map from above for objects and prefabs).
- Live builds rise into place with a puff of cubes and an arc of light from the builder's desk (or the Brain).
- Glowing voxels in skins light their surroundings too.
- The World panel (globe button, voxel look only): WORLD.md (edit, history, restore), Built (objects by builder,
  hide, delete, prefabs and their uses, recent changes, undo the last change), Look (time of day, weather,
  glow, blur, lights, effects, who is off the map), World (which world and why, rename, share, copy, new,
  default, back to carry-over, delete unused). The project menu's "Voxel world…" opens the picker in any look.
- Not done: undo of a chosen change (only the last), lastWorldPos, prefab library browsing in the page.

**Phase 5: extras.**
MagicaVoxel `.vox` import (from allowed folders) and export (and glTF export as an Artifact), a "screenshot
the world" button that saves a picture to Artifacts. (No building by hand: agents only.)

*Phase 5 done 2026-10-27* (without building by hand, as decided):
- `world_import`: a MagicaVoxel .vox file (every model, placed by its scene graph; z-up turned y-up) as a prefab
  or an object; its colours become materials ("<name> 12"), glowing and glass ones too.
- `world_export` and the World panel: an object, a prefab or the whole world as .glb (glTF 2.0: the same mesher,
  a material per kind, placed copies as nodes sharing one mesh, mirrored ones flipped) or .vox (one file per
  voxel size, big grids split into 256³ models), to Artifacts and the project folder's `exports/`.
- Pictures: `world_look` with "save", and the panel's "Save a picture" (what the user sees).
- The prefab library in the panel: search, take into this world, share to the library.
- The mesher moved to `shared/voxelmesh.ts` (the server meshes for glTF).

**Docs**: README and `docs/guide.md` get a "Voxel world" section in the phase it ships (AGENTS.md asks for
this), and AGENTS.md's layout table gets `server/voxel/` and `web/voxel/`.

---

## 12. Tests

Server (`tests/server/`):
- Grid: RLE round trip, chunk bounds, counts, negative coordinates.
- Ops: each shape and generator gives the expected voxels for a seed (small snapshots); the same seed gives
  the same result; `voxel_size` mid-list makes a second volume; caps refuse oversize builds with a clear message.
- Tools: risk is low for own and new objects and high for others' objects and deletes; tools write to the
  run's project, not the open one; undo restores the exact chunks.
- Sync and backup: the world (WORLD.md included) goes into `.dashboard/world/` and backups and comes back on
  restore, linked to the same world when this computer has it; no secrets in it.
- World links: an unbuilt project shows the default world, or the most recently built one when none is
  marked; the user's pick always wins; the first
  build on a carried-over world makes a copy and leaves the original alone; a shared world takes builds from
  both projects; a world in use can't be deleted; objects anchored to another project's team stand at
  `lastWorldPos`.
- WORLD.md: section replace and append by heading (nested headings, a heading that isn't there yet), the size
  limit, versions kept, `world_md_write` refused without a read in the same run, and it shows up in the
  instructions of agents with the `world` tools and in the Brain's snapshot.
- API: world routes need `x-dash` like the rest.
- Brain: `build`, `skin` and `world_env` actions parse and run, and are capped.

Web (`tests/web/`, happy-dom, no WebGL):
- Mesher: hidden faces culled, AO values at corners, quads merged only when they match, material split.
- Palette jitter is repeatable; skins keep `userData.pick`; the world event updates only the named objects.
- `describeTool` text for the world tools.

---

## 13. Risks and how we handle them

| Risk | Handling |
|---|---|
| Too slow on older laptops (shadows + AO + bloom + 1M voxels) | Phase 0 measures first; quality levels; auto step-down; chunked meshing in a worker. |
| Models produce ugly or random builds | Generators do the heavy lifting; the skill teaches style; `world_look` lets them check and fix. |
| Runaway builds (huge files, an agent filling the map) | Per-call and per-world caps, plots, undo per builder, Stop works like any other tool. |
| Agents overwrite each other's work | Plots, ownership, high risk (asks first) for changes to others' objects. |
| Skins break map behavior | Skins keep the pick data and hooks; Classic look stays available; tests check the pick data. |
| `station.ts` grows further | New code lives in `web/voxel/`; `station.ts` only calls it. |
| Two agents editing WORLD.md at once | Section edits by heading are the normal path; a whole rewrite needs a fresh read; every version is kept. |
| WORLD.md and the world drift apart | `world_info` lists objects with no place and places with no objects; the skill asks for an update after each build. |
| A project's agents change another project's world by surprise | Carry-over makes a copy on first build; only a world the user chose to **Share** takes builds from two projects. |
| Desktop bundle | The worker is a second build entry; check `scripts/build-desktop.ts` copies it; smoke test in CI. |

---

## 14. Decisions

Made on 2026-10-27:

1. **The classic look stays the default.** Voxel world is something you turn on.
2. **One world per project, and built worlds carry over.** A project whose world is unbuilt shows the world
   marked as the default, or the most recently built one when none is marked. The user picks which world
   each project uses (§3a).
3. **Agents build without asking** (`low` risk). Deleting, and changing another builder's work, asks first.
4. **The Brain keeps today's particle globe** inside the voxel shell, for now.
5. **Agents only**: no building by hand.
6. **WORLD.md** for every world: its theme, meaning, look, feel, places and characters, read by every builder
   and editable by agents, the Brain and the user (§3b).

Still open (the plan picks the first option; easy to change):
- On a carried-over world, the first build **copies** the world for this project (suggested), or builds into
  the original so both projects change?
