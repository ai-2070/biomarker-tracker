import { all, any, DEATH, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

const RT = any(
  "resistance training",
  "resistance exercise",
  "strength training",
  "weight training",
  "weight lifting",
  "weightlifting",
  "muscle-strengthening",
  "muscle strengthening",
  "progressive resistance",
);
const RT_T = w(
  "resistance",
  "strength",
  "weight training",
  "weight-training",
  "weightlifting",
  "weight lifting",
  "muscle-strengthening",
  "muscle strengthening",
  "lifting",
);
/** Reviews about children, athletes, rehabilitation or a single illness answer other questions. */
const OTHER =
  /\b(children|adolescen\w*|youth|athletes?|cancer|stroke|parkinson\w*|heart failure|COPD|pulmonary|multiple sclerosis|spinal cord|cerebral palsy|burn|amputat\w*|knee replacement|arthroplasty|ICU|critical\w*|blood flow restriction)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-weight_lifting",
  kind: "lifestyle",
  lifestyleId: "weight_lifting",
  name: "weight lifting",
  terms: [],
  outcomes: [
    {
      id: "strength-older",
      label: "Strength and muscle in older age",
      finding: "Muscle strength and muscle size in older adults",
      query: all(
        RT,
        any("older adults", "elderly", "older people", "very elderly", "ageing", "aging"),
        any("muscle strength", "muscle mass", "lean mass", "hypertrophy", "strength"),
      ),
      title: [RT_T, w("older", "elder", "aged", "ageing", "aging", "sarcopeni", "muscle", "strength")],
      excludeTitle: OTHER,
      question: q(
        "Adults aged 60 and over, living at home or in care (reviews of one illness count as partly)",
        "Resistance training (lifting weights or working against a load)",
        "No exercise or usual care",
        "Muscle strength, muscle size or lean mass",
      ),
    },
    {
      id: "body-fat",
      label: "Body fat",
      finding: "Body fat and fat mass",
      query: all(RT, any("body fat", "fat mass", "adiposity", "body composition", "visceral fat")),
      title: [RT_T, w("fat", "adipos", "body composition", "visceral")],
      excludeTitle: OTHER,
      question: q(
        "Healthy adults, with and without overweight (reviews of one illness count as partly)",
        "Resistance training",
        "No exercise",
        "Body fat percentage, fat mass or visceral fat",
      ),
    },
    {
      id: "mortality",
      label: "Death and disease",
      finding: "Death from any cause, heart disease and cancer",
      query: all(RT, DEATH),
      title: [RT_T, w("mortalit", "death", "survival", "non-communicable")],
      excludeTitle: OTHER,
      question: q(GENERAL, "Resistance training or muscle-strengthening activity", "No resistance training", "Death from any cause, heart disease or cancer"),
    },
    {
      id: "diabetes",
      label: "Type 2 diabetes",
      finding: "Blood sugar (HbA1c) in type 2 diabetes",
      query: all(RT, any("type 2 diabetes", "diabetes", "HbA1c", "glycemic control", "glycaemic control", "insulin sensitivity")),
      title: [RT_T, w("diabet", "HbA1c", "glyc", "glucose", "insulin")],
      excludeTitle: OTHER,
      question: q(
        "Adults with type 2 diabetes or prediabetes",
        "Resistance training",
        "No exercise or usual care",
        "HbA1c, blood sugar or insulin sensitivity",
      ),
    },
    {
      id: "bone",
      label: "Bone density",
      finding: "Bone density in older adults",
      query: all(RT, any("bone mineral density", "bone density", "osteoporosis", "osteopenia", "fracture", "fractures", "bone loss")),
      title: [RT_T, w("bone", "osteopor", "osteopen", "fracture")],
      excludeTitle: OTHER,
      question: q(
        "Older adults, including postmenopausal women (reviews of one illness count as partly)",
        "Resistance training",
        "No exercise or usual care",
        "Bone mineral density or fractures",
      ),
    },
    {
      id: "depression",
      label: "Depression",
      finding: "Depression and depressive symptoms",
      query: all(RT, any("depression", "depressive symptoms", "depressive", "anxiety", "mood", "mental health")),
      title: [RT_T, w("depress", "anxiety", "mood", "mental")],
      excludeTitle: OTHER,
      question: q("Adults, with or without depression", "Resistance training", "No exercise or a non-active control", "Depression or depressive symptoms"),
    },
  ],
};
