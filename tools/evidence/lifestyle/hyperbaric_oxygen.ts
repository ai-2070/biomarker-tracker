import { all, any, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

const HBOT = any("hyperbaric oxygen", "hyperbaric oxygen therapy", "HBOT", "hyperbaric chamber", "mild hyperbaric", "hyperbaric");
const HBOT_T = w("hyperbaric", "HBOT", "HBO2", "HBO\\b", "oxygen therap");
/** Animal, cell and lab studies. */
const NOT_PEOPLE = /\b(rats?|mice|mouse|murine|rabbits?|pigs?|porcine|canine|dogs?|in vitro|cell culture)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-hyperbaric_oxygen",
  kind: "lifestyle",
  lifestyleId: "hyperbaric_oxygen",
  name: "hyperbaric oxygen",
  terms: [],
  outcomes: [
    {
      id: "decompression-sickness",
      label: "Decompression sickness",
      finding: "Decompression sickness (approved medical use)",
      query: all(HBOT, any("decompression sickness", "decompression illness", "diving", "divers", "air embolism")),
      title: [HBOT_T, w("decompression", "diving", "diver", "embolism", "recompression")],
      excludeTitle: NOT_PEOPLE,
      question: q(
        "People with decompression sickness after diving or a pressure drop",
        "Hyperbaric oxygen (recompression with oxygen)",
        "No hyperbaric oxygen, or normal-pressure oxygen alone",
        "Recovery from decompression sickness",
      ),
    },
    {
      id: "diabetic-foot",
      label: "Diabetic foot ulcers",
      finding: "Diabetic foot ulcers",
      query: all(HBOT, any("diabetic foot", "foot ulcer", "foot ulcers", "chronic wounds", "wound healing")),
      title: [HBOT_T, w("diabet", "foot", "ulcer", "wound")],
      excludeTitle: NOT_PEOPLE,
      question: q(
        "People with diabetic foot ulcers or other chronic wounds",
        "Hyperbaric oxygen added to standard care",
        "Standard care alone",
        "Ulcer healing and amputation",
      ),
    },
    {
      id: "radiation-injury",
      label: "Late radiation injury",
      finding: "Late radiation injury (for example in the jaw, head and neck, rectum)",
      query: all(
        HBOT,
        any(
          "radiation injury",
          "radiation tissue injury",
          "osteoradionecrosis",
          "radiation proctitis",
          "radiation cystitis",
          "radiotherapy",
          "radiation-induced",
        ),
      ),
      title: [HBOT_T, w("radiation", "radionecrosis", "radiotherapy", "proctitis", "cystitis", "irradiated")],
      excludeTitle: NOT_PEOPLE,
      question: q(
        "People with tissue injury months or years after radiotherapy",
        "Hyperbaric oxygen",
        "No hyperbaric oxygen (standard care)",
        "Healing of radiation-damaged tissue",
      ),
    },
    {
      id: "healthy-ageing-cognition",
      label: "Ageing and thinking",
      finding: "Memory, ageing markers and thinking in healthy people",
      query: all(HBOT, any("healthy", "aging", "ageing", "older adults", "cognitive", "cognition", "telomere", "memory", "senescence")),
      title: [HBOT_T, w("healthy", "aging", "ageing", "older", "cognit", "telomere", "memory", "senescen", "brain")],
      excludeTitle: NOT_PEOPLE,
      question: q(
        "Healthy adults, or people without a specific illness",
        "Hyperbaric oxygen sessions",
        "No hyperbaric oxygen, or a sham session",
        "Memory, thinking, or ageing markers such as telomere length",
      ),
    },
    {
      id: "sports-recovery",
      label: "Muscle soreness and sports injuries",
      finding: "Recovery from muscle soreness and sports injuries",
      query: all(HBOT, any("muscle soreness", "sports injuries", "soft tissue injury", "athletes", "exercise recovery", "muscle damage", "sprain")),
      title: [HBOT_T, w("muscle", "soreness", "sport", "athlet", "soft tissue", "exercise", "sprain", "injur")],
      excludeTitle: NOT_PEOPLE,
      question: q(
        "Healthy people, athletes, or people with sports injuries",
        "Hyperbaric oxygen",
        "No hyperbaric oxygen, or a sham session",
        "Recovery from muscle soreness or sports injury",
      ),
    },
    {
      id: "side-effects",
      label: "Side effects",
      finding: "Ear, sinus and oxygen-toxicity side effects",
      query: all(HBOT, any("adverse events", "side effects", "complications", "barotrauma", "oxygen toxicity", "safety")),
      title: [HBOT_T, w("adverse", "side effect", "complication", "barotrauma", "toxicity", "safety", "risk")],
      excludeTitle: NOT_PEOPLE,
      question: q(GENERAL, "Hyperbaric oxygen therapy", "No hyperbaric oxygen", "Side effects such as ear or sinus barotrauma, oxygen toxicity and seizures"),
    },
  ],
};
