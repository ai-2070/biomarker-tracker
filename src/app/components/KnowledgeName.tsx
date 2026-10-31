/** A catalogue name, not a guide link or an evidence-backed recommendation. */
export function KnowledgeName({ name }: { name: string }) {
  return <li className="rounded-xl border border-line bg-surface p-4"><h2 className="font-serif text-2xl font-normal">{name}</h2></li>;
}
