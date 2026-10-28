// Naming an agent so the server finds the right one: "Name", or "Name [id]" when the name is shared.
// list_agents shows the same "Name [id]" form, and ask_agent reads it back.

interface Named {
  id: string;
  name: string;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "Name", or "Name [id]" when another agent has the same name. */
export function agentRef(agent: Named, all: readonly Named[]): string {
  return all.some((a) => a.id !== agent.id && same(a.name, agent.name)) ? `${agent.name} [${agent.id}]` : agent.name;
}

/** The agent a name, an id or "Name [id]" points to. Exact names beat partial ones; when more than
 *  one fits, it says so rather than guessing. */
export function findAgent<T extends Named>(all: readonly T[], ref: string): { agent: T } | { error: string } {
  const r = String(ref || '').trim();
  const byId = all.find((a) => a.id === r) || all.find((a) => a.id === /\[([^\]\s]+)\]$/.exec(r)?.[1]);
  if (byId) return { agent: byId };
  const q = r.toLowerCase();
  const exact = all.filter((a) => same(a.name, r));
  const fits = exact.length ? exact : q ? all.filter((a) => a.name.toLowerCase().includes(q)) : [];
  if (fits.length === 1) return { agent: fits[0] };
  if (!fits.length) return { error: `No agent called "${r}".` };
  return { error: `More than one agent fits "${r}": ${fits.map((a) => `${a.name} [${a.id}]`).join(', ')}. Use the id.` };
}
