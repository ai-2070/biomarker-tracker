import { topic as hiit } from "./lifestyle/hiit";
import { topic as hyperbaric_oxygen } from "./lifestyle/hyperbaric_oxygen";
import { topic as keto_diet } from "./lifestyle/keto_diet";
import { topic as low_calorie_diet } from "./lifestyle/low_calorie_diet";
import { topic as paleo_diet } from "./lifestyle/paleo_diet";
import { topic as uv_protection } from "./lifestyle/uv_protection";
import { topic as vegan_diet } from "./lifestyle/vegan_diet";
import { topic as weight_lifting } from "./lifestyle/weight_lifting";
import { topic as zone2_cardio } from "./lifestyle/zone2_cardio";
import type { TopicDef } from "./topics";

/** The nine entries added with the common claims (one file each). */
export const MORE_LIFESTYLE_TOPICS: TopicDef[] = [
  hiit,
  zone2_cardio,
  weight_lifting,
  keto_diet,
  low_calorie_diet,
  paleo_diet,
  vegan_diet,
  uv_protection,
  hyperbaric_oxygen,
];
