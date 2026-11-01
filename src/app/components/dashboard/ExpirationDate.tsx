import { lazy, Suspense } from "react";
import { todayIso } from "../../../core/dates";
import { ageAtMoment, tableFor } from "../../../core/lifeTable";
import { isBirthMonth } from "../../../core/phenoageDraws";
import type { Measurement, Profile } from "../../../core/types";
import { useLifeTables } from "../../lifeTables";
import { Card } from "../ui";

const BestBefore = lazy(() => import("./bestBefore").then((module) => ({ default: module.BestBefore })));

/** Mounted only when enabled; the public country reference has its own independent position. */
export function ExpirationDate({ profile, measurements }: { profile: Profile; measurements: readonly Measurement[] }) {
  const { file, failed } = useLifeTables();
  const found = file ? tableFor(file, profile.country, profile.sex) : undefined;
  const age = profile.birthMonth && isBirthMonth(profile.birthMonth)
    ? ageAtMoment(profile.birthMonth, Date.parse(`${todayIso()}T00:00:00Z`)) : undefined;
  const loading = <Card className="flex flex-col gap-2"><h2 className="font-serif text-2xl">Expiration date</h2><p className="text-ink-2" role="status">Loading the optional expiration-date view…</p></Card>;
  if (!file || !found || age === undefined || !Number.isFinite(age) || age < 0) {
    return <Card className="flex flex-col gap-2"><h2 className="font-serif text-2xl">Expiration date</h2><p className="text-ink-2" role="status">{!file ? failed ? "The country life tables could not be loaded. Reload the page to try again." : "Loading country life tables…" : "Complete the missing profile details in Country population reference below to see this view."}</p></Card>;
  }
  return <Suspense fallback={loading}><BestBefore profile={profile} measurements={measurements} found={found} /></Suspense>;
}
