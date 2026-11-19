/**
 * The written-down searches behind each evidence map: the terms a paper's title or abstract must
 * contain, and the outcomes the map follows (each tied to a finding on the nutrient's page, or to a claim
 * in the food comparison). Changing a search means changing it here, in review, so every map can be
 * re-run and compared.
 */
import type { MapKind, Question } from "@bt/shared/core/evidenceMap";
import { FOOD_TOPICS } from "./foodTopics";
import { LIFESTYLE_TOPICS } from "./lifestyleTopics";
import { WHOLE_FOOD_TOPICS } from "./wholeFoodTopics";

export interface OutcomeDef {
  id: string;
  label: string;
  /** What this outcome checks: a finding on the nutrient page (its `outcome` text), or a food comparison claim's id. */
  finding?: string;
  /** Words that put a paper on this outcome when they appear in its title (every pattern must match). */
  title?: RegExp | RegExp[];
  /** Food maps: this outcome's own Europe PMC search (query syntax, without SRC:MED). */
  query?: string;
  /** Reviews with these words in the title are about another group of people or another question. */
  excludeTitle?: RegExp;
  /** The finding's question, for screening each eligible review's abstract (tools/evidence/screen.ts). */
  question: Question;
  /**
   * Reviews of any study design count for this outcome (supplement maps otherwise need reviews of
   * trials): for evidence that comes from lab or observational studies, like biotin and lab tests.
   */
  anyDesign?: boolean;
}

export interface TopicDef {
  id: string;
  /** "supplement" (default): one search for the nutrient, reviews of trials. "food" and "lifestyle": a search per claim or finding, reviews of any design. */
  kind?: MapKind;
  /** The nutrient page (supplement maps) or the food comparison topic (food maps) the map belongs to. */
  nutrientId?: string;
  comparisonId?: string;
  /** Lifestyle maps: the entry in knowledge/lifestyle. */
  lifestyleId?: string;
  /** Whole-food maps: the entry in knowledge/wholefoods. */
  wholeFoodId?: string;
  /** In sentences: "records mention calcium". */
  name: string;
  /** Searched in titles and abstracts (any of them). */
  terms: string[];
  /** Narrows the search when the name is common in unrelated research (Europe PMC query syntax, ANDed). */
  context?: string;
  /** What the narrowing means, in plain words, for the page: "in papers about supplements, intake or diet". */
  scope?: string;
  /** What a review's title must contain to count as about this nutrient; by default one of the terms. */
  titleTerms?: RegExp;
  /**
   * Kept only when the title or abstract matches this, after downloading. For searches Europe PMC can't do
   * exactly: it drops "A" as a stop word, so "vitamin A" matches every vitamin. The total count of records
   * is then unknown and not shown.
   */
  localFilter?: RegExp;
  outcomes: OutcomeDef[];
}

// ---- Shared pieces for the definitions below -------------------------------------------------------

/** Settings that make a review about another group of people for almost any of these questions. */
const SETTINGS = [
  "sepsis",
  "septic",
  "critically ill",
  "intensive care",
  "ICU",
  "COVID",
  "SARS-CoV-2",
  "surg\\w*",
  "operat\\w*",
  "transplant\\w*",
  "HIV",
  "tuberculosis",
  "ventilat\\w*",
];
/** Any of these words or patterns, as whole words, any case. */
const words = (...w: string[]) => new RegExp(`\\b(${w.join("|")})\\b`, "i");
/** Leave out reviews of other settings, and of these groups. */
const not = (...extra: string[]) => words(...SETTINGS, ...extra);
const q = (population: string, intervention: string, outcome: string, comparison = "Placebo or no treatment"): Question => ({
  population,
  intervention,
  comparison,
  outcome,
});

/** For nutrients whose name is everywhere in unrelated research (calcium channels, zinc fingers, potassium channels). */
const SUPPLEMENT_CONTEXT = "TITLE_ABS:supplement* OR TITLE_ABS:fortif* OR TITLE_ABS:intake OR TITLE_ABS:diet*";
const SUPPLEMENT_SCOPE = "in papers about supplements, fortified food, intake or diet";

const GENERAL = "Adults in general or older adults (not a group defined by one illness, such as people in intensive care, on dialysis or with cancer)";
const CANCER = "cancer\\w*|neoplas\\w*|tumou?r\\w*|carcinoma\\w*";
const CVD = "cardiovascular|myocardial infarction|heart|coronary|stroke";
const DEATH = "mortality|death|survival";
const COLD = "common cold|colds?|respiratory (tract )?infection\\w*";
const COGNITION = "cognit\\w*|memory|dementia|alzheimer\\w*";
const GLUCOSE = "glucose|glyc\\w*|insulin|diabet\\w*|HbA1c";
const BP = "blood pressure|hypertensi\\w*";
const STONES = "kidney stones?|renal stones?|nephrolith\\w*|urolith\\w*|calculi|lithiasis";
const AMD = "macular|AMD|age-related eye";
const BMD = "bone (mineral )?density|BMD|bone loss|bone mass|bone health";
const PREG = "pregnan\\w*|antenatal|prenatal|gestation\\w*|maternal";
/** Homocysteine-lowering reviews often name "B vitamins" rather than each vitamin. */
const B_VITAMINS = "B vitamins?|B-vitamins?|homocysteine-lowering|homocysteine lowering";
/** Medicines named after a mineral (calcium channel blockers, calcium antagonists), not the mineral given as a supplement. */
const CHANNELS = ["channel\\w*", "blockers?", "antagonists?"];

export const TOPICS: TopicDef[] = [
  {
    id: "vitamin_d",
    nutrientId: "vitamin_d",
    name: "vitamin D",
    terms: ["vitamin D", "cholecalciferol", "ergocalciferol", "calcifediol", "25-hydroxyvitamin D", "vitamin D3", "vitamin D2"],
    outcomes: [
      {
        id: "fractures-falls",
        label: "Fractures and falls",
        question: {
          population: "Adults living at home or in care homes, mostly older adults (not a group defined by one illness)",
          intervention: "Vitamin D (D3, D2 or calcifediol) on its own; a review that also analyses vitamin D without calcium separately counts",
          comparison: "Placebo or no treatment",
          outcome: "Fractures or falls",
        },
        title: /\b(fractur\w*|falls?|falling)\b/i,
        excludeTitle:
          /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i,
      },
      {
        id: "mortality",
        label: "Death from any cause",
        question: {
          population: "Adults in general or older adults (not a group defined by one illness, such as people in intensive care, on dialysis or with cancer)",
          intervention: "Vitamin D (D3, D2 or calcifediol)",
          comparison: "Placebo or no treatment",
          outcome: "Death from any cause",
        },
        title: /\b(mortality|death|survival)\b/i,
        excludeTitle:
          /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i,
      },
      {
        id: "cancer",
        label: "Cancer",
        question: {
          population: "Adults in general or older adults (not a group defined by one illness, such as people in intensive care, on dialysis or with cancer)",
          intervention: "Vitamin D (D3, D2 or calcifediol)",
          comparison: "Placebo or no treatment",
          outcome: "New cancers or deaths from cancer",
        },
        title: /\b(cancer\w*|neoplas\w*|tumou?r\w*|carcinoma\w*)\b/i,
        excludeTitle:
          /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i,
      },
      {
        id: "cardiovascular",
        label: "Heart and blood vessel disease",
        question: {
          population: "Adults in general or older adults (not a group defined by one illness, such as people in intensive care, on dialysis or with cancer)",
          intervention: "Vitamin D (D3, D2 or calcifediol)",
          comparison: "Placebo or no treatment",
          outcome: "Heart attacks, strokes, other cardiovascular events or cardiovascular death",
        },
        title: /\b(cardiovascular|myocardial infarction|heart|stroke|coronary)\b/i,
        excludeTitle:
          /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i,
      },
      {
        id: "respiratory",
        label: "Respiratory infections",
        question: {
          population: "Children or adults (any age; not people already ill with COVID-19 or in hospital)",
          intervention: "Vitamin D (D3, D2 or calcifediol) to prevent infection",
          comparison: "Placebo or no treatment",
          outcome: "Acute respiratory infections (colds, flu, chest infections, pneumonia)",
        },
        title: /\b(respiratory (tract )?infection\w*|influenza|common cold|pneumonia|acute respiratory|COVID|SARS-CoV-2)\b/i,
        excludeTitle:
          /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|athletes?|multiple sclerosis|cystic fibrosis|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i,
      },
      {
        id: "large-doses",
        label: "Very large doses",
        title: /\b(fractur\w*|falls?|falling|bolus|high-dose|large dose\w*|megadose\w*|intermittent|annual|yearly)\b/i,
        excludeTitle:
          /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|dialysis|chronic kidney|transplant\w*|HIV|tuberculosis|pregnan\w*|preterm|neonat\w*|infants?|children|cystic fibrosis|cancer patients)\b/i,
        question: {
          population: "Older adults (not a group defined by one illness)",
          intervention: "Very large doses of vitamin D given at long intervals (a bolus, such as once a year or every few months)",
          comparison: "Placebo, or smaller daily doses",
          outcome: "Falls or fractures",
        },
      },
      {
        id: "diabetes",
        label: "Type 2 diabetes",
        question: {
          population: "Adults without diabetes at the start, with prediabetes or at risk of type 2 diabetes",
          intervention: "Vitamin D (D3, D2 or calcifediol)",
          comparison: "Placebo or no treatment",
          outcome: "New type 2 diabetes",
        },
        title: /\b(type 2 diabetes|diabetes|prediabet\w*|insulin resistance)\b/i,
        excludeTitle:
          /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease|children|adolescents?)\b/i,
      },
    ],
  },
  {
    id: "calcium",
    nutrientId: "calcium",
    name: "calcium",
    terms: ["calcium"],
    context: SUPPLEMENT_CONTEXT,
    scope: SUPPLEMENT_SCOPE,
    titleTerms: words("calcium"),
    outcomes: [
      {
        id: "fractures",
        label: "Fractures",
        title: words("fractur\\w*"),
        excludeTitle: not(...CHANNELS, "dialysis", "chronic kidney", "cancer patients"),
        question: q(
          "Adults over 50, mostly women after menopause (not a group defined by one illness)",
          "Calcium supplements, alone or with vitamin D",
          "Fractures",
        ),
      },
      {
        id: "bone-density",
        label: "Bone density",
        title: words(BMD),
        excludeTitle: not(...CHANNELS, "dialysis", "chronic kidney"),
        question: q("Adults over 50 (not a group defined by one illness)", "Calcium supplements or more calcium in the diet", "Bone mineral density"),
      },
      {
        id: "cardiovascular",
        label: "Heart attacks and strokes",
        title: words(CVD),
        excludeTitle: not(...CHANNELS, "scores?", "calcification", "dialysis", "chronic kidney", "heart failure"),
        question: q(GENERAL, "Calcium supplements, alone or with vitamin D", "Heart attacks, strokes or other cardiovascular events"),
      },
      {
        id: "kidney-stones",
        label: "Kidney stones",
        title: words(STONES),
        excludeTitle: not(...CHANNELS),
        question: q("Adults", "Calcium supplements, alone or with vitamin D", "Kidney stones"),
      },
      {
        id: "pre-eclampsia",
        label: "Pre-eclampsia",
        title: words("pre-?eclampsia", "hypertensi\\w*", "blood pressure"),
        excludeTitle: not(...CHANNELS),
        question: q("Pregnant women", "Calcium supplements during pregnancy", "Pre-eclampsia or high blood pressure in pregnancy"),
      },
      {
        id: "adenomas",
        label: "Bowel polyps",
        title: words("adenoma\\w*", "polyps?", "colorectal"),
        excludeTitle: not(...CHANNELS),
        question: q(
          "Adults who had bowel polyps (colorectal adenomas) removed, or adults in general",
          "Calcium supplements",
          "Colorectal adenomas (bowel polyps), new or coming back",
        ),
      },
    ],
  },
  {
    id: "folate",
    nutrientId: "folate",
    name: "folic acid",
    terms: ["folic acid", "folate", "methylfolate", "5-methyltetrahydrofolate"],
    titleTerms: words("folic acid", "folates?", "methylfolate", "5-?methyltetrahydrofolate", "5-MTHF", B_VITAMINS),
    outcomes: [
      {
        id: "neural-tube",
        label: "Neural tube defects",
        title: words("neural tube", "spina bifida", "anencephal\\w*", "birth defects?", "congenital"),
        excludeTitle: not("antiepilep\\w*", "methotrexate"),
        question: q(
          "Women before conception and in early pregnancy",
          "Folic acid supplements (alone or with other vitamins)",
          "Neural tube defects in the baby",
          "Placebo, no supplement, or other vitamins without folic acid",
        ),
      },
      {
        id: "cardiovascular",
        label: "Heart attacks and death",
        title: words(CVD, DEATH),
        excludeTitle: not("dialysis", "chronic kidney", "kidney disease", "methotrexate", "chemotherapy", "cancer patients"),
        question: q(
          "Adults with or without heart and blood vessel disease (not a group defined by another illness)",
          "Folic acid, alone or with vitamin B12 and B6, to lower homocysteine",
          "Heart attacks, other cardiovascular events, or death",
        ),
      },
      {
        id: "stroke",
        label: "Stroke",
        title: words("stroke", "cerebrovascular"),
        excludeTitle: not("dialysis", "chronic kidney", "kidney disease"),
        question: q("Adults (with or without high blood pressure or heart disease)", "Folic acid, alone or with vitamin B12 and B6", "Stroke"),
      },
      {
        id: "cognition",
        label: "Memory and dementia",
        title: words(COGNITION),
        excludeTitle: not("schizophreni\\w*", "depress\\w*", "autism", "children", "infants?"),
        question: q("Older adults, with or without mild memory problems", "Folic acid, alone or with vitamin B12 and B6", "Memory, thinking or dementia"),
      },
      {
        id: "cancer",
        label: "Cancer",
        title: words(CANCER),
        excludeTitle: not("methotrexate", "chemotherapy", "FOLFOX", "FOLFIRI", "leucovorin", "pemetrexed", "antifolates?", "cancer patients"),
        question: q(GENERAL, "Folic acid supplements, alone or with other B vitamins", "New cancers"),
      },
      {
        id: "methotrexate",
        label: "Methotrexate side effects",
        title: words("methotrexate"),
        excludeTitle: not("cancer\\w*", "leuka?emi\\w*", "ectopic"),
        question: q(
          "Adults with rheumatoid arthritis (or similar conditions) taking low-dose methotrexate",
          "Folic acid or folinic acid",
          "Side effects (liver, stomach and gut, mouth sores) and stopping methotrexate",
          "Placebo or no folate",
        ),
      },
      {
        id: "diabetic-kidney",
        label: "Diabetic kidney disease",
        title: words("diabet\\w*", "nephropath\\w*", "kidney", "renal"),
        excludeTitle: not("gestational", "pregnan\\w*"),
        question: q("People with diabetes and kidney disease", "Folic acid with vitamin B12 and B6 (B vitamins)", "Kidney function, heart events or death"),
      },
    ],
  },
  {
    id: "iodine",
    nutrientId: "iodine",
    name: "iodine",
    terms: ["iodine", "iodide", "iodised salt", "iodized salt", "iodate"],
    context: `${SUPPLEMENT_CONTEXT} OR TITLE_ABS:iodised OR TITLE_ABS:iodized OR TITLE_ABS:deficien*`,
    scope: "in papers about supplements, iodised salt, intake, diet or deficiency",
    titleTerms: words("iodine", "iodide", "iodi[sz]ed", "iodate", "iodization", "iodisation"),
    outcomes: [
      {
        id: "child-development-pregnancy",
        label: "Child development (pregnancy)",
        title: words("develop\\w*", "cognit\\w*", "neuro\\w*", "IQ", "intelligence", "offspring", "child\\w*", PREG),
        excludeTitle: not("radioactive", "radioiodine", "contrast", "povidone", "antisep\\w*", "thyroid cancer"),
        question: q(
          "Pregnant women with mild to moderate iodine deficiency",
          "Iodine supplements during pregnancy",
          "The child's development (thinking, language, motor skills, IQ)",
        ),
      },
      {
        id: "maternal-thyroid",
        label: "Mother's thyroid",
        title: words("thyroid\\w*", "TSH", "thyroglobulin", PREG),
        excludeTitle: not("radioactive", "radioiodine", "contrast", "povidone", "antisep\\w*", "thyroid cancer"),
        question: q(
          "Pregnant women in areas with mild to moderate iodine deficiency",
          "Iodine supplements during pregnancy",
          "The mother's thyroid function (TSH, thyroid hormones, thyroglobulin, goitre)",
        ),
      },
      {
        id: "schoolchildren",
        label: "Schoolchildren's thinking",
        title: words("cognit\\w*", "IQ", "intelligence", "mental", "school\\w*", "children"),
        excludeTitle: not("radioactive", "radioiodine", "contrast", "povidone", "antisep\\w*", "thyroid cancer", "pregnan\\w*"),
        question: q("Schoolchildren with mild to moderate iodine deficiency", "Iodine supplements", "Thinking skills (cognition, IQ)"),
      },
      {
        id: "young-children",
        label: "Young children's development",
        title: words("develop\\w*", "cognit\\w*", "mental", "IQ", "intelligence", "infants?", "children"),
        excludeTitle: not("radioactive", "radioiodine", "contrast", "povidone", "antisep\\w*", "thyroid cancer"),
        question: q(
          "Children aged 5 and under in iodine-deficient areas (through their mothers in pregnancy, or as infants)",
          "Iodine supplements, iodised salt or iodised oil",
          "Mental development",
          "No iodine, or less iodine",
        ),
      },
    ],
  },
  {
    id: "iron",
    nutrientId: "iron",
    name: "iron",
    terms: ["iron", "ferrous sulfate", "ferrous sulphate", "ferrous fumarate", "ferrous gluconate", "ferrous bisglycinate", "ferric"],
    context: `${SUPPLEMENT_CONTEXT} OR TITLE_ABS:oral`,
    scope: "in papers about supplements, oral iron, fortified food, intake or diet",
    titleTerms: words("iron", "ferrous", "ferric", "bisglycinate"),
    outcomes: [
      {
        id: "anaemia-women",
        label: "Anaemia in women",
        title: words("an(a)?emi\\w*", "ha?emoglobin", "ferritin", "iron (deficiency|status|stores)"),
        excludeTitle: not(
          "pregnan\\w*",
          "antenatal",
          "prenatal",
          "postpartum",
          "infants?",
          "preschool",
          "toddlers?",
          "chronic kidney",
          "CKD",
          "dialysis",
          "ha?emodialysis",
          "heart failure",
          "cancer",
          "chemotherapy",
          "inflammatory bowel",
          "Crohn\\w*",
          "colitis",
          "thalass\\w*",
          "chelat\\w*",
          "overload",
          "sickle",
        ),
        question: q(
          "Women with periods (teenagers and adults, not pregnant)",
          "Iron supplements (daily or a few times a week)",
          "Anaemia, haemoglobin or iron stores (ferritin)",
        ),
      },
      {
        id: "pregnancy",
        label: "Pregnancy",
        title: words(PREG, "birth", "neonatal"),
        excludeTitle: not("chronic kidney", "dialysis", "heart failure", "thalass\\w*", "chelat\\w*", "overload", "postpartum"),
        question: q(
          "Pregnant women",
          "Oral iron supplements (alone or with folic acid)",
          "Anaemia or iron deficiency in the mother, and birth weight or preterm birth",
          "Placebo, no iron, or folic acid without iron",
        ),
      },
      {
        id: "fatigue",
        label: "Tiredness",
        title: words("fatigue", "tired\\w*", "energy", "exercise", "performance", "quality of life"),
        excludeTitle: not("cancer", "chemotherapy", "heart failure", "chronic kidney", "dialysis", "inflammatory bowel", "pregnan\\w*", "postpartum"),
        question: q("Adults with low iron stores (low ferritin) but no anaemia", "Iron (by mouth or by drip)", "Tiredness (fatigue)"),
      },
      {
        id: "side-effects",
        label: "Stomach and gut side effects",
        title: words("gastrointestinal", "side effects?", "adverse (events|effects)", "tolerab\\w*", "constipation", "safety"),
        excludeTitle: not("chelat\\w*", "overload", "thalass\\w*", "dialysis", "chronic kidney"),
        question: q(
          "Adults taking iron",
          "Oral iron (ferrous sulfate)",
          "Stomach and gut side effects (nausea, constipation, pain)",
          "Placebo, or iron by drip",
        ),
      },
      {
        id: "every-other-day",
        label: "Every other day vs daily",
        title: words("alternate", "every other day", "intermittent", "weekly", "daily", "frequency", "dosing", "schedules?"),
        excludeTitle: not("chelat\\w*", "overload", "thalass\\w*", "dialysis", "chronic kidney", "heart failure"),
        question: q(
          "Adults or teenagers with low iron or iron-deficiency anaemia",
          "Oral iron every other day (or a few times a week)",
          "Haemoglobin, iron stores (ferritin), iron absorption or side effects",
          "Oral iron every day",
        ),
      },
      {
        id: "bisglycinate",
        label: "Ferrous bisglycinate",
        title: words("bisglycinate", "glycinate", "chelates?", "amino acid chelate", "formulations?", "preparations?"),
        excludeTitle: not("chelat(ion|ing|or)\\w*", "overload", "thalass\\w*", "dialysis"),
        question: q(
          "Anyone taking iron (pregnant women, children, adults)",
          "Ferrous bisglycinate",
          "Haemoglobin, iron stores (ferritin) or side effects",
          "Other oral iron forms (such as ferrous sulfate)",
        ),
      },
    ],
  },
  {
    id: "magnesium",
    nutrientId: "magnesium",
    name: "magnesium",
    terms: ["magnesium"],
    context: SUPPLEMENT_CONTEXT,
    scope: SUPPLEMENT_SCOPE,
    titleTerms: words("magnesium"),
    outcomes: [
      {
        id: "blood-pressure",
        label: "Blood pressure",
        title: words(BP),
        excludeTitle: not(
          "sulfate",
          "sulphate",
          "intravenous",
          "infusion",
          "an(a)?esthe\\w*",
          "postoperative",
          "pre-?eclampsia",
          "eclampsia",
          "pregnan\\w*",
          "dialysis",
        ),
        question: q("Adults with or without high blood pressure", "Oral magnesium supplements", "Blood pressure"),
      },
      {
        id: "cramps",
        label: "Night-time leg cramps",
        title: words("cramps?"),
        excludeTitle: not("sulfate", "sulphate", "intravenous", "infusion", "dialysis", "menstrua\\w*", "dysmenorrh\\w*"),
        question: q(
          "Adults with leg cramps that have no known cause, mostly older adults",
          "Magnesium supplements",
          "How often cramps happen and how bad they are",
        ),
      },
      {
        id: "sleep",
        label: "Sleep",
        title: words("sleep\\w*", "insomnia"),
        excludeTitle: not("sulfate", "sulphate", "intravenous", "infusion", "an(a)?esthe\\w*", "postoperative"),
        question: q(
          "Older adults with trouble sleeping (insomnia), or adults in general",
          "Oral magnesium supplements",
          "Sleep (time to fall asleep, sleep time, sleep quality)",
        ),
      },
      {
        id: "migraine",
        label: "Migraine prevention",
        title: words("migraine\\w*", "headaches?"),
        excludeTitle: not("emergency", "postdural"),
        question: q(
          "Adults (or children) with migraine",
          "Oral magnesium taken every day to prevent attacks",
          "How often migraine attacks happen and how bad they are",
        ),
      },
      {
        id: "blood-sugar",
        label: "Blood sugar",
        title: words(GLUCOSE),
        excludeTitle: not("sulfate", "sulphate", "intravenous", "infusion", "gestational", "pregnan\\w*"),
        question: q("People with type 2 diabetes or at high risk of it", "Oral magnesium supplements", "Fasting blood sugar, HbA1c or insulin resistance"),
      },
      {
        id: "pregnancy",
        label: "Pregnancy outcomes",
        title: words(PREG, "pre-?eclampsia", "birth", "fetal", "neonatal"),
        excludeTitle: not("sulfate", "sulphate", "intravenous", "infusion", "neuroprotect\\w*", "cerebral palsy", "tocoly\\w*", "seizures?"),
        question: q(
          "Pregnant women",
          "Oral magnesium supplements during pregnancy",
          "Pre-eclampsia, the baby's growth or birth weight, preterm birth or stillbirth",
        ),
      },
    ],
  },
  {
    id: "potassium",
    nutrientId: "potassium",
    name: "potassium",
    terms: ["potassium"],
    context: `${SUPPLEMENT_CONTEXT} OR TITLE_ABS:"salt substitute" OR TITLE_ABS:"salt substitutes"`,
    scope: "in papers about supplements, salt substitutes, intake or diet",
    titleTerms: words("potassium", "salt substitutes?"),
    outcomes: [
      {
        id: "bp-high",
        label: "Blood pressure (high)",
        title: words(BP),
        excludeTitle: not(
          ...CHANNELS,
          "hyperkal\\w*",
          "hypokal\\w*",
          "binders?",
          "patiromer",
          "zirconium",
          "vonoprazan",
          "losartan",
          "dialysis",
          "chronic kidney",
          "pregnan\\w*",
        ),
        question: q(
          "Adults with high blood pressure",
          "Potassium supplements (or potassium-enriched salt substitutes)",
          "Blood pressure",
          "Placebo, no supplement, or ordinary salt",
        ),
      },
      {
        id: "bp-normal",
        label: "Blood pressure (normal)",
        title: words(BP),
        excludeTitle: not(
          ...CHANNELS,
          "hyperkal\\w*",
          "hypokal\\w*",
          "binders?",
          "patiromer",
          "zirconium",
          "vonoprazan",
          "losartan",
          "dialysis",
          "chronic kidney",
          "pregnan\\w*",
        ),
        question: q(
          "Adults with normal blood pressure (or results reported separately for them)",
          "Potassium supplements (or potassium-enriched salt substitutes)",
          "Blood pressure",
          "Placebo, no supplement, or ordinary salt",
        ),
      },
      {
        id: "bp-dose",
        label: "Blood pressure by amount",
        title: words(BP, "dose-response"),
        excludeTitle: not(
          ...CHANNELS,
          "hyperkal\\w*",
          "hypokal\\w*",
          "binders?",
          "patiromer",
          "zirconium",
          "vonoprazan",
          "losartan",
          "dialysis",
          "chronic kidney",
          "pregnan\\w*",
        ),
        question: q("Adults, mostly with high blood pressure", "Potassium supplements at different amounts (a dose-response analysis)", "Blood pressure"),
      },
      {
        id: "kidney-stones",
        label: "Kidney stones (citrate)",
        title: words(STONES, "stones?", "citrate"),
        excludeTitle: not(...CHANNELS, "binders?", "dialysis"),
        question: q("Adults who have had calcium-containing kidney stones", "Potassium citrate (or other citrate)", "New kidney stones or stone growth"),
      },
      {
        id: "bone",
        label: "Calcium loss and bone",
        title: words("bones?", "calcium", "calciuria", "osteopor\\w*", "resorption", "acid-base", "alkali\\w*"),
        excludeTitle: not(...CHANNELS, "binders?", "dialysis", "stones?"),
        question: q(
          "Adults (not people on dialysis)",
          "Potassium bicarbonate or potassium citrate (alkaline potassium salts)",
          "Calcium in urine, markers of bone breakdown, or bone density",
        ),
      },
    ],
  },
  {
    id: "selenium",
    nutrientId: "selenium",
    name: "selenium",
    terms: ["selenium", "selenomethionine", "selenite", "selenate"],
    titleTerms: words("selen\\w*", "antioxidants?"),
    outcomes: [
      {
        id: "cancer",
        label: "Cancer",
        title: words(CANCER),
        excludeTitle: not("chemotherapy", "radiotherapy", "cancer patients", "lymph(o)?edema"),
        question: q(GENERAL, "Selenium supplements (alone, or with results for selenium apart)", "New cancers (overall or by type)"),
      },
      {
        id: "diabetes",
        label: "Type 2 diabetes",
        title: words(GLUCOSE),
        excludeTitle: not("gestational", "pregnan\\w*", "polycystic"),
        question: q("Adults without diabetes at the start", "Selenium supplements", "New type 2 diabetes, or blood sugar"),
      },
      {
        id: "cardiovascular",
        label: "Heart disease and death",
        title: words(CVD, DEATH),
        excludeTitle: not("dialysis", "chronic kidney", "cancer patients", "heart failure"),
        question: q(
          "Adults from the general population or at higher risk of heart disease",
          "Selenium supplements (alone, or with results for selenium apart)",
          "Heart and blood vessel disease, or death from any cause",
        ),
      },
      {
        id: "graves-eyes",
        label: "Thyroid eye disease",
        title: words("graves'?", "orbitopath\\w*", "ophthalmopath\\w*", "thyroid eye"),
        excludeTitle: not(),
        question: q(
          "Adults with Graves' orbitopathy (thyroid eye disease)",
          "Selenium supplements",
          "Eye disease activity, how the disease develops, and quality of life",
        ),
      },
      {
        id: "hashimoto",
        label: "Hashimoto's thyroiditis",
        title: words("hashimoto'?s?", "autoimmune thyroid\\w*", "thyroiditis", "thyroid peroxidase", "TPO", "hypothyroid\\w*"),
        excludeTitle: not("pregnan\\w*", "postpartum"),
        question: q(
          "Adults with Hashimoto's thyroiditis",
          "Selenium supplements",
          "Thyroid hormones and dose of thyroid medicine, well-being, or thyroid antibodies",
        ),
      },
    ],
  },
  {
    id: "vitamin_a",
    nutrientId: "vitamin_a",
    name: "vitamin A and beta-carotene",
    // "vitamin A" alone would match every vitamin (see localFilter); these phrases still match other
    // vitamins ("vitamin D supplementation"), which the local filter removes.
    terms: [
      "retinol",
      "retinyl palmitate",
      "retinyl acetate",
      "beta-carotene",
      "β-carotene",
      "provitamin A",
      "vitamin A supplementation",
      "vitamin A supplements",
      "vitamin A deficiency",
      "vitamin A intake",
    ],
    localFilter: words("vitamin A", "retinol", "retinyl", "beta-?carotene", "β-carotene"),
    scope: "(retinol, retinyl, beta-carotene, or vitamin A supplements, deficiency or intake)",
    titleTerms: words("vitamin A", "retinol", "retinyl", "beta-?carotene", "β-carotene", "carotenoids?", "antioxidants?"),
    outcomes: [
      {
        id: "lung-cancer",
        label: "Lung cancer",
        title: words("lung"),
        excludeTitle: not("retino(ic|id)\\w*", "chemotherapy", "radiotherapy", "cancer patients"),
        question: q(
          "Adults, including smokers, former smokers and people exposed to asbestos",
          "Beta-carotene supplements (alone or with other vitamins)",
          "Lung cancer",
        ),
      },
      {
        id: "cancer",
        label: "Cancer overall",
        title: words(CANCER),
        excludeTitle: not("retino(ic|id)\\w*", "chemotherapy", "radiotherapy", "cancer patients", "children", "infants?"),
        question: q(GENERAL, "Beta-carotene supplements (alone or with other vitamins)", "New cancers (overall or by type)"),
      },
      {
        id: "mortality",
        label: "Death from any cause",
        title: words(DEATH),
        excludeTitle: not("retino(ic|id)\\w*", "children", "child", "infants?", "neonat\\w*", "newborns?", "preterm"),
        question: q(
          "Adults, healthy or with various diseases",
          "Beta-carotene or vitamin A supplements (alone or with other antioxidants, with results for them apart)",
          "Death from any cause",
        ),
      },
      {
        id: "children",
        label: "Young children",
        title: words(DEATH, "morbidity", "diarrh\\w*", "measles", "illness", "infections?", "children", "child"),
        excludeTitle: not("retino(ic|id)\\w*", "neonat\\w*", "newborns?", "preterm", "adults?"),
        question: q(
          "Children aged 6 months to 5 years, mostly in low- and middle-income countries",
          "Vitamin A supplements",
          "Death and illness (diarrhoea, measles, infections)",
        ),
      },
      {
        id: "birth-defects",
        label: "Birth defects",
        title: words("birth defects?", "congenital", "malformation\\w*", "teratogen\\w*", PREG),
        excludeTitle: not("retino(ic|id)\\w*", "isotretinoin"),
        question: q("Pregnant women", "Preformed vitamin A (retinol) supplements in early pregnancy", "Birth defects in the baby"),
      },
    ],
  },
  {
    id: "vitamin_b12",
    nutrientId: "vitamin_b12",
    name: "vitamin B12",
    terms: ["vitamin B12", "cobalamin", "cyanocobalamin", "methylcobalamin", "hydroxocobalamin"],
    titleTerms: words("B12", "B-12", "cobalamins?", "cyanocobalamin", "methylcobalamin", "hydroxocobalamin", B_VITAMINS),
    outcomes: [
      {
        id: "oral-vs-injection",
        label: "Tablets vs injections",
        title: words("oral", "intramuscular", "injections?", "route", "sublingual", "nasal"),
        excludeTitle: not(),
        question: q("Adults with B12 deficiency", "High-dose B12 by mouth", "Blood B12 levels, other deficiency markers or symptoms", "B12 injections"),
      },
      {
        id: "older-doses",
        label: "Doses in older people",
        title: words("dos\\w*", "older", "elderly", "aged"),
        excludeTitle: not(),
        question: q(
          "Older people with mild B12 deficiency",
          "B12 by mouth at different daily amounts",
          "Correction of deficiency markers (methylmalonic acid, B12 levels)",
          "A lower amount",
        ),
      },
      {
        id: "cognition-mood",
        label: "Memory, mood and tiredness",
        title: words(COGNITION, "depress\\w*", "mood", "fatigue", "tired\\w*"),
        excludeTitle: not("schizophreni\\w*", "autism", "infants?"),
        question: q("Adults without a clear B12 deficiency", "Vitamin B12 (alone or with other B vitamins)", "Memory and thinking, low mood, or tiredness"),
      },
      {
        id: "cardiovascular",
        label: "Heart, stroke and death",
        title: words(CVD, DEATH, "cerebrovascular"),
        excludeTitle: not("dialysis", "chronic kidney", "kidney disease"),
        question: q(
          "Adults with or without heart and blood vessel disease",
          "Vitamin B12 with folic acid (often with B6) to lower homocysteine",
          "Heart attacks, strokes or death",
        ),
      },
      {
        id: "neuropathy",
        label: "Diabetic nerve damage",
        title: words("neuropath\\w*", "nerves?", "metformin"),
        excludeTitle: not("chemotherapy"),
        question: q(
          "People with diabetes and nerve damage (diabetic neuropathy), including people on metformin",
          "Vitamin B12 (including methylcobalamin)",
          "Nerve damage symptoms, pain, or nerve function",
        ),
      },
    ],
  },
  {
    id: "vitamin_b6",
    nutrientId: "vitamin_b6",
    name: "vitamin B6",
    terms: ["vitamin B6", "pyridoxine", "pyridoxal", "pyridoxamine"],
    titleTerms: words("B6", "B-6", "pyridox\\w*", "doxylamine", B_VITAMINS),
    outcomes: [
      {
        id: "nausea",
        label: "Nausea in pregnancy",
        title: words("nausea", "vomiting", "hyperemesis", "morning sickness"),
        excludeTitle: not("chemotherapy", "postoperative"),
        question: q("Pregnant women with nausea and vomiting", "Vitamin B6 (pyridoxine), alone or with doxylamine", "Nausea and vomiting"),
      },
      {
        id: "pregnancy",
        label: "Pregnancy outcomes",
        title: words(PREG, "pre-?eclampsia", "birth", "Apgar", "labou?r"),
        excludeTitle: not("nausea", "vomiting", "hyperemesis"),
        question: q(
          "Pregnant women",
          "Vitamin B6 supplements during pregnancy or labour",
          "Pre-eclampsia, birth weight, Apgar scores or other pregnancy outcomes",
        ),
      },
      {
        id: "pms",
        label: "Premenstrual symptoms",
        title: words("premenstrual", "PMS", "PMDD", "menstrua\\w*"),
        excludeTitle: not(),
        question: q("Women with premenstrual syndrome", "Vitamin B6 (alone or with magnesium)", "Premenstrual symptoms"),
      },
      {
        id: "cardiovascular",
        label: "Heart, stroke and death",
        title: words(CVD, DEATH, "cerebrovascular"),
        excludeTitle: not("dialysis", "chronic kidney", "kidney disease"),
        question: q("Adults with or without heart disease", "Vitamin B6, alone or with folic acid and B12", "Heart attacks, strokes or death"),
      },
      {
        id: "cognition",
        label: "Memory and mood",
        title: words(COGNITION, "depress\\w*", "mood"),
        excludeTitle: not("schizophreni\\w*", "autism", "children", "infants?"),
        question: q("Older adults, with or without mild memory problems", "Vitamin B6, alone or with B12 and folic acid", "Memory, thinking or mood"),
      },
      {
        id: "neuropathy",
        label: "Nerve damage",
        title: words("neuropath\\w*", "nerves?", "toxicity", "sensory", "adverse"),
        excludeTitle: not("chemotherapy", "isoniazid", "diabet\\w*"),
        question: q(
          "People taking vitamin B6 supplements for months or years",
          "Vitamin B6 supplements, especially at high amounts",
          "Nerve damage (peripheral neuropathy) or other harms",
          "No B6, or lower amounts",
        ),
      },
    ],
  },
  {
    id: "vitamin_c",
    nutrientId: "vitamin_c",
    name: "vitamin C",
    terms: ["vitamin C", "ascorbic acid", "ascorbate"],
    titleTerms: words("vitamin C", "ascorb\\w*", "antioxidants?"),
    outcomes: [
      {
        id: "colds-catching",
        label: "Catching colds",
        title: words(COLD),
        excludeTitle: not("intravenous", "infusion", "pneumonia", "asthma", "athletes?", "marathon", "soldiers?", "military"),
        question: q("Children and adults in the general community", "Vitamin C every day", "How many people catch colds (or respiratory infections)"),
      },
      {
        id: "colds-stress",
        label: "Colds under physical stress",
        title: words(COLD, "athletes?", "exercise", "marathon"),
        excludeTitle: not("intravenous", "infusion", "asthma"),
        question: q(
          "People under heavy physical stress (marathon runners, skiers, soldiers)",
          "Vitamin C every day",
          "How many people catch colds (results for this group apart)",
        ),
      },
      {
        id: "colds-duration",
        label: "How long colds last",
        title: words(COLD),
        excludeTitle: not("intravenous", "infusion", "pneumonia", "asthma"),
        question: q("Children and adults", "Vitamin C every day, or started when a cold begins", "How long colds last and how bad they are"),
      },
      {
        id: "chronic-disease",
        label: "Heart disease, cancer and death",
        title: words(CVD, CANCER, DEATH),
        excludeTitle: not(
          "intravenous",
          "infusion",
          "cancer patients",
          "chemotherapy",
          "radiotherapy",
          "dialysis",
          "chronic kidney",
          "heart failure",
          "atrial fibrillation",
        ),
        question: q(GENERAL, "Vitamin C supplements (alone, or with results for vitamin C apart)", "Heart disease, cancer or death"),
      },
      {
        id: "with-iron",
        label: "With iron tablets",
        title: words("iron", "an(a)?emi\\w*", "ha?emoglobin", "ferritin"),
        excludeTitle: not("intravenous", "infusion", "dialysis", "chronic kidney"),
        question: q(
          "Adults with iron-deficiency anaemia taking iron tablets",
          "Vitamin C tablets added to iron tablets",
          "Haemoglobin and iron stores (ferritin)",
          "Iron tablets alone",
        ),
      },
      {
        id: "kidney-stones",
        label: "Kidney stones",
        title: words(STONES, "oxalate", "hyperoxaluria"),
        excludeTitle: not("intravenous", "infusion", "dialysis"),
        question: q("Adults", "Vitamin C supplements", "Kidney stones, or oxalate in urine"),
      },
    ],
  },
  {
    id: "vitamin_e",
    nutrientId: "vitamin_e",
    name: "vitamin E",
    terms: ["vitamin E", "alpha-tocopherol", "tocopherol", "tocopheryl"],
    titleTerms: words("vitamin E", "tocopher\\w*", "tocotrienol\\w*", "antioxidants?"),
    outcomes: [
      {
        id: "prostate",
        label: "Prostate cancer",
        title: words("prostat\\w*"),
        excludeTitle: not("radiotherapy", "chemotherapy", "hyperplasia", "BPH"),
        question: q("Men (healthy, or at average risk)", "Vitamin E supplements (alone, or with results for vitamin E apart)", "Prostate cancer"),
      },
      {
        id: "cardiovascular",
        label: "Heart attacks and strokes",
        title: words(CVD),
        excludeTitle: not("dialysis", "chronic kidney", "heart failure", "cardiac surgery"),
        question: q(
          "Middle-aged and older adults, healthy or with vascular disease or diabetes",
          "Vitamin E supplements (alone, or with results for vitamin E apart)",
          "Heart attacks, strokes or deaths from heart and blood vessel disease",
        ),
      },
      {
        id: "stroke",
        label: "Stroke by type",
        title: words("stroke", "cerebrovascular", "ha?emorrhag\\w*"),
        excludeTitle: not("dialysis", "chronic kidney", "subarachnoid"),
        question: q("Adults", "Vitamin E supplements", "Stroke, with ischaemic and haemorrhagic stroke apart"),
      },
      {
        id: "mortality",
        label: "Death from any cause",
        title: words(DEATH),
        excludeTitle: not("dialysis", "chronic kidney", "children", "infants?", "neonat\\w*", "preterm"),
        question: q(
          "Adults, healthy or with chronic diseases",
          "Vitamin E supplements (alone or with other nutrients, with results for vitamin E apart)",
          "Death from any cause",
        ),
      },
      {
        id: "amd",
        label: "Macular degeneration",
        title: words(AMD),
        excludeTitle: not(),
        question: q(
          "People who already have age-related macular degeneration (AMD), or older adults",
          "Antioxidant vitamin and mineral supplements that include vitamin E (such as the AREDS formula), or vitamin E alone",
          "AMD getting worse, or new AMD",
        ),
      },
      {
        id: "nash",
        label: "Fatty liver (NASH)",
        title: words("NASH", "steatohepatitis", "fatty liver", "NAFLD", "MASLD", "MASH", "steatosis"),
        excludeTitle: not("children", "pa?ediatric"),
        question: q("Adults with non-alcoholic fatty liver disease or NASH", "Vitamin E", "Liver inflammation and scarring on biopsy, or liver enzymes"),
      },
    ],
  },
  {
    id: "vitamin_k",
    nutrientId: "vitamin_k",
    name: "vitamin K",
    terms: ["vitamin K", "phylloquinone", "phytonadione", "menaquinone", "menatetrenone", "vitamin K2", "vitamin K1"],
    context: SUPPLEMENT_CONTEXT,
    scope: SUPPLEMENT_SCOPE,
    titleTerms: words("vitamin K\\d?", "phylloquinone", "phytonadione", "menaquinones?", "menatetrenone", "MK-?[47]"),
    outcomes: [
      {
        id: "status",
        label: "Status markers",
        title: words("osteocalcin", "matrix Gla", "MGP", "dp-ucMGP", "status", "carboxylation", "biomarkers?"),
        excludeTitle: not("antagonists?", "warfarin", "anticoagula\\w*", "newborns?", "neonat\\w*", "prophyla\\w*"),
        question: q("Adults", "Vitamin K1 or K2 supplements", "Blood markers of vitamin K status (undercarboxylated osteocalcin, inactive matrix Gla protein)"),
      },
      {
        id: "fractures",
        label: "Fractures",
        title: words("fractur\\w*"),
        excludeTitle: not("antagonists?", "warfarin", "anticoagula\\w*", "newborns?", "neonat\\w*"),
        question: q("Women after menopause or people with osteoporosis", "Vitamin K1 or K2 (including menatetrenone, MK-4) supplements", "Fractures"),
      },
      {
        id: "bone-density",
        label: "Bone density",
        title: words(BMD, "osteopor\\w*"),
        excludeTitle: not("antagonists?", "warfarin", "anticoagula\\w*", "newborns?", "neonat\\w*"),
        question: q("Women after menopause or people with low bone density", "Vitamin K1 or K2 supplements", "Bone mineral density"),
      },
      {
        id: "calcification",
        label: "Artery calcification",
        title: words("calcif\\w*", "arterial stiffness", "vascular", "aortic", "valves?", "pulse wave", "cardiovascular"),
        excludeTitle: not("antagonists?", "warfarin", "anticoagula\\w*", "newborns?", "neonat\\w*"),
        question: q(
          "Adults with or at risk of vascular calcification (including people with kidney disease)",
          "Vitamin K1 or K2 supplements",
          "Calcification or stiffness of arteries and heart valves",
        ),
      },
      {
        id: "warfarin",
        label: "Warfarin stability",
        title: words("warfarin", "anticoagula\\w*", "INR", "antagonists?"),
        excludeTitle: not(
          "reversal",
          "bleeding",
          "ha?emorrhag\\w*",
          "newborns?",
          "neonat\\w*",
          "direct oral",
          "DOACs?",
          "apixaban",
          "rivaroxaban",
          "dabigatran",
          "edoxaban",
        ),
        question: q(
          "People on warfarin (or another vitamin K antagonist) with unstable INR",
          "Low-dose vitamin K supplements every day",
          "How stable the INR is (time in the target range)",
        ),
      },
    ],
  },
  {
    id: "zinc",
    nutrientId: "zinc",
    name: "zinc",
    terms: ["zinc"],
    context: SUPPLEMENT_CONTEXT,
    scope: SUPPLEMENT_SCOPE,
    titleTerms: words("zinc"),
    outcomes: [
      {
        id: "colds-catching",
        label: "Catching colds",
        title: words(COLD),
        excludeTitle: not("pneumonia", "diarrh\\w*", "malaria"),
        question: q("Children and adults", "Zinc taken regularly to prevent colds", "How many people catch colds (or respiratory infections)"),
      },
      {
        id: "colds-duration",
        label: "How long colds last",
        title: words(COLD),
        excludeTitle: not("pneumonia", "diarrh\\w*", "malaria"),
        question: q("Mostly healthy adults with a new cold", "Zinc (mostly lozenges) started at the first symptoms", "How long colds last"),
      },
      {
        id: "colds-side-effects",
        label: "Side effects for colds",
        title: words(COLD),
        excludeTitle: not("pneumonia", "diarrh\\w*", "malaria"),
        question: q("People taking zinc for colds", "Zinc (lozenges, syrup or tablets)", "Side effects (bad taste, nausea)"),
      },
      {
        id: "amd",
        label: "Macular degeneration",
        title: words(AMD),
        excludeTitle: not(),
        question: q(
          "People who already have age-related macular degeneration (AMD), or older adults",
          "Zinc, alone or with antioxidant vitamins (such as the AREDS formula)",
          "AMD getting worse, or new AMD",
        ),
      },
      {
        id: "urinary",
        label: "Urinary problems",
        title: words("urinar\\w*", "genitourinary", "prostat\\w*", "adverse", "safety", "side effects?", "toxicity"),
        excludeTitle: not("children", "infants?"),
        question: q("Older adults", "High-dose zinc supplements", "Urinary or genitourinary problems, or hospital stays for them"),
      },
      {
        id: "blood-sugar",
        label: "Blood sugar",
        title: words(GLUCOSE, "metabolic"),
        excludeTitle: not("gestational", "pregnan\\w*", "polycystic"),
        question: q("Adults with or without diabetes", "Zinc supplements", "Fasting blood sugar, HbA1c or insulin resistance"),
      },
    ],
  },
  {
    id: "omega_3",
    nutrientId: "omega_3",
    name: "omega-3",
    terms: ["omega-3", "n-3 fatty acids", "n-3 fatty acid", "fish oil", "eicosapentaenoic acid", "docosahexaenoic acid", "krill oil", "algal oil"],
    titleTerms: words(
      "omega-?3",
      "n-3",
      "ω-3",
      "fish oils?",
      "eicosapentaenoic",
      "docosahexaenoic",
      "EPA",
      "DHA",
      "krill oil",
      "algal oil",
      "marine fatty acids?",
      "polyunsaturated fatty acids?",
    ),
    outcomes: [
      {
        id: "triglycerides",
        label: "Triglycerides",
        title: words("triglycerid\\w*", "triacylglycerol\\w*", "lipids?", "lipid profile", "dyslipid\\w*", "hypertriglycerid\\w*"),
        excludeTitle: not("pregnan\\w*", "children", "infants?", "dialysis", "parenteral"),
        question: q("Adults with normal or high triglycerides", "Omega-3 supplements (fish oil, EPA and/or DHA)", "Triglycerides"),
      },
      {
        id: "cardiovascular",
        label: "Heart attacks, strokes, deaths",
        title: words(CVD, DEATH),
        excludeTitle: not("heart failure", "dialysis", "pregnan\\w*", "infants?", "preterm", "parenteral", "cancer patients"),
        question: q(
          GENERAL,
          "Omega-3 supplements (fish oil, EPA and/or DHA; prescription icosapent ethyl only with results apart)",
          "Heart attacks, strokes, cardiovascular death or death from any cause",
        ),
      },
      {
        id: "atrial-fibrillation",
        label: "Atrial fibrillation",
        title: words("atrial fibrillation", "arrhythmi\\w*"),
        excludeTitle: not("postoperative"),
        question: q("Adults (not after heart surgery)", "Omega-3 supplements", "New atrial fibrillation"),
      },
      {
        id: "bleeding",
        label: "Bleeding",
        title: words("bleed\\w*", "ha?emorrhag\\w*"),
        excludeTitle: not(),
        question: q("Adults, including people taking antiplatelet medicines", "Omega-3 supplements", "Bleeding events"),
      },
      {
        id: "blood-pressure",
        label: "Blood pressure",
        title: words(BP),
        excludeTitle: not("pregnan\\w*", "pre-?eclampsia", "children"),
        question: q("Adults with or without high blood pressure", "Omega-3 supplements", "Blood pressure"),
      },
      {
        id: "depression",
        label: "Depression",
        title: words("depress\\w*", "mood"),
        excludeTitle: not("postpartum", "perinatal", "pregnan\\w*", "children", "adolescents?", "bipolar"),
        question: q("Adults with depression, or without it (prevention)", "Omega-3 supplements", "Depressive symptoms or new depression"),
      },
      {
        id: "preterm",
        label: "Preterm birth",
        title: words("preterm", "premature", "pregnan\\w*", "gestation\\w*", "birth"),
        excludeTitle: not("infant formula", "neonat\\w*"),
        question: q("Pregnant women", "Omega-3 supplements, or foods with added omega-3, during pregnancy", "Preterm birth"),
      },
    ],
  },
  {
    id: "creatine",
    nutrientId: "creatine",
    name: "creatine",
    terms: ["creatine"],
    context: SUPPLEMENT_CONTEXT,
    scope: SUPPLEMENT_SCOPE,
    titleTerms: words("creatine"),
    outcomes: [
      {
        id: "strength-older",
        label: "Strength, older adults",
        title: words(
          "strength",
          "lean",
          "muscle\\w*",
          "sarcopeni\\w*",
          "physical function",
          "body composition",
          "resistance training",
          "older",
          "elderly",
          "aging",
          "ageing",
        ),
        excludeTitle: not("kinase", "dialysis", "heart failure", "children", "adolescents?", "muscular dystroph\\w*", "myopath\\w*"),
        question: q("Adults over about 55", "Creatine with resistance training", "Muscle strength and lean mass", "Placebo with the same training"),
      },
      {
        id: "performance-young",
        label: "Strength and sprints, under 50",
        title: words("performance", "sprint\\w*", "strength", "power", "exercise", "anaerobic", "high-intensity", "athlet\\w*"),
        excludeTitle: not("kinase", "older", "elderly", "aged", "sarcopeni\\w*", "children"),
        question: q("Healthy adults under 50", "Creatine", "Strength or repeated short, hard exercise"),
      },
      {
        id: "endurance",
        label: "Endurance",
        title: words("endurance", "aerobic", "cycling", "running", "time trial"),
        excludeTitle: not("kinase"),
        question: q("Trained adults", "Creatine", "Endurance performance"),
      },
      {
        id: "cognition",
        label: "Memory and thinking",
        title: words(COGNITION, "brain", "mental"),
        excludeTitle: not("kinase", "children"),
        question: q("Adults, healthy or with an illness", "Creatine", "Memory and thinking"),
      },
      {
        id: "depression",
        label: "Depression",
        title: words("depress\\w*", "mood"),
        excludeTitle: not("kinase", "children", "adolescents?"),
        question: q("Adults with or without depression", "Creatine, alone or with an antidepressant", "Depressive symptoms"),
      },
      {
        id: "kidney",
        label: "Kidney function",
        title: words("kidney", "renal", "creatinine", "glomerular"),
        excludeTitle: not("kinase"),
        question: q("Adults, mostly healthy", "Creatine", "Kidney function, or blood creatinine and eGFR"),
      },
      {
        id: "body-weight",
        label: "Body weight and water",
        title: words("body weight", "body composition", "water", "fat mass", "weight gain", "adipos\\w*"),
        excludeTitle: not("kinase", "children"),
        question: q("Healthy adults", "Creatine", "Body weight, body water or body fat"),
      },
    ],
  },
  {
    id: "biotin",
    nutrientId: "biotin",
    name: "biotin",
    terms: ["biotin"],
    // Biotin is everywhere in lab methods (biotin–streptavidin): only papers about taking it.
    context: `${SUPPLEMENT_CONTEXT} OR TITLE_ABS:interference OR TITLE_ABS:megadose* OR TITLE_ABS:"high-dose biotin" OR TITLE_ABS:deficien*`,
    scope: "in papers about supplements, intake, diet, deficiency, high doses or lab test interference",
    titleTerms: words("biotin", "vitamin B7", "vitamin H"),
    outcomes: [
      {
        id: "lab-interference",
        label: "Wrong lab results",
        title: words("interfer\\w*", "immunoassays?", "assays?", "thyroid", "troponin", "laborator\\w*", "test results?", "misdiagnos\\w*"),
        anyDesign: true,
        excludeTitle: not("biotinylat\\w*"),
        question: q(
          "People taking biotin supplements",
          "Biotin, especially high doses",
          "Results of immunoassay blood tests (thyroid, troponin, hormones): falsely high or low",
          "No biotin",
        ),
      },
      {
        id: "multiple-sclerosis",
        label: "Multiple sclerosis",
        title: words("multiple sclerosis", "MS"),
        excludeTitle: not(),
        question: q("Adults with progressive multiple sclerosis", "Very high-dose biotin", "Disability and walking"),
      },
      {
        id: "hair",
        label: "Hair",
        title: words("hair", "alopecia"),
        anyDesign: true,
        excludeTitle: not(),
        question: q("People with hair loss or wanting healthier hair", "Biotin supplements", "Hair growth or hair loss", "No biotin, or placebo"),
      },
      {
        id: "nails",
        label: "Nails",
        title: words("nails?", "onycho\\w*"),
        anyDesign: true,
        excludeTitle: not(),
        question: q("People with brittle nails", "Biotin supplements", "Nail strength or appearance", "No biotin, or placebo"),
      },
      {
        id: "diabetes",
        label: "Blood sugar and fats",
        title: words(GLUCOSE, "lipids?", "cholesterol", "triglycerid\\w*"),
        excludeTitle: not("gestational"),
        question: q("Adults with type 2 diabetes", "Biotin supplements", "Blood sugar, HbA1c or blood fats"),
      },
      {
        id: "pregnancy",
        label: "Status in pregnancy",
        title: words("pregnan\\w*", "3-hydroxyisovaleric", "status"),
        anyDesign: true,
        excludeTitle: not(),
        question: q("Pregnant women", "Biotin supplements", "Markers of biotin status (urine 3-hydroxyisovaleric acid)", "No biotin"),
      },
    ],
  },
  {
    id: "psyllium",
    nutrientId: "psyllium",
    name: "psyllium",
    terms: ["psyllium", "ispaghula", "Plantago ovata"],
    titleTerms: words("psyllium", "ispaghula", "plantago", "fib(re|er)s?", "viscous fib\\w*", "soluble fib\\w*"),
    outcomes: [
      {
        id: "ldl",
        label: "LDL cholesterol",
        title: words("LDL", "cholesterol", "lipids?", "lipoprotein\\w*", "lipid profile"),
        excludeTitle: not("children", "pa?ediatric"),
        question: q("Adults with or without high cholesterol", "Psyllium (or a fibre supplement with results for psyllium apart)", "LDL cholesterol"),
      },
      {
        id: "glucose",
        label: "Blood sugar",
        title: words(GLUCOSE, "glyc\\w*"),
        excludeTitle: not("gestational", "children"),
        question: q("Adults with type 2 diabetes, at risk of it, or with normal blood sugar", "Psyllium", "Fasting glucose or HbA1c"),
      },
      {
        id: "constipation",
        label: "Constipation",
        title: words("constipation", "bowel movements?", "stools?", "laxatives?"),
        excludeTitle: not("child\\w*", "pa?ediatric", "infants?", "opioid\\w*"),
        question: q(
          "Adults with chronic constipation",
          "Psyllium or other fibre supplements (with results for psyllium apart)",
          "Constipation (stool frequency, symptoms)",
        ),
      },
      {
        id: "ibs",
        label: "IBS",
        title: words("irritable bowel", "IBS"),
        excludeTitle: not("child\\w*", "pa?ediatric"),
        question: q("Adults with irritable bowel syndrome", "Psyllium or other soluble fibre", "IBS symptoms"),
      },
      {
        id: "weight",
        label: "Body weight",
        title: words("weight", "body mass", "BMI", "obes\\w*", "waist", "adipos\\w*"),
        excludeTitle: not("children", "pa?ediatric"),
        question: q("Adults", "Psyllium", "Body weight, body mass index or waist size"),
      },
      {
        id: "blood-pressure",
        label: "Blood pressure",
        title: words(BP),
        excludeTitle: not("pregnan\\w*", "children"),
        question: q("Adults, with or without high blood pressure", "Psyllium or other fibre supplements (with results for psyllium apart)", "Blood pressure"),
      },
    ],
  },
  {
    id: "coq10",
    nutrientId: "coq10",
    name: "CoQ10",
    terms: ["coenzyme Q10", "CoQ10", "ubiquinone", "ubiquinol"],
    titleTerms: words("coenzyme Q10", "CoQ10", "Co-?Q10", "Q10", "ubiquinon\\w*", "ubiquinol"),
    outcomes: [
      {
        id: "heart-failure",
        label: "Heart failure",
        title: words("heart failure", "cardiac function", "ejection fraction", "cardiomyopath\\w*"),
        excludeTitle: not("children", "chemotherapy"),
        question: q("Adults with heart failure on standard treatment", "CoQ10 added to treatment", "Deaths, hospital stays or heart function"),
      },
      {
        id: "migraine",
        label: "Migraine",
        title: words("migraine\\w*", "headaches?"),
        excludeTitle: not(),
        question: q("Adults with migraine", "CoQ10 to prevent attacks", "How often attacks happen and how bad they are"),
      },
      {
        id: "statin-muscle",
        label: "Statin muscle aches",
        title: words("statin\\w*", "myopath\\w*", "myalgia", "muscle"),
        excludeTitle: not(),
        question: q("Adults taking statins, most with muscle symptoms", "CoQ10", "Muscle pain or aches"),
      },
      {
        id: "blood-pressure",
        label: "Blood pressure",
        title: words(BP),
        excludeTitle: not("pregnan\\w*", "pre-?eclampsia"),
        question: q("Adults with high blood pressure", "CoQ10", "Blood pressure"),
      },
      {
        id: "metabolic",
        label: "Blood sugar and fats",
        title: words(GLUCOSE, "lipids?", "cholesterol", "triglycerid\\w*", "metabolic"),
        excludeTitle: not("gestational", "children"),
        question: q("Adults, often with diabetes or other metabolic conditions", "CoQ10", "HbA1c, blood sugar, cholesterol or triglycerides"),
      },
      {
        id: "fatigue",
        label: "Tiredness",
        title: words("fatigue", "tired\\w*", "energy"),
        excludeTitle: not(),
        question: q("Adults, healthy or with an illness", "CoQ10", "Tiredness (fatigue)"),
      },
      {
        id: "exercise",
        label: "Exercise",
        title: words("exercise", "performance", "athlet\\w*", "endurance", "muscle damage"),
        excludeTitle: not("heart failure"),
        question: q("Healthy adults, including athletes", "CoQ10", "Exercise performance"),
      },
    ],
  },
  ...FOOD_TOPICS,
  ...LIFESTYLE_TOPICS,
  ...WHOLE_FOOD_TOPICS,
];
