# OOMOL skills (bundled)

Skills for [OOMOL](https://oomol.com) and its `oo` command line tool. `oo` reaches your connected
accounts (mail, calendar, drive, chat, issue trackers…), OOMOL's hosted AI (OCR, translation, speech,
images) and Open Flow workflows. The other three help with skills: `oo-find-skills` finds and installs
published ones, `oo-create-skill` writes one, and `oo-publish-skill` publishes one.

Copied from [oomol-lab/oo-cli](https://github.com/oomol-lab/oo-cli) (`contrib/skills/shared`) at commit
`830d31358724f95ed9c08a22c178d9586c3cac89` (release v1.9.9; MIT, see `LICENSE`). The files are unchanged.

The skills need the `oo` command line tool, which is not part of the dashboard.

Not included: the roughly 1,000 skills in [oomol-lab/skills](https://github.com/oomol-lab/skills), one per
service (GitHub, Slack, Notion…). That is too many to ship. `oo-find-skills` finds and installs the ones you need.

One gap: `oo` tells agents to read `references/flow-authoring.md` and `references/flow-n8n-conversion.md`
before they work on Open Flow workflows. Those two files are not on GitHub (the oo-cli build makes them),
so they are not here, and **Download again** does not bring them either. The rest of `oo` works without them.

The dashboard adds each one to the skill library the first time it starts (`server/skills.ts`,
`ensureBuiltinSkills`). A skill the user deletes stays deleted. Each skill remembers where it came from, so
**Download again** on the Skills page brings it up to date from GitHub.

To update the copies here, replace these folders with the ones from a newer commit and change the commit above.
