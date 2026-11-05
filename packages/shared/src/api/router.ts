// The page ↔ local server API (tRPC). Inputs are checked here; the server supplies the work (ApiServices).
// The page imports only `type AppRouter`, so none of this runs in the browser.
// Not here: Brain's streamed answers (/api/assistant), file uploads/downloads, backups, /mcp and /eve-bridge,
// which stay plain HTTP in apps/server/http.ts.
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { PROFILE_PART_NAMES, type ApiServices } from "./types";

export interface ApiContext {
  services: ApiServices;
}

const CODES = { 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 500: "INTERNAL_SERVER_ERROR" } as const;

/** A thrown error's HTTP status (ProfileError, HttpError…), as a tRPC code; other errors are bad requests. */
export function errorCode(error: unknown): TRPCError["code"] {
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status: unknown }).status : undefined;
  return typeof status === "number" && status in CODES ? CODES[status as keyof typeof CODES] : "BAD_REQUEST";
}

const t = initTRPC.context<ApiContext>().create({
  // Never send server stack traces to the page.
  isDev: false,
  // Messages are shown to people: invalid input gets a plain sentence, never a list of schema issues.
  errorFormatter: ({ shape, error }) =>
    error.code === "BAD_REQUEST" && error.cause instanceof z.ZodError
      ? { ...shape, message: "Some details in this request aren't valid. Reload the page and try again." }
      : shape,
});

/** Passes the server's own errors on with their status and message. */
const procedure = t.procedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok && !(result.error.cause instanceof z.ZodError) && result.error.cause) {
    const cause = result.error.cause;
    if (!(cause instanceof TRPCError)) throw new TRPCError({ code: errorCode(cause), message: cause.message, cause });
  }
  return result;
});

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/);
/** A profile's parts; the server validates each one (profiles.ts). */
const profileInput = z.object(Object.fromEntries(PROFILE_PART_NAMES.map((part) => [part, z.unknown()]))).partial() as z.ZodType<Partial<Record<typeof PROFILE_PART_NAMES[number], unknown>>>;
const ok = { ok: true } as const;

export const appRouter = t.router({
  status: procedure.query(({ ctx }) => ctx.services.status()),

  settings: t.router({
    get: procedure.query(({ ctx }) => ctx.services.settings.get()),
    /** Switching eve off stops its runtime. */
    setEve: procedure.input(z.object({ on: z.boolean() })).mutation(({ ctx, input }) => ctx.services.settings.setEve(input.on)),
    loadedModels: procedure
      .input(z.object({ source: z.enum(["ollama", "lmstudio", "hermes", "openclaw"]) }))
      .query(({ ctx, input }) => ctx.services.settings.loadedModels(input.source)),
    openRouterModels: procedure.query(({ ctx }) => ctx.services.settings.openRouterModels()),
    /** Adds or removes the app's tools in Hermes' own MCP settings (only when the person presses the button). */
    connectHermes: procedure.input(z.object({ connect: z.boolean() })).mutation(({ ctx, input }) => ctx.services.settings.connectHermes(input.connect)),
    setProvider: procedure
      .input(z.object({
        id: z.string().max(40),
        zdrConfirmed: z.boolean().optional(),
        region: z.enum(["EU", "US"]).optional(),
        baseURL: z.string().max(300).optional(),
        profile: z.string().max(80).optional(),
        key: z.string().max(1000).nullable().optional(),
      }))
      .mutation(({ ctx, input: { id: provider, ...change } }) => ctx.services.settings.setProvider(provider, change)),
    setAssistant: procedure
      .input(z.object({ provider: z.string().max(20), model: z.string().max(120), effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional() }))
      .mutation(({ ctx, input }) => ctx.services.settings.setAssistant(input)),
    test: procedure.mutation(({ ctx }) => ctx.services.settings.test()),
  }),

  agents: t.router({
    openTerminal: procedure
      .input(z.object({ id: z.enum(["claude-code", "codex", "hermes", "openclaw"]), action: z.enum(["install", "signin"]) }))
      .mutation(({ ctx, input }) => ctx.services.openAgentTerminal(input.id, input.action)),
  }),

  skills: t.router({
    list: procedure.query(({ ctx }) => ({ skills: ctx.services.skills.list() })),
    get: procedure.input(z.object({ id })).query(({ ctx, input }) => ctx.services.skills.get(input.id)),
    setEnabled: procedure.input(z.object({ id, enabled: z.boolean() })).mutation(({ ctx, input }) => {
      ctx.services.skills.setEnabled(input.id, input.enabled);
      return ok;
    }),
    add: procedure.input(z.object({ markdown: z.string().max(60_000) })).mutation(({ ctx, input }) => ({ skill: ctx.services.skills.add(input.markdown) })),
    remove: procedure.input(z.object({ id })).mutation(({ ctx, input }) => {
      ctx.services.skills.remove(input.id);
      return ok;
    }),
  }),

  mcp: t.router({
    list: procedure.query(({ ctx }) => ctx.services.mcp.list()),
    addPreset: procedure.input(z.object({ presetId: z.string().max(60) })).mutation(({ ctx, input }) => ({ server: ctx.services.mcp.addPreset(input.presetId) })),
    addCustom: procedure
      .input(z.object({ name: z.string().max(60), command: z.string().max(300), args: z.array(z.string().max(1000)).max(30) }))
      .mutation(({ ctx, input }) => ({ server: ctx.services.mcp.addCustom(input) })),
    update: procedure
      .input(z.object({ id, enabled: z.boolean().optional(), env: z.record(z.string(), z.string().max(4000).nullable()).optional() }))
      .mutation(async ({ ctx, input: { id: server, ...patch } }) => {
        await ctx.services.mcp.update(server, patch);
        return ok;
      }),
    test: procedure.input(z.object({ id })).mutation(({ ctx, input }) => ctx.services.mcp.test(input.id)),
    remove: procedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
      await ctx.services.mcp.remove(input.id);
      return ok;
    }),
  }),

  profiles: t.router({
    list: procedure.query(({ ctx }) => ctx.services.profiles.list()),
    create: procedure.input(profileInput).mutation(({ ctx, input }) => ({ profile: ctx.services.profiles.create(input) })),
    setActive: procedure.input(z.object({ id: z.string().max(60) })).mutation(({ ctx, input }) => {
      ctx.services.profiles.setActive(input.id);
      return ok;
    }),
    data: procedure.input(z.object({ id })).query(({ ctx, input }) => ctx.services.profiles.data(input.id)),
    save: procedure.input(z.object({ id, data: profileInput })).mutation(({ ctx, input }) => {
      ctx.services.profiles.save(input.id, input.data);
      return ok;
    }),
    /** Only the parts that changed since the page's last acknowledged save. */
    saveParts: procedure
      .input(z.object({ id, parts: z.record(z.string(), z.unknown()) }))
      .mutation(({ ctx, input }) => ({ ok: true as const, ...ctx.services.profiles.saveParts(input.id, input.parts) })),
    remove: procedure.input(z.object({ id })).mutation(({ ctx, input }) => ({ ok: true as const, ...ctx.services.profiles.remove(input.id) })),
    reveal: procedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
      await ctx.services.profiles.reveal(input.id);
      return ok;
    }),
    files: procedure.input(z.object({ id })).query(({ ctx, input }) => ({ files: ctx.services.profiles.files(input.id) })),
    removeFile: procedure.input(z.object({ id, name: z.string().max(300) })).mutation(({ ctx, input }) => {
      ctx.services.profiles.removeFile(input.id, input.name);
      return ok;
    }),
  }),

  /** The server checks the request strictly (public topics only, no personal data). */
  claimEvidence: t.router({
    check: procedure.input(z.unknown()).mutation(({ ctx, input, signal }) => ctx.services.checkClaim(input, signal ?? new AbortController().signal)),
  }),
});

export type AppRouter = typeof appRouter;
