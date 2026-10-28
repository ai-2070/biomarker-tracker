---
name: independent-review
description: "Use when acting as the independent reviewer of a delivered stage or repair candidate — 'review this candidate', 'is stage N acceptable', 'produce a verdict packet' — with authority to hold but not to edit. Covers pinning the exact head in a detached worktree, reproducing the implementer's claims and then attacking with your own public-API probes, the executed-versus-source-established ledger, retaining earned credit while holding, the verdict and packet shape the implementer can act on, and the lines a reviewer does not cross. Not the verifier-in-the-middle role (reviewed-stage-delivery) and not code review of a PR for style."
---

# Independent review

The reviewer's product is a **verdict with receipts**: HOLD or accept,
each finding tied to something that ran, each credit tied to something
that ran, and nothing in between. The reviewer never edits the
candidate, never negotiates the contract, and never reads the
implementer's report as evidence — only as a list of claims to test.

## Pin and provision

- Check out the **exact** candidate hash in a detached worktree of its
  own. Record the hash, the base it was reviewed against, and the date
  in the first lines of the packet. If the branch moves during review,
  note the descendant separately and never attribute your runs to it.
- Use an isolated build target so the implementer's caches cannot
  contaminate results.
- Confirm the exact-head CI run by `headSha`, not by branch name, and
  by run kind (main CI, not a docs or skills workflow). Record its job
  counts. Green CI is one gate; it closes nothing on its own.

## Reproduce, then attack

1. **Run the candidate's own suites** with the retry policy off. Record
   the counts. Note any suite that selects zero tests (a wrong feature
   list makes a whole file vanish silently).
2. **Re-run the implementer's stated inverses** at the production sites
   named. Green under an inverse is a finding; do not take "every
   inverse red" from the report.
3. **Write your own probes** — public-API tests that a consumer could
   write, installed temporarily, run, removed, with source hashes
   verified before and after. Aim them at:
   - the property each row *claims* (not the mechanism it implemented);
   - the composition of two repaired things (each is green alone; the
     seam between them is where the next defect lives);
   - the negative space of the witness (what passes it that should not);
   - the boundary the report says is "out of scope" — decide whether it
     is a scope limit or a contract hole.
4. **Correct your own lanes.** When a source-level prediction is
   contradicted by execution (the late packet you expected to be
   rejected was delivered), say so explicitly and retire the prediction.
   Overstatement costs a reviewer more credibility than a missed
   finding.

Each probe result is one of: executed RED (assertion fired on unchanged
production code), executed control PASS, compile failure (counts for
nothing), zero-selection (counts for nothing). Ledger them by name.

## The ledger

For every finding:

- **Severity** by consequence, not by effort: P1 for production
  correctness/authority/lifecycle, P2 for bounded resource or
  diagnostic defects, separate labels for witness/evidence gaps and CI.
- **Sources** as exact `path:line` at the pinned hash.
- **Executed or source-established** — stated, never blurred.
- **Impact boundary** — what the reproduction does and does not
  demonstrate ("unauthorized teardown of a pending attempt; no Noise
  decryption or authority bypass was shown"). Refuse to let a bounded
  probe be quoted as a broader exploit, including by your own lanes.
- **Closure** as the property the repair must establish and the witness
  that would show it, not as an implementation.

For every credit:

- Name what was verified and how ("the parent removed the handoff; the
  named test failed; restoration passed"). Credit that was not
  re-executed this round is labelled as retained from the earlier round,
  not as a fresh receipt.
- "Original counterexample closed" is narrower than row acceptance;
  say which.

## The verdict

- **HOLD** when any P1 is open or any executed RED remains — and say in
  the first paragraph whether it is a CI-only hold or a production one.
  "This is not a CI-only hold: reproduced defects remain even if the
  browser job goes green" is the sentence that prevents the wrong fix.
- Preserve credit explicitly at the top so the implementer does not
  rework what passed. Name architecture-level things you are *not*
  asking for (no rewrite, no new framework, no scope expansion).
- Distinguish acceptance from authorization: your HOLD does not block a
  separately authorized next stage, and your accept does not authorize
  merge. Say so.
- Owner questions are surfaced as questions with a recommendation. A
  reviewer does not rule; if the implementer's report claims an owner
  ruling you cannot find, flag the attribution.

## The packet

Main report first; it supersedes every lane report on severity, counts
and CI state. Then:

- probe sources and their raw logs (runtime-generated fixture keys; no
  secrets);
- the exact commands, exits, and restoration hashes (`receipts.jsonl`);
- CI JSON for the exact head, and for any descendant you observed,
  labelled;
- lane reports as supporting argument, explicitly not execution
  receipts;
- a final-verification record: pinned HEAD, clean status, diff-check,
  probe removal, preservation diffs for any earlier probes the candidate
  landed.

Exclude raw hosted logs that carry transient connection details; keep
them locally and say so.

## Lines a reviewer does not cross

- No edits, commits, pushes, PR reviews, or version bumps in the
  candidate. Temporary probes are removed and the tree is proven clean.
- No fix proposals that would weaken the fence being reviewed ("do not
  broaden the displacement policy to fix the test").
- No promotion of a source-established schedule into an executed
  finding, and no dismissal of one because it was not executed.
- No re-review of earlier stages' closed findings inside a later
  stage's packet; earlier acceptance is separate.
- No claim about an environment you did not run (Linux from a Windows
  host; a browser that failed to launch is not a third green engine).
- No acceptance on the strength of the implementer's report. If you
  did not run it, you do not know it.
