// Calls the local server's tRPC API over real HTTP, as the page does (apps/web/src/app/api.ts).
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "@bt/shared/api/router";

/** A typed client for a server on this port; the x-bt header is sent unless other headers are given. */
export const trpcClient = (port: number, headers: Record<string, string> = { "x-bt": "1" }) =>
  createTRPCClient<AppRouter>({ links: [httpLink({ url: `http://127.0.0.1:${port}/api/trpc`, headers })] });

/** The HTTP status a call ended with: 200, or the error's status (400, 403, 404…). */
export async function statusOf(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 200;
  } catch (e) {
    if (e instanceof TRPCClientError) return (e.data as { httpStatus?: number } | undefined)?.httpStatus ?? (e.meta?.response as Response | undefined)?.status ?? 0;
    throw e;
  }
}

/** One raw tRPC request, for checks the typed client can't make (missing headers, malformed input). */
export function rawCall(port: number, path: string, opts: { input?: unknown; mutation?: boolean; headers?: Record<string, string> } = {}): Promise<Response> {
  const base = `http://127.0.0.1:${port}/api/trpc/${path}`;
  if (!opts.mutation) return fetch(`${base}${opts.input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(opts.input))}`}`, { headers: opts.headers ?? {} });
  return fetch(base, { method: "POST", headers: { "content-type": "application/json", ...(opts.headers ?? { "x-bt": "1" }) }, body: JSON.stringify(opts.input ?? {}) });
}
