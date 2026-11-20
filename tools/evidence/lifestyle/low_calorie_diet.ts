/** Evidence map for the low-calorie diet (knowledge/lifestyle/low_calorie_diet.json): one search per finding, reviews of any design. */

import { all, any, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

const CR = any(
  "calorie restriction",
  "caloric restriction",
  "energy restriction",
  "low-calorie diet",
  "low calorie diet",
  "very low-calorie diet",
  "very low calorie diet",
  "very low energy diet",
  "very-low-energy diet",
  "VLCD",
  "total diet replacement",
  "hypocaloric",
);
const CR_T = w("calori", "caloric", "energy restrict", "energy.restrict", "low.energy", "VLCD", "diet replacement", "hypocaloric", "diet");
/** Reviews of a single illness or setting (surgery, cancer treatment, pregnancy) answer other questions. */
const OTHER_SETTINGS =
  /\b(pre-?operative|bariatric|surgery|surgical|cancer|chemotherapy|pregnan\w*|gestational|children|pediatric|paediatric|adolescents?|critically ill|intensive care|dialysis|polycystic|PCOS|epilep\w*|multiple sclerosis|athletes?)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-low_calorie_diet",
  kind: "lifestyle",
  lifestyleId: "low_calorie_diet",
  name: "low-calorie diet",
  terms: [],
  outcomes: [
    {
      id: "cardiometabolic",
      label: "Heart and blood sugar markers",
      finding: "Blood pressure, cholesterol and blood sugar markers in healthy adults",
      query: all(
        CR,
        any("cardiometabolic", "blood pressure", "cholesterol", "lipids", "insulin sensitivity", "cardiovascular risk factors", "C-reactive protein"),
      ),
      title: [CR_T, w("cardiometabolic", "blood pressure", "cholesterol", "lipid", "insulin", "cardiovascular", "risk factor", "metabolic")],
      excludeTitle: OTHER_SETTINGS,
      question: q(
        "Healthy adults without obesity, or adults with overweight (reviews of one illness count as partly)",
        "Calorie restriction or a low-calorie diet",
        "Eating as usual",
        "Blood pressure, LDL cholesterol, C-reactive protein or insulin resistance",
      ),
    },
    {
      id: "diabetes",
      label: "Weight and type 2 diabetes",
      finding: "Weight loss and remission of type 2 diabetes with a very low-calorie formula diet",
      query: all(CR, any("type 2 diabetes", "diabetes mellitus", "remission", "diabetes remission")),
      title: [CR_T, w("diabet", "remission")],
      excludeTitle: OTHER_SETTINGS,
      question: q(
        "Adults with type 2 diabetes",
        "A very low-calorie or low-calorie diet, such as a formula diet, followed by support",
        "Usual care or a standard diet",
        "Weight loss and remission of type 2 diabetes",
      ),
    },
    {
      id: "muscle-bone",
      label: "Muscle and bone",
      finding: "Loss of muscle and bone",
      query: all(CR, any("lean mass", "fat-free mass", "muscle mass", "bone mineral density", "bone loss", "body composition", "sarcopenia")),
      title: [CR_T, w("lean", "fat.free", "muscle", "bone", "body composition", "sarcopen")],
      excludeTitle: OTHER_SETTINGS,
      question: q(
        "Adults with overweight or obesity, or healthy adults",
        "Calorie restriction or a low-calorie diet",
        "Eating as usual, or the same diet with exercise",
        "Lean (fat-free) mass or bone mineral density",
      ),
    },
    {
      id: "maintenance",
      label: "Keeping weight off",
      finding: "Keeping the weight off afterwards",
      query: all(CR, any("weight regain", "weight maintenance", "weight-loss maintenance", "long-term weight", "relapse", "weight loss maintenance")),
      title: [CR_T, w("regain", "maintenance", "maintain", "long.term", "relapse", "weight")],
      excludeTitle: OTHER_SETTINGS,
      question: q(
        "Adults with overweight or obesity who lost weight on a low-calorie diet",
        "A very low-calorie or low-calorie diet followed by support",
        "No support or usual care afterwards",
        "Weight kept off, or weight regained",
      ),
    },
    {
      id: "ageing",
      label: "Pace of ageing",
      finding: "Pace of biological ageing (DNA methylation clocks)",
      query: all(
        any("calorie restriction", "caloric restriction", "energy restriction", "CALERIE"),
        any("biological age", "biological aging", "biological ageing", "epigenetic", "DNA methylation", "pace of aging", "DunedinPACE", "epigenetic clock"),
      ),
      title: [w("calori", "caloric", "restrict", "CALERIE"), w("age", "ageing", "aging", "epigenetic", "methylation", "clock", "DunedinPACE")],
      question: q(
        "Healthy adults without obesity",
        "Calorie restriction",
        "Eating as usual",
        "Biological ageing measured by DNA methylation clocks, such as DunedinPACE",
      ),
    },
    {
      id: "lifespan",
      label: "Living longer",
      finding: "Living longer",
      query: all(
        any("calorie restriction", "caloric restriction", "energy restriction", "dietary restriction"),
        any("lifespan", "life span", "longevity", "mortality", "survival", "healthspan", "healthy ageing"),
      ),
      title: [w("calori", "caloric", "restrict", "dietary"), w("lifespan", "life.span", "longevity", "mortality", "survival", "healthspan", "ageing", "aging")],
      excludeTitle: OTHER_SETTINGS,
      question: q(
        GENERAL,
        "Calorie restriction (about 10 to 30% fewer calories than usual) over years",
        "Eating as usual",
        "Death or lifespan (animal studies count as partly)",
      ),
    },
  ],
};
