import { FoodArt } from "./FoodArt";
import { cardStyles, cx } from "./ui";

/** A catalogue name, not a guide link or an evidence-backed recommendation. */
export function KnowledgeName({ name }: { name: string }) {
  return (
    <li className={cx("relative min-h-24 p-4", cardStyles)}>
      <h2 className="pr-20 font-serif text-2xl font-normal">{name}</h2>
      <FoodArt name={name} />
    </li>
  );
}
