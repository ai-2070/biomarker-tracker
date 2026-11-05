import { currentDecisions, parseScreening, screeningInput, screeningPrompt, type Classified, type Decision, type Question, type ScreeningMode } from "@bt/core/evidenceMap";

/** Screen only missing/current-input decisions. Process and persistence boundaries are injectable for offline fixtures. */
export async function screenOutcome({ question, reviews, mode, previous, by, ask, onBatch, today = () => new Date().toISOString().slice(0, 10) }: {
  question: Question;
  reviews: readonly Classified[];
  mode: ScreeningMode;
  previous: readonly Decision[];
  by: string;
  ask: (prompt: string) => Promise<string>;
  onBatch: (decisions: Decision[]) => void;
  today?: () => string;
}): Promise<Decision[]> {
  const done = new Map(currentDecisions(question, reviews, mode, previous).map((d) => [d.pmid, d]));
  const todo = reviews.filter((r) => r.pmid && !done.has(r.pmid));
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    // A short/malformed reply stays incomplete, not implicitly approved. Retry only missing IDs.
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = batch.filter((r) => !done.has(r.pmid!));
      if (pending.length === 0) break;
      const got = parseScreening(await ask(screeningPrompt(question, pending, mode)), pending.map((r) => r.pmid!));
      for (const d of got) {
        const r = pending.find((r) => r.pmid === d.pmid)!;
        done.set(d.pmid, { ...d, input: screeningInput(question, r, mode), by, at: today() });
      }
    }
    onBatch([...done.values()]);
  }
  return [...done.values()];
}
