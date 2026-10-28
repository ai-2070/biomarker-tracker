# AGENTS.md

Guidance for AI coding agents working in this repo. For what the app does from a user's point of
view, read `README.md`; `docs/guide.md` is the long version of it.

## What this is

**Blacksite**: a local, login-free command center for AI agents. A Bun + TypeScript server
(`server/`) on `127.0.0.1:4800` and a browser app (`web/`) bundled into `public/dist`. All user
state is plain JSON under `data/` (git-ignored). Mainly used on Windows; CI also runs on Linux.

## Commands

```powershell
bun install
bun run dev          # rebuild the page and restart the server on every change
bun run typecheck    # tsc for server/ and web/ (two separate tsconfigs)
bun run test         # Vitest, server + web projects
bun run check        # typecheck + test: run this before you call a change done
bun run build        # bundle web/ (and its Tailwind CSS) into public/dist
bun run icons        # regenerate web/icons.ts after adding names in scripts/build-icons.ts
bun server/index.ts --port 4900 --no-open   # a second instance that won't open a browser
bun scripts/try-agent.ts <agentId> "message" [--port 4800] [--approve]
bun run desktop:dev    # the desktop app (needs Rust); desktop:build makes installers
bun scripts/build-desktop.ts && bun run desktop:smoke   # run the bundled server the way the app does
```

Single test file: `bunx vitest run tests/server/skills.test.ts`.
CI (`.github/workflows/ci.yml`) runs typecheck, test and build on ubuntu and windows. All three must pass.
Its "Desktop app" job also stages the desktop app, runs the smoke test and checks the Rust code.
`.github/workflows/desktop.yml` builds the installers (on `v*` tags, or by hand).

## Layout

| Path | What's in it |
|---|---|
| `server/index.ts` | HTTP router (`get`/`post`/`put`/`del` helpers), WebSocket, static files, security checks |
| `server/store.ts` | JSON storage: settings, secrets, projects, `collection<T>()`, chats, the event `bus` / `emit()` |
| `server/engines/` | Engines that run agents: `claude.ts` (Claude Code CLI), `codex.ts`, `hermes.ts`, `openai.ts` (any OpenAI-compatible API); `index.ts` starts and stops runs |
| `server/tools.ts` | Built-in agent tools, each with a `Risk` (`none` / `low` / `high`) that decides when approval is asked |
| `server/mcp-bridge.ts` | Gives the dashboard tools to Claude Code and Codex over MCP |
| `server/brain.ts`, `overseer.ts`, `teams.ts`, `learning.ts` | The Brain, approvals review, team chats, self-improvement |
| `server/projectsync.ts`, `backup.ts`, `versions.ts` | Auto-save into `<project>/.dashboard`, `.dashbackup` files, version history |
| `shared/` | Types and logic both sides import (`types.ts` is the source of truth for data shapes) |
| `web/` | Browser app. Every page in `web/views/` is React on Base UI (`reactPage()` in `web/ui/react.tsx`) except the Station's map and header (`station.ts`, three.js and plain DOM); its side panel (`stationpanel.tsx`) and right-click menu (`stationmenu.tsx`) are React, and `stationdata.ts` has what the map and panel share. The Brain chat, the floating chat window, its agent tabs and team chats are React too (`dock.tsx`, `chatwin.tsx`, `agentchat.tsx`, `teamchat.tsx`). Some smaller pieces (dialogs' contents, the model picker, file previews) are still plain DOM via the `h()` helper in `web/core.ts`; a React page hosts one with `<DomNode>`. Agent chats are React (`web/chat/*.tsx`, Vercel AI SDK + OpenUI) |
| `web/ui/` | Base UI (`@base-ui/react`) pieces. `overlays.tsx` draws every dialog and toast: `modal()`, `confirmBox()`, `promptBox()` and `toast()` in `web/core.ts` call it with plain DOM. `react.tsx` mounts a React page (`mountReact`, `useAppState`, `Icon`); `controls.tsx` has `Tabs`, `Segmented` and `Chips` in the app's own classes |
| `web/client/` | The page's only way to the server: addresses (`apiUrl`, `fileUrl`, `serverUrl`), requests (`api`, uploads) and sockets. A test fails if other code writes `/api/`, `fetch(` or `new WebSocket(` |
| `web/views/` | One module per page (`station.ts` is the 3D map, three.js) |
| `server/voxel/` | The voxel world (`docs/internal/plans/VOXEL_WORLD_PLAN.md`): worlds on disk (`store.ts`), which world a project shows (`link.ts`), the build steps (`ops.ts`: shapes, shape and region tools, stamping and placing prefabs), building and undo (`build.ts`), prefabs and the prefab library (`prefabs.ts`), WORLD.md (`worldmd.ts`), the agents' tools (`tools.ts`), `world_script`'s sandbox (`script.ts`: QuickJS in WebAssembly, no files or network) |
| `web/voxel/`, `shared/voxel.ts`, `shared/worldenv.ts` | The world on the Station: voxel data and its encoding, times of day, the mesher and its worker (`mesh.worker.ts`, a second entry in `scripts/build-web.ts`), the voxel look's light and finishing passes (`view.ts`, `post.ts`), the world's objects on the map (`worldlayer.ts`). Loaded only when Settings › Look › Station look is "Voxel world" |
| `web/styles/` | Tailwind CSS 4. `app.css` is the entry (theme tokens, layers, keyframes), `base.css` styles bare elements, `components.css` has the pieces used everywhere (`btn`, `card`, `pill`, `modal`, `md` for Markdown…). The build writes `public/dist/app.css` |
| `public/` | `index.html`. `public/dist` is build output, never edit it |
| `skills/` | Skill folders that come with the dashboard (`storytold`, `oomol`, `composio`, `orca`, `subagent-skills`, `hermes`), copied unchanged from GitHub: each folder's `README.md` says from where and which commit. `hermes` keeps Hermes's own category folders (`nested` in `BUNDLED`). `BUNDLED` in `server/skills.ts` lists them; `ensureBuiltinSkills` adds them to the library. Skills the dashboard writes itself (Self-improvement, Start agents in Orca) are in `BUILTIN` there instead |
| `library/agency-agents/` | The Agency's agent files (the Library's specialists), copied unchanged from GitHub: its `README.md` says from where and which commit. `server/library.ts` reads the folder directly |
| `tests/server`, `tests/web` | Vitest: server in Node, web in happy-dom |
| `src-tauri/` | The desktop app (Tauri 2, Rust): starts the bundled server with a bundled Bun and shows it. `docs/desktop.md` explains it |
| `scripts/build-desktop.ts` | Fills `src-tauri/app/` (server bundled with `Bun.build`, page, skills, library, node-pty) and `src-tauri/binaries/` (Bun) |
| `docs/internal/plans/` | Review notes and plans |

## Code rules

- **TypeScript, strict, no `any`.** Use `unknown` and narrow. `catch (e)` is `unknown`.
- `verbatimModuleSyntax` + `erasableSyntaxOnly`: use `import type` for types, and no `enum`,
  `namespace` or constructor parameter properties.
- Relative imports include the `.ts` / `.tsx` extension (`import { x } from './util.ts'`).
- **Server code must also run under Node**: Vitest imports server modules in Node, so don't use
  `Bun.*` or `bun:` APIs in `server/` or `shared/`. (Scripts in `scripts/` may use Bun.)
- Server `tsconfig` has no DOM types and web has no Node types: keep `shared/` free of both.
- New data shapes go in `shared/types.ts`. New server state goes through `store.ts` helpers
  (`collection`, `readJSON`/`writeJSON`, `dataPath`/`projectData`), not ad-hoc `fs` writes.
- Tell open tabs about changes with `emit(type, payload)` from `store.ts`.
- Style with Tailwind utilities in the markup, using the theme's tokens (`text-dim`, `bg-panel-2`,
  `rounded-box`, `max-md:`), not new CSS. Reuse the pieces in `web/styles/components.css`; add to it only
  for something used in several places or that utilities can't reach. Write class names whole (Tailwind
  reads the source; never `` `bg-${x}` ``), and in plain DOM put them in attrs: `h('div', { class: 'flex gap-2' })`.
  Classes that code or tests look up stay as markers. `docs/internal/plans/tailwind.md` has the details.
- Comments are short and in plain words; explain why, not what. Match the existing style.
- The desktop app runs the server bundled into one file. Server imports must bundle with `Bun.build`
  (native modules go in `external` and get copied, like node-pty), and files read relative to `ROOT` must be
  copied in `scripts/build-desktop.ts`. The installed app folder is read-only: write under `DATA` only.
- Large files exist (`web/views/station.ts`, `server/index.ts`). Edit the relevant part; don't
  reformat or reorganize unrelated code.

## Security boundaries (don't weaken these)

- The server listens on `127.0.0.1` only and checks the `Host` header (DNS rebinding).
- Every non-GET `/api/` request needs the `x-dash: 1` header (`web/client/` sends it).
  Cross-site requests are refused via `Sec-Fetch-Site`; only the X/Reddit OAuth callbacks are exempt.
- `/api/internal/` routes need the `x-dash-internal` token (used by the MCP bridge).
- Secrets (`data/secrets.json`) and account tokens never go to the browser and never go into
  `<project>/.dashboard` or backups.
- File access by agents is limited to allowed roots (`insideRoots` in `server/util.ts`).
  Don't follow symlinks out of the data folder.
- New tools need an honest `Risk`: anything that deletes, runs code, sends messages or posts is `high`.
- A run belongs to the project it started in. Use `withProject()` / the run's own project rather
  than the globally active project when writing chats or files from a run.
- Skill installs from GitHub only come from links the user typed, unless the user opted in.

## Tests

- Server tests (`tests/server/setup.ts`) point `DASH_DATA`, `HOME` and `USERPROFILE` at a throwaway
  folder and abort if that fails. Never bypass this or touch the real `data/` or home folder.
- `tests/server/api.test.ts` starts the real server with Bun on a free port the system hands out, and checks it is talking to its own server (its data folder).
- Add or update tests with every behavior change: server logic in `tests/server`, DOM helpers and
  React chat pieces in `tests/web`.
- Paths differ on Windows (long vs short names, `\` vs `/`, case). Compare resolved/real paths.

## User-facing text

UI copy, README and commit messages use short, plain words for non-technical users
("Needs you", "Back up this project"), not jargon. Keep the README's feature descriptions — and
`docs/guide.md`'s — in step with behavior changes you make.

## Git

- Commit subjects: `Area: what changed, in plain words`, e.g.
  `Skills: write a new one or change one in plain words`, `Test: ...`, `Review fixes (server): ...`.
- `bun.lock` is committed; CI installs with `--frozen-lockfile`, so update it when you change
  dependencies. Renovate handles routine upgrades.
- Never commit `data/`, `public/dist/`, `src-tauri/app/`, `src-tauri/binaries/`, logs or keys.
  `src-tauri/Cargo.lock` is committed.
