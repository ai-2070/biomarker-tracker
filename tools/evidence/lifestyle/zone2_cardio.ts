import { all, any, DEATH, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

/** "Zone 2" alone also names anatomy (hand tendon zones, retina zones), so searches pair it with exercise words or use easy-aerobic terms. */
const EASY = any(
  "zone 2",
  "zone-2",
  "low-intensity exercise",
  "low intensity exercise",
  "low-intensity steady-state",
  "moderate-intensity continuous training",
  "aerobic exercise",
  "aerobic training",
  "endurance training",
  "FATmax",
  "maximal fat oxidation",
);
const EASY_T = w(
  "zone 2",
  "aerobic",
  "endurance",
  "low-intensity",
  "low intensity",
  "moderate-intensity",
  "continuous training",
  "FATmax",
  "fat oxidation",
  "cardio",
);
/** Hand surgery, eye disease and single illnesses answer other questions. */
const OTHER =
  /\b(tendon\w*|retinopathy|prematur\w*|flexor|laser|children|adolescen\w*|cancer|stroke|parkinson\w*|heart failure|COPD|pulmonary|multiple sclerosis|spinal cord|cerebral palsy)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-zone2_cardio",
  kind: "lifestyle",
  lifestyleId: "zone2_cardio",
  name: "zone 2 cardio",
  terms: [],
  outcomes: [
    {
      id: "mitochondria",
      label: "Mitochondria and fat burning",
      finding: "Mitochondrial capacity and fat burning, compared with other intensities",
      query: all(
        any("zone 2", "zone-2", "low-intensity", "low intensity", "FATmax", "maximal fat oxidation", "moderate-intensity continuous training"),
        any("mitochondria", "mitochondrial", "fat oxidation", "metabolic flexibility", "fatty acid oxidation"),
        any("exercise", "training"),
      ),
      title: [EASY_T, w("mitochondri", "fat oxidation", "fatty acid", "FATmax", "flexib", "zone 2", "intensit")],
      excludeTitle: OTHER,
      question: q(
        GENERAL,
        "Training at a low or moderate intensity (zone 2, below the first lactate or ventilatory threshold, or at the intensity of peak fat burning)",
        "Training at higher intensities",
        "Mitochondrial capacity or fat oxidation",
      ),
    },
    {
      id: "fitness",
      label: "Fitness (VO2max)",
      finding: "Fitness (VO2max) from steady endurance training",
      query: all(EASY, any("VO2max", "VO2peak", "cardiorespiratory fitness", "aerobic capacity", "peak oxygen uptake")),
      title: [EASY_T, w("VO2", "fitness", "oxygen", "aerobic capacity", "cardiorespiratory")],
      excludeTitle: OTHER,
      question: q(
        "Healthy adults (reviews of one illness count as partly)",
        "Steady endurance or aerobic training at low to moderate intensity",
        "No exercise or higher-intensity training",
        "Cardiorespiratory fitness (VO2max or VO2peak)",
      ),
    },
    {
      id: "blood-pressure",
      label: "Blood pressure",
      finding: "Blood pressure from steady aerobic training",
      query: all(EASY, any("blood pressure", "hypertension")),
      title: [EASY_T, w("blood pressure", "hypertens")],
      excludeTitle: OTHER,
      question: q("Adults, with and without high blood pressure", "Steady aerobic or endurance training", "No exercise", "Resting blood pressure"),
    },
    {
      id: "diabetes",
      label: "Type 2 diabetes",
      finding: "Blood sugar (HbA1c) from structured aerobic exercise in type 2 diabetes",
      query: all(EASY, any("type 2 diabetes", "diabetes", "HbA1c", "glycemic control", "glycaemic control", "insulin sensitivity")),
      title: [EASY_T, w("diabet", "HbA1c", "glyc", "glucose", "insulin")],
      excludeTitle: OTHER,
      question: q(
        "Adults with type 2 diabetes or prediabetes",
        "Structured aerobic exercise training",
        "No exercise",
        "HbA1c, blood sugar or insulin sensitivity",
      ),
    },
    {
      id: "fitness-mortality",
      label: "Fitness and death",
      finding: "Cardiorespiratory fitness and death from any cause",
      query: all(
        any("cardiorespiratory fitness", "aerobic fitness", "VO2max", "peak oxygen uptake", "exercise capacity", "aerobic exercise", "endurance training"),
        DEATH,
      ),
      title: [w("fitness", "VO2", "aerobic", "endurance", "oxygen uptake", "exercise capacity", "cardiorespiratory"), w("mortalit", "death", "survival")],
      excludeTitle: OTHER,
      question: q(GENERAL, "Higher cardiorespiratory fitness, or aerobic exercise training", "Lower fitness or no training", "Death from any cause"),
    },
    {
      id: "polarized",
      label: "Easy training for athletes",
      finding: "Mostly easy training mixed with a few hard sessions (polarized training) in athletes",
      query: all(any("polarized", "polarised", "training intensity distribution", "80/20", "pyramidal"), any("training", "endurance", "athletes")),
      title: [w("polari[sz]ed", "intensity distribution", "80/20", "pyramidal", "threshold training")],
      excludeTitle: OTHER,
      question: q(
        "Adults, mostly endurance athletes or recreationally trained people",
        "Training with mostly easy sessions and some very hard ones (polarized), or mostly low-intensity training",
        "Other mixes of easy, moderate and hard training",
        "VO2peak, time trials or thresholds",
      ),
    },
  ],
};
