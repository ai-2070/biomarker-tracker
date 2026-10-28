# Hermes skills (bundled)

A choice of skills from [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research, the
ones that fit any agent and work on Windows:

- **Coding:** `systematic-debugging`, `test-driven-development`, `spike`, `requesting-code-review`, `github`,
  `dogfood`, `ast-grep`, `grill-me`, `rest-graphql-debug`, `docker-management`, `jupyter-notebook`, `fastmcp`, `mcporter`
- **Documents and finance:** `pdf`, `docx`, `xlsx`, `powerpoint`, `excel-author`, `dcf-model`, `lbo-model`,
  `3-statement-model`, `comps-analysis`, `merger-model`
- **Research:** `arxiv`, `grounded-citations`, `llm-wiki`, `duckduckgo-search`, `rss-feeds`, `reddit-reading`,
  `youtube-content`, `maps`, `stocks`
- **Creative:** `humanizer`, `design-md`, `architecture-diagram`, `excalidraw`, `concept-diagrams`, `sketch`, `p5js`,
  `manim-video`, `pixel-art`, `hyperframes`, `comfyui`
- **Work:** `email-inbox-triage`, `himalaya`, `meeting-action-items`, `document-to-action-items`,
  `weekly-review-planning`, `one-three-one-rule`, `decision-questionnaire`, `obsidian`

Copied from [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) at commit
`80057598ae39567800b34ebd637f52cc83d11945` (MIT, see `LICENSE`). The files are unchanged. They keep the repo's
own folders (`skills/<category>/<skill>` and `optional-skills/<category>/<skill>`), so each one's path here is
its path there.

Hermes agents don't need these: Hermes brings its own skills. They are here for the other engines.

They are written for Hermes's tools: they say `terminal`, `read_file`, `patch` or `web_extract` where another
agent uses its own shell, file and web tools. Some run Python scripts that come with them and need the packages
they name. Where a skill writes out Hermes's folder for it (`~/.hermes/skills/<category>/<skill>`) or
`${HERMES_SKILL_DIR}`, `read_skill` points it at the skill's folder in the library instead.

Not included:

- the ones only for Hermes itself (`hermes-agent`, `honcho`, `hermes-s6-container-supervision`, `yuanbao`,
  `dynamic-workflow`, `subagent-driven-development`, `inspecting-hermes-desktop-dom`, `node-inspect-debugger`…)
- the Mac-only ones (`apple-notes`, `apple-reminders`, `findmy`, `imessage`) and the others that only run on
  Linux or macOS
- the machine-learning training and GPU ones (`mlops/*`)
- the ones that get around safety checks or site protections (`godmode`, `obliteratus`, `scrapling`)
- the ones the dashboard does itself (`claude-code`, `codex`, `opencode`), and `computer-use`, whose id the
  bundled Orca skill already has

The dashboard adds each one to the skill library the first time it starts (`server/skills.ts`,
`ensureBuiltinSkills`). A skill the user deletes stays deleted. Each skill remembers where it came from, so
**Download again** on the Skills page brings it up to date from GitHub.

To update the copies here, replace these folders with the ones from a newer commit and change the commit above.
