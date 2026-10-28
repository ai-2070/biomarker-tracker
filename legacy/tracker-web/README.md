# Biomarker Tracker

A free, open-source, local-first web app for tracking your bloodwork over the years. No install, no account, no server. Your data stays in your browser.

**Not medical advice. Not a medical device.**

## Status

- v0.1: manual entry, per-marker trend charts with reference ranges, out-of-range and critical-value flags, JSON backup and restore. 21 markers in the knowledge base.
- v0.8: self-experiments: pick one change and the markers to watch, re-test after 4–12 weeks, and see whether the before/after difference is bigger than that marker's normal test-to-test variation (log-normal reference change value, using within-person variation from the EFLM Biological Variation Database). Re-test reminders appear on the results page.
- v0.7: "What is known to raise/lower it" on marker pages: 13 evidence-graded levers (foods, diet, supplements, habits) for ferritin, iron, B12, folate, vitamin D, LDL, triglycerides and HDL, with measured nutrient amounts per portion from the UK CoFID 2021 food composition table. Foods and options are hidden when the log shows blood thinners, kidney disease or pregnancy. "Add it to your log" puts the change on your chart.
- v0.6: research panel on each marker page (Europe PMC with PubMed fallback; only search words are sent) and optional AI questions about the retrieved studies using your own Anthropic, OpenAI or local Ollama setup. You see the exact text before it is sent; every citation in the answer is checked against the retrieved studies.
- v0.5: log of supplements, diet changes, medicines and habits with start/end dates, shown as bars aligned under each marker chart and as "At the time: …" next to each result. Logging blood thinners, diabetes medicines, pregnancy or kidney disease shows a prominent "talk to your doctor" note.
- v0.4: lab report import from PDF (read in the browser with pdf.js, nothing uploaded) or pasted text, with a review screen where every value is confirmed before saving. Synthetic German, Hungarian, US and UK report fixtures in `tests/fixtures/lab-text`. Scanned (image-only) PDFs aren't supported yet.
- v0.3: knowledge base of 37 markers (full blood count, lipids, glucose/HbA1c, liver, kidney, thyroid, iron panel, vitamin D, B12, folate, CRP, electrolytes), with names in English, German, Hungarian, French, Spanish and Italian. Every source verified against Europe PMC.
- v0.2: biological age (PhenoAge, Levine et al. 2018) from same-day blood draws, with history and an explanation page. Formula verified against the paper and the BioAge R package.

## Develop

Uses [Bun](https://bun.sh) as the package manager and script runner.

```bash
bun install
bun run dev        # http://localhost:5173
bun run test       # unit tests with Vitest (core, knowledge base, db)
bun run build      # typecheck + static build in dist/
```

Use `bun run test`, not `bun test`: the latter starts Bun's own test runner instead of Vitest.

Stack: Vite, React, TypeScript (strict), Tailwind CSS v4, Base UI (`@base-ui/react`), Dexie (IndexedDB), Recharts, Vitest.

## Layout

- `src/core` – pure, tested logic: units, trends and flags, entry validation, backup format, knowledge validation
- `src/db` – Dexie schema and queries
- `src/app` – React UI
- `knowledge/biomarkers` – one JSON file per marker, each with verified sources
- `tests` – Vitest suites

See `CLAUDE.md` for the principles every change must follow.

## Privacy

The production build ships a Content Security Policy whose `connect-src` allows only the app itself, Europe PMC, PubMed, the Anthropic and OpenAI APIs, and a local Ollama. The browser blocks every other network request. Any new endpoint must be added there and to the allowed-endpoints list in `CLAUDE.md`.

To use Ollama, start it with your page's origin allowed, e.g. `OLLAMA_ORIGINS=http://localhost:5173 ollama serve`.
