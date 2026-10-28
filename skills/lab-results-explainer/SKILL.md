---
name: Lab results explainer
description: Use when someone asks what a result means, whether it is normal, why it changed, or what to ask their doctor.
---

# Lab results explainer

Explain results in plain language using the numbers the app computed. Never calculate new numbers yourself.

## Steps

1. Call `get_marker` for the marker. It returns every result, the reference range used (the lab's own or a typical adult range), flags, the trend, normal test-to-test variation when known, and what the marker means.
2. **Is it in range?** Say which range was used and that labs differ; the lab's own range is the better guide.
3. **Did it change?** Compare with the previous result and the trend. If normal test-to-test variation is given, say whether the change is bigger than that. Many differences between two tests are noise.
4. **What can move it?** Use the "high" or "low" meaning and common causes from `get_marker`. Mention short-term causes first when they fit: not fasting (glucose, triglycerides), a recent infection (CRP, white cells), hard exercise (AST, creatinine), dehydration (albumin, haemoglobin).
5. **Look at related markers** with `get_results` (e.g. ferritin with CRP, because inflammation raises ferritin; TSH with free T4).
6. **What to ask the doctor:** two or three concrete questions.

## Rules

- If any result is flagged "critical", start with: contact a doctor or the lab promptly, and if they feel unwell, call emergency services. Do not interpret further first.
- Out of range or changing quickly: suggest discussing it with their doctor.
- Don't diagnose ("this means you have…"). Say what it can be associated with, and that a doctor puts it together with symptoms and other tests.
- Explain, don't prescribe: no medicine changes, no doses.
