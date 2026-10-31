const words = (text: string): string[] => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];

/** Search catalogue names without inventing guide content or searchable health claims. */
export function searchKnowledgeNames<T extends { name: string }>(entries: readonly T[], query: string): readonly T[] {
  const terms = words(query);
  if (!terms.length) return entries;
  return entries.filter(({ name }) => {
    const nameWords = words(name);
    return terms.every((term) => nameWords.some((word) => word.startsWith(term)));
  });
}
