# Blacksite: the detailed guide

The [README](../README.md) says what the dashboard is, how to install it, which engines and models it can use, and the everyday commands. This file explains how it behaves once it is running.

- [Desktop app notes](#desktop-app-notes)
- [Giving engine CLIs the dashboard tools](#giving-engine-clis-the-dashboard-tools)
- [Your first project](#your-first-project)
- [Chats and files](#chats-and-files)
- [Skills: instructions worth keeping](#skills-instructions-worth-keeping)
- [MEMORY.md: what agents remember](#memorymd-what-agents-remember)
- [Routines: work worth repeating](#routines-work-worth-repeating)
- [The Brain and your teams](#the-brain-and-your-teams)
- [Models, effort and stopping work from Brain chat](#models-effort-and-stopping-work-from-brain-chat)
- [MCP servers from Brain chat](#mcp-servers-from-brain-chat)
- [Long chats](#long-chats)
- [Approvals and safety](#approvals-and-safety)
- [Save and restore](#save-and-restore)
- [Troubleshooting](#troubleshooting)

## Desktop app notes

The [desktop app](../README.md#desktop-app) is the same dashboard in its own window. It starts the dashboard's server when you open it and stops it when you quit. Links to other sites open in your browser.

- **Closing the window keeps it running** in the tray (the notification area on Windows, the menu bar on macOS), so agents keep working. Click the tray icon, or open the app again, to bring the window back. To quit, right-click the tray icon and choose **Quit Blacksite**. On a Linux desktop that hides tray icons (GNOME without an extension), open the app again from the app menu to bring the window back.
- **Its data is separate** from a checkout's `data/` folder. It lives in `%APPDATA%\com.ai2070.blacksite\data` on Windows, `~/Library/Application Support/com.ai2070.blacksite/data` on macOS and `~/.local/share/com.ai2070.blacksite/data` on Linux. To use another folder, start the app with `DASH_DATA` set to it. Its first project uses the same **My workspace** folder as the browser version: if that folder already has a saved copy (`.dashboard`), the app loads it first instead of saving an empty project over it.
- **It uses port 14800**, not 4800, so it can run next to the browser version. If 14800 is taken, it uses the next free port. To sign in to X or Reddit from the app, add the callback address its **Connections** page shows (with 14800) to your X or Reddit app.
- **The installers are not signed yet.** On Windows, choose **More info → Run anyway**. On macOS, Control-click the app in Finder and choose **Open**, or allow it under **System Settings → Privacy & Security**.
- **It updates itself.** A little after it opens, and every few hours after that, the app checks for a new version. When there is one, it asks you: **Install and restart** downloads it (the window's title shows how far it got), installs it and opens the app again. Installing restarts the dashboard, so agents that are working stop; they pick up again when you write to them. **Later** asks again the next time you open the app. On Linux, a `.deb` or `.rpm` update asks for your password. To turn updates off, start the app with `DASH_NO_UPDATES` set. What the updater did is in `updater.log`, next to the server's log.

## Giving engine CLIs the dashboard tools

Claude Code and Codex receive dashboard tools through an MCP bridge; API-model agents call them directly. For Hermes, open **Settings → MCP servers** and click **Give Hermes the dashboard tools**, then restart Hermes sessions. pi and oh-my-pi get them through their own `mcp.json` (pi needs version 0.99 or newer): the first run of an agent on either adds the dashboard there, and puts it right if the app was moved. **Give pi and oh-my-pi the dashboard tools** on the same page does it by hand. If that file isn't valid JSON it is left alone, and you get a message saying the agent can't use the dashboard tools until it is fixed.

pi and oh-my-pi run their own tools (files, shell, edits) without asking, whatever the agent's autonomy says. OpenClaw follows its own approval settings. Each chat keeps its own pi, oh-my-pi or OpenClaw session. OpenClaw goes through its Gateway when it is running; otherwise it answers on this PC.

## Your first project

1. **Choose a folder.** From the project picker, select **New project**. Start in a new folder, use an existing one, or clone a GitHub repo. Give the project a name and describe what you want to make. GitHub cloning uses your `gh` login, including for private repos.
2. **Ask the Brain for a small, concrete job.** Open **Ask the Brain**, press **Ctrl+K** (**⌘K** on macOS), or press **Space** on the Station when you are not typing. For example:

   > Build a small team to review this project's docs. Have one agent find confusing setup steps and another suggest clearer wording. Do not change files yet.

3. **Review the agents and their access.** Check their models, instructions, tools and work folders. You can also add a ready-made agent from the **Agent library** instead of asking the Brain to build one.
4. **Follow the work.** Click a team or agent on the Station to open its panel and chat. Team chats show the conversation and handoffs; individual chats let you work with one agent directly.
5. **Handle anything waiting on you.** Check **Needs you** for permissions and **Outbox** for agents' questions and outgoing drafts. Results that agents save as artifacts appear in **Artifacts**; files they create stay in their work folders.

Projects keep separate agents, teams and chats. Use the project name at the top left to switch projects, create another one or make a backup.

## Chats and files

Agent and team chats open in floating, resizable windows with tabs. Type **@** in a chat to pick another agent. An agent with **Delegate** enabled can hand that agent part of the work. Handing off doesn't make it wait: the other agent starts at once, so an agent can hand out several tasks side by side and collect each answer when it's ready, however long the work takes.

Type **/** in an agent, team or Brain chat to see the commands. They work while the agent is busy:

- `/queue <message>` lines up your next message. It waits above the box and goes once the work going on now is done, one at a time. In a team chat that is when the whole team is done; in Brain chat, when the Brain and anything it handed on are done. **×** takes one back. If nothing is working it goes right away. You can change a queued message before it goes: click it, or press **Up** in an empty box for the last one (Enter keeps the change, Esc drops it). Drag one, or use **Alt+Up** / **Alt+Down**, to change the order.
- **Changing course while it works.** The button under the paperclip is **Stop** while something works and the box is empty, and **Send** once you type. A message you send then doesn't wait, and queued messages keep waiting:
  - In an agent chat, the agent stops what it is doing and takes your message up right away, carrying on from what it did so far. A `/goal` and a `/loop` carry on too. If the agent is slow to stop, your message waits at the top of the queue and goes the moment it has. Not while the agent works for a team or another agent (they wait on its answer): `/queue` your message instead.
  - In a team chat, whoever is working stops and takes it up, unless you @mention someone else.
  - In Brain chat, the answer the Brain is writing stops (it changes nothing) and your new message is answered now; the Brain still knows what you asked before. Agents and teams it handed work to carry on. An answer that was already carrying out what it decided still finishes, and shows in the chat. A message to a team from Brain chat changes that team's course the same way.
- `/stop` stops the work, like the **Stop** button. Queued messages come back to the box instead of being sent. In Brain chat it also stops the agents and teams the Brain handed work to, and an answer it was still writing changes nothing.
- `/resume` picks up work that was stopped: the agent carries on where its turn was cut off, a team's interrupted agents start again (also after the team paused at its turn limit), and in Brain chat what the last `/stop` cut off.
- `/resend` sends your last message again, with its files.
- `/loop <message>` repeats a message. `/loop 15m check the build` sends it every 15 minutes, never while a turn is still going; `/loop 5x improve the tests` sends it again after each answer, 5 times. A loop runs 10 times unless you say otherwise (at most 100). It shows above the box with **×** to end it; `/loop off` or `/stop` ends it too. Loops last until the dashboard restarts; use a Routine for anything permanent.
- `/goal <what done looks like>` keeps the work going until it is done. After each turn, the Brain checks the work against your goal and follows up with what is missing, up to 5 times, then says whether the goal was reached. `/goal` alone shows it, `/goal clear` drops it. In Brain chat, the Brain hands the goal to the right agent or team and follows up there.
- `/compact` (agent chats) shortens the chat; see Long chats.
- `/clear` (team chats) empties the chat after you confirm, and each agent forgets the conversation.

Commands the dashboard doesn't know go to the agent as you typed them. A Claude Code agent's own commands and skills (from `~/.claude` and its work folder's `.claude`) are listed in the **/** menu too.

When you paste a lot of text (more than 10 lines or 800 characters) into an agent, team or Brain chat, the box shows a short `[Pasted text #1 · 52 lines]` instead, with a chip above it. Click the chip (or the marker) to see what you pasted, copy it, remove it, or put the whole text in the box to change it. Backspace right after the marker removes it. The full text is sent in its place.

Use the paperclip, drop files and folders, or paste them (**Ctrl+V**, **⌘V** on macOS) into a chat, the Brain on the Station, the team builder or the New project dialog. A pasted screenshot is saved as `pasted-image.png`. Pasting on the Station, outside a text box, gives the files to the Brain. Text copied from Word, Excel or a web page still pastes as text. Attachments are saved under the project folder's `uploads/` directory, and the agent or Brain receives their paths. Files attached in the team builder are shared with every team member.

## Skills: instructions worth keeping

Skills use Claude Code's `SKILL.md` format. Assign them to an agent, a team, the whole project or the Brain.

- **Write or change one in plain words.** Ask for something like “Short release notes, with user-facing changes first.” The Brain fills in the editor for you to review and save. Undo restores the previous editor contents.
- **Bring your own.** Import Claude Code skills or install from a GitHub repository, folder or `SKILL.md` link. Installing the same skill again updates it. Private repos use `gh auth login` or `GITHUB_TOKEN`.
- **Let the Brain manage assignments.** It can create, edit, assign, remove assignments, install and delete skills.

By default, the Brain only installs from GitHub repos **you named in Brain chat**. Links found in files, web pages or agent replies do not grant permission. **Install skills from any GitHub link**, under The Brain's model settings, relaxes that rule; leave it off unless you trust those sources.

The Brain starts with a **Self-improvement** skill. After substantial agent work, it can review the outcome and save a useful workflow as a skill, improve an existing skill or assign one where it is needed. Changes are reported in Brain chat. The review is limited to skills and cannot change the Brain's own skills. Remove Self-improvement from the Brain on the Skills page to turn it off.

The library also comes with the **storytold skills** ([hermes-pro/storytold-skills](https://github.com/hermes-pro/storytold-skills)), one per [storytold Crafting App](https://github.com/storytold): VectorCraft, PhotoCraft, LightCraft, EffectCraft, FilmCraft, DesignCraft, PdfCraft, WordCraft, GridCraft, DeckCraft, SoundCraft, CADCraft and FigCraft. Two more come with them: **storytold** picks the right app for a creative task, and **storytold-install** installs the apps and sets up their MCP servers. They aren't given to anyone until you assign them. Delete the ones you don't want; they stay deleted. **Download again** gets the latest version from GitHub. When a Crafting App's MCP server is set up, the map's **Connected to** row shows it with the app's own icon.

Two more sets come with it, for connecting agents to your accounts and apps: the **OOMOL skills** ([oomol-lab/oo-cli](https://github.com/oomol-lab/oo-cli)): **oo**, which reaches your connected accounts, OOMOL's hosted AI and Open Flow workflows, plus **oo-find-skills**, **oo-create-skill** and **oo-publish-skill**; and the **Composio skill** ([ComposioHQ/skills](https://github.com/ComposioHQ/skills)), **composio**, which uses more than 1,000 apps through the Composio command line tool. Both need their command line tool (`oo` or `composio`), which isn't part of the dashboard. They work the same way: not given to anyone until you assign them, and deleted ones stay deleted.

The **Orca skills** ([stablyai/orca](https://github.com/stablyai/orca)) come with it too, for agents working inside [Orca](https://github.com/stablyai/orca): **orca-cli** (worktrees, terminals and Orca's browser), **orchestration** (several Orca agents working together), **computer-use** (clicking and typing in an app window), **orca-linear**, **orca-jira** and **jira-tickets** (Linear and Jira tickets), **orca-emulator** and **orca-emulator-android** (iOS and Android emulators) and **orca-per-workspace-env** (a fresh sandbox for each workspace). Each one loads its full guide from the installed Orca app, so they need Orca. Same rules: not given to anyone until you assign them, and deleted ones stay deleted.

A choice of **Hermes skills** ([NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)) comes with it too: about fifty that fit any agent and work on Windows. They cover coding (**systematic-debugging**, **test-driven-development**, **requesting-code-review**, **github**, **ast-grep**, **docker-management**…), documents and finance (**pdf**, **docx**, **xlsx**, **powerpoint**, DCF, LBO and three-statement models), research (**arxiv**, **grounded-citations**, **duckduckgo-search**, **youtube-content**, **maps**, **stocks**…), creative work (**excalidraw**, **architecture-diagram**, **manim-video**, **p5js**, **pixel-art**, **comfyui**…) and everyday work (**email-inbox-triage**, **meeting-action-items**, **weekly-review-planning**, **obsidian**…). `skills/hermes/README.md` lists them all and the ones left out. Hermes agents don't need them, since Hermes brings its own. They are written for Hermes's tools, so other agents use their own shell, file and web tools where a skill names Hermes's; some run Python scripts that come with them. Same rules: not given to anyone until you assign them, and deleted ones stay deleted.

One more comes with the dashboard itself: **Start agents in Orca**. Give it to an agent and it can start Claude Code, Codex, pi, oh-my-pi or OpenClaw in Orca, each in its own worktree with a task brief. It first checks that Orca is installed; if it isn't, the agent says so and starts nothing. When Orca is installed on this PC, creating or opening a project turns it on for the whole project, so every agent in it has it.

Agents read a skill's extra files with `read_skill`. They can search long reference files instead of reading them whole, or read them in parts. `read_skill` also tells them the skill's folder, so an agent with a shell can run the scripts that come with it; where a Hermes skill names Hermes's own folder for it, that is pointed at the skill in the library.

## MEMORY.md: what agents remember

Every agent, and the Brain, keeps a **MEMORY.md** for each project: short notes it carries from one chat to the next, such as how you like things done, decisions you made and mistakes to avoid. It reads them with every message.

- **Agents add to it as they learn**, with the memory tools every agent has. With **Ask first** autonomy you approve each change.
- **The Brain keeps its own** and can add a note to an agent's memory when you ask it to ("Tell the Writer to remember we use British spelling"). It never rewrites an agent's memory, and the self-improvement review can't change any memory.
- **Read and change it yourself.** Open an agent's editor or its chat page and use **MEMORY.md**. For the Brain, use the page icon at the top of the Brain chat, or **Settings → The Brain's model**. **History** shows earlier versions, who changed them and can restore one.

A chat's **Clear memory** button is different: it starts that chat fresh and leaves MEMORY.md alone (pressed while the agent answers, the answer it is writing is forgotten too). Don't keep keys or passwords in a memory.

## The voxel world

The Station can be a voxel world the Brain and your agents build around themselves: a diorama, a miniature scene you look at, not a game level anyone walks through (agents are told so, so nobody plans routes or playtests). Builders work big to small: the shape of the terrain first, then the buildings, then the props. The classic dark map stays the default: turn the world on in **Settings › Look › Station look** (Voxel world) and pick a quality (Low for older computers; High adds softer creases).

- **Ask the Brain for one.** Describe the world you want. The Brain asks a few questions (theme, mood, era, colours), writes **WORLD.md**, builds the big pieces itself and hands the details to a builder. The **World Builder** (Agent library › Blacksite) comes ready with the **Voxel world** tools and the **Voxel building** skill; you can give the tools to any agent in its editor.
- **WORLD.md** says what the world is: its theme and meaning, look, feel, places, characters, story and rules. Every builder reads it before building and updates it as they go. You can edit it too. Earlier versions are kept.
- **Nothing comes ready-made.** Builders make big pieces (ground, buildings, rivers) as objects, and the small things there are many of (people, trees, lamps, cars, boats) as **prefabs**: made once, then placed many times, scattered, along a street or in a grid, turned to any angle and recoloured per copy. Hundreds of copies cost the page very little. A builder can turn part of an object into a prefab, and share a good prefab with every project through the **prefab library**.
- **Agents build near their team.** Builds pinned to a team move with it when you drag its platform. One build call changes at most 250,000 voxels and places 2,000 copies; a world holds up to 4 million voxels and 20,000 copies, and one object or prefab can show at most 20,000 copies, counting copies inside copies.
- **Light, weather and life.** Glowing voxels (lanterns, windows, signs, headlights) light up what is around them. Builders can also put up lights (a doorway's warm spill, a spotlight, a flickering fire), set the time of day, sky, fog, weather and wind, and add particles in an area: petals, leaves, snow, rain, fireflies, embers, sparks, smoke, steam, mist, dust, birds. Finishing touches put snow on every ledge the sky can see, moss and vines on old walls, and wear near the ground.
- **Agents take a form in the world.** An agent can be dressed in a voxel form of its own: a person, an animal, a tree, a lamp, anything a builder makes, with a desk if it wants one. Builders design its animations themselves (keys per part: an arm that types, a crown that sways, a crystal that spins) and pick which plays while the agent is idle, working or waiting for you; they can also play one once, like a cheer when work is done. Team platforms and the Brain can be dressed too. For the sake of the picture, a builder can also take an agent, a platform or the Brain off the map (and their name labels): they keep working, and the side panel and Agents page still open them. Dressing yourself or your own team needs no OK; anyone else, or the Brain, asks you first.
- **Voxel size** is per object and can change in the middle of a build: coarse for ground, fine for small props and characters. Builders give sizes and positions in map units (the same numbers `world_info` and the team's plans use), whatever the voxel size; `world_steps` lists every build step there is. For anything repetitive or procedural (a lane of cottages that each differ, trees that branch, terrain from noise), `world_script` lets a builder write a small JavaScript program instead. It runs sealed off from your computer (no files, no network, at most 20 seconds) and builds through the same steps, so the same limits, undo and all-or-nothing apply.
- **The World panel.** The globe button above the zoom buttons (voxel look only) opens it: **WORLD.md** (read, edit, history and restore), **Built** (objects by builder with Hide and Delete, prefabs and where they are used, recent changes and *Undo the last change*), **Look** (time of day, weather, glow, miniature blur, lights and effects, and who is off the map, with *Show on the map*), and **World** (below). The project menu's **Voxel world…** opens the world picker in any look.
- **Builders look at their work.** `world_look` gives an agent a picture of the whole world or one thing in it, from any angle, made by an open Station page in the voxel look. When the Station is in the classic look, the agent asks you first: **Turn on the voxel look** in Needs you switches it (only you can answer that; the Brain's approvals don't). Without a picture it gets a map in words, and is told why so it can ask you. You can also ask the Brain to turn the voxel look on or off. `world_info` tells builders where every team platform and desk stands, with the same numbers the Station draws. New builds rise into place, with a beam from the builder's desk.
- **Files in and out.** Builders can bring in MagicaVoxel `.vox` models (as prefabs or objects) and save an object, a prefab or the whole world as a `.glb` 3D model (for Blender, game engines, the web) or a `.vox` file. The World panel has the same exports and a **Save a picture** button; all of them go to **Artifacts** and the project folder's `exports/`. Good prefabs can be shared with every project through the **prefab library** (World panel › Built › Library).
- **Undo.** An agent can undo its own last change (`world_undo`). Changing or deleting what someone else built asks you first (unless the agent's autonomy is Full).
- **One world per project, and it carries over.** A project with nothing built yet shows the world you marked as the default, or else the most recently built one. In the World panel's **World** tab you can share another project's world (both build in it), start from a copy, start a new empty one, go back to carry-over, mark the default, rename a world, and delete one no project uses. Its first change (a build, a move, the weather) gives it its own copy, so the other project's world stays as it was; a change that fails or finds nothing to do leaves it carrying over. The world goes into the project's folder (`.dashboard/world/`) and into backups; a restored backup, a clone or the same folder opened as a second project gets its own copy (unless it was shared).

## Routines: work worth repeating

Create a routine, write the instructions, and **@mention** the agents or teams that should do the work and the skills they should use. Run it when needed or set a schedule. Each run records what its agents and teams did.

For example, with those agents and skills already created:

> @Researcher finds the week's main product updates. @Content Team turns them into a short report using @Brand voice.

## The Brain and your teams

When the Brain hands work to a team, it writes in the team chat as **Brain**, so the work goes out even when no browser tab is open. Work for a single agent starts a new chat with that agent.

**Who answers in a team chat.** Agents you **@mention** answer. Otherwise: the agent whose message you replied to; else the only member with what the message needs (Blender, Maya, Houdini, Substance 3D, CAD and 3D printing, NVIDIA, ComfyUI, Adobe, FFmpeg, posting on X or Reddit, Orca, or one of its MCP servers such as GitHub); else the team's lead; else the member who fits best. Agents see who has what in the team roster and hand such work to that member.

**How long a team keeps going.** Agents keep handing work to each other until the work is done or you press **Stop**. There is no limit on turns. Only chatter pauses a team: when 8 replies in a row are only talk (no tool used, a short reply), like two agents passing the work back and forth, the team stops and says so. Reply, mention someone or use `/resume` to keep going.

- **A team gets the tools its work needs.** Agents from the Agent library's Agency only get the tools their job title suggests, so the Brain gives the team the rest: **Social** when it posts or messages anywhere (X, Reddit, Telegram, Discord; posts wait in the Outbox for your OK), the voxel world tools when it builds the world, and the image, 3D or video tools for that work. A team whose name or goal mentions posting or the voxel world gets them even if the Brain forgets; if you take a tool away from a team, it stays away. Every agent can hand in finished results to **Artifacts**.
- **Ask the Brain from a team chat.** Anyone in a team chat, an agent or you, can write **@Brain** to ask a question or say they're stuck. The Brain answers in the thread and may pass work to a teammate. An agent's request can't make it change agents, teams, skills, routines or settings: when the team needs something only you can give, such as an account, a teammate or a decision, the Brain tells you in Brain chat.
- **Teams ask each other.** In a team chat, an agent or you can write **#Team Name** (type **#** to pick one) to ask another team in the same project. The message goes to that team's chat, marked with the team it came from and who asked, and is answered there like a message from you. Once that team is done, its last reply comes back to the team that asked, to the agent that asked, who carries on. When you write it, nobody on your own team starts unless you also @mention them. A team asks other teams at most 4 times per message you send, and teams asking teams stops 3 deep. If the team you asked is stopped, the team that asked is told.
- **The Brain follows up.** When the team goes quiet or the agent finishes, the Brain checks the result. If something is missing, it asks for it, twice at most. When the work is done, stuck or needs you, it says so in Brain chat. Turn this off with **The Brain follows up** under **Settings → The Brain's model**.

## Models, effort and stopping work from Brain chat

- **Switch models and effort.** "Put the video team on Opus at high effort" changes one agent, several agents or every agent on a team. The Brain checks model names against the provider's list before it changes anything.
- **Look up models.** "Which Gemini models are on OpenRouter?" lists matching models with prices and context size. Ask "which model is each agent on?" to see every agent's model and effort.
- **Stop work.** "Stop the Writer", "stop the video team" or "stop everything" stops an agent, a team, or everything running in the open project: teams, agents, routines and workflows.

The Brain changes models or stops work only when you ask.

## MCP servers from Brain chat

The Brain can set up MCP servers and decide who gets them, the same as **Settings → MCP servers**.

- **Add one.** "Add the Playwright browser and give it to the Researcher." The Brain prefers the ready-made servers and the ones it finds in your Claude Code or Claude Desktop settings. For any other server, give it the exact command or link: "Add the weather server: `npx -y @acme/weather-mcp`". Ready-made servers that need a key (Brave Search, Firecrawl, ElevenLabs, Tripo, Meshy, Sketchfab, Unsplash, Pixabay, Pexels, Topaz, OOMOL, Composio) are added with the key you type in the chat: "Add Brave search, my key is …". The Brain asks for it if you leave it out, and tells you any setup step outside the dashboard (the ones that control an open program, such as Unity, Maya, Houdini, Substance 3D Painter, GIMP, Krita, Audacity, REAPER, MuseScore, OBS, FreeCAD and Rhino, need something turned on or installed in that program). The services' own servers need no key at all: Notion, Linear, Jira and Confluence, developer services (GitLab, Sentry, Vercel, Netlify, Cloudflare, Supabase…), Canva, Freepik and the others open a browser window to sign in the first time they run. A second account of one of these signs in on its own. The docs, search and travel ones (DeepWiki, Microsoft and AWS docs, Wolfram|Alpha, Kiwi.com flights, trivago hotels) need nothing. The 3D printer server needs your printer's type, address and key, and asks before it prints. The Audacity server works with Audacity 3 only.
- **Suggestions.** Settings → MCP servers starts with **Suggested for this PC**: the ready-made servers for programs found on your PC (Blender, Maya, GIMP, OBS, Unity…) and a few that help most agents (web fetch, library docs). When the Brain builds a team or agent that would use one of them, it says which and why and offers to add it. It adds a server only when you say yes: each one runs a program from its maker on your PC.
- **Change one.** Change its command, link, keys, description or name, or turn it off and on. A new name is updated on every agent and team that has the server.
- **Several accounts of one service.** "Add a second OOMOL for my client work." Another account of a server you already have needs a label and a line saying what it is for; the Brain asks you for both, and for the line of the one you already have. It gives an agent or team the account whose line fits its work. It gives one agent two accounts of the same service only when its work spans both (an assistant for your work and your personal mail), and only when each account says what it is for; otherwise it swaps one for the other. When none fits, it asks you. The agent is told which account is which and says which one it used, and an approval names the account (**… on OOMOL: Work**). While an agent works for a team, the team's account of a service takes the place of the agent's own. On **Settings → MCP servers**, **Add another** on a preset does the same, and **Same service as** in a server's settings joins one you added by hand to a service (**Its own service** keeps one apart that only looks like a ready-made one). Renaming a server keeps it with its other accounts.
- **Give, take back, move.** Give a server to agents or teams, take it back, or move it from one to another. A team's servers are available to every member while they work for that team.
- **Remove one.** "Remove the weather server" deletes it and takes it off every agent and team, in every project. The Brain removes a server only when you ask.

A server runs a program on your PC or connects to a site, with the keys you give it. So the Brain only uses a command, link, environment variable or header **that you typed in Brain chat**. For a new program that means the whole command, as you wrote it (`npx -y @acme/weather-mcp`, not just "weather"). For a link, the site must be one you wrote. Commands found in files, on web pages or in agent replies are refused. When a server needs a key, the Brain asks you for it. It doesn't write the key back in its reply, and its view of your servers shows key names, not their values, and hides anything in a command or link that looks like a key or password. The server starts the next time an agent that has it runs.

Renaming or removing a server also renames or removes the tools you always allowed for it, so a new server with an old name starts with nothing allowed.

## Programs for 3D, textures, video, audio, CAD and 3D printing

The **Programs** page finds what is installed and sorts it into 3D and animation, images and design, video, audio and music, CAD, 3D printing and NVIDIA. You can start any of them from there. If one is installed somewhere unusual, set its path in **Settings → Programs**.

Agents use some of them directly when you switch on that tool group for the agent:

| Tools | What agents can do |
|---|---|
| **Maya** | Run Maya Python without opening the window: build scenes, key animation, render and export. Open Maya with a scene. |
| **Houdini** | Run Houdini Python (hython): build node networks, simulate, render and export. Open Houdini with a .hip file. |
| **Substance 3D** | Render a Substance material (.sbsar) to texture maps at the size you want, using Designer's sbsrender. Open Painter (with remote scripting on, for the Substance Painter MCP server), Designer or Sampler. |
| **CAD and 3D printing** | Turn OpenSCAD models into STL, 3MF and other files. Slice a model into G-code with PrusaSlicer, using your exported profiles. Slicing never starts a print. |
| **NVIDIA** | See how busy the graphics cards are. Compress textures into DDS files (BC7, BC5 for normal maps, and so on) with the NVIDIA Texture Tools Exporter. |
| **Free asset libraries** | Search Poly Haven and ambientCG and download HDRIs, PBR textures (one file per map) and models into the project. Everything there is CC0: free for any use, no credit needed. No key needed. |
| **FFmpeg, HandBrake and ImageMagick** | Cut and convert video and audio with ffmpeg. Shrink or convert videos with HandBrake presets (needs the free HandBrakeCLI download). Resize, convert and batch-edit images with ImageMagick. |

Running Maya or Houdini Python, ffmpeg or ImageMagick counts as running code or overwriting files, so you are asked first unless autonomy is Full. The texture, asset, OpenSCAD, slicing and HandBrake tools only read and write in the agent's workspace and the folders you allow.

For live control of an open program, add its MCP server, for example Maya, Houdini, Substance 3D Painter, GIMP, Krita, Audacity, REAPER, OBS, FreeCAD, Rhino or your 3D printer. Each one says what to turn on in the program first.

Some sites and programs can't be connected because they have no API or MCP server: Envato Elements, ArtStation, 1001 Fonts, Poliigon and Luminar Neo. Mesh2Motion works in the browser at mesh2motion.org; the Programs page finds its desktop app.

## Long chats

The dashboard compacts older messages so long conversations fit the model's context window. The original messages stay visible to you.

By default, compaction starts at **50%** of the context window and keeps up to the **latest 10 messages** in full, within the size budget. Change these settings under **Settings → General & keys → Chat memory**.

- **Instant compaction** is on by default. It shortens the original text, reduces tool calls to one line and omits tool results without making a model call. Agents can use `recall_history` to retrieve the full entries.
- Turn instant compaction off to have the Brain's model write a summary instead.
- Open a **COMPACTED** marker to see what the agent remembers; you can edit the latest one. Use **Compact** or `/compact` to compact by hand, or `/compact summary` to request a summary.
- Claude Code, Codex, Hermes, pi, oh-my-pi and OpenClaw compact their own sessions when nearly full, so by default the dashboard compacts their chats only when you ask, or when one says the chat is too long. Turn off **Let Claude Code, Codex… compact on their own** to have the dashboard compact them at the threshold too. API-model agents are always compacted by the dashboard.

The amount retained scales with the context window. Set **Context window** if a model's reported size is wrong.

Very long chats still scroll smoothly: from 50 messages on, the chat page and the floating window only draw the messages near what you see, so the floating window can show the whole chat too. Because of this, your browser's Find (Ctrl+F) only finds text in the messages near where you have scrolled.

## Your Claude and Codex usage limits

- **See them in the sidebar.** Click **Limits** above the list at the bottom of the menu (or pick **Usage limits** under **Settings → Look → Sidebar**). In place of what's set up, it shows how much of your Claude and Codex plans you have used in each window (5 hours, the week) and when each starts again. It reads them again every minute. **Status** brings the list back.
- **And at the top right of the Station.** The same numbers as **SESSION** and **WEEK** meters, taking turns every few seconds between Claude, Codex and OpenRouter (credits left) for each one you're signed in to.
- **Free Codex resets.** When OpenAI has given your Codex account free limit resets, point at **Codex** in the sidebar: a card beside it says how many you have and when the next one runs out. **Reset now** asks first, then uses the one that runs out first and sets your Codex limits back to 0%. If you haven't used any of your limit yet, Codex keeps the reset.
- **Where the numbers come from.** Claude's come from Anthropic with your Claude Code login; Codex's from the Codex program on this PC (`codex app-server`) with your Codex login. Nothing else is sent anywhere.

## Approvals and safety

### Choose how much agents may do

| Autonomy | When dashboard tools ask for permission |
|---|---|
| **Ask first** | For low- and high-risk actions. Tools marked as having no risk run without asking. |
| **Auto** (default) | For high-risk actions, such as shell commands, scripts and sending messages. |
| **Full** | Tool approvals are skipped. Use only when you trust the agent and its access. |

Agents can't fetch the dashboard's own pages, so a web page can't lead them to your settings. The Tools & MCP page shows saved keys as dots; leave the dots when you edit a server to keep its key.

For API-model agents, an MCP server's tool counts as low risk only when the server says it just reads; any other one asks on **Auto** too. A server you turn off isn't started for them.

An explicit **Always allow** choice can also skip later approval requests for that tool, from that moment on in the same run too. Autonomy is not an operating-system sandbox: shell commands and external tools can act with the access of the account running them.

**The Brain approves** is on by default. When an agent or team requests permission, the Brain reviews it first. It is instructed to allow routine, reversible work within the task and pass risky or unclear requests to **Needs you**, with a reason. This is a model's judgment, not a hard safety guarantee. Turn it off under **Settings → General & keys → The Brain's model** if you want requests to come to you directly.

Workflow checkpoints and approval requests from outside MCP clients always come to you. X and Reddit drafts wait in the Outbox unless you enable auto-post for that account. **X direct messages always wait for your approval.**

**Questions from agents.** When an agent needs you to decide something, needs something only you can give (a login, a file, an OK) or is stuck, it asks with its `ask_user` tool instead of only writing the question in its reply. The question goes to the top of the **Outbox** and into the **Needs you** drawer, with its choices as buttons and a box for an answer in your own words in both; whatever you write goes along with a choice you click. While the agent waits, the same card shows under its tool call in the chat, so you can answer there too. The agent waits up to 30 minutes (4 for Hermes). If you answer later, your answer goes to its chat as a new message, or to its team chat addressed to it, so it picks up where it stopped. **Dismiss** closes a question without an answer, and stopping the run closes its question.

### What “local” protects—and what it does not

- The server listens on **127.0.0.1** only. Host checks, custom headers for API changes and browser-origin checks help stop other websites from controlling it. X and Reddit sign-in callbacks are allowed back from those services.
- There is **no dashboard login**. Anyone with local access to the running service may be able to use it. Do not expose it through a public tunnel or reverse proxy.
- Stored API keys and account tokens are kept server-side, not sent to the browser or included in project exports. They are saved in local files; protect the machine and its data folder.
- Hosted models, MCP servers and connected services have their own access and data handling. Only enable tools, folders and accounts that an agent needs. Built-in file tools enforce allowed roots; this does not constrain arbitrary shell commands or outside tools.

## Save and restore

### Where work is stored

Local dashboard state lives under **`data/`**, which is git-ignored (the [desktop app](#desktop-app-notes) uses its own data folder): projects, agents, teams, chats, knowledge, MEMORY.md files, skills, presets, settings, the Outbox and activity. Keys are in `secrets.json`; account tokens are in `accounts.json`.

The dashboard also auto-saves project state into **`<project folder>/.dashboard`**, including its agents, teams, routines, chats, MEMORY.md files, assigned or routine-mentioned skills and earlier versions. Opening that folder as a project brings the saved state back. Existing library skills are not overwritten: a different copy from the project folder is kept as a version.

These copies exclude stored keys and account tokens, **not private content you put in chats, knowledge files, memories or skills**. Review `.dashboard` before sharing or committing a project folder.

### Back up a project

Choose **Project menu → Back up this project**. The dashboard writes a `.dashbackup` file under **`Blacksite Backups`** in your home folder.

A backup includes the project's agents, teams, routines, layout, Brain and agent/team chats, knowledge files, MEMORY.md files, logo, the teams' pictures and 3D models, `PROJECT.md` and notes, and its voxel world (with WORLD.md and its prefabs). It also includes **every skill and saved preset in your library, and every prefab in the prefab library**, plus earlier versions of the project's agents, teams and memories and of library skills, including deleted items. It does not include stored keys or account tokens.

Backups are not a full copy of your working folder: back up source files, uploads and generated work separately. Size limits also apply: 300 MB of voxel world, 200 MB of agent chats, 100 MB each of prefab library and team pictures and models, 50 MB each of knowledge files, skills and earlier versions, and 20 MB each of MEMORY.md files and of project brief and notes. A restore adds the library prefabs this computer doesn't have yet and leaves the ones it has as they are. Files that do not fit are left out; the saved-backup message reports the number omitted.

### Restore a backup

Choose **New project → From backup**, then drop in a `.dashbackup` file or choose one from the backups folder.

- Restore creates a new project; it does not replace the original.
- Missing skills and presets are added. If a skill has the same ID but different contents, your existing skill stays and the restored copy gets an `-restored` suffix. Matching skills receive the backup's earlier versions.
- Scheduled teams and routines return **paused**, so the restored copy does not run the same work twice. Re-enable the schedules you want.
- Agent chats come back with what was said, but a Claude Code, Codex, Hermes or OpenClaw chat starts a new session from that history: the copy never carries on in the original's conversation.
- A `BRAIN.md` already in the folder you restore into stays as it is.

### Undo changes

Open **History** in a skill editor, agent editor, team panel or MEMORY.md to compare an earlier version with the current one and restore it. Restoring also keeps the current version, so you can undo the restore.

The dashboard keeps the last **50 versions** per item and groups nearby edits. **Recently deleted** on the Skills and Agents pages can bring deleted items back, including a skill's extra files. Agent and team history is also saved with the project's `.dashboard` copy.

## Troubleshooting

- **Bun is not found:** install it from [bun.sh](https://bun.sh), then open a new terminal. The Windows launcher also checks Bun's default install location.
- **The desktop app says it could not start:** it shows where the server's log is (`server.log`; the one before is `server.old.log`). Choose **Try again**, or check the log for the error.
- **The page does not open:** visit http://localhost:4800 directly and check the server terminal for errors. Use the port you selected if you changed it.
- **Browser changes are missing:** rebuild with `bun run build` and reload, or use `bun run dev` while editing. Direct server startup only builds when the bundle is missing.
- **The fans spin up, the battery drains, or the Station stutters:** lower **Settings → Look → Station quality**. **Balanced** (the default) draws 60 frames a second while you move around the map, 30 when nothing moves, and fewer when the window is in the back. **Battery saver** draws at most 30, a little softer, and leaves desk screens still until you zoom in. Other pages don't draw the map at all. Many agents working at once mostly use memory: each Claude Code agent that is working runs its own program, a few hundred MB each.
- **An agent cannot run:** check its selected engine in Settings, its login or API key, and whether a local model server is running. For missing Hermes dashboard tools, add the MCP bridge as described in [Giving engine CLIs the dashboard tools](#giving-engine-clis-the-dashboard-tools).

## Development

Building, testing and packaging the dashboard is in the [README](../README.md#development).

## License and credits

Both are in the [README](../README.md#license).
