---
name: delegating-to-subagents
description: Use when assigning work to parallel subagents — decomposing a task into lanes, writing briefs they can act on, arbitrating shared files and contended resources, and judging what they hand back. Covers ownership rules, evidence standards, and the failure modes that only appear once several agents edit one tree.
---

# Delegating to subagents

Parallel subagents are cheap to spawn and expensive to supervise badly. The
work is in three places: **decomposition** before you spawn, **arbitration**
while they run, and **judgement** on what comes back. Writing the brief is the
smallest part.

## Own the decomposition

Map the whole request yourself first. Independent slices, and the contracts
between them, are yours to decide — a subagent starts blank, knows less than
you, and cannot see its siblings.

- **Fan out only on genuine independence.** Slices that share a design are one
  slice. Four probes against one broken model is one lane, not four; splitting
  them produces four incompatible half-fixes.
- **Foundation first, dependents after.** If three lanes need a surface that
  does not exist, build it alone, freeze it, broadcast it, then fan out. A
  "surface is frozen, wire against this" message is worth more than any
  amount of speculative parallelism.
- **Name the contracts up front** in the shared context: the interface A
  implements and B consumes, the term definitions, the counting rules. Two
  agents quietly disagreeing about what a word means is the most expensive
  bug in this mode.
- **Never outsource the top-level plan.** Slice-local design is theirs;
  deciding what the slices *are* is yours.

## Write briefs that can be acted on

A brief is not a summary. It is everything the agent cannot discover in the
time you have given it.

- **Target, change, acceptance.** Exact files and symbols, the step-by-step
  change with its reasoning, and an observable acceptance criterion. No
  project-wide test suites in an individual brief — those run once, at the
  end, by you.
- **State the non-goals.** "Do not touch X" prevents more damage than any
  instruction to do something.
- **Give the reproduction, not the symptom.** The exact command, its expected
  output, and the baseline that must not regress. An agent that cannot
  reproduce will optimise the thing it *can* measure.
- **Pre-empt the tempting wrong fix.** If the cheap move is to weaken an
  assertion, widen a timeout, or add a retry, forbid it by name and say why.
  Agents reach for those precisely when the real cause is hard.
- **Demand diagnosis over repair.** "Establish which of these it is, with
  evidence, before changing anything" produces better work than "fix it", and
  the evidence is what you will need when a reviewer asks.

## Arbitrate while they run

This is the part that is easy to skip and expensive to skip.

- **Declare file ownership explicitly**, and re-declare it the moment two
  agents want the same file. Give one of them the casting vote rather than
  letting both rewrite it.
- **Serialize contended resources** — a browser harness, a GPU, a port range.
  Require "taking it / released" announcements. Concurrent runs produce
  failures in unrelated places that nobody can reproduce, and the hours go
  into chasing ghosts.
- **Answer questions fast and decisively.** A blocked agent is burning its
  budget waiting. If two designs are defensible, pick one, say why, and move.
- **Re-ground by construct, not by line number.** Concurrent edits renumber
  files legitimately. An agent that re-reads a remembered line and sees
  different code will conclude its work was clobbered when it merely moved.
- **Take the shared-infrastructure edits yourself** (CI config, workflow
  files, rosters). Have agents send you exact names and numbers; verify them
  against source before applying. A pinned name that does not exist fails
  exactly like a regression.

## Judge the results

`completed` means the agent yielded, not that the work is right.

- **Verify the claim, not the summary.** Re-run the acceptance command on the
  final tree yourself. Lanes report against the tree they saw, which is not
  the tree that ships.
- **Demand raw receipts.** For a fix: the bounded diff that undoes it, the
  exact command, the exit code, and the verbatim failure it produced. A
  description of a mutation is not evidence that the test detects it.
- **Value the findings above the deliverable.** The best returns in practice
  are the ones that say "this was not the defect you described, it was
  this" — a flag stamped by one side and read by nobody, a counter with no
  bump sites, an API that cannot express the thing the stage is about. Make
  it clear that reporting a blocker beats working around it.
- **Insist on "never executed here."** An agent that cannot run something must
  say which legs are unproven, not infer a pass. An honest CI-only note is
  worth more than a green summary.
- **Accept a reasoned deviation.** When an agent derives a different answer
  from yours and shows the derivation, take it and record the reasoning —
  including when it corrects you.

## Failure modes worth knowing

- **Whole-file writes, `cp` restores and `git checkout -- <file>`** silently
  revert siblings' landed hunks — and the VCS restore also discards the
  agent's *own* uncommitted work in that file, which is how one lane lost
  ~450 lines in a keystroke. Ban all three while others are in the tree;
  undo your own change with a targeted, anchored edit instead.
- **A full disk truncates files mid-write** and the VCS still reports an
  ordinary modification. After any out-of-space event, compare line counts
  against the committed file and then grep for your own symbols; a plausible
  file is not an intact one.
- **Staging a whole shared file** sweeps in a sibling's in-flight work. Stage
  by explicit path set, and if you sweep something up anyway, disclose it in
  the commit message rather than letting the diff be quietly larger than its
  description.
- **An oracle can outlive the mechanism it measured.** When a lane removes a
  behaviour, check whether another lane's test still asserts it.
- **Attribution discipline.** Never record a decision as the owner's — or
  anyone's — unless they made it. It launders a judgement call into an
  instruction and removes the scrutiny it needed.
- **A reconstruction must be re-proven, not inspected.** An agent that
  rebuilds lost work from its own edit record has produced a plausible
  file, not a verified one. Require the suite and the acceptance run again
  before it counts.
- **A receipt against code that no longer exists proves nothing.** When the
  implementation moves after a receipt was captured, the receipt is stale;
  re-capture it against what ships. It is very easy to keep the old one.
- **"Released" is a message, not an inference.** A shared harness between
  runs looks exactly like one that has exited: an idle process and a
  cleared lock are not a handover. Wait for the word — and if you do take
  over, announce it with an explicit offer to drop back out, because a
  `pkill` on a shared binary name kills a sibling's in-flight run.
- **A force-stopped agent is usually resumable with its context intact.**
  When one exhausts a budget mid-task, message it a *priority order* for
  the remaining requests — finish and prove the blocking artefact, release
  the shared resource, skip anything already evidenced — rather than
  respawning and redoing the work.
