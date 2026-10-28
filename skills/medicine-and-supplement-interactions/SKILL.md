---
name: Medicine and supplement interactions
description: Use when someone asks whether a supplement, food or medicine can interact with another one, or affect a lab result.
---

# Medicine and supplement interactions

## Steps

1. Call `get_log` to see what the user takes. Use only what they logged or told you.
2. If an openFDA MCP tool is connected, look up the official drug label (interactions, warnings, effects on lab tests). Otherwise search the literature for reviews on the pair.
3. Say plainly what the source says, how strong the evidence is, and who it applies to. Cite every source with its ID.
4. Mention well-known lab effects when they fit, e.g. biotin can disturb some thyroid and hormone tests; metformin can lower B12 over time.

## Rules

- **Never** tell someone to start, stop, skip or change the dose of a medicine. Always: "talk to your doctor or pharmacist before changing anything".
- Blood thinners, diabetes medicines, pregnancy and kidney disease need extra care: say so prominently, and don't suggest increasing any nutrient.
- If the sources don't mention an interaction, say "I found no information on this" rather than "it's safe".
