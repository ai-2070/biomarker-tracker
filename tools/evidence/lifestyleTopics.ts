/**
 * Evidence maps for the lifestyle entries (knowledge/lifestyle): one map per entry, one outcome per
 * finding. Like the food maps: each finding has its own search (the habit's words AND the outcome's
 * words), reviews of any design count (most of what is known about habits comes from studies that follow
 * people over years), and the question asks about a habit or exposure.
 */
import type { Question } from "../../src/core/evidenceMap";
import type { TopicDef } from "./topics";

/** Any of these words or word starts in a title, any case. */
const w = (...x: string[]) => new RegExp(`\\b(${x.join("|")})`, "i");
/** Any of these in the title or abstract (Europe PMC syntax; phrases quoted). */
const any = (...x: string[]) => `(${x.map((p) => `TITLE_ABS:${/[\s-]/.test(p) ? `"${p}"` : p}`).join(" OR ")})`;
const all = (...groups: string[]) => groups.join(" AND ");
const q = (population: string, intervention: string, comparison: string, outcome: string): Question => ({ population, intervention, comparison, outcome });

const GENERAL = "Adults in general (not a group defined by one illness, such as people in hospital or with cancer)";
const DEATH = any("mortality", "death", "deaths");
const CVD = any("cardiovascular", "coronary", "heart disease", "stroke", "myocardial infarction");

// ---- Walking
const STEPS = any("daily steps", "step count", "step counts", "steps per day", "pedometer", "pedometers", "walking");
const STEPS_T = w("steps?\\b", "step count", "walk", "pedomet");
/** Walking tests, rehabilitation and walking aids answer other questions than everyday walking. */
const NOT_EVERYDAY_WALKING =
  /\b(walk(ing)? tests?|6-minute|six-minute|shuttle walk|rehabilitation|heart failure|claudication|peripheral arter\w*|stroke survivors|after stroke|post-?stroke|exoskeleton\w*|robot\w*|treadmill training|gait training|parkinson\w*|spinal cord|multiple sclerosis|cerebral palsy|amputat\w*|knee replacement|hip fracture)\b/i;

// ---- Sauna
const SAUNA = any("sauna", "saunas", "sauna bathing", "passive heat", "heat therapy", "thermal therapy", "hot water immersion", "waon");
const SAUNA_T = w("sauna", "heat therap", "passive heat", "thermal therap", "hot water", "waon", "bathing");

// ---- Sleep
const SLEEP_LENGTH = any("sleep duration", "short sleep", "long sleep", "hours of sleep", "sleep length", "short sleepers", "long sleepers");
const SLEEP_LOSS = any("sleep restriction", "sleep deprivation", "sleep loss", "short sleep", "sleep curtailment", "sleep fragmentation", "circadian misalignment", "sleep disruption");

// ---- Cold water
const COLD = any("cold water", "cold-water", "cold shower", "cold showers", "cold water immersion", "ice bath", "ice baths", "winter swimming", "cold exposure", "cold plunge", "cold acclimation", "cryotherapy");
const COLD_T = w("cold", "ice bath", "winter swim", "cryotherap", "cooling");

// ---- Red light (photobiomodulation)
const PBM = any("photobiomodulation", "low-level laser therapy", "low level laser therapy", "low-level light therapy", "low-level laser", "LLLT", "red light", "near-infrared light", "light-emitting diode", "LED therapy", "LED phototherapy");
const PBM_T = w("photobiomodulation", "low.level", "LLLT", "laser", "red light", "near.infrared", "light.emitting", "LED\\b", "light therap", "phototherap");
/** Other lasers and light treatments (they work by heat, burning or ultraviolet, not as photobiomodulation). */
const OTHER_LIGHT = /\b(ultraviolet|UVB|UVA|narrow-?band|blue light|intense pulsed|IPL|fractional|ablative|CO2|carbon dioxide|Nd:YAG|erbium|photodynamic|excimer|pulsed dye|hair removal|epilation|laser surgery)\b/i;

export const LIFESTYLE_TOPICS: TopicDef[] = [
  {
    id: "lifestyle-walking",
    kind: "lifestyle",
    lifestyleId: "walking",
    name: "walking",
    terms: [],
    outcomes: [
      { id: "mortality", label: "Death", finding: "Death from any cause", query: all(STEPS, DEATH), title: [STEPS_T, w("mortalit", "death", "survival")], excludeTitle: NOT_EVERYDAY_WALKING, question: q(GENERAL, "More daily steps or more walking", "Fewer steps or less walking", "Death from any cause") },
      { id: "cardiovascular", label: "Heart disease and stroke", finding: "Heart disease and stroke (cardiovascular disease)", query: all(STEPS, CVD), title: [STEPS_T, w("cardiovascular", "coronary", "heart", "stroke", "myocardial")], excludeTitle: NOT_EVERYDAY_WALKING, question: q(GENERAL, "More daily steps or more walking", "Fewer steps or less walking", "Heart disease or stroke (new cases or deaths)") },
      { id: "risk-factors", label: "Blood pressure and fitness", finding: "Blood pressure, fitness, weight and waist", query: all(any("walking", "walking group", "walking groups", "brisk walking", "walking program", "walking programme"), any("blood pressure", "cardiorespiratory fitness", "aerobic fitness", "VO2max", "body weight", "waist", "body mass index", "cardiovascular risk factors")), title: [w("walk"), w("blood pressure", "hypertens", "fitness", "VO2", "weight", "waist", "body mass", "adipos", "body composition", "risk factor", "cardiometabolic")], excludeTitle: NOT_EVERYDAY_WALKING, question: q("Adults, mostly inactive at the start (reviews of one illness count as partly)", "A walking programme or walking group", "No exercise or usual activity", "Blood pressure, fitness (VO2max), body weight or waist size") },
      { id: "diabetes", label: "Type 2 diabetes", finding: "Type 2 diabetes: new cases, and blood sugar in people who have it", query: all(STEPS, any("diabetes", "HbA1c", "glycemic", "glycaemic", "blood glucose")), title: [STEPS_T, w("diabet", "HbA1c", "glyc", "glucose", "insulin")], excludeTitle: NOT_EVERYDAY_WALKING, question: q("Adults without diabetes (new cases), or adults with type 2 diabetes (blood sugar)", "More daily steps or a walking programme", "Fewer steps, or no walking programme", "New type 2 diabetes, or HbA1c and blood sugar") },
      { id: "depression", label: "Depression", finding: "Depression and depressive symptoms", query: all(STEPS, any("depression", "depressive", "depressed")), title: [STEPS_T, w("depress")], excludeTitle: NOT_EVERYDAY_WALKING, question: q("Adults, with or without depression", "Walking or more daily steps", "Less walking, usual care or no exercise", "Depression or depressive symptoms") },
      { id: "pace", label: "Walking pace", finding: "Walking pace", query: all(any("walking speed", "walking pace", "gait speed", "stepping rate", "step cadence", "brisk walking"), any("mortality", "death", "diabetes", "cardiovascular", "coronary", "stroke")), title: [w("walking speed", "walking pace", "gait speed", "cadence", "brisk", "pace")], excludeTitle: NOT_EVERYDAY_WALKING, question: q(GENERAL, "A faster usual walking pace or stepping rate", "A slower pace", "Death, heart disease, stroke or type 2 diabetes") },
    ],
  },
  {
    id: "lifestyle-sauna",
    kind: "lifestyle",
    lifestyleId: "sauna",
    name: "sauna",
    terms: [],
    outcomes: [
      { id: "mortality", label: "Heart deaths and death", finding: "Sudden cardiac death, death from heart and blood vessel disease, and death from any cause", query: all(SAUNA, any("mortality", "death", "sudden cardiac", "cardiovascular")), title: [SAUNA_T, w("mortalit", "death", "cardiovascular", "cardiac", "health")], question: q(GENERAL, "Sauna bathing, or other passive heat (hot baths, heat therapy)", "Less or no sauna use", "Sudden cardiac death, deaths from heart disease, or death from any cause") },
      { id: "stroke", label: "Stroke", finding: "Stroke", query: all(SAUNA, any("stroke", "cerebrovascular")), title: [SAUNA_T, w("stroke", "cerebrovascular", "cardiovascular", "health")], question: q(GENERAL, "Sauna bathing, or other passive heat", "Less or no sauna use", "Stroke") },
      { id: "dementia", label: "Dementia", finding: "Dementia and Alzheimer's disease", query: all(SAUNA, any("dementia", "alzheimer", "alzheimer's", "cognitive", "cognition")), title: [SAUNA_T, w("dementia", "alzheimer", "cognit", "brain", "health")], question: q(GENERAL, "Sauna bathing, or other passive heat", "Less or no sauna use", "Dementia or Alzheimer's disease") },
      { id: "blood-pressure", label: "Blood pressure", finding: "Blood pressure", query: all(SAUNA, any("blood pressure", "hypertension", "hypertensive")), title: [SAUNA_T, w("blood pressure", "hypertens", "vascular", "cardiovascular")], question: q("Adults, healthy or with heart risk factors", "Sauna bathing, or other passive heat (single sessions or weeks of it)", "No sauna or heat", "Blood pressure, or new high blood pressure") },
      { id: "inflammation", label: "Inflammation (CRP)", finding: "Inflammation (C-reactive protein, CRP)", query: all(SAUNA, any("C-reactive protein", "CRP", "inflammation", "inflammatory")), title: [SAUNA_T, w("C-reactive", "CRP", "inflamm", "cytokin", "immun")], question: q("Adults", "Sauna bathing, or other passive heat", "Less or no sauna or heat", "C-reactive protein (CRP) or other markers of inflammation") },
      { id: "heart-failure", label: "Heart failure (Waon)", finding: "Heart failure symptoms and heart function (Waon therapy, in hospital)", query: all(any("waon", "sauna", "thermal therapy", "far-infrared", "far infrared", "heat therapy"), any("heart failure")), title: [w("waon", "sauna", "thermal", "infrared", "heat"), w("heart failure", "cardiac")], question: q("People with chronic heart failure", "Waon therapy (a mild far-infrared sauna) or other repeated heat therapy", "Usual heart failure care without it", "Symptoms, exercise capacity or heart function") },
    ],
  },
  {
    id: "lifestyle-sleep",
    kind: "lifestyle",
    lifestyleId: "sleep",
    name: "sleep",
    terms: [],
    outcomes: [
      { id: "mortality", label: "Sleep length and death", finding: "Short or long sleep and death from any cause", query: all(SLEEP_LENGTH, DEATH), title: [w("sleep"), w("mortalit", "death", "survival")], question: q(GENERAL, "Short or long usual sleep", "About 7 hours a night (or another middle amount)", "Death from any cause") },
      { id: "cardiovascular", label: "Heart disease and stroke", finding: "Short or long sleep and heart disease or stroke", query: all(SLEEP_LENGTH, CVD), title: [w("sleep"), w("cardiovascular", "coronary", "heart", "stroke", "myocardial")], question: q(GENERAL, "Short or long usual sleep", "About 7 hours a night (or another middle amount)", "Heart disease or stroke (new cases or deaths)") },
      { id: "insulin", label: "Insulin sensitivity", finding: "Insulin sensitivity after shortened or disturbed sleep", query: all(SLEEP_LOSS, any("insulin sensitivity", "insulin resistance", "glucose metabolism", "glucose tolerance", "glycemic", "glycaemic")), title: [w("sleep", "circadian"), w("insulin", "glucose", "glyc", "metabol")], question: q("Adults, mostly healthy", "Shortened, broken-up or mistimed sleep (in trials), or short sleep", "Normal sleep", "Insulin sensitivity or glucose tolerance") },
      { id: "intake-weight", label: "Eating and weight", finding: "How much people eat, and body weight, after shortened sleep", query: all(SLEEP_LOSS, any("energy intake", "food intake", "appetite", "body weight", "weight gain", "adiposity", "obesity", "energy balance")), title: [w("sleep"), w("energy", "intake", "appetite", "weight", "adipos", "obes", "food", "eating")], question: q("Adults", "Shortened sleep (in trials), or short usual sleep", "Normal sleep", "How much people eat (energy intake), appetite or body weight") },
      { id: "cbt-i", label: "Insomnia therapy (CBT-I)", finding: "Insomnia: falling asleep, waking in the night, and insomnia severity, with CBT-I", query: all(any("cognitive behavioral therapy for insomnia", "cognitive behavioural therapy for insomnia", "CBT-I", "CBTI", "digital cognitive behavioral therapy", "digital cognitive behavioural therapy"), any("insomnia")), title: [w("insomnia", "CBT-?I")], question: q("Adults with chronic insomnia (reviews limited to one other illness, such as cancer, count as partly)", "Cognitive behavioural therapy for insomnia (CBT-I), face to face or digital", "Waiting list, sleep advice, sham treatment or usual care", "Time to fall asleep, time awake in the night, sleep efficiency or insomnia severity") },
      { id: "regularity", label: "Sleep regularity", finding: "Sleep regularity (going to sleep and waking at similar times) and death from any cause", query: all(any("sleep regularity", "irregular sleep", "sleep variability", "sleep irregularity", "social jetlag", "sleep timing", "sleep schedule"), any("mortality", "death", "cardiovascular", "health outcomes", "cardiometabolic")), title: [w("sleep", "jetlag", "circadian"), w("regular", "variab", "irregular", "timing", "jetlag", "schedule")], question: q(GENERAL, "Regular sleep (going to sleep and waking at similar times)", "Irregular sleep", "Death, heart disease or cardiometabolic health") },
    ],
  },
  {
    id: "lifestyle-cold_water",
    kind: "lifestyle",
    lifestyleId: "cold_water",
    name: "cold water",
    terms: [],
    outcomes: [
      { id: "sickness", label: "Sick days", finding: "Sickness absence from work and days of illness", query: all(COLD, any("sickness absence", "sick leave", "infection", "infections", "immune", "immunity", "illness")), title: [COLD_T, w("sick", "absence", "infect", "immun", "illness", "health")], question: q("Healthy adults", "Cold showers, cold-water immersion or winter swimming", "Warm showers or no cold exposure", "Sickness absence, days of illness or infections") },
      { id: "mood", label: "Mood and stress", finding: "Mood, stress, wellbeing and sleep", query: all(COLD, any("mood", "stress", "well-being", "wellbeing", "depression", "depressive", "anxiety", "sleep", "mental health", "psychological")), title: [COLD_T, w("mood", "stress", "well", "depress", "anxi", "sleep", "mental", "psycholog")], question: q("Adults, healthy or with low mood", "Cold showers, cold-water immersion or winter swimming", "No cold exposure, or warm water", "Mood, stress, wellbeing, depression, anxiety or sleep") },
      { id: "soreness", label: "Muscle soreness", finding: "Muscle soreness after exercise", query: all(COLD, any("muscle soreness", "delayed onset muscle soreness", "DOMS", "recovery", "muscle damage")), title: [w("cold", "ice", "cryotherap", "immersion", "cooling"), w("soreness", "DOMS", "recover", "muscle damage")], question: q("Adults after hard or unaccustomed exercise, mostly young and active", "Cold-water immersion (or other cooling) after exercise", "Rest or no cooling", "Muscle soreness, or recovery of strength and performance") },
      { id: "training", label: "Muscle growth with training", finding: "Muscle growth and strength gains with regular cold water after strength training", query: all(COLD, any("hypertrophy", "muscle growth", "strength training", "resistance training", "muscle strength", "training adaptation", "training adaptations")), title: [w("cold", "cryotherap", "ice", "cooling", "immersion"), w("hypertroph", "strength", "resistance training", "muscle", "adaptation")], question: q("Adults doing strength (resistance) training", "Regular cold-water immersion after training sessions", "The same training without cold water", "Gains in muscle size or strength") },
      { id: "metabolism", label: "Brown fat and metabolism", finding: "Brown fat, metabolism and insulin sensitivity", query: all(any("cold exposure", "cold acclimation", "cold-induced thermogenesis", "cold water", "winter swimming", "cold stimulation"), any("brown adipose", "brown fat", "thermogenesis", "insulin sensitivity", "energy expenditure", "metabolism")), title: [w("cold", "brown adipose", "brown fat", "thermogen"), w("brown", "thermogen", "insulin", "metabol", "energy expenditure", "glucose")], question: q("Adults", "Repeated cold exposure (cold air, cold water or winter swimming)", "No cold exposure", "Brown fat activity, energy expenditure, insulin sensitivity or blood sugar") },
      { id: "cold-shock", label: "Cold shock and the heart", finding: "Heart rate, blood pressure and heart rhythm in the first moments in cold water", query: all(COLD, any("cold shock", "arrhythmia", "arrhythmias", "heart rate", "blood pressure", "drowning", "habituation", "autonomic")), title: [w("cold", "immersion", "winter swim"), w("shock", "arrhythm", "heart", "blood pressure", "cardiovascular", "drown", "habituat", "autonomic")], question: q("Adults suddenly immersed in cold water, healthy or winter swimmers", "Cold-water immersion", "Before immersion, or warm water", "Heart rate, blood pressure, heart rhythm, breathing, or how these change with repeated immersion") },
    ],
  },
  {
    id: "lifestyle-red_light",
    kind: "lifestyle",
    lifestyleId: "red_light",
    name: "red light therapy",
    terms: [],
    outcomes: [
      { id: "skin", label: "Skin ageing", finding: "Wrinkles, skin roughness and collagen (skin ageing)", query: all(PBM, any("wrinkle", "wrinkles", "skin aging", "skin ageing", "photoaging", "photoageing", "skin rejuvenation", "collagen")), title: [PBM_T, w("wrinkl", "skin", "photoag", "rejuven", "collagen", "aging", "ageing")], excludeTitle: OTHER_LIGHT, question: q("Adults with wrinkles or ageing skin", "Red or near-infrared light (photobiomodulation, LED or low-level laser)", "A sham device or no treatment", "Wrinkles, skin roughness, collagen or skin appearance") },
      { id: "hair", label: "Hair loss", finding: "Hair density in pattern hair loss (androgenetic alopecia)", query: all(PBM, any("hair loss", "alopecia", "hair growth", "androgenetic")), title: [PBM_T, w("hair", "alopecia")], excludeTitle: OTHER_LIGHT, question: q("Men and women with pattern hair loss (androgenetic alopecia)", "Red or near-infrared light (low-level laser or LED: combs, caps, helmets)", "A sham device or no treatment", "Hair density or hair count") },
      { id: "mucositis", label: "Mouth sores in cancer care", finding: "Preventing painful mouth sores (oral mucositis) during cancer treatment", query: all(PBM, any("oral mucositis", "mucositis")), title: [PBM_T, w("mucositis")], excludeTitle: OTHER_LIGHT, question: q("People having cancer treatment (chemotherapy, radiotherapy or a stem cell transplant)", "Red or near-infrared light to the mouth (photobiomodulation, low-level laser)", "Sham light or no treatment", "Oral mucositis: how often, how severe, or pain") },
      { id: "knee", label: "Knee osteoarthritis", finding: "Knee osteoarthritis pain and disability", query: all(PBM, any("knee osteoarthritis", "osteoarthritis")), title: [PBM_T, w("osteoarthrit", "knee")], excludeTitle: OTHER_LIGHT, question: q("Adults with knee osteoarthritis", "Low-level laser or other photobiomodulation, alone or with exercise", "Sham (placebo) laser, or exercise alone", "Pain or disability") },
      { id: "exercise", label: "Exercise and recovery", finding: "Exercise performance and muscle recovery", query: all(PBM, any("exercise performance", "muscle performance", "muscle fatigue", "muscle recovery", "muscle damage", "athletes", "athletic performance", "exercise")), title: [PBM_T, w("exercise", "muscle", "athlet", "performance", "fatigue", "recover", "sport")], excludeTitle: OTHER_LIGHT, question: q("Healthy adults, from inactive people to athletes", "Red or near-infrared light on the muscles before or after exercise", "Placebo (sham) light", "Exercise performance, muscle fatigue or recovery") },
      { id: "foot-ulcers", label: "Diabetic foot ulcers", finding: "Healing of diabetic foot ulcers", query: all(PBM, any("diabetic foot", "foot ulcer", "foot ulcers", "diabetic ulcer", "diabetic ulcers", "wound healing")), title: [PBM_T, w("diabet", "foot", "ulcer", "wound")], excludeTitle: OTHER_LIGHT, question: q("People with diabetic foot ulcers", "Low-level laser or other photobiomodulation added to usual wound care", "Usual wound care, or sham light", "Ulcer healing (healed or smaller)") },
    ],
  },
];
