import { describe, expect, it } from "vitest";
import { parseBackup } from "@bt/shared/core/backup";
import { assistantProfile, initials, profileSummary } from "@bt/shared/core/profile";
import { safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import type { Profile } from "@bt/shared/core/types";

const anna: Profile = {
  name: "Anna Kovacs",
  sex: "f",
  birthMonth: "1984-04",
  heightCm: 168,
  heightUnit: "ft/in",
  diet: "vegetarian",
  smoking: "never",
  conditions: "hypothyroidism; chronic kidney disease",
  allergies: "penicillin",
  notes: "Private",
};

describe("profile", () => {
  it("never gives the assistant the name or private notes", () => {
    const p = assistantProfile(anna);
    expect(p).not.toHaveProperty("name");
    expect(p).not.toHaveProperty("notes");
    expect(p.diet).toBe("vegetarian");
  });

  it("keeps every profile field through a backup, trimmed, and rejects bad values", () => {
    const base = { app: "biomarker-tracker", version: 2, measurements: [] };
    const r = parseBackup({ ...base, profile: { ...anna, name: "  Anna Kovacs ", allergies: "  " } });
    expect(r.ok && r.backup.profile).toEqual({ ...anna, allergies: undefined, name: "Anna Kovacs" } as Profile);
    expect(r.ok && "allergies" in r.backup.profile).toBe(false);
    expect(parseBackup({ ...base, profile: { heightCm: 900 } }).ok).toBe(false);
    expect(parseBackup({ ...base, profile: { heightUnit: "yards" } }).ok).toBe(false);
    expect(parseBackup({ ...base, profile: { diet: "carnivore" } }).ok).toBe(false);
  });

  it("makes initials and a short summary", () => {
    expect(initials("Anna Kovacs")).toBe("AK");
    expect(initials("anna")).toBe("AN");
    expect(initials("")).toBe("?");
    expect(initials("Sam (example)")).toBe("SA");
    expect(initials("  Dr. O'Neil  ")).toBe("DO");
    expect(profileSummary(anna, "2026-10-28")).toBe("42 years, female");
    expect(profileSummary({}, "2026-10-28")).toBe("");
  });

  it("checks conditions written in the profile for safety notes, with the ongoing log", () => {
    const labels = safetyLabels([{ id: "1", label: "Warfarin", category: "medication", start: "2025-01-01" }, { id: "2", label: "Metformin", category: "medication", start: "2020-01-01", end: "2021-01-01" }], anna);
    expect(labels).toEqual(["Warfarin", "hypothyroidism", "chronic kidney disease"]);
    expect(safetyNotes(labels).map((n) => n.id).sort()).toEqual(["anticoagulant", "kidney"]);
  });
});
