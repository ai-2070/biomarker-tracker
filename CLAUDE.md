# CLAUDE.md

Working name: **Biomarker Tracker** (rename later).

A free, open-source desktop app (and local web app) where anyone can track their bloodwork over years, understand it in plain language, see their biological age, and **research it with teams of AI agents**: medical and nutrition research, evidence reviews, self-experiments. It is built on **Blacksite** (ai-2070/blacksite, MIT OR Apache-2.0, base commit `4186e43`): the live 3D Station (three.js), model engines, MCP servers, skills, the agent library and the Tauri desktop app all come from there.

**How to write code here:** read `AGENTS.md` (Blacksite's engineering guide: layout, code rules, security boundaries, tests, git). This file is about what the product must and must not do.

---

## Core principles (never violate these)

1. **Runs on the user's computer.** A local server (Bun, `127.0.0.1` only) and a browser page or the desktop app. Saved data lives in the data folder on that computer (`data/`, or the desktop app's own folder). No accounts, no cloud backend of our own.
2. **No telemetry.** No analytics, tracking or error-reporting services. Dependencies that phone home stay blocked (e.g. `@openuidev/lang-core`'s postinstall telemetry is left untrusted in `bun install`).
3. **AI only through EU/US zero-data-retention (ZDR) providers, or local models.** Owner decision (2026-10-28): research value matters more than keeping a biomarker private, so health data may go to agents' models, but only to providers that are in the EU or US and retain nothing. Local models (Ollama, LM Studio) always qualify. Any engine or provider that can't be configured for ZDR is off by default and clearly labelled. Enforced in code (see Rebuild plan, phase 4).
4. **Other network calls:** research sources (Europe PMC, PubMed/NCBI, ClinicalTrials.gov, food composition and biological variation databases) and MCP servers the user adds. Nothing sends health data anywhere except the user's own ZDR model provider.
5. **Code does the math, the model does the explaining.** Unit conversion, trends, reference ranges, PhenoAge, reference change values and nutrient amounts are computed in tested TypeScript (`shared/health/`), and agents get them through tools. The LLM never computes numbers that are shown as facts.
6. **Every claim needs a source.** Knowledge base entries include verified citations. AI answers may only cite papers that were retrieved; cited IDs are checked against the retrieved set (`shared/health/ai/citations.ts`) and unknown ones are flagged.
7. **Explain, don't prescribe.** Show what markers mean, what affects them and how strong the evidence is. Never diagnose, never tell someone to start/stop a medicine, never give a personal dose. Clearly out-of-range values say "discuss with your doctor".
8. **Works without AI.** Tracking, charts, PhenoAge, the knowledge base, levers and self-experiments work with no model set up. Agents are an optional layer on top.
9. **Honest about what is unknown.** Biology is mostly unmapped (nutritional dark matter, unidentified metabolites). Show what is measured and what the evidence says, label the gaps, never present a prediction as a simulation of the body.
10. **Usable by non-technical people.** Plain language, large touch targets, explain every abbreviation once.

---

## Where things are

| Path | What |
|---|---|
| `shared/health/` | The health core, pure TypeScript with tests: `types.ts` (data model), `units.ts`, `trends.ts`, `phenoage.ts`, `phenoageDraws.ts`, `experiments.ts` (reference change values), `evidence.ts`, `foods.ts`, `protocols.ts` (log + safety notes), `backup.ts`, `importers/` (manual entry, lab text, PDF lines), `research.ts` (Europe PMC / PubMed), `ai/` (context builder, citation checker) |
| `knowledge/biomarkers/` | One JSON file per marker (37), with verified sources and EFLM biological variation |
| `knowledge/evidence/` | Graded evidence claims (13) |
| `knowledge/foods/` | CoFID 2021 food composition extract |
| `tests/health/` | Tests for all of the above (Vitest project `health`) |
| `server/`, `web/`, `shared/` (rest), `src-tauri/`, `skills/`, `library/` | The Blacksite platform (see `AGENTS.md`) |
| `legacy/tracker-web/` | The previous static web app (v0.1–v0.8): UI pages still to be ported, and its old CLAUDE.md. Not built or tested; delete once everything is ported |

---

## Rebuild plan (branch `rebuild`)

1. **Base** (done): Blacksite brought in, renamed, own ports (4820 browser / 14820–14830 desktop), own folders (`Documents/Biomarker Tracker`, `Biomarker Tracker Backups`), never touches Blacksite's folders; health core and knowledge moved to `shared/health` and `knowledge/`, 279 tests passing.
2. **Health data and pages:** store measurements, log, experiments and profile server-side (`store.ts` collections); API; port the pages (results, marker detail with chart, add result, PDF import with review, log, self-experiments, biological age, levers, research) into the Blacksite UI; import old backup files.
3. **Agent tools:** health tools in `server/tools.ts` (read results and trends, PhenoAge, reference change values, evidence and foods, propose a result for the user to confirm); available to Claude Code and Codex through the MCP bridge; health on the Station.
4. **ZDR provider rule:** a provider registry with region and retention per provider; only EU/US ZDR providers and local models can be selected; CLI engines only in ZDR-capable modes.
5. **Research pack:** medical and nutrition agents (library), skills (evidence grading, citation checking, systematic search, lab interpretation, nutrition maths, N-of-1 design), MCP presets for research sources (only verified, maintained servers).
6. **Desktop and release:** own update-signing key (the updater currently points at this repo but still carries Blacksite's public key, so nothing installs until releases are signed with ours), CI, installers.

---

## Health knowledge rules (carried over from v0.1–v0.8)

### PhenoAge (Levine et al., 2018)
- Weights verified against Table 1 of the paper (PMC5940111) and BioAge R; tests use pyaging's R reference values. Do not use biolearn as a reference (RDW weight typo).
- Only computed when all 9 markers come from the same blood draw; age from birth month and year; not under 20; "<" values marked approximate. Shown as an estimate, never a verdict.

### Knowledge base
- Every marker and evidence entry has verified sources (checked against Europe PMC). An alias belongs to exactly one marker.
- Evidence claims: whole food, diet, supplement and habit are separate kinds; supplements never list foods; grades are checked against the cited abstracts. Grades and wording are a developer draft, not yet reviewed by a clinician.
- Food amounts come from CoFID 2021, copied exactly; unmeasured nutrients are left out, never guessed. Show "nutrient numbers cover ~150 measured compounds".
- Self-experiments: log-normal reference change value (Fraser 2011; Fokkema 2006) with EFLM within-subject variation and CVA = 0.5 × CVI. Results are "what happened in you", never evidence for others.

### Lab PDF import
- Always a review screen before saving. Parsers have synthetic fixtures only; never commit real patient PDFs (`.gitignore` blocks `*.pdf` outside fixtures).

## Safety rules
- No calorie-restriction targets, weight-loss plans, or "eat less than X".
- Blood thinners, diabetes medicines, pregnancy and kidney disease (`safetyNotes()` in `shared/health/protocols.ts`) show a prominent "talk to your doctor" note and hide nutrient-increase suggestions for affected nutrients. Agents must get the same rule.
- Critical values show an urgent "contact a doctor" banner, with no AI commentary first.
- Footer and onboarding: "Not medical advice. Not a medical device."
