/**
 * The written-down searches behind each evidence map: the terms a paper's title or abstract must
 * contain, and the outcomes the map follows (each tied to a finding on the nutrient's page). Changing a
 * search means changing it here, in review, so every map can be re-run and compared.
 */
import type { Question } from "../../src/core/evidenceMap";

export interface OutcomeDef {
  id: string;
  label: string;
  /** The finding on the nutrient page this outcome checks (its `outcome` text). */
  finding?: string;
  /** Words that put a paper on this outcome when they appear in its title (any of them). */
  title: RegExp;
  /** Reviews with these words in the title are about another group of people or another question. */
  excludeTitle?: RegExp;
  /** The finding's question, for screening each eligible review's abstract (tools/evidence/screen.ts). */
  question: Question;
}

export interface TopicDef {
  id: string;
  nutrientId: string;
  terms: string[];
  outcomes: OutcomeDef[];
}

export const TOPICS: TopicDef[] = [
  {
    id: "vitamin_d",
    nutrientId: "vitamin_d",
    terms: ["vitamin D", "cholecalciferol", "ergocalciferol", "calcifediol", "25-hydroxyvitamin D", "vitamin D3", "vitamin D2"],
    outcomes: [
      { id: "fractures-falls", label: "Fractures and falls", question: {"population": "Adults living at home or in care homes, mostly older adults (not a group defined by one illness)", "intervention": "Vitamin D (D3, D2 or calcifediol) on its own; a review that also analyses vitamin D without calcium separately counts", "comparison": "Placebo or no treatment", "outcome": "Fractures or falls"}, finding: "Bone fractures and falls (vitamin D on its own)", title: /\b(fractur\w*|falls?|falling)\b/i, excludeTitle: /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i },
      { id: "mortality", label: "Death from any cause", question: {"population": "Adults in general or older adults (not a group defined by one illness, such as people in intensive care, on dialysis or with cancer)", "intervention": "Vitamin D (D3, D2 or calcifediol)", "comparison": "Placebo or no treatment", "outcome": "Death from any cause"}, finding: "Cancer, heart disease and death from any cause", title: /\b(mortality|death|survival)\b/i, excludeTitle: /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i },
      { id: "cancer", label: "Cancer", question: {"population": "Adults in general or older adults (not a group defined by one illness, such as people in intensive care, on dialysis or with cancer)", "intervention": "Vitamin D (D3, D2 or calcifediol)", "comparison": "Placebo or no treatment", "outcome": "New cancers or deaths from cancer"}, finding: "Cancer, heart disease and death from any cause", title: /\b(cancer\w*|neoplas\w*|tumou?r\w*|carcinoma\w*)\b/i, excludeTitle: /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i },
      { id: "cardiovascular", label: "Heart and blood vessel disease", question: {"population": "Adults in general or older adults (not a group defined by one illness, such as people in intensive care, on dialysis or with cancer)", "intervention": "Vitamin D (D3, D2 or calcifediol)", "comparison": "Placebo or no treatment", "outcome": "Heart attacks, strokes, other cardiovascular events or cardiovascular death"}, finding: "Cancer, heart disease and death from any cause", title: /\b(cardiovascular|myocardial infarction|heart|stroke|coronary)\b/i, excludeTitle: /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i },
      { id: "respiratory", label: "Respiratory infections", question: {"population": "Children or adults (any age; not people already ill with COVID-19 or in hospital)", "intervention": "Vitamin D (D3, D2 or calcifediol) to prevent infection", "comparison": "Placebo or no treatment", "outcome": "Acute respiratory infections (colds, flu, chest infections, pneumonia)"}, finding: "Respiratory infections (colds, flu, chest infections)", title: /\b(respiratory (tract )?infection\w*|influenza|common cold|pneumonia|acute respiratory|COVID|SARS-CoV-2)\b/i, excludeTitle: /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|athletes?|multiple sclerosis|cystic fibrosis|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease)\b/i },
      { id: "diabetes", label: "Type 2 diabetes", question: {"population": "Adults without diabetes at the start, with prediabetes or at risk of type 2 diabetes", "intervention": "Vitamin D (D3, D2 or calcifediol)", "comparison": "Placebo or no treatment", "outcome": "New type 2 diabetes"}, finding: "Type 2 diabetes in people with prediabetes", title: /\b(type 2 diabetes|diabetes|prediabet\w*|insulin resistance)\b/i, excludeTitle: /\b(sepsis|septic|COVID|SARS-CoV-2|critically ill|intensive care|ICU|surg\w*|operat\w*|bypass|dialysis|haemodialysis|hemodialysis|chronic kidney|kidney disease|transplant\w*|HIV|tuberculosis|pregnan\w*|gestational|preterm|neonat\w*|infants?|athletes?|multiple sclerosis|cystic fibrosis|COPD|asthma|heart failure|cancer patients|chemotherapy|type 1 diabetes|polycystic|obes\w*|bariatric|psoriasis|lupus|cirrhosis|liver disease|children|adolescents?)\b/i },
    ],
  },
];
