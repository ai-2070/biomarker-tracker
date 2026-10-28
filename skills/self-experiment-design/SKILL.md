---
name: Self-experiment design
description: Use when someone wants to test whether a change (a food, a habit, a supplement) changes their own results, or wants to read a before/after comparison.
---

# Self-experiment design

A self-experiment (N-of-1) answers "what happened in me", not "what works for everyone".

## Designing one

1. **One change at a time,** described concretely ("2 kiwis a day with breakfast").
2. **Pick the markers** the change could plausibly affect (use `get_levers` and the evidence).
3. **Baseline:** a result from the 4 months before starting. Without it there is nothing to compare.
4. **Re-test timing:** markers need weeks to respond. HbA1c reflects about the last 2–3 months, so wait at least 12 weeks for it. Say that the right timing varies by marker and that 8–12 weeks is a common choice.
5. **Keep the rest the same:** same lab, time of day, fasting state, and no other new supplements or big changes. Note illness, travel or season changes.
6. In the app, the user starts it under Log → Self-experiments; it adds the change to their log.

## Reading one

- Call `compare_before_after` (or `get_marker`): it gives before, after, the change, and the band of normal test-to-test variation (from published within-person variation).
- Inside the band: "can't be told apart from normal variation". Outside: "probably a real change in you". Never "proven".
- Even a real change doesn't prove the cause: season, illness or other habits can change results too.

## Rules

- Never design an experiment that changes a medicine; that is for their doctor.
- Explain, don't prescribe: suggest discussing supplements with a doctor or pharmacist, without giving doses.
