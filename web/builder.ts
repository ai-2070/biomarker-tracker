// Team builder: name it, give it a goal, pick its agents and lead (or let the Brain build it), choose its access.
import { h, mount, clear, state, GET, POST, PUT, attempt, modal, chipSet, select, toast, refreshSoon, avatar } from './core.ts';
import type { ModalHandle } from './core.ts';
import { teamSteps } from '../shared/teams.ts';
import { mcpOptions } from './mcpcopies.ts';
import { icon } from './icons.ts';
import { attachTray, baseName, isFolderPath } from './attach.ts';
import type { Agent, Team, TeamAccess, TeamStep } from '../shared/types.ts';

/** An agent the Brain designed (POST /api/assist/agent), not created yet. */
export type AgentDraft = Pick<Agent, 'name' | 'emoji' | 'specialty' | 'systemPrompt' | 'toolGroups' | 'mcpServers' | 'engine'>;
/** A team member: an existing agent, or one the Brain suggests hiring. */
export type BranchMember = { agentId: string; newAgent?: undefined } | { newAgent: AgentDraft; agentId?: undefined };
/** A team the Brain designed (POST /api/assist/branch). leadIndex points into members (-1 = no lead). */
export interface BranchDesign {
  name: string;
  description: string;
  access: TeamAccess;
  members: BranchMember[];
  leadIndex: number;
}
export interface BranchBuilderOptions {
  wf?: Team | null;
  prefill?: Partial<BranchDesign> | null;
  describe?: string;
  /** Files already uploaded (e.g. attached in the Brain chat) that the team starts with. */
  files?: string[];
  onSaved?: (wf: Team) => unknown;
}

// a member's ★ (lead) and ✕ buttons
const STEP_BTN = 'size-5.5 p-0 border cursor-pointer text-[11px] hover:enabled:text-accent hover:enabled:border-accent disabled:opacity-30 disabled:cursor-default';

const PALETTE = ['#3d58c0', '#b0508a', '#c07a34', '#3a8a7a', '#7350c8', '#b8a03a', '#4f7fa8', '#5a9a3a', '#a84a5a', '#2f8fa0'];

// wf: an existing team to edit. prefill: a design from the Brain ({ name, description, members, leadIndex, access }).
export async function openBranchBuilder({ wf = null, prefill = null, describe = '', files = [], onSaved }: BranchBuilderOptions = {}): Promise<ModalHandle> {
  const d = state.data!;
  const mcp = await GET<{ servers: Record<string, unknown> }>('/mcp').catch(() => ({ servers: {} as Record<string, unknown> }));
  // members: { agentId } for existing agents, { newAgent } for ones the Brain suggests hiring
  const fromTeam: BranchMember[] = (wf?.members || []).map((agentId) => ({ agentId }));
  // the lead is the member object itself, so removing or hiring others never loses it
  const b: { name: string; description: string; members: BranchMember[]; lead: BranchMember | null; access: TeamAccess; files: string[] } = {
    files: [...new Set([...(wf?.files || []), ...files])],
    name: wf?.name || prefill?.name || '',
    description: wf?.description || prefill?.description || describe || '',
    members: fromTeam.length ? fromTeam : structuredClone(prefill?.members || []),
    lead: null,
    access: { toolGroups: [...(wf?.access?.toolGroups || prefill?.access?.toolGroups || [])], mcpServers: [...(wf?.access?.mcpServers || prefill?.access?.mcpServers || [])] },
  };
  b.lead = (wf?.lead ? b.members.find((m) => m.agentId === wf.lead) : fromTeam.length ? null : b.members[prefill?.leadIndex ?? -1]) || null;
  // agents hired by an earlier save attempt, until the state catches up
  const hired = new Map<string, Agent>();
  const byId = () => new Map([...hired, ...state.data!.agents.map((a): [string, Agent] => [a.id, a])]);

  const name = h('input', { value: b.name, placeholder: 'e.g. Social, Video studio, Launch crew' });
  const desc = h('textarea', { rows: 2, value: b.description, placeholder: "The team's goal. Write it here and press Auto-build to let the Brain pick the agents." });
  name.addEventListener('input', () => (b.name = name.value));
  desc.addEventListener('input', () => (b.description = desc.value));

  const listEl = h('div', { class: 'flex flex-col gap-1.5' });
  const drawMembers = () => {
    const agents = byId();
    clear(listEl);
    b.members.forEach((m, j) => {
      const a = m.agentId ? agents.get(m.agentId) : null;
      const isLead = b.lead === m;
      listEl.append(
        h(
          'div',
          { class: 'flex items-center gap-2.5 py-2 px-2.5 border border-line bg-bg rounded-box [&_.avatar]:size-8.5 [&_.avatar]:text-[17px]' },
          a ? avatar(a) : h('div.avatar', m.newAgent?.emoji || '🤖'),
          h(
            'div',
            { class: 'flex-1 min-w-0' },
            h('div', { class: 'flex flex-wrap items-center gap-1.5' }, h('b', a ? a.name : m.newAgent?.name || 'Agent'), m.newAgent ? h('span.pill.ok', 'new agent') : null, isLead ? h('span.tc-lead', '★ lead') : null),
            h('div.hint', a ? a.specialty || '' : m.newAgent?.specialty || ''),
          ),
          h(
            'div',
            { class: 'flex gap-0.5 flex-none' },
            h('button', { class: `${STEP_BTN} ${isLead ? 'text-amber border-amber' : 'text-dim border-line-2'}`, title: isLead ? 'Remove as lead' : 'Make lead: your messages go to them first', onclick: () => ((b.lead = isLead ? null : m), drawMembers()) }, '★'),
            h('button', { class: `${STEP_BTN} text-dim border-line-2`, title: 'Remove', onclick: () => (b.members.splice(j, 1), isLead && (b.lead = null), drawMembers()) }, '✕'),
          ),
        ),
      );
    });
    if (!b.members.length) listEl.append(h('p.empty', 'No agents yet. Add them below, or describe the goal and press Auto-build.'));
  };

  let addId = d.agents[0]?.id || '';
  const addRow = h(
    'div',
    { class: 'flex flex-wrap items-center gap-2.5 mt-3.5' },
    d.agents.length
      ? [
          h('div', { style: { width: '260px' } }, select(d.agents.map((a) => ({ value: a.id, label: `${a.emoji || ''} ${a.name}` })), addId, (v) => (addId = v))),
          h('button.btn.small', {
            onclick: () => {
              if (!addId || b.members.some((m) => m.agentId === addId)) return;
              b.members.push({ agentId: addId });
              drawMembers();
            },
          }, '+ Add agent'),
        ]
      : h('span.hint', 'You have no agents yet: Auto-build can create them.'),
  );

  const accessEl = h('div');
  const drawAccess = () =>
    mount(
      accessEl,
      h('div.label', 'Programs & tools'),
      h('div', { class: 'mt-3.5' }, chipSet(state.data!.toolGroups.map((g) => ({ value: g.id, label: g.label, title: g.description })), b.access.toolGroups, (v) => (b.access.toolGroups = v))),
      Object.keys(mcp.servers).length ? [h('div.label', { class: 'mt-3.5' }, 'MCP servers'), h('div', { class: 'mt-3.5' }, chipSet(mcpOptions(Object.keys(mcp.servers), state.data?.mcpInfo), b.access.mcpServers, (v) => (b.access.mcpServers = v)))] : null,
      h('p.hint', { class: 'mt-3.5' }, 'While working for this team, every member gets these on top of its own tools.'),
    );

  // the team's files: reference material every member is told about (briefs, brand guides, assets)
  const tray = attachTray();
  const keptEl = h('div.att-tray');
  const drawKept = () => {
    keptEl.classList.toggle('hidden', !b.files.length);
    mount(
      keptEl,
      b.files.map((p) =>
        h(
          'span.att-chip.sent',
          { title: p },
          h('span.att-ico', icon(isFolderPath(p) ? 'folder' : 'file', 13)),
          h('span.att-name', `${baseName(p)}${isFolderPath(p) ? '/' : ''}`),
          h('button.att-x', { type: 'button', title: 'Take off the team (the file stays in uploads/)', onclick: () => ((b.files = b.files.filter((x) => x !== p)), drawKept()) }, icon('x', 12)),
        ),
      ),
    );
  };
  const filesEl = h(
    'div',
    h('div.label', 'Files'),
    h('div', { class: 'flex flex-col gap-2 mt-3.5' }, keptEl, tray.el, h('div', { class: 'flex flex-wrap items-center gap-2' }, tray.picker, h('span.hint', 'Briefs, brand guides, assets: drop or paste files or folders anywhere here. Auto-build reads them, and every member is told where they are.'))),
  );
  const allFiles = async () => {
    const fresh = await tray.ready();
    return fresh ? [...new Set([...b.files, ...fresh])] : null;
  };

  const status = h('span.hint');
  const autoBtn = h('button.btn.small', {
    onclick: async () => {
      const text = [b.name, b.description].filter(Boolean).join(': ').trim();
      if (!text && !tray.count() && !b.files.length) return toast("Describe the team's goal first.", 'warn');
      autoBtn.disabled = true;
      status.textContent = tray.busy() ? 'Uploading files…' : 'The Brain is picking agents…';
      const attachments = await allFiles();
      if (!attachments) {
        autoBtn.disabled = false;
        status.textContent = '';
        return;
      }
      status.textContent = 'The Brain is picking agents…';
      const design = await attempt(() => POST<BranchDesign>('/assist/branch', { text, attachments }));
      autoBtn.disabled = false;
      status.textContent = '';
      if (!design) return;
      b.name = b.name || design.name;
      b.description = b.description || design.description;
      name.value = b.name;
      desc.value = b.description;
      b.members = design.members;
      b.lead = design.members[design.leadIndex] || null;
      b.access = { toolGroups: design.access.toolGroups, mcpServers: design.access.mcpServers };
      drawMembers();
      drawAccess();
      const fresh = design.members.filter((m) => m.newAgent).length;
      toast(`Picked ${design.members.length} agents${fresh ? `, ${fresh} of them new` : ''}. Change anything, then save.`);
    },
  }, '✨ Auto-build');

  let m: ModalHandle;
  let saving = false;
  let savedOk = false;
  // closed while saving: if nothing was saved yet, stop there (and the files go)
  let closed = false;
  // one save at a time, or a double click hires everyone twice
  const saveBtn = h(
    'button.btn',
    {
      onclick: async () => {
        if (saving) return;
        saving = saveBtn.disabled = true;
        try {
          await save();
        } finally {
          saving = saveBtn.disabled = false;
        }
      },
    },
    wf ? 'Save team' : 'Create team',
  );
  const save = async () => {
    if (!b.name.trim()) return toast('Give the team a name.', 'warn');
    const teamFiles = await allFiles();
    if (closed) return tray.discard();
    if (!teamFiles) return;
    // hire the new agents the Brain suggested; each becomes a normal member right away, so a retry won't hire it again
    for (const mem of [...b.members]) {
      if (!mem.newAgent) continue;
      const a = await attempt(() => POST<Agent>('/agents', mem.newAgent));
      if (!a) return (refreshSoon(0), drawMembers());
      hired.set(a.id, a);
      const done: BranchMember = { agentId: a.id };
      b.members = b.members.map((x) => (x === mem ? done : x));
      if (b.lead === mem) b.lead = done;
    }
    const ids = b.members.map((mem) => mem.agentId).filter((id): id is string => !!id);
    // a step list keeps its own steps (the Station hands over its saved ones as stepList)
    const { stepList, ...rest } = (wf || {}) as Team & { stepList?: TeamStep[] };
    const own = stepList ?? rest.steps ?? [];
    const lead = b.lead?.agentId || null;
    const body = { name: b.name.trim(), description: b.description.trim(), members: ids, steps: teamSteps({ steps: own, members: ids }), lead, access: b.access, files: teamFiles };
    const saved = wf
      ? await attempt(() => PUT<Team>(`/workflows/${wf.id}`, { ...rest, ...body }))
      : await attempt(() => POST<Team>('/workflows', { ...body, color: PALETTE[Math.floor(Math.random() * PALETTE.length)], schedule: { type: 'none' }, enabled: false }));
    if (!saved) {
      // already closed: nothing will save these now
      if (closed) tray.discard();
      return (refreshSoon(0), drawMembers());
    }
    savedOk = true;
    refreshSoon(0);
    m.close();
    toast(wf ? 'Team saved' : `Team "${saved.name}" created`);
    onSaved?.(saved);
  };

  m = modal({
    title: wf ? `Edit ${wf.name}` : 'New team',
    body: h(
      'div',
      { class: 'flex flex-col gap-4.5' },
      h('p.hint', 'A team is a group chat of agents. You write to the team, the lead (or the best fit) takes it, and they hand work to each other with @mentions.'),
      h('div', { class: 'flex flex-col gap-2.5' }, h('label.field', h('span', 'Name'), name), h('label.field', h('span', 'Goal'), desc), h('div', { class: 'flex flex-wrap items-center gap-2.5' }, autoBtn, status)),
      filesEl,
      h('div', h('div.label', 'Members'), h('div', { class: 'mt-3.5' }, listEl), addRow),
      h('div', accessEl),
    ),
    foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), saveBtn],
    // closed without saving: the files dropped here go too
    // (a save already under way finishes, with its files; one still waiting for uploads stops)
    onClose: () => {
      closed = true;
      if (!savedOk && !saving) tray.discard();
    },
  });
  tray.dropZone(m.el.querySelector<HTMLElement>('.modal')!, 'Drop files or folders for the team');
  drawMembers();
  drawAccess();
  drawKept();
  setTimeout(() => (b.name ? desc : name).focus(), 30);
  return m;
}
