/**
 * Evidence maps for the whole foods (knowledge/wholefoods): one map per food, one outcome per finding.
 * Like the lifestyle maps: each finding has its own search (the food's words AND the outcome's words),
 * reviews of any design count, and the question asks about eating the food itself. Reviews of extracts
 * or supplements of the food are a different question and count only as partly (the screening prompt
 * says so).
 */
import type { Question } from "@bt/core/evidenceMap";
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
const HONEY = any("honey", "manuka");
const HONEY_T = w("honey", "manuka");
const EGG = any("egg", "eggs", "egg consumption", "egg intake", "egg yolk");
const EGG_T = w("eggs?\\b", "egg yolk");
const BEET = any("beetroot", "beet juice", "beetroot juice", "beets", "Beta vulgaris", "dietary nitrate", "nitrate-rich");
const BEET_T = w("beet", "nitrate");
const TEA = any("green tea", "Camellia sinensis", "matcha", "tea consumption", "tea drinking");
const TEA_T = w("green tea", "tea\\b", "camellia");
const KIWI = any("kiwifruit", "kiwi fruit", "kiwi", "Actinidia");
const KIWI_T = w("kiwi", "actinidia");
const DEATH = any("mortality", "death");
const GRAPE = any("grape", "grapes", "raisin", "raisins", "grape juice", "Concord grape", "Vitis vinifera");
const GRAPE_T = w("grape", "raisin", "vitis");
/** Grape seed extract, resveratrol and wine are different exposures. */
const NOT_THE_FRUIT = /\b(seed extract|resveratrol|wine|grapefruit)\b/i;

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
    id: "wholefood-honey",
    kind: "wholefood",
    wholeFoodId: "honey",
    name: "honey",
    terms: [],
    outcomes: [
      { id: "cough", label: "Cough in children", finding: "Short-term (acute) cough in children", query: all(HONEY, any("cough", "coughing")), title: [HONEY_T, w("cough")], question: q("Children with a short-term cough", "Honey", "No treatment, placebo or cough medicines", "Cough frequency or severity, or sleep") },
      { id: "colds", label: "Colds", finding: "Symptoms of colds and other upper respiratory tract infections (nose, throat and upper airways)", query: all(HONEY, any("upper respiratory", "respiratory tract infection", "common cold", "sore throat")), title: [HONEY_T, w("respiratory", "cold", "throat", "cough")], question: q("Children or adults with colds or other upper respiratory infections", "Honey", "Usual care or other treatments", "Symptoms such as cough, sore throat or congestion") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar: fasting glucose and HbA1c (long-term blood sugar)", query: all(HONEY, O.sugar.q), title: [HONEY_T, w("glyc", "glucose", "HbA1c", "diabet", "insulin", "cardiometabolic", "metabolic")], question: q(ADULTS, "Honey eaten as food, often in place of other sugars", "Sugar, other sweeteners, or no honey", "Fasting glucose, HbA1c or insulin") },
      { id: "lipids", label: "Blood fats", finding: "Blood fats (total cholesterol, LDL cholesterol, HDL cholesterol, triglycerides)", query: all(HONEY, O.lipids.q), title: [HONEY_T, O.lipids.t], question: q(ADULTS, "Honey eaten as food, often in place of other sugars", "Sugar or no honey", "Cholesterol or triglycerides") },
      { id: "burns", label: "Burns (on the skin)", finding: "Healing of burns, with honey dressings applied to the skin (not eaten)", query: all(HONEY, any("burn", "burns")), title: [HONEY_T, w("burn")], question: q("People with burns", "Honey dressings applied to the skin", "Other dressings, silver sulfadiazine or standard care", "Healing time, healing rate or infection") },
      { id: "wounds", label: "Wounds (on the skin)", finding: "Healing of leg ulcers, diabetic foot ulcers and other wounds, with honey applied to the skin (not eaten)", query: all(HONEY, any("wound", "wounds", "ulcer", "ulcers", "wound healing")), title: [HONEY_T, w("wound", "ulcer")], question: q("People with leg ulcers, diabetic foot ulcers or other wounds", "Honey applied to the wound", "Other dressings or standard care", "Healing time or healing rate") },
      { id: "mucositis", label: "Mouth sores in cancer care", finding: "Mouth sores from cancer treatment (oral mucositis)", query: all(HONEY, any("mucositis")), title: [HONEY_T, w("mucositis")], question: q("People having radiotherapy or chemotherapy", "Honey in the mouth", "Placebo, saline or usual care", "Oral mucositis: how often, how severe, or pain") },
    ],
  },
  {
    id: "wholefood-eggs",
    kind: "wholefood",
    wholeFoodId: "eggs",
    name: "eggs",
    terms: [],
    outcomes: [
      { id: "cardiovascular", label: "Heart disease and stroke", finding: "Heart disease and stroke", query: all(EGG, any("cardiovascular", "coronary", "stroke", "heart disease")), title: [EGG_T, w("cardiovascular", "coronar", "stroke", "heart")], question: q(ADULTS, "Eating more eggs", "Eating fewer eggs", "Heart disease or stroke") },
      { id: "mortality", label: "Death", finding: "Death from any cause", query: all(EGG, DEATH), title: [EGG_T, w("mortalit", "death")], question: q(ADULTS, "Eating more eggs", "Eating fewer eggs", "Death from any cause") },
      { id: "diabetes", label: "Type 2 diabetes", finding: "Getting type 2 diabetes", query: all(EGG, any("diabetes", "type 2 diabetes")), title: [EGG_T, w("diabet")], question: q("Adults without diabetes", "Eating more eggs", "Eating fewer eggs", "New type 2 diabetes") },
      { id: "lipids", label: "Cholesterol", finding: "LDL and HDL cholesterol", query: all(EGG, O.lipids.q), title: [EGG_T, w("lipid", "cholesterol", "LDL", "HDL", "lipoprotein")], question: q(ADULTS, "Eggs (or extra eggs) in the diet", "Fewer or no eggs, or an egg substitute", "LDL or HDL cholesterol") },
      { id: "diabetes-heart", label: "With diabetes", finding: "Heart disease in people with type 2 diabetes", query: all(EGG, any("diabetes", "diabetic"), any("cardiovascular", "coronary", "heart", "lipid", "cholesterol")), title: [EGG_T, w("diabet")], question: q("People with type 2 diabetes", "Eating more eggs", "Eating fewer eggs", "Heart disease, or heart risk factors such as cholesterol") },
      { id: "lutein", label: "Lutein and the eye", finding: "Lutein in the blood and macular pigment in the eye", query: all(EGG, any("lutein", "zeaxanthin", "macular pigment", "carotenoids")), title: [EGG_T, w("lutein", "zeaxanthin", "macular", "carotenoid", "vision", "eye")], question: q(ADULTS, "Eggs or egg yolks", "Fewer or no eggs", "Lutein or zeaxanthin in the blood, or macular pigment") },
      { id: "tmao", label: "TMAO", finding: "TMAO, a gut-bacteria product of choline, in the blood", query: all(EGG, any("TMAO", "trimethylamine", "choline")), title: [EGG_T, w("TMAO", "trimethylamine", "choline")], question: q(ADULTS, "Eggs", "Fewer or no eggs, or choline supplements", "TMAO or choline in the blood") },
    ],
  },
  {
    id: "wholefood-beetroot",
    kind: "wholefood",
    wholeFoodId: "beetroot",
    name: "beetroot",
    terms: [],
    outcomes: [
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(BEET, O.bp.q), title: [BEET_T, O.bp.t], question: q(ADULTS, "Beetroot juice or whole beetroot (nitrate-rich); reviews pooling nitrate salts count as partly", "Nitrate-depleted juice, placebo or no beetroot", "Blood pressure") },
      { id: "endurance", label: "Endurance", finding: "Endurance and fitness tests (time to exhaustion, VO₂max)", query: all(BEET, any("exercise performance", "endurance", "time to exhaustion", "time trial", "VO2max", "oxygen uptake", "athletes")), title: [BEET_T, w("exercise", "endurance", "performance", "athlet", "sport", "oxygen", "VO2")], question: q("Healthy adults, from untrained to athletes", "Beetroot juice (nitrate-rich)", "Nitrate-depleted juice or placebo", "Endurance, time to exhaustion, time trials or oxygen uptake") },
      { id: "vascular", label: "Blood vessels", finding: "Blood vessel function (flow-mediated dilation) and artery stiffness", query: all(BEET, any("endothelial function", "flow-mediated dilation", "arterial stiffness", "vascular function", "pulse wave velocity")), title: [BEET_T, w("endotheli", "vascular", "flow-mediated", "arter", "stiffness")], question: q(ADULTS, "Beetroot juice or whole beetroot (nitrate-rich)", "Placebo or no beetroot", "Flow-mediated dilation or artery stiffness") },
      { id: "recovery", label: "Muscle recovery", finding: "Muscle damage and recovery after hard exercise", query: all(BEET, any("muscle damage", "muscle soreness", "recovery")), title: [BEET_T, w("muscle", "recover", "soreness", "damage")], question: q("Adults after hard exercise", "Beetroot juice", "Placebo", "Muscle soreness, damage markers or recovery of strength") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar and insulin", query: all(BEET, O.sugar.q), title: [BEET_T, O.sugar.t], question: q(ADULTS, "Beetroot juice or whole beetroot", "Placebo or no beetroot", "Blood sugar or insulin") },
      { id: "cognition", label: "Thinking and brain blood flow", finding: "Thinking and blood flow in the brain", query: all(BEET, any("cognitive", "cognition", "cerebral blood flow", "brain")), title: [BEET_T, w("cogniti", "cerebral", "brain", "memory")], question: q("Adults, often older", "Beetroot juice (nitrate-rich)", "Placebo", "Thinking tests or blood flow in the brain") },
    ],
  },
  {
    id: "wholefood-green_tea",
    kind: "wholefood",
    wholeFoodId: "green_tea",
    name: "green tea",
    terms: [],
    outcomes: [
      { id: "mortality", label: "Death", finding: "Death from any cause", query: all(TEA, DEATH), title: [TEA_T, w("mortalit", "death")], question: q(ADULTS, "Drinking more green tea (the drink, not extracts)", "Drinking less or none", "Death from any cause") },
      { id: "cardiovascular", label: "Heart disease and stroke", finding: "Heart disease and stroke", query: all(TEA, any("cardiovascular", "coronary", "stroke", "heart disease")), title: [TEA_T, w("cardiovascular", "coronar", "stroke", "heart")], question: q(ADULTS, "Drinking more green tea (the drink, not extracts)", "Drinking less or none", "Heart disease or stroke") },
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(TEA, O.bp.q), title: [TEA_T, O.bp.t], question: q(ADULTS, "Green tea as a drink (reviews mixing extract capsules count as partly)", "Placebo, water or no tea", "Blood pressure") },
      { id: "lipids", label: "Cholesterol", finding: "LDL and total cholesterol", query: all(TEA, O.lipids.q), title: [TEA_T, O.lipids.t], question: q(ADULTS, "Green tea as a drink (reviews mixing extract capsules count as partly)", "Placebo, water or no tea", "LDL or total cholesterol") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar and HbA1c", query: all(TEA, O.sugar.q), title: [TEA_T, O.sugar.t], question: q(ADULTS, "Green tea as a drink (reviews mixing extract capsules count as partly)", "Placebo, water or no tea", "Fasting glucose, HbA1c or insulin") },
      { id: "weight", label: "Body weight", finding: "Body weight", query: all(TEA, any("body weight", "weight loss", "body mass index", "obesity", "adiposity")), title: [TEA_T, w("weight", "obes", "adipos", "body composition", "anthropometric")], question: q(ADULTS, "Green tea as a drink (reviews of extracts count as partly)", "Placebo, water or no tea", "Body weight or body fat") },
      { id: "cancer", label: "Cancer", finding: "Cancer", query: all(TEA, any("cancer", "neoplasm", "carcinoma", "tumor", "tumour")), title: [TEA_T, w("cancer", "neoplas", "carcinoma", "tumou?r")], question: q(ADULTS, "Drinking more green tea", "Drinking less or none", "New cancers or cancer deaths") },
    ],
  },
  {
    id: "wholefood-kiwi",
    kind: "wholefood",
    wholeFoodId: "kiwi",
    name: "kiwifruit",
    terms: [],
    outcomes: [
      { id: "constipation", label: "Constipation", finding: "Constipation (bowel movements)", query: all(KIWI, any("constipation", "bowel movements", "bowel function", "laxation", "defecation")), title: [w("kiwi", "actinidia", "fruit", "food", "diet"), w("constipat", "bowel", "laxat", "defecat")], question: q("Adults with constipation", "Kiwifruit (whole fruit; powders and extracts count as partly)", "Placebo, psyllium, prunes or usual diet", "Bowel movements a week, stool consistency or symptoms") },
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(KIWI, O.bp.q), title: [KIWI_T, w("blood pressure", "hypertens", "cardiometabolic", "metabolic", "cardiovascular")], question: q(ADULTS, "Kiwifruit (whole fruit)", "Usual diet or another fruit", "Blood pressure") },
      { id: "lipids", label: "Blood fats", finding: "Blood fats (LDL cholesterol and triglycerides)", query: all(KIWI, O.lipids.q), title: [KIWI_T, O.lipids.t], question: q(ADULTS, "Kiwifruit (whole fruit)", "Usual diet or another fruit", "LDL cholesterol or triglycerides") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar after a starchy meal", query: all(KIWI, O.sugar.q), title: [KIWI_T, O.sugar.t], question: q(ADULTS, "Kiwifruit eaten with or before a starchy meal", "The same meal without kiwifruit, or another fruit", "Blood sugar after the meal") },
      { id: "vitamin-c", label: "Vitamin C", finding: "Vitamin C in the blood", query: all(KIWI, any("vitamin C", "ascorbic acid", "ascorbate")), title: [KIWI_T, w("vitamin C", "ascorb")], question: q("Adults", "Kiwifruit (whole fruit)", "No kiwifruit or a vitamin C tablet", "Vitamin C in the blood") },
      { id: "mood", label: "Mood", finding: "Mood and vitality", query: all(KIWI, any("mood", "vitality", "fatigue", "depression", "psychological", "wellbeing", "well-being")), title: [KIWI_T, w("mood", "vitality", "fatigue", "depress", "psycholog", "well")], question: q("Adults", "Kiwifruit (whole fruit)", "Placebo tablet, vitamin C tablet or no kiwifruit", "Mood, vitality or fatigue") },
      { id: "sleep", label: "Sleep", finding: "Sleep", query: all(KIWI, any("sleep", "insomnia")), title: [KIWI_T, w("sleep", "insomnia")], question: q("Adults, with or without sleep problems", "Kiwifruit before bed", "No kiwifruit or another fruit", "Sleep onset, duration or quality") },
      { id: "iron", label: "Iron", finding: "Iron status with an iron-fortified breakfast", query: all(KIWI, any("iron", "ferritin", "anaemia", "anemia")), title: [KIWI_T, w("iron", "ferritin", "an(a)?emi")], question: q("Adults, often women with low iron", "Kiwifruit eaten with iron-containing meals", "The same meals without kiwifruit, or another fruit", "Iron status (ferritin) or iron absorption") },
    ],
  },
  {
    id: "wholefood-grapes",
    kind: "wholefood",
    wholeFoodId: "grapes",
    name: "grapes",
    terms: [],
    outcomes: [
      { id: "diabetes", label: "Type 2 diabetes", finding: "Type 2 diabetes", query: all(GRAPE, any("diabetes", "type 2 diabetes")), title: [w("grape", "raisin", "fruit"), w("diabet")], excludeTitle: NOT_THE_FRUIT, question: q("Adults without diabetes", "Eating more grapes or raisins", "Eating fewer", "New type 2 diabetes") },
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(GRAPE, O.bp.q), title: [GRAPE_T, w("blood pressure", "hypertens", "vascular", "cardiovascular")], excludeTitle: NOT_THE_FRUIT, question: q(ADULTS, "Grapes, raisins, 100% grape juice or whole-grape powder", "Placebo, other snacks or no grapes", "Blood pressure") },
      { id: "lipids", label: "Blood fats", finding: "Blood fats (LDL cholesterol, total cholesterol, triglycerides)", query: all(GRAPE, O.lipids.q), title: [GRAPE_T, O.lipids.t], excludeTitle: NOT_THE_FRUIT, question: q(ADULTS, "Grapes, raisins, 100% grape juice or whole-grape powder (reviews pooling seed extracts count as partly)", "Placebo or no grapes", "LDL or total cholesterol, or triglycerides") },
      { id: "vascular", label: "Blood vessels", finding: "Blood vessel function (flow-mediated dilation)", query: all(GRAPE, any("endothelial function", "flow-mediated dilation", "vascular function", "arterial stiffness")), title: [GRAPE_T, w("endotheli", "vascular", "flow-mediated", "arter")], excludeTitle: NOT_THE_FRUIT, question: q(ADULTS, "Grapes, 100% grape juice or whole-grape powder", "Placebo or no grapes", "Flow-mediated dilation or artery stiffness") },
      { id: "cognition", label: "Memory and thinking", finding: "Memory and thinking", query: all(GRAPE, O.cognition.q), title: [GRAPE_T, O.cognition.t], excludeTitle: NOT_THE_FRUIT, question: q("Adults, often older", "Grapes, 100% grape juice or whole-grape powder", "Placebo or no grapes", "Memory, thinking or mood") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar: after meals, fasting and HbA1c", query: all(GRAPE, O.sugar.q), title: [GRAPE_T, O.sugar.t], excludeTitle: NOT_THE_FRUIT, question: q(ADULTS, "Grapes, raisins, 100% grape juice or whole-grape powder", "Other snacks, placebo or no grapes", "Blood sugar after meals, fasting glucose or HbA1c") },
    ],
  },
  {
    id: "wholefood-figs",
    kind: "wholefood",
    wholeFoodId: "figs",
    name: "figs",
    terms: [],
    outcomes: [
      { id: "constipation", label: "Constipation", finding: "Functional constipation", query: all(any("fig", "figs", "Ficus carica", "dried fruit", "dried fruits"), any("constipation", "bowel movements", "laxative", "stool")), title: [w("figs?\\b", "ficus", "dried fruit", "fruit"), w("constipat", "bowel", "laxat", "stool")], question: q("Adults or children with constipation", "Figs: fresh, dried or fig paste (fig leaf and other Ficus products count as partly)", "Placebo or no figs", "Bowel movements, stool consistency or constipation symptoms") },
      { id: "ibs", label: "IBS with constipation", finding: "Irritable bowel syndrome with constipation (IBS-C)", query: all(any("fig", "figs", "Ficus carica"), any("irritable bowel", "IBS")), title: [w("figs?\\b", "ficus", "fruit"), w("irritable bowel", "IBS")], question: q("Adults with irritable bowel syndrome with constipation", "Dried figs", "Usual diet or placebo", "Symptoms, pain or bowel habits") },
      { id: "lipids", label: "Blood fats", finding: "Blood fats (LDL cholesterol, triglycerides)", query: all(any("fig", "figs", "Ficus carica", "dried fruit", "dried fruits"), O.lipids.q), title: [w("figs?\\b", "ficus", "dried fruit"), O.lipids.t], question: q(ADULTS, "Dried figs or other dried fruit (reviews of mixed dried fruit count as partly)", "No figs or other snacks", "LDL cholesterol or triglycerides") },
      { id: "sugar", label: "Blood sugar", finding: "Blood sugar", query: all(any("fig", "figs", "Ficus carica", "dried fruit", "dried fruits"), O.sugar.q), title: [w("figs?\\b", "ficus", "dried fruit"), O.sugar.t], question: q(ADULTS, "Figs or dried figs (fig leaf or extract counts as partly)", "Other snacks or no figs", "Blood sugar, glycaemic response or HbA1c") },
      { id: "minerals", label: "Minerals in the blood", finding: "Minerals in the blood (calcium, potassium and others)", query: all(any("fig", "figs", "Ficus carica"), any("calcium", "potassium", "magnesium", "minerals", "iron")), title: [w("figs?\\b", "ficus"), w("calcium", "potassium", "magnesium", "mineral", "iron")], question: q("Adults", "Figs or dried figs", "No figs", "Calcium, potassium or other minerals in the blood") },
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
