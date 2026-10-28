---
version: 1
slug: "src-app-pages-dashboardpage-tsx"
primary_target: "src/app/pages/DashboardPage.tsx"
related_targets: ["src/app/App.tsx"]
---

# Dashboard and app shell

Scope: the app shell (sidebar navigation, mobile bottom bar) and the Dashboard home. Mode: Operate.

Audience and job: health-curious people (Whoop/Oura users with bloodwork) open the app to see in seconds what is fine, what needs attention and what changed over the years, then drill into a marker. Several profiles per computer.

Constraints: real numbers only, no invented composite scores (no sleep/readiness/recovery). Body and Devices appear in navigation as "Soon" (Devices = planned Android Health Connect companion app syncing over the local network). Safety rules: critical values first, "talk to your doctor". 360 px, keyboard, reduced motion. Existing world kept: white medical, Instrument Serif / Inter / Kode Mono, green accent.

## Direction contract

THESIS: The home is a person's health timeline, years wide, with biological age as its headline; it refuses the wearable-app "score of the day" and the lab-portal list of PDFs.

OWN-WORLD: White surfaces on a near-white ground, ink text, one green accent for the person's own line, neutral grey for calendar age, amber/red only for state. Instrument Serif for the large figures, Inter for text, Kode Mono for small uppercase labels and axis ticks. Hairline borders, 12px radius cards, quiet sidebar.

STORY: The visitor sees their biological age against calendar age, how many markers are in range and which to watch, then the timeline of every blood test with biological age drawn through it and supplements as bars beneath; they hover a test to see what was off, then open a marker.

FIRST VIEWPORT: Desktop: left sidebar (profile at top, grouped nav, Add results, Settings). Main: page title with latest test date and Add results; a row of four figure tiles (biological age with its history line, in range, to watch, next re-test or last test); the full-width timeline below. Phone: top bar with profile, figure tiles 2x2, timeline, bottom tab bar.

FORM: Timeline wall, position 5 of 7 on the ordered list, fused with the focal dial's biological-age lead at the user's request. seed: no reference (the roll ran, dealt 6, 7, 5, printed no SEED REFERENCE; the user chose 5)

Signature interaction: scrubbing the timeline: hovering or focusing a blood test column highlights it and lists that test's out-of-range markers; click opens the results list.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
