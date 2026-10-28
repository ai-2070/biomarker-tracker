---
name: witness-discipline
description: "Use when writing, reviewing, or repairing tests that are meant to prove a property — 'add a witness for X', 'does this test actually prove it', 'the inverse is green', 'the reviewer says the oracle is non-discriminating', or when a CI floor, roster, or timing window is being changed. Covers what makes a test a witness rather than plumbing, the inverse rule (applied, red, restored, hash-checked), oracles that cannot distinguish the outcomes, positive controls, the executed-versus-source-established boundary, and the four ways a test gets weakened to make it pass. Independent of language or repository."
---

# Witness discipline

A **witness** is a test that would fail if the property it names were
false. Most tests are not witnesses: they exercise code, pass, and would
keep passing under the bug they are supposed to catch. The difference is
not effort; it is whether anyone ever ran the inverse.

## The inverse rule

Every witness has an inverse: the smallest change to the **production
code** that makes the property false. A witness is credited only after
its inverse has been run:

1. Apply the mutation at the production site — not in a helper, not in
   the test's fixture, not in a copy.
2. Run the named witness. It must be **red for the right reason** (read
   the assertion message; a compile error or a panic elsewhere is not a
   red).
3. Restore the source and verify it is byte-identical (hash before and
   after). A restored tree that differs is a finding about the process.
4. Record all four: the diff, the command, the exit, the restored run.
   "Every inverse red" without receipts is a claim, not evidence.

The inverse a witness's doc comment names is the one you **ran**. Written
before running, it is a guess: a doc once said removing a check would
flip the refusal code, when a fallback path kept the code right and only
the message assertion went red.

A failure that needs a particular random input (an id with no hex letters,
one in 1,800) gets a witness with **that input pinned**. The random run
that found it is not a witness; it passes 1,799 times in 1,800.

A witness that stays **green under its own inverse** is not weakened or
re-pinned — it is deleted and replaced with one that discriminates. If
the property genuinely has no inverse the test can see, the test is
plumbing; say so and keep it out of the roster.

## Oracles that cannot distinguish the outcomes

The assertion must separate "the property holds" from every plausible
way it could fail. Shapes that do not:

- **Set where the claim is order.** Values 0..N all arrived proves
  delivery, not sequence; permuting them at the send seam still passes.
  Assert the sequence, or rename the claim.
- **Dedup where the claim is exactly-once.** A `HashSet` of observed
  payloads cannot see duplicates. Count with multiplicity.
- **Counter unchanged as "delivered".** A transit counter that did not
  move can mean "delivered locally" or "silently dropped". Observe the
  decoded local outcome, nonce-correlated.
- **Any exception as "refused".** A negative test that passes on *any*
  error passes on the wrong error — an HTTP failure before the
  cryptographic step "proves" a MITM defence. Assert the stage at which
  failure occurred (offer accepted → channel open → handshake died at
  the pinned key) and treat anything earlier as a test error.
- **`a || b` when both are claimed.** Assert each sibling's own exact
  payload.
- **A helper called instead of the effect observed.** `admission_allows`
  returning false is not the same as the message not being delivered.
  Mutate the production call site, not the helper, and watch the effect.
- **Post-hoc zero.** "Zero handler calls" after a send whose result was
  ignored cannot distinguish "denied" from "never sent". Correlate on
  the call id and observe the denial at the completed boundary.
- **`sent == true` from the sender.** `dc.send` completing is not
  receipt. Attribute at the receiver.
- **An unchanged counter, unaccompanied.** "This counter stayed flat" is
  satisfied by the subsystem being dead. Assert *flat while live*: in the
  same window, a third party's traffic through the same component must
  move, and the payloads whose absence you are claiming must actually be
  arriving somewhere. A flat counter with nothing happening must not pass.
- **Counting where the claim is identity.** Five payloads arrived and five
  were expected — and two of them were another peer's, delivered to the
  wrong consumer. Comparing the receiver's nonces *exactly* is what makes
  that visible; counting them hides it. Prefer exact correlation to
  cardinality wherever the values are distinguishable.
- **A delta where the claim is a starting state.** `t1 > t0` passes on a
  contaminated baseline. If the property is "nothing had happened yet",
  assert `baseline == 0` — and when that turns out to race, remove the
  window (capture inside the handler that establishes the precondition)
  rather than widening the poll that exposed it.

## Positive controls

Every refusal witness is paired with the same path succeeding when it
should: the registered provider that *is* invoked by an admitted peer;
the correct-key handshake that *does* install; the delayed packet that
*does* still deliver. Without the control, a refusal witness passes when
the whole path is broken.

The control is also what tells a *failing* run apart from a broken
harness, so print its numbers on failure too.

## Verdict text states numbers; PASS/FAIL states the claim

A detail line that argues its own conclusion — "…so the counter being flat
is not a quiet mesh" — is printed on failing rows as well, where it is
false. A verdict string that asserts the interpretation is a small lie
waiting to be quoted out of a log. Details carry the measurements; the
verdict carries the claim.

## Preconditions, not windows

A witness that flakes under load is asserting from a state it has not
reached. The fix is the precondition — wait for the observable the
assertion is about ("delivered ≥ N" before "released"; "four offers
arrived" before "reservations drained") — never a wider timeout. A wider
window can let a *different* mechanism satisfy the witness (the failure
detector evicts the peer the eviction path was supposed to) and the
witness then passes with its subject removed. A precondition like
`count == 0` that is true both before and after is vacuous; assert the
state was entered, not merely observed.

Run witnesses at `--retries 0` with `--no-tests=fail`; a pass on the
second try is a fail with a note. A filter matching zero tests exits 0
by default — that has produced green no-op CI jobs.

## The instrument is part of the system under test

An instrument that reports success without affecting the system produces
confident green, which is worse than no instrument. Three real shapes,
all found the same way — by a row failing for the right reason:

- **The call returned and did nothing.** A loss injector that reported a
  drop on every call while the transport was untouched.
- **The call acted at the wrong layer.** `BrowserContext.setOffline`
  emulates on the URL loader; the page observed *zero* `offline` events.
  The driver believed it; the renderer never heard.
- **The call acted and then undid itself.** Detaching a CDP session in a
  `finally` reverts the emulation, so `offline` and `online` fired
  microseconds apart. The page saw a complete, plausible event pair and
  read back "online". **A reverted emulation is indistinguishable from a
  working one unless you read the system's own state back.**

A fourth shape: **the instrument fired for someone else.** A test-only
fault seam held in process-global state (a one-shot static flag) is
consumed by whichever caller reaches it first, and a parallel test's call
takes the fault armed for yours; your forced call then succeeds. Key the
seam to a resource the test alone owns (its own file path), and hold the
armings in a collection, because a single slot lets two tests arming at
once overwrite each other. Stress it under the runner that runs tests
concurrently in one process; a process-per-test runner never shows it.

The rule: assert the effect on an observable the *system under test*
owns, not on the fact that the instrument's call succeeded. Read
`navigator.onLine` out of the page; read the counter out of the peer;
read the ingress out of the component you claim you bypassed. And when a
step must be ordered against the system's readiness, make it a handshake
on a published flag rather than a sleep — nobody is tempted to tune a
handshake.

## Executed versus source-established

Keep the two labels apart everywhere they appear:

- **Executed**: a probe ran against unchanged production code and its
  assertion fired. Cite the test name, the command, the exit.
- **Source-established**: the schedule is visible in the code (an
  await between a check and a use; a lock reacquired inside its own
  guard) but was not driven. It is still a finding; it is not an
  execution receipt, and a repair for it needs a witness that *does*
  execute the schedule.

Never upgrade the second to the first in a summary. Never dismiss the
second because the first is absent.

## Rosters and floors

A test that is not pinned by exact name can disappear without a signal.
Rosters are generated from the source (`grep -oE '^async fn [a-z_]+'`),
never written from intent — 18 of 24 pinned names once did not exist
and the guard was green until the first real red exposed it. A pre-run
self-check fails on any pinned name absent from the file. Floors track
the real count and rise with it; lowering a floor is a deliberate,
named act in the same commit that removes the witness. A guard's own
parser is tested against a known line — a guard that counts an empty
line as a test is green forever.

## The four weakenings

When a witness goes red and the change under review makes it green, one
of these happened; name which:

1. **The precondition was fixed** — legitimate; the state is now reached.
2. **The window was widened** — suspect; see above.
3. **The assertion was relaxed** (`==` → `>=`, exact → `contains`, a
   value → "non-empty") — the witness no longer proves the claim; either
   the claim changes in the docs too, or this is a regression hidden.
4. **The witness was deleted** — legitimate only with the replacement in
   the same commit and the floor adjusted deliberately.

A reviewer reads the test diff for exactly these. So should you.
