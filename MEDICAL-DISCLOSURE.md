# Medical disclosure


**Not medical advice.** For information and personal record-keeping, not for diagnosis or treatment. Biomarker Tracker is not a diagnostic tool, a treatment service or a prescribing tool, and it does not replace a clinician's assessment.


**Not yet reviewed by a clinician.** The app's explanations, evidence grades, AI assessments and calculations should not be treated as clinician approval. Implementing a published formula does not establish that this app is suitable for a medical decision about you.


## Your records, imports and alerts


Results are entered by you or imported from reports and devices. The app does not verify them with a laboratory or healthcare professional. Check the person, sample date, marker, value, unit, reference range and fasting status before saving an import. Text recognition (OCR) can confuse digits, miss decimal points or read the wrong line. Device exports can have different units, overlapping devices, incomplete days and measurements that do not mean the same thing.


Wearable estimates, sleep stages and home body-fat readings have measurement limits. A device's daily walking-speed average is not a short timed walking test. A chart, comparison or calculation cannot correct an inaccurate source reading.


Reference ranges and flags are context, not diagnoses. A value inside a range does not rule out illness, and a value outside it does not by itself establish illness. Some comparisons are population references or your own usual range, not clinical limits. Missing data or an unassessed result must not be read as normal.


Discuss concerning results with a clinician, especially if they are new, persistent or worsening. Critical-value banners are limited checks on recorded data, not continuous monitoring or an emergency service. The app does not contact a doctor or emergency services. If you may need urgent medical help, seek it directly; do not wait for an alert or an AI answer.


## Age estimates and fitness comparisons


These features describe different things. They are not combined into a single health or longevity score, and a younger-looking number is not proof of better health or a longer life.


- **PhenoAge** uses the published Levine 2018 formula, calendar age and nine markers from one blood draw. It is shown only for adults aged 20 or over. A positive CRP detection limit can stand in for a result below that limit, with an approximate label. Illness and short-term changes in the inputs can move the estimate. This is not a direct measurement of how old every part of your body is; lowering the number has not been shown to add years.
- **Pace of your PhenoAge** is a trend calculated from repeated blood tests, with an uncertainty interval. Few tests and changing blood markers can make it uncertain. It is not DunedinPACE. **DunedinPACE** is a separate specialised DNA methylation test: the app records reported results, rather than calculating it from routine bloodwork. A leaderboard-style selection of the best tests is not a clinical assessment.
- **Heart age and ten-year cardiovascular risk** use the Framingham office-based model with body mass index (BMI), blood pressure, smoking, diabetes and treatment information. The model was developed for ages 30–74 without heart disease. Heart age is the age at which specified reference risk factors give the same calculated risk, not the measured age of your heart. Your recorded inputs and the population in which the model was developed limit how well it applies to you. This cardiovascular estimate is different from the all-cause mortality model below.
- **Fitness age** compares your recorded VO₂max (a measure of aerobic fitness) with age-group averages of healthy Norwegian adults in the HUNT 3 Fitness Study. The app joins group averages between ages 25 and 75; beyond them it reports a bound rather than extending the curve. A device estimate of VO₂max is not the same measurement as a laboratory treadmill test.
- **Strength, balance and walking comparisons** use published tables for particular populations, ages, sexes and test methods. Percentiles, age equivalents and cut-offs depend on doing the matching test. The tables compare different people at different ages, not one person's ageing over time. They are not a body age, diagnosis or combined fitness score. Timed-test norms do not apply to device daily walking averages.


Other derived figures, such as BMI, waist-to-height ratio, estimated fat mass and resting metabolic rate, also depend on the recorded inputs and the limits of their source methods. Resting energy estimates are not calorie prescriptions.


## Country life tables and optional dates


The country population reference uses official *period life tables*: what a population's survival would look like if its reporting period's death rates stayed constant. Future rates can change. Mean remaining years, median age reached and the survival curve describe a population, not your personal future. Country comparisons use different reporting periods and scopes; they do not show the effect of moving country or rank healthcare quality.


The app joins survivors between reported ages and uses a constant death rate after age 95. These are calculation assumptions, not knowledge of future survival. The middle-half range is a population spread: a quarter die before it and a quarter live beyond it. It is not your personal confidence interval or an uncertainty interval for a fitted model.


The separate “Expiration date” feature is off by default. If you enable it, a calendar date is a way of displaying a population median or the experimental projection below, not a promised date of death. Birth month is approximated by its middle, and displaying seconds reflects calculation precision, not prediction precision. The occasional labelled “Cause: car crash” Easter egg is fictional, not a risk assessment.


## Experimental mortality projection


The optional fitted projection is an app-fitted research score, **not a clinically validated personal-risk calculator**. It uses public US NHANES examinations from 1999–2004 linked to NCHS mortality records through 2019. Evaluation used an untouched later group from 2005–2006. It estimates death from any cause over ten years, not the chance of a particular disease and not the original PhenoAge risk equation.


Held-out ranking and probability-error comparisons with age and sex alone do not establish accurate risk for one person. Average ten-year risk was overpredicted in the holdout. Calibration matters: distinguishing higher from lower risk is not the same as getting the probabilities right. Complete-case samples are not claimed to represent every US adult, and public follow-up times can be perturbed.


Model choice follows available compatible inputs, not a personal accuracy ranking. Supported versions include age, sex and cigarette-smoking status with blood markers, body-fat percentage and waist-to-height ratio, and sometimes qualifying leisure exercise. Body-data versions cover ages 20–69; blood-only versions cover ages 20–84. Unsupported ages, input ranges or missing required data do not receive guessed weights.


There are important gaps. Home body-fat methods have not been calibrated to the cohort's DXA measurements. Exercise means actual moderate-or-harder leisure sessions of at least ten minutes, counting vigorous minutes once, and needs explicit confirmation and at least 21 recorded days in the last 30. Generic device active time is not interchangeable. Resting HRV, DunedinPACE and incompatible functional tests have no fitted weight; “not included” does not mean unimportant.


Readings may be carried forward for up to a year. Body-fat and waist readings must be within 30 days, and combined blood and body readings within 90 days. These are availability choices, not validated clinical cut-offs. Transfer to home measurements, recorded activity, other assays or repeated readings has not been validated.


A **risk-equivalent age** is the age that gives the same ten-year risk in the model's same-cohort age-and-sex comparison. It is not a measured biological age. When supported, the experimental lifetime date reads a country life table at that age and assumes the gap from your calendar age persists for life. Ten-year temporal holdout testing does not validate this lifetime assumption, transfer to another country, or a date of death. No personal or lifetime confidence band is available. The unshifted country reference remains separate.


These are jointly fitted associations, not proof that changing a reading, habit or smoking category causes a particular number of years gained.


## Research, AI and changes in your habits


Knowledge pages summarise selected research with sources and evidence grades. Studies can disagree, have bias or concern people and interventions unlike yours. A food and an isolated supplement are different interventions. A grade is an appraisal of evidence for a stated question, not a guarantee of benefit or a recommendation for you.


Brain and on-demand claim evidence checks are optional AI features. AI can misunderstand studies, omit relevant research or produce incorrect explanations. Checking a citation against retrieved records does not prove that an answer interpreted the paper correctly or found all relevant evidence. Saved assessments record the model and date; saved grades are not clinician approval. “Insufficient evidence” or no grade means the available evidence could not support a graded answer, not proof of no effect. New-paper counts are discovery signals, not confirmed evidence or automatically revised conclusions.


Habit and protocol comparisons show what changed in your recorded results before and after a change. Noise estimates do not remove illness, other simultaneous changes, selective testing or other confounding. An observed change is not proof that the habit caused it, and fictional example profiles are not evidence that a routine works.


The app is not for personal supplement dosing or advice to start, stop or change medicines. Study amounts and population reference intakes are context, not a personal prescription. Discuss changes to medicines or supplements with your clinician, particularly with medical conditions, pregnancy or possible interactions. Safety notes are limited by the information recorded and cannot identify every risk.
