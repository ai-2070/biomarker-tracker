# Brain streaming, no step limit, process trees, eve and desktop updates — plan, 2026-11-04

Branch: `LZL0/brain-streaming-eve-updates`. One commit per phase, pushed as it lands; one PR at the end.

## Why

The 2026-11-04 project review found:

- **Assistant wiring.** `server/assistant.ts` `ask()` is one ~190-line function with four modes (personal, research-only, claim review, claim session). Answers arrive all at once after up to 3 min (API models) or 10 min (agent programs); agent programs' line-by-line output is buffered to the end. A hard 10-step limit (`MAX_STEPS`) cuts long research turns short.
- **Prompt cache.** Nothing keeps the provider's prompt cache warm. Anthropic caching isn't requested at all (it needs `cache_control` breakpoints). The tool set changes between turns (`save_profile_details` only exists when the question has typed text), and the per-request lines (critical results, cautions, date) sit in the middle of the system prompt, before the skills and research-server lists, so every change invalidates everything after it.
- **Background processes.** On macOS/Linux `killTree` only sends SIGTERM to the agent program itself: anything it started (MCP servers, shells, helpers) can outlive a cancelled or timed-out question, and nothing escalates to SIGKILL. In `bun run server` mode nothing stops still-running agent programs when the server exits.
- **Profile saving.** Every database change re-sends the whole profile (all results, years of daily device data) to the folder.
- **Failing test.** `tests/server/serverPersistenceFixes.test.ts` (R1-009/R6-003): restoring a backup re-adds attachments in the order the zip lists them, which depends on the file system (`readdir`), not the saved `files.json` order.
- **Desktop.** The Tauri app has no updater.
- **eve.** The user wants eve (https://github.com/vercel/eve) integrated like the other two ai-2070 apps. Decision (2026-11-04, the user's choice): an **opt-in engine**, off by default, for API-key and local models.

## References studied (read-only)

- `/Users/lazlo/orca/ai-dashboard`: `server/uistream.ts` (hand-built `UIMessageChunk`s written as SSE from `node:http`, `UI_MESSAGE_STREAM_HEADERS`, keep-alive comments, `data: [DONE]`), `web/chat/transport.ts` and the Brain's `readUIMessageStream` reader, Claude Code `--include-partial-messages` parsing (`server/engines/claude.ts`), `server/promptcache.ts` (stable all-day system prompt, OpenRouter `cache_control` + `session_id`), `src-tauri/src/updater.rs` (native updater, no page IPC), `scripts/desktop-release.ts`, `runtime/eve` + `server/eve/*` (eve as a private child process with a localhost bridge).
- `/Users/lazlo/orca/dashboard`: `apps/brain` (eve 0.91 agent: `defineAgent`, dynamic tools/instructions, `eveChannel` auth, mock model for smoke tests), `apps/nest/src/brain/*` (`eve/client` sessions: create / attach().send() / cancel(); own transcript is the source of truth; recreate a lost or stranded session).

Where we deliberately differ from ai-dashboard: it never kills descendants and has no tests that processes die; we do both. It aborts runs only on an explicit stop; we keep "closing the request stops the run" (one person, one question at a time, and it's what the Stop button already does).

## Phases

### Phase 0 — this plan

Commit and push the plan on a new branch.

### Phase 1 — failing test

- `restoreZip` (`server/profiles.ts`): re-add attachments in `files.json` order; files the index doesn't list follow by name.
- `backupZip`: walk folders in sorted order, so the same folder always gives the same zip.
- Test: the existing R1-009/R6-003 regression passes on APFS and ext4 alike; a new test checks restore order is independent of zip entry order.

### Phase 2 — process trees (leftover processes)

- New `server/processTree.ts`: `spawnTree` starts a program in its own process group (`detached` on POSIX) and registers it; `killTree` sends SIGTERM to the whole group, waits up to 3 s, then SIGKILLs whatever is left; Windows uses `taskkill /t /f`. `killAllTrees` (graceful) and `killAllTreesNow` (on `process.exit`).
- `server/agents.ts` `runProgram` uses it for every agent program and helper (`hermes mcp …`, tests, installs-check). Timeouts and aborts both go through `killTree`.
- `server/index.ts`: shutdown stops owned trees together with MCP servers; an exit hook kills anything left. (Detached groups don't receive the terminal's Ctrl+C or the desktop shell's group kill, so the server must own them.)
- Tests (real processes, no mocks): a fake agent that starts a grandchild and records both pids; abort and timeout kill both; a child that ignores SIGTERM is SIGKILLed after the grace period; `killAllTrees` on shutdown; end-to-end through `runAgent` with a fake `claude` on `PATH`.

### Phase 3 — assistant workflow and prompt cache

- **No step limit.** `MAX_STEPS` and every `isStepCount` go. API models loop until the model stops calling tools (`isLoopFinished()`); claim reviews also stop as soon as the assessment is submitted. Claude Code claim checks lose `--max-turns`. The claim session's own search budget (queries per depth) stays: it limits research, not the loop.
- **One time limit: 10 minutes** (`ASSISTANT_TIMEOUT_MS`) for every assistant path: API models, agent programs, research-only questions and claim checks (were 180 s / 240 s / 480 s / 600 s).
- **Split `ask()`** into `server/brain/`: `prompt.ts` (system prompt, cache layout), `tools.ts` (which tools a request gets, in a stable order), `apiModel.ts` (AI SDK loop), `agentRun.ts` (agent programs), `claimReview.ts` (retrieval tracking and `submit_claim_assessment`), `ask.ts` (mode selection). `server/assistant.ts` stays as the public entry point, so callers and tests keep their imports.
- **Prompt cache layout.**
  - The system prompt is two parts: a static part (rules, skills index, research-server list: same for every question) and a short per-request part (critical results, cautions, the date for research checks), always last.
  - Tools are the same set, in the same order, on every turn of a scope: `save_profile_details` is always offered and refuses when the question has no typed text; built-in tools come first in a fixed order, research-server tools after.
  - Anthropic: `cacheControl: { type: "ephemeral" }` on the static system part (tools + rules are cached together) and on the newest message (the conversation so far is read from cache on the next turn).
  - OpenAI: a stable `promptCacheKey` per scope. OpenRouter with an `anthropic/` model: top-level `cache_control` and a stable `session_id` (a hash of the static prompt), as in ai-dashboard; zero-retention routing unchanged.
  - Known limit, documented: a photo is sent only with its own question and replaced by a note afterwards, so the turn after a photo misses the cache once (privacy and cost win). Agent programs start fresh per question (`--no-session-persistence`, so no health conversation is written to their own folders); their system prompt file is the stable prefix.
- Tests: identical tool names/order and static system text across turns, profiles and critical/no-critical; per-request text only in the last part; provider options per provider; no step-count stop condition; 10-minute signals; existing safety, privacy and claim tests unchanged in meaning.

### Phase 4 — streaming (AI SDK UI message stream)

- **One event shape** for every engine (`server/brain/events.ts`): `text`, `tool` (started), `tool_result` (with success and study IDs), `status`, and the final verified `reply`.
- **API models:** `streamText` instead of `generateText`, reading `fullStream`; steps, study IDs and validation are computed from the same results as today.
- **Agent programs:** `runProgram` gets `onLine`; Claude Code adds `--include-partial-messages` (`stream_event` → `text_delta`), Codex streams each `agent_message`, Hermes its `text` lines, OpenClaw stays one reply with a status. Tool steps stream from the bridge as they run (`BridgeRun.onStep`).
- **Wire format** (`server/uistream.ts`, after ai-dashboard): AI SDK `UIMessageChunk`s as SSE with `UI_MESSAGE_STREAM_HEADERS`: `start`, `text-*`, dynamic `tool-input-available` / `tool-output-*`, transient `data-status`, `data-studies` (IDs a tool actually returned), final `data-reply` (the same envelope as today), `finish`, `[DONE]`; 15 s keep-alive comments. Errors before the stream starts stay JSON with a status code; errors after start are an `error` chunk. Closing the request still stops the run (and its process tree).
- **Page:** `src/app/brain/stream.ts` reads the stream with `DefaultChatTransport` + `readUIMessageStream` (both in `ai`, no new dependency). The store shows a live assistant turn: text as it arrives, citations checked against the study IDs streamed so far (an ID is never shown as checked before a tool returned it), steps as they run, and a status line. On `data-reply` the live turn becomes the final turn and the existing follow-ups run unchanged (profile capture, habit/protocol/meal cards, notes). Stop aborts the read.
- **Claim checks** keep their JSON endpoint (the panel shows a result, not a chat).
- Tests: chunk order and SSE framing against a real `http` server read back with the SDK's own reader; abort on disconnect; `ask()` with `MockLanguageModelV4` `doStream` (existing `doGenerate` test models adapted by one helper); Claude Code partial-message, Codex and Hermes line parsers; the page store with a fake SSE response (live text, steps, final turn, stop, errors, privacy of the request body unchanged).

### Phase 5 — profile saves send only what changed

- The page remembers a fingerprint per profile part (person, results, log, experiments, protocols, meals, settings) after each acknowledged save and sends only changed parts (`PATCH /api/profiles/:id/data`). The first save after loading, and any save after an error, sends everything (reconciliation, as today).
- Server: `saveProfileParts` validates the merged profile exactly like a full save and writes only the changed files, with the same crash-safe write.
- Tests: an unchanged part is not sent; one new result sends only `results`; failure resends all; server merge validates the whole and preserves untouched files; ownership and identity checks unchanged.

### Phase 6 — desktop updates (Tauri, after ai-dashboard)

- `tauri-plugin-updater`; `src-tauri/src/updater.rs`: release builds check 30 s after start and every 6 h (off in debug builds and with `BT_NO_UPDATES`); a native dialog asks "Install and restart" / "Later" (Later skips that version until next launch); download with progress in the title; then stop the sidecar server (saving is already flushed by the page's own save loop; the server writes are atomic), install, restart. If install fails the server starts again and a dialog says so. No page IPC, no capabilities.
- `tauri.conf.json`: `plugins.updater` with the public key and `https://github.com/ai-2070/biomarker-tracker/releases/latest/download/latest.json`; `createUpdaterArtifacts` only in CI when the signing key exists. macOS bundles `app,dmg` (the `.app.tar.gz` update needs the app bundle).
- CI (`desktop.yml`): signing secrets passed to `tauri-action`, `uploadUpdaterJson: true`, a release tag without the key fails, other builds warn.
- A new signing key pair is generated locally (`~/.tauri/biomarker-tracker.key`, never committed); the public key goes in the config.
- **Needs the user:** add `TAURI_SIGNING_PRIVATE_KEY` as a repository secret. The repository is private: GitHub's `releases/latest/download` needs the repository public (or another update host) before installed apps can download updates.
- Tests: config (endpoint, minisign public key, no `createUpdaterArtifacts` in the base config), workflow wiring, `cargo fmt --check` / `cargo clippy` locally.
- Docs: `docs/desktop.md` (release steps, key handling, what happens on update).

### Phase 7 — eve engine (opt-in, off by default)

- `runtime/eve/agent/` (eve `1.0.0-rc.3`, pinned exactly): `agent.ts` (`defaultTools: false`, no sandbox), dynamic instructions and tools fetched from the main server, a **model that proxies every call to the main server** (`/eve-bridge/model`), so API keys, zero-retention routing, provider options and prompt-cache settings stay in one place and the eve process never sees a key. `channels/eve.ts`: bearer-token auth only. `launch.mjs`: exits when its stdin closes.
- `server/eve/host.ts`: builds nothing at run time; starts the built server as an owned process tree on `127.0.0.1` and a random port, random token per launch, cwd in `data/eve/` (its run store), waits for `/eve/v1/health`, restarts with backoff, stops with the server. In the desktop app the compiled sidecar runs it with `BUN_BE_BUN=1`.
- `server/eve/bridge.ts`: token-checked `/eve-bridge/{configuration,tool,model}` on the main server; tool calls are recorded as steps and study IDs exactly like the agent bridge.
- `server/eve/run.ts`: one eve session per question (history from the page, as today), `content.delta` / `call.*` events mapped to the Phase 4 events; Stop cancels the session; a stranded or lost session is recreated.
- Settings → AI models: "Run API and local models in eve (preview)" (`assistant.engine: "eve"`), only for API-key and local models; agent programs are unchanged. Claim checks stay on the built-in loop.
- Build: `bun run eve:build` (part of `build` and `desktop:prepare`; the built output is shipped as a desktop resource).
- Privacy: eve keeps in-progress runs (the question, tool results) in `data/eve/`, gitignored, local. Nothing new leaves the computer: eve makes no network calls of its own; models are called by the main server as before. `data/eve/` is not part of profile backups.
- Tests: bridge auth and refusals, configuration/tool/model proxy (with a mock model), event mapping, host start/stop/restart with a fake eve server, settings validation; `bun run eve:smoke` runs the built output with a mock model.

### Phase 8 — docs and PR

- CLAUDE.md: the server and desktop app exist (the "static build only" line is out of date), streaming, no step limit and the 10-minute limit, prompt-cache layout, process trees, partial saves, updater, eve engine and its data folder.
- Full `bun run typecheck`, `bun run test`, `bun run build`, `cargo fmt --check`, `cargo clippy`.
- Open the PR with the phase list, test results and the two user actions (signing secret, repository visibility).

## Out of scope

- Persisting Brain conversations across reloads and re-attaching to a running answer (eve's durable runs make this possible later).
- Component clean-ups from the review (Base UI folds/tabs, `Brain.tsx` split beyond what streaming touches).

## Ledger

| Phase | Commit | Notes |
| --- | --- | --- |
| 0 Plan | Plan: Brain streaming, no step limit, process trees, eve and desktop updates | This file. |
| 1 Failing test | Restore attachments in their saved order… | Also deterministic backup zips. |
| 2 Process trees | Stop agent programs together with everything they start | Real-process tests; desktop shell waits 5 s. |
| 3 Workflow and cache | Brain: no step limit, one 10-minute limit, a cache-friendly prompt… | `server/brain/`. |
| 4 Streaming | Stream Brain's answers with the AI SDK UI message stream | Checked by hand with the installed Claude Code. |
| 5 Partial saves | Profile saves send only the parts that changed | |
| 6 Desktop updates | Desktop app: signed updates from GitHub Releases | Key at `~/.tauri/biomarker-tracker.key` (not committed). |
| 7 eve | eve as an opt-in engine for API-key and local models (preview) | Built runtime tested end to end with a mock model. |
| 8 Docs | CLAUDE.md, this ledger | |

Still needs the user:

- Add the repository secret `TAURI_SIGNING_PRIVATE_KEY` (`gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/biomarker-tracker.key`) and keep a backup of the key.
- Make the repository public (or host `latest.json` elsewhere) before installed apps can find updates.
- eve with a real provider (an API key or a local model) hasn't been tried here; only a mock model.
