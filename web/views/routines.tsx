// Routines: instructions you run again and again. Type @ in the text to mention who does it (agents,
// teams) and which skills they use. Run it by hand or on a schedule.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { h, GET, POST, PUT, DEL, attempt, navigate, confirmBox, ago, state } from '../core.ts';
import { icon } from '../icons.ts';
import { loadSkills, skillsCache } from '../skillpick.ts';
import { scheduleEditor, scheduleText } from '../schedule.ts';
import { openChat } from '../chatwin.tsx';
import { attachMentions, startMention, KIND_LABEL } from '../routinemention.ts';
import type { Candidate } from '../routinemention.ts';
import { findMentions } from '../../shared/routines.ts';
import { Field } from '../ui/controls.tsx';
import { DomNode, Icon, ProjectScoped, reactPage, useAppState, useServerEvents } from '../ui/react.tsx';
import type { AppState, Routine, RoutineListing, RoutineMention, RoutineMentionKind, RoutineRun, RoutineRunTarget, TeamListing } from '../../shared/types.ts';

/** Agents, teams and skills a routine can mention. Agents first: on a name clash they win (the server does the same). */
export function candidates(d: Pick<AppState, 'agents'>, teams: readonly TeamListing[]): Candidate[] {
  return [
    ...d.agents.map((a): Candidate => ({ kind: 'agent', id: a.id, name: a.name, lead: h('span', { class: 'w-3.5 text-center flex-none' }, a.emoji || '🤖'), sub: a.specialty || a.description || '', color: a.color })),
    ...teams.map((t): Candidate => ({ kind: 'team', id: t.id, name: t.name, lead: icon('users', 14), sub: `${t.members.length} member${t.members.length === 1 ? '' : 's'}${t.description ? ` · ${t.description}` : ''}`, color: t.color })),
    ...skillsCache().map((s): Candidate => ({ kind: 'skill', id: s.slug, name: s.name, lead: icon('puzzle', 14), sub: s.description })),
  ];
}

/** Loads the teams and the skills a routine can mention, and keeps the teams current. */
function useTeams(): TeamListing[] | null {
  const [teams, setTeams] = useState<TeamListing[] | null>(null);
  const load = useCallback(() => GET<TeamListing[]>('/workflows').catch((): TeamListing[] => []), []);
  useEffect(() => {
    let live = true;
    void Promise.all([load(), loadSkills()]).then(([t]) => live && setTeams(t));
    return () => void (live = false);
  }, [load]);
  useServerEvents((ev) => ['agents', 'workflows'].includes(ev.type) && void load().then(setTeams));
  return teams;
}

// a mention as a chip: a team in its own color (--c), a skill in the accent, crossed out once it's gone
const CHIP = 'inline-flex items-center gap-1.25 py-0.5 px-2.25 rounded-full border border-line-2 text-[12px] whitespace-nowrap max-w-full overflow-hidden text-ellipsis [&_.ico-svg]:flex-none';
const CHIP_KIND: Record<RoutineMentionKind, string> = {
  agent: '[&_.ico-svg]:text-dim',
  team: '[&_.ico-svg]:text-dim border-[color-mix(in_srgb,var(--c,#7350c8)_55%,var(--color-line))]',
  skill: '[&_.ico-svg]:text-accent border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-line))]',
};
const CHIP_BG: Record<RoutineMentionKind, string> = {
  agent: '',
  team: 'bg-[color-mix(in_srgb,var(--c,#7350c8)_14%,transparent)]',
  skill: 'bg-accent/9',
};
const CHIPS = 'flex flex-wrap gap-1.25 items-center min-w-0';

function MentionChip({ m, teams, extra }: { m: RoutineMention; teams: readonly TeamListing[]; extra?: ReactNode }) {
  const d = state.data;
  const a = m.kind === 'agent' ? d?.agents.find((x) => x.id === m.id) : null;
  const t = m.kind === 'team' ? teams.find((x) => x.id === m.id) : null;
  const look = m.missing ? 'border-dashed text-faint bg-transparent line-through' : `text-ink ${CHIP_BG[m.kind]}`;
  return (
    <span className={`${CHIP} ${CHIP_KIND[m.kind]} ${look}`} style={t?.color ? ({ '--c': t.color } as CSSProperties) : undefined} title={m.missing ? `${m.name} no longer exists` : KIND_LABEL[m.kind].slice(0, -1)}>
      {m.kind === 'agent' ? <span>{a?.emoji || '🤖'}</span> : <Icon name={m.kind === 'team' ? 'users' : 'puzzle'} size={11} />}
      {m.name}
      {extra}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'done' || status === 'sent') return <span className="text-accent" aria-label="done">✓</span>;
  if (status === 'failed') return <span className="text-red" aria-label="failed">✕</span>;
  if (status === 'running') return <span className="dot busy" aria-label="running" />;
  if (status === 'stopped') return <span className="text-amber" aria-label="stopped">■</span>;
  return <span className="text-faint">·</span>;
}

// ---------- the list ----------
async function create(): Promise<void> {
  const r = await attempt(() => POST<Routine>('/routines', { name: 'New routine' }));
  if (r) navigate(`#/routines/${r.id}`);
}

function RoutinesList() {
  const teams = useTeams();
  const [list, setList] = useState<RoutineListing[] | null>(null);
  const reload = useCallback(() => GET<RoutineListing[]>('/routines').then(setList).catch(() => {}), []);
  useEffect(() => void reload(), [reload]);
  useServerEvents((ev) => (ev.type === 'routines' || ev.type === 'routine-run') && void reload());
  if (!teams || !list) return <p className="text-dim">Loading routines…</p>;
  return (
    <>
      <p className="lede">A routine is work you want done again and again: a morning news check, a weekly report, a content plan. Write it once, @mention the agents and teams who do it and the skills they should use, then run it by hand or on a schedule.</p>
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3.5">
        <h2 className="section m-0">{`Your routines${list.length ? ` (${list.length})` : ''}`}</h2>
        <button className="btn small" onClick={() => void create()}>
          <Icon name="plus" size={14} />
          New routine
        </button>
      </div>
      {list.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
          {list.map((r) => (
            <RoutineCard key={r.id} r={r} teams={teams} />
          ))}
        </div>
      ) : (
        <div className="empty box">
          <p className="mb-3">No routines yet.</p>
          <p className="hint mx-auto mb-3.5 max-w-130">Example: "Every morning, @Researcher finds the 3 biggest AI stories, then @Content Team turns them into a post using @Brand voice."</p>
          <button className="btn small" onClick={() => void create()}>
            <Icon name="plus" size={14} />
            Write your first routine
          </button>
        </div>
      )}
    </>
  );
}

const DESC = 'm-0 text-dim text-[13px] leading-[1.45] line-clamp-3';

function RoutineCard({ r, teams }: { r: RoutineListing; teams: TeamListing[] }) {
  const [running, setRunning] = useState(false);
  const last = r.lastRun;
  const sched = r.schedule && r.schedule.type !== 'none';
  const run = async () => {
    setRunning(true);
    await attempt(() => POST(`/routines/${r.id}/run`, {}), 'Routine started');
    setRunning(false);
  };
  return (
    <div className="flex flex-col gap-2.5 p-3.5 border border-line rounded-[12px] bg-panel cursor-pointer transition-[border-color,transform] duration-180 ease-[ease] animate-[rise-in_.25s_ease-out_both] min-w-0 hover:border-accent-dim hover:[transform:translateY(-1px)]">
      <div className="flex gap-3 items-center">
        <div className="skill-ico"><Icon name="repeat" size={18} /></div>
        <div className="flex-1 min-w-0">
          <a className="skill-name font-semibold text-[15px] text-inherit hover:text-accent" href={`#/routines/${r.id}`}>{r.name}</a>
          <div className="hint">{sched ? (r.enabled ? scheduleText(r.schedule) : `${scheduleText(r.schedule)} · off`) : 'run by hand'}</div>
        </div>
      </div>
      {r.description || r.text ? <p className={DESC}>{r.description || r.text}</p> : <p className={DESC}>Nothing written yet.</p>}
      {r.mentions.length ? (
        <div className={CHIPS}>
          {r.mentions.map((m) => (
            <MentionChip key={`${m.kind}:${m.id}`} m={m} teams={teams} />
          ))}
        </div>
      ) : (
        <span className="hint">Nobody mentioned yet</span>
      )}
      <div className="flex items-center gap-1.5 mt-auto">
        <button className="btn small" disabled={running} onClick={() => void run()}>
          <Icon name="play" size={13} />
          Run
        </button>
        <span className="flex-1 min-w-0" />
        {last ? (
          <span className="hint">
            <StatusIcon status={last.status} />
            {` ${last.status} · ${ago(last.createdAt)}`}
          </span>
        ) : (
          <span className="hint">never run</span>
        )}
      </div>
    </div>
  );
}

// ---------- the editor ----------
function RoutineEditor({ id }: { id: string }) {
  const teams = useTeams();
  const [loaded, setLoaded] = useState<Routine | null | 'gone'>(null);
  useEffect(() => {
    let live = true;
    void GET<Routine>(`/routines/${id}`)
      .then((r) => live && setLoaded(r))
      .catch(() => live && setLoaded('gone'));
    return () => void (live = false);
  }, [id]);
  if (loaded === 'gone')
    return (
      <p>
        Routine not found. <a href="#/routines">Back to routines</a>
      </p>
    );
  if (!loaded || !teams) return <p className="text-dim">Loading routines…</p>;
  return <EditorForm first={loaded} teams={teams} />;
}

function EditorForm({ first, teams }: { first: Routine; teams: TeamListing[] }) {
  const d = useAppState();
  const id = first.id;
  // the routine as edited; the schedule editor (plain DOM) changes schedule and enabled on it directly
  const r = useRef<Routine>(structuredClone(first));
  const [name, setName] = useState(first.name);
  const [description, setDescription] = useState(first.description || '');
  const [text, setText] = useState(first.text);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const missing = first.mentions.filter((m) => m.missing);
  const ta = useRef<HTMLTextAreaElement>(null);
  const cands = () => (d ? candidates(d, teams) : []);
  const candsRef = useRef(cands);
  candsRef.current = cands;
  useEffect(() => attachMentions(ta.current!, () => candsRef.current(), () => {}), []);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    const out = await attempt(() => PUT<Routine>(`/routines/${id}`, { name, description, text, schedule: r.current.schedule, enabled: r.current.enabled }), 'Saved');
    setSaving(false);
    if (!out) return false;
    r.current.mentions = out.mentions;
    setDirty(false);
    return true;
  };
  const del = async () => {
    if (!(await confirmBox(`Delete the routine "${name}"?`, { ok: 'Delete', danger: true }))) return;
    if (await attempt(() => DEL(`/routines/${id}`), 'Deleted')) navigate('#/routines');
  };

  // who the text mentions
  const found = findMentions(text, cands());
  const mTeams = found.filter((m) => m.kind === 'team');
  const viaTeam = (agentId: string) => mTeams.map((m) => teams.find((t) => t.id === m.id)).find((t) => t?.members.includes(agentId));
  const gone = missing.filter((m) => findMentions(text, [m]).length);
  const doers = [
    ...mTeams.map((m) => <MentionChip key={`t:${m.id}`} m={m} teams={teams} />),
    ...found
      .filter((m) => m.kind === 'agent')
      .map((m) => {
        const t = viaTeam(m.id);
        return <MentionChip key={`a:${m.id}`} m={m} teams={teams} extra={t ? <span className="font-mono text-[10.5px] leading-[normal] font-normal text-faint">{`in ${t.name}`}</span> : null} />;
      }),
  ];
  const skills = found.filter((m) => m.kind === 'skill').map((m) => <MentionChip key={`s:${m.id}`} m={m} teams={teams} />);
  const whoRow = (label: string, ico: string, items: ReactNode[], empty: string) => (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2.5 items-center max-sm:grid-cols-1 max-sm:gap-1.5">
      <div className="inline-flex items-center gap-1.5 font-mono text-[10.5px] leading-[normal] font-semibold tracking-[0.12em] uppercase text-dim">
        <Icon name={ico} size={13} />
        {label}
      </div>
      <div className={CHIPS}>{items.length ? items : <span className="hint">{empty}</span>}</div>
    </div>
  );
  const insert = (kind: RoutineMentionKind, label: string, ico: string) => (
    <button className="btn ghost tiny" type="button" title={`Mention ${label.toLowerCase()}`} onClick={() => startMention(ta.current!, kind)}>
      <Icon name={ico} size={12} />
      {label}
    </button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4">
        <a className="btn ghost small" href="#/routines">← Routines</a>
        <div className="flex flex-wrap items-center gap-2.5">
          <button className="btn" disabled={!dirty || saving} onClick={() => void save()}>Save</button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4.5">
          <div className="panel">
            <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
              <Field label="Name">
                <input value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} />
              </Field>
              <Field label="Description">
                <input value={description} placeholder="Optional, shown on the card" onChange={(e) => (setDescription(e.target.value), setDirty(true))} />
              </Field>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>What to do</h2>
              <div className="actions">
                {insert('agent', 'Agent', 'bot')}
                {insert('team', 'Team', 'users')}
                {insert('skill', 'Skill', 'puzzle')}
              </div>
            </div>
            <textarea
              ref={ta}
              className="min-h-45 leading-[1.55]"
              rows={9}
              aria-label="What to do"
              value={text}
              placeholder={'What should be done? Type @ to mention who does it and the skills to use.\n\ne.g. @Researcher find the 3 most interesting AI stories from the last day, with links. Then @Content Team writes one X post about the best one using @Brand voice.'}
              onChange={(e) => (setText(e.target.value), setDirty(true))}
            />
            <p className="hint">
              Type <b>@</b> to mention an agent, a team or a skill. Mentioned agents and teams each get the routine (an agent in a mentioned team gets it in that team chat); mentioned skills are given to all of them for it.
            </p>
            <div className="rt-who flex flex-col gap-2.5 mt-3.5 pt-3.5 border-t border-line">
              {whoRow('Who does it', 'users', doers, 'Mention at least one agent or team.')}
              {whoRow('Skills', 'puzzle', skills, 'None. Mention a skill to have them follow it.')}
              {gone.length ? (
                <p className="hint">
                  <Icon name="triangle-alert" size={12} />
                  {` ${gone.map((m) => `@${m.name}`).join(', ')} ${gone.length === 1 ? 'was' : 'were'} deleted, so ${gone.length === 1 ? 'it is' : 'they are'} left out.`}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4.5">
          <RunIt id={id} beforeRun={async () => !dirty || (await save())} />
          <div className="panel">
            <div className="panel-head">
              <h2>Schedule</h2>
            </div>
            <DomNode make={() => scheduleEditor(r.current, () => setDirty(true), { inputLabel: 'Extra for scheduled runs (optional)' })} deps={[id]} />
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Runs</h2>
            </div>
            <Runs id={id} />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button className="btn danger small" onClick={() => void del()}>Delete routine</button>
          </div>
        </div>
      </div>
    </>
  );
}

function RunIt({ id, beforeRun }: { id: string; beforeRun: () => Promise<boolean> }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!(await beforeRun())) return;
    setBusy(true);
    const out = await attempt(() => POST(`/routines/${id}/run`, { input }), 'Routine started');
    setBusy(false);
    if (out) setInput('');
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Run it</h2>
      </div>
      <textarea rows={2} aria-label="Extra for this run" placeholder="Optional: anything extra for this run" value={input} onChange={(e) => setInput(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
        <button className="btn" disabled={busy} onClick={() => void run()}>
          <Icon name="play" size={14} />
          Run now
        </button>
      </div>
    </div>
  );
}

/** The routine's last runs, kept current; the newest is open, and whichever you opened stays open. */
function Runs({ id }: { id: string }) {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [open, setOpen] = useState<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(() => {
    clearTimeout(timer.current);
    // (a burst of events loads once)
    timer.current = setTimeout(() => void GET<RoutineRun[]>(`/routine-runs?routineId=${encodeURIComponent(id)}`).then(setRuns).catch(() => setRuns([])), 150);
  }, [id]);
  useEffect(() => (load(), () => clearTimeout(timer.current)), [load]);
  useServerEvents((ev) => ev.type === 'routine-run' && (ev as { routineId?: string }).routineId === id && load());
  if (!runs) return null;
  if (!runs.length) return <p className="empty">No runs yet.</p>;
  const isOpen = (run: RoutineRun, i: number) => (open ? open.has(run.id) : i === 0);
  return (
    <div className="flex flex-col gap-2.5">
      {runs.slice(0, 15).map((run, i) => (
        <details
          key={run.id}
          open={isOpen(run, i)}
          onToggle={(e) => {
            const now = (e.currentTarget as HTMLDetailsElement).open;
            if (now === isOpen(run, i)) return;
            const next = new Set(open ?? (runs[0] ? [runs[0].id] : []));
            if (now) next.add(run.id);
            else next.delete(run.id);
            setOpen(next);
          }}
        >
          <summary className="flex items-center gap-2 cursor-pointer py-1.5 flex-wrap">
            <StatusIcon status={run.status} />
            <b>{run.status}</b>
            <span className="hint">{`${ago(run.createdAt)} · ${run.trigger}`}</span>
            {run.status === 'running' ? (
              <button className="btn tiny danger" onClick={(e) => (e.preventDefault(), void attempt(() => POST(`/routine-runs/${run.id}/stop`)))}>Stop</button>
            ) : null}
          </summary>
          {run.targets.map((t) => (
            <TargetRow key={`${t.kind}:${t.id}`} t={t} />
          ))}
          {run.skills.length ? <div className="hint">{`Skills: ${run.skills.map((slug) => skillsCache().find((s) => s.slug === slug)?.name || slug).join(', ')}`}</div> : null}
        </details>
      ))}
    </div>
  );
}

function TargetRow({ t }: { t: RoutineRunTarget }) {
  return (
    <div className="grid grid-cols-[22px_1fr] gap-2.5 py-2 border-b border-line last:border-b-0 [&_pre]:max-h-50">
      <StatusIcon status={t.status} />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <b>{t.name}</b>
          <span className="hint">{t.kind === 'team' ? `team · ${t.status}` : t.status}</span>
          <span className="flex-1 min-w-0" />
          {t.kind === 'team' ? (
            <button className="btn ghost tiny" onClick={() => openChat('team', t.id)}>
              <Icon name="message-square" size={12} />
              Team chat
            </button>
          ) : t.chatId ? (
            <a className="btn ghost tiny" href={`#/agents/${t.id}/${t.chatId}`}>
              <Icon name="message-square" size={12} />
              Chat
            </a>
          ) : null}
        </div>
        {t.output ? <pre>{t.output}</pre> : null}
      </div>
    </div>
  );
}

export const title = (p: string[]) => (p[0] ? 'Routine' : 'Routines');
export const { render, unmount } = reactPage((p) => (p[0] ? <ProjectScoped><RoutineEditor id={p[0]} /></ProjectScoped> : <RoutinesList />));
