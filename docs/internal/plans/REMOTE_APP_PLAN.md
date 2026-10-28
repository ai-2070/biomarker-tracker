# One app for desktop, web and Android

*Plan, 2026-10-26. Nothing here is built yet.*

## Goal

Use Blacksite from a phone as well as from the desktop app and the browser, with one codebase for
the page. The server keeps running on your computer: it starts agent CLIs, terminals and a Bun
runtime, which a phone can't. The Android app is a remote control for that server.

Pairing should be one step: scan a QR code shown on the computer. The phone connects directly
when it can and through a relay when it can't, and moves to a direct path later when one opens up.

## Where things stand

- **The page:** about 15,700 lines of TypeScript in `web/`. Most pages are plain DOM built with
  `h()` (about 2,200 calls). Agent chats are React (`web/chat/*.tsx`). The Station
  (`web/views/station.ts`, about 4,000 lines) is three.js. Terminals are xterm. The look is our own
  CSS (`public/*.css`, about 1,450 lines).
- **Requests are already mostly in one place.** 281 calls go through `api()` / `GET` / `POST` /
  `PUT` / `DEL` in `web/core.ts`. What goes around it:
  - 4 raw `fetch` calls (`backup.ts`, `chat/transport.ts`, `modelviewer.ts`, `views/connections.ts`)
  - 1 `XMLHttpRequest` upload (`attach.ts`, for progress)
  - 2 WebSockets: live events (`core.ts`) and terminals (`views/terminals.ts`)
  - the Vercel AI SDK chat transport (`chat/transport.ts`)
  - about 13 places that build `/api/...` URLs for `<img>`, downloads and previews (`fileUrl` is
    written four times)
- **The server only accepts this computer** (127.0.0.1, Host check, `x-dash`, `Sec-Fetch-Site`),
  with no login. That stays true for the browser on the computer.
- **Net on Android:** `net-mesh-sdk` (default features) compiles for `aarch64-linux-android`
  with NDK r30 and API 24, and its `nrpc_echo` example links into an Android arm64 program. Not run
  on a phone yet, and Net's CI has no Android build. Linux-only fast paths in Net are behind
  `target_os = "linux"`, so Android takes the general path that macOS and Windows use.

## The order

The three parts can be done in this order. Each one is useful on its own.

| Part | What | Why here |
|---|---|---|
| A | One client for everything the page asks the server | Small. The Net part and the Base UI pages both build on it |
| B | Pages on React with Base UI | Phone-sized layouts. The longest part; goes page by page |
| C | Net: pairing, relay, the Android app | Needs A. Its first step (a proof of concept) can start while B goes on |

We talked about doing B first. A first is cheaper: B rewrites every page, and if A is done
those pages call the new client from day one instead of being touched twice. A takes days; B
takes weeks.

## A. One client

**Goal:** the page never writes `/api/...`, `fetch` or `new WebSocket` itself. One module knows
where the server is and how to reach it, so a second way to reach it (Net) is one change.

1. **`web/client/` with three pieces:**
   - `connection.ts`: the base address (empty = same origin, as now), the headers every request
     sends (`x-dash`), and later the key a paired phone sends. Everything below asks it.
   - `http.ts`: `api`/`GET`/`POST`/`PUT`/`DEL` move here unchanged (`core.ts` re-exports them, so
     the 281 calls don't change). Add `upload()` (the XHR with progress), `download()` and
     `fileUrl()`/`apiUrl()` for `<img src>` and links.
   - `live.ts`: the events WebSocket and terminal sockets, both built from the connection.
2. **Move the stragglers:** the 4 raw `fetch` calls, the upload, both WebSockets and the ~13
   hand-built URLs. Delete the four copies of `fileUrl`.
3. **Chat transport:** `chatTransport`/`brainTransport` take their URL and `fetch` from the
   client.
4. **Per-area modules, only where they help:** `client/agents.ts`, `client/skills.ts`, … with
   typed functions (`agents.list()`, `agents.save(a)`), using the shapes in `shared/types.ts`.
   Do it as pages are rewritten in B, not all at once.
5. **A guard:** a test that fails when a file outside `web/client/` contains `'/api/'`, `fetch(`
   or `new WebSocket(`.

Tests: the client's URL building, headers and upload in `tests/web`; the existing page tests keep
passing.

**Status:** steps 1, 2, 3 and 5 are done: `web/client/connection.ts` and `web/client/http.ts`, with
the guard in `tests/server/web-client-boundary.test.ts` (it reads files, so it runs with the Node
tests). Step 4 goes with B, page by page.

## B. Pages on React and Base UI

**Goal:** one way to build pages, accessible menus, dialogs and popovers, and layouts that work on
a phone.

- **Base UI** is `@base-ui/react` (1.9 now, React 17–19). It has no styles of its own: our CSS
  and look settings (accent colour, themes) stay. React 19 is already in the app for the chats.
- **One page at a time.** A React page is mounted the way chats are now (`chat/mount.tsx`), so old
  and new pages live side by side and every step ships.
- **Start with the shared pieces:** modals and `confirmBox`, toasts, menus, the segmented control
  (`seg`), tabs, toggles, tooltips. Then the simple pages (Settings, Library, Skills, MCP, Outbox),
  then the busy ones (Agents, Routines, Workflows, Artifacts).
- **The Station stays three.js.** Its canvas is mounted in a React page; its side panels can move
  to Base UI. Terminals stay xterm.
- **Phone layouts as each page moves:** one column under about 600 px, touch-sized controls, the
  sidebar as a drawer, the chat box above the keyboard.
- **Not Tamagui:** it pays off for a React Native app, which would mean writing the page again
  without three.js and xterm.

Tests: each moved page gets tests in `tests/web` (happy-dom), like the chat pieces have now.

**Status:** dialogs and toasts are done. `web/ui/overlays.tsx` draws them all with Base UI in one
React root, behind the same `modal()` / `confirmBox()` / `promptBox()` / `toast()` calls, so no page
changed. A dialog opened from another nests in it: Escape closes only the top one, focus stays inside
and goes back to what opened it, and the page behind doesn't scroll. React now loads with the page.

The Library is the first page on React (`web/views/library.tsx`), with `Tabs`, `Segmented` and
`Chips` from `web/ui/controls.tsx`. Same look; tabs move with the arrow keys, and the page simply
unmounts when you leave it.

Since then every page in `web/views/` has moved except the Station: Settings and all its tabs,
Artifacts, Outbox, Skills, Terminals, Overview, the agent chat page, Agents, Routines and the Team
editor. Plain-DOM pieces they still use (the skill picker, the schedule editor, the memory editor,
the routine @ menu, approval cards) are hosted with `<DomNode>` and can move later. The Brain chat
(`web/dock.tsx`), the floating chat window (`web/chatwin.tsx`), an agent's tab in it
(`web/agentchat.tsx`) and team chats (`web/teamchat.tsx`) are React too. On the Station, the side
panel (`web/views/stationpanel.tsx`) and the right-click menu (`web/views/stationmenu.tsx`, Base UI
Menu) are React; `web/views/stationdata.ts` holds the connection helpers the map and the panel share.
The map itself (three.js, its labels and wires) stays plain code. So does its header for now: the
map reads the header's connection tiles every frame to draw wires and hover light, and the project
switcher animates the header's text directly. It can move once those read from a React ref instead.

## C. Net: pairing, relay and the Android app

**Goal:** a phone (or another computer) reaches the dashboard over Net, end to end encrypted,
without opening the server to the internet.

### How a request travels

```text
phone                                         your computer
page ──HTTP──▶ phone's own proxy (127.0.0.1) ══Net══▶ dashboard server's Net node ──▶ same /api routes
                 (Tauri Android, Rust)          direct, or through the relay
```

- **On the computer:** the server runs a Net node with one nRPC service that passes a request to
  its own API and sends back the answer. Plain requests are unary calls. Chat streams and the
  events and terminal sockets use nRPC's streaming and duplex calls. The 170 routes don't change.
- **On the phone:** the Tauri app's Rust side runs a Net node and a small proxy on the phone's
  127.0.0.1. The page loads from that proxy, so with A done it keeps calling `/api/...` and
  nothing in `web/` knows about Net.
- **The relay:** `net-mesh relay serve` on a server with a public address (a small VPS). It only
  forwards encrypted packets and holds no keys. TCP on 443 for networks that block UDP. Devices
  try direct first; a relayed connection moves to direct in the background when it can (on by
  default in Net 0.34+).

### Pairing

- **Settings → Devices → Pair a phone** shows a QR code holding a Net join token (one use, short
  expiry) and the relay's address.
- The phone scans it, joins, and shows up in the device list with a name. Remove a device there to
  cut it off.
- Requests that come in over Net are tagged with the device they came from. Routes stay as they
  are; anything that today relies on "only this computer can ask" (`/api/internal`, keys,
  account tokens) is checked again for a paired device. Secrets still never go to any page.

### The Android app

- `tauri android init` next to the desktop app. The Rust code that starts Bun, the updater,
  single-instance and window state is desktop-only (`#[cfg(desktop)]`).
- Notifications for "Needs you" while the app is closed need a push service (FCM, or ntfy). Later.
- Play Store: signing key, listing, review.

### Steps

1. **Proof of concept (can start alongside B):** an nRPC echo between the computer and an Android
   emulator through a relay, then direct. Measure how often phones on mobile data stay on the relay.
2. Server side: the Net node and the pass-through service, behind a setting that is off by default.
3. Pairing screen and device list.
4. The Android app with the proxy.
5. Phone layouts from B, push notifications, store release.

## Open questions

- **Which relay:** do we run one for everyone (cost, abuse limits), or does each user run their own?
- **Mobile data:** carrier NATs often block direct paths, so phones may sit on the relay much of the
  time. The proof of concept should measure it.
- **What a phone may do:** everything the computer can, or a smaller set (approve, chat, watch)
  with risky actions (`high` tools, deleting) confirmed on the computer?
- **iOS:** Tauri builds it too. Same plan, plus an Apple developer account. Not in scope yet.
