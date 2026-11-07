import { DOSE } from "./habitProposal";
import { PRESCRIBING } from "./nutrients";
import type { SafetyId } from "./types";

export type ProposalIntent = "record" | "recommend";
export interface AssistantProposalContext {
  requestText: string;
  safety: readonly SafetyId[];
  critical: boolean;
}

type ProposalKind = "protocol" | "meal" | "habit";
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const normalized = (v: string): string => v.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const copied = (source: string, value: string): boolean =>
  new RegExp(`(?:^|[^\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\p{N}])`, "u").test(source);
// A bounded backstop, not a medicine dictionary or a substitute for the assistant's safety rules.
const MEDICINE =
  /\b(?:medicines?|medications?|prescriptions?|insulin|metformin|glucophage|warfarin|coumadin|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|heparin|aspirin|ibuprofen|paracetamol|acetaminophen|atorvastatin|rosuvastatin|simvastatin|statins?|levothyroxine|lisinopril|losartan|amlodipine|semaglutide|ozempic|wegovy|tirzepatide|mounjaro|antibiotics?|antidepressants?|anticoagulants?|blood thinners?)\b/i;
const CALORIE_TARGET =
  /\b(?:calorie[- ]?(?:restriction|deficit|target|goal|limit)|(?:weight|fat)[- ]?loss(?: plan| diet| protocol)?|lose\s+(?:weight|fat|\d+(?:[.,]\d+)?\s*(?:kg|kilograms?|lb|pounds?))|(?:eat|consume|limit|target|aim for|stay (?:under|below)|under|below|only)\s+(?:less than\s+|under\s+|below\s+|only\s+)?\d[\d,.]*\s*(?:kcal|calories?)|\d[\d,.]*\s*(?:kcal|calories?)\s*(?:(?:a|per|each|\/)?\s*day|target|goal|limit))\b/i;
const EXTRA_DOSE =
  /\b(?:one|two|three|four|half|a|an)\s+(?:tablets?|capsules?|pills?|drops?|scoops?)\b|\b(?:double|halve|increase|reduce|change)\s+(?:your |the )?(?:dose|dosage)\b|\b\d+(?:[.,]\d+)?\s*(?:milligrams?|micrograms?|grams?|millilit(?:er|re)s?)\b/i;
const ACTIVITY_AMOUNT = /\b(?:minutes?|mins?|hours?|sessions?|days?|weeks?|sets?|reps?|repetitions?)\b/i;
const DIET_CHANGE = /\b(?:supplements?|vitamins?|minerals?|fasting|diet|eat|eating|foods?|oats|potassium|magnesium|iron|calcium|creatine|fish oil)\b/i;
const hasDose = (s: string) => DOSE.test(s) || EXTRA_DOSE.test(s);

/** The intent must be explicit on a tool input; never infer it from generated prose. */
export function proposalIntent(input: unknown): ProposalIntent | undefined {
  if (!object(input)) return undefined;
  return input.intent === "record" || input.intent === "recommend" ? input.intent : undefined;
}

/**
 * Additional safety/source checks shared by the server and page. Shape, dates, food ids and marker
 * ids still go through the existing proposal validators. Meal grams are food quantities, not doses;
 * exact food safety limits require the full food table and are checked by the meal caller.
 */
export function proposalIssue(kind: ProposalKind, input: unknown, context: AssistantProposalContext): string | undefined {
  const intent = proposalIntent(input);
  if (!intent || !object(input)) return "Choose whether this records the person's text or recommends a draft.";
  if (context.critical) return "Not while a result is critical: contact a doctor first.";
  const items = kind === "protocol" && Array.isArray(input.items) ? input.items.filter(object) : [];
  const fields =
    kind === "protocol"
      ? [text(input.name), text(input.description), ...items.flatMap((i) => [text(i.label), text(i.amount), text(i.note)]), text(input.source)]
      : kind === "habit"
        ? [text(input.label), text(input.reason)]
        : [text(input.name), text(input.note)];
  if (fields.some((s) => CALORIE_TARGET.test(s))) return "Leave out calorie targets, calorie restriction and weight-loss plans.";
  if (fields.some((s) => PRESCRIBING.test(s))) return "Explain without prescribing treatment or a personal dose.";

  if (kind === "meal") {
    if (fields.some((s) => MEDICINE.test(s))) return "Meals must contain foods, not medicines or treatment instructions.";
    // Food weights in notes are fine; instructions to take pills or set a dose are not.
    if (fields.some((s) => /\b(?:dose|dosage|capsules?|tablets?|pills?)\b|\d+(?:[.,]\d+)?\s*(?:mg|µg|mcg|ug|iu|i\.u\.)\b/i.test(s)))
      return "Leave medicines and supplement doses out of the meal.";
    return undefined;
  }
  if (kind === "habit") {
    if (input.category === "medication" || fields.some((s) => MEDICINE.test(s))) return "Medicines cannot be proposed as habits.";
    if (fields.some(hasDose)) return "Leave amounts and doses out of a proposed habit, including its reason.";
    if (intent === "recommend" && context.safety.length && (input.category !== "lifestyle" || fields.some((s) => DIET_CHANGE.test(s))))
      return "Talk to your doctor before changing diet or supplements with these medicines or conditions.";
    return undefined;
  }

  if (intent === "recommend") {
    if (items.some((i) => i.category === "medication") || fields.some((s) => MEDICINE.test(s))) return "Recommended protocols cannot add medicines.";
    if (
      items.some((i) => text(i.amount) && (i.category !== "lifestyle" || DIET_CHANGE.test(text(i.label)) || !ACTIVITY_AMOUNT.test(text(i.amount)))) ||
      fields.some(hasDose)
    )
      return "Leave supplement doses and food amounts out of a recommended protocol; general activity timing can be an example.";
    if (context.safety.length && (items.some((i) => i.category !== "lifestyle") || fields.some((s) => DIET_CHANGE.test(s))))
      return "Talk to your doctor before changing diet or supplements with these medicines or conditions.";
    return undefined;
  }

  // A source is only the newest request, never earlier turns or the model's own explanation. Keep
  // quantities attached to their item: a dose elsewhere in the pasted routine is not permission.
  const source = normalized(context.requestText);
  const clauses = context.requestText.split(/[\n;]|,(?!\d)|\.(?=\s|$)|\s+and\s+/i).map(normalized);
  for (const item of items) {
    const label = normalized(text(item.label));
    if (!label || !copied(source, label)) return "Record only items named in the person's newest message.";
    const matching = clauses.filter((s) => copied(s, label));
    const amount = normalized(text(item.amount));
    if (amount && !matching.some((s) => copied(s, amount)))
      return "Copy each amount exactly from that item's text in the newest message; never invent or move doses.";
    const note = normalized(text(item.note));
    if (note && !copied(source, note)) return "Copy item notes and conditions from the person's newest message.";
    if ([text(item.label), text(item.note)].some(hasDose) && !matching.some((s) => copied(s, label) && (!note || copied(s, note))))
      return "Copy doses only with the item they belong to in the newest message.";
  }
  if (fields.slice(0, 2).some(hasDose)) return "Keep supplied amounts on their source items, not in the protocol name or description.";
  return undefined;
}
