# Subagent skills (bundled)

Skills for agents that hand work to other agents and check what comes back:

- `delegating-to-subagents`: splitting a task between agents, writing their briefs, sorting out shared
  files, and judging what they hand back
- `commissioning-a-reviewer`: asking another agent for an independent review, and using its verdict
- `independent-review`: being that reviewer: checking the claims, testing them yourself, and returning
  a verdict the implementer can act on
- `reviewed-stage-delivery`: running a plan stage by stage, with an agent in an Orca terminal writing
  the code and an independent reviewer checking each stage
- `witness-discipline`: writing tests that really prove what they claim, and not weakening them to pass

Copied from [ai-2070/subagent-skills](https://github.com/ai-2070/subagent-skills) at commit
`43b5b614bd708d51c42057f24b4fdf12957d15dd`. The files are unchanged. That repo has no license file.

`reviewed-stage-delivery` drives the implementing agent with the `orca` command line tool, so it needs
[Orca](https://github.com/stablyai/orca) (see the bundled `orca-cli` skill). The other four work with any agent.

Not included, because they only fit one repo or one agent tool: `net-mesh-development` and
`net-mesh-release` (the Net mesh repo), `working-in-omp` and `agent-irc` (agents running inside oh-my-pi),
and `gauntlet-loop` and `headless-gauntlet` (they start helpers with oh-my-pi's `task` tool). Also left out:
`skill-self-improvement`, which would answer the same requests as the dashboard's own Self-improvement
skill, and `protocol-spike`, `browser-harness-testing` and `workflow-capture`, which are narrower.

The repo is private. **Download again** reaches it with your GitHub login (`gh auth login` or
`GITHUB_TOKEN`); without access to the repo, the bundled copies still work but can't be updated.

The dashboard adds each one to the skill library the first time it starts (`server/skills.ts`,
`ensureBuiltinSkills`). A skill the user deletes stays deleted. Each skill remembers where it came from, so
**Download again** on the Skills page brings it up to date from GitHub.

To update the copies here, replace these folders with the ones from a newer commit and change the commit above.
