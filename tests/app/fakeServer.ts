// A fake local server for page tests: stubs fetch and answers tRPC calls (apps/web/src/app/api.ts) in tRPC's
// own response format, so the page's real client code runs. Other URLs (file uploads, restore) go to `raw`.
import { vi } from "vitest";

export interface FakeCall {
  /** The procedure, e.g. "profiles.save". */
  path: string;
  // Inputs are inspected freely in tests.
  input: any;
  method: string;
}

/** Throw this from a handler to answer with an error and HTTP status. */
export class FakeError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

const TRPC = "/api/trpc/";

export function fakeServer(
  handle: (call: FakeCall) => unknown,
  raw: (url: string, init: RequestInit | undefined) => Response | Promise<Response> = () => Response.json({ error: "Not found." }, { status: 404 }),
) {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (!href.startsWith(TRPC)) return raw(href, init);
    const [path = "", query = ""] = href.slice(TRPC.length).split("?");
    const method = init?.method ?? "GET";
    const encoded = new URLSearchParams(query).get("input");
    const input: unknown = method === "GET" ? (encoded === null ? undefined : JSON.parse(encoded)) : init?.body ? JSON.parse(String(init.body)) : undefined;
    try {
      return Response.json({ result: { data: (await handle({ path: decodeURIComponent(path), input, method })) ?? null } });
    } catch (e) {
      const status = e instanceof FakeError ? e.status : 500;
      return Response.json(
        { error: { message: e instanceof Error ? e.message : String(e), code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: status } } },
        { status },
      );
    }
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

type ClientCall = (kind: "query" | "mutate", path: string, input?: unknown, opts?: unknown) => unknown;

/**
 * A stand-in for the page's api module (for vi.mock): `localServer.settings.get.query(input)` calls
 * `call("query", "settings.get", input)` directly, without HTTP.
 */
export function mockApiModule(call: ClientCall) {
  const at = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "query" || key === "mutate" ? (input?: unknown, opts?: unknown) => call(key, path.join("."), input, opts) : at([...path, String(key)]),
      },
    );
  return { localServer: at([]), useServerStatus: () => null };
}

/**
 * `Response.json` in tRPC's response format, for tests that stub fetch by hand: a value becomes a result;
 * with an error status, `{ error: "message" }` becomes a tRPC error with that message.
 */
export function trpcJson(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200;
  if (status < 400) return Response.json({ result: { data: body } }, init);
  const message = (body as { error?: string } | null)?.error ?? "Something went wrong.";
  return Response.json({ error: { message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: status } } }, init);
}
