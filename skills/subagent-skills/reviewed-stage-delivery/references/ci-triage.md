# CI-failure triage

CI at the new head is the arbiter; the workstation cannot run every arm.
When it is red, read each failed job's log yourself and hand the agent
the **cause**, not the job name. When the fix is a one-liner you can
see, send it with the line number; when it needs diagnosis, name the two
or three candidate causes and ask for the evidence that discriminates
them.

## Reading a red run

```bash
gh run view <run> --json jobs --jq '.jobs[] | select(.conclusion=="failure") | "\(.databaseId) \(.name)"'
gh api "repos/<owner>/<repo>/actions/jobs/<job>" --jq '.steps[] | select(.conclusion=="failure") | .name'
gh api "repos/<owner>/<repo>/actions/jobs/<job>/logs" | sed 's/\x1b\[[0-9;]*m//g' | cut -d' ' -f2- \
  | grep -E "^error(\[|:)|panicked at|FAIL \[|::error::" | sort -u | head
```

- `gh run view --log-failed` often returns nothing useful; the jobs API
  log with the timestamp column cut is what works.
- The `::error::` lines are the job's own guards; the `panicked at` /
  `error[E…]` lines are the code. Read both — a guard can be red while
  every test passed.
- Count root causes, not red jobs (see the first pattern below).
- **Cancelled ≠ failed.** A fail-fast cancellation or a job-level
  timeout shows as `cancelled` at job level; read the *steps* to find
  the one that ran out. Nothing failing plus one cancelled job means a
  hang, and the orphan-process list at cleanup names the culprit.
- Compare against the previous green run for the same job when a
  witness flips: the diff between the two logs is usually the answer
  (which engine, which interface, which candidate type).

## Patterns that recur

- **One lint/compile error in the core turns 20+ jobs red.** Every
  crate that compiles the core fails. Find the one `error:` line before
  counting failures. `doc list item without indentation` at
  `-D warnings` has done this.
- **Feature-gated references left unguarded** (`super::traversal::…`
  under `nat-traversal`) → the narrow feature configurations and every
  lean FFI member fail. The local checklist must run the narrow matrix
  from `ci.yml`, not just default + the feature under development.
- **A struct gained fields** → every `#[cfg(test)]`, `tests/` and
  `benches/` literal breaks, and `cargo check --lib` never builds them.
  `cargo check --workspace --all-targets` is the bar. This recurred in
  three consecutive rounds of one stage.
- **A new C constant or error code** → the header mirror (`go/net.h`),
  the Go converter arm and typed sentinel, the Python package
  `__init__` export, the TS error class — all in one commit, or the
  parity tests fail one at a time across rounds.
- **A separate workspace** (`leaf/`) is not reached by the root
  `cargo fmt` / `clippy`; format and lint it explicitly.
- **A lockfile in a standalone probe crate** goes stale when the
  workspace bumps a shared dependency; `--locked` then fails *before*
  the compile-negative assertion the probe exists for.
- **Inventory guards that cannot see what they guard**: a grep for a
  substring no test name contains; a pinned roster written from intent
  rather than from the file (18 of 24 names nonexistent); a job step
  opening a path relative to the wrong `working-directory`; a self-check
  that counts an empty line as a test; a floor that stayed at the old
  count while the roster grew. Fix the guard *and* add a pre-run
  self-check that fails on any pinned name absent from the source.
- **Browser jobs**: toolchain-pinned directories need `rustup target add
  wasm32-unknown-unknown` *inside* them (the toolchain action installs
  into its own toolchain); Chrome and chromedriver pinned to one build
  and the version strings asserted equal; a second engine must not
  re-init the first engine's NSS database (`certutil -N` on an existing
  DB prompts for a password on inherited stdin and hangs until the job
  timeout — null stdin on every certutil child); per-engine step
  timeouts so one engine's hang cannot consume the other's evidence; a
  verdict that returns `ok` on *any* exception is a false green (an
  HTTP failure before the cryptographic step "passes" a MITM test).
- **Timing-sensitive witnesses under runner load**: the fix is the
  precondition — wait for the state the assertion is about ("delivered
  ≥ N" before "released") — never a wider window. Widening can let a
  *different* mechanism (the failure detector) satisfy the witness and
  quietly destroy it. A witness with a vacuous precondition (`== 0`
  true both before and after) passes locally and fails on a slower
  runner.
- **A non-deterministic browser leg on the runner** (one engine fails a
  pair formation the other passes in the same run): the fix belongs on
  the mechanism, not the verdict; read the engine's own `getStats` from
  the log before deciding which side raced.
- **A test with `--retries 2` in `nextest.toml`** hides all of the
  above. Focused runs use `--retries 0 --no-tests=fail`.
