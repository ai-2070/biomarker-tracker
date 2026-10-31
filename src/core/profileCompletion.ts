import { isProfile } from "./backup";
import { isBirthMonth } from "./phenoageDraws";
import { LIFE_TABLE_COUNTRIES } from "./lifeTable";
import type { Profile } from "./types";
import { safetyNotes } from "./protocols";

/** Only non-private profile fields; weight and other readings belong in dated measurements. */
export const PROFILE_DETAIL_FIELDS = ["heightCm", "sex", "birthMonth", "country", "diet", "smoking", "conditions", "allergies"] as const;
export type ProfileDetailField = typeof PROFILE_DETAIL_FIELDS[number];
export interface ProfileDetailInput { field: ProfileDetailField; quote: string }
export interface ProfileDetailChange { field: ProfileDetailField; value: string | number }
export interface ProfileCompletion { profile: Profile; added: ProfileDetailChange[]; rejected: string[] }
export const PROFILE_DETAIL_LABELS: Record<ProfileDetailField, string> = {
  heightCm: "Height", sex: "Sex", birthMonth: "Birth month", country: "Country", diet: "Diet", smoking: "Smoking", conditions: "Health conditions", allergies: "Allergies",
};

const norm = (text: string) => text.replace(/[’‘]/g, "'").replace(/^im\b/i, "I'm").replace(/\s+/g, " ").trim();
const missing = (value: unknown) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
const optOut = /\b(?:don't|do not|never)\s+(?:save|store|remember|record|add|update)\b/i;
const hypothetical = /\b(?:if|suppose|imagine|pretend|hypothetical(?:ly)?|for example)\b/i;
const thirdPerson = /\b(?:he|she|they|someone|patient)\b|\bmy\s+(?:wife|husband|partner|friend|mother|father|brother|sister|son|daughter|child)\b/i;

const SENTENCE_END = /[!?;\n]|(?<!\d)\.|\.(?!\d)/;

/** Ignore quoted examples, including later sentences inside the same quote. */
function inQuotedText(text: string): boolean {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const kind = /["“”]/.test(c) ? '"' : /['‘’]/.test(c) ? "'" : c === "`" ? "`" : undefined;
    if (!kind) continue;
    if (kind === "'" && /\w/.test(text[i - 1] ?? "") && /\w/.test(text[i + 1] ?? "")) continue;
    if (quote === kind) quote = undefined;
    else if (!quote && !/\d/.test(text[i - 1] ?? "")) quote = kind;
  }
  return quote !== undefined;
}

/** A single missing, extra or mistyped letter in a long diet word is unambiguous here. */
function dietWord(word: string, expected: string): boolean {
  if (word === expected) return true;
  if (Math.min(word.length, expected.length) < 6 || Math.abs(word.length - expected.length) > 1) return false;
  let a = 0;
  let b = 0;
  let edits = 0;
  while (a < word.length && b < expected.length) {
    if (word[a] === expected[b]) { a++; b++; continue; }
    if (++edits > 1) return false;
    if (word.length >= expected.length) a++;
    if (word.length <= expected.length) b++;
  }
  return edits + (a < word.length || b < expected.length ? 1 : 0) <= 1;
}

/** Evidence is a literal, first-person clause in the newest typed question, not a document or example. */
function ownStatement(quote: string, text: string, field?: ProfileDetailField): boolean {
  const at = text.indexOf(quote);
  if (at < 0 || !quote.trim() || quote.length > 2000) return false;
  const after = text.slice(at + quote.length);
  if (/\w$/.test(quote) && /^\w/.test(after)) return false;
  const before = text.slice(0, at);
  const clause = norm(before.split(SENTENCE_END).at(-1) ?? "");
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if (/^[ \t]*>/.test(line) || inQuotedText(before)) return false;
  if (hypothetical.test(clause) || /\b(?:says?|said|wrote|writes?)\s*:\s*$/i.test(before)) return false;
  if (clause && !/[, :]$/.test(clause) && !/\b(?:and|but)$/.test(clause)) return false;
  const q = norm(quote);
  if (!/^(?:i\b|i'm\b|i've\b|my\b)/i.test(q) || hypothetical.test(q) || thirdPerson.test(q)) return false;
  if (/[?]$/.test(q) || /^\s*\?/.test(text.slice(at + quote.length))) return false;
  if (/\b(?:might|maybe|perhaps|possibly|considering|planning|want|wish|suspect|wonder)\b/i.test(q)) return false;
  if (field !== "smoking" && /\b(?:not|never|don't|do not|used to)\b/i.test(q)) return false;
  return true;
}

function height(quote: string): number | undefined {
  const q = norm(quote);
  if (!/^(?:my height\b|i(?: am|'m)\b)/i.test(q)) return undefined;
  const metric = [...q.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(cm|centimet(?:er|re)s?|m|met(?:er|re)s?)\b/gi)];
  let cm: number | undefined;
  if (metric.length === 1) {
    const m = metric[0]!;
    if (/^[\s,]*\d/.test(q.slice(m.index + m[0].length))) return undefined;
    cm = Number(m[1]!.replace(",", ".")) * (/^(?:cm|cent)/i.test(m[2]!) ? 1 : 100);
  } else if (metric.length > 1) return undefined;
  else {
    const feet = [...q.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(?:feet|foot|ft\b|['′])(?:\s*(\d+(?:[.,]\d+)?)\s*(?:inches|inch|in\b|["″]))?/gi)];
    if (feet.length === 1) {
      const f = feet[0]!;
      if (!f[2] && /^[\s,]*\d/.test(q.slice(f.index + f[0].length))) return undefined;
      const inches = Number((f[2] ?? "0").replace(",", "."));
      if (inches >= 12) return undefined;
      cm = Number(f[1]!.replace(",", ".")) * 30.48 + inches * 2.54;
    } else if (feet.length > 1) return undefined;
    else {
      const inches = [...q.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(?:inches|inch|in)\b/gi)];
      if (inches.length === 1) cm = Number(inches[0]![1]!.replace(",", ".")) * 2.54;
    }
  }
  return cm !== undefined && Number.isFinite(cm) && cm >= 40 && cm <= 260 ? Math.round(cm * 100) / 100 : undefined;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function birthMonth(quote: string, today: string): string | undefined {
  const q = norm(quote).toLowerCase();
  if (!/\b(?:born|birth\s*(?:month|date)|birthday)\b/.test(q)) return undefined;
  const numeric = [...q.matchAll(/\b((?:19|20)\d{2})[-/](0?[1-9]|1[0-2])(?:[-/]\d{1,2})?\b/g)];
  let value: string | undefined;
  if (numeric.length === 1) value = `${numeric[0]![1]}-${numeric[0]![2]!.padStart(2, "0")}`;
  else if (numeric.length > 1) return undefined;
  else {
    const years = [...q.matchAll(/\b(?:19|20)\d{2}\b/g)];
    const months = MONTHS.flatMap((name, index) => new RegExp(`\\b(?:${name}|${name.slice(0, 3)})\\b`).test(q) ? [index + 1] : []);
    if (years.length === 1 && months.length === 1) value = `${years[0]![0]}-${String(months[0]).padStart(2, "0")}`;
  }
  return value && isBirthMonth(value) && value <= today.slice(0, 7) ? value : undefined;
}

function quotedField(field: ProfileDetailField, quote: string, today: string): Partial<Profile> | undefined {
  const q = norm(quote);
  switch (field) {
    case "heightCm": {
      const value = height(q);
      return value === undefined ? undefined : { heightCm: value };
    }
    case "birthMonth": {
      const value = birthMonth(q, today);
      return value ? { birthMonth: value } : undefined;
    }
    case "sex": {
      const declaration = q.match(/^(?:i(?: am|'m)\s+|my sex\s*(?:is|:)\s*)(.+)/i)?.[1];
      if (!declaration) return undefined;
      const labels = declaration.split(/,\s*|\s+and\s+/i).flatMap((part) => {
        const label = part.trim().match(/^(?:an?\s+)?(?:\d+(?:[- ]year[- ]old| years old|yo)?\s+)?(male|man|female|woman|m|f)[.!]?$/i)?.[1]?.toLowerCase();
        return label ? [label === "female" || label === "woman" || label === "f" ? "f" as const : "m" as const] : [];
      });
      return labels.length && labels.every((label) => label === labels[0]) ? { sex: labels[0]! } : undefined;
    }
    case "country": {
      const match = q.match(/^(?:i (?:live|reside|am based) in|my country(?: of residence)? (?:is|:))\s+(.+)/i);
      if (!match) return undefined;
      const tail = match[1]!.toLowerCase();
      const code = Object.entries(LIFE_TABLE_COUNTRIES).find(([code, name]) => code !== "EU27_2020" && [code, name].some((s) => tail === s.toLowerCase() || tail.startsWith(`${s.toLowerCase()}.`) || tail.startsWith(`${s.toLowerCase()},`) || tail.startsWith(`${s.toLowerCase()} and `)))?.[0];
      return code ? { country: code } : undefined;
    }
    case "diet": {
      const adverbs = "(?:(?:usually|generally|normally|mostly|primarily)\\s+)?";
      const description = q.match(new RegExp(`^(?:i(?: am|'m)\\s+${adverbs}|i\\s+${adverbs}(?:eat|follow)\\s+|my diet\\s*(?:is|:)\\s*)(?:an?\\s+)?(.+)`, "i"))?.[1];
      if (!description || /\b(?:except|avoid|without|only)\b/i.test(description)) return undefined;
      const word = description.toLowerCase().match(/^[a-z]+/)?.[0];
      if (!word) return undefined;
      const choices = [
        [["vegan"], "vegan"], [["vegetarian"], "vegetarian"], [["pescatarian", "pescetarian"], "pescatarian"],
        [["omnivore", "omnivorous"], "omnivore"], [["special", "other"], "other"],
      ] as const;
      const found = choices.filter(([words]) => words.some((expected) => dietWord(word, expected)));
      if (found.length === 1) return { diet: found[0]![1] };
      return new RegExp(`^i\\s+${adverbs}eat\\b`, "i").test(q) && dietWord(word, "everything") ? { diet: "omnivore" } : undefined;
    }
    case "smoking": {
      if (/\b(?:never smoked|never been a smoker)\b/i.test(q)) return { smoking: "never" };
      if (/\b(?:used to smoke|quit smoking|stopped smoking|former smoker|ex-smoker)\b/i.test(q)) return { smoking: "former" };
      if (/^(?:i (?:currently )?smoke\b|i(?: am|'m) (?:a |currently a )?smoker\b)/i.test(q)) return { smoking: "current" };
      return undefined; // "I don't smoke" does not distinguish former from never.
    }
    case "conditions": {
      if (/^i have no (?:known )?(?:medical |health )?conditions[.!]?$/i.test(q)) return { conditions: "None reported" };
      const match = q.match(/^(?:i (?:have been|was) diagnosed with|i have|my (?:medical |health )?conditions? (?:is|are|:))\s+(.+)/i);
      const text = match?.[1]?.replace(/[.!]$/, "").trim();
      if (!text || /\b(?:no|question|family history|risk of|symptoms?|a cold|fever|headache|cough)\b/i.test(text)) return undefined;
      return { conditions: text };
    }
    case "allergies": {
      if (/^(?:i have no (?:known )?allergies|my allergies are none)[.!]?$/i.test(q)) return { allergies: "None reported" };
      const match = q.match(/^(?:i(?: am|'m) allergic to|my allergies (?:are|:))\s+(.+)/i);
      const text = match?.[1]?.replace(/[.!]$/, "").trim();
      return text ? { allergies: text } : undefined;
    }
  }
}

/** Fill missing details only. The model selects quotes; code extracts and validates their values. */
export function completeProfileDetails(current: Profile, input: unknown, userText: string, today: string): ProfileCompletion {
  const rejected: string[] = [];
  const added: ProfileDetailChange[] = [];
  if (optOut.test(norm(userText)) || !input || typeof input !== "object" || !("details" in input)) return { profile: current, added, rejected };
  const details = input.details;
  if (!Array.isArray(details) || details.length > 20) return { profile: current, added, rejected: ["Provide at most 20 quoted profile details."] };
  const candidates = new Map<ProfileDetailField, { patch: Partial<Profile>; value: string | number } | null>();
  for (const raw of details) {
    if (!raw || typeof raw !== "object" || !("field" in raw) || !("quote" in raw)) { rejected.push("A profile detail is invalid."); continue; }
    const { field, quote } = raw;
    const key = typeof field === "string" ? PROFILE_DETAIL_FIELDS.find((f) => f === field) : undefined;
    if (!key) { rejected.push("Unsupported profile field."); continue; }
    if (!missing(current[key])) { rejected.push(`${PROFILE_DETAIL_LABELS[key]} is already set.`); continue; }
    if (typeof quote !== "string" || !ownStatement(quote, userText, key)) { rejected.push(`${PROFILE_DETAIL_LABELS[key]} needs an explicit statement about you in the newest question.`); continue; }
    const patch = quotedField(key, quote, today);
    const value = patch?.[key];
    if (!patch || !isProfile(patch) || (typeof value !== "string" && typeof value !== "number")) { rejected.push(`${PROFILE_DETAIL_LABELS[key]} could not be read without guessing.`); continue; }
    if (candidates.has(key)) {
      if (candidates.get(key)?.value !== value) candidates.set(key, null);
    } else candidates.set(key, { patch, value });
  }
  let profile = current;
  for (const [field, candidate] of candidates) {
    if (!candidate) { rejected.push(`${PROFILE_DETAIL_LABELS[field]} has conflicting statements.`); continue; }
    if (profile === current) profile = { ...current };
    Object.assign(profile, candidate.patch);
    added.push({ field, value: candidate.value });
  }
  return { profile, added, rejected };
}

/** Detect explicit typed facts even when the answering model does not call a save tool. */
export function profileDetailsIn(userText: string, today: string): { details: ProfileDetailInput[] } {
  const details: ProfileDetailInput[] = [];
  if (optOut.test(norm(userText))) return { details };
  for (const sentence of userText.split(SENTENCE_END)) {
    // Keep "I'm 31, 192 cm, man" together; split only at a new explicit subject or question.
    const clauses = sentence.split(/(?:,\s*|\s+(?:and|but)\s+)(?=(?:I\b|my\b))|\s+(?=(?:what|how|which|should|could|would|can)\b)/i);
    for (const clause of clauses) {
      const quote = clause.trim();
      if (!quote) continue;
      for (const field of PROFILE_DETAIL_FIELDS) {
        // "I have a sweet tooth/a job/a dog" must not become a health condition.
        if (field === "conditions") {
          const explicit = /^(?:i (?:have been|was) diagnosed with|my (?:medical |health )?conditions?\b|i have no (?:known )?(?:medical |health )?conditions\b)/i.test(norm(quote));
          const kidneyCondition = safetyNotes([quote]).some(({ id }) => id === "kidney");
          if (!explicit && !kidneyCondition) continue;
        }
        if (!ownStatement(quote, userText, field) || !quotedField(field, quote, today)) continue;
        details.push({ field, quote });
        if (details.length > 20) return { details: [] };
      }
    }
  }
  return { details };
}

/** Current, literal self-reports only; these are not instructions from an attached report. */
export function measurementStatementsIn(userText: string): string[] {
  if (optOut.test(norm(userText))) return [];
  return userText.split(SENTENCE_END).flatMap((sentence) =>
    sentence.split(/(?:,\s*|\s+(?:and|but)\s+)(?=(?:I\b|im\b|my\b))|\s+(?=(?:what|how|which|should|could|would|can)\b)/i),
  ).map((clause) => clause.trim()).filter((quote) =>
    ownStatement(quote, userText) &&
    !/\b(?:was|were|yesterday|ago|previously|last|will|would|goal|target|aim|hope|report|document|example|says?|said|chart)\b|\b(?:in|on)\s+\d{4}\b/i.test(quote) &&
    !/["“”]|(?:^|\s)['‘](?=\w)/.test(quote.replace(/\d['′]\d+["″]/g, "")),
  );
}
