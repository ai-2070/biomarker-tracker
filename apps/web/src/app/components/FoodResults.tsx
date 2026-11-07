import { closestFoods, type FoodDb, foodNameNote, searchFoods } from "@bt/shared/core/meals";

/**
 * Food search results (the meal builder and the intake analyzer). When no food has every word, it says the
 * food isn't in the table and lists the closest ones, so "blood orange juice" leads to orange juice
 * without pretending they're the same food.
 */
export function FoodResults({
  db,
  query,
  limit,
  action,
  onPick,
}: {
  db: FoodDb | undefined;
  query: string;
  limit: number;
  action: string;
  onPick: (food: { id: string; name: string }) => void;
}) {
  if (!db || query.trim().length < 2) return null;
  const exact = searchFoods(db, query, limit);
  const closest = exact.length ? [] : closestFoods(db, query, 6);
  const list = exact.length ? exact : closest;
  return (
    <div className="flex flex-col gap-2">
      {!exact.length && (
        <p className="text-sm text-ink-2">
          <span className="font-medium text-ink">“{query.trim()}” isn't in the food table</span> (CoFID, the UK's official table: 2,887 foods).
          {closest.length > 0
            ? " The closest foods it has are below. They're different foods, so pick one only if it's close enough for you."
            : " Try fewer or simpler words."}
        </p>
      )}
      {list.length > 0 && (
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-line">
          {list.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onPick(f)}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-sunken"
              >
                <span>
                  {f.name}
                  {foodNameNote(query, f.name) && <span className="mt-0.5 block text-sm text-warn">{foodNameNote(query, f.name)}</span>}
                </span>
                <span className="shrink-0 text-sm text-accent">{action}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
