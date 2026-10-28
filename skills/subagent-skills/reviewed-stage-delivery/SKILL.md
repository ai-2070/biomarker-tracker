---
name: reviewed-stage-delivery
description: Use when driving a staged implementation plan through an implementing agent in an Orca terminal and an independent reviewer who returns HOLD packets — writing per-stage briefs, dispatching and waiting on the agent, reproducing the reviewer's probes before accepting anything, turning a HOLD into a repair brief, deciding when the next stage is authorized, and keeping the plan document as the record of what each stage actually established. Covers the roles, the evidence bar, the CI-failure triage loop, and the mistakes that cost whole rounds.
---

# Reviewed stage delivery

Three parties, one branch. The **implementer** (an agent in an Orca
terminal) writes code from briefs. The **reviewer** (independent; here,
"Kyra") returns evidence packets with a verdict — HOLD or accept — and
never edits. **You** are the verifier and record-keeper in between: you
write the briefs, reproduce every claim before it is forwarded, and keep
the plan document honest. The **owner** authorizes stages and decides
policy; the owner's word is absolute and is never inferred.

The loop per stage:

```
brief → dispatch → wait → verify → forward to reviewer
                                    ↓ HOLD packet
                          reproduce → repair brief → dispatch → …
```

Stages stack additively on the branch so a re-review fix for stage *n*
cannot conflict with stage *n+1* already underway. Authorization of
stage *n+1* is the owner's call and does not imply acceptance of *n*.

## Files and where things live

- `docs/internal/plans/<PLAN>.md` — the plan. You own it; the agent
  never touches it. Every stage gets a dated record: what was delivered
  (hash), what you verified, the reviewer's findings, what is still
  open. Write the record *as findings arrive*, not at the end.

  **The not-established list lives here too, not only in a review
  message.** Separate what was *executed* from what is only
  *source-established*, and name plainly what never ran — unproven
  rails, unqualified deployment paths, platform-gated code no local
  command compiles. At acceptance this is the single most
  misread-later part of the record: a green ledger invites the reading
  that everything adjacent is proven. Messages scroll away; the plan
  is what someone opens in six months. Write the limits where they
  will be found, and name any witness likely to be over-quoted
  ("the shipped-wheel witness is *not* a protected-lifecycle
  witness").

  **Commit it at every stage boundary, and once more at completion.**
  Not at the end of the slice — at the end of each stage, each repair
  round, and each verdict, as its own docs-only commit. Two reasons,
  both learned the hard way. A plan whose checkboxes still read unticked
  after the work landed misrepresents the state to everyone who opens it,
  including you next week; and batching the update to the end means
  writing it from memory, which is where "I verified that" quietly
  replaces "the tool reported that". Re-derive each claim from the tree
  before ticking it — the boxes, the witness counts, the named surfaces.

  The final commit is a distinct one, after acceptance: it records the
  verdict, the accepted hash, the closed ledger, the not-established
  list, and the next bounded slice. Keep it docs-only so it cannot
  perturb the accepted candidate — and say so in the message, because a
  reviewer checking the delta after the runtime candidate needs to see
  at a glance that nothing executable moved.
- `spikes/S<n>_BRIEF.md`, `S<n>_R_BRIEF.md`, `S<n>_R2_BRIEF.md` … — one
  brief per dispatch. Committed and pushed before the agent is sent to
  it; the message to the agent names the hash.
- `spikes/kyra/` — the reviewer's probe files, vendored verbatim so the
  agent can land them as tests without transcription.
- `docs/internal/spikes/S<n>_REPORT.md` — the agent's report; it appends
  a numbered section per round. You append a "reviewer verification"
  subsection when you have run things yourself.
- The reviewer's packets arrive as a folder; the main report governs,
  the lane reports are supporting argument, not execution receipts.

## Writing a brief

A brief is the whole of the agent's context. It starts blank.

- Cite the plan sections and prior spike reports the slice depends on,
  by name, and tell the agent to read them first.
- State the authorization and its limits in one paragraph: what stage,
  stacked on which head, *additive to what*, what it may not touch
  (earlier stages' seams), what is explicitly not this stage.
- Number the slices. Each: the target files/symbols, the change, the
  witness that proves it, the inverse that must go red. For a repair
  brief, each reviewer finding becomes a numbered row carrying her
  citations, the executed evidence, and a closure the agent can act on
  — but state the closure as the *property*, not the implementation,
  unless consistency matters.
- Owner-pending decisions are listed as "state in the report, do not
  decide". Never let a brief imply a ruling the owner has not given.
- End with the validation list: the exact suites, the probe counts, the
  pre-push checklist, "report only on green exact-head CI", and "no
  stage *n+1*".
- Commit prefix and report-section conventions, so the log is legible.

## Operating the implementer's Orca terminal

The implementer is an agent session inside an Orca-managed terminal; you
drive it with the `orca` CLI (see the harness's `orca-cli` skill for the
command surface). What matters for this loop:

**Finding it.**
`orca terminal list --json | jq -r '(.result.terminals // .result)[] | "\(.handle) | \(.title)"'`.
The title is the session's current task line, not a stable name, and it
changes to the underlying shell's name (`cmd.exe`, `OMP ready`) when the
TUI is between tasks — the agent is still there. The handle rotates when
the session restarts; a `terminal_handle_stale` error means re-list and
re-pick. Confirm by reading the screen: the model tag (`◑ Opus 5`), the
worktree, the branch.

**Reading it.**
`orca terminal read --terminal <h> --screen --json | jq -r '.. | strings'`
then filter out the numeric/uuid noise lines. `--lines` is not a flag;
`--limit` is. The screen shows the TODO tree (`☐`/`☑`), running
subagents, the current step (`⎋ …`), and the last command output —
enough to tell "working", "waiting on its own CI loop", "idle at a
question", and "finished" apart. Read it before assuming any of them.

**Sending.**
`orca terminal wait --terminal <h> --for tui-idle --timeout-ms 30000`
then `orca terminal send --terminal <h> --text "…" --enter --wait-submit 15 --json`
and check `.result.send.accepted`. The message names the brief's hash,
the order of work, the constraints in one line each, and ends with
"report only on green exact-head CI; no stage n+1; I will not edit
files while you work". Re-read the screen a minute later: a send can
be accepted and ignored by an agent sitting in a `sleep`-and-poll
loop of its own. If the step line has not changed, send again with
"stop waiting on CI — act on it".

**Waiting.**
`tui-idle` fires on every subagent hand-off, every question, and every
`sleep` the agent itself runs — not only on completion. The completion
condition is a conjunction: new commits **pushed** *and* the tree
**clean** *and* idle **held across a settle interval** (four to five
minutes). Poll it in a background job (`async`, `timeout: 0`); one idle
is never done. A long `wait` that returns with nothing pushed is a
hand-off, not a finish — re-arm.

**Steering mid-task.** A short message with the cause and a line number
is honoured; a long brief mid-task is not read. For a CI red discovered
while the agent works, send the cause, say "fix that first, then
continue", and let the waiting loop pick up the result.

**The card.** `orca worktree set --worktree active --comment "…"
--workspace-status in-review|in-progress` after every state change:
what is delivered, what is with the reviewer, what is dispatched, what
the owner owes. It is the one-line status the owner reads.

**When the agent stops at a decision.** It may idle at an owner question
it should not make alone, or — worse — make it and write it up as the
owner's. The screen and the commit messages tell you which; the
correction is the next round's first commit.

## Verifying before forwarding

The agent's report is a claim. Forward nothing you have not reproduced.

1. **Reproduce the reviewer's probes** at the current head, verbatim
   (temporary file, run, delete, hash-check the tree). Her fail/pass
   count must match yours exactly before you write the repair brief,
   and must be all-green before you forward the repair.
2. **Run the suites the change touches** at `--retries 0` with
   `--no-tests=fail`, several times if anything is timing-sensitive.
   A pass at retries=2 is not a pass.
3. **Re-run the inverses** the agent lists — at the production site,
   not the helper; mutate, run the named witness, restore, hash-check.
   A witness that stays green under its own inverse is a finding
   (delete-and-replace, never re-pin).
4. **Account for every count change.** Lib tests went 5779 → 5726? Name
   the 53 by module and where they went. Floors intact?
5. **Read the diff for scope.** "Strictly additive" stages that touch a
   core seam get called out in the record with the justification.
   Consumer-tree diffs (bindings, headers, other-language SDKs) are
   listed file by file; the export baseline is checked on CI's build
   command, not a convenient one.
6. **Read the record for provenance.** A commit or report that
   attributes a decision to the owner is checked against what the owner
   actually said. If no ruling was given, the code may stand on its
   merits but the attribution is corrected in the next round's first
   commit.

Then record in the plan and forward. Your record names what *you* ran,
separately from what the agent claims.

### The inverse catches your own evidence first

The rule reads like a check on the implementer. In practice most of what
it catches is *yours* — witnesses you wrote, believed, and would have
forwarded as proof. Three real shapes, all self-inflicted, all caught
only by running the inverse:

- **A name that claims more than the assertions establish.** A test
  called `..._is_re_acquired...` asserting `expires_at >= expires_first`
  — `>=` permits equality, and nothing in it observed the *provider*
  renewing anything. Rename it to what it proves and cite the real
  property elsewhere; do not quietly keep the name.
- **A witness whose precondition its own repair destroyed.** A
  generation-restart test pruned one row and reopened — but an earlier
  repair *retained* rows, so the counter could be rebuilt from disk and
  the test passed while persisting nothing. It could not have detected
  the rewind it was named for.
- **A test that passes under the broken implementation.** A
  generation-scoped resolution test with no historical row, where the
  operation was illegal against the live row anyway — so routing the
  call to the *wrong* resolver also raised, also changed nothing, also
  passed. Non-discriminating by construction.

So: run the inverse on witnesses **you** are about to cite, not only on
the ones handed to you. A witness that stays green under its own inverse
has proven nothing, whoever wrote it. When the reviewer supplies the
mutation, reproduce it yourself rather than crediting her receipt —
that is how you learn your own test was the weak one.

## Turning a HOLD into a repair brief

- Reproduce first (above). Then read the whole packet; the main report
  supersedes lane reports where they disagree.
- Preserve credit explicitly: list what the reviewer credited so the
  agent does not rework it.
- First commit of every repair round is the reviewer's probes landed
  verbatim as pinned tests (assertions untouched; API adaptation only
  if unavoidable and explained). They are the acceptance witnesses and
  go red-to-green row by row.
- Group findings that share a root cause into one design item and say
  so — four failing probes about one boundary are one repair, not four.
- Distinguish executed findings from source-established ones in the
  brief; both get closed, but the executed ones have a probe to satisfy.
- Carry the reviewer's evidence rules verbatim into the brief when the
  agent has violated them before: raw inverse receipts (diff, command,
  exit, restored output), no wait widening, no retries, no floor
  lowering, rosters generated from source with a pre-run self-check.

## CI-failure triage

CI at the new head is the arbiter; the workstation cannot run every arm.
When it is red, read each failed job's log yourself and hand the agent
the cause, not the job name — the procedure and the dozen recurring
shapes (one lint → 20 reds, unguarded feature gates, `--all-targets`,
ABI mirrors, separate workspaces, guards that cannot see what they
guard, browser-job hangs, precondition-not-window) are in
[references/ci-triage.md](references/ci-triage.md). Two rules that do
not wait for the reference: count root causes, not red jobs; and
cancelled ≠ failed — read the steps.

## Deciding the next stage

The owner authorizes; you advise. Before recommending:

- The current stage's candidate is verified and forwarded (not
  accepted — that can lag by rounds).
- The next stage's brief cites what the current stage *established*
  and what it carried forward as named gaps; those gaps are slices or
  owner questions in the new brief, never silently dropped.
- Prerequisites are checked, not assumed (a workflow that has "never
  run" gets a run before a stage that extends it).
- Open owner questions are listed in the recommendation so the owner
  can decide them alongside the authorization.

## Things that cost whole rounds

- Forwarding an agent's "every inverse red" without re-running one.
- Accepting a "named gap" that is actually a contract hole (a promotion
  that fires on rejection; a budget with no production caller).
- Letting a mock quietly do the job of the thing it mocks.
- A witness that proves a set where the claim is an order; a witness
  that passes with its guard removed; a fixture substitution where the
  production attempt was supposed to complete.
- Recording CI as green while the run was still queued.
- Letting the agent decide an owner question and write it up as the
  owner's.
- Treating one `tui-idle` as completion.
- Citing a witness **you** wrote without running its inverse, because
  the rule felt like something you apply to the implementer.
- Crediting a reviewer's mutation receipt instead of reproducing it —
  the reproduction is where you find out the weak witness was yours.
- Leaving the not-established list in a review message instead of the
  plan, where a later reader will take the green ledger for the whole
  truth.
- Letting the plan go stale between stages, then reconstructing it from
  memory at the end — every unticked box is a false statement about the
  tree, and a remembered claim is not a verified one.
