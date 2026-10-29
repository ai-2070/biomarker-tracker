# CLAUDE.md

Working name: **Biomarker Tracker** (rename later).

A free, open-source, local-first web app where anyone can track their bloodwork over years, understand it in plain language, see their biological age, and explore what research says about each marker. No account, no cloud backend. Users' health data stays on their device unless they ask the assistant, which sends it to the AI model they chose (EU/US zero-data-retention providers or a local model).

---

## Core principles (never violate these)

1. **Local-first.** All user data stays on the user's computer. With the local server (`server/`, 127.0.0.1 only) each person is a **profile folder** on disk (see "Profiles"); without it (a static copy of the app) there is one profile in the browser (IndexedDB). No cloud backend, no database server, no user accounts.
2. **No telemetry.** No analytics, no tracking pixels, no error reporting services, no third-party scripts beyond what is listed in this file.
3. **Allowed network calls only:**
   - Europe PMC REST API (research search, open-access full text)
   - NCBI E-utilities / PubMed (research search, backup)
   - ClinicalTrials.gov API v2 (ongoing trials)
   - The AI provider the user configured themselves: EU/US providers with zero data retention (Anthropic, OpenAI, Mistral, or an OpenAI-compatible endpoint whose region the user states), OpenRouter with zero-retention routing forced on every request, or a local model (Ollama, LM Studio). Called by the local server, never by the page.
   - Agent programs the user installed and signed into (Claude Code, Codex, Hermes, OpenClaw). The app can't check what their login keeps, so they are labelled "depends on your login" everywhere they appear (the user's decision, 2026-10-28).
   - OpenRouter's public model lists (`/api/v1/models`, `/api/v1/endpoints/zdr`) to show only models with zero-retention endpoints.
   - MCP servers the user switched on in Settings (medical/nutrition only, see `src/core/mcpPresets.ts`); each preset lists what it sends.
   - Nothing else. Any new endpoint must be added to this list in a PR with justification.
4. **Code does the math, the model does the explaining.** Unit conversion, trends, reference-range checks, and scores (PhenoAge) are computed in tested TypeScript. The LLM never computes numbers that are shown as facts.
5. **Every claim needs a source.** Knowledge base entries must include citations. AI answers may only cite papers that were retrieved and passed in context; the app verifies every cited ID against the retrieved set and strips or flags anything else.
6. **Explain, don't prescribe.** The app shows what markers mean, what is known to affect them, and the evidence strength. It never diagnoses, never tells a user to start/stop a medication, and never gives a personal dose. Anything clearly out of range shows "discuss with your doctor."
7. **Works without AI.** Tracking, charts, PhenoAge, and the knowledge base must be fully usable with no model configured. AI is an optional layer.
8. **Honest about what is unknown.** Biology is mostly unmapped (nutritional dark matter, unidentified metabolites, unnamed signaling molecules). The app shows what is measured and what the evidence says, labels the gaps, and never presents a prediction as a simulation of the body.
9. **Usable by non-technical people.** Plain language, large touch targets, no jargon without an explanation, works on a phone.

---

## Tech stack

- **Vite + React + TypeScript** (strict mode)
- **tesseract.js** for on-device text recognition of photos and scans (files bundled, see "Lab PDF import")
- **Dexie** (IndexedDB wrapper) for storage
- **Recharts** for charts
- **pdf.js** (`pdfjs-dist`) for extracting text from lab PDFs
- **Vitest** for tests
- **Deployment:** static build to GitHub Pages. No server code anywhere in the repo.

Keep dependencies minimal. Prefer writing 30 lines over adding a package.

---

## Repo structure

```
/src
  /app            # React UI: pages, components
  /core           # Pure TypeScript, no React, fully unit-tested
    units.ts      # unit conversion per biomarker
    trends.ts     # change over time, rate of change, out-of-range flags
    phenoage.ts   # biological age calculation
    importers/    # lab PDF parsers, CSV import, manual entry validation
  /db             # Dexie schema and queries
  /research       # Europe PMC / PubMed / ClinicalTrials clients
  /ai             # provider adapters + context builder + citation verifier
/knowledge
  /biomarkers     # one JSON file per biomarker (see schema below)
  /evidence       # graded claims, e.g. "omega-3 -> triglycerides"
  /nutrients      # vitamins and minerals (Supplementation), one JSON file each
/tests
```

Everything in `/core` must be pure functions with tests. UI never does math directly.

---

## Data model

```ts
// Shipped with the app, in /knowledge/biomarkers/*.json
interface BiomarkerDef {
  id: string;                 // "ferritin", "hba1c", "crp_hs"
  name: string;
  abbreviation?: string;      // "HbA1c"; shown with the full name once
  category: string;           // "Blood count", "Lipids", ... (see src/core/types.ts)
  aliases: string[];          // names labs use: "Ferritin", "Ferritin (S)", "Ferritin szérum"
  loinc?: string[];
  canonicalUnit: string;      // all values stored in this unit
  conversions: Record<string, number | { factor: number; offset: number }>; // unit -> canonical; offset form needed for HbA1c mmol/mol
  defaultRanges?: { low?: number; high?: number; sex?: "m" | "f"; fasted?: boolean; ageFrom?: number; ageTo?: number }[]; // canonical unit; lab range wins; ages at the date measured
  judgeAverageOfDays?: number; // sleep: the range is checked against this many days' average (`flagLatest`), single readings only when critical
  personalRange?: boolean;    // HRV: no population range; the person's own usual range instead (`personalRange.ts`)
  criticalRange?: { low?: number; high?: number }; // beyond this: urgent "contact a doctor" banner
  rangeNote?: string;         // e.g. "fasting sample"
  summary: string;            // plain language, 1–3 sentences
  high: { meaning: string; commonCauses: string[] };
  low:  { meaning: string; commonCauses: string[] };
  affectedBy: EvidenceRef[];  // links to /knowledge/evidence entries
  sources: Citation[];        // required, at least one
}

// Stored in IndexedDB
interface Measurement {
  id: string;
  biomarkerId: string;
  value: number;              // in canonical unit
  originalValue: number;
  originalUnit: string;
  qualifier?: "<" | ">";      // lab printed "<0.1" (e.g. below detection limit)
  date: string;               // ISO date of sample
  lab?: string;
  labRange?: { low?: number; high?: number };
  fasted?: boolean;
  source: "manual" | "pdf" | "csv";
  note?: string;
}

interface ProtocolEntry {      // supplements, diet changes, meds the user logs
  id: string;
  label: string;              // "Creatine 5 g"
  category: "supplement" | "diet" | "medication" | "lifestyle";
  start: string;
  end?: string;
}

interface EvidenceClaim {      // /knowledge/evidence/*.json
  id: string;
  intervention: string;       // "omega-3 (EPA+DHA)"
  outcome: string;            // "triglycerides"
  direction: "increase" | "decrease" | "no effect" | "mixed";
  grade: "high" | "moderate" | "low" | "very low";
  whyThisGrade: string[];     // "mostly small trials", "industry funded", ...
  studies: Citation[];
}

interface Citation {
  pmid?: string;
  doi?: string;
  title: string;
  year: number;
  studyType: "meta-analysis" | "rct" | "observational" | "animal" | "in vitro" | "review" | "guideline";
  n?: number;
}
```

---

## PhenoAge (Levine et al., 2018)

Inputs (convert to these exact units first):
albumin (g/L), creatinine (µmol/L), glucose (mmol/L), CRP (mg/dL, natural log), lymphocyte (%), MCV (fL), RDW (%), alkaline phosphatase (U/L), WBC (10³/µL), chronological age (years).

```
xb = -19.907
     - 0.0336  * albumin
     + 0.0095  * creatinine
     + 0.1953  * glucose
     + 0.0954  * ln(CRP)
     - 0.0120  * lymphocyte_pct
     + 0.0268  * MCV
     + 0.3306  * RDW
     + 0.00188 * ALP
     + 0.0554  * WBC
     + 0.0804  * age

gamma = 0.0076927
M = 1 - exp( -exp(xb) * (exp(120 * gamma) - 1) / gamma )
PhenoAge = 141.50225 + ln( -0.00553 * ln(1 - M) ) / 0.090165
```

- **Verified 2026-10-28** (see header of `src/core/phenoage.ts`): weights match the paper's Table 1 (PMC5940111) and BioAge R (`phenoage_calc`, `orig = TRUE`). Tests use pyaging's R-computed reference values (log hazard −12/−9/−6 → 9.375/42.647/75.920 years) and a transcription of BioAge as an oracle. Do **not** use biolearn as a reference: its RDW weight is 0.3356 (typo).
- Implementation uses the algebraically equal stable form `141.50225 + (xb + ln(0.00553·(e^{120γ}−1)/γ)) / 0.090165`, which stays finite when M rounds to 1.
- Age comes from birth **month and year** only (`Profile.birthMonth`, "YYYY-MM", mid-month assumed). Not shown under age 20 (model trained on adults).
- Only compute when all 9 markers come from the **same blood draw**.
- Guard CRP ≤ 0 (lab "<0.1" values): use the detection limit and mark the result as approximate.
- Show it as an estimate with a short explanation, never as a verdict.

---

## Heart age (Framingham, body data)

- `src/core/heartAge.ts` (tested): Framingham general CVD risk, office-based model with BMI (D'Agostino 2008, PMID 18212285); coefficients from the Framingham Heart Study's site and its `gencardio_bmi.xls` (checked 2026-10-29). Heart age = the age at which normal risk factors (systolic 125 untreated, BMI 22.5, non-smoker, no diabetes, the calculator's reference values) give the same 10-year risk; closed form. Tests use the calculator's own example (woman, 30, normal factors → risk 0.010801167676829593, heart age 30).
- Inputs: sex, age from birth month, systolic = average of readings in the 30 days up to the latest, BMI from latest weight and height, smoking from the profile; blood pressure treatment and diabetes from the profile's conditions or active medicines in Habits (shown with where they came from). Only ages 30–74. Shown on the Biological age page (with the predicted 10-year risk, inputs and limits; a risk of 20 % or more suggests discussing it with a doctor) and as a figure on the Body page.

## Fitness age (VO₂max, body data)

- `vo2max` is a body measurement (mL/kg/min; imported from Apple, Garmin, Fitbit, Oura and other exports, or typed in). `src/core/fitnessAge.ts` (tested): mean VO₂max of healthy adults by sex and age group from the HUNT 3 Fitness Study (Loe et al., PLoS One 2013, PMID 23691196, Table 2, open access; values copied, not estimated). Fitness age = the age at which they averaged the same VO₂max, group means at mid-group ages (25…75) joined linearly; above the youngest or below the oldest group it says "25 or younger" / "75 or older" instead of extrapolating. The Nes 2011/2014 non-exercise formulas were not used: not open access and corrected in 2020.
- Brain's `get_body_summary` tool (`src/core/bodySummary.ts`, tested) gives the app's own BMI, waist-to-height, basal metabolic rate, heart age with 10-year risk, fitness age, and recent averages, so the model reports them instead of calculating.

## Fitness tests (age-related, body data)

- Seven tests in `/knowledge/fitness/<id>.json` (`FitnessTestDef`, validated by `validateFitnessTest`, tested in `tests/knowledge/fitness.test.ts`), each also a Body marker with the same id: `pushups`, `grip_strength`, `sit_to_stand_5x` (lower is better), `chair_stand_30s`, `one_leg_stand`, `gait_speed`, `sitting_rising`. Each file has the how-to, safety, limits, graded evidence with verified citations, norm tables and cut-offs. Written 2026-10-29 from research agents' drafts (`scratchpad` builders), every value copied from its source; grades not yet reviewed by a clinician.
- Norms: grip Dodds 2014 (Britain, best of either hand, exact-age rows: the nearest tabulated age is used, `rowSpan`); walking speed NIH Toolbox 4 m (US, mean ± SD); five chair rises SHARE (Europe 50+) and pooled Asian cohorts (20+), performance-ranked percentiles turned into value percentiles; 30-s chair stand Poland (60+) and Colombia (18–80, middle percentiles only); one-leg stand Iran (right leg, 60 s limit) and the British 1946 cohort (30 s limit; results capped at a study's `ceiling`); push-ups CSEP (book table read from an authorised reprint; men from the toes, women from the knees); sit-and-rise Brito 2014's four score groups (51–80, from the abstract). **Not used:** the user's Blueprint push-up chart (source untraceable, women's numbers converted from knee push-ups) and Blueprint's sit-and-rise grid (read off an image); PURE grip (a different way of measuring).
- Core (`src/core/fitnessTests.ts`, tested): `normRow`, `placeInRow`, `placeResult` (only norms for the test's way of doing it, `defaultVariant`), `cutoffsMet` (EWGSOP2 grip and walking speed, Dodds weak grip, five rises over 15 s, one-leg under 10 s at 51–75), `describePlace` (percentiles said so that higher is better, also for timed tests), `fitnessSummary` (Brain's `get_body_summary`), and Bryan Johnson-style comparisons kept honest: `ageMatch` ("typical of women about 45": the age whose median or average equals the result, only after the table's best age, ages joined by straight lines, `youngest` when the best is the table's first row, never past an open "and over" group) and `placeAmongYoungest` (place among the youngest group, e.g. 20–29). No combined score across tests (different tables, methods and evidence; no validated weighting) and nothing finer than the tables' last percentile (no "top 1%").
- UI (`components/dashboard/fitness.tsx`, `components/NormChart.tsx`): Body page group "Strength, balance and walking" (figures with the place for age), each test's page "For your age" (`?section=for-your-age`: place per norm table, cut-offs as a notice to mention to a doctor, the norms drawn across age with the person's results as dots and the copied table with their row marked, how-to, safety, limits, evidence), "Tests for your age" on the Biological age page, a section in the body entry form. The example profile does the tests every 8 months.
- Waist-to-height has its own figure and panel (see Body measurements); BMI and resting metabolic rate open a window with the sum worked through.

## AI layer (local server, v0.9)

One assistant, no teams or multi-agent setups. Model choice, Skills and MCP settings work like Blacksite's, limited to medical and nutrition use.

- **Local server** (`server/`, `bun run server` / `bun run start`): node:http on `127.0.0.1:4820`. Checks the Host header; changes need the `x-bt: 1` header and are refused from other sites. Settings in `data/settings.json`, keys in `data/secrets.json` (mode 600, never returned to the page, never in backups). `data/` is gitignored. In dev, Vite proxies `/api` to it.
- **Models** (`src/core/aiProviders.ts`, `server/models.ts`): Vercel AI SDK. `canUse()` allows local models on localhost, cloud providers with a key, an EU/US region and zero data retention confirmed by the user, and OpenRouter with a key (`server/openrouter.ts` adds `provider: { zdr: true, data_collection: "deny" }` to every request body). OpenAI uses Chat Completions with `store: false`. Errors are described in plain words, with keys redacted.
- **Choosing a model** (`src/core/aiProviders.ts`): providers are listed agent programs first, then API-key providers, then local models (`group`). The default, until something is saved, is Claude Code with `opus` (`DEFAULT_CHOICE`, `currentChoice()` on the server). Model lists were checked 2026-10-28; OpenRouter, Ollama, LM Studio and Hermes profiles / OpenClaw agents are loaded live. **Effort** (`low`…`max`, only the levels each provider lists in `efforts`): Claude Code `--effort`, Codex `model_reasoning_effort`, Hermes `--reasoning`, OpenClaw `--thinking`, Anthropic `effort`, OpenAI and Mistral `reasoningEffort`, OpenRouter `reasoning.effort`.
- **Installing agent programs**: each has `install` (the maker's official Windows and macOS/Linux commands, sign-in command, docs). The Install and Sign in buttons open a visible terminal (`server/terminal.ts`) running only those fixed commands; nothing is installed silently. `which()` also reads the current PATH from the Windows registry and the installers' usual folders, so a fresh install is found without restarting.
- **Agent programs** (`server/agents.ts`): one process per question in an empty temp folder, with the conversation as text. Claude Code: `-p --output-format stream-json`, `--system-prompt-file`, `--tools ""`, `--strict-mcp-config`, only `mcp__bt` allowed. Codex: `exec --json --sandbox read-only`, bridge token via `bearer_token_env_var`. Hermes: `chat --query-file - --format stream-json`; gets the app's tools only after the user presses Connect (runs `hermes mcp add biomarker-tracker --url …?token=…`). OpenClaw: `agent --json --message-file`, no bridge, so it gets a data summary (`dataPack`) and its citations are marked as uncheckable. Time limit 10 minutes.
- **Bridge** (`server/bridge.ts`): the app's tools as an MCP server over HTTP at `/mcp` (stateless Streamable HTTP). Each question opens a run with a random 32-byte token that dies when the answer is done; Hermes uses a stable token (`secrets.bridgeToken`) that only works while a Hermes run is active. `/mcp` skips the `x-bt` check but needs the token and the Host check. Tool calls are recorded as steps, and study IDs come from their results, so citations are verified the same way for agents.
- **Assistant** (`server/assistant.ts`, `server/healthTools.ts`): the page sends a snapshot of measurements, log, experiments and profile with each question; the server turns birth month into age and never passes birth month to the model. Tools: get_results, get_marker, get_levers, get_biological_age, get_log, compare_before_after, search_research (Europe PMC), get_study (one study by PMID/PMCID/DOI from Europe PMC, with its abstract; used by the "Summarize with Brain" button on each paper in a marker's research results, which sends the question once a model is ready, and isn't shown next to a critical result), read_skill, propose_habit (a habit card the person edits and confirms in the chat; never a medicine, never an amount (`DOSE`), at most 5 watched markers, not next to a critical result; checked by `parseHabitProposal` in `src/core/habitProposal.ts` on the server and again in the page, which builds the card from the tool step, `habitTurns` in `brain/store.ts`; nothing is saved until the person presses Add to Habits), plus tools from enabled MCP servers (`server__tool`). get_log returns the person's Habits (with watched markers) and Brain calls them habits. All numbers come from `/core`. Max 10 steps.
- **System rules:** cite only studies returned by tools, by ID; state evidence strength; say "not enough evidence" when true; no diagnosis; no personal dosing; suggest a doctor for out-of-range or fast-changing values. Critical values: tell the user to contact a doctor first and don't interpret them. Safety notes from the log make the model avoid nutrient-increase suggestions.
- **Citation verifier:** study IDs are collected from tool results (`studyIdsIn`); `CitedAnswer` checks every cited ID with `src/ai/citations.ts`. Unknown IDs are struck through, author-year references flagged.
- **Skills** (`skills/<id>/SKILL.md`, custom ones in `data/skills/`): name + description front matter; the model sees the index and loads one with read_skill. Bundled skills must keep the doctor/no-dosing rule (a test checks).
- **MCP** (`src/core/mcpPresets.ts`, `server/mcp.ts`): stdio servers via `npx -y package@pinned-version`, minimal environment, secrets kept with the server. Only medical/nutrition presets. On first start all presets are added (`ensureDefaultServers`, once; removed ones stay removed), switched on when `npx` exists and no key is required, and started in the background (`warmUp`). A question waits at most 45 s per server. The ~150 server tools are not sent to the model: it gets `research_tools` (list one server's tools) and `use_research_tool` (call one), plus a list of servers in the system prompt. Study IDs from `read_skill` and `research_tools` output never count.
- `connect-src` in `vite.config.ts` lists only `'self'`, Europe PMC and NCBI; the page never talks to a model directly. Old browser-stored keys are deleted on start (`forgetBrowserAiKey`).

---

## App shell and Dashboard

- **Shell** (`src/app/components/AppShell.tsx`): left sidebar on large screens (profile switcher, grouped nav: Dashboard; Health: Blood tests, Body, Biological age; Tools: Habits, Protocols, Meals, Intake analyzer; Knowledge: Supplementation; Connect: Devices *Soon*; then Add data and Settings). Below `lg`: top bar (logo, add, profile) and bottom tabs (Dashboard, Blood, Habits, Brain, More sheet). Setup and profile choice use `PlainShell`.
- **Width**: every page uses the dashboard width (`max-w-7xl`). Text stays at a readable measure (`max-w-3xl`); the extra room holds side columns on `lg`: nutrient pages a sticky column (your result, EU values for a day, trial counts, jump links), marker pages the results list beside the explanation, protocol pages start/checks/share beside the day, the food comparison its at-a-glance table beside the claims. Phones stack as before.
- **Add data** (`#/add`, `pages/AddResult.tsx`): import a lab report or device files, or type values in with a switch between one blood test result and a day of body measurements (`BodyEntryForm`, the same form as the Body page). `#/add?type=body` opens the body side; `#/body?add=1` and every "Add measurements" link go there.
- **Brain** (`src/app/brain/`): the assistant in a window at the bottom of every page (there is no separate Ask page; `#/assistant?ask=…` opens Brain over the dashboard). Large screens have an "Ask Brain" pill; smaller ones the Brain tab, where it opens full screen. Space opens it when focus isn't on a field, button or link and no dialog or menu is open; Ctrl/⌘+K toggles; Esc closes (rules in `logic.ts`, tested). Motion: on large screens the pill grows into the window and the window folds back into it (a `clip-path`, so text never stretches; content fades out first); smaller screens slide it up and down. The window stays mounted until its closing animation ends. The conversation lives in `store.ts` (outside React, so it survives page changes, not reloads). The composer has the model menu (usable providers only, effort, "set up more" → Settings) and the skills / research sources menu (switches save right away). With no usable model it shows "Set up a model first", and sending goes to Settings → AI models. **Files** (paperclip, drop, paste): read on this computer with the import code (`components/LabReview.tsx`). If lab results are found they become a review card in the chat (check, fix, save; the report is kept in the profile folder) and their text is never sent. Other documents are sent as text with the question, with the profile name replaced by `[name]` (`redactName`) and shortened to fit (`questionWithFiles`). Health app screenshots (`src/core/importers/screenshot.ts`, tested) become a body-values review card the same way (date set to today, with a note to check it). **Photos** are sent to the model only when the person ticks "Send the photo itself" on that photo, and only to API-key or local models (agent programs are refused, in the page and on the server): shrunk to 1568 px and re-encoded as JPEG in the browser (`brain/photo.ts`, which drops EXIF location data), at most 4, only with the newest message (`photos()` in `server/http.ts`). The system prompt forbids estimating weight, body fat, BMI, muscle mass or age from a photo, and judging skin, moles or wounds.
- **Three dashboards**, real numbers only, no composite scores. Shared parts in `src/app/components/dashboard/widgets.tsx` (figures, marker grid, habits and Brain panels) and `dashboard/body.tsx` (body figures, summary, entry form).
  - **Main** (`#/`, `pages/HomePage.tsx`): the two combined. Biological age, to watch (blood and body), blood pressure, weight; the timeline; a Blood tests card and a Body card (each opens its dashboard); Habits; Ask Brain.
  - **Body** (`#/body`, `pages/BodyPage.tsx`; "Add measurements" opens Add data, the form shows on the page itself only while it's empty): weight, BMI, waist (with waist-to-height), blood pressure, resting heart rate; tiles per measurement; notes on what the numbers can't say.
  - **Blood tests** (`#/blood`, `pages/DashboardPage.tsx`, blood results only via `bloodOnly`). Figures: biological age (with its history), markers in range, markers to watch, next re-test or last test. The timeline (`dashboard/Timeline.tsx`) draws every blood test (amber/red when something was out of range), biological age against calendar age, and the log as bars; hovering, focusing or tapping a test shows what was off. Look around with range buttons (6M/1Y/2Y/5Y/All), zoom buttons, dragging (horizontal only, so vertical page scroll still works on touch), Ctrl+wheel zoom, sideways wheel/trackpad, and keys (arrows, +/-, 0); window maths in `src/core/timeWindow.ts` (tested), shared controls in `components/timeControls.tsx` (`useTimeView`, `TimeControls`). Then marker tiles with range-band sparklines, Habits (ongoing ones, and what changed), Ask Brain. Data comes from `buildDashboard()` in `src/core/dashboard.ts` (tested). The results list moved to `#/results` (Blood tests), with an All / Out of range / In range filter on each marker's latest result (`?show=out|in`; the To watch figure links to `?show=out`).
- **Marker pages**: "What is…" and "Search research" start open (the research search only runs when the person presses Search); what affects the marker opens by itself when the result is out of range.
- **Marker charts** (`components/TrendChart.tsx`, every marker page): the same look-around controls as the timeline (plus 1M/3M, down to 14 days), except that dragging across a chart **selects a period** (`drag: "select"` in `useTimeView`; `SelectionBar` shows readings, average, first to last and the change, with "Zoom to this period"; Enter zooms, Esc clears) and an **overview strip** (`Overview`, shown when zoomed) moves the view (drag its window, or tap to jump, `centerWindow`). The Ages chart works the same way; "Show" each reading or weekly / monthly averages when they combine readings (`src/core/chartSeries.ts`, tested: `groupReadings`, `groupingsFor`, `statsBetween`, `pointsForWindow`; averages are flagged against the range, never against a usual range), toggles for the range band, "Fit to my values" (vertical scale without the range) and habits; choosing a habit under the chart shades its period. An "In view" line gives count, average, lowest and highest. Choices are remembered per marker in the browser (`chart:<id>`). "No range" badges aren't shown.
- **Ages chart** (`dashboard/AgesChart.tsx`, top of Biological age): PhenoAge, heart age and fitness age over time with calendar age dashed (`src/core/ageHistory.ts`, tested: heart age on each blood pressure day from what was known that day; fitness age at each VO₂max). Own colours (`--color-age-*`, validated as a categorical set in light and dark) and marker shapes, labels at line ends, series toggles, "Ages" or "Difference from your age", a table view. **No combined age**: the three estimate different things, so an average would mean nothing (recommended 2026-10-29).
- **Body measurements** are markers in the category `Body` (`knowledge/biomarkers/weight|waist|body_fat|bp_systolic|bp_diastolic|resting_hr|heart_rate|exercise_hr|hrv|hrv_resting|spo2|glucose_home.json`; heart rate, exercise heart rate, HRV and resting HRV (RMSSD, not Apple's SDNN), blood oxygen and sleep (`sleep_duration`, `sleep_deep`, `sleep_rem`, in hours, one value per night dated by the morning you woke up; readings on a day add up, naps included; company sleep scores are never imported; single nights aren't flagged: `judgeAverageOfDays: 7` checks the 7–9 h range (7–8 from 65, NSF/AASM) against the week's average via `flagLatest`, and the figure leads with that average) are meant to come from devices as daily values, and can be typed in until then; HRV has no population range: it shows the person's **usual range** (`src/core/personalRange.ts`, tested: mean ± 1 SD of the log values in the 60 days before the last week, at least 14 readings; last week's geometric mean is within, below or above it; Plews 2013, Buchheit 2014), which is never a medical flag; SpO₂ below 95 is low, below 90 critical. The Body page groups them (`BODY_GROUPS`: size and composition, heart and oxygen, blood sugar) with figures, and tiles only for what has no figure), cited and checked against Europe PMC). They are stored as `Measurement`s, so charts, ranges, habits, backups and Brain work for them; `BLOOD_MARKERS` / `bloodOnly` keep them out of the blood results list, the blood dashboard and lab report reading. On the main dashboard's timeline, days with body measurements are small squares on their own row (amber or red when something was out of range); no second value scale. **Home blood glucose** (`glucose_home`) is separate from the lab's fasting glucose: the entry form asks when (fasting / after a meal / other, stored as `fasted` true / false / unset), and ranges can carry `fasted` so the right one applies (3.9–5.5 fasting, below 7.8 after a meal, below 11 otherwise; below 3.0 or above 22.2 is critical). **Resting metabolic rate** (often called basal metabolic rate; `bmrMifflin`, the paper's simplified Mifflin–St Jeor form by sex, PMID 2305711, checked against its abstract; Frankenfield 2005, PMID 15883556) is computed from the latest weight, height, age at that date and sex; shown as an estimate (about ±10 %), never as a target or an intake. Its figure opens a window with the sum worked through with the person's numbers (`bmrMifflinTerms`), a note outside the equation's ages (19–78), sources, and links to the weight chart and Settings. With a body-fat reading within 30 days of the weight it also shows Cunningham 1980 (`rmrCunningham`, 500 + 22 × lean mass, PMID 7435418) beside it, not instead: body fat isn't more accurate for most people (Mifflin's own fat-free-mass equation R² 0.64 vs 0.71; athletes' meta-analysis PMID 37632665 found no reliably best equation). BMI and waist-to-height are computed in `src/core/body.ts` (tested), never stored; waist-to-height has its own Body figure and a panel on the Waist page (`dashboard/waistToHeight.tsx`): the person's ratio at every waist measurement drawn on Ashwell's ranges (below 0.4 / 0.4–0.5 / 0.5–0.6 / 0.6+, `waistToHeightBand`), and the years of life lost from Ashwell et al. 2014 (PLoS One, PMID 25198730) Table 3 copied exactly (`WHTR_YEARS_LOST`: British non-smokers, ages 30/50/70, ratios 0.5/0.6/0.7/0.8+; the nearest age row, the person's ratio marked between columns, nothing interpolated); BMI is shown without a range or label (it can't tell muscle from fat; the user's decision, 2026-10-29), never with a target. Body fat has age- and sex-banded ranges (Gallagher 2000), no range under 20 or from 80. Deep and REM sleep have no range (wearables misjudge stages). Entry: one day at a time (`validateBodyEntry`: both blood pressure numbers, top above bottom, typo limits). Blood pressure uses ESC 2024 limits (high above 139/89; 180/120 shows the contact-a-doctor banner). The example profile has two years of monthly body measurements. `#/soon/body` opens Body.
- **Import from a device** (`#/body/import`, `pages/DeviceImportPage.tsx`, `src/core/importers/deviceFiles.ts`, tested with synthetic files): export files from Apple Health (`export.xml`, read in pieces with a per-day tally, so gigabyte files work), Fitbit and Google Fit (Takeout), Samsung Health, Garmin (account export or Connect reports), Oura, Whoop, Withings, Polar, Zepp/Amazfit and Huawei Health, and any CSV or JSON with recognisable column names. People choose files, the export's zip (`src/core/importers/zipRead.ts`: central directory read from the end, entries streamed through `DecompressionStream`, zip64 supported) or the unzipped folder. JSON becomes a table (`jsonTable`: nested fields flattened, lists of records exploded); long tables (a name column and a value column, Huawei) are pivoted (`pivotLong`); vague column names are read with the file's name as context (`fileFamily`); daily files of one kind are joined into one series. Sleep: `sleepColumn` recognises total, deep and REM (light only to add up a total when a file has none, `withSleepTotal`), units from the header or the size of the numbers (`sleepUnit`), the wake-up date when the file has one (`sleepDateColumn`); Apple's sleep stages are summed per night and kept apart per device. One table's reading is shared by the page and the tests (`readTable`). Brand formats are tested with synthetic files shaped like each export (`tests/core/deviceBrands.test.ts`), not real exports. Columns are recognised by name (`guessColumn`); minimum, maximum, zone and count columns are skipped, and so is Apple's SDNN HRV (not RMSSD). Readings become one value per day (the average), impossible readings are dropped and counted. A review screen shows every series (can be remapped or unticked), what was skipped and why, overlapping series, and days already saved (never duplicated). Saved with `source: "device"` and a note naming the file and column. Read on this computer only; the files aren't kept.
- **Devices** is a "Soon" page (`#/soon/devices`) for automatic sync from the phone; until then, device data comes in through the import. Devices = an Android companion app reading Health Connect and syncing to this computer over the local network.
- Product brief for design work: `PRODUCT.md`; dashboard direction contract: `.impeccable/surfaces/`.

## Protocols

- **Protocols** (`#/protocols`, `#/protocols/<id>`; `pages/PlansPage.tsx`, `pages/PlanPage.tsx`; sidebar Health, after Habits): named sets of things a person follows (a supplement stack, a diet, exercise, sleep, medicines), written by them or loaded from a shared file. In code they are **plans** (`src/core/plans.ts`, tested), because "protocols" already names the Habits log; on disk `protocols.json` in the profile folder (Dexie table `plans`, schema v3; synced, backed up, restored and validated with `validatePlan` like the rest).
- Item: name, the person's own amount (free text, never set by the app), type (supplement / diet / medication / lifestyle), time of day (`PLAN_TIMES`: morning, midday, evening, bedtime, any time), **with a meal** (`withFood`, a checkbox beside the time, the user's request) and **days of the week** (`days`, none = every day; `daysLabel`: "Mon, Wed, Fri", "Weekdays"), shared form fields in `components/PlanWhen.tsx`; old "with meals" items read as any time + with a meal (`normalizeItem`), note, and optionally one of the person's saved meals (`mealId`: the Add item form fills the item in from it with `mealNote`, and the item links to the meal; local only, dropped when shared). The page shows the day as a schedule, links supplements to Supplementation (`nutrientFor`, by name or other name, a form number allowed: "Vitamin D3"), warns about items that interact with each other (`pairWarnings`, from the nutrients' interactions) and with the person's medicines or conditions (`interactionsFor` with `safetyNotes` of habits, profile and the items).
- **Start** turns each item into a habit (`habitsForPlan`: name plus amount) from a chosen date (`startPlan`); **stop** ends them today, or removes ones that hadn't begun (`stopPlan`). Watches are added on those habits in Habits.
- **Add to a protocol** from any supplement page (`components/AddToProtocol.tsx`: protocol or a new one, name, own amount, when), next to **Start as a habit** (Habits with the name, type supplement and the nutrient's status marker picked to watch).
- **Share**: `planToFile` (items only: no ids, dates, habits or results) and `planFromFile` (new ids, validated). No built-in named protocols (they would mean suggesting doses).
- Brain: `get_protocols` (with linked nutrients and interactions between items; amounts are the person's own, never changed or suggested); OpenClaw's data summary lists them. `propose_protocol` writes down a protocol from the person's own text (a pasted routine) as a chat card they create (`planFromProposal`, checked on the server and again in the page; items, times, amounts and conditions copied exactly, nothing added; not next to a critical result); it opens on the protocol's page.
- The example profile has two: "My daily routine" and "Standard Routine" (a larger supplement routine the user gave, no amounts, some items only if deficient), which shows the interaction warnings.

## Meals

- **Meals** (`#/meals`, `#/meals/<id>`, `#/meals/example/<id>`; `pages/MealsPage.tsx`, `pages/MealPage.tsx`; sidebar Health, after Protocols): build a meal from foods and grams and see what the food table measured in it. Stored as `meals.json` in the profile folder (Dexie table `meals`, schema v4; synced, backed up, restored, validated with `validateMeal`).
- **Food data**: `knowledge/foods/cofid-all.json`, every CoFID 2021 food (2,887) with ~30 nutrients per 100 g (energy, protein, fat, saturated fat, carbohydrate, sugars, fibre, sodium, 9 minerals, 12 vitamins incl. retinol, EPA+DHA), compact rows, `null` = not measured. Built by `tools/cofid/build-all.mjs` from the CoFID spreadsheet (rows matched by position, because CoFID uses code 13-669 for two foods; the second is `13-669-2`). Loaded only when a meal page opens (`src/app/foodDb.ts`), a separate ~450 KB chunk. The curated `cofid-foods.json` (levers) stays as it is; a test checks both agree.
- **Maths** in `src/core/meals.ts` (tested): `searchFoods`, `mealTotals` (amount and how many foods had it measured: shown as "measured in 3 of 5 foods"; unmeasured never counts as zero), `saltFromSodium` (× 2.5), `adultReference` (EFSA intake for the person's sex and age from the nutrients knowledge base: calcium by age, iron before/after menopause at 50, zinc at 600 mg phytate; nothing when it depends on sex and sex is unknown), `shareOfReference` (% of the day's reference; context, never a target), `coverage`, `mealSafetyBlock` (same per-portion SAFETY_LIMITS as levers).
- **No targets**: energy and macros are what the meal contains; no daily goal, no "too much", no deficit maths (CLAUDE.md safety rules). The intake analyzer compares a day's worth of food with EFSA values and resting energy use, still without goals (see Daily intake analyzer). Vitamins and minerals show a share of the EU reference intake for a whole day, with a note that a meal isn't meant to reach it and more isn't better.
- **Nutritional dark matter** (`components/DarkMatter.tsx`): a full explainer on the Meals page (the table's own coverage, counted from the file; >26,000 food chemicals vs ~150 tracked, Barabási 2019, DOI 10.1038/s43016-019-0005-1 checked via Crossref; FoodMine, PMID 33004889; beta-carotene food vs pill, from vitamin_a.json) and a short note under every meal's totals.
- **Example meals**: `knowledge/meals/examples.json` (7 meals, CoFID foods and grams, each tied to evidence claims; validated, and a test checks they contain what they illustrate). Shown "for your results" when a claim's marker is out of range in the claim's direction, hidden by `mealSafetyBlock` (e.g. spinach with blood thinners). Example foods must have the safety nutrient measured (mature spinach, not baby spinach, whose vitamin K isn't in the table).
- **Whole foods compared** (`components/FoodComparison.tsx`, `knowledge/food-comparison/{matrix,absorption,vitamins,safety}.json`, `src/core/foodComparison.ts`, tested): the user's four headings (the animal matrix, absorption, vitamins, safety: animal foods and fruit vs other plant foods; fibre, phytate, oxalate, heavy metals, B vitamins, amino acids, plant compounds). Each claim stated as people make it, then a verdict (supported / partly supported / mixed / not supported / not enough evidence), a grade, what it favours, the other side, and sources verified against Europe PMC. No diet is recommended.
- **Use it** (meal page): "Start as a habit" and "Add to a protocol" (the shared `AddToProtocol` window with the meal linked and its note).
- **Brain**: `find_foods`, `propose_meal` (a recipe becomes a card with the app's totals that the person saves; cooked weights; the model never reports its own totals), `get_meals`; the system prompt mentions dark matter and keeps food and supplement evidence apart. A meal can be added to a protocol as a diet item.

## Daily intake analyzer

- **An analyzer, not a diary** (the user's decision, 2026-10-29: "I just wanted an analyzer"): `#/intake` (`pages/IntakePage.tsx`; sidebar Tools → Intake analyzer). One list of saved meals (with portions) and single foods (grams) from the full CoFID table, kept as the profile setting `intakeList` (saved to `settings.json` with the profile; `useIntakeList` / `setIntakeList`), with Clear and "Try an example day" (`EXAMPLE_DAY`, about 2,000 kcal). No dates, no history, no averages. (Dexie v5 briefly had an `intake` table of logged days; v6 drops it.)
- **Supplements** (the user's request): a third tab adds a supplement with the person's own amount from the label (`SUPPLEMENT_NUTRIENTS`: 15 vitamins and minerals plus omega-3, in EU label units; never suggested). Folic acid counts 1.7 × in DFE (EFSA: µg DFE = µg food folate + 1.7 × µg folic acid, checked in EFSA's report), vitamin A as retinol, omega-3 from mg. Upper limits that cover supplements only (magnesium 250 mg, folic acid 1,000 µg; `UL_FROM_SUPPLEMENTS`) are compared with the supplements alone and never limit food ideas. Supplements in the person's protocols are quick picks (`parseLabelAmount` fills the amount only when written plainly in the right unit).
- **To a protocol**: "Create a protocol from this" or "Add to protocol" (`intakeToPlanItems`: meals and foods as diet items, supplements as supplement items, amounts copied as entered).
- **Maths** in `src/core/intake.ts` (tested): `validateIntakeItems`, `expandItems`, `intakeTotals` (unmeasured never counts as zero; supplements added as one more source), `macroRows` and `nutrientRows` against EFSA values checked in EFSA's own summary report (DOI 10.2903/sp.efsa.2017.e15121, read 2026-10-29): protein PRI 0.83 g/kg (needs a weight), fibre AI 25 g, fat 20–35 % and carbohydrate 45–60 % of energy (food table factors 9 / 3.75 / 4 kcal per g), saturated fat and sugars "as low as possible" (sugars EFSA 2022), EPA+DHA AI 250 mg, sodium 2.0 g safe and adequate (EFSA 2019), vitamins and minerals via `adultReference`. Upper limits only where they cover food (`UL_FROM_FOOD`: not magnesium or folate; vitamin A against retinol).
- **Energy vs resting metabolic rate** (the user's decision): `energyVsResting` places the list's kcal against Mifflin–St Jeor and EFSA's activity levels (1.4 low active to 2.0 very active × resting, EFSA 2013). Below resting is stated plainly ("less than your body uses at rest; most adults use 1.4 to 2.0 times that; add anything missing"), with no doctor message (the user's decision: a list may not be a whole day); above 2.0 says "more than most adults use unless very active". Never a calorie goal, a deficit or "eat less".
- **What would add the most** (the user asked for meal and supplement advice): for the four nutrients furthest below the reference (the rest one tap away) and for protein, fibre and omega-3: foods with the most per example portion (`foodIdeas`/`gapAdvice`, the 21 curated foods' portions with full-table values) and the share after one portion; foods over the person's `SAFETY_LIMITS`, or whose one portion would go above an upper limit (`upperLimitRoom`: liver and vitamin A), are left out with the reason; nutrients the person's medicines or conditions interact with get "talk to your doctor" instead; meals with the most (`mealsRichIn`, own and example meals, safety-filtered); supplements only as a link to the nutrient's research page with the person's status blood result, never an amount.

## Supplementation (vitamins and minerals)

- A research-based knowledge base, not the person's data: its own sidebar group **Knowledge** (not Health), `#/supplements` (`?kind=vitamin|mineral`) and `#/supplements/<id>` (`pages/SupplementsPage.tsx`, `pages/NutrientPage.tsx`). On phones it is in the More sheet.
- **Search** (`searchNutrients` in `src/core/nutrients.ts`, tested): every word must start a word in the entry's name, other names, roles, foods, trial outcomes, interactions, signs, forms, cautions or summary ("B12" = "b 12", accents ignored). Name matches first; otherwise the card says where it matched ("Food: oily fish…"). The intro card hides while searching.
- One file per nutrient in `knowledge/nutrients/<id>.json` (`NutrientDef` in `src/core/nutrients.ts`, validated there; `tests/knowledge/nutrients.test.ts` checks every file): summary, roles, how status is measured (`status.biomarkerIds` link to markers; the page shows the latest result), signs of too little / too much and who runs low, food sources (`cofidNutrient` links to measured amounts in the CoFID table, with the safety filters), supplement forms, **findings** from supplement trials (outcome, population, effect helps / no clear effect / harms / mixed, grade with reasons, studies) and, apart, **foodFindings**, EFSA **reference intakes** (PRI/AI) and **tolerable upper intake level** (or why none), interactions (`safetyId` ties them to `safetyNotes()`; matching ones are shown at the top), cautions, linked `evidenceClaims`, sources.
- **Bottom lines**: every finding (and every food-comparison claim) has a `bottomLine`, one or two sentences (90-340 characters) written only from its summary, shown first on its card; the full summary, grade reasons and sources sit behind "Read the full summary, why this grade, and sources". Each list starts with an at-a-glance table (`components/glance.tsx`) linking to the cards. Tests require a bottom line on every entry. (The user asked for this instead of collapsing whole sections, which felt too short.)
- Rules: every finding cites studies verified against Europe PMC (title, year, DOI from the record); EFSA values copied from EFSA's documents with DOIs; never a personal dose (`PRESCRIBING` wording check in the test); reference values are labelled as population values, not targets. Written 2026-10-29 by research agents and checked by tests; grades and wording not yet reviewed by a clinician (shown on the pages).
- Brain: `get_nutrient` (server/healthTools.ts, `findNutrient` in server/knowledge.ts) returns the entry with citable study IDs; the system prompt keeps supplement and food findings apart and forbids turning EFSA values into a dose.
- The research panel is shared (`ResearchPanel` takes `name`, `terms`, `question`, optional `topic`; nutrient pages search with "supplementation").

## Profiles (folders)

- One folder per person in `data/profiles/<slug>-<4 hex>/`: `profile.json` (who: name, birth month, sex, height, diet, smoking, conditions, allergies, notes), `results.json`, `log.json`, `experiments.json`, `settings.json` (display settings), `files/` (scanned lab reports and documents, dated names, never overwritten), `files.json`, `README.txt`. Server: `server/profiles.ts`; backups are zips of the folder (`server/zip.ts`, no package), restored as a new profile with every file checked.
- The browser (Dexie) is a working copy of the open profile. `src/app/profiles.ts` loads a profile into it and saves every change back to the folder 0.5 s later (`liveQuery` over all tables); failed saves retry and show a banner. Switching saves, loads the other profile and reloads the page. `loadedProfile` in Dexie says which folder the copy belongs to; data with no folder is kept as its own profile on start, never dropped.
- First start, and every new profile, goes through the setup wizard (`SetupPage`: welcome, who, optional details, first results). The first screen also offers **Load a profile**: a backup .zip, or a profile folder chosen in the browser (`profilesInFolder` + `zipStore` in `src/core/zipStore.ts` pack it, the server restores it like a backup; a folder of several profiles loads them all). Loading never asks the setup questions. The header menu switches profiles; `#/profiles` opens, backs up, shows the folder of, or deletes profiles. Imported lab PDFs are kept in `files/`.
- **Example profile** (`src/core/demo.ts`, `demoProfile(today)`): made-up data for trying and showing the app, offered on the start screen ("Just looking?"), in the new-profile flow and on the Profiles page. Deterministic (seeded), dated relative to today, no critical values. Its stories are tested through the app's own code: low ferritin that recovers during an iron supplement, vitamin D that dips in winter until D3, PhenoAge for all 10 tests (one approximate CRP), and a diet experiment with two tests before and two after where LDL falls beyond test-to-test noise. `Profile.example` marks it; a banner says every result is made up.
- Name and private notes are never sent to an AI model (`assistantProfile()` in the page and again in `parseSnapshot`). Conditions written in the profile count for `safetyNotes()` via `safetyLabels()`.

---

## Lab PDF import

- Extract text with pdf.js, then match lines against biomarker `aliases`, parse value + unit + range.
- Always show a **review screen** before saving: the user confirms or fixes each parsed value. Never save silently.
- Parsers per lab/country live in `/src/core/importers/`, each with sample-text fixtures in tests. Never commit real patient PDFs; use synthetic or fully anonymized fixtures.
- Multiple languages matter (EU users). Aliases should include local names (German, Hungarian, etc.).
- Current implementation: `src/core/importers/pdfText.ts` rebuilds lines from pdf.js text positions; `labText.ts` is the generic parser (name → value → unit → range, sample date with birth-date lines excluded). Lab-specific parsers can be added next to it when a layout needs one. Fixtures: `tests/fixtures/lab-text/*.txt`.
- An alias must belong to exactly one marker (a test enforces this). Avoid aliases that are common words or that name a different test (e.g. "HbE", Hungarian "Vas").
- Rows whose printed unit doesn't fit the marker (e.g. absolute lymphocytes in G/l matched to "Lymphocytes %") are shown but unticked, never saved by default.
- **Photos and scanned PDFs** are read with on-device OCR (Tesseract via `tesseract.js`, `src/app/ocr.ts`): English, German and Hungarian, LSTM engine. The worker, engine and language files ship with the app at `ocr/` (`ocrAssets` in `vite.config.ts`), never from a CDN, and are loaded only when used. PDFs without a text layer are rendered page by page (max 6) and OCR'd. `normalizeOcrText` (`src/core/importers/ocrText.ts`) fixes typical mix-ups only next to digits (O/0, l/1, `x10"9/L` → `x10^9/L`, `G/I` → `G/l`). Results read this way have `source: "photo"`, and the review screen warns to check every value.
- `decimalProblem` in `labText.ts`: a value more than 8× above or below the lab's own range on the same line (a lost decimal comma, e.g. potassium "5,4" read as 54) is unticked with a note, for PDFs too. It never blocks saving after the person checks it.
- Known gap: no Adobe CMaps bundled (rare CJK-font PDFs may extract garbled text); OCR quality depends on the photo.

---

## Safety rules

- No calorie-restriction targets, weight-loss plans, or "eat less than X" outputs.
- When a user logs or asks about a condition that changes advice (kidney disease, anticoagulants, pregnancy, diabetes medication), show a prominent "talk to your doctor" note and avoid nutrient-increase suggestions for affected nutrients (e.g. potassium in kidney disease, vitamin K with warfarin). Detection lives in `safetyNotes()` in `src/core/protocols.ts` (keyword lists incl. brand names); later features that suggest nutrients (v0.7) must check it.
- Critical values (e.g. potassium, sodium, glucose far out of range) show an urgent "contact a doctor" banner, no AI commentary first.
- Footer and onboarding: "Not medical advice. Not a medical device."

---

## Milestones

1. **v0.1** Manual entry, measurement list, per-marker trend chart, out-of-range flags, export/import of all data as JSON (backup).
2. **v0.2** PhenoAge with tests and an explanation page.
3. **v0.3** Knowledge base for the ~30 most common markers (CBC, lipids, glucose/HbA1c, liver, kidney, thyroid, iron panel, vitamin D, B12, CRP).
4. **v0.4** Lab PDF import with review screen; first parsers.
5. **v0.5** Protocol log (supplements/diet/meds) overlaid on charts.
6. **v0.6** Research panel (Europe PMC/PubMed) per marker + optional AI Q&A with citation verification.
7. **v0.7** Nutrient-gap foods: map out-of-range markers to evidence-graded dietary levers and show food portions with exact nutrient amounts from food composition data (see "Nutrition" below).
8. **v0.8** N-of-1 experiments: baseline → change → re-measure, with noise-aware before/after comparison.

---

## Nutrition (planned, v0.7)

### The core limitation: nutritional dark matter
Food contains 26,000+ known biochemicals, but standard food databases track only ~150 nutrients (Barabási et al., Nature Food, 2019). Human blood metabolomics likewise detects thousands of signals that match no known molecule. We cannot model a food bottom-up from its molecules, and the app must never pretend it can.

### Design rules that follow from this
- **Whole food and isolated nutrient are different interventions.** "Eat strawberries" and "take vitamin C" get separate evidence claims and separate grades. Never infer a whole-food effect from a single-nutrient study, or the reverse. (Canonical warning case: beta-carotene-rich diets were associated with lower lung cancer risk, but beta-carotene supplements increased it in smokers — ATBC and CARET trials.)
- **Prefer whole-food evidence** (food-level RCTs, long-term cohorts) when it exists. Single-nutrient math is a fallback, not the default.
- **Label coverage honestly.** Anywhere nutrient totals are shown, include a short note: "Nutrient numbers cover ~150 measured compounds. Foods contain thousands more that aren't tracked."
- **Personal measurement beats prediction.** The app's answer to dark matter is empirical: log the food/diet change, measure markers before and after (bloodwork, CGM, wearables), and show what actually changed in this person. The body responds to every compound, named or not.

### Implementation (v0.7)
- **Food data:** `knowledge/foods/cofid-foods.json`, a curated extract of McCance & Widdowson's CoFID 2021 (UK, Open Government Licence). USDA was the first choice but `*.usda.gov` was unreachable when this was built; CoFID is an EU-region national table, which this file allows. Values are copied, never estimated: "Tr" → 0, "N"/missing → left out. Portions are labelled examples. To add foods, extend the generator's code list and re-extract from the CoFID spreadsheet; don't type values by hand.
- **Evidence claims:** `knowledge/evidence/*.json` (`EvidenceClaim` in `src/core/types.ts`). Each has a `lever`, `kind` (food / diet / supplement / habit; supplements may not list foods), the measured `outcome`, `grade` + `whyThisGrade` checked against the cited abstracts, and `markers` with `helpsWhen`. Biomarker `affectedBy` must mirror them (a test enforces it).
- **Safety:** `SAFETY_LIMITS` in `src/core/foods.ts` hides foods per portion (vitamin K ≥ 60 µg with blood thinners, potassium ≥ 300 mg with kidney disease, retinol ≥ 300 µg in pregnancy); `hideWhen` hides whole claims. Levers are not shown next to a critical value.
- Grades and wording are a first draft by the developer, not reviewed by a clinician yet.

### What the feature does
- Use a food composition database (e.g. USDA FoodData Central bulk download, or EU national tables) shipped as a static dataset. Portion math ("75 g strawberries ≈ X mg vitamin C") is computed, not generated, and is labeled as measured-nutrient-only.
- Recommendations are **levers with evidence grades**, not prescriptive meal plans: "Low ferritin → heme iron sources, vitamin C with meals, tea/coffee away from meals (grade: moderate)."
- Example meals are framed as examples that hit a nutrient amount, never as "the optimal meal for you."
- Every nutrition suggestion links to a "test it on yourself" flow: baseline measurement → change → follow-up measurement (see N-of-1 below).
- Respect the safety rules above.

### N-of-1 experiments (v0.8)
- User defines: change (e.g. "add 2 kiwis daily"), outcome markers, baseline period, intervention period.
- App reminds when to re-measure and shows before/after with the measurement noise for that marker (e.g. typical lab and biological variation), so users can tell a real change from noise.
- Results are framed as "what happened in you," never generalized as evidence for others.
- **Implementation:** `src/core/experiments.ts`. "Before" = results in the 120 days up to the start; "after" = results from start + re-test interval (to 30 days after an ended experiment). Several results per side are combined with a geometric mean. Noise band = log-normal reference change value: Z 1.96 · √(1/n1 + 1/n2) · σ, σ from CVI and CVA (Fraser 2011, PMID 21958344; Fokkema 2006, PMID 16873298). CVA is assumed to be 0.5 × CVI.
- **CVI data:** `biologicalVariation` in each biomarker file, from the EFLM Biological Variation Database API (`https://biologicalvariation.eu/api/meta_calculations`, retrieved 2026-10-28; median with CI and number of studies). No EFLM value for RDW-CV, lymphocyte %, neutrophil %, eGFR, transferrin saturation or any body measurement. For those, `personalBand` estimates normal variation from the person's own results when there are at least 3 before and 3 after: pooled spread of the log values, t value for the degrees of freedom (`t95`, wider for small samples), `bandFrom: "personal"` shown in the UI and to Brain. With fewer results the watch says "needs more results" rather than guess.
- Creating an experiment also creates a log entry; ending it ends that entry. Experiments are in backups (backup format version 2; version 1 files still restore).
- **Habits** (`#/habits`, `src/app/pages/HabitsPage.tsx`, `src/core/habits.ts`): the log and the experiments are one page. A habit is a log entry; it can **watch markers**, which is an experiment linked to it (`protocolId`), so "what changed" uses the same tested comparison. Habits may start up to a year ahead (planned). Marker suggestions come from words in the habit (`HABIT_HINTS`, mirroring the evidence levers plus a few medicines with a known lab effect); the person always picks. Nothing is compared automatically for every marker: with many markers, about 1 in 20 would look changed by chance. `chosenOn` records when markers were picked; picked after the "after" results existed → shown as "a hint, not a test" (`pickedAfterResults`). Editing or stopping a habit updates its watch (`saveHabit`); deleting removes both (`deleteHabit`). A new habit can start from the person's own words, **a meal** (fills name and diet type; `#/habits?meal=<id>`, the meal page's "Start as a habit") or **a protocol** ("Start protocol": `startPlan`, each item a habit from the chosen day). `#/log`, `#/experiments` and `#/experiments/new` open Habits; the detail page stays at `#/experiment/<id>`.

---

## Conventions

- TypeScript strict, no `any` in `/core`.
- Every function in `/core` has tests. Every knowledge entry has sources.
- Package manager is **Bun** (`bun install`, `bun add`). Don't use npm, and don't commit a `package-lock.json`.
- Small PRs. Run `bun run test` and `bun run build` before committing. After adding a knowledge file, delete `node_modules/.vitest-cache`: Vitest's file cache doesn't see new files matched by `import.meta.glob`. (`bun run test`, not `bun test`: the latter is Bun's own runner, not Vitest.)
- UI copy: plain language, short sentences, explain every abbreviation once.
- Accessibility: keyboard navigable, readable contrast, works at 360px width.
- Motion: short and calm (150–360 ms, `--ease-soft`), defined in `src/index.css` (`animate-enter`, `animate-enter-next/back`, `animate-fade`, `stagger`). Everything stops for `prefers-reduced-motion` (durations, delays, repeats); the chart checks it too.
