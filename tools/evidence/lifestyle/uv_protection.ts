import { all, any, GENERAL, q, w } from "../lifestyleHelpers";
import type { TopicDef } from "../topics";

const UV = any(
  "sunscreen",
  "sunscreens",
  "sun protection",
  "sun-protective",
  "sun avoidance",
  "photoprotection",
  "sun protective clothing",
  "sun safety",
  "sunblock",
  "sun exposure",
);
const UV_T = w("sunscreen", "sun protect", "sun-protect", "sun avoid", "photoprotect", "sun safety", "sunblock", "sun exposure", "UV protect", "sun");
/** Other uses: animals, coral and the environment, formulations, or treatments for skin disease rather than everyday protection. */
const NOT_EVERYDAY =
  /\b(coral\w*|marine|aquatic|environment\w*|nanoparticle\w*|cosmetic formulation\w*|psoriasis|vitiligo|lupus|xeroderma|phototherapy|tanning beds?|indoor tanning|social media|campaign\w*)\b/i;

export const topic: TopicDef = {
  id: "lifestyle-uv_protection",
  kind: "lifestyle",
  lifestyleId: "uv_protection",
  name: "sun protection",
  terms: [],
  outcomes: [
    {
      id: "skin-cancer",
      label: "Skin cancer",
      finding: "Skin cancer (squamous cell, basal cell and melanoma)",
      query: all(UV, any("skin cancer", "melanoma", "squamous cell", "basal cell", "keratinocyte")),
      title: [UV_T, w("cancer", "melanoma", "carcinoma", "skin")],
      excludeTitle: NOT_EVERYDAY,
      question: q(
        GENERAL,
        "Regular sunscreen use, protective clothing, shade or other sun protection",
        "Less or no sun protection",
        "Skin cancer (melanoma, squamous cell or basal cell carcinoma)",
      ),
    },
    {
      id: "solar-keratoses",
      label: "Sun spots",
      finding: "Sun spots (solar keratoses, a precancerous skin change)",
      query: all(UV, any("actinic keratosis", "actinic keratoses", "solar keratosis", "solar keratoses", "nevi", "naevi", "moles")),
      title: [UV_T, w("keratos", "actinic", "solar", "nev", "naev", "mole", "skin")],
      excludeTitle: NOT_EVERYDAY,
      question: q(GENERAL, "Regular sunscreen use or other sun protection", "Less or no sun protection", "Solar (actinic) keratoses or new moles"),
    },
    {
      id: "photoageing",
      label: "Skin ageing",
      finding: "Skin ageing (photoageing)",
      query: all(UV, any("photoaging", "photoageing", "skin aging", "skin ageing", "wrinkles", "photodamage")),
      title: [UV_T, w("aging", "ageing", "photoag", "wrinkle", "photodamage")],
      excludeTitle: NOT_EVERYDAY,
      question: q(GENERAL, "Regular sunscreen use or other sun protection", "Less or no sun protection", "Visible skin ageing (photoageing)"),
    },
    {
      id: "vitamin-d",
      label: "Vitamin D",
      finding: "Vitamin D level in the blood",
      query: all(UV, any("vitamin D", "25-hydroxyvitamin D", "25(OH)D")),
      title: [UV_T, w("vitamin D", "25-hydroxy", "25\\(OH\\)D")],
      excludeTitle: NOT_EVERYDAY,
      question: q(
        GENERAL,
        "Regular sunscreen use, covering the skin or avoiding the sun",
        "Less or no sun protection",
        "Vitamin D (25-hydroxyvitamin D) level or vitamin D deficiency",
      ),
    },
    {
      id: "avoidance-mortality",
      label: "Sun avoidance and death",
      finding: "Death from any cause and sun avoidance",
      query: all(any("sun avoidance", "avoidance of sun exposure", "sun exposure", "sunlight exposure"), any("mortality", "death", "all-cause")),
      title: [w("sun", "sunlight", "UV"), w("mortalit", "death", "survival", "all-cause")],
      excludeTitle: NOT_EVERYDAY,
      question: q(GENERAL, "Avoiding the sun or having little sun exposure", "More sun exposure", "Death from any cause"),
    },
    {
      id: "absorption",
      label: "Ingredients in the blood",
      finding: "Sunscreen ingredients in the blood",
      query: all(
        any("sunscreen", "sunscreens", "UV filter", "UV filters", "sunscreen active ingredients"),
        any("plasma", "systemic absorption", "blood", "absorption", "systemic exposure"),
      ),
      title: [w("sunscreen", "UV filter", "oxybenzone", "avobenzone", "benzophenone"), w("plasma", "absorption", "systemic", "blood", "urine", "exposure")],
      excludeTitle: /\b(coral\w*|marine|aquatic|environment\w*|fish|sediment|wastewater)\b/i,
      question: q(
        GENERAL,
        "Sunscreen use (active ingredients absorbed through the skin)",
        "No sunscreen use",
        "Sunscreen ingredients in the blood, and any health effect",
      ),
    },
  ],
};
