import type { ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { useServerStatus } from "../api";
import { McpSettings } from "../components/settings/McpSettings";
import { ModelsSettings } from "../components/settings/ModelsSettings";
import { SkillsSettings } from "../components/settings/SkillsSettings";
import { Notice, PageTitle } from "../components/ui";
import { href, type SettingsTab } from "../router";
import { DataSettings } from "./DataPage";

const TABS: { value: SettingsTab; label: ReactNode }[] = [
  { value: "data", label: "Your data" },
  { value: "models", label: "AI models" },
  { value: "skills", label: "Skills" },
  { value: "mcp", label: <>MCP<span className="hidden sm:inline"> servers</span></> },
];

const SUBTITLE: Record<SettingsTab, string> = {
  data: "Your results and log are stored only in this browser on this device.",
  models: "Choose the model the assistant uses.",
  skills: "Step-by-step instructions the assistant follows for research tasks.",
  mcp: "Extra research tools the assistant can use.",
};

/** Without the local server, the AI tabs explain how to start it. */
function NeedsServer({ children }: { children: ReactNode }) {
  const status = useServerStatus();
  if (status === undefined) return <p className="text-ink-2">Checking…</p>;
  if (status === null)
    return (
      <Notice tone="warn" title="The assistant's server isn't running">
        AI settings are kept by the app's small local server. Start the app with <span className="font-mono text-sm">bun run start</span> and open the
        address it shows. Tracking, charts and biological age work without it.
      </Notice>
    );
  return <>{children}</>;
}

export function SettingsPage({ tab = "data" }: { tab?: SettingsTab }) {
  return (
    <>
      <PageTitle sub={SUBTITLE[tab]}>Settings</PageTitle>
      <Tabs.Root value={tab} onValueChange={(v) => (location.hash = href({ name: "data", tab: v as SettingsTab }))}>
        <Tabs.List className="relative mb-6 flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((t) => (
            <Tabs.Tab
              key={t.value}
              value={t.value}
              className="-mb-px flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-2 text-[15px] whitespace-nowrap text-ink-2 sm:px-3 sm:text-base transition-colors hover:text-ink data-active:border-accent data-active:font-semibold data-active:text-accent"
            >
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="data">
          <DataSettings />
        </Tabs.Panel>
        <Tabs.Panel value="models">
          <NeedsServer>
            <ModelsSettings />
          </NeedsServer>
        </Tabs.Panel>
        <Tabs.Panel value="skills">
          <NeedsServer>
            <SkillsSettings />
          </NeedsServer>
        </Tabs.Panel>
        <Tabs.Panel value="mcp">
          <NeedsServer>
            <McpSettings />
          </NeedsServer>
        </Tabs.Panel>
      </Tabs.Root>
    </>
  );
}
