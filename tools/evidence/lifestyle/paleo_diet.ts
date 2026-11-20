/** Evidence map for the paleo diet (knowledge/lifestyle/paleo_diet.json): one search per finding, reviews of any design. */

import { all, any, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

const PALEO = any(
  "paleolithic diet",
  "palaeolithic diet",
  "paleo diet",
  "paleolithic nutrition",
  "palaeolithic nutrition",
  "paleolithic-type diet",
  "paleolithic dietary",
  "stone age diet",
);
const PALEO_T = w("paleo", "palaeo", "stone age", "hunter.gatherer");
/** Reviews of a single illness (multiple sclerosis, cancer) and archaeology answer other questions than paleo for general adults. */
const OTHER_GROUPS =
  /\b(multiple sclerosis|cancer\w*|children|pediatric|paediatric|pregnan\w*|athletes?|archaeolog\w*|fossil\w*|skeleton\w*|teeth|isotope\w*)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-paleo_diet",
  kind: "lifestyle",
  lifestyleId: "paleo_diet",
  name: "paleo diet",
  terms: [],
  outcomes: [
    {
      id: "weight",
      label: "Weight and waist",
      finding: "Body weight, waist and body fat",
      query: all(PALEO, any("weight", "body weight", "obesity", "overweight", "waist", "body composition", "body fat", "anthropometric")),
      title: [PALEO_T, w("weight", "obes", "overweight", "waist", "body", "anthropomet", "chronic")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Adults, most with overweight or a chronic illness (reviews of one illness count as partly)",
        "A paleo diet",
        "Guideline-based or usual diets",
        "Body weight, waist size or body fat",
      ),
    },
    {
      id: "metabolic",
      label: "Blood fats and blood pressure",
      finding: "Triglycerides, blood pressure and other metabolic syndrome measures",
      query: all(PALEO, any("metabolic syndrome", "triglycerides", "blood pressure", "cardiovascular", "lipids", "cardiometabolic", "cholesterol")),
      title: [PALEO_T, w("metabolic", "triglycerid", "blood pressure", "cardiovascular", "lipid", "cardiometabolic", "cholesterol", "risk factor")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        "Adults, most with metabolic syndrome or overweight",
        "A paleo diet",
        "Guideline-based or usual diets",
        "Triglycerides, blood pressure, HDL cholesterol or fasting blood sugar",
      ),
    },
    {
      id: "diabetes",
      label: "Type 2 diabetes",
      finding: "Blood sugar in type 2 diabetes",
      query: all(PALEO, any("type 2 diabetes", "diabetes", "glycemic control", "glycaemic control", "insulin sensitivity", "HbA1c")),
      title: [PALEO_T, w("diabet", "glyc", "insulin", "HbA1c")],
      excludeTitle: OTHER_GROUPS,
      question: q("Adults with type 2 diabetes", "A paleo diet", "A diabetes diet or usual care", "Blood sugar (HbA1c) and insulin resistance"),
    },
    {
      id: "long-term",
      label: "Disease and death",
      finding: "Long-term disease and death",
      query: all(PALEO, any("mortality", "death", "cohort", "incidence", "cardiovascular disease", "cancer risk", "prospective", "longevity")),
      title: [PALEO_T, w("mortalit", "death", "cohort", "incidence", "disease", "risk", "prospective", "longevity")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        GENERAL,
        "Eating closer to a paleo pattern",
        "Eating less like a paleo pattern",
        "Death, heart disease, cancer, type 2 diabetes or high blood pressure",
      ),
    },
    {
      id: "gut",
      label: "Gut bacteria and TMAO",
      finding: "Gut bacteria and TMAO",
      query: all(
        PALEO,
        any("gut microbiota", "gut microbiome", "microbiome", "microbiota", "TMAO", "trimethylamine", "short chain fatty acids", "fibre", "fiber"),
      ),
      title: [PALEO_T, w("gut", "microb", "TMAO", "trimethylamine", "fibre", "fiber", "colonic", "bowel")],
      excludeTitle: OTHER_GROUPS,
      question: q(GENERAL, "A paleo diet", "A diet typical of national recommendations", "Gut bacteria, resistant starch or blood TMAO"),
    },
    {
      id: "nutrients",
      label: "Iodine and calcium",
      finding: "Iodine and other nutrients",
      query: all(PALEO, any("iodine", "calcium", "nutrient intake", "nutritional adequacy", "micronutrient", "micronutrients", "bone", "vitamin D", "dairy")),
      title: [PALEO_T, w("iodine", "calcium", "nutrient", "nutritional", "micronutrient", "bone", "vitamin", "dairy")],
      excludeTitle: OTHER_GROUPS,
      question: q(
        GENERAL,
        "A paleo diet (no grains, dairy or legumes)",
        "A diet based on national recommendations",
        "Iodine, calcium or other nutrient intakes or levels",
      ),
    },
  ],
};
