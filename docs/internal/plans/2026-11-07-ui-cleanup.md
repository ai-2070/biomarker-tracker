# UI clean-up: Brain split, Base UI tabs, folds and selects, shared styles — plan, 2026-11-07

Branch: `LZL0/ui-cleanup`. One commit per phase; one PR at the end. No change in what the app does or says: same text, same data, same safety rules. Where behaviour changes (keyboard, motion), it's listed.

## Why

An earlier project review (rechecked against the code on 2026-11-07) listed AI-layer and background-process problems that the 2026-11-04 plan has since fixed: streaming, step limits, process trees, partial saves, OCR, CLAUDE.md, the failing persistence test (passes now). These UI items are still open:

- **`brain/Brain.tsx` is 1,177 lines with 21 components.** The chat cards (`HabitTurn`, `ProtocolTurn`, `MealTurn`, about 100 lines each), the review card and the composer all live in one file. It defines its own `SavedResults` (line 641), which has the same name as `components/SavedResults.tsx`.
- **Hand-built tab rows in 6 files** (`FoodComparison`, `EvidenceMap`, `dashboard/fitness`, `AddResult`, `IntakePage`, `HabitsPage`): `role="tab"` buttons with **no arrow-key handling** and, in 4 of them, no `tabpanel`. So screen readers announce tabs that don't act like tabs. Base UI Tabs is used once (`SettingsPage`).
- **50 native `<details>` in 28 files**, each styled by hand (a dozen different `<summary>` class strings), while the Base UI wrappers `Fold` / `Rows` / `Row` (`components/disclosure.tsx`) are used in 3 files. Folds open with an animation on some pages and jump open on others.
- **8 native `<select>`s in 4 files** (`AddToProtocol`, `IntakePage` ×4, `HabitsPage` ×2, `PlanPage`), while `SimpleSelect` (`components/UnitSelect.tsx`) exists.
- **Repeated styles:** the small uppercase label (`font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase`, and an 11px menu variant) is copied in 17 files; about 31 class strings repeat the `Card` look.
- **Large files:** `IntakePage.tsx` 850 lines, `dashboard/body.tsx` 747, `HabitsPage.tsx` 674.

Left as it is, on purpose: the Brain window stays a hand-built dialog (its grow/shrink animation needs it); `bg-black/30`, `bg-black/40` scrims and `text-white` are fine (they don't depend on the theme); the ~229 one-off Tailwind values and the 44 inline `style={{}}` (mostly computed chart positions) aren't worth chasing one by one.

## Rules for every phase

- No new packages. Base UI (`@base-ui/react` 1.9.0) already has what's needed.
- Same visible text, same order on the page. Accessibility at least as good as before: keyboard, focus rings, 44 px targets, works at 360 px, `prefers-reduced-motion` stops the motion.
- Each phase ends with `bun run typecheck` and `bun run test` green; checked by hand in `bun dev` (keyboard only, phone width, dark mode, reduced motion) on every page it touched.
- Tests that find things by role or text keep working; where a test has to change, the commit says why.

## Phases

### Phase 0 — this plan

Commit the plan on the new branch.

### Phase 1 — split `Brain.tsx`, fix the name clash

- New files in `apps/web/src/app/brain/`, moved as they are:
  - `turns/HabitTurn.tsx`, `turns/ProtocolTurn.tsx`, `turns/MealTurn.tsx`
  - `turns/ReviewTurn.tsx`: `ReviewTurn` and its saved state, renamed from `SavedResults` to `SavedReview`
  - `turns/ProfileTurn.tsx`, `turns/LiveTurn.tsx` (with `StepList`)
  - `Composer.tsx`: `Composer`, `AttachmentChip`, `MobileTools`
- `Brain.tsx` keeps `Brain`, `Launcher`, `Panel`, the empty states (`NoServer`, `NeedsModel`, `Welcome`), `Conversation` and `TurnView`. Target: under 450 lines.
- The streaming reader (`stream.ts`) stays lazy-loaded with the first question. Check in the build output that it's still a separate chunk.
- No behaviour change. Tests: the existing suite. Checked by hand: a question with a habit, protocol, meal and photo-review card; Stop; a critical result blocking proposals.

### Phase 2 — tabs on Base UI

- New `components/SegmentTabs.tsx`: Base UI `Tabs.Root` / `List` / `Tab` / `Panel` in the existing pill look (`rounded-xl border border-line bg-sunken p-1`, the selected tab raised), with a sliding indicator like `SettingsPage` and `animate-fade` panels.
- Move the 6 hand-built rows onto it. URL-backed choices stay URL-backed (`AddResult`'s `?type=body`, `EvidenceMap`'s open claim, `fitness`'s `?section=`).
- **Behaviour change:** arrow keys, Home and End move between tabs; only the selected tab is in the Tab order; every tab has its panel.
- Test: a shared-component test (arrow keys, Home/End, `aria-selected`, `aria-controls`); existing tests that click tabs keep passing.

### Phase 3 — folds on Base UI

The 50 `<details>` are two kinds, so `disclosure.tsx` gets one more wrapper rather than forcing everything into `Fold`:

- **Sections** (a heading-sized title, sometimes a summary line): `Fold`, as now.
- **Small reveals** ("Show as a table", "Read the full summary, why this grade, and sources", "How the evidence was found", the review screens' extra details): a new `More` with a short label and `tone` / `size` options covering the summary styles in use today, plus a `boxed` variant for the bordered ones (`dashboard/body.tsx`).

Things `<details>` did for free that must keep working:

- **Find in page.** Browsers open a closed `<details>` to show a match. Panels use `keepMounted` and `hiddenUntilFound` (Base UI 1.9 has it), so closed text stays in the page and find-in-page still opens it. This also keeps tests that read text inside closed folds working.
- **In-page jumps.** `jump()` in `components/glance.tsx` opens ancestor `<details>` before scrolling. It must open the new panels too: the wrappers listen for a small `reveal` event (or `jump` uses the same `beforematch` path), tested.
- **`group-open:` styling** (chevrons in `AgesChart`, `PhenoAgePage`, `AddResult`, `WholeFoodsPage`; `open:pb-4` in `body.tsx`) moves to the wrappers' `data-[open]` styles.

Order, one commit each: knowledge pages (`findings`, `EvidenceMap`, `SupplementGuide`, `FoodComparison`, `ClaimEvidencePanel`, `DarkMatter`, `WholeFoodsPage`, `NutrientPage`, `ResearchPanel`, `LeversPanel`), then dashboards and charts (`bestBefore`, `fitness`, `body`, `AgesChart`, `CountryPopulationReference`, `CountryComparison`, `SleepTimingPanel`, `PhenoAgePage`, `TestSummaryPage`), then tools and forms (`DeviceImportPage`, `LabReview`, `AddResult`, `IntakePage`, `HabitsPage`, `ExperimentsPage`, `SavedResults`, `DoctorReportExport`, `Brain`). Any `<details>` kept on purpose is named in the ledger with the reason.

- **Behaviour change:** every fold animates the same way (200 ms height and fade; none with reduced motion).
- Tests: `More` and `Fold` (keyboard, `aria-expanded`, closed content still in the page, `jump` opens a nested panel); the existing claim-evidence, summary-page and import tests.

### Phase 4 — dropdowns on `SimpleSelect`

- Move the 8 native `<select>`s. `SimpleSelect` renders its own label: the surrounding `<label>` text moves into its `label` prop, so each field keeps exactly one visible label.
- Long lists (meals, protocols) stay usable on a phone: check the popup scrolls and fits at 360 px. If one needs a feature `SimpleSelect` lacks (e.g. a "new protocol" option with different styling), add it to `SimpleSelect`, not a one-off.
- Tests: the existing Habits, Intake and protocol tests, updated from `selectOptions` to opening the select where needed.

### Phase 5 — shared styles

- `ui.tsx`: `eyebrowStyles` (the uppercase label, with the 11px menu size as `eyebrowStyles.small` or a second constant). Replace the 17 copies.
- The ~31 repeated card strings: use `<Card>` where the element and padding match; otherwise a `cardStyles` constant, so the look is defined once. Don't merge cards that differ on purpose (sunken, bordered-only).
- Checked by screenshot comparison of the main pages before and after (light and dark), not by eye alone.

### Phase 6 — buttons

- Go through the 49 plain `<button>`s. Ones that look like `Button` variants become `Button`; chart controls, chips, icon buttons, menu rows and the Brain launcher stay plain. If a few share a look `Button` lacks (a text-only link button), add it as a variant.
- Small and optional: if it turns into many special cases, stop and note it in the ledger.

### Phase 7 — split the large pages

After phases 2–4 these files are already shorter. Split by what's on the screen, no logic changes:

- `IntakePage.tsx`: the add panel per tab (foods, meals, supplements), Load a protocol, the totals and "what would add the most" into `components/intake/`.
- `dashboard/body.tsx`: figures, the summary, and `BodyEntryForm` into separate files (`BodyEntryForm` is also used by Add data).
- `HabitsPage.tsx`: the new-habit form (start from words / meal / protocol) into its own file.
- Math stays in `packages/shared/src/core`; if a split turns up a calculation in a component, move it to core with a test.

### Phase 8 — docs and PR

- CLAUDE.md, Conventions: use `SegmentTabs` for tabs, `Fold` / `More` / `Rows` for folding, `SimpleSelect` for dropdowns, `eyebrowStyles` and `Card` for those looks; don't hand-build them.
- Full `bun run typecheck`, `bun run test`, `bun run build`.
- Open the PR with the phase list, the behaviour changes (tab keys, fold motion) and before/after screenshots.

## Out of scope

- New designs or wording changes.
- The Brain window's own dialog and focus handling.
- `apps/server/healthTools.ts` (848 lines): server side, not part of this pass.
- One-off Tailwind values and computed inline styles.

## Ledger

| Phase | Commit | Notes |
| --- | --- | --- |
| 0 Plan | | This file. |
| 1 Brain split | | |
| 2 Tabs | | |
| 3 Folds | | |
| 4 Selects | | |
| 5 Shared styles | | |
| 6 Buttons | | |
| 7 Large pages | | |
| 8 Docs | | |
