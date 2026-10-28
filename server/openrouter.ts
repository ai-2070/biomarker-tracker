// OpenRouter: one key, many models. Every request asks for zero-data-retention routing.
// https://openrouter.ai/docs (provider routing: zdr, data_collection)

/** Added to every request body: only endpoints that keep nothing and don't collect data. */
export const ZDR_ROUTING = { zdr: true, data_collection: "deny" } as const;

/** A fetch that adds ZDR_ROUTING to each JSON request body (any routing the SDK set is kept, ours wins), plus `extra` (e.g. effort). */
export function zdrFetch(base: typeof fetch = fetch, extra: Record<string, unknown> = {}): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (init && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const provider = typeof body.provider === "object" && body.provider !== null ? body.provider : {};
        Object.assign(body, extra);
        body.provider = { ...provider, ...ZDR_ROUTING };
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        /* not JSON: send as is */
      }
    }
    return base(input, init);
  }) as typeof fetch;
}

interface ZdrEndpoint {
  model_id?: string;
}
interface OrModel {
  id?: string;
  name?: string;
  supported_parameters?: string[];
}

let cache: { at: number; list: { id: string; label: string }[] } | null = null;

/** Models that have at least one zero-retention endpoint and can use tools. Public lists, no key needed. */
export async function openRouterModels(fetchFn: typeof fetch = fetch): Promise<{ id: string; label: string }[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.list;
  const get = async <T>(url: string) => {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`OpenRouter answered ${r.status}.`);
    return ((await r.json()) as { data?: T[] }).data ?? [];
  };
  const [zdr, models] = await Promise.all([get<ZdrEndpoint>("https://openrouter.ai/api/v1/endpoints/zdr"), get<OrModel>("https://openrouter.ai/api/v1/models")]);
  const withZdr = new Set(zdr.map((e) => e.model_id).filter((x): x is string => typeof x === "string"));
  const list = models
    .filter((m): m is OrModel & { id: string } => typeof m.id === "string" && !m.id.includes(":") && withZdr.has(m.id) && !!m.supported_parameters?.includes("tools"))
    .map((m) => ({ id: m.id, label: m.name ?? m.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  cache = { at: Date.now(), list };
  return list;
}
