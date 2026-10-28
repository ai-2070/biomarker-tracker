# Orca skills (bundled)

Skills for [Orca](https://github.com/stablyai/orca), the app for running coding agents side by side in
their own worktrees, and its `orca` command line tool:

- `orca-cli`: worktrees, terminals, repos, automations, artifacts, worktree comments and Orca's browser
- `orchestration`: several Orca agents working together (messages, handing out tasks, waiting on results)
- `computer-use`: clicking and typing in a visible app window when no command can do the job
- `orca-linear`, `orca-jira` and `jira-tickets`: reading and updating Linear and Jira tickets
- `orca-emulator` (iOS Simulator) and `orca-emulator-android` (Android over adb)
- `orca-per-workspace-env`: setting up a fresh sandbox, VM or container for each workspace

Copied from [stablyai/orca](https://github.com/stablyai/orca) (`skills`) at commit
`35af10ddeda665c8e3bb753f80679f7748be5dbf` (MIT, see `LICENSE`; the two emulator skills say Apache-2.0 in
their own header). The files are unchanged.

Each skill is short on purpose: it tells the agent to run `orca skills get <name>`, which prints the full
guide that matches the installed Orca. So the skills need Orca installed (and they start it if it isn't
running); Orca isn't part of the dashboard.

Not included: `linear-tickets`. Orca keeps it only as an old name for `orca-linear`, and two copies of the
same skill would both answer every Linear task.

The dashboard adds each one to the skill library the first time it starts (`server/skills.ts`,
`ensureBuiltinSkills`). A skill the user deletes stays deleted. Each skill remembers where it came from, so
**Download again** on the Skills page brings it up to date from GitHub.

To update the copies here, replace these folders with the ones from a newer commit and change the commit above.
