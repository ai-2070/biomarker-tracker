import { all, any, DEATH, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

const HIIT = any(
  "high-intensity interval training",
  "high intensity interval training",
  "HIIT",
  "interval training",
  "sprint interval training",
  "high-intensity interval exercise",
);
const HIIT_T = w("interval", "HIIT", "HIT\\b", "sprint", "high-intensity", "high intensity");
/** Reviews about children, athletes or a single illness answer other questions. */
const OTHER_GROUPS =
  /\b(children|adolescen\w*|youth|athletes?|cancer|stroke|parkinson\w*|heart failure|COPD|pulmonary|multiple sclerosis|spinal cord|cerebral palsy|pregnan\w*)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-hiit",
  kind: "lifestyle",
  lifestyleId: "hiit",
  name: "high-intensity interval training",
  terms: [],
  outcomes: [
    {
      id: "fitness",
      label: "Fitness (VO2max)",
      finding: "Fitness (VO2max)",
      query: all(HIIT, any("VO2max", "VO2peak", "cardiorespiratory fitness", "aerobic capacity", "peak oxygen uptake", "aerobic fitness")),
      title: [HIIT_T, w("VO2", "fitness", "oxygen", "aerobic", "cardiorespiratory", "endurance")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Healthy adults, young or middle-aged (reviews of one illness count as partly)",
        "High-intensity interval training (repeated hard efforts with recovery)",
        "No exercise or steady moderate training",
        "Cardiorespiratory fitness (VO2max or VO2peak)",
      ),
    },
    {
      id: "blood-pressure",
      label: "Blood pressure",
      finding: "Blood pressure",
      query: all(HIIT, any("blood pressure", "hypertension", "hypertensive")),
      title: [HIIT_T, w("blood pressure", "hypertens")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Adults, including older adults and adults with high blood pressure",
        "High-intensity interval training",
        "No exercise or steady moderate training",
        "Resting blood pressure",
      ),
    },
    {
      id: "body-fat",
      label: "Body fat",
      finding: "Body fat and fat mass",
      query: all(HIIT, any("body fat", "fat mass", "adiposity", "body composition", "visceral fat", "fat loss")),
      title: [HIIT_T, w("fat", "adipos", "body composition", "body mass", "weight")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Adults, with and without overweight (reviews of children or of one illness count as partly)",
        "High-intensity interval training",
        "No exercise or steady moderate training",
        "Body fat percentage, fat mass or visceral fat",
      ),
    },
    {
      id: "diabetes",
      label: "Type 2 diabetes",
      finding: "Blood sugar and fitness in type 2 diabetes",
      query: all(HIIT, any("type 2 diabetes", "diabetes", "HbA1c", "glycemic control", "glycaemic control", "insulin resistance")),
      title: [HIIT_T, w("diabet", "HbA1c", "glyc", "glucose", "insulin")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Adults with type 2 diabetes or prediabetes",
        "High-intensity interval training",
        "No exercise or steady moderate training",
        "HbA1c, blood sugar and fitness",
      ),
    },
    {
      id: "mortality",
      label: "Death from any cause",
      finding: "Death from any cause",
      query: all(HIIT, DEATH),
      title: [HIIT_T, w("mortalit", "death", "survival")],
      excludeTitle: OTHER_GROUPS,
      question: q(GENERAL, "High-intensity interval training", "No exercise, recommended activity or steady moderate training", "Death from any cause"),
    },
    {
      id: "adherence",
      label: "Enjoyment and sticking with it",
      finding: "Enjoyment and sticking with it",
      query: all(HIIT, any("enjoyment", "adherence", "compliance", "affective responses", "drop-out", "attrition", "acceptability")),
      title: [HIIT_T, w("enjoy", "adheren", "complian", "affective", "attrition", "drop", "accept", "pleasure")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Adults, including inactive adults (reviews of one illness count as partly)",
        "High-intensity interval training",
        "Steady moderate training",
        "Enjoyment, compliance or adherence",
      ),
    },
  ],
};
