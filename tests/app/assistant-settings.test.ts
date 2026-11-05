import { beforeEach, expect, it, vi } from "vitest";
import type * as React from "react";
import type { ReactElement, ReactNode } from "react";
import { PROVIDERS } from "@bt/core/aiProviders";

// A synchronous hook host exercises these components' actual state/effect logic without a DOM dependency.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], dirty: false, api: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof React>(),
  useState: (initial: unknown) => {
    const index = host.cursor++;
    if (!(index in host.slots)) host.slots[index] = typeof initial === "function" ? initial() : initial;
    return [host.slots[index], (next: unknown) => {
      const value = typeof next === "function" ? next(host.slots[index]) : next;
      if (!Object.is(value, host.slots[index])) { host.slots[index] = value; host.dirty = true; }
    }];
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = host.cursor++;
    const previous = host.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
    host.effects.push(() => {
      previous?.cleanup?.();
      host.slots[index] = { deps, cleanup: effect() };
    });
  },
  useCallback: (callback: unknown) => callback,
}));
vi.mock("../../apps/web/src/app/api", () => ({ api: host.api }));
vi.mock("../../apps/web/src/app/brain/store", () => ({ closeBrain: vi.fn() }));
import { ModelsSettings } from "../../apps/web/src/app/components/settings/ModelsSettings";
import { useBrainSettings } from "../../apps/web/src/app/brain/menus";

function render<T>(component: () => T): T {
  let result!: T;
  let passes = 0;
  do {
    if (++passes > 30) throw new Error("Hook state did not settle");
    host.dirty = false;
    host.cursor = 0;
    result = component();
    for (const effect of host.effects.splice(0)) effect();
  } while (host.dirty);
  return result;
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}
function button(tree: ReactNode, text: string) {
  const match = elements(tree).find((element) => element.props.children === text && typeof element.props.onClick === "function");
  expect(match, `button ${text}`).toBeDefined();
  return match!;
}
const settings = {
  providers: PROVIDERS, configs: { ollama: { baseURL: "http://127.0.0.1:11434/v1" } },
  hasKey: {}, installed: {}, hermesConnected: false, assistant: { provider: "ollama", model: "old" }, chosen: true, ready: { ok: true },
};

beforeEach(() => {
  for (const slot of host.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
  host.slots = []; host.effects = []; host.cursor = 0; host.dirty = false;
  host.api.mockReset();
});

it("blocks saved-only testing for an edited connection and reloads discovery after saving", async () => {
  let current = structuredClone(settings);
  let models = [{ id: "old", label: "Old endpoint model" }];
  host.api.mockImplementation(async (method: string, path: string, body?: { baseURL: string }) => {
    if (path === "/api/settings/models/ollama") return { models };
    if (method === "PUT" && path.endsWith("/ollama")) {
      current.configs.ollama = { baseURL: body!.baseURL.trim() };
      models = [{ id: "new", label: "New endpoint model" }];
    }
    return structuredClone(current);
  });
  render(ModelsSettings);
  await Promise.resolve();
  let tree = render(ModelsSettings);
  await Promise.resolve();
  tree = render(ModelsSettings);
  expect(button(tree, "Test").props.disabled).toBe(false);
  const address = elements(tree).find((e) => e.props.value === "http://127.0.0.1:11434/v1" && typeof e.props.onValueChange === "function")!;
  (address.props.onValueChange as (v: string) => void)("  http://127.0.0.1:21434/v1  ");
  tree = render(ModelsSettings);
  expect(button(tree, "Test").props.disabled).toBe(true);
  (button(tree, "Save").props.onClick as () => void)();
  // Each awaited boundary is a settled mocked HTTP request, not a clock-based wait.
  for (let i = 0; i < 6; i++) { await Promise.resolve(); tree = render(ModelsSettings); }
  const picker = elements(tree).find((e) => {
    const loaded = e.props.loaded;
    return !!loaded && typeof loaded === "object" && "models" in loaded && Array.isArray(loaded.models)
      && loaded.models.some((model) => model && typeof model === "object" && "id" in model && model.id === "new");
  });
  expect(picker).toBeDefined();
  expect(button(tree, "Test").props.disabled).toBe(false);
  expect(elements(tree).some((e) => e.props.value === "http://127.0.0.1:21434/v1")).toBe(true);
  expect(host.api.mock.calls.filter((call) => call[1] === "/api/settings/models/ollama")).toHaveLength(2);
});

it("does not treat a replacement API key as saved", async () => {
  host.api.mockResolvedValue({ ...settings, configs: { openai: { region: "US", zeroDataRetention: true } }, hasKey: { openai: true }, assistant: { provider: "openai", model: "gpt-5.4" } });
  render(ModelsSettings);
  await Promise.resolve();
  let tree = render(ModelsSettings);
  const key = elements(tree).find((e) => e.props.type === "password")!;
  expect(key).toBeDefined();
  (key.props.onValueChange as (v: string) => void)("replacement-secret");
  tree = render(ModelsSettings);
  expect(button(tree, "Test").props.disabled).toBe(true);
  expect(host.api.mock.calls.some((call) => call[1] === "/api/settings/test")).toBe(false);
});

it("requires a fresh settings reply for every opening, including cached readiness", async () => {
  let resolve!: (value: typeof settings) => void;
  host.api.mockResolvedValueOnce(settings);
  let result = render(() => useBrainSettings(true));
  expect(result.fresh).toBe(false);
  await Promise.resolve();
  result = render(() => useBrainSettings(true));
  expect(result.fresh).toBe(true);
  render(() => useBrainSettings(false));
  host.api.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  result = render(() => useBrainSettings(true));
  expect(result.settings?.ready.ok).toBe(true); // cached display remains useful
  expect(result.fresh).toBe(false); // but cannot consume a pending question
  resolve({ ...settings, ready: { ok: false } });
  await Promise.resolve();
  result = render(() => useBrainSettings(true));
  expect(result.fresh).toBe(true);
  expect(result.settings?.ready.ok).toBe(false);
});
