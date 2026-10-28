// MCP servers in the agent and team pickers. A service added more than once (several accounts) shows each
// copy by its label ("OOMOL: Work"), next to the service's other copies, with what it is for on hover.
import type { McpServerInfo } from '../shared/types.ts';

type Info = Record<string, McpServerInfo> | undefined;

/** Chips for these servers: copies of a service together, each by its label, with its "use for" as the hover text. */
export function mcpOptions(servers: readonly string[], info: Info): { value: string; label: string; title?: string }[] {
  const kind = (s: string) => info?.[s]?.kind || s;
  const first = new Map<string, number>();
  servers.forEach((s, i) => first.has(kind(s)) || first.set(kind(s), i));
  return [...servers]
    .sort((a, b) => first.get(kind(a))! - first.get(kind(b))!)
    .map((s) => {
      const i = info?.[s];
      const title = i?.useFor ? `Use for: ${i.useFor}` : i && i.copies > 1 ? `One of your ${i.copies} ${i.service} accounts` : undefined;
      return { value: s, label: i?.title || s, ...(title ? { title } : {}) };
    });
}

/** What to tell you when an agent or team holds several accounts of one service and some have no "use for" ('' when fine). */
export function copiesWarning(picked: readonly string[], info: Info): string {
  if (!info) return '';
  const byKind = new Map<string, string[]>();
  for (const s of new Set(picked)) if (info[s]) byKind.set(info[s].kind, [...(byKind.get(info[s].kind) || []), s]);
  const bare = [...byKind.values()].filter((l) => l.length > 1).flat().filter((s) => !info[s].useFor);
  if (!bare.length) return '';
  const names = bare.map((s) => info[s].title);
  return `${names.join(' and ')} ${bare.length > 1 ? 'have' : 'has'} no "use for" line, so it can't tell its ${info[bare[0]].service} accounts apart. Say what each is for on the MCP servers page.`;
}
