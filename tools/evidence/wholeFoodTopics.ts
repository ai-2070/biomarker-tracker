/**
 * Evidence maps for the whole foods (knowledge/wholefoods): one map per food, one outcome per finding.
 * Like the lifestyle maps: each finding has its own search (the food's words AND the outcome's words),
 * reviews of any design count, and the question asks about eating the food itself. Reviews of extracts
 * or supplements of the food are a different question and count only as partly (the screening prompt
 * says so).
 */
import type { Question } from "../../src/core/evidenceMap";
import type { TopicDef } from "./topics";

/** Any of these words or word starts in a title, any case. */
const w = (...x: string[]) => new RegExp(`\\b(${x.join("|")})`, "i");
/** Any of these in the title or abstract (Europe PMC syntax; phrases quoted). */
const any = (...x: string[]) => `(${x.map((p) => `TITLE_ABS:${/[\s-]/.test(p) ? `"${p}"` : p}`).join(" OR ")})`;
const all = (...groups: string[]) => groups.join(" AND ");
const q = (population: string, intervention: string, comparison: string, outcome: string): Question => ({ population, intervention, comparison, outcome });

const ADULTS = "Adults, healthy or with risk factors (reviews limited to one illness count as partly)";

// Outcomes shared across foods: the search words and the title words.
const O = {
  bp: { q: any("blood pressure", "hypertension", "hypertensive"), t: w("blood pressure", "hypertens") },
  // Reviews of "cardiovascular risk factors" or "metabolic syndrome" report blood fats and sugar without naming them in the title.
  lipids: { q: any("cholesterol", "lipid profile", "lipids", "triglycerides", "LDL", "HDL"), t: w("lipid", "cholesterol", "LDL", "HDL", "triglycerid", "cardiometabolic", "cardiovascular", "metabolic syndrome", "risk factor") },
  sugar: { q: any("insulin", "glucose", "glycemic", "glycaemic", "HbA1c", "insulin resistance"), t: w("insulin", "glucose", "glyc", "HbA1c", "diabet", "cardiometabolic", "metabolic", "cardiovascular risk", "risk factor") },
  crp: { q: any("C-reactive protein", "CRP", "inflammation", "inflammatory"), t: w("C-reactive", "CRP", "inflamm") },
  cognition: { q: any("cognitive", "cognition", "memory", "dementia", "alzheimer"), t: w("cogniti", "memory", "dementia", "alzheimer", "brain") },
  exercise: { q: any("exercise", "muscle damage", "muscle soreness", "recovery", "athletes", "performance"), t: w("exercise", "muscle", "recover", "soreness", "athlet", "performance", "sport") },
};

// ---- The foods' own words
const OLIVE = any("olive oil", "extra virgin olive oil", "extra-virgin olive oil", "EVOO");
const OLIVE_T = w("olive");
const BLUE = any("blueberry", "blueberries", "wild blueberry", "wild blueberries", "Vaccinium corymbosum", "Vaccinium angustifolium");
const BLUE_T = w("blueberr");
const STRAW = any("strawberry", "strawberries", "Fragaria");
const STRAW_T = w("strawberr", "fragaria");
const POM = any("pomegranate", "pomegranates", "Punica granatum");
const POM_T = w("pomegranate", "punica");
const GINGER = any("ginger", "Zingiber officinale", "gingerol", "gingerols");
const GINGER_T = w("ginger", "zingiber");
const NAUSEA = w("nausea", "vomit", "emesis", "antiemetic", "hyperemesis", "PONV");

export const WHOLE_FOOD_TOPICS: TopicDef[] = [
  {
    id: "wholefood-evoo",
    kind: "wholefood",
    wholeFoodId: "evoo",
    name: "olive oil",
    terms: [],
    outcomes: [
      { id: "cardiovascular", label: "Heart attacks and strokes", finding: "Heart attacks, strokes and deaths from heart disease", query: all(OLIVE, any("cardiovascular", "coronary", "stroke", "myocardial infarction", "heart disease")), title: [OLIVE_T, w("cardiovascular", "coronar", "stroke", "heart", "myocard")], question: q(ADULTS, "Olive oil, especially extra virgin, eaten as food (more of it, or as part of a diet such as PREDIMED's)", "Less olive oil, other fats, or a low-fat diet", "Heart attacks, strokes or deaths from heart disease") },
      { id: "mortality", label: "Death and cancer", finding: "Death from any cause, heart disease and cancer", query: all(OLIVE, any("mortality", "death", "cancer")), title: [OLIVE_T, w("mortalit", "death", "cancer", "survival")], question: q(ADULTS, "More olive oil eaten as food", "Less olive oil", "Death from any cause, deaths from heart disease, or cancer") },
      { id: "diabetes", label: "Type 2 diabetes", finding: "Type 2 diabetes: getting it, and blood sugar in people who have it", query: all(OLIVE, any("diabetes", "HbA1c", "glycemic", "glycaemic", "blood glucose")), title: [OLIVE_T, w("diabet", "glyc", "glucose", "HbA1c", "insulin")], question: q("Adults without diabetes (new cases), or adults with type 2 diabetes (blood sugar)", "Olive oil eaten as food", "Less olive oil or other fats", "New type 2 diabetes, or HbA1c and fasting glucose") },
      { id: "lipids", label: "Blood fats", finding: "Blood fats: LDL and HDL cholesterol, total cholesterol and triglycerides", query: all(OLIVE, O.lipids.q), title: [OLIVE_T, O.lipids.t], question: q(ADULTS, "Olive oil eaten as food", "Other oils or fats, or less olive oil", "LDL, HDL or total cholesterol, or triglycerides") },
      { id: "polyphenols", label: "Oxidised LDL and HDL", finding: "Oxidised LDL and how well HDL works: high- vs low-polyphenol olive oil", query: all(any("olive oil", "hydroxytyrosol", "olive polyphenols", "phenolic compounds"), any("LDL oxidation", "oxidized LDL", "oxidised LDL", "HDL function", "cholesterol efflux", "oxidative stress")), title: [w("olive", "hydroxytyrosol", "polyphenol", "phenol"), w("oxid", "HDL", "efflux", "LDL")], question: q(ADULTS, "Olive oil high in polyphenols (extra virgin)", "Olive oil low in polyphenols (refined), or other oils", "Oxidised LDL, oxidative stress markers, or HDL function") },
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(OLIVE, O.bp.q), title: [OLIVE_T, O.bp.t], question: q(ADULTS, "Olive oil eaten as food", "Other oils or fats, or less olive oil", "Blood pressure") },
      { id: "inflammation", label: "Inflammation and blood vessels", finding: "Inflammation markers (CRP) and blood vessel function", query: all(OLIVE, any("C-reactive protein", "CRP", "inflammation", "inflammatory", "endothelial function", "flow-mediated dilation")), title: [OLIVE_T, w("inflamm", "CRP", "C-reactive", "endotheli", "vascular", "flow-mediated")], question: q(ADULTS, "Olive oil eaten as food", "Other oils or fats, or less olive oil", "CRP or other inflammation markers, or blood vessel function (flow-mediated dilation)") },
      { id: "cognition", label: "Memory and dementia", finding: "Memory and thinking, and death with dementia", query: all(OLIVE, O.cognition.q), title: [OLIVE_T, O.cognition.t], question: q("Adults, mostly older", "Olive oil eaten as food", "Less olive oil or other fats", "Memory and thinking, dementia, or death with dementia") },
    ],
  },
  {
    id: "wholefood-blueberries",
    kind: "wholefood",
    wholeFoodId: "blueberries",
    name: "blueberries",
    terms: [],
    outcomes: [
      { id: "vascular", label: "Blood vessel function", finding: "Blood vessel function (flow-mediated dilation: how much an artery widens when blood flow increases)", query: all(BLUE, any("endothelial function", "flow-mediated dilation", "vascular function", "arterial stiffness")), title: [BLUE_T, w("endotheli", "vascular", "flow-mediated", "FMD", "arter", "cardiovascular", "cardiometabolic")], question: q(ADULTS, "Blueberries: whole, juice or freeze-dried whole-blueberry powder", "Placebo powder or drink, or no blueberries", "Blood vessel function (flow-mediated dilation) or arterial stiffness") },
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(BLUE, O.bp.q), title: [BLUE_T, w("blood pressure", "hypertens", "cardiovascular", "cardiometabolic", "metabolic syndrome")], question: q(ADULTS, "Blueberries: whole, juice or freeze-dried whole-blueberry powder", "Placebo or no blueberries", "Blood pressure") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar and insulin sensitivity", query: all(BLUE, O.sugar.q), title: [BLUE_T, O.sugar.t], question: q(ADULTS, "Blueberries: whole, juice or freeze-dried whole-blueberry powder", "Placebo or no blueberries", "Blood sugar, HbA1c or insulin sensitivity") },
      { id: "lipids", label: "Cholesterol", finding: "Cholesterol and triglycerides", query: all(BLUE, O.lipids.q), title: [BLUE_T, O.lipids.t], question: q(ADULTS, "Blueberries: whole, juice or freeze-dried whole-blueberry powder", "Placebo or no blueberries", "Cholesterol or triglycerides") },
      { id: "cognition", label: "Memory and thinking", finding: "Memory and thinking", query: all(BLUE, O.cognition.q), title: [BLUE_T, O.cognition.t], question: q("Children or adults, often older adults", "Blueberries: whole, juice or freeze-dried whole-blueberry powder", "Placebo or no blueberries", "Memory, thinking or mood") },
      { id: "diabetes-risk", label: "Type 2 diabetes risk", finding: "Risk of type 2 diabetes", query: all(BLUE, any("diabetes", "type 2 diabetes")), title: [w("blueberr", "berr", "fruit", "anthocyanin"), w("diabet")], question: q("Adults without diabetes", "Eating more blueberries", "Eating fewer or none", "New type 2 diabetes") },
      { id: "exercise", label: "Exercise recovery", finding: "Recovery after hard exercise (berries in general: blueberries, cranberries and bilberries)", query: all(any("blueberry", "blueberries", "Vaccinium", "berries", "berry", "bilberry", "cranberry"), O.exercise.q), title: [w("blueberr", "berr", "vaccinium", "cranberr", "bilberr"), O.exercise.t], question: q("Adults, often active or athletes", "Blueberries or related berries (bilberry, cranberry), as food, juice or whole-fruit powder", "Placebo or no berries", "Muscle soreness, muscle damage, recovery or exercise performance") },
    ],
  },
  {
    id: "wholefood-strawberries",
    kind: "wholefood",
    wholeFoodId: "strawberries",
    name: "strawberries",
    terms: [],
    outcomes: [
      { id: "lipids", label: "Cholesterol", finding: "Blood fats: total and LDL cholesterol", query: all(STRAW, O.lipids.q), title: [STRAW_T, O.lipids.t], question: q(ADULTS, "Strawberries: whole or freeze-dried whole-strawberry powder", "Placebo powder or no strawberries", "Total or LDL cholesterol, or triglycerides") },
      { id: "crp", label: "CRP", finding: "C-reactive protein (CRP), a blood marker of inflammation", query: all(STRAW, O.crp.q), title: [STRAW_T, w("C-reactive", "CRP", "inflamm", "cardiovascular", "cardiometabolic", "risk factors")], question: q(ADULTS, "Strawberries: whole or freeze-dried whole-strawberry powder", "Placebo or no strawberries", "C-reactive protein (CRP) or other inflammation markers") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar and insulin, fasting and after meals", query: all(STRAW, O.sugar.q), title: [STRAW_T, O.sugar.t], question: q(ADULTS, "Strawberries: whole or freeze-dried whole-strawberry powder", "Placebo, a sugar-matched control, or no strawberries", "Blood sugar or insulin, fasting or after a meal") },
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(STRAW, O.bp.q), title: [STRAW_T, w("blood pressure", "hypertens", "cardiovascular", "risk factors")], question: q(ADULTS, "Strawberries: whole or freeze-dried whole-strawberry powder", "Placebo or no strawberries", "Blood pressure") },
      { id: "cognition", label: "Memory and dementia", finding: "Memory, thinking and Alzheimer's dementia", query: all(STRAW, O.cognition.q), title: [STRAW_T, O.cognition.t], question: q("Adults, mostly older", "Strawberries: whole, powder, or eating more of them", "Placebo, or eating fewer", "Memory and thinking, cognitive decline, or Alzheimer's dementia") },
      { id: "heart-attack", label: "Heart attacks", finding: "Heart attacks (blueberries and strawberries counted together; berries in general)", query: all(any("strawberry", "strawberries", "berries", "berry", "anthocyanin", "anthocyanins"), any("myocardial infarction", "coronary heart disease", "heart attack", "cardiovascular disease")), title: [w("strawberr", "berr", "anthocyanin"), w("myocard", "coronar", "heart", "cardiovascular")], question: q("Adults without heart disease at the start", "Eating more strawberries or berries (whole food)", "Eating fewer", "Heart attacks or coronary heart disease") },
      { id: "knee", label: "Knee osteoarthritis", finding: "Knee osteoarthritis pain", query: all(STRAW, any("osteoarthritis", "knee pain", "joint pain", "arthritis")), title: [STRAW_T, w("osteoarthrit", "knee", "joint", "arthrit", "pain")], question: q("Adults with knee osteoarthritis", "Strawberries: whole or freeze-dried whole-strawberry powder", "Placebo or no strawberries", "Pain, function or inflammation markers") },
    ],
  },
  {
    id: "wholefood-pomegranate",
    kind: "wholefood",
    wholeFoodId: "pomegranate",
    name: "pomegranate",
    terms: [],
    outcomes: [
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(POM, O.bp.q), title: [POM_T, O.bp.t], question: q(ADULTS, "Pomegranate juice or the fruit (seeds/arils)", "Placebo drink, water, or no pomegranate", "Blood pressure") },
      { id: "lipids", label: "Blood fats", finding: "Blood fats (LDL cholesterol, HDL cholesterol, triglycerides)", query: all(POM, O.lipids.q), title: [POM_T, O.lipids.t], question: q(ADULTS, "Pomegranate juice or the fruit (seeds/arils)", "Placebo drink, water, or no pomegranate", "LDL or HDL cholesterol, or triglycerides") },
      { id: "crp", label: "CRP", finding: "Inflammation: C-reactive protein (CRP)", query: all(POM, O.crp.q), title: [POM_T, O.crp.t], question: q(ADULTS, "Pomegranate juice or the fruit (seeds/arils)", "Placebo drink, water, or no pomegranate", "C-reactive protein (CRP) or other inflammation markers") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar: fasting glucose and HbA1c (long-term blood sugar)", query: all(POM, O.sugar.q), title: [POM_T, O.sugar.t], question: q(ADULTS, "Pomegranate juice or the fruit (seeds/arils)", "Placebo drink, water, or no pomegranate", "Fasting glucose, HbA1c or insulin") },
      { id: "carotid", label: "Neck arteries", finding: "Thickening of the neck arteries (carotid intima-media thickness)", query: all(POM, any("carotid", "intima-media", "atherosclerosis", "arterial", "endothelial function", "vascular")), title: [POM_T, w("carotid", "intima", "atheroscler", "arter", "endotheli", "vascular", "cardiovascular")], question: q(ADULTS, "Pomegranate juice or the fruit (seeds/arils)", "Placebo drink or no pomegranate", "Carotid intima-media thickness, atherosclerosis, or blood vessel function") },
      { id: "prostate", label: "Prostate cancer (PSA)", finding: "Prostate cancer: how fast PSA rises after treatment (PSA doubling time)", query: all(POM, any("prostate", "PSA", "prostate-specific antigen")), title: [POM_T, w("prostat", "PSA")], question: q("Men with prostate cancer, or rising PSA after treatment", "Pomegranate juice", "Placebo or no pomegranate", "PSA doubling time, PSA, or prostate cancer progression") },
      { id: "exercise", label: "Exercise recovery", finding: "Muscle damage and soreness after hard exercise", query: all(POM, O.exercise.q), title: [POM_T, O.exercise.t], question: q("Adults, often active or athletes", "Pomegranate juice", "Placebo drink", "Muscle soreness, muscle damage, strength recovery or performance") },
    ],
  },
  {
    id: "wholefood-ginger",
    kind: "wholefood",
    wholeFoodId: "ginger",
    name: "ginger",
    terms: [],
    outcomes: [
      { id: "pregnancy", label: "Nausea in pregnancy", finding: "Nausea and vomiting in early pregnancy", query: all(GINGER, any("pregnancy", "pregnant", "morning sickness", "hyperemesis")), title: [GINGER_T, w("pregnan", "morning sickness", "hyperemesis", "gestation")], question: q("Pregnant women with nausea and vomiting", "Ginger: fresh, dried, ground in capsules, or tea", "Placebo, vitamin B6, or no treatment", "Nausea, vomiting, or safety in pregnancy") },
      { id: "surgery", label: "Nausea after surgery", finding: "Nausea and vomiting after surgery", query: all(GINGER, any("postoperative", "post-operative", "surgery", "anaesthesia", "anesthesia")), title: [GINGER_T, NAUSEA], question: q("Adults having surgery", "Ginger: ground ginger in capsules or other ginger preparations", "Placebo or no ginger", "Nausea or vomiting after surgery") },
      { id: "chemotherapy", label: "Nausea with chemotherapy", finding: "Nausea and vomiting during chemotherapy", query: all(GINGER, any("chemotherapy", "chemotherapy-induced", "cancer")), title: [GINGER_T, w("nausea", "vomit", "emesis", "chemotherap")], question: q("People having chemotherapy", "Ginger added to usual anti-sickness medicines", "Placebo or usual medicines alone", "Nausea or vomiting") },
      { id: "dysmenorrhoea", label: "Period pain", finding: "Period pain (primary dysmenorrhoea)", query: all(GINGER, any("dysmenorrhea", "dysmenorrhoea", "menstrual pain", "period pain")), title: [GINGER_T, w("dysmenorrh", "menstru", "period pain")], question: q("Women with period pain (primary dysmenorrhoea)", "Ginger: ground ginger in capsules", "Placebo or painkillers (NSAIDs)", "Pain intensity or duration") },
      { id: "osteoarthritis", label: "Knee osteoarthritis", finding: "Knee osteoarthritis pain", query: all(GINGER, any("osteoarthritis", "knee pain", "arthritis")), title: [GINGER_T, w("osteoarthrit", "arthrit", "knee", "joint")], question: q("Adults with knee osteoarthritis", "Ginger: ground ginger (reviews of extracts count as partly)", "Placebo or no ginger", "Pain or disability") },
      { id: "diabetes", label: "Blood sugar in diabetes", finding: "Blood sugar and HbA1c in type 2 diabetes", query: all(GINGER, O.sugar.q), title: [GINGER_T, O.sugar.t], question: q("Adults with type 2 diabetes", "Ginger: ground ginger in capsules or other ginger preparations", "Placebo or no ginger", "Fasting glucose, HbA1c or insulin") },
      { id: "lipids", label: "Blood fats", finding: "Blood fats (triglycerides and cholesterol)", query: all(GINGER, O.lipids.q), title: [GINGER_T, O.lipids.t], question: q(ADULTS, "Ginger: ground ginger in capsules or other ginger preparations", "Placebo or no ginger", "Triglycerides, LDL, HDL or total cholesterol") },
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(GINGER, O.bp.q), title: [GINGER_T, w("blood pressure", "hypertens", "cardiovascular", "cardiometabolic")], question: q(ADULTS, "Ginger: ground ginger in capsules or other ginger preparations", "Placebo or no ginger", "Blood pressure") },
      { id: "inflammation", label: "Inflammation", finding: "Inflammation in the blood (CRP and other signals)", query: all(GINGER, any("C-reactive protein", "CRP", "inflammation", "inflammatory", "interleukin", "TNF")), title: [GINGER_T, w("C-reactive", "CRP", "inflamm", "cytokin", "interleukin", "TNF", "oxidative")], question: q(ADULTS, "Ginger: ground ginger in capsules or other ginger preparations", "Placebo or no ginger", "CRP or other inflammation markers") },
    ],
  },
];
