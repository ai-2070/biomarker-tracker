import { cardStyles, cx } from "./ui";

/** A catalogue name, not a guide link or an evidence-backed recommendation. */
export function KnowledgeName({ name }: { name: string }) {
  return (
    <li className={cx("p-4", cardStyles)}>
      <h2 className="font-serif text-2xl font-normal">{name}</h2>
    </li>
  );
}
