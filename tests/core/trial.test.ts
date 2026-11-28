import { addDays } from "@bt/shared/core/dates";
import { trialAfterFrom, trialReadiness, trialRetestDays } from "@bt/shared/core/trial";
import { describe, expect, it } from "vitest";
import { def, measurement, withVariation } from "../helpers";

const today = "2026-11-28";
const at = (biomarkerId: string, date: string, value = 3) => measurement({ biomarkerId, date, value });

describe("try one change", () => {
  it("needs three before results without published variation, one with it", () => {
    // LDL has a published value in the app; without it, three results are needed on each side.
    const { biologicalVariation: _bv, ...ldl } = def("ldl");
    expect(def("ldl").biologicalVariation).toBeDefined();
    const ms = [at("ldl", "2026-09-01"), at("ldl", "2026-10-01"), at("ldl", "2026-01-01"), at("hdl", "2026-11-01")];
    // The January result is older than 120 days: two count.
    expect(trialReadiness(ldl, ms, today, today)).toMatchObject({ before: 2, need: 3, ready: false });
    expect(trialReadiness(withVariation(ldl, 8), ms, today, today)).toMatchObject({ before: 2, need: 1, ready: true });
    // A planned start counts results up to that day.
    expect(trialReadiness(ldl, [...ms, at("ldl", "2026-11-20")], addDays(today, 14), today)).toMatchObject({ before: 3, ready: true });
    // A "<" result isn't an exact value and doesn't count.
    expect(trialReadiness(ldl, [measurement({ biomarkerId: "ldl", date: "2026-11-01", value: 1, qualifier: "<" })], today, today).before).toBe(0);
  });

  it("re-tests after 4 weeks with daily readings, else 8 (12 for HbA1c)", () => {
    const daily = Array.from({ length: 25 }, (_, i) => at("weight", addDays(today, -i), 70));
    const weight = def("weight");
    expect(trialRetestDays(weight, trialReadiness(weight, daily, today, today))).toBe(28);
    expect(trialRetestDays(def("ldl"), { recent: 0 })).toBe(56);
    expect(trialRetestDays(def("hba1c"), { recent: 0 })).toBe(84);
    expect(trialAfterFrom("2026-11-28", 28)).toBe("2026-12-26");
  });
});
