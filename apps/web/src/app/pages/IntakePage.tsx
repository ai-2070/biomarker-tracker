import { EXAMPLE_DAY, type IntakeItem, MAX_INTAKE_ITEMS, validateIntakeItems } from "@bt/shared/core/intake";
import { safetyLabels, safetyNotes } from "@bt/shared/core/protocols";
import type { SafetyId } from "@bt/shared/core/types";
import { useState } from "react";

import { newId } from "../../db/db";
import { Analysis } from "../components/intake/Analysis";
import { ListEditor } from "../components/intake/ListEditor";
import { SafetyNotices } from "../components/SafetyNotices";
import { Button, Card, Notice, PageTitle } from "../components/ui";
import { useFoodDb } from "../foodDb";
import { setIntakeList, useAllMeasurements, useIntakeList, useMeals, useProfile, useProtocols } from "../hooks";

export function IntakePage() {
  const db = useFoodDb();
  const meals = useMeals() ?? [];
  const list = useIntakeList();
  const [saveError, setSaveError] = useState("");
  const profile = useProfile();
  const all = useAllMeasurements() ?? [];
  const protocols = useProtocols() ?? [];
  const notes = safetyNotes(safetyLabels(protocols, profile));
  const safety: SafetyId[] = notes.map((n) => n.id);
  const items = list ?? [];
  const save = (next: IntakeItem[]) => {
    const errors = validateIntakeItems(next);
    const repairingOversize = next.length > MAX_INTAKE_ITEMS && next.length < items.length && next.every((item) => validateIntakeItems([item]).length === 0);
    if (errors.length && !repairingOversize) {
      setSaveError(`Cannot save this list: ${errors.join("; ")}. Remove an item before adding another.`);
      return;
    }
    setSaveError("");
    void setIntakeList(next).catch(() => setSaveError("Could not save the list. Please try again."));
  };

  return (
    <>
      <PageTitle sub="Put in what someone eats in a day, from your meals or the food table, and see it added up and compared with EU reference values for a whole day. An analysis, not a diary, a target or a diet.">
        Daily intake analyzer
      </PageTitle>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col gap-5">
          <ListEditor items={items} db={db} meals={meals} save={save} />
          {saveError && <Notice tone="warn">{saveError}</Notice>}
          {items.length > MAX_INTAKE_ITEMS && (
            <Notice tone="warn">
              This saved list has {items.length} items; the limit is {MAX_INTAKE_ITEMS}. Your entries are still here. Remove items until it is within the limit
              before adding or changing anything.
            </Notice>
          )}
          {notes.length > 0 && <SafetyNotices notes={notes} />}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {!db ? (
            <p className="text-ink-2">Loading the food table…</p>
          ) : items.length === 0 ? (
            <Card className="flex flex-col items-start gap-3">
              <p className="text-ink-2">
                Add meals or foods to see the totals, how they compare with the reference values, and what would add the most where something is low.
              </p>
              <Button variant="secondary" onClick={() => save(EXAMPLE_DAY.map(([foodId, grams]) => ({ id: newId(), kind: "food" as const, foodId, grams })))}>
                Try an example day
              </Button>
            </Card>
          ) : (
            <Analysis items={items} db={db} profile={profile} all={all} safety={safety} />
          )}
        </div>
      </div>
    </>
  );
}
