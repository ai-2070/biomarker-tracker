import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { useServerStatus } from "../api";
import { AboutSettings } from "../components/settings/AboutSettings";
import { AppearanceSettings } from "../components/settings/AppearanceSettings";
import { McpSettings } from "../components/settings/McpSettings";
import { ModelsSettings } from "../components/settings/ModelsSettings";
import { SkillsSettings } from "../components/settings/SkillsSettings";
import { Notice, PageTitle } from "../components/ui";
import { useProfiles } from "../profiles";
import { href, type SettingsTab } from "../router";
import { DataSettings } from "./DataPage";

const TABS: { value: SettingsTab; label: ReactNode }[] = [
  { value: "data", label: "Your data" },
  { value: "models", label: "AI models" },
  { value: "skills", label: "Skills" },
  {
    value: "mcp",
    label: (
      <>
        MCP<span className="hidden sm:inline">&nbsp;servers</span>
      </>
    ),
  },
  { value: "appearance", label: "Appearance" },
  { value: "about", label: "About" },
];

const SUBTITLE: Record<SettingsTab, string> = {
  data: "Your results and log are stored only in this browser on this device.",
  models: "Choose the model the assistant uses.",
  skills: "Step-by-step instructions the assistant follows for research tasks.",
  mcp: "Extra research tools the assistant can use.",
  appearance: "How the app looks on this device.",
  about: "The project, its version and where the code lives.",
};

/** Without the local server, the AI tabs explain how to start it. */
function NeedsServer({ children }: { children: ReactNode }) {
  const status = useServerStatus();
  if (status === undefined) return <p className="text-ink-2">Checking…</p>;
  if (status === null)
    return (
      <Notice tone="warn" title="The assistant's server isn't running">
        AI settings are kept by the app's small local server. Start the app with <span className="font-mono text-sm">bun run start</span> and open the address
        it shows. Tracking, charts and biological age work without it.
      </Notice>
    );
  return <>{children}</>;
}

export function SettingsPage({ tab = "data" }: { tab?: SettingsTab }) {
  const { mode } = useProfiles();
  const sub =
    tab === "data" && mode === "folders" ? "This profile's details, files and backups. Everything is kept in its folder on this computer." : SUBTITLE[tab];
  return (
    <>
      <PageTitle sub={sub}>Settings</PageTitle>
      <Tabs.Root value={tab} onValueChange={(v) => (location.hash = href({ name: "data", tab: v as SettingsTab }))}>
        <Tabs.List className="relative mb-6 flex gap-1 overflow-x-auto border-b border-line [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] sm:[mask-image:none]">
          {TABS.map((t) => (
            <Tabs.Tab
              key={t.value}
              value={t.value}
              className="flex min-h-11 shrink-0 items-center px-2 text-[15px] whitespace-nowrap text-ink-2 transition-colors duration-200 hover:text-ink data-active:font-semibold data-active:text-accent sm:px-3 sm:text-base"
            >
              {t.label}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator className="absolute bottom-0 left-0 h-0.5 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] rounded-full bg-accent transition-[translate,width] duration-300 ease-[var(--ease-soft)]" />
        </Tabs.List>
        <Tabs.Panel value="data" className="animate-fade">
          <DataSettings />
        </Tabs.Panel>
        <Tabs.Panel value="models" className="animate-fade">
          <NeedsServer>
            <ModelsSettings />
          </NeedsServer>
        </Tabs.Panel>
        <Tabs.Panel value="skills" className="animate-fade">
          <NeedsServer>
            <SkillsSettings />
          </NeedsServer>
        </Tabs.Panel>
        <Tabs.Panel value="mcp" className="animate-fade">
          <NeedsServer>
            <McpSettings />
          </NeedsServer>
        </Tabs.Panel>
        <Tabs.Panel value="appearance" className="animate-fade">
          <AppearanceSettings />
        </Tabs.Panel>
        <Tabs.Panel value="about" className="animate-fade">
          <AboutSettings />
        </Tabs.Panel>
      </Tabs.Root>
    </>
  );
}
