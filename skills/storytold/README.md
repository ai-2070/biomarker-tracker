# Storytold skills (bundled)

Skills for the [storytold Crafting Apps](https://github.com/storytold): thirteen free creative apps
(VectorCraft, PhotoCraft, FilmCraft, …), each with a desktop app, a CLI and an MCP server. There is one
skill per app, plus `storytold` (which app fits a task) and `storytold-install` (install the apps and
wire up their MCP servers).

Copied from [hermes-pro/storytold-skills](https://github.com/hermes-pro/storytold-skills) at commit
`f0e0495b8d333d58fb2f5be73ea520796256c907` (MIT, see `LICENSE`). The files are unchanged.

The dashboard adds each one to the skill library the first time it starts (`server/skills.ts`,
`ensureBuiltinSkills`). A skill the user deletes stays deleted. Each skill remembers where it came from, so
**Download again** on the Skills page brings it up to date from GitHub.

To update the copies here, replace these folders with the ones from a newer commit and change the commit above.
