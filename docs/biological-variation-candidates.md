# Within-subject biological variation (CVI): candidates from original open studies

Research notes, 2026-11-28. Nothing in the app has been changed. These are **candidates for the owner to review**, not
values to copy in blindly.

## Summary

- **Goal:** replace the removed EFLM values (see `eflm-biological-variation.md`) with CVI values measured in original studies
  of repeated sampling in healthy adults, each cited to its own paper.
- **All 15 marker ids exist** in `knowledge/biomarkers/` (canonical units: ldl, hdl, triglycerides, total_cholesterol,
  glucose mmol/L; hba1c %; ferritin µg/L; vitamin_d nmol/L; b12 pmol/L; crp_hs mg/L; alt U/L; creatinine µmol/L; tsh mIU/L;
  homocysteine µmol/L; apo_b g/L). CV is unitless, so unit differences (mg/dL vs mmol/L, ng/mL vs nmol/L, % vs mmol/mol) don't
  matter.
- **14 of 15 markers have at least one usable candidate.** **apo_b has none.** **hba1c** and **tsh** each rest on one weak or
  small study.
- **Best sources found:**
  1. **NHANES 1999–2002** (Lacher et al., NCHS National Health Statistics Report 21, 2010). About 800 people aged 16–69
     sampled twice, about 19 days apart. CVI is reported with the analytical CV removed. The report is **US public domain**
     (it says so itself), so it carries no licence question. Covers total cholesterol, triglycerides, glucose, ferritin,
     vitamin D, B12, ALT, creatinine and homocysteine. It is not in PMC; I read the PDF on cdc.gov.
  2. **Corte & Venta 2020** (Ann Transl Med, open access). 11 healthy adults, fasting, weekly for 5 weeks, CVI with 95% CI.
     Covers LDL, HDL, triglycerides, total cholesterol, CRP, homocysteine, B12 and 25-OH vitamin D.
  3. **HCHS/SOL** (Thyagarajan et al. 2016, NIH author manuscript in PMC). About 50 people, two samples about a month apart.
     Covers almost everything, including HbA1c and ALT. **Caveat:** its "CVI" includes methodological variation, i.e.
     analytical plus pre-analytical (see the owner's decisions).
- **Owner decisions needed:** (1) whether EuBIVAS papers count as "EFLM's estimates" (none is open access in PMC, so I read
  none of them and quote no numbers); (2) how to treat values that already include analytical variation, since the app adds
  CVA = 0.5 × CVI on top; (3) short-term vs long-term values (see the end).

## Main table

**Pick** marks the value I'd choose. The quote IDs ([Q1] …) point to the verbatim text further down. Every number below was
read in the paper itself (full text, or the abstract where stated).

| Marker | CVI % | 95% CI | n | Population | Interval / design | Paper | Quote | Open access |
|---|---|---|---|---|---|---|---|---|
| **ldl** — Pick | 7.3 | 5.9–8.8 | 11 | Healthy, 8 F / 3 M, 21–50 y, Spain | Weekly × 5, overnight fast, direct (homogeneous) LDL | Corte & Venta 2020, PMID 32355725, PMC7186598, DOI 10.21037/atm.2020.03.26 | [Q1] | Yes (CC BY-NC-ND) |
| ldl | 9.7 | — | 51 | HCHS/SOL volunteers, US Hispanic/Latino, 18–74 y (1 ESRD, 6 diabetes) | 2 samples ~1 month apart, fasting; includes methodological variation | Thyagarajan 2016, PMID 27756543, PMC5136507, DOI 10.1016/j.cca.2016.10.019 | [Q3] | Free in PMC (NIH author manuscript) |
| ldl | 15.8 | — | 63 | HIV-negative white men, 38–66 y, not on cholesterol-lowering drugs (MACS) | Every 6 months, 3 visits over 1 year, fasting, Friedewald LDL | Aziz 2022, PMID 35897032, PMC9327155, DOI 10.1186/s12944-022-01668-0 | [Q4] | Yes (CC BY) |
| **hdl** — Pick | 8.8 | 7.1–10.5 | 11 | as Corte above | as above | Corte & Venta 2020 | [Q1] | Yes |
| hdl | 6.4 | — | 50 | as HCHS/SOL above | as above | Thyagarajan 2016 | [Q3] | Free in PMC |
| hdl | 14.1 | — | 63 | as MACS above | as above | Aziz 2022 | [Q4] | Yes |
| **triglycerides** — Pick | 19.7 | 15.5–23.8 | 11 | as Corte above | Weekly × 5, **overnight fast** | Corte & Venta 2020 | [Q1] | Yes |
| triglycerides | 18.7 | — | 50 | as HCHS/SOL above | ~1 month, fasting; includes methodological | Thyagarajan 2016 | [Q3] | Free in PMC |
| triglycerides | 27.8 | — | 814 | NHANES 1999–2002, US, 16–69 y | 2 samples, mean 18.8 days (3–51); **fasting state not stated in the report** | Lacher 2010, PMID 20540274, NHSR No. 21 | [Q5] | Free, public domain (CDC), not in PMC |
| **total_cholesterol** — Pick | 6.9 | — | 835 | NHANES 1999–2002 | as above | Lacher 2010 | [Q5] | Public domain |
| total_cholesterol | 5.4 | 4.4–6.4 | 11 | as Corte above | as above | Corte & Venta 2020 | [Q1] | Yes |
| total_cholesterol | 6.8 | — | 51 | as HCHS/SOL above | as above | Thyagarajan 2016 | [Q3] | Free in PMC |
| **hba1c** — Pick (weak) | 2.2 | — | 57 | as HCHS/SOL above | ~1 month; includes methodological | Thyagarajan 2016 | [Q3] | Free in PMC |
| **glucose** — Pick | 5.2 | — | 50 | as HCHS/SOL above | ~1 month, **fasting glucose**; includes methodological | Thyagarajan 2016 | [Q3] | Free in PMC |
| glucose | 7.5 | — | 789 | NHANES 1999–2002 | as above; fasting state not stated | Lacher 2010 | [Q5] | Public domain |
| glucose | 5.10 | — | 730 (stated) | "Apparently healthy" adults 18–65 y, Dhaka, Bangladesh | 4 samples, 2-week intervals; fasting not stated ("blood sugar") | Ali 2023, PMID 37069865, PMC10105598, DOI 10.7759/cureus.36242 | [Q6] | Yes (CC BY) |
| **ferritin** — Pick | 21.8 | — | 796 | NHANES 1999–2002 (males 17.9, females 28.8, from the abstract) | as above | Lacher 2010 | [Q5] | Public domain |
| ferritin | 18.1 | — | 48 | as HCHS/SOL above | as above | Thyagarajan 2016 | [Q3] | Free in PMC |
| ferritin | 21.64 | — | 6 | Healthy men 19–25 y, India | 3 samples over 3 weeks | Gnanou 2006, PMID 23105598, PMC3453753, DOI 10.1007/BF02913095 | [Q7] (abstract only) | In PMC (PDF), not OA-licensed |
| **vitamin_d** — Pick | 11.3 | — | 460 | NHANES 1999–2002 | as above (method CV 8.2%) | Lacher 2010 | [Q5] | Public domain |
| vitamin_d | 12.8 | 10.3–15.4 | 11 | as Corte above, sampled Sept–Oct | Weekly × 5 | Corte & Venta 2020 | [Q2] | Yes |
| vitamin_d | 24.6 | — | 672 | Postmenopausal women (WHI) | 2 samples ~5 years apart; mean rose 60.0 → 67.8 nmol/L; analytical not removed | Meng 2012, PMID 22523182, PMC3372646, DOI 10.1158/1055-9965.EPI-12-0026 | [Q8] | Free in PMC (NIH author manuscript) |
| **b12** — Pick | 14.6 | — | 831 | NHANES 1999–2002 | as above | Lacher 2010 | [Q5] | Public domain |
| b12 | 7.7 | 6.2–9.1 | 11 | as Corte above | as above | Corte & Venta 2020 | [Q2] | Yes |
| b12 | 16.1 | — | 22 | Women 25 ± 4 y (control arm of an iron trial; some on oral contraceptives) | Every 4 weeks × 4 (12 weeks), fasted | McArthur 2013, PMID 24067390, DOI 10.3390/nu5093634 | [Q9] | Yes (Nutrients, CC BY) |
| **crp_hs** — Pick | 46.2 | 42.9–49.3 | 541 | NHANES 2001–02, 16–69 y, mean age 38 | 2 samples, mean 18.9 days; hs-CRP by latex nephelometry | Bower 2012, PMID 22945505, PMC3613132, DOI 10.1001/archinternmed.2012.3712 | [Q10] | Free in PMC (NIH author manuscript) |
| crp_hs | 41.0 | 31.4–50.6 | 11 | as Corte above (median CRP 0.6 mg/L) | Weekly × 5 | Corte & Venta 2020 | [Q2] | Yes |
| crp_hs | 54.9 | — | 50 | as HCHS/SOL above | ~1 month; includes methodological | Thyagarajan 2016 | [Q3] | Free in PMC |
| **alt** — Pick | 20.3 | — | 796 | NHANES 1999–2002 | as above | Lacher 2010 | [Q5] | Public domain |
| alt | 24.1 | — | 50 | as HCHS/SOL above | as above | Thyagarajan 2016 | [Q3] | Free in PMC |
| **creatinine** — Pick | 6.7 | — | 823 | NHANES 1999–2002 (method CV 4.6%) | as above | Lacher 2010 | [Q5] | Public domain |
| creatinine | 7.6 | 7.2–8.0 | 795 | NHANES III second examination, ≥18 y | ~18 days apart; standardized creatinine; "includes both biological and analytical variability" | Selvin 2013, PMID 23337799, PMC3628297, DOI 10.1053/j.ajkd.2012.11.048 | [Q11] | Free in PMC (NIH author manuscript) |
| creatinine | 7.3 | — | 49 | as HCHS/SOL above | as above | Thyagarajan 2016 | [Q3] | Free in PMC |
| **tsh** — Pick (only one) | 22.3 | 19.3–26.3 | 21 | Healthy, 12 M / 9 F, Turkey | Weekly × 5, fasting, 08:00–10:00, March–April 2020 | Yıldız 2025, PMID 39974197, PMC11838713, DOI 10.11613/BM.2025.010706 | [Q12] | Yes (CC BY) |
| **homocysteine** — Pick | 12.2 | — | 832 | NHANES 1999–2002 | as above | Lacher 2010 | [Q5] | Public domain |
| homocysteine | 8.8 | 7.1–10.4 | 11 | as Corte above (plasma total homocysteine) | Weekly × 5 | Corte & Venta 2020 | [Q2] | Yes |
| apo_b | — | — | — | Nothing usable found (see below) | — | — | — | — |

### Why these picks

- **NHANES 1999–2002 first, where it has the marker:** by far the largest group (about 800 people, both sexes, 16–69 y). It
  removes analytical variation (CVw = √(CVt² − CVa²)), the gap of about 19 days is like a real-life retest, and it is public
  domain. Its weak points: the report doesn't say whether samples were fasting (this matters for triglycerides and glucose),
  and the WP sample was "nonrandom" (recruited to balance sex, age and ethnicity).
- **Corte & Venta for LDL, HDL and triglycerides:** NHANES lacks LDL and HDL, and for triglycerides fasting is documented
  here (overnight fast, 08:30–10:00) while it isn't in NHANES. The design is the classic biological-variation one (CV-ANOVA,
  outliers removed, analytical CV removed, 95% CI), but n = 11 is small. HCHS/SOL agrees for triglycerides (18.7 vs 19.7).
- **HCHS/SOL for glucose and HbA1c:** it is the only candidate with documented fasting glucose and a reasonable n. It is the
  only usable HbA1c value at all. Its CVI includes process and analytical variation, so it is slightly too high as a "pure"
  CVI (see the owner's decisions).
- **Bower 2012 for hs-CRP:** large, has a CI, uses a high-sensitivity assay and the same NHANES design. All three CRP
  candidates agree (41–55%).

## Verbatim source text

Table cells are separated by `|` as extracted from the full text.

- **[Q1]** Corte & Venta 2020, Table 2 ("Biological variation data and derived parameters for conventional risk factors in
  healthy individuals and haemodialysis (HD) patients: serum lipids"). Columns are healthy subjects TG | CT | HDL-c | LDL-c |
  nHDL-c, then the same for HD patients:
  `CVI, % (95% CI) | 19.7 (15.5–23.8) | 5.4 (4.4–6.4) | 8.8 (7.1–10.5) | 7.3 (5.9–8.8) | 7.9 (6.4–9.5) | 19.9 (16.9–22.7) | …`
  Design: "Specimens from healthy volunteers were obtained once a week for 5 weeks between September and October." and
  "…11 healthy individuals (8 females and 3 males; age range: 21–50 years)…". Sampling: "…after an overnight fast…". Assays:
  "Serum CRP, calcium, inorganic phosphorus, total cholesterol (TC), triglycerides (TG), low-density lipoprotein cholesterol
  (LDL-c) and high-density lipoprotein cholesterol (HDL-c) through an homogeneous method, were measured using
  immunoturbidimetric or colourimetric assays, on a Cobas e702…".
- **[Q2]** Corte & Venta 2020, Table 3. Healthy columns are CRP, mg/L | tHcy | B12, pmol/L | Folate:
  `CVI, % (95% CI) | 41.0 (31.4–50.6) | 8.8 (7.1–10.4) | 7.7 (6.2–9.1) | 13.3 (10.7–15.9) | …`
  Table 4, healthy columns Ca | Pi | PTHi | 25-OH-D, nmol/L:
  `CVI, % (95% CI) | 2.3 (1.8–2.7) | 8.0 (6.5–9.6) | 11.3 (9.0–13.5) | 12.8 (10.3–15.4) | …`
  (The Table 3 header prints "tHcy, mmol/L"; the median of 10.0 shows this means µmol/L. A CV is unitless, so it doesn't matter.)
- **[Q3]** Thyagarajan 2016, Table 1 (columns N | Mean(SDI) | CVI | …):
  `Alanine aminotransferase (U/l) | 50 | 25.0(6.03) | 24.1 |`
  `Creatinine (mg/dl) | 49 | 0.83(0.06) | 7.3 |`
  `Total cholesterol (mg/dl) | 51 | 199(13.55) | 6.8 |`, `Triglycerides (mg/dl) | 50 | 126.3(23.62) | 18.7 |`,
  `HDL-cholesterol (mg/dl) | 50 | 50.4(3.22) | 6.4 |`, `LDL-cholesterol (mg/dl) | 51 | 122.8(11.87) | 9.7 |`,
  `Glucose, fasting (mg/dl) | 50 | 95.1(4.92) | 5.2 |`, `% Glycated Hemoglobin | 57 | 5.6(0.13) | 2.2 |`,
  `Ferritin (ug/l) | 48 | 90.7(16.41) | 18.1 |`, `High-sensitivity C-Reactive Protein (mg/l) | 50 | 3.7(2.04) | 54.9 |`.
  Design: "…all blood and urine samples were collected from 58 participant volunteers … at 2 time points; first at baseline
  and then approximately a little over a month later." and "One individual in this study had end stage renal disease, six
  individuals had self-reported history of diabetes and all other participants were healthy volunteers." What the CVI
  contains: "…to estimate the total within-individual variance (σ2I) (which includes both biological variation within
  individuals and methodological variation)…".
- **[Q4]** Aziz 2022, Table 1. Columns are HIV-uninfected on CLDs (1 y | 17 y), HIV-uninfected **not** on CLDs (1 y | 17 y),
  then HIV-infected. The value used is the 1-year column for the 63 men not on cholesterol-lowering drugs (3rd number):
  total cholesterol `CVI (%) | 10.6 | 16.1 | 10.2 | 11.0 | …`; triglycerides `CVI (%) | 40.7 | 43.8 | 33.6 | 36.6 | …`;
  HDL-C `CVI (%) | 13.4 | 15.9 | 14.1 | 13.8 | …`; LDL-C `CVI (%) | 15.8 | 24.9 | 15.8 | 15.8 | …`. Design: "Bloods were
  analyzed every six months over 17 years…" and "…an overnight fasting blood sample was collected…". The 17-year values
  (same men: 11.0 / 36.6 / 13.8 / 15.8) include ageing trends.
- **[Q5]** Lacher 2010 (NHSR 21), Table 1 ("Between-person (CVg), within-person (CVw), and method (CVa) coefficients of
  variation…"). Within-person columns are n | Mean | SD | CVw (%) | CVa (%) | CVw/CVg:
  `Alanine aminotransferase (U/L) … 796 22.4 4.6 20.3 4.0 0.47`; `Cholesterol, total (mg/dL) … 835 192.1 13.5 6.9 1.5 0.33`;
  `Creatinine (mg/dL) … 823 0.80 0.06 6.7 4.6 0.24`; `Ferritin (ng/mL) … 796 94.1 20.8 21.8 3.2 0.24`;
  `Glucose (mg/dL) … 789 88.9 6.8 7.5 1.5 0.64`; `Homocysteine (µmol/L) … 832 7.641 0.982 12.2 4.0 0.33`;
  `Triglycerides (mg/dL) … 814 126.3 35.2 27.8 1.9 0.49`; `Vitamin B12 (pg/mL) … 831 497.9 74.3 14.6 2.9 0.34`;
  `Vitamin D, 25-hydroxy (ng/mL) … 460 21.2 3.0 11.3 8.2 0.30`. Method: "The CVw was calculated as [(CVt)2 − (CVa)2]1/2." and
  "…a nonrandom sample was obtained with an average of 18.8 days (range: 3–51 days) between two analyte measurements." Sex
  difference (abstract): "Serum ferritin had the greatest difference for CVw (males, 17.9% compared with females, 28.8%)."
  Licence: "All material appearing in this report is in the public domain and may be reproduced…".
- **[Q6]** Ali 2023, results: "The intra biological variance (CVW) for blood sugar, creatinine, urea, … were calculated as
  5.10%, 4.64%, 10.72%, …". Design: "…by blood sampling on four occasions at 2-week intervals for an appropriate number of
  people." Note that the paper's sodium CVW (0.69%) is below its CVA (0.75%) and the number of people actually sampled four
  times is unclear. I'd treat this paper as weak support only.
- **[Q7]** Gnanou 2006, abstract: "A sample study of biological variation of plasma ferritin in healthy adult males 19–25
  years of age (n=6) … Venous blood was collected on 3 non-consecutive days during a 3 week period. … We found a mean
  biological variation of 21.64%." (The full text is a scanned PDF; only the abstract was read.)
- **[Q8]** Meng 2012, abstract: "The CV was 24.6%, the ICC (95% Confidence Interval (CI)) was 0.59 (0.54-0.64)…" and "Mean
  25(OH)D concentrations (nmol/L) significantly increased over time from 60.0 (SD=22.2) to 67.8 (SD=22.2)…". It is the
  "intraindividual CV … using the root mean square approach as described by Bland". The assay's within-pair QC CV of 4.9% was
  not removed.
- **[Q9]** McArthur 2013, Table 1 ("CVI, CVG and RCV for the serum vitamins B6, B12 and folate; and erythrocyte folate (n =
  22)", columns CVG % | CVI % | …): `Vitamin B12 (pmol/L) | 62.2 | 16.1 | 0.26 | 49.8`. Design: "Blood samples were collected
  from all volunteers initially (week 0) then at four weekly intervals (weeks 4, 8 and 12)." and "…the women were in the
  fasted state…".
- **[Q10]** Bower 2012: "The mean time between examinations was 18.9 days. … the ICC was 0.77 (95% CI: 0.69–0.84), and the
  CVw was 46.2% (95% CI: 42.9–49.3%)." and "We included 541 participants aged 16–69 years who completed repeat examinations
  of the 2001–02 National Health and Nutrition Examination Survey (NHANES)." Assay: "High-sensitivity serum CRP was measured
  using latex-enhanced nephelometry". The text doesn't say whether analytical variation was removed.
- **[Q11]** Selvin 2013, abstract: "We calculated the within-person coefficient of variation (CVw), which includes both
  biological and analytical variability." and "Serum creatinine and B2M (CVw values of 7.6% and 8.4%, respectively) also had
  low variability." Table row: `Creatinine (mg/dL)b | 0.88 ± 0.23 | 0.87 (0.22) | 0.01 (0.09) | −0.00 to 0.01 | 7.6 (7.2 to 8.0) |`.
  n: "…the final sample size for the serum marker reliability analysis was 795…".
- **[Q12]** Yıldız 2025, abstract: "For TSH, fT3 and fT4, … CVI (CI) were 22.3% (19.3 to 26.3), 4.4% (3.8 to 5.3) and 5.1%
  (4.3 to 6.1)…" and "A total of 21 Turkish healthy volunteers (12 males and 9 females) were included in the study. Blood
  samples were collected once a week for five weeks…".

## Needs the owner's decision

### EuBIVAS / EFLM working-group papers (flagged, not used, not read)

None of these is open access in PMC, so I read none of them and quote no values. They are listed only so the owner can
decide whether they count as "EFLM's estimates". My view: they are EFLM Working Group outputs, the data feed EFLM's database,
and several include EFLM meta-analyses, so excluding them is the safe reading.

| Paper | Relevant markers | PMID |
|---|---|---|
| Aarsand et al. 2018, Clin Chem. "The EuBIVAS: … Electrolytes, Lipids, Urea, Uric Acid, Total Protein, Total Bilirubin, Direct Bilirubin, and Glucose" | lipids, glucose | 29941472 |
| Carobene et al. 2019, Clin Chem. "EuBIVAS: … 15 Frequently Measured Proteins" | proteins (contents not read) | 31171528 |
| Carobene et al. 2017, Clin Chem. "Biological Variation Estimates Obtained from 91 Healthy Study Participants for 9 Enzymes in Serum" | ALT (likely) | 28428356 |
| Carobene et al. 2017. "The EuBIVAS Project: … Serum Creatinine Using Enzymatic and Alkaline Picrate Methods…" | creatinine | 28720681 |
| Bottani et al. 2022, CCLM. "EuBIVAS: … serum thyroid biomarkers based on weekly samplings from 91 healthy participants" | TSH | 33561908 |
| Clouet-Foraison et al. 2020, Clin Chem. "Analytical Performance Specifications for Lipoprotein(a), Apolipoprotein B-100, and Apolipoprotein A-I Using the Biological Variation Model in the EuBIVAS Population" | apo_b (the only apoB source found) | 32353129 |
| Carobene et al. 2023, CCLM. "Biological variation of serum iron from the EuBIVAS" | (iron; not in scope) | 36448402 |

Meta-analyses by EFLM members, excluded outright: Ricós et al. 2020 (Adv Lab Med, glucose/HbA1c, PMC10197502), Díaz-Garzón et
al. 2019 (lipids BIVAC review, PMID 31103621), Fernández-Calle et al. 2022 (thyroid meta-analysis, PMID 34773727).

### Borderline, kept in the main table but worth a look

- **Yıldız 2025 (TSH):** the authors' own measurements, but the study "followed checklist produced by the EFLM Biological
  Variation Working Group", and they used "the calculation tool in EFLM-BV web site" for the RCV and analytical goals. Their
  CVI comes from the BioVar web tool, not from EFLM data. In my reading this is not "EFLM's estimates", but it is EFLM-adjacent.
- **Corte & Venta 2020:** their own measurements; they only compare with EuBIVAS in the discussion. Kept.

### Values that already include analytical variation

The app's RCV uses σ from CVI and assumes CVA = 0.5 × CVI. HCHS/SOL (all values), Selvin 2013 (creatinine), Meng 2012
(vitamin D) and probably Bower 2012 and Aziz 2022 report within-person variation **including** analytical (and in HCHS/SOL
also pre-analytical) variation. Adding CVA = 0.5 × CVI on top counts the lab's imprecision twice and makes the band about 12%
wider than the value implies (√1.25 ≈ 1.12). Options: use these values with CVA = 0 (as "total within-person variation"),
or prefer studies that remove CVA (NHANES 1999–2002 via Lacher, Corte & Venta, Yıldız). The owner should choose one rule and
store which kind each value is.

### Short-term values vs tests months apart

Every pure CVI above comes from samples days to weeks apart. People usually retest after months, and real variation over a
year is larger: in MACS the same healthy men had LDL CVI 15.8% over 1 year vs 7–10% in the short-term studies, and
triglycerides 33.6% vs about 19%. Vitamin D has a strong seasonal swing that no short study captures (Meng: 24.6% over 5
years, with a rising mean). Short-term CVI will make a "real change" look easier to reach than it is when tests are months
apart. Worth stating in the UI, or preferring the longer-interval values where they exist.

## Markers with nothing usable, or only weak evidence

- **apo_b: nothing usable.** The only biological-variation estimate found in healthy adults is EuBIVAS (Clouet-Foraison
  2020, not open access, flagged above). Delawi 2003 (Clin Chim Acta, PMID 12559610) studies familial combined
  hyperlipidaemia and is not open access. Yang 2018 (Ann Lab Med, PMID 29797813, PMC5973917, DOI 10.3343/alm.2018.38.5.431,
  open access) does report apoB, but only **within one day around meals** (41 healthy Chinese adults, five samples
  06:30–18:30): Table 4 `apo-B | 0.65±0.11 | 3.7 (3.3–4.2) | 2.4† | 14.8 (11.7–19.8) |…`, with the footnote "†CVI
  confidence intervals could not be calculated because the CVA was greater than the CVI for apo-B". That is daytime
  variation measured below the assay's own imprecision, not day-to-day or month-to-month variation, so I wouldn't use it for
  retests. (The same table's other columns quote values from other studies, which are not original to this paper.)
- **hba1c: weak.** HCHS/SOL 2.2% is the only usable value, and it includes methodological variation. Liang 2019 (J Clin Lab
  Anal, PMID 30461058, PMC6587440, open access) contradicts itself: its abstract says "HbA1c: 0.12%" for CVI but its Table 1
  says `HbA1c, % | All subjects | 19 | 475 | 5.29 (5.25~5.34) | 0.42 (0.39~0.46) | 0.29 (0.26~0.34) |…`, and it describes the
  sampling both as "once per week for 5 weeks" and "on alternate Mondays". Do not use it. Gough 2025 (PLoS One, PMC12494249)
  reports total variation in routine primary-care records (CVT 0.20, with diabetes diagnoses inside the follow-up), not
  healthy-adult CVI. Classic HbA1c studies (Rohlfing 2002, Braga 2011, Lenters-Westra 2014, Kilpatrick 1998) are not open
  access in PMC.
- **tsh: one small study.** Only Yıldız 2025 (n = 21). Mairesse 2021, Andersen 2023, Maes 1997 and Browning 1986 are not
  open access.

## Excluded, with reason

| Paper | Why excluded |
|---|---|
| Gough et al. 2024, PLoS One, CRP systematic review and meta-analysis (PMC11530069); Gough 2023 HbA1c review (PMID 37531355) | Meta-analyses, not original measurements |
| Gough et al. 2025, CRP in primary care (PMC12643293) | Total variation in patients' routine records (CV 1.604), includes illness; not healthy CVI |
| Ahmad Ridzuan 2026, Diagnostics (PMC13205227) | Takes CVI "from EFLM databases"; only its analytical CVs are its own |
| Yang 2018, Ann Lab Med (PMC5973917) | Within-day, around-meal variation only (its daytime CVIs: TG 25, TC 3.5, LDL-C 4.4, HDL-C 3.7, apo-B 2.4) |
| Kong 2022, BMC Nephrol (PMC9131627) | Kidney markers within 24 hours only |
| DeGoma 2012 (MESA, PMC4085141), Platz 2010 (PMC3010861) | Report ICC only, no CVI |
| Midttun 2014 (PMC3985833), Li-Gao 2019 NMR (PMC6586348) | ICC only / NMR metabolites |
| Hempe 2023 (PMC10495557), Liu 2015 (PMC4454807) | Glycation index, not CVI |
| Lewis 2016, PLoS One (PMC4773226) | Oxidative-stress markers, not these markers |
| Becker 2020, soccer U-19 (PMC7417431) | Adolescent athletes during training (CRP CV 45% reflects exercise load) |
| Wang 2022 / 2025 (type 2 diabetes cohorts, PMC12129759) | Patients, not healthy |
| Ozkanay 2023 (Scand J Clin Lab Invest, PMID 37961767, vitamin D / B12 / ferritin); Cokluk 2021 (Clin Lab, PMID 34542961, iron, ferritin, B12, 25-OH D); Lindberg 2019 (homocysteine, PMID 30957652); Rasmussen 1999 (homocysteine, Clin Chem); Lacher 2005 (NHANES III, Clin Chem) | Look relevant but not open access in PMC, so not read; no values quoted |

## How the search was done

Full texts were read via Europe PMC's REST `…/{PMCID}/fullTextXML`. NIH author manuscripts (Europe PMC returned HTTP 500 for
these) were read via NCBI E-utilities `efetch.fcgi?db=pmc&id=…`. The NHANES report was read as the PDF at
`https://www.cdc.gov/nchs/data/nhsr/nhsr021.pdf`. All searches used
`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=…&format=json&resultType=lite` (2026-11-28). Exact queries:

1. `TITLE:"biological variation" AND (lipid OR cholesterol OR triglyceride OR lipoprotein)`
2. `("biological variation" OR "within-subject variation" OR "intra-individual variation") AND healthy AND OPEN_ACCESS:y AND (TITLE:"biological variation" OR TITLE:"within-subject" OR TITLE:"intra-individual")`
3. Per marker: `(TITLE:(M) OR ABSTRACT:(M)) AND (TITLE:"biological variation" OR TITLE:"within-subject" OR TITLE:"intra-individual" OR TITLE:"intraindividual" OR TITLE:"within-person" OR TITLE:"within-individual" OR ABSTRACT:"within-subject biological variation" OR ABSTRACT:"intra-individual coefficient of variation" OR ABSTRACT:"reference change value")`, with M =
   - `"vitamin D" OR "25-hydroxyvitamin D" OR 25OHD OR calcidiol`
   - `ferritin`
   - `"vitamin B12" OR cobalamin OR B12`
   - `"C-reactive protein" OR CRP OR hsCRP`
   - `homocysteine`
   - `"apolipoprotein B" OR apoB OR apolipoproteins`
   - `TSH OR thyrotropin OR thyroid`
   - `HbA1c OR "glycated hemoglobin" OR "glycated haemoglobin" OR "glycosylated hemoglobin"`
   - `creatinine`
   - `ALT OR "alanine aminotransferase" OR aminotransferase OR "liver enzymes"`
   - `cholesterol OR lipids OR triglycerides OR lipoprotein OR "lipid profile"`
   - `glucose`
4. `OPEN_ACCESS:y AND ("within-subject biological variation" OR "within-subject coefficient of variation" OR "CVI") AND (ferritin OR "vitamin B12" OR "25-hydroxyvitamin D" OR homocysteine) AND healthy`
5. `OPEN_ACCESS:y AND ("within-subject biological variation" OR "CVI") AND ("alanine aminotransferase" OR ALT) AND healthy`
6. `OPEN_ACCESS:y AND ("within-subject biological variation" OR "CVI") AND ("apolipoprotein B" OR "apo B") AND healthy`
7. `OPEN_ACCESS:y AND ("within-subject biological variation" OR "CVI") AND (HbA1c OR "glycated haemoglobin") AND healthy AND (TITLE:variation OR TITLE:variability)`
8. `OPEN_ACCESS:y AND ("within-subject biological variation" OR "CVI") AND (TSH OR thyrotropin) AND healthy AND (TITLE:variation OR TITLE:variability)`
9. `OPEN_ACCESS:y AND ("biological variation") AND ("C-reactive protein") AND healthy AND (TITLE:variation OR TITLE:variability)`
10. `OPEN_ACCESS:y AND ("within-subject" OR "intra-individual") AND (TITLE:"biological variation" OR TITLE:"biological variability") AND (biochemistry OR biochemical OR "clinical chemistry" OR analytes)`
11. `TITLE:homocysteine AND TITLE:"biological variation"`
12. `(EuBIVAS OR "European Biological Variation Study")`
13. `(EuBIVAS OR "European Biological Variation Study" OR "Working Group on Biological Variation") AND (HbA1c OR "glycated" OR enzymes OR aminotransferase OR ferritin OR "vitamin D" OR "vitamin B12" OR homocysteine OR "C-reactive")`
14. `("apolipoprotein B" OR "apo B" OR apoB) AND ("within-subject" OR "intra-individual" OR "intraindividual" OR "within-person" OR "biological variation") AND (variation OR variability) AND (healthy OR volunteers) AND HAS_FT:y`
15. `TITLE:(HbA1c OR "glycated hemoglobin" OR "glycated haemoglobin" OR "haemoglobin A1c" OR "hemoglobin A1c" OR "glycohemoglobin") AND TITLE:("biological variation" OR "biological variability" OR "intra-individual" OR "within-person" OR "within-subject" OR "intraindividual" OR "within-individual")`
16. `TITLE:("vitamin D" OR "25-hydroxyvitamin D" OR ferritin OR homocysteine OR "vitamin B12" OR cobalamin OR "aminotransferase") AND TITLE:("biological variation" OR "within-person" OR "within-subject" OR "intra-individual" OR "intraindividual" OR "within-individual") AND OPEN_ACCESS:y`
17. `TITLE:("thyroid" OR "TSH" OR thyrotropin) AND TITLE:("biological variation" OR "individual variation" OR "intra-individual" OR "within-person")`

A first attempt that searched all full text with OA filters (for example
`("vitamin D" OR …) AND ("biological variation" OR …) AND OPEN_ACCESS:y`) returned hundreds to thousands of off-topic hits
("CVI" also matches "choroidal vascularity index") and was discarded in favour of the title/abstract queries above.

Licences, for the record: facts such as a CV value can be cited with attribution. NHANES is public domain; Corte & Venta and
Liang are CC BY-NC-ND; Aziz, Ali, McArthur and Yıldız are CC BY; the NIH author manuscripts are "available for text mining …
consistent with the principles of fair use".
