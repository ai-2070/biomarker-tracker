import { all, any, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

const VEGAN = any("vegan", "vegans", "vegan diet", "vegan diets", "veganism", "plant-based diet", "vegetarian and vegan", "vegetarian or vegan");
const VEGAN_T = w("vegan", "vegetarian", "plant-based", "plant based");
/** Reviews about animals, pets or other groups of people. */
const NOT_PEOPLE = /\b(dogs?|cats?|pets?|canine|feline|animals?|athletes?|children|infants?|pregnan\w*|lactation|breastfe\w*)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-vegan_diet",
  kind: "lifestyle",
  lifestyleId: "vegan_diet",
  name: "a vegan diet",
  terms: [],
  outcomes: [
    {
      id: "ldl",
      label: "LDL cholesterol",
      finding: "LDL cholesterol and other blood fats",
      query: all(VEGAN, any("cholesterol", "LDL", "lipids", "blood lipids", "apolipoprotein B", "triglycerides")),
      title: [VEGAN_T, w("cholesterol", "LDL", "lipid", "cardiometabolic", "cardiovascular risk factor")],
      excludeTitle: NOT_PEOPLE,
      question: q(
        GENERAL,
        "A vegan or vegetarian diet",
        "A mixed (omnivorous) or less restrictive diet",
        "LDL and total cholesterol, triglycerides, apolipoprotein B",
      ),
    },
    {
      id: "weight-glucose",
      label: "Weight and blood sugar",
      finding: "Body weight and blood sugar (HbA1c)",
      query: all(VEGAN, any("body weight", "weight loss", "BMI", "HbA1c", "glycaemic", "glycemic", "type 2 diabetes", "glucose")),
      title: [VEGAN_T, w("weight", "obes", "overweight", "diabet", "glyc", "glucose", "cardiometabolic")],
      excludeTitle: NOT_PEOPLE,
      question: q(
        "Adults with overweight or type 2 diabetes",
        "A vegan or vegetarian diet",
        "A control or less restrictive diet",
        "Body weight, body mass index and HbA1c",
      ),
    },
    {
      id: "blood-pressure",
      label: "Blood pressure",
      finding: "Blood pressure",
      query: all(VEGAN, any("blood pressure", "hypertension")),
      title: [VEGAN_T, w("blood pressure", "hypertens", "cardiometabolic")],
      excludeTitle: NOT_PEOPLE,
      question: q(GENERAL, "A vegan or vegetarian diet", "A less restrictive diet", "Systolic and diastolic blood pressure"),
    },
    {
      id: "heart-cancer-mortality",
      label: "Heart disease, cancer, death",
      finding: "Heart disease, cancer and death from any cause",
      query: all(VEGAN, any("mortality", "cardiovascular", "ischemic heart disease", "ischaemic heart disease", "cancer", "stroke", "all-cause")),
      title: [VEGAN_T, w("mortalit", "death", "cardiovascular", "heart", "cancer", "stroke", "chronic disease", "health outcomes")],
      excludeTitle: NOT_PEOPLE,
      question: q(GENERAL, "A vegetarian or vegan diet", "Eating meat", "Heart and blood vessel disease, cancer, or death from any cause"),
    },
    {
      id: "fractures",
      label: "Hip and other fractures",
      finding: "Hip and other fractures",
      query: all(VEGAN, any("fracture", "fractures", "hip fracture", "bone mineral density", "bone health")),
      title: [VEGAN_T, w("fracture", "bone")],
      excludeTitle: NOT_PEOPLE,
      question: q(GENERAL, "A vegetarian or vegan diet", "Eating meat", "Hip and other fractures, or bone health"),
    },
    {
      id: "b12",
      label: "Vitamin B12",
      finding: "Vitamin B12 status",
      query: all(VEGAN, any("vitamin B12", "B12", "cobalamin", "holotranscobalamin", "B12 deficiency")),
      title: [VEGAN_T, w("B12", "B-12", "cobalamin")],
      excludeTitle: NOT_PEOPLE,
      question: q(
        "Vegans and vegetarians, and people who switch to a vegan diet, not taking supplements",
        "A vegan or vegetarian diet",
        "Eating meat",
        "Vitamin B12 levels or vitamin B12 deficiency",
      ),
    },
  ],
};
