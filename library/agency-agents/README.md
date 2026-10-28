# The Agency (bundled)

The ready-made specialists in the Library's **The Agency** tab: 270+ agents (marketing, engineering,
design, game development, sales, security and more), one Markdown file each, in one folder per division.

Copied from [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) at commit
`b37b5bb33b78f2c1d6567d98e25ca818e3259219` (24 Oct 2026; MIT, see `LICENSE`). The files are unchanged.

Only the 18 divisions listed in `divisions.json` are here, with `divisions.json` and `LICENSE`. Left out: the
upstream `scripts/`, `integrations/` (converted copies for other tools), `examples/`, `strategy/` (playbooks, not
agents), `.github/` and its contributing and security notes.

The dashboard reads this folder directly (`server/library.ts`, `agencyAgents`), so The Agency works with no
download. Hiring an agent copies its text into a new agent; this folder is never changed by the app.

To update, replace the division folders, `divisions.json` and `LICENSE` with the ones from a newer commit and
change the commit above.
