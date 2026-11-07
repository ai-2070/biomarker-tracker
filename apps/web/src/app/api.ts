import type { AppRouter } from "@bt/shared/api/router";
import type { ServerStatus } from "@bt/shared/api/types";
import { createTRPCClient, httpLink } from "@trpc/client";
import { useEffect, useState } from "react";

export type { ServerStatus };

/**
 * The app's own local server (tRPC, @bt/shared/api/router). One call per request; the x-bt header marks
 * requests from this page (the server refuses changes without it).
 */
export const localServer = createTRPCClient<AppRouter>({
  links: [httpLink({ url: "/api/trpc", headers: { "x-bt": "1" } })],
});

/** The local server's status: `undefined` while checking, `null` when the page runs without it. */
export function useServerStatus(refreshKey = 0): ServerStatus | null | undefined {
  const [status, setStatus] = useState<ServerStatus | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    localServer.status
      .query()
      .then((s) => alive && setStatus(s.app === "biomarker-tracker" ? s : null))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return status;
}
