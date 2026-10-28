# Biomarker Tracker

A free, open-source, local-first web app for tracking your bloodwork over the years. No account, no cloud. Your data stays in your browser, and an optional assistant runs through a small server on your own computer.

**Not medical advice. Not a medical device.**

## Status

- v0.12: sidebar layout and a Dashboard home: biological age, markers in range and to watch, a multi-year timeline of blood tests, biological age and supplements, marker charts, what you're taking now, experiments. Body and Devices (Android Health Connect sync) are marked as coming soon.
- Settings has tabs for Your data (person, "A bit more", files, backups), AI models, Skills, MCP servers, Appearance and About (version, source code).
- v0.11: import a lab report from a photo or a scanned PDF. Text recognition runs on this device (English, German, Hungarian); nothing is uploaded. The review screen asks to check every value, and values far outside the lab's own range (a lost decimal point) are unticked with a note. Example profile with made-up data for trying the app.
- v0.10: profiles. Each person is a folder on this computer with their details (name, birth month, sex, height, diet, smoking, conditions, allergies, notes), results, log, experiments and scanned lab reports. A setup wizard on first start and for each new profile; switch profiles from the header; back up a profile as a .zip, restore it, show its folder, delete it. Imported lab PDFs are kept in the profile.
- v0.9: assistant (Ask) through a local server. Settings has tabs for your data, AI models, Skills (8 built-in medical and nutrition research skills, plus your own) and MCP servers (PubMed, ClinicalTrials.gov, openFDA, BioMCP, medical terminologies, food data; all added and switched on from the start). Models: EU/US zero-data-retention providers (Anthropic, OpenAI, Mistral, your own endpoint), OpenRouter with zero-retention routing, local Ollama / LM Studio, or agent programs with your own login (Claude Code, Codex, Hermes, OpenClaw; labelled because the app can't check what they keep). The assistant reads your results with tested tools, searches the research, and every citation is checked.
- v0.1: manual entry, per-marker trend charts with reference ranges, out-of-range and critical-value flags, JSON backup and restore. 21 markers in the knowledge base.
- v0.8: self-experiments: pick one change and the markers to watch, re-test after 4–12 weeks, and see whether the before/after difference is bigger than that marker's normal test-to-test variation (log-normal reference change value, using within-person variation from the EFLM Biological Variation Database). Re-test reminders appear on the results page.
- v0.7: "What is known to raise/lower it" on marker pages: 13 evidence-graded levers (foods, diet, supplements, habits) for ferritin, iron, B12, folate, vitamin D, LDL, triglycerides and HDL, with measured nutrient amounts per portion from the UK CoFID 2021 food composition table. Foods and options are hidden when the log shows blood thinners, kidney disease or pregnancy. "Add it to your log" puts the change on your chart.
- v0.6: research panel on each marker page (Europe PMC with PubMed fallback; only search words are sent) (the in-browser AI questions from v0.6 were replaced by the assistant in v0.9).
- v0.5: log of supplements, diet changes, medicines and habits with start/end dates, shown as bars aligned under each marker chart and as "At the time: …" next to each result. Logging blood thinners, diabetes medicines, pregnancy or kidney disease shows a prominent "talk to your doctor" note.
- v0.4: lab report import from PDF (read in the browser with pdf.js, nothing uploaded) or pasted text, with a review screen where every value is confirmed before saving. Synthetic German, Hungarian, US and UK report fixtures in `tests/fixtures/lab-text`. Scanned (image-only) PDFs aren't supported yet.
- v0.3: knowledge base of 37 markers (full blood count, lipids, glucose/HbA1c, liver, kidney, thyroid, iron panel, vitamin D, B12, folate, CRP, electrolytes), with names in English, German, Hungarian, French, Spanish and Italian. Every source verified against Europe PMC.
- v0.2: biological age (PhenoAge, Levine et al. 2018) from same-day blood draws, with history and an explanation page. Formula verified against the paper and the BioAge R package.

## Develop

Uses [Bun](https://bun.sh) as the package manager and script runner.

```bash
bun install
bun run dev        # http://localhost:5173
bun run server     # the assistant's local server on 127.0.0.1:4820 (run next to dev)
bun run start      # build, then serve the app and the assistant at http://localhost:4820
bun run test       # unit tests with Vitest (core, knowledge base, db)
bun run build      # typecheck + static build in dist/
```

Use `bun run test`, not `bun test`: the latter starts Bun's own test runner instead of Vitest.

Stack: Vite, React, TypeScript (strict), Tailwind CSS v4, Base UI (`@base-ui/react`), Dexie (IndexedDB), Recharts, Vitest.

## Layout

- `src/core` – pure, tested logic: units, trends and flags, entry validation, backup format, knowledge validation
- `src/db` – Dexie schema and queries
- `server` – the local server: settings, models, skills, MCP, assistant
- `skills` – built-in skills (SKILL.md)
- `src/app` – React UI
- `knowledge/biomarkers` – one JSON file per marker, each with verified sources
- `tests` – Vitest suites

See `CLAUDE.md` for the principles every change must follow.

## Privacy

The production build ships a Content Security Policy whose `connect-src` allows only the app itself, Europe PMC and PubMed. The page never calls an AI model; the local server does, and only after you ask a question. It only allows EU/US providers with zero data retention (which you confirm for your account) or local models. API keys stay in `data/secrets.json` on your computer and are never sent to the page or put in backups. MCP servers you switch on get search terms, not your results.

The MCP servers need Node.js (`npx`); the first start downloads them. Agent programs must be installed and signed in on this computer. Hermes gets the app's tools after you press Connect in Settings → AI models, which adds one entry to Hermes' own MCP settings (Disconnect removes it).
