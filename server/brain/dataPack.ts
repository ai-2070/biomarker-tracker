// The person's data as text, for agent programs that can't call the app's tools (OpenClaw, or Hermes before
// it is connected). Same numbers the tools give, computed by the app.
import { WEEKDAYS } from "../../src/core/plans";
import { biologicalAge, experimentResults, logOverview, resultsOverview, testSummaryFor, type HealthSnapshot } from "../healthTools";

/** The user's data as text, for agents that can't call the app's tools. Same numbers the tools give. */
export function dataPack(snapshot: HealthSnapshot): string {
  return JSON.stringify(
    {
      results: resultsOverview(snapshot),
      latestTestSummary: testSummaryFor(snapshot),
      biologicalAge: biologicalAge(snapshot),
      ...logOverview(snapshot),
      experiments: experimentResults(snapshot),
      meals: (snapshot.meals ?? []).map((m) => ({ name: m.name, foods: m.items.length })),
      protocols: (snapshot.plans ?? []).map((p) => ({ name: p.name, running: p.active ? `since ${p.active.since}` : "not started", items: p.items.map((i) => ({ label: i.label, amount: i.amount ?? null, when: i.when, days: i.days?.length ? i.days : WEEKDAYS, withFood: i.withFood ?? false, note: i.note ?? null })) })),
    },
    null,
    1,
  );
}
