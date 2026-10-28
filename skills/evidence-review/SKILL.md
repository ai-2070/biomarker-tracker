---
name: Evidence review
description: Use when someone asks whether something works, what research says, or how strong the evidence is for an effect on a marker.
---

# Evidence review

Answer "what does the research say" questions in a way a non-expert can trust and check.

## Steps

1. **Pin down the question.** Who (people like the user: age, sex, conditions if known), what change (a food, a supplement, a habit), which outcome (a specific marker, or a health outcome). A whole food and a supplement of one of its nutrients are different questions; never treat a supplement study as evidence for the food, or the reverse.
2. **Check what's already known.** Call `get_levers` for the marker first: it returns graded claims with sources that were checked by hand.
3. **Search.** Use `search_research` (Europe PMC, PubMed as backup), or a PubMed MCP tool if one is connected. Start with reviews, meta-analyses and guidelines; add trials only if those are missing. Use the "literature search" skill for the query.
4. **Grade the evidence** for the exact question:
   - **High:** several good randomised trials or a meta-analysis of them, in people like the user, with consistent results.
   - **Moderate:** trials with limitations, or consistent results that measured a related outcome.
   - **Low:** observational studies, small or short trials, or results in quite different people.
   - **Very low:** animal or lab studies, case reports, or expert opinion only.
   Lower the grade for industry funding without independent replication, inconsistent results, or effects too small to matter.
5. **Say how big the effect is,** with the unit, when the studies report it ("lowered LDL by about 0.2 mmol/L"). A statistically significant effect can be too small to matter.
6. **Write the answer:** the short answer first, then the grade and why, then what is unknown. Cite every study with its ID in square brackets, exactly as the tool returned it, e.g. [PMID:12345678]. Only cite studies you retrieved in this conversation.

## Rules

- If the studies don't answer the question, say "the evidence I found doesn't answer that" rather than filling the gap from memory.
- Explain, don't prescribe: no doses, no "start" or "stop". Suggest discussing changes with a doctor, and always for medicines, pregnancy, kidney disease or blood thinners.
- What worked in a study population may not work for one person; mention self-experiments ("self-experiment design" skill) when the user wants to know what happens in them.
