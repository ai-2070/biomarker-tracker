// The eve runtime is a thin shell: everything Brain needs (rules, tools, the model) lives in the main server,
// reached over 127.0.0.1 with a token that changes every time the runtime starts (apps/server/eve/bridge.ts).
// API keys, zero-retention routing and the app's checks therefore stay in one place.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ToolInfo {
  name: string;
  description: string;
  /** JSON Schema of the tool's input, as the main server's tool defines it. */
  inputSchema: { [key: string]: Json };
}

export interface Configuration {
  /** Rules that are the same for every question (prompt cache). */
  stable: string;
  /** This question's part: critical results, cautions, the date. Empty when there is nothing. */
  request: string;
  modelId: string;
  contextWindow: number;
  tools: ToolInfo[];
}

/** POST to the main server's bridge. Refuses anything but the configured local address. */
export async function bridgeFetch(operation: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const origin = process.env.BT_EVE_BRIDGE_URL;
  const token = process.env.BT_EVE_BRIDGE_TOKEN;
  if (!origin || !token) throw new Error("The Biomarker Tracker bridge is not configured.");
  const url = new URL(operation.replace(/^\//, ""), origin.endsWith("/") ? origin : `${origin}/`);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== new URL(origin).origin)
    throw new Error("The Biomarker Tracker bridge must be local.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    redirect: "error",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const message = typeof detail.error === "string" ? detail.error : detail.error?.message;
    throw new Error(message ?? `The Biomarker Tracker bridge refused the request (${response.status}).`);
  }
  return response;
}

export async function bridgeJson<T>(operation: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return (await (await bridgeFetch(operation, body, signal)).json()) as T;
}

/** The question this session answers (set by the channel's auth from the main server's request). */
export function runOf(ctx: { session: { auth: { current?: { attributes?: Readonly<Record<string, unknown>> } | null } } }): string {
  const run = ctx.session.auth.current?.attributes?.run;
  if (typeof run !== "string" || !run) throw new Error("This session belongs to no Brain question.");
  return run;
}

export function configuration(run: string, signal?: AbortSignal): Promise<Configuration> {
  return bridgeJson<Configuration>("/configuration", { run }, signal);
}
