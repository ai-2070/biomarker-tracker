# Repository code review — 2026-10-29

Scope: the current repository, not a change diff. Read-only review; no application fixes made. Findings are appended by review round. The second round targets fresh cross-layer and failure-path issues and excludes duplicates.

Severity: **P1** = high-impact privacy, safety or data-loss defect; **P2** = material correctness or reliability defect; **P3** = lower-impact defect. **Executed** means the implementation was exercised with synthetic inputs; **source-confirmed** means the cited control/data flow was inspected but the complete runtime scenario was not exercised. Mocked HTTP boundaries are identified explicitly. No finding implies that every other path is correct.

## Round 1 — repository-wide subsystem review

### R1-001 — P1: An old tab can overwrite one person's profile folder with another person's data

- **Location:** `src/app/profiles.ts:133–140,151–168`; shared database replacement at `src/app/profiles.ts:86–103`.
- **Trigger:** Open profile A in one tab, then switch to B in another tab on the same origin. Both tabs share the same IndexedDB database; each tab has its own `syncing.id`.
- **Defect:** Loading B replaces all shared tables and `loadedProfile`. A's still-running `liveQuery` notices those changes, but `push()` sends `browserData()` to the captured A URL without checking that the working copy still belongs to A.
- **Impact:** B's complete health snapshot is written into A's folder. This is both destructive cross-profile corruption and a privacy failure.
- **Verification — executed, fake IndexedDB and mocked fetch:** Started `startSaving("a")`, then called `loadIntoBrowser("b")` while that saver remained subscribed, representing the other tab's database replacement. Observed `[{"path":"/api/profiles/a/data","person":{"name":"B"}}]` after the debounce. The actual profile synchronization functions ran; two real browser tabs were not used.
- **Fix direction:** Enforce working-copy ownership in the snapshot transaction and before every upload; coordinate tab ownership/switches so an old tab stops saving and cannot keep editing another profile's shared working copy.

### R1-002 — P1: Switching profiles proceeds after the current profile fails to save

- **Location:** `src/app/profiles.ts:141–147,180–184,190–196`.
- **Trigger:** Edit A, then switch to B while A's save fails, for example because storage is full or the server refuses the update.
- **Defect:** `push()` catches the error and resolves after marking the snapshot dirty. `flushSaving()` therefore resolves successfully. `switchProfile()` immediately calls `stopSaving()`, which cancels the retry, and `loadIntoBrowser()` clears the only updated working copy.
- **Impact:** Unsaved measurements and other edits are permanently discarded even though the switch promises to save first. Create/import flows use the same sequence.
- **Verification — executed, fake IndexedDB and mocked fetch:** Seeded A with one unsaved ferritin result; returned HTTP 500 for A's PUT and a valid empty snapshot for B. `switchProfile("b")` called reload and left `{"remaining":0,"person":{"name":"B"}}`; it did not reject the failed save.
- **Fix direction:** Have flush reject on failure, retain the current working copy, and prevent replacement until all current/in-flight changes are durably acknowledged.

### R1-003 — P1: A failed profile import/create/switch silently disables future autosave

- **Location:** `src/app/profiles.ts:190–208,247–251,264–271`.
- **Trigger:** Attempt an invalid ZIP import, or encounter a server error after `stopSaving()` in profile creation/switching.
- **Defect:** These flows unsubscribe the current saver before the fallible request. No error path restores the subscription. The page remains open on the old profile, with no saver running and no dirty/error status for subsequent edits.
- **Impact:** Later changes remain only in IndexedDB while the interface continues to present folder-backed persistence. A subsequent profile load can discard them.
- **Verification — executed, fake IndexedDB and mocked fetch:** Started A's saver, returned HTTP 400 for `restoreProfile(bad.zip)`, caught the UI-facing error, then changed the profile and waited beyond the debounce. Captured requests were only `["/api/profiles/restore"]`; no save PUT occurred.
- **Fix direction:** Restore the old saver on every failed transition, or suspend it only for the actual atomic working-copy replacement and resume deterministically.

### R1-004 — P1: Reloaded pending edits are treated as already saved and never retried

- **Location:** `src/app/profiles.ts:153–168`; startup at `src/app/App.tsx:60–63`.
- **Trigger:** Reload/close within the 500 ms debounce, or reload after a save failure. Reopen with the same active and loaded profile ID.
- **Defect:** Pending/dirty state is only in module memory. Startup keeps the local working copy when IDs match, but `startSaving()` unconditionally skips the initial snapshot as if it had just been fetched from the folder. No reconciliation or initial upload occurs.
- **Impact:** The newer data looks available in that browser but remains absent from the folder and ZIP backups indefinitely, until some unrelated edit happens. Switching away can then lose it.
- **Verification — executed, fake IndexedDB and mocked fetch:** Seeded a pending local measurement before starting the saver, then waited 800 ms. Observed `{"localResults":1,"profilePUTs":0}`. Source inspection confirms the same-ID startup branch does not reload or otherwise reconcile it.
- **Fix direction:** Persist synchronization revision/dirty ownership and reconcile on boot, or explicitly flush the retained local working copy instead of assuming its first emission matches disk.

### R1-005 — P2: “Replace all your data” retains the previous person's meals, protocols and intake list

- **Location:** `src/db/db.ts:250–260`; confirmation contract at `src/app/pages/DataPage.tsx:278–283`.
- **Trigger:** Restore another person's JSON file using “Replace my data” in a browser that already has saved meals, Protocols-page plans and intake settings.
- **Defect:** The replacement transaction clears only measurements, the Habits log and experiments, then changes the profile. It neither clears `plans`/`meals` nor resets person-specific settings such as `intakeList`.
- **Impact:** The newly restored person sees the previous person's private routines/food data; old protocol state can refer to deleted habits. This contradicts the explicit confirmation that everything currently stored is replaced.
- **Verification — executed with fake IndexedDB:** Seeded one plan, one meal and `intakeList`, restored an empty backup for B in replace mode. Observed `{"profile":{"name":"B"},"plans":1,"meals":1,"intake":true}`.
- **Fix direction:** Define a complete replacement transaction across all person-owned tables/settings, preserving only explicitly browser-owned and folder-ownership metadata. Keep legacy JSON's narrower export contract explicit rather than silently retaining another person's data.

### R1-006 — P2: Enabling folder profiles can erase a browser-only profile containing no measurements

- **Location:** `src/app/App.tsx:48–61`; first-run migration at `src/app/pages/SetupPage.tsx:39–40`.
- **Trigger:** A browser-only user has saved meals, plans, intake settings or profile details but no measurements/Habits log, then uses the local server with an existing active profile. A Habits-only browser profile is also missed when the server has no profiles and setup creates its first folder.
- **Defect:** The existing-server migration gate only checks measurements and the Habits log. The first-folder setup's `fromBrowser` decision checks measurements alone. Data in other person-owned tables/settings is not considered before `loadIntoBrowser()` clears it.
- **Impact:** Legitimate local-only data is silently replaced instead of being preserved as its own profile, contrary to the profile migration guarantee.
- **Verification — source-confirmed:** Traced both migration conditions to `createProfile(..., { fromBrowser: false })` / `loadIntoBrowser()` and its clear transaction. The full setup/browser migration scenario was not executed.
- **Fix direction:** Use one complete person-data presence check for both boot and first-folder setup, including meals, plans, experiments and relevant settings, and preserve that snapshot before replacing the working copy.

### R1-007 — P1: Folder import silently drops saved protocols and meals

- **Location:** `src/core/zipStore.ts:75,81–90`; downstream defaults at `server/profiles.ts:346–347`.
- **Trigger:** Choose a profile folder containing `protocols.json` and `meals.json` through “Load a profile folder.”
- **Defect/impact:** The file allowlist omits both files. The browser sends an incomplete ZIP; restore supplies empty arrays for the missing files and reports success. The imported profile loses its saved protocols and meals.
- **Verification — executed:** `profilesInFolder()` received `profile.json`, `protocols.json`, `meals.json`, and `results.json`; its output contained only `["a/profile.json","a/results.json"]`. The downstream empty-array defaults were source-confirmed.
- **Fix direction:** Include all supported person-owned profile files and exercise a populated folder round trip, not only a measurements/log fixture.

### R1-008 — P2: The app can generate backups that its restore limits reject

- **Location:** `server/http.ts:24,257–258`; `server/zip.ts:89,116–117`; generator at `server/profiles.ts:307–321`.
- **Trigger:** A profile accumulates over 200 MiB of compressed contents or over 500 MiB of expanded contents. Individual attachments up to 50 MiB are accepted without an aggregate profile cap.
- **Defect/impact:** Backup walks the entire profile and downloads it successfully, while restore rejects the resulting archive at different aggregate limits. An apparently valid app-created backup cannot recover the profile.
- **Verification — source-confirmed:** Compared upload, export and restore limits. Large archives were not allocated or uploaded during review. A reproduction is six approximately 40 MiB incompressible accepted attachments, followed by backup and restore.
- **Fix direction:** Align supported backup and restore sizes, preferably with bounded streaming. If a limit remains, disclose and enforce it before presenting an unsupported backup as successful.

### R1-009 — P2: Long attachment names make the app's own ZIP backups unrestorable

- **Location:** `server/profiles.ts:268–279,355–357`.
- **Trigger:** Keep a supported attachment whose original filename exceeds 200 characters, with its extension past character 200.
- **Defect/impact:** Upload validates the full extension and safely shortens the stored filename, but metadata truncates `originalName` without preserving its extension. Restore passes that truncated metadata name back through extension validation and rejects the complete backup.
- **Verification — executed in a temporary data folder:** Added `"a".repeat(205) + ".pdf"`, exported it using `backupZip()`, then called `restoreZip()`. Restore failed: `Only PDF, image (PNG, JPG, WebP), text and CSV files can be kept.`
- **Fix direction:** Preserve the extension when shortening metadata, and ensure accepted attachments round-trip through app-created backups.

### R1-010 — P2: Failed ZIP restoration leaves a selectable partial profile

- **Location:** `server/profiles.ts:341–357`.
- **Trigger:** Valid profile data is followed by malformed `files.json` or an attachment rejected during restore.
- **Defect/impact:** `createProfile()` publishes the folder before file-index parsing and attachment validation. A later exception reports failure but leaves the new, incomplete profile behind; repeated attempts add further partial copies.
- **Verification — executed in a temporary data folder:** Restored a synthetic ZIP with valid `profile.json` and invalid JSON in `files.json`. Observed `files.json in the backup is damaged.` and `profilesAdded 1`.
- **Fix direction:** Validate first and restore into a staging folder, publishing only a complete profile; otherwise reliably roll back every failed restore.

### R1-011 — P2: Malformed static URL encoding escapes the HTTP error boundary

- **Location:** `server/http.ts:338–340,395`.
- **Trigger:** Request a non-API URL such as `/%`.
- **Defect/impact:** `decodeURIComponent()` throws outside the route-level catches in an asynchronous HTTP listener. The request receives no controlled response; process termination depends on runtime rejection handling.
- **Verification — source-confirmed:** Traced the uncaught call from `createServer()` into `serveStatic()`. Process termination was not exercised or asserted. Reproduction: `curl --path-as-is --max-time 5 http://127.0.0.1:4820/%`.
- **Fix direction:** Put URL parsing/decoding inside the outer request error boundary and return a controlled 400.

### R1-012 — P2: Sign-in can fail immediately after an agent installation the app detects

- **Location:** `server/http.ts:86–89`; discovery at `server/which.ts`; launcher at `server/terminal.ts`.
- **Trigger:** On Windows, start the server, install an agent into a directory absent from the server's inherited PATH, then use “Check again” and “Sign in” without restarting the server.
- **Defect/impact:** Discovery reads current registry PATH/usual install folders, but sign-in launches the bare fixed command in a child PowerShell inheriting the server's stale environment. The UI can show “installed” and then open a sign-in terminal that cannot find the executable.
- **Verification — source-confirmed:** Compared discovery and launch paths. No software installation or real sign-in was attempted.
- **Fix direction:** Launch the resolved, correctly quoted executable with the fixed sign-in arguments, or explicitly refresh the child environment.

### R1-013 — P2: Secret replacement files are readable before permissions are restricted

- **Location:** `server/store.ts:20–24,82–89`.
- **Trigger:** Unix-like installation with umask `022` and a data-directory path traversable by another local user.
- **Defect/impact:** Generic `writeJSON()` creates the plaintext secrets temporary file with default permissions, commonly `0644`, renames it over the destination, and only then applies `0600`. Keys are readable during those windows; interruption can leave a readable temporary or final file.
- **Verification — source-confirmed:** Inspected file creation/rename/chmod ordering. This review ran on Windows; Unix permissions and cross-user reads were not exercised.
- **Fix direction:** Create secret temporary files with `0600` before writing sensitive bytes and retain those permissions through replacement.

### R1-014 — P1: Concurrent Hermes questions share the newest question's health snapshot

- **Location:** `server/bridge.ts:31–40,55–60`; callers at `server/agents.ts:279–294` and `server/http.ts:293–309`.
- **Trigger:** Two Hermes questions overlap, including from different tabs/profiles or after stopping one question in the page while its agent continues.
- **Defect/impact:** Opening a run overwrites the one `current["hermes"]` entry. Every request authenticated by Hermes's stable token then uses the newest run's tools, data, citation set and step log. The older agent can receive the newer person's data. Closing the newest run also makes the stable token idle while the older run remains open.
- **Verification — executed with actual bridge functions and synthetic tools:** Opened A then B; the stable-token lookup selected B and its sentinel tool returned `"B"`. After closing B, lookup returned `"idle"` while A's per-run token still resolved.
- **Fix direction:** Serialize stable-token Hermes runs server-side, or make each process use a credential bound to exactly one run; never overwrite an active routing slot.

### R1-015 — P2: Echoed input can be laundered into a “verified” research citation

- **Location:** `server/steps.ts:23–39`; echoing tool at `server/healthTools.ts:433–435`.
- **Trigger:** A tool result contains a study-looking identifier in user-authored text or an error, e.g. unknown nutrient query `PMID:99999999`.
- **Defect/impact:** The collector scans arbitrary serialized tool output, not successful retrieved study records. The echoed ID enters the trusted set, and the answer renderer marks it checked despite no study retrieval.
- **Verification — executed:** Passed `{error:"No entry for PMID:99999999"}` through `studyIdsFromTool("get_nutrient", ...)`, then through `checkCitations()`. Result: `verified:["PMID:99999999"]`, `unverified:[]`.
- **Fix direction:** Derive trusted IDs from explicit successful study/citation result fields; exclude errors, model input and user-authored labels.

### R1-016 — P2: DOI citations bypass verification entirely

- **Location:** `src/ai/citations.ts:18–20,32–55`; trusted-ID collection at `server/steps.ts:23–31`.
- **Trigger:** The model cites `[DOI:…]`, including a DOI-only source legitimately returned by a built-in knowledge tool.
- **Defect/impact:** Both collector and answer parser recognize only PMID/PMCID. Fabricated DOI citations receive neither an unverified marker nor a loose-reference warning; legitimate DOI-only citations cannot be checked either.
- **Verification — executed:** `checkCitations("[DOI:10.1234/nonexistent]", new Set())` returned one ordinary text segment, with empty verified, unverified and loose-reference arrays.
- **Fix direction:** Normalize/collect DOI IDs consistently, validate them against retrieved sources and render their links through the same checked-citation path.

### R1-017 — P2: A rejected meal proposal can still become a saveable meal card

- **Location:** `server/assistant.ts:156–160`; `src/app/brain/store.ts:154–159`; agent equivalent at `server/bridge.ts:83–87`.
- **Trigger:** `propose_meal` has structurally valid items but an unknown food ID.
- **Defect/impact:** Server execution rejects unknown IDs with food-database-aware validation. The reply nevertheless retains the input as a step without its success/failure outcome. The page creates a card from that input using structural-only validation; saving persists the unknown ID, and totals omit that food.
- **Verification — source-confirmed:** Traced rejection at `server/healthTools.ts:395–397` to input-only step transport, card construction, `saveMeal()`, and `mealTotals()` filtering. No model/provider was called.
- **Fix direction:** Transport successful, validated proposal results explicitly and build cards only from those results; validate food IDs before enabling Save.

### R1-018 — P2: Valid long protocol proposals are cut into invalid JSON

- **Location:** `server/steps.ts:18–20`; consumer at `src/app/brain/store.ts:145–151`.
- **Trigger:** A valid 60-item proposal with supported label, amount, note and weekday fields exceeds 30,000 serialized characters.
- **Defect/impact:** The tool accepts the proposal but `toolStep()` slices its JSON to 30,000 characters. The page's parse fails and silently discards the promised confirmation card.
- **Verification — executed:** Constructed a proposal accepted by `planFromProposal()` with 60 items, each with 80-character label, 40-character amount, 300-character note and seven weekdays. Original JSON: `33813` characters; transported JSON: `30000`; parsing raised `SyntaxError`.
- **Fix direction:** Preserve the complete validated application payload. If a size limit is necessary, reject before claiming success rather than truncating JSON.

### R1-019 — P1: Exact blood-pressure emergency thresholds do not activate critical protection

- **Location:** `src/core/trends.ts:64–65`; definitions at `knowledge/biomarkers/bp_systolic.json` and `bp_diastolic.json`.
- **Trigger:** Systolic pressure exactly 180 mmHg or diastolic exactly 120 mmHg.
- **Defect/impact:** Strict critical comparisons classify both as ordinary high readings, despite their definitions saying “180 or more” / “120 or more.” The dashboard urgent banner and assistant critical-result/proposal restrictions therefore do not activate at the documented boundary.
- **Verification — executed against shipped definitions:** `flagValue(180, ...)` and `flagValue(120, ...)` both returned `"high"`.
- **Fix direction:** Represent inclusive critical boundaries where required, without changing other markers whose thresholds are explicitly strict.

### R1-020 — P1: Range decisions ignore inequality qualifiers

- **Location:** `src/core/trends.ts:76–78`; qualifier preservation at `src/core/importers/manual.ts:111–114`.
- **Trigger:** Potassium `>6.2 mmol/L`, or female ferritin `<15 µg/L`.
- **Defect/impact:** `flagMeasurement()` treats the numeric detection/reporting limit as an exact measurement and ignores `<`/`>`. It can assert normality for a definitely low result or omit critical protection for a definitely critical one. The misclassification reaches dashboards, suggestions and AI safety gating.
- **Verification — executed against shipped definitions:** Potassium `>6.2` returned `"high"`; female ferritin `<15` returned `"normal"`, instead of definite critical-high and low respectively.
- **Fix direction:** Classify the interval represented by a qualified result, distinguishing definite violations from uncertain boundary-crossing intervals.

### R1-021 — P2: Brain's blood-pressure average includes readings after its stated endpoint

- **Location:** `src/core/bodySummary.ts:33–35`; paired endpoint selection at `src/core/body.ts:212–217`.
- **Trigger:** A complete 120/80 reading on October 10, then an imported unpaired systolic 180 on October 20.
- **Defect/impact:** Latest blood pressure selects the latest paired date, but the 30-day averages enforce only a lower bound. The later unpaired reading contaminates the earlier window. Brain receives contradictory provenance for numbers it is told to report as computed facts.
- **Verification — executed:** `bodySummary()` returned `{"latest":"120/80 mmHg","date":"2026-10-10","last30DaysAverage":"150/80 mmHg (2 readings)"}`.
- **Fix direction:** Bound both averages through the chosen endpoint, or choose and disclose a different explicit averaging endpoint.

### R1-022 — P2: Heart age excludes almost all people aged 74

- **Location:** `src/core/heartAge.ts:112`; history consumer at `src/core/ageHistory.ts:43–46`.
- **Trigger:** Chronological age is between exactly 74 and 75 years, while the advertised eligible range is 30–74.
- **Defect/impact:** `ageAt()` supplies fractional years and the guard rejects `age > 74`, suppressing the result for most of the last eligible year even though the profile still displays age 74.
- **Verification — executed:** Birth month `1952-06`, evaluation date `2026-10-29`, otherwise valid inputs: computed age `74.3709787816564`, `outOfRange:"old"`.
- **Fix direction:** Use age 75 as the upper-exclusive bound, or consistently compare completed years to the documented range.

### R1-023 — P2: Long-history chart axes stop generating ticks after 400 months

- **Location:** `src/core/timeWindow.ts:77–84`.
- **Trigger:** Use All on a history longer than approximately 33 years.
- **Defect/impact:** Tick generation increments months even when emitting annual ticks, then stops after 400 iterations. Later decades remain without labels on timelines, marker charts and ages charts.
- **Verification — executed:** `timeTicks()` for `1970-01-01` through `2026-10-29` returned 33 ticks; the last was `{"date":"2003-01-01","day":12053,"kind":"year"}`.
- **Fix direction:** Iterate aligned tick intervals through the requested endpoint instead of applying a fixed monthly traversal cap.

### R1-024 — P2: Abstract cleanup deletes inequalities and intervening study facts

- **Location:** `src/core/evidenceMap.ts:90–93`.
- **Trigger:** Abstract text contains encoded `<` and `>` comparisons separated by other prose.
- **Defect/impact:** `plainText()` decodes entities, then removes arbitrary angle-bracket spans as markup. This can delete participant counts and eligibility information before classification and screening.
- **Verification — executed:** `plainText("BMI &lt; 30; 1200 adults enrolled; P &gt; 0.05")` returned `"BMI 0.05"`; `sampleSize()` then returned `undefined` instead of 1200.
- **Fix direction:** Remove actual markup without treating comparison operators and all intervening prose as a tag; preserve supported encoded formatting tags deliberately.

### R1-025 — P2: Evidence overlap presents bibliography citations as pooled-study membership

- **Location:** `tools/evidence/build.ts:55–63`; presentation in `src/app/components/EvidenceMap.tsx` (`Overlap`).
- **Trigger:** Chosen reviews cite the same background/excluded/off-topic randomized trial but do not include that trial in the relevant analysis.
- **Defect/impact:** Any downloaded RCT PMID in a review's bibliography is treated as a pooled trial for corrected covered area. The UI calls these “Trials pooled by each chosen review” and uses overlap to discuss independence, overstating actual shared included evidence.
- **Verification — source-confirmed, shipped artifact inspected:** `knowledge/evidence-maps/creatine.json:1155–1160,1412–1416` includes vitamin-D2 trial PMID `24362707`, arginine trial PMID `19777799`, and young-adult studies in the older-adult overlap. No external literature audit or generator run was performed.
- **Fix direction:** Calculate pooled-study overlap only from verified included-study membership for that outcome. Without it, label bibliography overlap honestly and do not interpret it as pooled-trial independence.

### R1-026 — P2: Failed reference downloads are cached as complete results

- **Location:** `tools/evidence/build.ts:20–28`.
- **Trigger:** A reference-list request gets 429/503, either on its first page or during pagination.
- **Defect/impact:** The loop breaks but still caches accumulated IDs. Later builds accept the empty/truncated cache without retrying; overlap is omitted/miscomputed and the UI can wrongly say that Europe PMC has no reference list.
- **Verification — source-confirmed:** Traced non-success response, unconditional cache write and immediate cache-return branch. No cached research data was changed or network requests made.
- **Fix direction:** Publish a cache entry only after successful pagination, and distinguish retrieval failure from a successfully retrieved empty list.

### R1-027 — P2: A weaker publication tag masks a title-declared meta-analysis

- **Location:** `src/core/evidenceMap.ts:32–35`.
- **Trigger:** PubMed tags a paper `Systematic Review`, while its title explicitly declares a meta-analysis.
- **Defect/impact:** The early systematic-review return prevents the meta-analysis title fallback. Because selection prioritizes meta-analyses, the paper can be demoted behind older studies or excluded from preferred selections.
- **Verification — executed:** `designOf({pubTypes:["Systematic Review"],title:"A systematic review and meta-analysis"})` returned `"systematic review"`. The shipped creatine cognition map also classifies PMID `39070254` this way.
- **Fix direction:** Apply title-declared meta-analysis recognition before the weaker systematic-review return, retaining intended guideline precedence.

### R1-028 — P2: Life-table regeneration publishes incomplete data after a country fetch fails

- **Location:** `tools/lifetables/build.ts:47–50`; consumer at `src/app/components/dashboard/bestBefore.tsx:70–85`.
- **Trigger:** A supported country's request fails during regeneration.
- **Defect/impact:** The generator logs/skips the country and still overwrites the shipped artifact successfully. The fixed country selector continues offering that country, but its expiration-date card has no table and repeatedly asks for a country.
- **Verification — source-confirmed:** Reviewed skip and final-write control flow. The current shipped artifact has all 32 entries; no current missing-country defect or regeneration run is claimed.
- **Fix direction:** Require completeness before replacing the artifact; retain the existing dataset and fail clearly on incomplete retrieval.

### R1-029 — P1: Attachment filenames disclose the profile name to the model

- **Location:** `src/app/brain/store.ts:271–274`; prompt formatting at `src/app/brain/logic.ts:53–61`.
- **Trigger:** Profile “Anna Kovacs” attaches a non-lab document named `Anna Kovacs referral.txt` and asks Brain a question.
- **Defect/impact:** Document text is name-redacted, but its original filename is inserted twice into the transmitted prompt. The person's name reaches the configured provider despite the explicit profile-name privacy promise.
- **Verification — source-confirmed:** Traced unchanged `d.name` through attachment headings and `/api/assistant` to model/agent messages. No external provider received a review request.
- **Fix direction:** Redact model-facing filenames as well as document text; retain original filenames only in local UI state.

### R1-030 — P2: An empty height field cannot be filled by ordinary typing

- **Location:** `src/app/components/ProfileForm.tsx:77–81`.
- **Trigger:** Start with an empty height in setup or Settings and type `170`.
- **Defect/impact:** Every individual first digit is below 40, so immediate numeric validation replaces it with `undefined` and clears the controlled input. Users must paste a complete valid value to enter height, blocking normal entry needed for several calculations.
- **Verification — executed in the production browser UI:** Cleared “Height (cm)” and typed `170` through keyboard input. Observed `heightAfterTyping: ""`.
- **Fix direction:** Keep an editable string draft, allowing intermediate input, and validate/commit at a suitable completion boundary.

### R1-031 — P2: The 61st intake item makes the whole analysis disappear

- **Location:** `src/app/pages/IntakePage.tsx:75–76`; persisted reader at `src/app/hooks.ts:78–82`.
- **Trigger:** Add a 61st meal, food or supplement to the analyzer.
- **Defect/impact:** Addition persists the over-limit list without checking the existing 60-item contract. The reader rejects it and substitutes `[]`; adding another item can overwrite the hidden list entirely.
- **Verification — source-confirmed:** Traced unconditional append into `validateIntakeItems()`'s maximum and the empty-list fallback. The 61-click browser scenario was not executed.
- **Fix direction:** Prevent over-limit additions with an explanation, and do not present invalid stored data as if the person had an empty list.

### R1-032 — P2: The direct protocol editor can block whole-profile saves

- **Location:** `src/app/pages/PlanPage.tsx:109–113`; validation at `src/core/plans.ts:93–95`.
- **Trigger:** Add a 61st item to a protocol through its own page.
- **Defect/impact:** The editor and `savePlan()` persist the item despite the 60-item maximum. Server whole-profile validation and assistant snapshot parsing then reject the entire profile, preventing disk synchronization and Brain requests until the protocol is repaired.
- **Verification — source-confirmed:** Followed the append into unvalidated IndexedDB storage, then `server/profiles.ts:141–153,225–229` and `server/healthTools.ts:46–47`. The separate Add-to-protocol dialog already enforces the limit.
- **Fix direction:** Apply the shared item-count and protocol validation before committing direct editor changes.

### R1-033 — P2: The meal editor can likewise create a profile that will not sync

- **Location:** `src/app/pages/MealPage.tsx:150–152`; validation at `src/core/meals.ts:216–218`.
- **Trigger:** Add a 41st food to a saved meal.
- **Defect/impact:** The UI and `saveMeal()` accept the object while server profile saves and assistant snapshots reject meals beyond 40 foods. A normal UI operation breaks persistence and assistant use for the whole profile.
- **Verification — source-confirmed:** Traced unconditional food append and persistence to the server's meal-validation paths. No 41-food UI scenario was executed.
- **Fix direction:** Enforce `MAX_MEAL_ITEMS` in the editor and validate before persistence, with a clear limit message.

### R1-034 — P2: A stale person editor overwrites restored profile details

- **Location:** `src/app/pages/DataPage.tsx:73–80`.
- **Trigger:** Stay on Settings → Your data, restore a different JSON profile using Replace, then edit one profile field.
- **Defect/impact:** The live query supplies the restored profile, but `PersonCard` uses `initial` only once for its local draft. It keeps the old details and writes the entire stale draft on the next edit, overwriting restored birth month, sex, conditions, name and other fields.
- **Verification — source-confirmed:** Compared the live-query props, one-time state initialization, restore mutation and whole-object `setProfile()` call. Browser restore/edit was not exercised.
- **Fix direction:** Remount or explicitly reset the person editor on external profile replacement without discarding ordinary in-progress editing.

### R1-035 — P2: Brain's send operation is neither locked nor cancellable during preparation

- **Location:** `src/app/brain/store.ts:262–279`.
- **Trigger:** Submit twice before IndexedDB/photo preparation completes, or clear the conversation while a selected photo is preparing.
- **Defect/impact:** `busy` and the abort controller are established only after asynchronous preparation. Multiple submissions pass the guard, and New conversation has nothing to abort during that interval. Captured questions/data/photos can be sent after clearing; overlapping requests also overwrite the one global controller.
- **Verification — source-confirmed:** Inspected the first-await/lock/controller order and New conversation/Stop consumers. No model calls were made.
- **Fix direction:** Reserve the operation and its conversation generation before the first await; make preparation cancellable and reject stale completions.

### R1-036 — P2: Cleared attachment reads can reappear in a new conversation

- **Location:** `src/app/brain/store.ts:189–221,225–231`.
- **Trigger:** Start reading/OCR of a lab report, then press New conversation before it completes.
- **Defect/impact:** The reset clears current turns/attachments but does not invalidate the pending file batch. Lab/screenshot completions append review cards unconditionally to the new conversation, and later files in the old batch can still be added.
- **Verification — source-confirmed:** Traced asynchronous completion branches against `newConversation()`; no slow OCR race was executed.
- **Fix direction:** Bind reads and batches to a conversation generation; cancel or discard all old-generation work after reset.

### R1-037 — P2: Removing a duplicate food can leave the wrong grams displayed and later saved

- **Location:** `src/app/pages/MealPage.tsx:102–112`.
- **Trigger:** Add the same food twice, edit rows to 125 g and 200 g, then remove the first row.
- **Defect/impact:** Keys combine food ID and array index while inputs are uncontrolled. React can reuse the first row's 125 g input for the surviving 200 g item, disagreeing with saved data/totals; blurring can then overwrite the surviving amount with the stale value.
- **Verification — source-confirmed:** Reviewed key construction, `defaultValue`, delete filtering and blur update. The DOM reuse scenario was not exercised.
- **Fix direction:** Use stable editable-row identity or a controlled grams editor that resets when its represented item changes.

### R1-038 — P1: Nutrient pages omit urgent handling for their displayed critical result

- **Location:** `src/app/pages/NutrientPage.tsx:43–104,201–206`.
- **Trigger:** Save potassium above 6.2 mmol/L, then open Supplementation → Potassium.
- **Defect/impact:** The page shows the result as a very-high badge but no urgent critical banner, continues with food/supplement material, and hardcodes `critical={false}` for research. The paper-to-Brain summarization handoff is enabled where the marker page disables it.
- **Verification — source-confirmed:** Inspected the page, status-marker linkage and research prop. The server's critical prompt is a separate defense, not a replacement for the page warning.
- **Fix direction:** Derive critical state from status results, show contact-a-doctor handling before explanatory material and pass the real state into research/suggestion controls.

### R1-039 — P2: Dashboard biological-age comparison mixes two different dates

- **Location:** `src/app/components/dashboard/widgets.tsx:52–53`; draw-date difference at `src/core/dashboard.ts:114–117`.
- **Trigger:** The latest complete blood draw is old enough for chronological age to have changed materially.
- **Defect/impact:** The card uses PhenoAge and its difference at the blood draw, but labels the comparison against today's calendar age. It can show PhenoAge 44 as “4 older than your age (45)” when the draw happened at age 40.
- **Verification — source-confirmed:** Traced `last.phenoAge`, draw-date `last.difference` and `ageAt(..., today)` into the same figure.
- **Fix direction:** Compare and label values at the same draw date; any current projection needs a separately defined calculation and label.

### R1-040 — P2: The combined timeline cannot reach early body history

- **Location:** `src/app/pages/HomePage.tsx:79`; domain at `src/app/components/dashboard/Timeline.tsx:75–87`.
- **Trigger:** Body measurements predate the first blood draw and any earlier habit.
- **Defect/impact:** The main dashboard passes the blood-only dashboard span but adds body draws separately. The timeline filters body squares against the narrower span, hiding early body history even under All and preventing panning to it.
- **Verification — source-confirmed:** Traced blood span selection into navigable domain and body-draw filtering.
- **Fix direction:** Union body dates into the combined timeline domain while keeping blood-specific plot data separate.

### R1-041 — P2: The UI says five photos were sent while the server silently uses four

- **Location:** `src/app/brain/store.ts:259–276`; receiving cap at `server/http.ts:284–292`.
- **Trigger:** Attach five ordinary images, enable “Send the photo itself” on each, and submit.
- **Defect/impact:** The page prepares, counts and removes all five, but the server slices the array to four without reporting the omission. The assistant sees incomplete evidence while the conversation claims five sent photos.
- **Verification — source-confirmed:** Compared page preparation/counting with server `v.slice(0, 4)`. No images were sent to a provider.
- **Fix direction:** Enforce the four-photo limit before submission and retain/explain excess attachments instead of silently dropping them.

### R1-042 — P2: Mixed Apple Health units are combined as raw values under the first unit

- **Location:** `src/core/importers/deviceFiles.ts:593–607`; save conversion at `src/app/pages/DeviceImportPage.tsx:229–247`.
- **Trigger:** One Apple body-mass series contains 70 kg on one day and 154.3 lb on another.
- **Defect/impact:** The tally stores the first unit/converter but sums later raw values after per-record plausibility conversion. The second value passes plausibility yet emerges and is saved as 154.3 kg.
- **Verification — executed:** `DailyTally.add()` with those records returned one `"kg"` series with daily values `70` and `154.3`.
- **Fix direction:** Convert before accumulation or separate units and reconcile explicitly; validation conversion must match stored-value conversion.

### R1-043 — P2: Apple sleep stages ending before midnight are assigned to the wrong night

- **Location:** `src/core/importers/deviceFiles.ts:564–569`.
- **Trigger:** A continuous night's first asleep stage ends before midnight and later stages end the next morning.
- **Defect/impact:** Each stage is dated by its own end date, so 23:00–23:30 followed by 23:30–07:00 becomes 0.5 h on the previous day and 7.5 h on the wake-up day rather than one 8 h night. Nightly/weekly sleep assessment is distorted.
- **Verification — source-confirmed:** Traced stage-level dates into date-only daily tallying. A full streamed XML import was not executed.
- **Fix direction:** Associate contiguous stages with a sleep session before assigning the wake-up date; retain session state across XML chunks and keep devices separate.

### R1-044 — P2: Low-activity Oura days are inflated from seconds into minutes

- **Location:** `src/core/importers/deviceFiles.ts:300–302,474–476`.
- **Trigger:** Oura activity fields contain 180 seconds medium activity and 60 seconds high activity.
- **Defect/impact:** The combined synthetic header loses the brand's seconds semantics and the magnitude heuristic treats the 240 total as minutes. The correct four active minutes become 240, corrupting activity totals and flags.
- **Verification — executed:** `readTable("oura/daily_activity.csv", ...)` with those fields returned an active-minutes column with `unit:"min"` and `value:240`.
- **Fix direction:** Preserve the source format's explicit seconds unit through synthetic totals rather than infer it from activity magnitude.

### R1-045 — P2: Screenshot decimal durations are parsed from their fractional suffix

- **Location:** `src/core/importers/screenshot.ts:60–65`.
- **Trigger:** OCR text says `Total sleep 7.5 h` or exercise `1.5 h`.
- **Defect/impact:** Unanchored integer-only patterns match the trailing `5 h`, producing a plausible wrong value with no problem flag.
- **Verification — executed:** `durationHours("7.5 h")` returned `5`; screenshot parsing produced sleep `value:"5"`, `unit:"h"`, `problems:[]`.
- **Fix direction:** Parse decimal points/commas and enforce numeric boundaries so an unsupported number cannot partially match.

### R1-046 — P2: Screenshot units beside a label are discarded for next-line values

- **Location:** `src/core/importers/screenshot.ts:113–119`.
- **Trigger:** Screenshot text is `Weight (lb)` followed by `150`.
- **Defect/impact:** Parsing passes only the numeric line to unit detection, then defaults to kilograms. The resulting 150 kg is plausible and preselected despite representing 150 lb.
- **Verification — executed:** `parseHealthScreenshot()` returned `value:"150"`, `unit:"kg"`, `problems:[]` for that two-line input.
- **Fix direction:** Carry label-line unit context into following value lines and flag any conflict instead of silently defaulting.

### R1-047 — P2: ZIP entry streams drain the entire entry without consumer backpressure

- **Location:** `src/core/importers/zipRead.ts:76–84`.
- **Trigger:** Open a large stored/compressed export entry while its parser consumes slowly, or before attaching a reader.
- **Defect/impact:** The `async start()` loop reads/enqueues every source chunk without demand checks or cancellation propagation. The advertised bounded-memory path can queue an entire gigabyte-scale export and exhaust browser memory.
- **Verification — executed with a synthetic stored entry:** Instrumented the underlying Blob stream, opened an 8 MiB entry and attached no consumer. Observed `underlyingBytesReadWithoutConsumer:8388608`, `entryBytes:8388608`, `locked:false`. Gigabyte memory exhaustion itself was not attempted.
- **Fix direction:** Read on `pull()`/demand or stream the resolved Blob slice directly, and propagate cancellation to the source reader.

### R1-048 — P2: Mixed text/scanned PDFs skip OCR for the scanned result pages

- **Location:** `src/app/pdf.ts:58–65`.
- **Trigger:** A PDF has a selectable-text cover/header longer than 20 characters but image-only lab-result pages.
- **Defect/impact:** OCR selection uses whole-document extracted text length. A textual cover prevents OCR altogether, leaving scanned measurements absent from the review.
- **Verification — source-confirmed:** Reviewed extraction/OCR dispatch and its `readReportFile()` consumer. A synthetic mixed PDF was not generated/imported.
- **Fix direction:** Assess text adequacy and OCR per page, preserve page order and disclose any OCR page cap.

### R1-049 — P2: Duplicate rows within one lab import are saved twice

- **Location:** `src/app/components/LabReview.tsx:126–129`.
- **Trigger:** An otherwise empty profile imports two identical `Ferritin 45 µg/L 15 - 150` rows for the same collection date.
- **Defect/impact:** Deduplication checks only previously stored rows, not rows already accepted into the pending batch. Both receive different IDs and become separate observations, distorting counts and statistical weighting.
- **Verification — source-confirmed:** Traced the loop's unchanged `existing` set into `addMeasurements()` UUID allocation. A complete review/save interaction was not executed.
- **Fix direction:** Include pending accepted rows in deduplication, while preserving genuinely distinct readings.

### R1-050 — P2: Device dates that are unambiguous are still rejected by locale

- **Location:** `src/core/importers/deviceFiles.ts:385–386`.
- **Trigger:** US `12/31/2025` on a day-first browser, or `31/12/2025` on a month-first browser.
- **Defect/impact:** The parser blindly applies locale even when one component is over 12. It rejects a valid, unambiguous date; affected device rows disappear without a date-format correction control.
- **Verification — executed:** `toIsoDate("12/31/2025", false)` and `toIsoDate("31/12/2025", true)` both returned `undefined`.
- **Fix direction:** Resolve unambiguous order first; apply locale only where both interpretations are valid, following the existing lab-date precedent.

### R1-051 — P1: Intake suggestions remain enabled beside a critically high linked blood result

- **Location:** `src/app/pages/IntakePage.tsx:629–635`.
- **Trigger:** Latest potassium is 6.5 mmol/L, no kidney condition is recorded, and the analyzer list contains only a 100 mg potassium supplement.
- **Defect/impact:** Gap advice and potassium-rich meal suggestions are generated from intake shortfall before checking the linked blood result; its critical flag only becomes a badge. Nutrient-increase ideas are presented directly beside a critical value.
- **Verification — source-confirmed:** Traced `gapAdvice()`/`mealsRichIn()` and the subsequent display-only `flagLatest()` call. The full browser scenario was not executed.
- **Fix direction:** Resolve linked critical status first and replace increase suggestions with urgent doctor-contact handling.

### R1-052 — P2: Meal suggestions bypass remaining upper-limit checks

- **Location:** `src/core/intake.ts:399–406`; caller at `src/app/pages/IntakePage.tsx:629–631`.
- **Trigger:** A saved 100 g lamb's-liver meal is considered for a B12 gap in a kiwi-only intake list.
- **Defect/impact:** Individual food ideas receive remaining upper-limit room, but meal ranking receives only condition-specific safety flags. The liver meal contributes 19,700 µg retinol against the stored 3,000 µg upper limit and can be suggested while the equivalent individual-food suggestion is rejected.
- **Verification — source-confirmed:** Compared both selection contracts and the shipped `18-494` nutrient values. The complete analyzer scenario was not exercised.
- **Fix direction:** Compare candidate meal totals against remaining upper-limit allowances for all relevant nutrients, not just the nutrient whose gap is being filled.

### R1-053 — P2: Splitting the same food into duplicate meal rows bypasses safety limits

- **Location:** `src/core/meals.ts:197–200`.
- **Trigger:** A meal has two 10 g rows of cooked spinach `13-573` for a person taking an anticoagulant.
- **Defect/impact:** Each row contributes 57.5 µg vitamin K1 and passes the 60 µg per-food threshold; together they contribute 115 µg. The equivalent one-row 20 g meal is blocked. Ordinary duplicate additions therefore change the safety decision.
- **Verification — source-confirmed:** Inspected row-by-row checking, duplicate-permitting validation and the shipped spinach value.
- **Fix direction:** Aggregate amounts by food ID before applying the existing per-food portion checks.

### R1-054 — P2: Protocol quick picks silently substitute different supplement forms

- **Location:** `src/app/pages/IntakePage.tsx:291–293`.
- **Trigger:** Quick-pick protocol item `Beta-carotene 5000 µg` or `Vitamin K2 100 µg`.
- **Defect/impact:** Broad nutrient matching maps beta-carotene to the analyzer's preformed-retinol representation, incorrectly adding it to the retinol upper-limit amount. K2 becomes `vitaminK1` and counts toward a reference the knowledge entry says covers K1 only.
- **Verification — source-confirmed:** Traced `nutrientFor()` through the inverse food-key mapping and form-specific `intakeTotals()` semantics.
- **Fix direction:** Preserve form identity; do not auto-import unsupported forms as another form with different reference/safety semantics.

### R1-055 — P2: Qualified experiment results still produce an unjustified exact percentage

- **Location:** `src/core/experiments.ts:127–132`; display in `src/app/pages/ExperimentsPage.tsx` (`ResultCard`).
- **Trigger:** Baseline CRP is `<0.3`, followed by an eligible exact 0.2 result.
- **Defect/impact:** Exact means/change are assigned before the qualifier guard. Returning `verdict:"below-limit"` retains a claimed −33% change even though the actual value might have increased; the UI renders defined numeric fields regardless of the verdict.
- **Verification — executed:** `analyzeMarker()` returned baseline `0.3`, after `0.2`, change `-0.33333333333333326`, verdict `"below-limit"`.
- **Fix direction:** Detect qualified results before exact aggregation and omit unknowable summary values/change while retaining the source readings.

### R1-056 — P2: Valid zero baselines generate infinite or NaN experiment changes

- **Location:** `src/core/experiments.ts:127–130`.
- **Trigger:** Watch a marker permitting zero, such as push-ups, with baseline 0 and after 5, or zero on both sides.
- **Defect/impact:** Geometric/log comparison and division run before checking the positive-value domain. The later missing-variation verdict retains nonfinite fields, which the result page formats as `+Infinity%` or `−NaN%`.
- **Verification — executed:** Push-ups 0 → 5 returned `beforeValue:0`, `afterValue:5`, `change:Infinity`, verdict `"no-variation-data"`. The rendered percentage was source-confirmed, not browser-observed.
- **Fix direction:** Guard the logarithmic domain and omit undefined percentage change for a zero baseline; retain legitimate zero input measurements.

### R1-057 — P3: Omega-3 protocol items are missing from supported supplement quick picks

- **Location:** `src/app/pages/IntakePage.tsx:284–293`.
- **Trigger:** A protocol contains recognized `Fish oil` / omega-3 with an amount in mg.
- **Defect/impact:** Quick picks invert `NUTRIENT_OF_KEY`, which has no `epaDha → omega_3` entry, even though the analyzer and nutrient lookup support it. The item never appears, and with only that item the entire section is absent.
- **Verification — source-confirmed:** Compared supported supplement keys, nutrient recognition and quick-pick mapping.
- **Fix direction:** Include the supported omega-3 mapping while retaining form-specific safeguards described in R1-054.

## Round 2 — independent cross-layer review

Three fresh reviewers retraced persistence/process lifetimes, clinical/AI safety, and ingestion/UI/evidence integrations. Duplicate findings were consolidated into their Round 1 entries rather than counted again. This round added the following five distinct findings.

### R2-001 — P1: Deleting the last profile resurrects its health data under the next person's identity

- **Location:** `src/app/pages/ProfilesPage.tsx:71–74`; startup at `src/app/App.tsx:48–52`; setup migration at `src/app/pages/SetupPage.tsx:40`.
- **Trigger:** Delete the sole open folder profile, then complete the resulting setup as a different person.
- **Defect/impact:** Deletion removes the server folder but leaves the IndexedDB working copy and ownership marker. Boot enters first-folder setup and counts those deleted measurements as browser data to migrate. Creating B therefore copies deleted A's measurements, habits, experiments, plans, meals and settings into B's folder. This is separate from ordinary profile-switch corruption: deletion itself fails to remove the recovery source.
- **Verification — executed end to end in the production browser against temporary server storage:** Opened the bundled example profile, deleted the sole profile through its confirmation dialog, and observed the setup message `972 results are already saved in this browser. They will go into the profile you create now.` The server listed no profiles. Completed setup as `Replacement B`; its actual profile API returned `{"name":"Replacement B","results":972,"plans":2,"habits":4}`. Only synthetic/example health data was used.
- **Fix direction:** Stop synchronization and clear the deleted profile's working copy/ownership before restarting. Migration must distinguish genuinely unowned browser data from a copy whose owner was deleted.

### R2-002 — P2: Failed MCP tool discovery leaks initialized research-server processes

- **Location:** `server/mcp.ts:48–55,67–70,87–88`.
- **Trigger:** A stdio MCP server initializes successfully, then errors/times out on `tools/list` while remaining alive.
- **Defect/impact:** `client.tools()` rejects without closing the created client/transport. The failed promise is removed from `live`, so shutdown skips it; retry overwrites the transport-map entry and loses the old process's cleanup reference. Repeated questions can accumulate orphaned subprocesses.
- **Verification — source-confirmed:** Traced transport registration, discovery rejection, retry and shutdown; inspected the installed SDK's distinction between initialization cleanup and `tools()` errors. A synthetic failing MCP process was not launched.
- **Fix direction:** Close client/transport on every post-spawn failure, remove map entries only when they still identify that connection, and include tracked failed-start transports in shutdown.

### R2-003 — P2: Stale screening can be replaced by unscreened selections under a screened provenance claim

- **Location:** `tools/evidence/build.ts:48–52,135–147`; UI fallback at `src/app/components/EvidenceMap.tsx:132–135`.
- **Trigger:** Change an existing outcome's question and run build before rerunning screening.
- **Defect/impact:** The builder notices that decisions belong to another question and discards `current`, but then selects from every eligible review. Previously rejected/unreviewed papers can be chosen. Because a screening file still exists, global generated rules continue claiming that only reviews answering the question can be chosen, while this outcome lacks matching decisions.
- **Verification — source-confirmed:** Compared exact-question matching, `chooseFrom(split ? split.yes : eligible, ...)` and the independent global `screening` condition for provenance text. No screening files or generated maps were changed. This finding concerns stale-question publication/mislabeling, not the separately disclosed ability to build a deliberately unscreened map.
- **Fix direction:** Require matching-question screening before publishing a screened outcome, or explicitly publish it as unscreened without implying validated question fit; do not silently promote rejected reviews under a screened rule.

### R2-004 — P2: Pace-of-aging confidence intervals are nonfinite at the advertised minimum sample sizes

- **Location:** `src/core/agePace.ts:68–72`; reused t table at `src/core/experiments.ts:43–50`.
- **Trigger:** Calculate pace from three, four or five eligible tests.
- **Defect/impact:** Regression requests `t95(n - 2)`, but the shared table starts at four degrees of freedom and returns Infinity for degrees of freedom 1–3. Nonzero residual error yields infinite bounds; an exact line yields `Infinity * 0 = NaN`. The page formats these as the likely range, and JSON turns them into null for Brain.
- **Verification — executed:** `t95(1)`, `t95(2)` and `t95(3)` all returned `Infinity`. Three constant PhenoAge points spanning a year returned pace `0`, `low:NaN`, `high:NaN`, verdict `"unclear"`. Consumers' formatting/serialization was source-confirmed.
- **Fix direction:** Supply correct finite two-sided 95% t critical values for degrees of freedom 1, 2 and 3, and preserve finite interval invariants for accepted calculations.

### R2-005 — P2: AI experiment summaries drop the existing post-hoc selection warning

- **Location:** `server/healthTools.ts:255–272`; warning definition at `src/core/habits.ts:44–45`.
- **Trigger:** Markers are first selected after follow-up results were available.
- **Defect/impact:** The UI labels the comparison “a hint, not a test,” but `experimentResults()` omits both `chosenOn` and the computed warning. `compare_before_after` and OpenClaw's data summary export the same rise/fall/change facts for prospective and post-hoc selections, so the assistant cannot recover an important evidence limitation.
- **Verification — executed:** Compared otherwise identical snapshots with selection dates before and after the retest boundary. `pickedAfterResults()` returned `false` and `true`, respectively, while serialized `experimentResults()` outputs were identical.
- **Fix direction:** Export selection timing and the same computed post-hoc caveat with comparison results; retain relevant multiple-marker caution alongside numerical findings.

## Verification receipts and scope limits

### Repository baseline

- Installed dependencies with `bun install --frozen-lockfile`: completed successfully, 239 packages. Bun reported one blocked postinstall; no blocked script was enabled.
- `bun run test`: **57 test files passed; 776 tests passed**, exit 0. The AI SDK emitted an image-content-part deprecation warning.
- `bun run build`: **passed**, including both TypeScript projects and the production Vite build, exit 0. Vite warned about chunks above 500 kB. Those warnings are recorded, not counted as defects without demonstrated consumer impact.
- No application source, permanent tests, knowledge data, or configuration was changed. The review report is the deliverable; build/dependency outputs are ignored artifacts.

### Exercised behavior

- Ran actual TypeScript helpers with synthetic data for profile synchronization (mocked HTTP/fake IndexedDB), replacement restoration, folder selection, ZIP backup/restore, Hermes run dispatch, citation verification, proposal serialization, clinical boundaries, body summaries, heart-age eligibility, time ticks, abstract processing, evidence-design classification, device/screenshot parsing, ZIP backpressure, experiment comparisons and pace intervals.
- Ran the built application in Chromium against `createServer()` on an isolated loopback port with a temporary `BT_DATA` folder; did not use the normal entry point's automatic MCP warm-up. Observed example-profile startup/dashboard, Settings, the height-entry defect, and the complete delete-last-profile → new-person data resurrection.
- Additional executed receipts strengthen **R1-052** and **R1-053**: the lamb's-liver meal's retinol total was `19700` µg and `mealsRichIn("vitaminB12", ...)` returned it; two 10 g spinach rows returned no safety block, while one 20 g row returned the blood-thinner warning. These helper probes did not exercise the entire analyzer UI.
- No real patient data, cloud models, signed-in agents, research-server packages, agent installers, or external research APIs were used for reproduction. No full OCR run, mixed PDF import, Unix permission exploit, large-backup restoration, or subprocess-leak fixture was executed; findings on those paths remain source-confirmed.

### Coverage

- **Server/security/persistence:** all `server/` implementation modules; HTTP/Host/header boundaries; settings/secrets; filesystem profiles/files; archive restore/export; agent/terminal discovery; bridge/model/MCP/skill lifecycles.
- **Core/medical calculations:** every `src/core/` module and importer family; documented equations, demographic/date/range handling, same-draw assembly, longitudinal aggregation, fitness placement, nutrition/reference/safety calculations, habits/protocols/experiments, backup validation and demo generation.
- **Application:** routing/shell, browser working-copy ownership, database schema and mutations, live hooks, profile/setup/settings, Brain attachments/submission/proposals, import review/save, dashboards/charts, marker/nutrient/research, meal/protocol/intake flows. Presentation-heavy components received targeted source inspection; this was not an exhaustive accessibility, responsive-layout or visual-design audit.
- **Research/generated knowledge:** research client, citation pipeline, evidence fetch/screen/build/selection/overlap, CoFID and life-table generators, knowledge validators and tests. All knowledge areas were considered for code/data contracts; citations, clinical grades and original spreadsheet/table values were not individually revalidated against external publications.
- **Tests/build/docs:** read related tests and synthetic fixtures as contract evidence, ran the complete existing suite and production build, and checked the documented product constraints. Passing tests do not cover the demonstrated edge/failure paths.

### Consolidation and rejected concerns

- Round 2's filename, mixed Apple-unit, split sleep-night, send-race, photo-count, qualified-result, intake-critical, qualified-experiment and meal-upper-limit findings duplicate Round 1 and are not counted again.
- The proposed Tesseract production meta-CSP blocker was rejected: OCR explicitly disables Blob workers; the same-origin worker loads/compiles the engine in its own context. No deployed CSP failure was established.
- Agent-login retention, initial MCP enablement, detection-limit approximate PhenoAge, unknown-sex range policy, supported fitness-age clamping, six-page OCR cap, and stopping the wait while an agent can finish are documented choices, not findings.
- JSON export is explicitly presented as results/Habits/watch data, not a complete profile-folder backup. Its narrower contents are not counted as a separate export defect; the misleading destructive replacement behavior is R1-005.
- No finding asserts that arbitrary external clinical claims were independently validated, or that an unexercised source path was runtime-proven.

## Triage

| Round | P1 | P2 | P3 | Distinct findings |
|---|---:|---:|---:|---:|
| Round 1 | 11 | 45 | 1 | 57 |
| Round 2 | 1 | 4 | 0 | 5 |
| Total | 12 | 49 | 1 | 62 |

Prioritize cross-person data corruption/disclosure and deletion resurrection (**R1-001, R1-014, R1-029, R2-001**), critical-result safety bypasses (**R1-019, R1-020, R1-038, R1-051**), and data durability/import loss (**R1-002–R1-004, R1-007**). Each finding above includes its own bounded fix direction; no remediation was implemented during this review.

## Round 3 — validation, aggregation and lifecycle boundaries

This pass checks candidates against the first 62 findings and appends only distinct root causes. Earlier verification receipts and triage totals describe their original rounds; the cumulative totals for this pass appear at the end of Round 3. No application fixes are included.

### R3-001 — P2: Backup validation accepts experiment intervals that crash the dashboard after restore

- **Location:** `src/core/backup.ts:83–95`; consumer at `src/core/dashboard.ts:120–123`.
- **Trigger:** Restore an otherwise valid JSON/ZIP profile containing an active experiment with a finite but out-of-domain `retestAfterDays`, such as `1e308`.
- **Defect/impact:** Backup validation checks only finiteness, while the ordinary experiment validator requires an integer between 7 and 730. The imported value reaches `retestDate()`, whose `toISOString()` throws for the overflowing date. Every dashboard calls this for active experiments, so an import reported as valid can render the main application unusable instead of rejecting the damaged experiment. Negative/zero intervals also bypass the normal scheduling contract.
- **Verification — executed:** For the same synthetic experiment, `parseBackup()` returned `ok:true` and `validateExperiment()` returned `ok:false`. Passing the accepted backup's arrays to actual `buildDashboard()` threw `RangeError: Invalid Date`.
- **Fix direction:** Reuse the existing experiment interval/domain invariants at backup/profile/snapshot boundaries, and reject invalid objects before persisting them.

### R3-002 — P2: Thousands-separated CSV step counts become plausible fractional counts

- **Location:** `src/core/importers/deviceFiles.ts:402–405`; downstream tally rounding at `:627`.
- **Trigger:** Import a valid quoted CSV cell containing `8,120` daily steps.
- **Defect/impact:** The CSV reader correctly preserves the quoted cell, but numeric parsing always interprets its single comma as a decimal separator. The value becomes 8.12 and is rounded to 8.1 steps without being marked impossible. The review/save path therefore persists a roughly thousand-fold undercount rather than reading 8,120 or asking about an ambiguous format.
- **Verification — executed:** `readTable()` on `Date,Steps` plus a quoted `8,120` cell returned `{"field":"steps","unit":"steps","readings":[{"date":"2026-10-01","value":8.12}]}`. `dailyAverages()` retained a daily value of `8.1`, with `dropped:0`.
- **Fix direction:** Parse grouped numeric formats with field/locale context; integer count fields must not silently interpret a grouping separator as a fractional count. Preserve decimal-comma support for continuous measurements.

### R3-003 — P2: JSON imports discard every field first encountered after record 500

- **Location:** `src/core/importers/deviceFiles.ts:148–149`.
- **Trigger:** A heterogeneous JSON export contains 500 heart-rate records followed by weight or another measurement using additional keys.
- **Defect/impact:** All records are flattened, but the header union is derived from only the first 500 rows. Mapping every later row through that restricted schema erases later fields before column recognition. Those measurements do not reach review, even though their names and values are supported.
- **Verification — executed:** Passed 500 `{date, restingHeartRate}` objects followed by `{date, weight:70}` through `jsonTable()` and `readTable()`. Headers were only `["date","resting Heart Rate"]`; the only recognized field was `"resting_hr"`. The later weight field disappeared.
- **Fix direction:** Build the union of keys across all flattened records, preferably during the existing flattening pass; do not silently sample away the schema of later record types.

### R3-004 — P2: XML-escaped Apple glucose units are not decoded and all affected readings are dropped

- **Location:** `src/core/importers/deviceFiles.ts:501–503,533–535`.
- **Trigger:** An Apple-style glucose record uses the explicitly supported special unit `mmol<180.1558800000541>/L`, encoded correctly in XML as `mmol&lt;180.1558800000541&gt;/L`.
- **Defect/impact:** Attribute extraction returns XML entity text unchanged, while the unit map contains only the decoded spelling. The canonical-unit lookup fails; the tally drops the otherwise valid glucose value as impossible, and the page removes the resulting empty series.
- **Verification — executed:** Parsed a synthetic, properly entity-encoded XML record for glucose 5.4. `appleRecords()` returned the literal encoded unit; the same unit-matching/tally path used by the page produced `dropped:1`, `days:[]`. A real Apple account export was not used.
- **Fix direction:** Decode XML attribute entities before unit lookup and source-name handling, or use an XML-aware extraction strategy that preserves streaming.

### R3-005 — P2: Recognized “Active zone minutes” screenshots are rejected by the exclusion filter

- **Location:** `src/core/importers/screenshot.ts:27,32,108–109`.
- **Trigger:** Import screenshot text such as `Active zone minutes 42 min`.
- **Defect/impact:** The label matcher explicitly supports active-zone minutes, but the later blanket `zone` exclusion rejects the entire line. A supported activity reading disappears from review.
- **Verification — executed:** That exact text produced `rows:[]`; otherwise identical `Active minutes 42 min` produced an `active_minutes` row with value 42 and no problems.
- **Fix direction:** Distinguish heart-rate zones/goals from the supported active-zone-minute metric instead of excluding every occurrence of “zone.”

### R3-006 — P2: Quoted header punctuation makes delimiter detection reject valid CSV measurements

- **Location:** `src/core/importers/deviceFiles.ts:18–20`.
- **Trigger:** A semicolon-delimited CSV has header `Date;"Weight, kg"` and row `2026-10-01;70`.
- **Defect/impact:** Delimiter detection counts commas inside quoted header text. A tie incorrectly selects comma, although the real separator is semicolon. The resulting table has no importable weight column, so valid measurements disappear.
- **Verification — executed:** `parseCsv()` produced `[["Date;Weight, kg"],["2026-10-01;70"]]`; the downstream `readTable()` result had `columns:[]`. Correct quote-aware separation would yield Date and Weight columns.
- **Fix direction:** Count only separators outside quotes when detecting the dialect, and avoid committing to a delimiter based on quoted punctuation.

### R3-007 — P2: Starting a protocol twice leaves habits that Stop can no longer end

- **Location:** `src/db/db.ts:59–67`; UI action at `src/app/pages/PlanPage.tsx:405–407`.
- **Trigger:** Invoke Start twice before the first operation completes, including rapid activation of the unguarded button or concurrent tabs.
- **Defect/impact:** Both calls use the same inactive plan object and create habits without checking current stored active state inside the transaction. The second overwrites `active.habitIds`; stopping the protocol ends only the second set, leaving duplicate habits ongoing in charts and safety inputs.
- **Verification — executed with fake IndexedDB:** Started a one-item plan twice with `Promise.all()`. Observed `started 2 tracked 1`. After stopping the stored active plan, one Walk habit had end date `2026-10-29`; the other still had no end date.
- **Fix direction:** Make activation idempotent by checking the persisted plan inside the transaction before creating habits; disable the UI action while it is pending.

### R3-008 — P2: Chart selection and range labels shift a calendar day backward west of UTC

- **Location:** `src/app/components/timeControls.tsx:30–32,279,336`.
- **Trigger:** Use chart controls in a time zone such as America/New_York and select October 10–12.
- **Defect/impact:** Day-number endpoints become midnight-UTC instants, but their formatters use the local time zone. The heading says October 9–11 while statistics still cover October 10–12. Month/year labels also shift at boundaries.
- **Verification — executed against the actual React component:** Set the child process's time zone to America/New_York and server-rendered `SelectionBar` with day-number endpoints for `2026-10-10` and `2026-10-12`. Its heading was `Oct 9, 2026 – Oct 11, 2026`. No browser timezone emulation is claimed.
- **Fix direction:** Format calendar-day instants explicitly in UTC, or construct local calendar dates consistently without applying an offset.

### R3-009 — P2: Cached model readiness consumes pending research questions before settings refresh

- **Location:** `src/app/brain/Brain.tsx:185–188`; cache at `src/app/brain/menus.tsx:20–35`.
- **Trigger:** Open Brain before configuring a model, close it, configure a usable model in Settings, then press “Summarize with Brain” on a paper.
- **Defect/impact:** The new panel initially receives cached not-ready settings and immediately consumes the pending question into an unsent draft. The later refresh cannot trigger the promised automatic send because the pending action is gone. With an old usable provider cached, the reverse ordering can send through the new server-side provider but permanently label the answer with the cached old model.
- **Verification — source-confirmed:** Traced cache initialization, asynchronous GET, pending-consumption effect and the model label passed into `send()`. No cloud/local model was called.
- **Fix direction:** Track current-opening freshness separately from cached display state; consume pending actions only after fresh readiness is known, and return actual answering-model attribution from the server.

### R3-010 — P3: Weekly activity totals are labelled as averages in chart tooltips

- **Location:** `src/app/components/TrendChart.tsx:103–107,285`.
- **Trigger:** View weekly totals for seven days containing 30 active minutes each.
- **Defect/impact:** The point correctly totals 210 minutes, but the shared grouped tooltip describes it as “Average of 7 readings”; the accessible chart summary likewise uses average wording. The label contradicts the selected aggregation and misstates what the number means.
- **Verification — source-confirmed:** Compared the explicit `"total"` grouping path with unconditional tooltip wording. A rendered/hovered chart was not exercised this round.
- **Fix direction:** Use the existing totals mode to label totals versus averages consistently in tooltips and accessible summaries.

### R3-011 — P2: A supplement dose can be reported as a trial's participant count

- **Location:** `src/core/evidenceMap.ts:75–78`; large-trial selection at `:204–208`.
- **Trigger:** An abstract says `In this randomized trial (n = 60), we assessed vitamin D 2000 IU in adults with fractures.`
- **Defect/impact:** The participant regex allows arbitrary intervening words such as “IU in” between a number and “adults.” It extracts both 60 and the dose 2000, then chooses the maximum. A 60-person trial is classified/displayed as a 2,000-person large trial and its evidence-map prominence changes.
- **Verification — executed:** `sampleSize()` returned `2000`; passing the synthetic record through actual `classify()` and `largeTrialsSince()` included it with `n:2000`.
- **Fix direction:** Restrict participant-descriptor wording, reject intervening dose/unit expressions and prevent dosage values from overriding explicit sample counts.

### R3-012 — P2: Recorded aspirin/clopidogrel cannot activate their shipped vitamin-E precaution

- **Location:** `src/core/protocols.ts:120–121`; tagged interaction at `knowledge/nutrients/vitamin_e.json:331–334`.
- **Trigger:** A person records `Aspirin 75 mg daily` or `Clopidogrel 75 mg daily`, then views vitamin E or a protocol containing it.
- **Defect/impact:** The knowledge entry explicitly names those antiplatelet medicines, but personal interaction routing depends on an anticoagulant safety ID whose matcher recognizes neither medicine nor “antiplatelet.” The prominent personalized doctor/pharmacist precaution is omitted despite the app having the relevant medicine and precaution data.
- **Verification — executed:** Both labels produced `safety:[]` and `interactions:[]` through actual `safetyNotes()` and `interactionsFor(vitaminE, ...)`, despite the explicit tagged entry.
- **Fix direction:** Represent and route the already-documented antiplatelet precaution. Preserve the distinction from vitamin-K-sensitive anticoagulant therapy; simply treating every antiplatelet as warfarin would introduce incorrect food restrictions.

### R3-013 — P1: UUID order can make an earlier normal result override a newly saved same-day critical result

- **Location:** `src/core/trends.ts:138–140`; storage at `src/db/db.ts:44–45,102–120`; readers at `src/app/hooks.ts:10–15`.
- **Trigger:** Save potassium 4, then potassium 7, for the same date, with the second result's random UUID sorting before the first.
- **Defect/impact:** Equal-date sorting preserves input order, but IndexedDB's table and compound-index reads supply primary-key order, not insertion order. “Latest” can therefore select the earlier normal measurement. Dashboard/marker/Brain critical protection and same-date PhenoAge marker selection depend on this unstable ordering.
- **Verification — executed with fake IndexedDB:** Inserted the normal row first using UUID `ffffffff-ffff-4fff-8fff-ffffffffffff`, then the critical row using `00000000-0000-4000-8000-000000000000`. Both `toArray()` and `measurementsFor("potassium")` returned values `[7,4]`; actual `computeTrend()` chose latest 4 and `flagLatest()` returned `"normal"`.
- **Fix direction:** Persist explicit measurement/save ordering and use the same deterministic tie-breaker across storage reads, latest-result decisions and draw assembly. UUID lexical order cannot implement the documented insertion-order behavior.

### R3-014 — P2: Historical aggregate chart points use the latest result's reference range

- **Location:** `src/app/components/TrendChart.tsx:103–107`; latest-range input at `src/app/pages/MarkerPage.tsx:42–46`.
- **Trigger:** A man born in January 1984 has body-fat readings of 21% on October 7–8, 2019 and October 29, 2026; switch to weekly averages.
- **Defect/impact:** Individual historical readings resolve the age-specific 8–20% range and are high. The grouped path classifies every bucket using the latest 11–22% range, marking the unchanged historical average normal. Lab-range and fasting-state changes can produce the same provenance error.
- **Verification — executed helper path plus source-confirmed UI dispatch:** With shipped definitions, both 2019 readings returned `"high"`; grouping them and applying the actual latest supplied range returned `"normal"`. The chart's latest-range reuse was inspected; the browser chart was not rendered.
- **Fix direction:** Resolve aggregate ranges using historical provenance, and do not silently classify mixed incompatible ranges/fasting states with the newest result's range.

### R3-015 — P2: Multiple rows from one day satisfy multi-night sleep and HRV baseline requirements

- **Location:** `src/core/trends.ts:85–92`; related coverage checks at `src/core/personalRange.ts:35–36,45–48`.
- **Trigger:** Save three sleep readings for one date through ordinary body entry, or accumulate fourteen HRV readings on one baseline date.
- **Defect/impact:** Coverage minima count rows instead of distinct nights/days. A single night is enough for a medically flagged “last week” sleep average; duplicate dates also overweight it. HRV can claim its two-week baseline from one day. This does not require the previously reported duplicate-lab-import defect.
- **Verification — executed:** Sleep values 5, 6 and 7 all on `2026-10-29` yielded average 6, `count:3`, and `"low"` from `flagLatest()`. Fourteen baseline HRV rows on `2026-10-01` yielded a personal range with `baseline.count:14`, `baseline.from` and `baseline.to` both `2026-10-01`.
- **Fix direction:** Establish per-day observations before multi-day aggregation and enforce distinct-date coverage. Preserve documented sleep-piece addition rather than averaging pieces as separate nights.

### R3-016 — P2: Fitness-age comparison drops an open-ended bound and claims a younger age

- **Location:** `src/app/components/dashboard/fitnessAge.tsx:27–31,41,83`.
- **Trigger:** An approximately 80-year-old woman has VO₂max 20, below the oldest reference group's mean.
- **Defect/impact:** Core correctly returns age 75 with `bound:"older"` and the headline says “75 or older.” The comparison handles only the younger bound, then subtracts 75 as if exact, claiming roughly five years younger or “About your age” near 75. The available lower bound cannot establish either conclusion.
- **Verification — source-confirmed:** Traced the shipped oldest female mean, bounded `fitnessAge()` return and unchanged arguments into `comparison()`. The complete fitness-age figure was not rendered.
- **Fix direction:** Preserve both bound variants in comparison wording; do not report a precise difference or direction that an open-ended bound cannot establish.

### R3-017 — P1: Ambient SDK endpoint overrides send health prompts and saved provider keys to an unselected service

- **Location:** `server/models.ts:47–51`; installed SDK behavior at `node_modules/@ai-sdk/openai/src/openai-provider.ts:220–239` and `node_modules/@ai-sdk/anthropic/src/anthropic-provider.ts:140–146`.
- **Trigger:** Start the app from a shell with `OPENAI_BASE_URL` or `ANTHROPIC_BASE_URL` set for another tool/gateway, then select the corresponding named cloud provider in the app.
- **Defect/impact:** Eligibility/ZDR approval is tied to the named provider, but its constructor supplies only the API key and inherits the SDK's ambient endpoint override. Conversation/tool-context health data and the saved provider credential are sent to that other service without the custom-endpoint region/retention selection or disclosure.
- **Verification — executed against a local HTTP capture server only:** In temporary `BT_DATA`, configured each named provider with ZDR confirmed and a sentinel key, then pointed its environment override at the capture server and called actual `readyModel()` → `generateText()`. Both readiness checks passed. Captured OpenAI `/v1/chat/completions` with `Authorization: Bearer REVIEW_SENTINEL_KEY`, and Anthropic `/v1/messages` with `x-api-key: REVIEW_SENTINEL_KEY`; both request bodies contained the synthetic prompt sentinel. No real credentials, patient data or external provider was used.
- **Fix direction:** Explicitly pin canonical endpoints for named providers; require any override to go through the configured custom-provider eligibility/disclosure path.

### R3-018 — P2: Removing an MCP server can start and orphan its replacement during shutdown

- **Location:** `server/mcp.ts:276–279`; interleaving at `:79–84,99–107`.
- **Trigger:** Remove a running MCP server while another tab starts a question during asynchronous process shutdown.
- **Defect/impact:** Removal first deletes the connection caches and awaits closure, but leaves the configuration enabled until afterward. A question in that interval sees an eligible server with no cached connection and starts another process. Removal then deletes configuration/secrets without closing that replacement; it can retain tools and captured credentials while no longer appearing in Settings.
- **Verification — source-confirmed:** Traced the eligibility check and cache deletion across the shutdown await. A delayed-exit synthetic MCP fixture was not launched. Unlike R2-002, this path assumes successful initialization/discovery and depends on removal/start concurrency.
- **Fix direction:** Remove/disable eligibility before awaiting shutdown and fence connection publication against removed configurations, including starts already in flight.

### R3-019 — P2: An interrupted ordinary save exposes a mixed generation of an existing profile

- **Location:** `server/profiles.ts:164–171,225–229`.
- **Trigger:** A later component write fails after an earlier JSON file was replaced during whole-profile autosave.
- **Defect/impact:** Per-file atomic rename does not make the profile snapshot atomic. New measurements can coexist with old Habits, experiments and person metadata; normal reads and ZIP backups accept that mixture. Closing before a successful retry leaves broken cross-file provenance as durable state. This is not the already reported incomplete-new-restore publication failure.
- **Verification — executed in a temporary data folder:** Created generation A, then deterministically blocked the next `log.json` temporary-file write with an owned temporary directory. Saving generation B failed with `EISDIR`. Actual `getProfileData()` returned `{"name":"Generation A","result":20,"habit":"Habit A"}`: B's measurement alongside A's identity/log. Removed the fault fixture and temporary profile afterward. Disk-full/crash scenarios themselves were not executed.
- **Fix direction:** Publish complete generations atomically, or journal/recover interrupted saves before exposing a profile or backing it up.

### R3-020 — P2: Failure to launch the file manager can terminate the local server

- **Location:** `server/profiles.ts:363–366`.
- **Trigger:** Press Show folder on Linux/WSL without `xdg-open`, or encounter another asynchronous executable-launch failure.
- **Defect/impact:** `spawn()` returns before reporting a missing executable through the child's `error` event. No listener handles that event, and the route already returned success. The unhandled EventEmitter error can terminate the local server instead of producing a recoverable error for an optional convenience action.
- **Verification — source-confirmed:** Inspected the detached child and HTTP caller/error handling. This review ran on Windows; no Linux/WSL process-termination receipt is claimed and no real file-manager window was launched.
- **Fix direction:** Handle asynchronous spawn errors and await an appropriate launch outcome before returning success; retain the error listener after launch.

### Round 3 verification and exclusions

- Re-ran `bun run test`: **57 test files and 776 tests passed**, exit 0. The existing AI SDK image-part deprecation warning remained.
- Re-ran `bun run build`: **passed**, including both TypeScript projects and production bundling, exit 0. The existing large-chunk warning remained; no new warning-only finding was added.
- Runtime probes exercised backup validation through dashboard construction; quoted/grouped CSV cells and delimiter selection; heterogeneous JSON schemas; Apple XML units; active-zone screenshot recognition; concurrent protocol activation/stop; real React selection-bar rendering under America/New_York; evidence-map sample-size selection; medication-to-interaction routing; actual IndexedDB result ordering; sleep/HRV coverage and historical reference helpers; named-provider requests captured on loopback; and an existing profile save under a deterministic filesystem fault.
- All probe data was synthetic, with fake IndexedDB or temporary filesystem storage where applicable. No application source, permanent tests, configuration, original research data or existing findings were rewritten. No external model/research requests or real patient credentials were used.
- Third-round reviewers covered server/provider/process lifecycles; clinical/date/range/aggregate consumers; app protocol/habit/research/chart transitions; nutrition/safety contracts; research/data-generation provenance. Parent review covered importer and backup/body-entry boundaries. The round was checked against all prior findings; no duplicate was counted merely because it reached another consumer.
- Existing/disclosed active-protocol edit/delete behavior, current smoking in historical heart-age charts, unknown-sex range policy, fitness-age clamping itself, partial-week activity coverage, and stopping the wait while an agent finishes were not reclassified as bugs.
- Source-only entries remain explicitly labelled. This round did not run a delayed-exit MCP fixture, Linux file-manager failure, full OCR, real export/account integration, or exhaustive visual/accessibility audit.

### Cumulative triage after Round 3

| Scope | P1 | P2 | P3 | Distinct findings |
|---|---:|---:|---:|---:|
| Rounds 1–2 | 12 | 49 | 1 | 62 |
| Round 3 additions | 2 | 17 | 1 | 20 |
| Cumulative | 14 | 66 | 2 | 82 |

New priority items are the unselected provider-endpoint disclosure (**R3-017**) and same-day critical-result precedence (**R3-013**). The remaining additions are independently actionable validation, state-transition, provenance and display defects; their bounded fix directions do not imply remediation has been implemented.

## Round 4 — reference-table, model/tool and editing contracts

This pass adds ten distinct findings after checking the previous 82 entries and their root causes. Earlier round totals and receipts are retained unchanged. No application fixes were made.

### R4-001 — P2: Intake nutrient rows hide partial measurement coverage while presenting an exact shortfall

- **Location:** `src/app/pages/IntakePage.tsx:532–566`; preserved coverage metadata at `src/core/intake.ts:297–299`.
- **Trigger:** Analyze foods where a nutrient is measured in only some ingredients, such as 10 g cooked spinach `13-573` plus 100 g flaked/ground almonds `14-870` for vitamin K1.
- **Defect/impact:** Core correctly retains `measuredIn`/`of`, but the vitamin/mineral row drops both and presents its partial known amount, percentage and “Below” status without the missing-data context. Its generic footer says coverage is shown on the nutrient's page, but that knowledge page has no access to this intake list's coverage. A known lower bound is therefore displayed like a complete total/shortfall, contrary to the measured-only data contract.
- **Verification — executed in helpers and the production browser UI:** Actual totals were `57.5 µg`, `measuredIn:1`, `of:2`, share 82. The displayed vitamin-K row was `82 %`, `58 µg of 70`, `Below`; the page did not show “measured in 1 of 2.” The unmeasured almond contribution was not estimated, and no claim is made about its actual value.
- **Fix direction:** Display per-nutrient measurement coverage next to these figures and qualify partial totals/statuses as known amounts, rather than implying a fully measured shortfall.

### R4-002 — P2: Starting a protocol bypasses the one-year planning limit enforced for the habits it creates

- **Location:** `src/app/pages/PlanPage.tsx:401–406`; unchecked mutation at `src/db/db.ts:59–67`.
- **Trigger:** Enter a protocol start date more than a year ahead, such as `2028-10-29` when today is `2026-10-29`.
- **Defect/impact:** The date input has no planning bound and calls `startPlan()` directly. That function creates Habits without applying their existing date validator. A supported UI path can therefore create ongoing/planned habits outside the documented one-year planning window that ordinary habit entry rejects.
- **Verification — executed with fake IndexedDB:** `validateProtocol()` rejected the date with `Please choose a start date within the next year.` Actual `startPlan()` nevertheless persisted a Walk habit starting `2028-10-29`. The activation control's missing guard was source-confirmed; its future-date browser interaction was not executed.
- **Fix direction:** Apply the same date/planning policy before activating a protocol and creating its habits, using the shared validation contract.

### R4-003 — P2: A shared balance-test ceiling is turned into a strict above-percentile claim

- **Location:** `src/core/fitnessTests.ts:209–217`; shipped tied values at `knowledge/fitness/one_leg_stand.json:139–154`.
- **Trigger:** Record a 30-second or longer one-leg stand and compare with the British table.
- **Defect/impact:** The result is capped at 30, but equality advances through both `p50:30` and `p75:30`, yielding “Above the 75th percentile.” The table explicitly says 74% of participants aged 53 reached that same cap and that it only separates the bottom. The capped test cannot support this strict ranking; the assertion reaches marker/youngest-group comparisons and Brain.
- **Verification — executed against shipped data:** `placeResult()` at age 53 and value 30 returned the British place `{kind:"percentile",above:75,median:30}`; actual `describePlace()` said `Above the 75th percentile`.
- **Fix direction:** Preserve tied/capped percentile uncertainty instead of treating equality at the measurement ceiling as strict above-percentile evidence.

### R4-004 — P2: The last open norm group incorrectly turns intermediate results into an older/worse bound

- **Location:** `src/core/fitnessTests.ts:154–162`; description at `src/app/components/dashboard/fitness.tsx:35–40`.
- **Trigger:** A woman records a 20-second one-leg stand. The Iranian table has mean 25 seconds at 60–69 and 6.9 seconds at 70+.
- **Defect/impact:** When the next age row is open-ended, `ageMatch()` returns the “oldest … or worse” result before distinguishing an intermediate result from one actually worse than that row's mean. The 20-second result is described as typical of women 70 and over, or below, despite being substantially better than that group's mean.
- **Verification — executed:** `ageMatch()` on the shipped Iranian table returned `{kind:"oldest",age:70}` for the 20-second input. The consuming description was source-confirmed.
- **Fix direction:** Retain the uncertainty of the final interval or omit the unsupported age comparison; reserve the older/worse bound for values that actually establish it. No extrapolation past the open group is required.

### R4-005 — P2: Balance instructions offer an eyes-closed result that the app evaluates as eyes-open

- **Location:** `knowledge/fitness/one_leg_stand.json:13–14`; unsupported variant disclosure at `:267`; entry at `src/app/components/dashboard/body.tsx:678`.
- **Trigger:** Follow the how-to's optional eyes-closed test after successfully standing eyes-open for at least ten seconds, then enter a five-second eyes-closed time in the one available recording field.
- **Defect/impact:** The measurement has no eye-state/variant field, while all selected norms and the failed-ten-second cutoff are for the supported eyes-open protocol. The app treats the entered harder-version time as failed eyes-open balance and can show a mortality-association notice even though that eyes-open threshold was completed.
- **Verification — executed core consequence, source-confirmed recording ambiguity:** `fitnessSummary()` for the undifferentiated five-second record at age 60 returned eyes-open norm comparisons and `Could not complete a 10-second one-leg stand (ages 51–75): linked to higher death rates in one Brazilian cohort`. No physical test was performed; the optional instruction, single input and missing variant were inspected.
- **Fix direction:** Make the recordable how-to explicitly eyes-open and separate/remove the unrecordable alternative, or persist and correctly dispatch a test variant.

### R4-006 — P2: A food deletion can silently revert another meal edit while the input still shows it

- **Location:** `src/app/pages/MealPage.tsx:110–120`; whole-record persistence at `src/db/db.ts:92–94`.
- **Trigger:** Change one food's grams, then remove a different food before the blur-triggered save has reached the component's live snapshot.
- **Defect/impact:** Both handlers create complete meal replacements from the same captured props. The blur write contains the changed grams; the deletion write contains the old grams and the deletion. The later `put()` wins, silently losing the accepted grams edit. This requires neither duplicate foods nor the key-reuse defect in R1-037.
- **Verification — executed end to end in the production browser with synthetic data:** Used two distinct foods at 100 g. Held an owned IndexedDB write transaction for two seconds to expose ordinary pending-persistence latency, changed spinach to 125 g, and clicked Remove on almonds. After completion, actual storage contained only spinach at `grams:100`, while its visible input still said `125`.
- **Fix direction:** Apply edits transactionally to the latest stored meal or through one shared current draft; do not independently replace whole records from stale props.

### R4-007 — P2: Codex terminal failures are hidden if any earlier answer text exists

- **Location:** `server/agents.ts:155–165`; caller at `:304–306,323–326`.
- **Trigger:** A Codex run emits an interim `agent_message` and later a terminal `turn.failed` event.
- **Defect/impact:** The parser records the failure but returns success whenever accumulated text is nonempty. The caller also discards the process exit status. Brain receives an ordinary successful answer instead of a failed/partial turn and loses the actual terminal error.
- **Verification — executed without a real agent:** Fed `item.completed` with `I will check your results`, followed by `turn.failed` with `Quota exhausted`, into actual `parseCodex()`. It returned `{"ok":true,"text":"I will check your results"}`.
- **Fix direction:** Give terminal failure precedence over prior text and distinguish completed output from partial/interrupted answers.

### R4-008 — P2: Brain cannot distinguish saved protocol weekdays and meal timing

- **Location:** `server/healthTools.ts:327–334`; fallback projection at `server/assistant.ts:42`.
- **Trigger:** Ask about an unstarted protocol whose item is evening, Monday/Wednesday/Friday, with a meal.
- **Defect/impact:** Both `get_protocols` and the fallback data summary drop `days` and `withFood`. They supply the same model context as an every-day evening item without a meal. An unstarted protocol has no corresponding Habits from which the missing schedule could be recovered.
- **Verification — executed with synthetic snapshots:** Compared one item with `days:["mon","wed","fri"]`, `withFood:true` against an otherwise identical item omitting those fields. Actual `healthTools(...).get_protocols.execute()` outputs were identical, and actual `dataPack()` strings were identical.
- **Fix direction:** Include normalized weekday and with-food instructions in every model-facing protocol projection.

### R4-009 — P3: The app advertises Mistral effort controls that its installed SDK discards

- **Location:** `src/core/aiProviders.ts:219–224`; forwarding at `server/models.ts:52–53`; SDK capability branch at `node_modules/@ai-sdk/mistral/src/mistral-chat-language-model.ts:56–73,150–207`.
- **Trigger:** Select the offered `mistral-large-latest` model and change effort between Low and High.
- **Defect/impact:** Effort is advertised at provider level, but the installed SDK marks that model as not supporting reasoning effort and omits the saved setting from requests. The control has no effect for the selectable default model.
- **Verification — executed with a mocked fetch transport, no external provider:** Generated requests through the installed Mistral SDK using the same provider options for Low and High. Neither request contained `reasoning_effort`.
- **Fix direction:** Make exposed effort levels model-aware and hide/reject unsupported no-op settings.

### R4-010 — P3: Local model discovery rejects an IPv6 endpoint that eligibility accepts

- **Location:** `server/http.ts:74–76`; accepted loopback policy at `src/core/aiProviders.ts:311,329–337`.
- **Trigger:** Configure Ollama at `http://[::1]:11434/v1`.
- **Defect/impact:** Provider eligibility accepts IPv6 loopback and Settings accepts the address, but discovery's separate regex allows only localhost/127.0.0.1. It returns an empty list and “must run on this computer” before trying the supported local address.
- **Verification — executed against actual HTTP routing with temporary settings:** `canUse()` returned `{"ok":true}`. GET `/api/settings/models/ollama` returned HTTP 200 with `{"models":[],"error":"Ollama must run on this computer."}`. No real Ollama service or IPv6 network connection was needed because the rejection occurs first.
- **Fix direction:** Reuse the URL-based loopback eligibility policy for discovery instead of a narrower duplicate check.

### Round 4 verification and exclusions

- `bun run test`: **57 files / 776 tests passed**, exit 0; the existing AI SDK image-part deprecation warning remained.
- `bun run build`: **passed**, including both TypeScript projects and production bundling, exit 0; the existing large-chunk warning remained.
- Browser checks used an isolated static preview origin and synthetic browser-only IndexedDB records, without contacting a folder-backed user profile or model. They exercised the actual intake row and the meal-edit/delete race. The persistence delay was a temporary test transaction, not an application-code change.
- Other probes exercised actual fitness comparisons/summary generation, protocol activation/date validation, Codex event parsing, both protocol-context projections, Mistral request construction with mocked fetch, and the local-model discovery HTTP route with temporary storage.
- Existing findings were not counted again for merely reaching another consumer. Broad vitamin-K food filtering for recognized blood thinners was not added as a new defect: it is explicitly documented as a conservative policy. No new medical recommendation or external literature revalidation is claimed.
- The optional eyes-closed recording mismatch is distinct from percentile/bound arithmetic and from previously reported fitness-age clamping. The stale meal-write race is distinct from duplicate-food row-key reuse. No application source, permanent tests, configuration or knowledge data was edited.

### Cumulative triage after Round 4

| Scope | P1 | P2 | P3 | Distinct findings |
|---|---:|---:|---:|---:|
| Rounds 1–3 | 14 | 66 | 2 | 82 |
| Round 4 additions | 0 | 8 | 2 | 10 |
| Cumulative | 14 | 74 | 4 | 92 |

Round 4 adds no new P1 finding. Its material defects concern incomplete-data disclosure, schedule/variant fidelity, unsupported quantitative comparisons, lost edits and failure-state reporting; each entry states exactly which parts were executed versus source-confirmed.

## Round 5 — import identity, screening provenance and state boundaries

This pass adds nine distinct findings, excluding the previous 92 entries and their root-cause variants. Reviewed device/lab imports and their review/save paths, research retrieval and evidence screening, chart state/statistics, and selected clinical-input and attachment boundaries. Earlier findings are historical review receipts, not a claim that the repository has remained unchanged between rounds.

### R5-001 — P1: Short full names remain in document text sent to the model

- **Location:** `src/app/brain/logic.ts:41–49`; outbound use at `src/app/brain/store.ts:272–275`; privacy promise at `src/app/components/ProfileForm.tsx:44–52`.
- **Trigger:** A supported profile name is `Li Wu` or `吴敏`, and an attached ordinary document contains that name.
- **Defect/impact:** The redactor drops every name part shorter than three characters, then returns the original text when none remain. It never separately matches the full name, despite the full-name redaction contract. Identifying text therefore remains associated with the health document in the selected model's prompt.
- **Verification — executed, no external model:** Passed `Patient: Li Wu. Follow-up note: fatigue improved.` through actual `redactName()` and `questionWithFiles()` using neutral filename `note.txt`. The text remained unchanged and `nameStillInPrompt` was true. The two-character Chinese name also remained; the control name Anna Kovacs was redacted. The application's call to these helpers before transport was source-confirmed; no real provider received the document.
- **Fix direction:** Always redact the normalized full profile name, independently of the minimum-length policy for individual parts; retain appropriate boundaries and escaping.
- **Distinctness:** R1-029 concerns filenames never being redacted. This finding uses a nonidentifying filename and a failure inside the document-body redactor itself.

### R5-002 — P2: Explicitly negated profile conditions increase calculated cardiovascular risk

- **Location:** `src/core/heartAge.ts:89–91`.
- **Trigger:** Enter `No diabetes. No hypertension treatment.` in the free-text conditions field.
- **Defect/impact:** Both positive-keyword regexes treat the denied conditions as affirmative. Framingham then uses the diabetes and treated-blood-pressure coefficients, presenting a materially different numerical risk/heart age rather than the facts the person entered. This is not merely a conservative suggestion filter: it changes the model's factual inputs.
- **Verification — executed actual input collection and calculations:** For the same synthetic woman born `1976-10`, 170 cm, 70 kg, never smoking, with 125/80 on `2026-10-29`, empty conditions produced `diabetes:false`, `treatedBp:false`, risk `0.044352803487486825`, heart age `50.73487411994447`. The explicit negative text produced both flags true, risk `0.1291386737088267`, heart age `76.41491044460243`.
- **Fix direction:** Do not infer affirmative diagnoses/treatment from negated history. Prefer explicitly confirmed inputs for these numerical-model variables, and expose ambiguity rather than silently treating it as yes.

### R5-003 — P2: A supported device-series remapping can crash the entire review

- **Location:** `src/app/pages/DeviceImportPage.tsx:380–381,415–424`.
- **Trigger:** Import CSV `Date,Weight (kg)` / `2026-10-01,80`, then change “Import as” from Body weight to Body fat.
- **Defect/impact:** Recalculation correctly drops the now-impossible 80% body-fat value and returns an empty series. `SeriesRow` still dereferences its first/last dates unconditionally. The app unmounts to a blank page instead of retaining the mapping controls so the person can correct the selection; the in-progress review is lost.
- **Verification — executed in the actual production browser UI:** Uploaded the synthetic CSV, observed the accepted weight review, selected Body fat, and captured `TypeError: Cannot read properties of undefined (reading 'date')`. The resulting screenshot showed a blank app. The filtering helper independently returned `dropped:1, days:[]`.
- **Fix direction:** Support an empty remapped-series state, keep its controls available, and exclude it from saving without dereferencing absent endpoints.

### R5-004 — P2: Spaced ASCII inclusive comparators disappear during lab parsing

- **Location:** `src/core/importers/labText.ts:89–94`.
- **Trigger:** A supported lab row prints `C-reactive protein <= 0.3 mg/L` or `>= 0.3 mg/L`.
- **Defect/impact:** Tokenization joins a comparator to the following number only when there is no `=` between them. It discards the separate comparator token and parses `0.3` as exact. The row has no review problems, and normal save validation preserves the falsely exact result.
- **Verification — executed parsing through save validation:** Actual `parseLabNumber("<= 0.3")` returned qualifier `<`, but `parseLabText()` produced `value:"0.3", problems:[]`; actual `validateManualEntry(..., "pdf")` saved it without a qualifier. `>= 0.3` lost `>` the same way. Controls `< 0.3` and `≤ 0.3` retained `<`.
- **Fix direction:** Join the complete supported comparator, including optional `=`, before splitting tokens.
- **Distinctness:** R1-020/R1-055 concern consumers mishandling a qualifier that exists. This parser removes it before storage.

### R5-005 — P2: Lab deduplication discards exact and censored results as if they were identical

- **Location:** `src/core/trends.ts:199–202`; discard path at `src/app/components/LabReview.tsx:124–129`.
- **Trigger:** Store CRP `<0.3 mg/L` and import a report with exact `0.3 mg/L` on the same date, or import in the reverse order.
- **Defect/impact:** `isAlreadySaved()` compares marker/date/numeric value but omits the qualifier. Lab review therefore skips a genuinely different observation as already saved. The person cannot retain the new exact-versus-bound information through that Save action.
- **Verification — executed actual parsers, validation and duplicate predicate:** Both rows parsed with no problems and validated successfully. The existing result retained `qualifier:"<"` and the candidate had none, yet actual `isAlreadySaved()` returned true. The UI's unconditional skip for that result was source-confirmed, not clicked in a full lab import.
- **Fix direction:** Include the normalized qualifier in measurement identity while retaining canonical-unit equivalence.
- **Distinctness:** R1-049 is a failure to remove duplicate rows within one pending batch. This is the opposite failure: discarding non-equivalent observations against existing storage.

### R5-006 — P2: Refreshed titles/abstracts cannot invalidate cached evidence-screening decisions

- **Location:** `tools/evidence/screen.ts:53–55`; selection consumption at `tools/evidence/build.ts:49–52`.
- **Trigger:** Screening rejected a review because its abstract was unavailable; a later fetch supplies the abstract without changing the outcome question or PMID.
- **Defect/impact:** Reuse is keyed only by question and PMID, not the text actually screened. The review is never reconsidered and the builder continues excluding it. Changed abstracts can likewise retain obsolete approvals. Published selection no longer necessarily reflects the current source records.
- **Verification — executed runner logic with mocked process/filesystem boundaries:** Seeded PMID 100 with a cached rejection stating no abstract was available, supplied its now-complete abstract plus new PMID 200, and ran the actual `screen.ts` body after TypeScript transpilation. Only the new record was sent to the mocked screening process. Actual `splitByScreening()`/`chooseFrom()` still selected only `["200"]`.
- **Fix direction:** Store and compare a fingerprint of the actual screening inputs, including title, abstract, question and screening mode; rescreen changed inputs.
- **Distinctness:** R2-003 changes the question and takes an unscreened builder fallback. Here the question is unchanged, matching screening exists, and a stale decision is actively reused.

### R5-007 — P2: Reused evidence decisions are attributed to a model that never screened them

- **Location:** `tools/evidence/screen.ts:43–47,65–66`; published attribution at `tools/evidence/build.ts:93–98`.
- **Trigger:** Retain decisions from Opus, rerun the supported screening command with `sonnet`, and encounter at least one new eligible review.
- **Defect/impact:** The runner overwrites the file-wide `by` field immediately while keeping old decisions unchanged. When a new batch saves, all decisions—including those never sent to Sonnet—are attributed to Sonnet. The builder publishes this incorrect provenance for the retained outcomes.
- **Verification — executed in the same isolated runner probe:** Captured persisted `reportedModel:"Claude Code (sonnet), titles and abstracts only"` alongside the unchanged old decision previously recorded under Opus; the mocked process handled only the new review. The builder's copying of global attribution was inspected. Full map publication/browser rendering was not run.
- **Fix direction:** Preserve per-decision/batch attribution and describe mixed provenance accurately, or explicitly rescreen when changing the model.
- **Distinctness:** This remains incorrect even when titles, abstracts and questions have not changed; it is separate from screening-input invalidation and the prior unscreened fallback.

### R5-008 — P2: Attached document text is silently cut after the client says it fits

- **Location:** `src/app/brain/logic.ts:53–61`; unconditional transport truncation at `server/http.ts:297–302`.
- **Trigger:** Send an 8,000-character question with one document shorter than the client's 14,000-character attachment-text allowance.
- **Defect/impact:** The attachment budget ignores the question and wrapper lengths. The prepared message exceeds the server's 20,000-character limit, so the server silently slices away the document tail instead of reporting input truncation. The helper inserts no shortening notice because the document itself fits its allowance; the model can answer an incomplete document while the turn appears successful.
- **Verification — executed actual HTTP route, settings and SDK request construction with mocked model transport:** Actual `questionWithFiles()` prepared 22,017 characters with no shortening notice. Posted it to an isolated `/api/assistant`; the captured provider-bound user message was exactly 20,000 characters and omitted `END_OF_DOCUMENT_SENTINEL`. The route returned HTTP 200 and `ok:true, truncated:false`. No external service was called, and temporary settings were removed.
- **Fix direction:** Budget the complete message—including question, filenames, wrappers and notices—before sending. Surface any input shortening explicitly; do not silently slice an otherwise accepted document.

### R5-009 — P3: Deleting a chart endpoint leaves its viewport outside the remaining data

- **Location:** `src/app/components/timeControls.tsx:79–85`; changing data bounds at `src/app/components/TrendChart.tsx:110–125`.
- **Trigger:** With ferritin results in 2010 and 2026, select 1M and delete the 2026 result from the same marker page.
- **Defect/impact:** The explicit view survives a change to `full` without being clamped/reset. The chart remains in 2026 with zero visible results even though the remaining measurement is in 2010. Because zoom state compares spans rather than viewport containment, Zoom out is disabled and the overview strip disappears.
- **Verification — executed in the actual production browser UI:** Used synthetic ferritin 45 on `2010-10-29` and 50 on `2026-10-29`, chose 1M, and confirmed deletion through the normal controls. The chart's accessible description said `0 results from Oct 3, 2026 to Nov 2, 2026`; Zoom out was disabled. The screenshot showed an empty chart. Pressing All recovered `1 results from Oct 22, 2010 to Nov 5, 2010`, confirming no data loss.
- **Fix direction:** Reconcile an explicit viewport/selection with the new full domain when measurements change, and keep navigation state consistent with containment.

### Round 5 verification and exclusions

- `bun run test`: **57 files / 778 tests passed**, exit 0. The AI SDK image-part deprecation warning remained.
- `bun run build`: **passed**, including both TypeScript projects and production bundling, exit 0. The large-chunk warning remained.
- Browser checks used an isolated static-preview origin, synthetic IndexedDB records and a synthetic CSV; they exercised real remapping, deletion, confirmation and chart-reset interactions. Review records and the CSV were removed, and the preview was stopped.
- Executed helper probes for document redaction, heart-risk inputs/calculations, lab tokenization/validation/deduplication, and empty-series filtering. The screening runner used in-memory filesystem/process boundaries and actual classification/selection functions; no real screening model ran.
- The assistant HTTP probe used a temporary data directory, disabled MCP servers and a mocked local-model HTTP transport; actual route parsing and provider request generation ran. No patient data, external provider or installed agent was used.
- Do not interpret the passing baseline as disproving these uncovered paths. No permanent tests or application fixes were added. Existing application/configuration/knowledge changes were left untouched.
- Did not recount tied fitness bounds, duplicate-day coverage, prior screenshot/date/unit bugs, or another consumer of an already reported root cause. Speculative same-day blood-draw identity and current-profile historical assumptions were not promoted to findings without a stronger supported contract/reproduction.

### Cumulative triage after Round 5

| Scope | P1 | P2 | P3 | Distinct findings |
|---|---:|---:|---:|---:|
| Rounds 1–4 | 14 | 74 | 4 | 92 |
| Round 5 additions | 1 | 7 | 1 | 9 |
| Cumulative | 15 | 81 | 5 | 101 |

The new high-priority item is document-body identity disclosure for short names (**R5-001**). Other additions concern incorrect risk inputs, import crashes and identity loss, stale/misattributed evidence, silent input truncation and a recoverable chart-state defect.

## Round 6 — restore identity, linked writes and connection settings

This pass adds five distinct findings after excluding the previous 101 entries and their root-cause variants. Reviewed archive/filesystem and attachment boundaries; linked protocol/habit/watch mutations; assistant bridge, tool and citation handling; and connection-settings state. No application fixes were made.

### R6-001 — P2: Duplicate IDs inside a restored archive silently erase observations when the profile opens

- **Location:** `src/core/backup.ts:139–175`; archive acceptance at `server/profiles.ts:341–349`; browser ingestion at `src/app/profiles.ts:88–96`.
- **Trigger:** Restore a ZIP whose results contain two otherwise valid measurements with the same `id`, but different dates or values.
- **Defect/impact:** Import validation checks the records independently without enforcing per-table ID uniqueness. The folder and restored summary retain/count both. Opening the profile then `bulkPut()`s them into an ID-keyed IndexedDB table, silently replacing the first with the second. An ordinary subsequent save writes that reduced set back to disk. The same identity constraint applies to the other ID-keyed imported tables.
- **Verification — executed the actual restore/load/save chain:** Created a synthetic ZIP with ferritin 20 on `2026-01-01` and 40 on `2026-02-01`, both ID `same-id`. Used actual `writeZip()`, `restoreZip()`, `loadIntoBrowser()`, `browserData()` and `saveProfileData()` with temporary profile storage, fake IndexedDB and a mocked profile-data GET. Observed `summaryRows:2, folderRowsBefore:2, browserRows:1, folderRowsAfterSave:1`. A separate JSON restore probe likewise accepted two rows and stored one.
- **Fix direction:** Reject duplicate IDs within each imported table before publishing a restored profile. Preserve intended merge behavior when an incoming ID replaces an existing destination record; that is different from duplicate identities inside one input.
- **Distinctness:** Earlier restore findings concern omitted files/entities, size/name limits, partial publication or mixed file generations. This is an unchecked identity invariant at the folder-to-browser boundary.

### R6-002 — P2: A failed initial watch leaves a saved habit that is duplicated on retry

- **Location:** `src/app/pages/HabitsPage.tsx:437–447`; separate watch transaction at `src/db/db.ts:168–173`.
- **Trigger:** Create a new habit with “Watch what changes” enabled and encounter an experiment-store write failure after the habit write commits, such as insufficient storage.
- **Defect/impact:** `addProtocol()` commits independently before `watchHabit()` starts its transaction. Failure leaves the habit without the requested watch; `onDone()` is skipped and the form becomes usable again. Retrying the same form creates another habit rather than completing the first operation.
- **Verification — executed actual mutations with fault injection:** Used a uniquely named fake-IndexedDB database and an experiment-creation hook throwing `QuotaExceededError`. The form's actual mutation sequence rejected and left `habits:1, watches:0`. Removing the fault and repeating it produced `habits:2, watches:1`. The React form's retry/control flow was inspected; real browser storage exhaustion was not attempted.
- **Fix direction:** Persist the habit and its initial watch in one transaction, following the existing atomic experiment-creation pattern; report failures without publishing half the requested operation.
- **Distinctness:** This is not the previously reported double-start race. One normal submission fails between two independently committed entity writes, and its retry duplicates the partially created habit.

### R6-003 — P2: Unicode basename truncation can make the Files view fail during URL construction

- **Location:** `server/profiles.ts:256–264,277–280`; `src/app/profiles.ts:283–284`; rendering at `src/app/pages/DataPage.tsx:143–154`.
- **Trigger:** Keep a PDF named `"A" + "\u{10400}".repeat(40) + ".pdf"` (85 UTF-16 code units). These supplementary-plane letters pass the sanitizer; the original name is below the metadata-length limit.
- **Defect/impact:** `.slice(0, 80)` splits a surrogate pair in the sanitized basename. The file and index entry are created, but the stored name contains a lone high surrogate. `fileUrl()` throws when encoding it, so rendering the Files list fails instead of providing open/download/delete controls.
- **Verification — executed filesystem and actual URL helper:** In temporary profile storage, actual `addFile()` succeeded and `listFiles()` returned the attachment with its original name intact. The stored basename ended in code unit `d801`; actual `fileUrl()` threw `URIError: String contained an illegal UTF-16 sequence.` The complete Files-page browser crash was source-confirmed from its render-time helper calls, not exercised.
- **Fix direction:** Truncate on Unicode code-point boundaries while retaining the current extension and collision handling.
- **Distinctness:** R1-009 truncates an original filename's extension during metadata handling. Here both original metadata and extension are intact; the stored basename itself is invalid Unicode.

### R6-004 — P2: Test remains enabled for unsaved connection changes and validates the old configuration

- **Location:** `src/app/components/settings/ModelsSettings.tsx:153,294–314`; saved-only test endpoint at `server/http.ts:135–147`.
- **Trigger:** Start with a saved, usable Ollama configuration, change its Address without changing provider/model/effort, then press Test before Save. An entered replacement API key has the same dirty-state omission.
- **Defect/impact:** `saved` compares only provider/model/effort, ignoring the configuration draft and key. The page still presents the selection as ready/in use and enables Test, but its POST contains no draft and the server tests persisted settings. A successful result is therefore not evidence that the address/key currently shown works.
- **Verification — executed browser behavior plus a separate actual endpoint probe:** With mocked settings/test HTTP boundaries, changed the visible address from port 11434 to 21434. Test remained enabled; clicking it sent `POST /api/settings/test` with no body and no preceding provider PUT. Separately, the actual endpoint with temporary saved settings and mocked model transport returned success while issuing its SDK request to `http://127.0.0.1:11434/v1/chat/completions`. No external model or real secret was used.
- **Fix direction:** Include configuration and pending key changes in dirty-state detection and disable Test until they are saved, or explicitly test the visible draft without implying it is already the active configuration.

### R6-005 — P3: Saving a new local endpoint leaves its model list cached from the old endpoint

- **Location:** `src/app/components/settings/ModelsSettings.tsx:42–52,108–116`.
- **Trigger:** Load Ollama's models, change Address to another local server/port with a different model list, then Save.
- **Defect/impact:** Discovery is cached only by provider ID. The post-save settings refresh does not invalidate that cache, and `useLoadedList()` refuses another lookup while that provider has an entry. The model chooser continues offering the previous server's models (or its cached error) rather than the newly saved endpoint's list.
- **Verification — executed in the actual browser UI with mocked HTTP:** Initial discovery returned `Old endpoint model`. Saved Address `http://127.0.0.1:21434/v1`; the mock would return `New endpoint model` for a lookup after that save. Captured only one discovery request across the whole scenario, followed by both save PUTs and the settings GET. The reopened dropdown still offered `Old endpoint model` and `Other model…`; the screenshot confirmed the new address and stale choices together.
- **Fix direction:** Invalidate/reload a provider's discovery result when its persisted discovery inputs change. Manual model entry remains a workaround.
- **Distinctness:** R4-010 rejects an otherwise eligible IPv6 address in the server's loopback policy. R3-009 concerns cached Brain readiness consuming a pending question. This cache has a different key, lifecycle and consequence.

### Round 6 verification and exclusions

- `bun run test`: **57 files / 778 tests passed**, exit 0; the AI SDK image-part deprecation warning remained.
- `bun run build`: **passed**, including both TypeScript projects and production bundling, exit 0; the large-chunk warning remained.
- Exercised actual archive creation/restoration, filesystem attachment storage, profile-to-IndexedDB loading and subsequent folder saving using synthetic data. All temporary directories and fake databases were deleted.
- Exercised watched-habit creation with an injected experiment-write failure and a retry; no real profile or browser quota was modified.
- Browser settings checks used an isolated static-preview origin and mocked local API boundaries. The separate Test-endpoint probe used real HTTP routing and SDK request generation with a mocked provider response. No real provider, installed agent or external research server ran.
- Browser records were cleared, the review tab closed and the preview stopped. No application source, permanent tests, configuration, knowledge data or dependencies were edited.
- Did not promote intentionally retained habits on protocol deletion, explicitly wait-only Stop semantics, or another consumer of a previously reported root cause. Citation history already unions retrieved IDs across conversation turns, and `read_skill` explicitly checks enablement; those suspected issues were rejected after tracing the consumers. No additional archive traversal, symlink or cross-origin disclosure defect was established.

### Cumulative triage after Round 6

| Scope | P1 | P2 | P3 | Distinct findings |
|---|---:|---:|---:|---:|
| Rounds 1–5 | 15 | 81 | 5 | 101 |
| Round 6 additions | 0 | 4 | 1 | 5 |
| Cumulative | 15 | 85 | 6 | 106 |

Round 6 adds no new P1 finding. The new defects concern restore identity loss, partial linked writes, invalid attachment names and connection-settings feedback/discovery.
