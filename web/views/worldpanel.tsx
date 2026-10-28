// The World panel on the Station (voxel look): the world's WORLD.md and its history, what is built and the
// prefabs, the look (time of day, weather, glow, lights, effects, who is off the map), and which world this
// project shows. The world picker also opens on its own from the project menu (openWorldPicker).
// From here you can also save a picture of what you see, export objects, prefabs or the world as files
// (.glb, .vox: they go to Artifacts), and take prefabs from the shared prefab library or share one to it.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Slider } from '@base-ui/react/slider';
import { GET, POST, PUT, DEL, ago, attempt, confirmBox, md, modal, promptBox, refreshSoon, state, toast } from '../core.ts';
import { DomNode, Icon, mountReact, useServerEvents } from '../ui/react.tsx';
import { Chips, Tabs } from '../ui/controls.tsx';
import { canTakePicture, takePicture } from '../voxel/picture.ts';
import type { ServerEvent, ShownWorld, VoxelObjectMeta, VoxelPrefabMeta, WorldEnvironment, WorldListing, WorldMdInfo, WorldSkins } from '../../shared/types.ts';

type WorldAnswer = ShownWorld & { fromProjectName?: string };
type PrefabRow = VoxelPrefabMeta & { uses: { in: string[]; copies: number } | null };
interface MdVersion {
  id: string;
  at: number;
  by: string;
  note?: string;
  chars: number;
}
interface Change {
  at: number;
  by: string;
  what: string;
}
/** A prefab in the shared library (GET /prefab-library). */
interface LibraryRow {
  id: string;
  name: string;
  description: string;
  tags: string[];
  by: string;
  fromWorld: string;
  size: [number, number, number];
  voxels: number;
  createdAt: number;
}
interface ExportAnswer {
  paths: string[];
  artifacts: string[];
  note?: string;
}
type Tab = 'md' | 'built' | 'look' | 'world';

const WORLD_EVENTS = new Set(['world', 'world-md', 'project']);
const SECTION = 'mt-4 mb-1.5 font-mono text-[10px] leading-[normal] font-medium tracking-[0.14em] text-dim uppercase';
const ROW = 'flex items-center gap-2 rounded-box border border-line bg-bg px-2.5 py-1.75 text-[13px]';
const ROW_META = 'text-[11.5px] text-faint';
const ICON_BTN = 'icon-btn size-7 flex-none';
const BY: Record<string, string> = { you: 'you', brain: 'the Brain', agent: 'an agent' };

/** GET /world, again whenever the world changes. */
function useWorld(): { shown: WorldAnswer | null; reload: () => void } {
  const [shown, setShown] = useState<WorldAnswer | null>(null);
  const reload = useCallback(() => {
    void GET<WorldAnswer>('/world')
      .then(setShown)
      .catch(() => setShown({ world: null, how: 'none' }));
  }, []);
  useEffect(reload, [reload]);
  useServerEvents((ev: ServerEvent) => WORLD_EVENTS.has(ev.type) && reload());
  return { shown, reload };
}

const voxels = (o: { volumes: { count: number }[] }) => o.volumes.reduce((n, v) => n + v.count, 0);
const fmt = (n: number) => n.toLocaleString('en-US');
/** Files out of the world, into Artifacts: the whole world, or one object or prefab, as .glb or .vox. */
async function exportIt(what: 'object' | 'prefab' | 'world', format: 'glb' | 'vox', name: string, id?: string): Promise<void> {
  const r = await attempt(() => POST<ExportAnswer>('/world/export', { what, id, format }));
  if (r) toast(`Saved ${name} to Artifacts${r.paths.length > 1 ? ` (${r.paths.length} files, one per voxel size)` : ''}${r.note ? `. ${r.note}` : ''}`);
}

/** A picture of what you see on the Station, into Artifacts. */
async function savePicture(name: string): Promise<void> {
  let image: string | null = null;
  try {
    image = takePicture(1600);
  } catch {
    image = null;
  }
  if (!image) {
    toast('A picture needs the Station open in the voxel look.', 'warn');
    return;
  }
  const r = await attempt(() => POST<{ path: string }>('/world/picture', { image, name }));
  if (r) toast('Saved a picture to Artifacts');
}

/** Export one thing: a small button that opens its two formats. */
function ExportButtons({ what, id, name }: { what: 'object' | 'prefab'; id: string; name: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className={ICON_BTN} title={`Export ${name}`} aria-label={`Export ${name}`} onClick={() => setOpen(true)}>
        <Icon name="download" size={13} />
      </button>
    );
  return (
    <span className="flex flex-none items-center gap-1">
      <button className="btn ghost tiny" title="A 3D model for Blender, game engines and the web" onClick={() => (setOpen(false), void exportIt(what, 'glb', `"${name}"`, id))}>
        3D model
      </button>
      <button className="btn ghost tiny" title="A MagicaVoxel file" onClick={() => (setOpen(false), void exportIt(what, 'vox', `"${name}"`, id))}>
        .vox
      </button>
    </span>
  );
}

const howText = (s: WorldAnswer): string =>
  s.how === 'own' ? 'This project’s own world.' : s.how === 'shared' ? `Shared with ${s.fromProjectName || 'another project'}: changes show there too.` : s.how === 'carried' ? `Carried over from ${s.fromProjectName || 'another project'}: the first build here makes this project its own copy.` : 'No world yet: the first build starts one.';

/** The panel in the Station's side panel. teamName names a team by id (for who is off the map). */
export function WorldPanel({ onClose, teamName }: { onClose: () => void; teamName?: (id: string) => string | undefined }) {
  const { shown, reload } = useWorld();
  const [tab, setTab] = useState<Tab>('md');
  const w = shown?.world || null;
  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <span className="grid size-8 flex-none place-items-center rounded-box border border-line text-accent">
          <Icon name="globe" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="st-panel-title font-sans text-[16px] leading-[1.25] font-bold">{w?.name || 'World'}</div>
          <div className="hint truncate">{shown ? howText(shown) : 'Loading…'}</div>
        </div>
        {w && canTakePicture() ? (
          <button className="icon-btn world-picture" onClick={() => void savePicture(w.name)} title="Save a picture of what you see to Artifacts" aria-label="Save a picture">
            <Icon name="image" size={15} />
          </button>
        ) : null}
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4.5">
        <Tabs
          label="World"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'md', label: 'WORLD.md' },
            { value: 'built', label: 'Built' },
            { value: 'look', label: 'Look' },
            { value: 'world', label: 'World' },
          ]}
          panelClassName="pt-3"
        >
          {!shown ? (
            <p className="hint">Loading…</p>
          ) : tab === 'md' ? (
            <MdTab shown={shown} />
          ) : tab === 'built' ? (
            <BuiltTab shown={shown} reload={reload} />
          ) : tab === 'look' ? (
            <LookTab shown={shown} teamName={teamName} />
          ) : (
            <WorldPicker shown={shown} reload={reload} />
          )}
        </Tabs>
      </div>
    </>
  );
}

// ---------- WORLD.md ----------
function MdTab({ shown }: { shown: WorldAnswer }) {
  const [info, setInfo] = useState<WorldMdInfo | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // the world the draft was opened in: the picker can switch worlds while you type
  const [draftOf, setDraftOf] = useState('');
  const [versions, setVersions] = useState<MdVersion[] | null>(null);
  const load = useCallback(() => {
    void GET<WorldMdInfo>('/world/md')
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  useEffect(load, [load, shown.world?.id, shown.world?.updatedAt]);
  useEffect(() => setVersions(null), [shown.world?.id]);
  const otherWorld = editing !== null && !!info && info.worldId !== draftOf;
  useServerEvents((ev) => ev.type === 'world-md' && editing === null && load());
  if (!shown.world) return <p className="hint">There is no world yet. Once something is built, its WORLD.md is here: what the world is, its look, places and characters.</p>;
  const save = async () => {
    if (editing === null) return;
    // never over another world's WORLD.md
    const now = await GET<WorldMdInfo>('/world/md').catch(() => null);
    if (!now || now.worldId !== draftOf) {
      if (now) setInfo(now);
      toast('This edit was for another world, so it wasn’t saved. Copy what you need, then press Cancel.', 'warn');
      return;
    }
    const r = await attempt(() => PUT<WorldMdInfo>('/world/md', { text: editing }), 'Saved WORLD.md');
    if (r) {
      setInfo(r);
      setEditing(null);
    }
  };
  const showVersions = async () => setVersions(versions ? null : await GET<MdVersion[]>('/world/md/versions').catch((): MdVersion[] => []));
  const view = async (v: MdVersion) => {
    const full = await attempt(() => GET<{ item: { text: string } }>(`/world/md/versions/${v.id}`));
    if (full) modal({ title: `WORLD.md from ${new Date(v.at).toLocaleString()}`, body: md(full.item.text) });
  };
  const restore = async (v: MdVersion) => {
    if (!(await confirmBox(`Bring back the WORLD.md from ${new Date(v.at).toLocaleString()}? The one there now is kept in the history.`, { ok: 'Bring it back' }))) return;
    const r = await attempt(() => POST<WorldMdInfo>(`/world/md/versions/${v.id}/restore`), 'Brought the earlier WORLD.md back');
    if (r) {
      setInfo(r);
      setVersions(await GET<MdVersion[]>('/world/md/versions').catch((): MdVersion[] => []));
    }
  };
  return (
    <div className="world-md flex flex-col gap-2.5">
      <p className="hint">What this world is: its theme and meaning, look, feel, places and characters. Every builder reads it before building and keeps it up to date.{shown.how === 'carried' ? ' Saving a change makes this world the project’s own copy.' : ''}</p>
      {editing === null ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              className="btn small"
              onClick={() => {
                setDraftOf(info?.worldId || '');
                setEditing(info?.text || '');
              }}
              disabled={!info}
            >
              <Icon name="pencil" size={13} /> Edit
            </button>
            <button className="btn ghost small" onClick={() => void showVersions()} aria-pressed={!!versions}>
              <Icon name="history" size={13} /> History
            </button>
            {info?.updatedAt ? <span className={ROW_META}>changed {ago(info.updatedAt)}</span> : null}
          </div>
          {versions ? (
            <div className="flex flex-col gap-1">
              {versions.length ? null : <p className="hint">No earlier versions yet.</p>}
              {versions.map((v) => (
                <div key={v.id} className={ROW}>
                  <span className="min-w-0 flex-1">
                    {new Date(v.at).toLocaleString()} <span className={ROW_META}>by {BY[v.by] || v.by} · {fmt(v.chars)} characters</span>
                  </span>
                  <button className="btn ghost tiny" onClick={() => void view(v)}>
                    View
                  </button>
                  <button className="btn ghost tiny" onClick={() => void restore(v)}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {info ? <DomNode className="md text-[13px]" make={() => md(info.text)} deps={[info.text]} /> : <p className="hint">Loading…</p>}
        </>
      ) : (
        <>
          {otherWorld ? <p className="hint text-amber">The world shown changed while you were editing. This text was for the other world, so it can’t be saved here.</p> : null}
          <textarea
            className="code min-h-80 w-full resize-y leading-[1.55]"
            spellCheck={false}
            value={editing}
            aria-label="WORLD.md"
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                void save();
              }
            }}
          />
          <div className="flex items-center gap-1.5">
            <button className="btn small" onClick={() => void save()} disabled={editing === info?.text || otherWorld}>
              Save
            </button>
            <button className="btn ghost small" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <span className={`ml-auto ${ROW_META}`}>
              {fmt(editing.length)} / {fmt(info?.max || 50000)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Built: objects, prefabs, recent changes ----------
function BuiltTab({ shown, reload }: { shown: WorldAnswer; reload: () => void }) {
  const w = shown.world;
  const [prefabs, setPrefabs] = useState<PrefabRow[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [library, setLibrary] = useState(false);
  const load = useCallback(() => {
    void GET<PrefabRow[]>('/world/prefabs')
      .then(setPrefabs)
      .catch(() => setPrefabs([]));
    void GET<Change[]>('/world/changes')
      .then(setChanges)
      .catch(() => setChanges([]));
  }, []);
  useEffect(load, [load, w?.updatedAt]);
  if (!w) return <p className="hint">Nothing built yet. Ask the Brain for a world, or give an agent the Voxel world tools.</p>;
  const groups = new Map<string, VoxelObjectMeta[]>();
  for (const o of w.objects) groups.set(o.by.name, [...(groups.get(o.by.name) || []), o]);
  const hide = (o: VoxelObjectMeta) => attempt(() => PUT(`/world/objects/${o.id}`, { hidden: !o.hidden })).then(reload);
  const remove = async (o: VoxelObjectMeta) => {
    if (!(await confirmBox(`Delete "${o.name}"? It can be brought back with "Undo the last change".`, { ok: 'Delete', danger: true }))) return;
    await attempt(() => DEL(`/world/objects/${o.id}`), `Deleted "${o.name}"`);
    reload();
  };
  const removePrefab = async (p: PrefabRow) => {
    if (!(await confirmBox(`Delete the prefab "${p.name}"?`, { ok: 'Delete', danger: true }))) return;
    await attempt(() => DEL(`/world/prefabs/${p.id}`), `Deleted the prefab "${p.name}"`);
    load();
  };
  const publish = async (p: PrefabRow) => {
    const r = await attempt(() => POST<{ text: string }>(`/world/prefabs/${p.id}/publish`));
    if (r) toast(r.text);
  };
  const undo = async () => {
    const r = await attempt(() => POST<{ text: string }>('/world/undo', { anyone: true }));
    if (r) toast(r.text);
    reload();
    load();
  };
  return (
    <div className="world-built">
      <div className="flex items-center gap-2">
        <span className="hint flex-1">
          {fmt(w.objects.length)} objects · {fmt(w.objects.reduce((n, o) => n + voxels(o), 0))} voxels · {fmt(w.objects.reduce((n, o) => n + (o.instances || 0), 0))} placed copies
        </span>
        <button className="btn ghost small" onClick={() => void undo()} disabled={!changes.length}>
          <Icon name="rotate-ccw" size={13} /> Undo the last change
        </button>
      </div>
      {[...groups].map(([who, list]) => (
        <div key={who}>
          <div className={SECTION}>Built by {who}</div>
          <div className="flex flex-col gap-1">
            {list.map((o) => (
              <div key={o.id} className={`${ROW} ${o.hidden ? 'opacity-55' : ''}`}>
                <span className="min-w-0 flex-1 truncate">
                  {o.name}{' '}
                  <span className={ROW_META}>
                    {fmt(voxels(o))} voxels{o.instances ? ` · ${fmt(o.instances)} copies` : ''} · {ago(o.updatedAt)}
                  </span>
                </span>
                <button className="btn ghost tiny" onClick={() => void hide(o)}>
                  {o.hidden ? 'Show' : 'Hide'}
                </button>
                <ExportButtons what="object" id={o.id} name={o.name} />
                <button className={ICON_BTN} title={`Delete ${o.name}`} aria-label={`Delete ${o.name}`} onClick={() => void remove(o)}>
                  <Icon name="trash-2" size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center">
        <div className={`${SECTION} flex-1`}>Prefabs</div>
        <button className="btn ghost tiny mt-3" onClick={() => setLibrary(!library)} aria-pressed={library}>
          <Icon name="library-big" size={12} /> Library
        </button>
      </div>
      {library ? <LibraryView onTaken={load} /> : null}
      {prefabs.length ? null : <p className="hint">No prefabs yet. Builders make the small things there are many of (people, trees, lamps) once, then place copies.</p>}
      <div className="flex flex-col gap-1">
        {prefabs.map((p) => (
          <div key={p.id} className={ROW}>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {p.name} <span className={ROW_META}>by {p.by.name}</span>
              </span>
              <span className={`block truncate ${ROW_META}`}>
                {p.description || 'no description'} · {p.size.join('×')} · {p.uses ? `${fmt(p.uses.copies)} copies in ${p.uses.in.join(', ')}` : 'not placed'}
              </span>
            </span>
            <button className={ICON_BTN} title="Share to the library: every project can take it" aria-label={`Share ${p.name} to the library`} onClick={() => void publish(p)}>
              <Icon name="upload" size={13} />
            </button>
            <ExportButtons what="prefab" id={p.id} name={p.name} />
            {p.uses ? null : (
              <button className={ICON_BTN} title={`Delete ${p.name}`} aria-label={`Delete ${p.name}`} onClick={() => void removePrefab(p)}>
                <Icon name="trash-2" size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className={SECTION}>Recent changes</div>
      {changes.length ? null : <p className="hint">Nothing yet.</p>}
      <div className="flex flex-col gap-0.5 text-[12.5px]">
        {changes.slice(0, 12).map((c, i) => (
          <div key={`${c.at}-${i}`} className="flex gap-2">
            <span className={`w-16 flex-none ${ROW_META}`}>{ago(c.at)}</span>
            <span className="min-w-0 flex-1">
              {c.by} {c.what}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The shared prefab library: search it, and take a prefab into this world. */
function LibraryView({ onTaken }: { onTaken: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void GET<LibraryRow[]>(`/prefab-library?q=${encodeURIComponent(q.trim())}`)
        .then(setRows)
        .catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const take = async (r: LibraryRow) => {
    const p = await attempt(() => POST<VoxelPrefabMeta>('/world/prefabs/import', { name: r.name }));
    if (p) {
      toast(`Took "${r.name}" into this world${p.name !== r.name ? ` as "${p.name}"` : ''}`);
      onTaken();
    }
  };
  return (
    <div className="world-library mb-2 flex flex-col gap-1.5 rounded-box border border-line-2 p-2">
      <p className="hint">Prefabs shared from every project. Take one into this world to place copies of it.</p>
      <input className="w-full" type="search" placeholder="Search the library" aria-label="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
      {!rows ? <p className="hint">Loading…</p> : rows.length ? null : <p className="hint">{q ? 'Nothing matches.' : 'The library is empty. Share a prefab to it with its upload button.'}</p>}
      {(rows || []).map((r) => (
        <div key={r.id} className={ROW}>
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              {r.name} <span className={ROW_META}>by {r.by} · from {r.fromWorld}</span>
            </span>
            <span className={`block truncate ${ROW_META}`}>
              {r.description || 'no description'} · {r.size.join('×')} · {fmt(r.voxels)} voxels
            </span>
          </span>
          <button className="btn ghost tiny" onClick={() => void take(r)}>
            Take into this world
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- Look ----------
const PRESETS = [
  { value: 'station', label: 'Station' },
  { value: 'day', label: 'Day' },
  { value: 'golden', label: 'Golden hour' },
  { value: 'dusk', label: 'Dusk' },
  { value: 'night', label: 'Night' },
  { value: 'overcast', label: 'Overcast' },
  { value: 'snow', label: 'Snowy' },
] as const;
const WEATHER = [
  { value: 'none', label: 'Clear' },
  { value: 'snow', label: 'Snow' },
  { value: 'rain', label: 'Rain' },
  { value: 'petals', label: 'Petals' },
  { value: 'leaves', label: 'Leaves' },
  { value: 'dust', label: 'Dust' },
] as const;

function LookSlider({ label, value, max, step, onCommit }: { label: string; value: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="mt-2.5 flex items-center gap-3">
      <span className="w-28 flex-none text-[12.5px] text-dim">{label}</span>
      <Slider.Root className="flex-1" min={0} max={max} step={step} value={v} onValueChange={(n) => setV(Array.isArray(n) ? n[0] : n)} onValueCommitted={(n) => onCommit(Array.isArray(n) ? n[0] : n)}>
        <Slider.Control className="flex h-5 cursor-pointer touch-none items-center">
          <Slider.Track className="relative h-1 flex-1 rounded-[2px] bg-line-2">
            <Slider.Indicator className="rounded-[2px] bg-accent" />
            <Slider.Thumb className="size-3.5 rounded-full bg-accent has-focus-visible:outline has-focus-visible:outline-offset-3 has-focus-visible:outline-accent" aria-label={label} />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <span className="w-9 flex-none text-right font-mono text-[11px] text-dim">{v.toFixed(2)}</span>
    </div>
  );
}

function LookTab({ shown, teamName }: { shown: WorldAnswer; teamName?: (id: string) => string | undefined }) {
  const w = shown.world;
  if (!w) return <p className="hint">There is no world yet: its look (time of day, weather, lights) shows here once something is built.</p>;
  const env: WorldEnvironment = w.environment;
  const setEnv = (fields: Record<string, unknown>) => attempt(() => PUT('/world/environment', fields));
  const removeLight = (id: string, name: string) => attempt(() => DEL(`/world/lights/${id}`), `Took the light "${name}" away`);
  const removeEffect = (id: string, name: string) => attempt(() => DEL(`/world/effects/${id}`), `Took "${name}" away`);
  return (
    <div className="world-look">
      <div className={SECTION}>Time of day</div>
      <Chips label="Time of day" options={PRESETS} value={env.preset} onChange={(preset) => void setEnv({ preset })} />
      <div className={SECTION}>Weather</div>
      <Chips label="Weather" options={WEATHER} value={env.weather || 'none'} onChange={(weather) => void setEnv({ weather })} />
      <LookSlider label="Glow" value={env.bloom} max={2} step={0.05} onCommit={(bloom) => void setEnv({ bloom })} />
      <LookSlider label="Miniature blur" value={env.tiltShift} max={1} step={0.05} onCommit={(tiltShift) => void setEnv({ tiltShift })} />
      <div className={SECTION}>Lights</div>
      {w.lights.length ? null : <p className="hint">None put up. Glowing things (lanterns, windows, signs) light their surroundings by themselves.</p>}
      <div className="flex flex-col gap-1">
        {w.lights.map((l) => (
          <div key={l.id} className={ROW}>
            <span className="size-3 flex-none rounded-full" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }} />
            <span className="min-w-0 flex-1 truncate">
              {l.name} <span className={ROW_META}>{l.kind} · by {l.by.name}</span>
            </span>
            <button className={ICON_BTN} title={`Take ${l.name} away`} aria-label={`Take ${l.name} away`} onClick={() => void removeLight(l.id, l.name)}>
              <Icon name="trash-2" size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className={SECTION}>Effects</div>
      {w.effects.length ? null : <p className="hint">No petals, fireflies, smoke or birds yet.</p>}
      <div className="flex flex-col gap-1">
        {w.effects.map((e) => (
          <div key={e.id} className={ROW}>
            <span className="min-w-0 flex-1 truncate">
              {e.name} <span className={ROW_META}>{e.kind} · by {e.by.name}</span>
            </span>
            <button className={ICON_BTN} title={`Take ${e.name} away`} aria-label={`Take ${e.name} away`} onClick={() => void removeEffect(e.id, e.name)}>
              <Icon name="trash-2" size={13} />
            </button>
          </div>
        ))}
      </div>
      <Dressed skins={w.skins} teamName={teamName} />
    </div>
  );
}

/** Who is dressed or off the map, with a way back. */
function Dressed({ skins, teamName }: { skins: WorldSkins; teamName?: (id: string) => string | undefined }) {
  const agents = state.data?.agents || [];
  const rows: { key: string; to: 'agent' | 'team' | 'brain'; id?: string; name: string; hidden: boolean; noLabel: boolean }[] = [];
  if (skins.brain) rows.push({ key: 'brain', to: 'brain', name: 'The Brain', hidden: !!skins.brain.hidden, noLabel: skins.brain.label === false });
  for (const [id, s] of Object.entries(skins.teams)) rows.push({ key: `t:${id}`, to: 'team', id, name: teamName?.(id) || 'A team of another project', hidden: !!s.hidden, noLabel: s.label === false });
  for (const [id, s] of Object.entries(skins.agents)) rows.push({ key: `a:${id}`, to: 'agent', id, name: agents.find((a) => a.id === id)?.name || 'An agent of another project', hidden: !!s.hidden, noLabel: s.label === false });
  const set = (r: (typeof rows)[number], fields: Record<string, unknown>, done: string) => attempt(() => PUT('/world/skins', { to: r.to, id: r.id, fields }), done);
  return (
    <>
      <div className={SECTION}>How the Brain, teams and agents look</div>
      {rows.length ? null : <p className="hint">Everyone looks classic. Builders can give agents a form of their own (a person, an animal, a tree…) and dress team platforms and the Brain.</p>}
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className={ROW}>
            <span className="min-w-0 flex-1 truncate">
              {r.name} <span className={ROW_META}>{r.hidden ? 'off the map' : 'dressed'}{r.noLabel ? ' · no name label' : ''}</span>
            </span>
            {r.hidden || r.noLabel ? (
              <button className="btn ghost tiny" onClick={() => void set(r, { hidden: false, label: true }, `${r.name} is back on the map`)}>
                Show on the map
              </button>
            ) : null}
            <button className="btn ghost tiny" onClick={() => void set(r, { clear: true }, `${r.name} looks classic again`)}>
              Look classic again
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------- which world this project shows ----------
export function WorldPicker({ shown, reload }: { shown: WorldAnswer; reload: () => void }) {
  const [worlds, setWorlds] = useState<WorldListing[] | null>(null);
  const load = useCallback(() => {
    void GET<WorldListing[]>('/worlds')
      .then(setWorlds)
      .catch(() => setWorlds([]));
  }, []);
  useEffect(load, [load, shown.world?.id, shown.world?.updatedAt, shown.how]);
  const projects = state.data?.projects || [];
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name || 'a removed project';
  const after = () => {
    reload();
    load();
    refreshSoon(0);
  };
  const choose = (mode: 'share' | 'copy' | 'new' | 'auto', worldId?: string, done?: string) => attempt(() => PUT('/project-world', { worldId, mode }), done).then(after);
  const rename = async () => {
    if (!shown.world) return;
    const name = await promptBox('Name this world', { value: shown.world.name, label: 'Name' });
    if (name?.trim()) await attempt(() => PUT(`/worlds/${shown.world!.id}`, { name: name.trim() }), 'Renamed the world').then(after);
  };
  const setDefault = (id: string | null) => attempt(() => PUT('/worlds/default', { worldId: id }), id ? 'Projects without a world of their own now show this one' : 'Projects without a world of their own now show the most recently built one').then(after);
  const remove = async (l: WorldListing) => {
    if (!(await confirmBox(`Delete the world "${l.name}"? Its builds, prefabs and WORLD.md go for good: this can't be undone.`, { ok: 'Delete it', danger: true }))) return;
    await attempt(() => DEL(`/worlds/${l.id}`), `Deleted "${l.name}"`).then(after);
  };
  const newWorld = async () => {
    if (!(await confirmBox('Start a new empty world for this project? The world it shows now stays as it is.', { ok: 'New world' }))) return;
    await choose('new', undefined, 'This project has a new empty world');
  };
  return (
    <div className="world-picker">
      <p className="text-[13px]">{howText(shown)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {shown.world && shown.how !== 'carried' ? (
          <button className="btn ghost small" onClick={() => void rename()}>
            <Icon name="pencil" size={13} /> Rename it
          </button>
        ) : null}
        <button className="btn ghost small" onClick={() => void newWorld()}>
          <Icon name="plus" size={13} /> New empty world
        </button>
        {shown.world?.built ? (
          <button className="btn ghost small" onClick={() => void exportIt('world', 'glb', `"${shown.world!.name}"`)} title="The whole world as a 3D model (.glb), saved to Artifacts">
            <Icon name="download" size={13} /> Export the whole world
          </button>
        ) : null}
        <button className="btn ghost small" onClick={() => void choose('auto', undefined, 'Back to its own world, or the carried-over one')} title="Forget the world picked for this project: its own world when it has one built, else the default or the most recently built world">
          Back to carry-over
        </button>
      </div>
      <div className={SECTION}>Every world</div>
      {!worlds ? <p className="hint">Loading…</p> : worlds.length ? null : <p className="hint">No worlds yet.</p>}
      <div className="flex flex-col gap-1.5">
        {(worlds || []).map((l) => {
          const here = l.id === shown.world?.id;
          return (
            <div key={l.id} className={`world-row flex flex-col gap-1.5 rounded-box border px-2.75 py-2 ${here ? 'border-accent-dim' : 'border-line'} bg-bg`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{l.name}</span>
                {l.isDefault ? <span className="pill">default</span> : null}
                {here ? <span className="pill ok">shown here</span> : null}
              </div>
              <span className={ROW_META}>
                {l.built ? `${fmt(l.objects)} objects · ${fmt(l.voxels)} voxels` : 'nothing built'} · made for {projectName(l.homeProject)}
                {l.usedBy.length ? ` · used by ${l.usedBy.map(projectName).join(', ')}` : ' · not used by any project'} · {ago(l.updatedAt)}
              </span>
              <div className="flex flex-wrap gap-1">
                {here && shown.how !== 'carried' ? null : (
                  <>
                    <button className="btn tiny" onClick={() => void choose('share', l.id, `This project now builds in "${l.name}" too`)} title="Both projects build in the same world">
                      Share it
                    </button>
                    <button className="btn ghost tiny" onClick={() => void choose('copy', l.id, `This project now has its own copy of "${l.name}"`)} title="A new world of this project's own, starting as a copy">
                      Start from a copy
                    </button>
                  </>
                )}
                <button className="btn ghost tiny" onClick={() => void setDefault(l.isDefault ? null : l.id)} title="The world projects with nothing built of their own show">
                  {l.isDefault ? 'No default' : 'Make it the default'}
                </button>
                {l.usedBy.length ? null : (
                  <button className="btn ghost tiny danger" onClick={() => void remove(l)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The world picker on its own (from the project menu): works whatever the Station's look. */
function PickerWindow(): ReactNode {
  const { shown, reload } = useWorld();
  return shown ? <WorldPicker shown={shown} reload={reload} /> : <p className="hint">Loading…</p>;
}

export function openWorldPicker(): void {
  const body = document.createElement('div');
  body.className = 'min-w-[min(520px,85vw)]';
  const view = mountReact(body, <PickerWindow />);
  modal({ title: `${state.data?.project?.name || 'This project'}: its voxel world`, body, onClose: () => view.unmount() });
}
