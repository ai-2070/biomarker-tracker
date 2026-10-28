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
  defaultRanges?: { low?: number; high?: number; sex?: "m" | "f" }[]; // canonical unit; lab range wins
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

## AI layer (local server, v0.9)

One assistant, no teams or multi-agent setups. Model choice, Skills and MCP settings work like Blacksite's, limited to medical and nutrition use.

- **Local server** (`server/`, `bun run server` / `bun run start`): node:http on `127.0.0.1:4820`. Checks the Host header; changes need the `x-bt: 1` header and are refused from other sites. Settings in `data/settings.json`, keys in `data/secrets.json` (mode 600, never returned to the page, never in backups). `data/` is gitignored. In dev, Vite proxies `/api` to it.
- **Models** (`src/core/aiProviders.ts`, `server/models.ts`): Vercel AI SDK. `canUse()` allows local models on localhost, cloud providers with a key, an EU/US region and zero data retention confirmed by the user, and OpenRouter with a key (`server/openrouter.ts` adds `provider: { zdr: true, data_collection: "deny" }` to every request body). OpenAI uses Chat Completions with `store: false`. Errors are described in plain words, with keys redacted.
- **Agent programs** (`server/agents.ts`): one process per question in an empty temp folder, with the conversation as text. Claude Code: `-p --output-format stream-json`, `--system-prompt-file`, `--tools ""`, `--strict-mcp-config`, only `mcp__bt` allowed. Codex: `exec --json --sandbox read-only`, bridge token via `bearer_token_env_var`. Hermes: `chat --query-file - --format stream-json`; gets the app's tools only after the user presses Connect (runs `hermes mcp add biomarker-tracker --url …?token=…`). OpenClaw: `agent --json --message-file`, no bridge, so it gets a data summary (`dataPack`) and its citations are marked as uncheckable. Time limit 10 minutes.
- **Bridge** (`server/bridge.ts`): the app's tools as an MCP server over HTTP at `/mcp` (stateless Streamable HTTP). Each question opens a run with a random 32-byte token that dies when the answer is done; Hermes uses a stable token (`secrets.bridgeToken`) that only works while a Hermes run is active. `/mcp` skips the `x-bt` check but needs the token and the Host check. Tool calls are recorded as steps, and study IDs come from their results, so citations are verified the same way for agents.
- **Assistant** (`server/assistant.ts`, `server/healthTools.ts`): the page sends a snapshot of measurements, log, experiments and profile with each question; the server turns birth month into age and never passes birth month to the model. Tools: get_results, get_marker, get_levers, get_biological_age, get_log, compare_before_after, search_research (Europe PMC), read_skill, plus tools from enabled MCP servers (`server__tool`). All numbers come from `/core`. Max 10 steps.
- **System rules:** cite only studies returned by tools, by ID; state evidence strength; say "not enough evidence" when true; no diagnosis; no personal dosing; suggest a doctor for out-of-range or fast-changing values. Critical values: tell the user to contact a doctor first and don't interpret them. Safety notes from the log make the model avoid nutrient-increase suggestions.
- **Citation verifier:** study IDs are collected from tool results (`studyIdsIn`); `CitedAnswer` checks every cited ID with `src/ai/citations.ts`. Unknown IDs are struck through, author-year references flagged.
- **Skills** (`skills/<id>/SKILL.md`, custom ones in `data/skills/`): name + description front matter; the model sees the index and loads one with read_skill. Bundled skills must keep the doctor/no-dosing rule (a test checks).
- **MCP** (`src/core/mcpPresets.ts`, `server/mcp.ts`): stdio servers via `npx -y package@pinned-version`, minimal environment, secrets kept with the server. Only medical/nutrition presets. On first start all presets are added (`ensureDefaultServers`, once; removed ones stay removed), switched on when `npx` exists and no key is required, and started in the background (`warmUp`). A question waits at most 45 s per server. The ~150 server tools are not sent to the model: it gets `research_tools` (list one server's tools) and `use_research_tool` (call one), plus a list of servers in the system prompt. Study IDs from `read_skill` and `research_tools` output never count.
- `connect-src` in `vite.config.ts` lists only `'self'`, Europe PMC and NCBI; the page never talks to a model directly. Old browser-stored keys are deleted on start (`forgetBrowserAiKey`).

---

## Profiles (folders)

- One folder per person in `data/profiles/<slug>-<4 hex>/`: `profile.json` (who: name, birth month, sex, height, diet, smoking, conditions, allergies, notes), `results.json`, `log.json`, `experiments.json`, `settings.json` (display settings), `files/` (scanned lab reports and documents, dated names, never overwritten), `files.json`, `README.txt`. Server: `server/profiles.ts`; backups are zips of the folder (`server/zip.ts`, no package), restored as a new profile with every file checked.
- The browser (Dexie) is a working copy of the open profile. `src/app/profiles.ts` loads a profile into it and saves every change back to the folder 0.5 s later (`liveQuery` over all tables); failed saves retry and show a banner. Switching saves, loads the other profile and reloads the page. `loadedProfile` in Dexie says which folder the copy belongs to; data with no folder is kept as its own profile on start, never dropped.
- First start, and every new profile, goes through the setup wizard (`SetupPage`: welcome, who, optional details, first results). The first screen also offers **Load a profile**: a backup .zip, or a profile folder chosen in the browser (`profilesInFolder` + `zipStore` in `src/core/zipStore.ts` pack it, the server restores it like a backup; a folder of several profiles loads them all). Loading never asks the setup questions. The header menu switches profiles; `#/profiles` opens, backs up, shows the folder of, or deletes profiles. Imported lab PDFs are kept in `files/`.
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
- Known gap: no OCR for scanned PDFs, and no Adobe CMaps bundled (rare CJK-font PDFs may extract garbled text).

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
- **CVI data:** `biologicalVariation` in each biomarker file, from the EFLM Biological Variation Database API (`https://biologicalvariation.eu/api/meta_calculations`, retrieved 2026-10-28; median with CI and number of studies). No EFLM value for RDW-CV, lymphocyte %, neutrophil %, eGFR or transferrin saturation; those experiments say "can't be judged" rather than guess.
- Creating an experiment also creates a log entry; ending it ends that entry. Experiments are in backups (backup format version 2; version 1 files still restore).

---

## Conventions

- TypeScript strict, no `any` in `/core`.
- Every function in `/core` has tests. Every knowledge entry has sources.
- Package manager is **Bun** (`bun install`, `bun add`). Don't use npm, and don't commit a `package-lock.json`.
- Small PRs. Run `bun run test` and `bun run build` before committing. (`bun run test`, not `bun test`: the latter is Bun's own runner, not Vitest.)
- UI copy: plain language, short sentences, explain every abbreviation once.
- Accessibility: keyboard navigable, readable contrast, works at 360px width.
