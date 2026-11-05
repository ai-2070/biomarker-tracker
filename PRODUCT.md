# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Health-curious people who track their own (and their family's) health over years: blood tests, supplements and diet changes, and later wearables. Think Whoop or Oura users who also get regular bloodwork. They want a data-rich overview at a glance, but still need plain language: no medical training is assumed. One computer can hold several people (profiles), e.g. a partner or parents.

## Product Purpose

Biomarker Tracker keeps a person's health data in one place on their own computer, shows how it changes over time, explains what it means and what research says, and lets them test changes on themselves (self-experiments). Success: a person opens it, sees in seconds what is fine, what needs attention and what changed, and can dig into any number down to its sources.

## Positioning

Local-first and evidence-first. Data lives in a folder per person on the user's computer, not in a cloud account. Every number shown as fact is computed by tested code (trends, ranges, PhenoAge, test-to-test noise), never by an AI model; every claim links to a source, and AI answers have their citations checked against the studies actually retrieved. It explains and never prescribes.

## Operating Context

- Runs as a local web app (Vite + React) with a small local server on 127.0.0.1; also works as a static page with one browser-only profile.
- Data comes from typed results, lab-report PDFs, photos and scanned PDFs (on-device OCR), backups, and an example profile with made-up data.
- An optional assistant uses a model the user chooses (Claude Code by default, EU/US zero-retention APIs, or local models) plus medical/nutrition skills and MCP research servers.
- **Body**: weight, waist, body fat, blood pressure and resting heart rate, typed in by hand, with its own dashboard; the main dashboard combines blood tests and body.
- Planned (not built): **Devices**: an Android companion app (APK) that reads **Health Connect** on the phone and syncs to this computer over the local network.

## Capabilities and Constraints

- Today: profiles (folders), results with charts and reference ranges, critical-value banners, biological age (PhenoAge), knowledge base for 37 markers, evidence-graded food and habit levers, supplements/diet/medicine log, self-experiments with noise-aware before/after, research panel, assistant, settings (data, AI models, skills, MCP servers, appearance, about).
- Safety rules from CLAUDE.md are binding: no diagnosis, no personal doses, "talk to your doctor" for out-of-range or risky situations, critical values first.
- Devices is shown in navigation as "Soon" until it exists; nothing fake inside it.
- Must work at 360 px width, keyboard navigable, readable contrast, reduced-motion respected.

## Brand Commitments

- Name: Biomarker Tracker (working name).
- Look the user asked for: "medical, white, modern and simple", with the typefaces of the agents-office UI (Instrument Serif headings, Inter text, Kode Mono labels). Light/white by default; dark only when chosen.
- Footer and onboarding always say "Not medical advice. Not a medical device."
- Dashboard reference the user gave: Whoop / Oura product dashboards.

## Evidence on Hand

- Real computed data per profile (results, PhenoAge, experiments, log); the example profile (`packages/shared/src/core/demo.ts`) is clearly labelled made-up data for demos.
- No testimonials, users, press or clinical validation exist; none may be implied. Evidence grades are a developer's first draft, not clinician-reviewed.

## Product Principles

1. Code does the math, the model explains; every number traceable to its source.
2. Show what needs attention first, then the trend, then the detail.
3. Honest about uncertainty: noise bands, approximate values, gaps and "not enough evidence" are shown, not hidden.
4. The person's data stays theirs: local folders, no telemetry.
5. Plain words for every number and abbreviation.

## Accessibility & Inclusion

WCAG AA contrast, keyboard navigation, 44 px touch targets, works at 360 px, honours prefers-reduced-motion; screen-reader text for charts and status colours never carry meaning alone.
