# EFLM biological variation data: what the app used, and how to put it back

**Status (2026-11-23): removed.** The values are not in the app, the installers or the current files. They come back only if
the European Federation of Clinical Chemistry and Laboratory Medicine (EFLM) gives written permission.

## Why it was removed

The [EFLM Biological Variation Database](https://biologicalvariation.eu/) allows personal, academic and other non-commercial
use with acknowledgement. Putting its content into "another database, software application, digital product or service", or
extracting or redistributing it systematically, needs prior written permission and a written agreement with EFLM, and is
subject to a fee. This app did both: it copied values into its marker files and shipped them in a public repository and in
installers. Being free and open source doesn't change that, so the values were taken out until EFLM decides.

## What was used

For each of 61 blood markers, one record from EFLM's meta-calculations (`https://biologicalvariation.eu/api/meta_calculations`),
copied into the marker's file as `biologicalVariation`:

| Field | Meaning |
|---|---|
| `cvi` | Within-subject biological variation (CVI), %: the median of EFLM's meta-analysis |
| `ciLow`, `ciHigh` | Its confidence interval |
| `studies` | Number of studies in the meta-analysis |
| `analyte`, `matrix` | EFLM's name for the test and the sample type (for example "Serum/plasma") |
| `source`, `url`, `retrieved` | "EFLM Biological Variation Database", the page, and the date the record was copied |

Records were copied on 2026-10-28 (the first 32 markers), 2026-11-04 and 2026-11-20 (as markers were added). Only `cvi`
was used in calculations; the interval, study count and names were kept for checking and for credit.

**The 61 markers:** albumin, alkaline phosphatase (`alp`), ALT, AST, vitamin B12, basophils (absolute), bilirubin, calcium
(total), creatine kinase (`ck`), cortisol, creatinine, C-reactive protein (`crp_hs`), cystatin C, DHEA sulfate,
eosinophils (absolute), estradiol, ferritin, folate, free testosterone, FSH, free T3, free T4, GGT, glucose, HbA1c, HDL
cholesterol, haematocrit, haemoglobin, homocysteine, IGF-1, insulin, iron, LDL cholesterol, LH, lipoprotein(a), lymphocytes
(absolute), magnesium, MCH, MCHC, MCV, monocytes (absolute), MPV, neutrophils (absolute), phosphate, platelets, potassium,
progesterone, prolactin, PSA, red blood cells, SHBG, sodium, testosterone (total), total cholesterol, triglycerides, TSH,
urea, uric acid, vitamin D (25-OH), white blood cells, zinc.

EFLM had no record for the other blood markers (RDW, the white-cell percentages, eGFR, transferrin saturation, the urine
tests, corrected calcium and others), for any body measurement, or for DunedinPACE. Those always worked without it.

## How it was used

One idea only: **is a change between results more than normal test-to-test variation?** High/Low flags, To watch, the
urgent contact-a-doctor banner, ranges, charts, trends, PhenoAge and the other ages never used EFLM values.

The calculation is the log-normal reference change value (`rcvBand` in `packages/shared/src/core/experiments.ts`):
`Z × √(1/n₁ + 1/n₂) × σ`, with Z = 1.96, σ from CVI and the analytical variation CVA, and n₁ and n₂ the number of results
on each side. Labs rarely publish their own CVA, so it is assumed to be half of CVI (`DEFAULT_CVA_RATIO`), a common quality
target. Sources: Fraser 2011 (PMID 21958344), Fokkema 2006 (PMID 16873298).

| Where | Code | With EFLM values | Without them (now) |
|---|---|---|---|
| **Habits: "what changed"** for watched markers | `analyzeMarker` in `packages/shared/src/core/experiments.ts`; `apps/web/src/app/pages/ExperimentsPage.tsx` | One result before and one after are enough for "rose", "fell" or "within normal variation" | Variation from the person's own results (`personalBand`): at least 3 before and 3 after, with a wider t-based band; otherwise "Needs more results" |
| **Test summary**: change since the previous result | `compare` in `packages/shared/src/core/testSummary.ts`; `TestSummaryPage.tsx` | A change inside the band is "about the same"; outside it, "closer" or "further, by more than normal variation" | "Closer" or "further", with a note that normal variation for the marker isn't known, so a small change may be noise |
| **Year summary**: this period against the one before | `packages/shared/src/core/periodSummary.ts`; `PeriodSummaryPage.tsx` | Judged with the band for the number of results on each side | `personalBand` when each period has 3 results; otherwise "Normal test-to-test variation for this marker isn't known" |
| **Brain** | `markerDetail` and the experiment and summary tools in `apps/server/healthTools.ts` | `normalVariation` with the CVI, the one-test band and the source; experiments labelled "published biological variation (EFLM)" | "not known for this marker"; experiments use the person's own readings or say there's no data |

**Credit as it was shown:** the Habits page's "How to read this" said "Normal variation is taken from the EFLM Biological
Variation Database (within-person variation, CVI)", Brain's answers named the source, the README and the data licence list
(`DATA-LICENSES.md`, from `apps/web/src/app/dataLicenses.json`) listed it, and every record carried its source and URL.

## What changed when it was removed

- The `biologicalVariation` record was deleted from the 61 files in `knowledge/biomarkers/` (nothing else in them changed).
- The code that uses the values stayed (`rcvBand`, the `BiologicalVariation` type, its validation in
  `packages/shared/src/core/knowledge.ts`), so putting the data back needs no code changes.
- Tests that check the published-variation path use made-up values (`withVariation` and `defsWithVariation` in
  `tests/helpers.ts`), never EFLM's.
- Wording: the Habits page explains variation from the person's own results; the marker picker says it needs 3 results
  before and 3 after; the test summary says when normal variation isn't known.
- The example profile's diet experiment got a third LDL test before and after, so it still shows a fall beyond the
  person's own variation.
- `DATA-LICENSES.md`, the README and CLAUDE.md say the values were removed.

**The repository's history still contains the values** (every commit up to `b4d3ee2`). Removing them from history means
rewriting it and force-pushing, which affects everyone who has cloned it; that hasn't been done.

## Putting it back

Only after EFLM's written permission, and within whatever it allows (attribution wording, fee, scope):

1. `bun tools/eflm/restore.ts` puts every record back from `b4d3ee2`, byte for byte, into the files that still exist.
   Markers added since then have no record; copy theirs from EFLM if the agreement covers it.
2. Bring back the Habits page's credit paragraph in `ExperimentsPage.tsx` (from `b4d3ee2`), adjusted to EFLM's wording.
3. Update the EFLM row in `apps/web/src/app/dataLicenses.json` (location, terms, the agreement's date) and run
   `bun tools/data-licenses.ts`; update the README and CLAUDE.md.
4. Optionally go back to two LDL tests on each side in the example profile (`packages/shared/src/core/demo.ts`).
5. `bun run check`, `bun run test`, `bun run build`.
