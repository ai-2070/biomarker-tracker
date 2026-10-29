import { useEffect, useState } from "react";
import type { ExampleMeal, FoodDb } from "../core/meals";
import examples from "../../knowledge/meals/examples.json";

/**
 * The full food table (every CoFID 2021 food, ~470 KB) is loaded only when a meal is opened, not with
 * the rest of the app. Bundled with the app; nothing is fetched from outside.
 */
let pending: Promise<FoodDb> | undefined;
let loaded: FoodDb | undefined;

export function loadFoodDb(): Promise<FoodDb> {
  pending ??= import("../../knowledge/foods/cofid-all.json").then((m) => (loaded = m.default as unknown as FoodDb));
  return pending;
}

export function useFoodDb(): FoodDb | undefined {
  const [db, setDb] = useState<FoodDb | undefined>(loaded);
  useEffect(() => {
    if (!loaded) void loadFoodDb().then(setDb);
  }, []);
  return db;
}

export const EXAMPLE_MEALS: readonly ExampleMeal[] = (examples as { meals: ExampleMeal[] }).meals;
