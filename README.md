# Biomarker Tracker

**Track your bloodwork over the years, and research it with AI agents.** See your results and trends in plain language, your biological age, what research says about each marker, and run self-experiments to see what actually changes in you. Teams of medical and nutrition research agents work on a live 3D map, with the models you choose.

**Not medical advice. Not a medical device.**

> **Status: being rebuilt as a desktop app** (branch `rebuild`). It is built on [Blacksite](https://github.com/ai-2070/blacksite), which brings the 3D Station, any model engine, MCP servers, skills and the desktop app. The health features from the previous web version (v0.1–v0.8: results, charts, PhenoAge, knowledge base, lab PDF import, log, evidence-graded levers, self-experiments) are being moved in. See the plan in [`CLAUDE.md`](CLAUDE.md).

## What's here so far

- **The platform:** the Station (live 3D map of your agents and teams), team chats, the Brain, Agent library, skills, routines, MCP servers, Outbox, Artifacts, desktop app. How to use it: [`docs/guide.md`](docs/guide.md) (Blacksite's guide; everything in it applies).
- **The health core** (`shared/health/`): unit conversion, trends and reference ranges, PhenoAge, reference change values for self-experiments, lab report parsing, evidence and food maths, with 279 tests.
- **The knowledge base** (`knowledge/`): 37 markers with verified sources and biological variation data, 13 graded evidence claims, and food composition data (CoFID 2021).

## Models

AI is optional, and only **EU/US providers with zero data retention**, or local models (Ollama, LM Studio), are meant to be used. The setting that enforces this is part of the rebuild.

## Run it

You need [Bun](https://bun.sh) 1.2 or newer.

```sh
bun install
bun run start        # build the page, start the server, open http://localhost:4820
bun run check        # typecheck and run all tests
```

It uses port **4820** (desktop app: 14820–14830), so it runs next to Blacksite (4800). Its data folder, projects folder (`Documents/Biomarker Tracker`) and backups (`Biomarker Tracker Backups`) are its own.

## Credits and licence

Built on Blacksite by ai-2070. Licensed MIT OR Apache-2.0 (see `LICENSE-MIT`, `LICENSE-APACHE`). Food data: McCance and Widdowson's CoFID 2021 (Open Government Licence). Biological variation: EFLM Biological Variation Database.
