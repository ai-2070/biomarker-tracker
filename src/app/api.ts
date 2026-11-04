import { useEffect, useState } from "react";

/** Calls to the app's own local server. The x-bt header marks requests from this page. */
export async function api<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(signal ? { signal } : {}),
    headers: { "content-type": "application/json", ...(method === "GET" ? {} : { "x-bt": "1" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data;
}

export interface ServerStatus {
  app: string;
  assistant: { provider: string; model: string } | null;
  ready: { ok: boolean; reason?: string };
}

/** The local server's status: `undefined` while checking, `null` when the page runs without it. */
export function useServerStatus(refreshKey = 0): ServerStatus | null | undefined {
  const [status, setStatus] = useState<ServerStatus | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api<ServerStatus>("GET", "/api/status")
      .then((s) => alive && setStatus(s.app === "biomarker-tracker" ? s : null))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return status;
}
