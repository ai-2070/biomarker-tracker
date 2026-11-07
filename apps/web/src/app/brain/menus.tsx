import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { EFFORT_LABEL, GROUP_LABEL, PROVIDERS, canUse, modelEfforts, providerInfo, type Effort, type ModelChoice, type ProviderConfig, type ProviderInfo } from "@bt/shared/core/aiProviders";
import { localServer } from "../api";
import { OnOff } from "../components/settings/SkillsSettings";
import { ToolsIcon } from "../components/icons";
import { CheckIcon, ChevronDownIcon, cx, eyebrowSmallStyles } from "../components/ui";
import { href, type SettingsTab } from "../router";
import { closeBrain } from "./store";

export interface BrainSettings {
  configs: Partial<Record<string, ProviderConfig>>;
  hasKey: Record<string, boolean>;
  installed: Record<string, boolean>;
  assistant: ModelChoice;
  ready: { ok: boolean; reason?: string };
}

/** The server's model settings: `undefined` while loading, `null` when the page runs without the local server. */
// Kept between openings, so Brain shows the model straight away (and is refreshed in the background).
let lastSettings: BrainSettings | null | undefined;

export function useBrainSettings(active: boolean): { settings: BrainSettings | null | undefined; fresh: boolean; reload: () => void } {
  const [settings, setSettings] = useState<BrainSettings | null | undefined>(lastSettings);
  const [request, setRequest] = useState({ active });
  const [loaded, setLoaded] = useState<typeof request>();
  if (request.active !== active) setRequest({ active });
  useEffect(() => {
    if (!request.active) return;
    let alive = true;
    localServer.settings.get.query()
      .then((s) => {
        if (!alive) return;
        lastSettings = s;
        setSettings(s);
        setLoaded(request);
      })
      .catch(() => {
        if (!alive) return;
        setSettings(null);
        setLoaded(request);
      });
    return () => { alive = false; };
  }, [request]);
  return { settings, fresh: active && request.active === active && loaded === request, reload: useCallback(() => setRequest({ active: true }), []) };
}

/** Leaves Brain for a settings tab (to set up a model, skills or sources). */
export function goToSettings(tab: SettingsTab): void {
  closeBrain();
  location.hash = href({ name: "data", tab });
}

export function modelLabel(choice: ModelChoice | undefined): string {
  if (!choice) return "No model";
  const info = providerInfo(choice.provider);
  const model = info?.models.find((m) => m.id === choice.model)?.label ?? (choice.model || "default model");
  return `${info?.label ?? choice.provider} · ${model.replace(/ \(fastest\)$/, "")}`;
}

/** Providers that can answer right now: installed programs, keys with zero retention confirmed. */
function usableProviders(s: BrainSettings): ProviderInfo[] {
  return PROVIDERS.filter((p) => {
    if (p.models.length === 0 && !(p.id === s.assistant.provider)) return false; // loaded lists are chosen in Settings
    if (p.kind === "agent" && !s.installed[p.id]) return false;
    const probe = { provider: p.id, model: p.models[0]?.id ?? s.assistant.model };
    return canUse(probe, s.configs[p.id], !!s.hasKey[p.id]).ok;
  });
}

const popupStyles =
  "z-[60] flex max-h-[min(520px,var(--available-height))] w-80 max-w-[calc(100vw-1.5rem)] origin-[var(--transform-origin)] flex-col overflow-y-auto rounded-xl border border-line bg-surface p-1.5 text-ink shadow-lg outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";
const chipStyles =
  "flex min-h-9 max-w-full min-w-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink-2 transition-colors duration-150 hover:bg-sunken hover:text-ink data-popup-open:bg-sunken data-popup-open:text-ink";
const sectionLabel = cx("px-2.5 pt-2 pb-1", eyebrowSmallStyles);

function MenuShell({ trigger, label, children }: { trigger: ReactNode; label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className={chipStyles} aria-label={label}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-[60] outline-none">
          <Popover.Popup className={popupStyles}>{children}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Which model answers, and how hard it thinks. Saved to the app's settings. */
export function ModelMenu({ settings, onChange }: { settings: BrainSettings; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const current = settings.assistant;
  const info = providerInfo(current.provider);
  const efforts = modelEfforts(current.provider, current.model);
  const providers = usableProviders(settings);

  async function choose(choice: ModelChoice) {
    setError(null);
    try {
      await localServer.settings.setAssistant.mutate(choice);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the model.");
    }
  }

  return (
    <MenuShell
      label={`Model: ${modelLabel(current)}. Change`}
      trigger={
        <>
          <span className="truncate">{modelLabel(current)}</span>
          {current.effort && <span className="shrink-0 rounded bg-sunken px-1 font-mono text-[11px]">{EFFORT_LABEL[current.effort]}</span>}
          <ChevronDownIcon className="size-3.5 shrink-0" />
        </>
      }
    >
      <Popover.Title className="px-2.5 pt-1.5 pb-1 text-sm font-medium">Brain thinks with</Popover.Title>
      {providers.length === 0 && <p className="px-2.5 py-2 text-sm text-ink-2">No model is set up yet.</p>}
      {(["agent", "api", "local"] as const).map((group) => {
        const list = providers.filter((p) => p.group === group);
        if (list.length === 0) return null;
        return (
          <div key={group} className="flex flex-col">
            <p className={sectionLabel}>{GROUP_LABEL[group]}</p>
            {list.map((p) => {
              const header = (
                <p key={`${p.id}-label`} className="flex items-baseline gap-2 px-2.5 pt-1.5 pb-0.5 text-[13px] text-ink-2">
                  <span className="font-medium text-ink">{p.label}</span>
                  {p.retention === "depends" && <span className="text-[11px]">depends on your login</span>}
                </p>
              );
              const models = p.models.length > 0 ? p.models : [{ id: current.provider === p.id ? current.model : "", label: current.provider === p.id && current.model ? current.model : "Its default model" }];
              return [header, ...models.map((m) => {
                const on = current.provider === p.id && current.model === m.id;
                return (
                  <button
                    key={`${p.id}/${m.id}`}
                    type="button"
                    aria-pressed={on}
                    onClick={() => void choose({ provider: p.id, model: m.id, ...(p.id === current.provider && current.effort ? { effort: current.effort } : {}) })}
                    className={cx("flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-sunken", on && "font-medium")}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-accent">{on && <CheckIcon />}</span>
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                  </button>
                );
              })];
            })}
          </div>
        );
      })}
      {info && efforts.length > 0 && (
        <div className="mt-1 border-t border-line pt-1">
          <p className={sectionLabel}>Effort</p>
          <div role="group" aria-label="Effort" className="flex flex-wrap gap-1 px-1.5 pb-1.5">
            {([undefined, ...efforts] as (Effort | undefined)[]).map((e) => {
              const on = current.effort === e;
              return (
                <button
                  key={e ?? "default"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => void choose({ provider: current.provider, model: current.model, ...(e ? { effort: e } : {}) })}
                  className={cx(
                    "min-h-8 rounded-md border px-2 text-xs transition-colors",
                    on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink-2 hover:bg-sunken hover:text-ink",
                  )}
                >
                  {e ? EFFORT_LABEL[e] : "Default"}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="px-2.5 py-1.5 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-1 border-t border-line pt-1">
        <button type="button" onClick={() => goToSettings("models")} className="flex min-h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-accent hover:bg-sunken">
          Set up more models (API keys, OpenRouter, local)…
        </button>
      </div>
    </MenuShell>
  );
}

interface SkillRow {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}
interface ServerRow {
  id: string;
  name: string;
  enabled: boolean;
  running: boolean;
  error?: string;
}

/** Skills Brain may follow and the research sources (MCP servers) it may search. Switches save right away. */
export function ToolsMenu({ active }: { active: boolean }) {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [servers, setServers] = useState<ServerRow[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    localServer.skills.list.query().then((r) => alive && setSkills(r.skills), () => alive && setSkills([]));
    localServer.mcp.list.query().then((r) => alive && setServers(r.servers), () => alive && setServers([]));
    return () => {
      alive = false;
    };
  }, [active, tick]);

  const skillsOn = skills?.filter((s) => s.enabled).length ?? 0;
  const serversOn = servers?.filter((s) => s.enabled).length ?? 0;

  async function toggle(kind: "skill" | "server", id: string, enabled: boolean) {
    await (kind === "skill" ? localServer.skills.setEnabled.mutate({ id, enabled }) : localServer.mcp.update.mutate({ id, enabled })).catch(() => undefined);
    setTick((t) => t + 1);
  }

  return (
    <MenuShell
      label={`Skills and research sources: ${skillsOn} skills, ${serversOn} sources on. Change`}
      trigger={
        <>
          <ToolsIcon className="size-4 shrink-0" />
          <span className="truncate">
            {skillsOn} skills · {serversOn} sources
          </span>
        </>
      }
    >
      <Popover.Title className="px-2.5 pt-1.5 pb-1 text-sm font-medium">What Brain can use</Popover.Title>
      <p className={sectionLabel}>Skills</p>
      {skills?.length === 0 && <p className="px-2.5 pb-1 text-sm text-ink-2">No skills yet.</p>}
      {skills?.map((s) => (
        <div key={s.id} className="flex items-center gap-3 rounded-lg px-2.5 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{s.name}</p>
            {s.description && <p className="line-clamp-1 text-xs text-ink-2">{s.description}</p>}
          </div>
          <OnOff checked={s.enabled} onChange={(v) => void toggle("skill", s.id, v)} label={`Use the skill ${s.name}`} />
        </div>
      ))}
      <p className={cx(sectionLabel, "mt-1 border-t border-line pt-2")}>Research sources</p>
      {servers?.length === 0 && <p className="px-2.5 pb-1 text-sm text-ink-2">None added.</p>}
      {servers?.map((s) => (
        <div key={s.id} className="flex items-center gap-3 rounded-lg px-2.5 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{s.name}</p>
            <p className={cx("text-xs", s.error ? "text-warn" : "text-ink-2")}>{!s.enabled ? "Off" : s.error ? "Couldn't start" : s.running ? "Ready" : "Starts when needed"}</p>
          </div>
          <OnOff checked={s.enabled} onChange={(v) => void toggle("server", s.id, v)} label={`Search ${s.name}`} />
        </div>
      ))}
      <div className="mt-1 flex flex-col border-t border-line pt-1">
        <button type="button" onClick={() => goToSettings("skills")} className="flex min-h-10 items-center rounded-lg px-2.5 text-left text-sm text-accent hover:bg-sunken">
          Add or write skills…
        </button>
        <button type="button" onClick={() => goToSettings("mcp")} className="flex min-h-10 items-center rounded-lg px-2.5 text-left text-sm text-accent hover:bg-sunken">
          Add research sources…
        </button>
      </div>
    </MenuShell>
  );
}
