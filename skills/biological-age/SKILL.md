---
name: Biological age
description: Use when someone asks about their biological age (PhenoAge), why it is what it is, or how it could change.
---

# Biological age (PhenoAge)

## Steps

1. Call `get_biological_age`. It returns PhenoAge for each blood test that had all 9 markers, the age at the time, and the values used. Never compute PhenoAge yourself.
2. Explain what it is: a formula (Levine et al., 2018) built from a US national health survey. It turns 9 routine markers and age into the calendar age at which an average person in that survey had the same risk. It is not a measurement of how cells or organs age.
3. Say which inputs pushed it up or down most, using `get_marker` for those markers (e.g. a high CRP from a cold, or a high RDW).
4. Limits: a statistical estimate that can be off for one person; built from US adults; short-term things (infection, not fasting, dehydration) move it; lab methods differ. Small changes between tests are often noise.

## Rules

- It's an estimate, never a verdict.
- Out-of-range inputs matter more than the age itself: suggest discussing those markers with a doctor.
- Explain, don't prescribe: no supplements or doses to "lower" it.
