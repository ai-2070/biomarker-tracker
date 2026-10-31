import { describe, expect, it } from "vitest";
import { completeProfileDetails, profileDetailsIn, type ProfileDetailField } from "../../src/core/profileCompletion";
import type { Profile } from "../../src/core/types";

const today = "2026-10-30";
const read = (field: ProfileDetailField, quote: string, text = quote, profile: Profile = {}) =>
  completeProfileDetails(profile, { details: [{ field, quote }] }, text, today);

describe("profile facts explicitly stated to Brain", () => {
  it.each([
    ["My height is 180 cm", 180],
    ["I'm 1.80 m tall", 180],
    ["My height is 1,75 metres", 175],
    ["I'm 5 feet 11 inches tall", 180.34],
    ["I'm 5'11\"", 180.34],
    ["My height is 71 inches", 180.34],
  ])("converts the stated height in %s without model arithmetic", (quote, heightCm) => {
    expect(read("heightCm", quote).profile).toEqual({ heightCm });
  });

  it.each([
    ["sex", "I'm male", { sex: "m" }],
    ["sex", "I'm a woman", { sex: "f" }],
    ["birthMonth", "I was born in May 1980", { birthMonth: "1980-05" }],
    ["birthMonth", "My birth date is 1980-05-17", { birthMonth: "1980-05" }],
    ["country", "I live in Hungary", { country: "HU" }],
    ["diet", "I'm vegan", { diet: "vegan" }],
    ["smoking", "I've never smoked", { smoking: "never" }],
    ["smoking", "I quit smoking", { smoking: "former" }],
    ["smoking", "I currently smoke", { smoking: "current" }],
    ["conditions", "I have chronic kidney disease", { conditions: "chronic kidney disease" }],
    ["allergies", "I'm allergic to peanuts", { allergies: "peanuts" }],
    ["allergies", "I have no known allergies", { allergies: "None reported" }],
  ] as const)("reads an explicit %s statement without inventing other fields", (field, quote, expected) => {
    expect(read(field, quote).profile).toEqual(expected);
  });

  it("keeps existing fields and private data, filling only a blank field", () => {
    const current: Profile = { name: "Private Name", notes: "Private notes", heightCm: 168, allergies: "   ", example: true };
    const text = "I'm 180 cm. I'm allergic to peanuts";
    const r = completeProfileDetails(current, { details: [
      { field: "heightCm", quote: "I'm 180 cm" },
      { field: "allergies", quote: "I'm allergic to peanuts" },
    ] }, text, today);
    expect(r.profile).toEqual({ ...current, allergies: "peanuts" });
    expect(r.added).toEqual([{ field: "allergies", value: "peanuts" }]);
    expect(current.allergies).toBe("   ");
  });

  it.each([
    ["If I am 180 cm, what would my BMI be?", "I am 180 cm"],
    ["My brother says \"I'm 180 cm\"", "I'm 180 cm"],
    ["Example: \"I'm 180 cm\"", "I'm 180 cm"],
    ["```\nI'm 180 cm\n```", "I'm 180 cm"],
    ["> I'm 180 cm", "I'm 180 cm"],
    ["I'm not 180 cm", "I'm not 180 cm"],
    ["Am I 180 cm?", "I 180 cm"],
    ["My height is 180 cm?", "My height is 180 cm"],
    ["I was 180 cm", "I was 180 cm"],
    ["I'm 180 cm. Don't save this", "I'm 180 cm"],
    ["The attached file says 180 cm", "I'm 180 cm"],
  ])("does not save an example, speculation, negation, opt-out or unquoted fact: %s", (text, quote) => {
    expect(read("heightCm", quote, text).added).toEqual([]);
  });

  it.each(["My height is 180", "My height is 900 cm", "I'm 5 feet 12 inches", "I'm 1.8 m and 180 cm", "I'm 5 feet 11", "I'm 5'11", "I'm 1 m 80"])("does not guess ambiguous or impossible height: %s", (quote) => {
    expect(read("heightCm", quote).added).toEqual([]);
  });

  it("does not treat a truncated word or unit as the person's statement", () => {
    expect(read("heightCm", "I'm 180 cm", "I'm 180 cm2").added).toEqual([]);
    expect(read("sex", "I'm male", "I'm malevolent").added).toEqual([]);
  });

  it("does not turn age into a guessed birthday, nationality into residence, or non-smoking into never-smoking", () => {
    expect(read("birthMonth", "I'm 45 years old").added).toEqual([]);
    expect(read("birthMonth", "I was born in November 2026").added).toEqual([]);
    expect(read("country", "I'm Hungarian").added).toEqual([]);
    expect(read("smoking", "I don't smoke").added).toEqual([]);
    expect(read("conditions", "I have a family history of diabetes").added).toEqual([]);
    expect(read("conditions", "I have no diabetes").added).toEqual([]);
  });

  it("rejects conflicting field quotes and deduplicates equivalent ones", () => {
    const text = "I'm 180 cm. My height is 175 cm";
    expect(completeProfileDetails({}, { details: [
      { field: "heightCm", quote: "I'm 180 cm" },
      { field: "heightCm", quote: "My height is 175 cm" },
    ] }, text, today).added).toEqual([]);
    const quote = "I'm 180 cm";
    expect(completeProfileDetails({}, { details: [{ field: "heightCm", quote }, { field: "heightCm", quote }] }, quote, today).added)
      .toEqual([{ field: "heightCm", value: 180 }]);
  });

  it("rejects private, arbitrary or malformed fields while allowing a stated fact followed by a question", () => {
    expect(completeProfileDetails({}, { details: [{ field: "name", quote: "My name is Anna" }, { field: "notes", quote: "My private notes" }, { field: "weight", quote: "I weigh 70 kg" }, null] }, "My name is Anna. My private notes. I weigh 70 kg", today).added).toEqual([]);
    expect(read("heightCm", "I'm 180 cm", "I'm 180 cm, can you explain BMI?").profile.heightCm).toBe(180);
    expect(completeProfileDetails({}, { details: Array(21).fill({ field: "heightCm", quote: "I'm 180 cm" }) }, "I'm 180 cm", today).added).toEqual([]);
  });
});

describe("automatic facts in ordinary personal messages", () => {
  const capture = (text: string, current: Profile = {}) => completeProfileDetails(current, profileDetailsIn(text, today), text, today);

  it("captures profile fields from a multi-fact gym question, without inventing a birth date or health conditions", () => {
    const text = "I'm 31, 102kg, 192cm tall, man, I take 1 hour walks every day, I do work from home, 27% body fat, I only take magnesum and sometimes creatine. I usually eat eveything, I have a sweet tooth. What should I take if I restart weight lifting casually in the gym, and to focus better at work.";
    expect(capture(text).profile).toEqual({ heightCm: 192, sex: "m", diet: "omnivore" });
  });

  it.each([
    "I'm 31, 192cm tall, man, what should I consider if I start the gym?",
    "I'm 1.92 m and a man. What should I consider if I start the gym?",
    "I'm a 31-year-old man and I am 192 cm tall. How can I focus at work?",
  ])("keeps stated facts separate from the question in %s", (text) => {
    expect(capture(text).profile).toEqual({ heightCm: 192, sex: "m" });
  });

  it.each([
    ["I normally follow a vegeterian diet", "vegetarian"],
    ["I usually eat everything", "omnivore"],
    ["I'm an omnivor", "omnivore"],
  ])("handles ordinary qualifiers and a single spelling error in %s", (text, diet) => {
    expect(capture(text).profile).toEqual({ diet });
  });

  it.each([
    "If I'm 192 cm, man, what would that mean?",
    "Example: \"I'm 192 cm. I'm male.\"",
    "Example: 'I'm 192 cm. I'm male.'",
    "```\nI'm 192 cm.\nI'm male.\n```",
    "> I'm 192 cm, man",
    "My brother is 192 cm, a man",
    "I'm 192 cm. Don't save this",
    "I have a sweet tooth. I have a job. I work from home",
    "I'm seeing a man",
    "I eat everything except meat",
  ])("does not manufacture personal facts from %s", (text) => {
    expect(capture(text).profile).toEqual({});
  });

  it("preserves existing profile values and rejects conflicting new heights", () => {
    expect(capture("I'm 192 cm, man", { heightCm: 180 }).profile).toEqual({ heightCm: 180, sex: "m" });
    expect(capture("I'm 180 cm. I am 192 cm").added).toEqual([]);
  });

  it.each([
    ["I have chronic kidney disease", "chronic kidney disease"],
    ["I was diagnosed with asthma", "asthma"],
  ])("records an explicit condition: %s", (text, conditions) => {
    expect(capture(text).profile).toEqual({ conditions });
  });

  it("does not treat an owned medicine as a diagnosed condition", () => {
    expect(capture("I have warfarin at home").profile).toEqual({});
  });
});
