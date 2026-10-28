---
name: commissioning-a-reviewer
description: "Use when you are the one ASKING for an independent review — spawning a reviewer subagent against a candidate head, writing the review brief, deciding what to expose and what to claim, budgeting the round, and consuming the packet that comes back. Covers the brief's required parts, publishing claims so they can be falsified, the lines you impose, running review concurrently with your own next slice, and the ways a commissioned round is wasted. Not how to BE the reviewer (independent-review) and not how to run the whole implementer/reviewer loop (reviewed-stage-delivery)."
---

# Commissioning a reviewer

A commissioned review costs a real round: the reviewer builds a
worktree, reproduces your suites, writes probes, and runs the harness.
You get one packet for it. Everything that makes that packet worth the
round happens **before** you spawn — in what you claim, what you point
it at, and what you forbid.

The reviewer's job is to falsify you. Your job is to make falsification
cheap for it.

## Commission at a candidate, not at a mood

- **A candidate is a committed hash.** The reviewer pins by hash in its
  own detached worktree; an uncommitted tree cannot be reviewed and a
  branch name is not a head. Commit first, then spawn, then name the
  hash in the brief.
- **Commission at a boundary**: a stage delivered, a repair candidate
  answering a previous HOLD, or a surface whose defects would be
  expensive to find later (wire formats, authority, lifecycle).
- **Do not commission for style, naming, or "another pair of eyes."**
  That burns the instrument. A reviewer whose last three rounds found
  nothing is one you will stop reading.
- **One reviewer per head.** Two reviewers on one candidate mostly
  duplicate each other's reproduction cost and disagree on severity.

## Publish your claims so they can be killed

The single highest-value part of the brief is the list of things you
assert, each with the exact command that produced it.

- **Claim counts and exit codes, not adjectives.** "675 passed **and
  exit 0**" is falsifiable; "the suite is green" is not. A summary line
  and an exit code are different claims — say both, because they have
  disagreed before.
- **Claim the inverses by name.** For each repair: the production line
  that was mutated, the witness that went red, and the restoration.
  Invite the reviewer to re-run them. A non-discriminating inverse
  found by the reviewer is worth more than one you never tested.
- **Claim the boundary of each claim.** "Recorded on Chromium; never
  executed on Firefox" and "source-established, not executed" belong in
  the brief. The reviewer will find the gap anyway, and finding it
  yourself is credibility you spend later.
- **Hand over the known-weak spot.** If you shipped something you are
  unsure about, point at it in the brief. Hiding it costs a whole round
  when the reviewer discovers it and holds on evidence integrity.

## The brief

Publish it as a document and reference it by URI; do not inline a wall
of text into the spawn.

Required parts:

1. **Head and worktree.** The hash, the branch, the path, and what
   changed since the last packet — commit by commit, one line each.
2. **Surfaces to attack, ranked.** Files and symbols, newest and most
   dangerous first. You know where the new production behaviour is; the
   reviewer would spend half its round finding out.
3. **The claims** (above), each with its command.
4. **Reproduction recipe.** Exact commands, expected counts, and any
   provisioning the probes need — package junctions, build steps,
   fixture dirs — because a reviewer that cannot build runs nothing.
5. **Cost.** "The harness is ~4 minutes a run" tells it how many runs it
   can afford and stops it from discovering the budget by exhausting it.
6. **The lines.** Hold but do not edit; remove probes and prove the tree
   clean; separate EXECUTED from SOURCE-ESTABLISHED; report any inverse
   that does not discriminate; no project-wide suites, formatters or
   linters — those are yours, once, at the end.
7. **The packet shape you will act on.** Numbered, severity-ranked
   findings; raw probe output; what was reproduced and what was not.

## What not to send

- **Never send your report as truth.** Send it as a list of claims to
  test. A reviewer that reads your narrative as evidence produces a
  summary of your narrative.
- **Never send the conversation.** The reviewer starts blank on purpose;
  the blankness is the instrument. Everything it needs is in the brief.
- **Never send a fix you want ratified.** Asking "is this repair okay"
  gets you agreement. Asking "here is the property, attack it" gets you
  a defect.

## Run it concurrently, carefully

- The reviewer pins a hash, so your tree can move under it. **Keep
  working** — the round is minutes of yours and tens of minutes of its.
- **Label anything you land during the round** as a descendant. When the
  packet arrives, findings are against the pinned head; check each one
  against your current head before deciding it is stale.
- **Do not rewrite the pinned head** (no rebase, no amend) while a
  review is in flight. The packet becomes unattributable.
- Answer its questions fast if it asks. A blocked reviewer spends its
  budget waiting, then reports less.

## Consume the packet like a reviewer would

- **Reproduce before you repair.** Run its probe yourself against your
  head. A finding you cannot reproduce is not yet a finding — and
  repairing it anyway teaches you nothing about what was wrong.
- **Separate the hold classes.** An evidence-integrity hold ("your
  receipt does not show what you said") and a production hold ("the
  behaviour is wrong") demand different work. If the packet does not
  say which, ask before repairing.
- **Keep the credit.** A packet that retains earned credit is telling
  you what not to rework. Do not re-litigate accepted rows.
- **Treat a correction of the reviewer as a finding of your own**, with
  the same receipts you would demand: if its source-level prediction is
  contradicted by execution, show the run.
- **Do not negotiate severity.** Repair or record the disagreement with
  evidence. Arguing a P1 down is the fastest way to lose the instrument.
- **A packet is not merge authorization.** Acceptance closes a
  candidate; merging is a separate decision with a separate owner.

## Ways a commissioned round is wasted

- **No claims in the brief.** The reviewer spends the round rediscovering
  what you already know and never reaches the seam you were worried
  about.
- **No provisioning recipe.** Probes fail to build; the packet is full
  of compile failures, which count for nothing.
- **Project-wide suites not forbidden.** The reviewer spends its budget
  running a build matrix you run anyway, and writes two probes instead
  of ten.
- **Reviewing an uncommitted or moving head.** Every finding lands
  against a tree that no longer exists.
- **Commissioning too often.** Review is a gate, not a pairing session.
  Land the slice, then gate it.
- **Accepting the packet's summary.** `completed` means it yielded.
  Findings are claims until you run them, exactly as your claims were
  claims until it ran them.
