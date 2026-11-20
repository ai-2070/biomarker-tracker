/** Evidence map for the keto diet (knowledge/lifestyle/keto_diet.json): one search per finding, reviews of any design. */

import { all, any, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

const KETO = any(
  "ketogenic",
  "keto diet",
  "very low carbohydrate",
  "very-low-carbohydrate",
  "low-carbohydrate diet",
  "low carbohydrate diet",
  "VLCKD",
  "modified Atkins",
);
const KETO_T = w("keto", "low.carbohydrate", "low carb", "VLCKD", "Atkins");
/** Reviews about another illness or group answer other questions than keto for general adults. */
const OTHER_GROUPS =
  /\b(epilep\w*|seizures?|cancer\w*|tumou?rs?|glioma|glioblastoma|multiple sclerosis|alzheimer\w*|dementia|parkinson\w*|autism|migraine|children|pediatric|paediatric|infants?|adolescents?|pregnan\w*|polycystic|PCOS|athletes?|cystic fibrosis|mitochondri\w*|psychiatr\w*|schizophrenia|bipolar|depress\w*)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-keto_diet",
  kind: "lifestyle",
  lifestyleId: "keto_diet",
  name: "keto diet",
  terms: [],
  outcomes: [
    {
      id: "weight",
      label: "Weight",
      finding: "Body weight compared with a low-fat diet",
      query: all(KETO, any("weight loss", "body weight", "obesity", "overweight", "body mass index", "adiposity")),
      title: [KETO_T, w("weight", "obes", "overweight", "body mass", "adipos", "fat loss")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Adults with overweight or obesity (reviews of one illness count as partly)",
        "A ketogenic or very low-carbohydrate diet",
        "A low-fat or standard diet",
        "Body weight",
      ),
    },
    {
      id: "diabetes",
      label: "Type 2 diabetes",
      finding: "Blood sugar and remission in type 2 diabetes",
      query: all(KETO, any("type 2 diabetes", "diabetes mellitus", "glycemic control", "glycaemic control", "HbA1c", "remission")),
      title: [KETO_T, w("diabet", "glyc", "HbA1c", "remission", "insulin")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Adults with type 2 diabetes",
        "A ketogenic or low-carbohydrate diet",
        "A control or low-fat diet, or usual care",
        "Blood sugar (HbA1c) or remission of diabetes",
      ),
    },
    {
      id: "ldl",
      label: "LDL cholesterol",
      finding: "LDL cholesterol",
      query: all(KETO, any("LDL", "LDL cholesterol", "lipid", "lipids", "cholesterol", "lipid profile", "apolipoprotein B")),
      title: [KETO_T, w("LDL", "cholesterol", "lipid", "apolipoprotein", "dyslipid")],
      excludeTitle: OTHER_GROUPS,
      question: q(GENERAL, "A ketogenic or very low-carbohydrate diet", "A low-fat or standard diet", "LDL cholesterol or apolipoprotein B"),
    },
    {
      id: "risk-factors",
      label: "Triglycerides and blood pressure",
      finding: "Triglycerides, HDL cholesterol and blood pressure",
      query: all(KETO, any("triglycerides", "HDL", "blood pressure", "hypertension", "cardiometabolic", "cardiovascular risk factors", "cardiovascular risk")),
      title: [KETO_T, w("triglycerid", "HDL", "blood pressure", "hypertens", "cardiometabolic", "cardiovascular", "risk factor")],
      excludeTitle: OTHER_GROUPS,
      question: q(GENERAL, "A ketogenic or very low-carbohydrate diet", "A low-fat or standard diet", "Triglycerides, HDL cholesterol or blood pressure"),
    },
    {
      id: "epilepsy",
      label: "Epilepsy",
      finding: "Seizures in drug-resistant epilepsy (a medical treatment, kept apart from the other findings)",
      query: all(any("ketogenic", "keto diet", "modified Atkins"), any("epilepsy", "seizures", "seizure")),
      title: [w("keto", "Atkins", "diet"), w("epilep", "seizure")],
      question: q(
        "Children and adults with epilepsy that medicines did not control",
        "A ketogenic diet (classic, MCT or modified Atkins)",
        "Usual care or another diet",
        "Seizure freedom or fewer seizures",
      ),
    },
    {
      id: "long-term",
      label: "Long-term health",
      finding: "Long-term health: deaths and heart disease",
      query: all(KETO, any("mortality", "death", "cardiovascular disease", "cardiovascular events", "heart disease", "long-term")),
      title: [KETO_T, w("mortalit", "death", "cardiovascular", "heart", "long.term", "outcome")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        GENERAL,
        "A ketogenic or low-carbohydrate way of eating",
        "A higher-carbohydrate way of eating",
        "Death from any cause, heart and blood vessel disease, or long-term health outcomes",
      ),
    },
  ],
};
