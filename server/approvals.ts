// "Needs you": anything an agent wants to do that you asked to check first.
// Each request is a promise that resolves when you click Allow / Deny in the dashboard.
// With "The Brain approves" on (the default), the Brain looks first: it allows routine, on-task
// actions itself and only passes the risky or unclear ones on to you.
import { emit, log, getSettings } from './store.ts';
import { uid } from './util.ts';
import type { Approval } from '../shared/types.ts';

/** What you answered (or what happened instead: a timeout or a stopped run). */
export interface ApprovalDecision {
  approved: boolean;
  message: string;
  edited?: unknown;
  always?: boolean;
}

export interface ApprovalRequest {
  kind?: string;
  title: string;
  detail?: string;
  agentId?: string | null;
  agentName?: string;
  data?: Record<string, unknown>;
  editable?: unknown;
  timeoutMs?: number;
}

/** The Brain's verdict on a request: allow it, or pass it on to you with a reason. */
export interface BrainVerdict {
  approve: boolean;
  reason: string;
}
export type Reviewer = (item: Approval) => Promise<BrainVerdict>;

interface Pending {
  item: Approval;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
  /** The Brain is still looking at it: not shown to you yet. */
  reviewing: boolean;
}

const pending = new Map<string, Pending>();

// Set by the server at start (kept out of this file so approvals don't depend on the Brain's code).
let reviewer: Reviewer | null = null;
export function setReviewer(fn: Reviewer | null) {
  reviewer = fn;
}

// The Brain checks what agents and teams want to do. Workflow checkpoints are steps you put
// there to check yourself, an outside MCP client isn't one of your agents, and a setting is yours
// (an agent asking isn't you asking): those always come to you.
const brainChecks = (item: Approval) => !!reviewer && item.kind !== 'workflow' && item.kind !== 'setting' && item.agentId !== '_external' && getSettings().brainApproves !== false;

export function requestApproval({ kind = 'tool', title, detail = '', agentId = null, agentName = '', data = {}, editable = null, timeoutMs = 30 * 60_000 }: ApprovalRequest): Promise<ApprovalDecision> {
  const id = uid('ap');
  return new Promise((resolve) => {
    const item: Approval = { id, kind, title, detail, agentId, agentName, data, editable, createdAt: Date.now() };
    const timer = setTimeout(() => finish(id, { approved: false, message: 'No answer within 30 minutes, so it was skipped.' }), timeoutMs);
    const review = brainChecks(item);
    pending.set(id, { item, resolve, timer, reviewing: review });
    if (review) void brainReview(id);
    else askUser(id);
  });
}

function askUser(id: string, note?: string) {
  const p = pending.get(id);
  if (!p) return;
  p.reviewing = false;
  if (note) p.item.brainNote = note;
  emit('approvals');
  log('approval', `${p.item.agentName || 'Dashboard'} is waiting for you: ${p.item.title}${note ? ` (the Brain: ${note})` : ''}`, { agentId: p.item.agentId });
}

async function brainReview(id: string) {
  const p = pending.get(id);
  if (!p || !reviewer) return askUser(id);
  let verdict: BrainVerdict;
  try {
    verdict = await reviewer(p.item);
  } catch (e) {
    return askUser(id, `couldn't check this (${String(e instanceof Error ? e.message : e).slice(0, 160)})`);
  }
  // you may have answered it already, or the run was stopped
  if (!pending.has(id)) return;
  if (!verdict.approve) return askUser(id, verdict.reason || 'not sure about this one');
  log('approval', `The Brain allowed: ${p.item.title}${verdict.reason ? ` (${verdict.reason})` : ''}`, { agentId: p.item.agentId });
  finish(id, { approved: true, message: '' });
}

function finish(id: string, decision: ApprovalDecision): boolean {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(decision);
  if (!p.reviewing) emit('approvals');
  return true;
}

export function decide(id: string, { approved, message = '', edited = null, always = false }: { approved?: unknown; message?: string; edited?: unknown; always?: boolean }): boolean {
  const p = pending.get(id);
  if (!p) return false;
  log('approval', `${approved ? 'Allowed' : 'Denied'}: ${p.item.title}`, { agentId: p.item.agentId });
  return finish(id, { approved: !!approved, message, edited, always });
}

/** What waits for you (requests the Brain is still checking aren't shown yet). */
export function listApprovals(): Approval[] {
  return [...pending.values()]
    .filter((p) => !p.reviewing)
    .map((p) => p.item)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Cancel everything a stopped run was waiting on.
export function cancelForRun(runId: string) {
  for (const [id, p] of pending) if (p.item.data?.runId === runId) finish(id, { approved: false, message: 'The run was stopped.' });
}
