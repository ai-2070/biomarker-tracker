# Composio skill (bundled)

One skill for [Composio](https://composio.dev), which connects agents to more than 1,000 apps (Gmail,
Slack, GitHub, Notion…). It covers two jobs: using those apps straight from the `composio` command line
tool (search, connect an account, run an action), and building your own agents or apps with the Composio SDK.

Copied from [ComposioHQ/skills](https://github.com/ComposioHQ/skills) (`skills/composio`) at commit
`c4b270016aa8c832bb6d5824175da1bb94690b89` (MIT, see `LICENSE`). The files are unchanged.

GitHub now keeps that repo under `composio-community/skills` and sends `ComposioHQ/skills` there. The skill
keeps the `ComposioHQ` name, the one Composio's own README gives.

The skill tells an agent that has no `composio` tool yet to install it with `curl -fsSL https://composio.dev/install | bash`.
The dashboard's `run_command` tool rates shell commands as high risk, so its approval rules apply to that.

The dashboard adds it to the skill library the first time it starts (`server/skills.ts`,
`ensureBuiltinSkills`). A skill the user deletes stays deleted. It remembers where it came from, so
**Download again** on the Skills page brings it up to date from GitHub.

To update the copy here, replace the folder with the one from a newer commit and change the commit above.
