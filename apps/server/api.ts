// What the page's tRPC calls do (the router and its input checks are in @bt/shared/api/router).

import type { ApiServices } from "@bt/shared/api/types";
import { isLocalUrl, modelEfforts, PROVIDERS, type ProviderId, providerInfo } from "@bt/shared/core/aiProviders";
import { MCP_PRESETS } from "@bt/shared/core/mcpPresets";
import { generateText } from "ai";
import { agentInstalled, hermesConnected, hermesProfiles, isAgent, openclawAgents, setHermesConnection, testAgent } from "./agents";
import { checkClaimEvidence } from "./claimEvidence";
import { eveBuilt, stopEve } from "./eve/host";
import * as mcp from "./mcp";
import { assistantCheck, currentChoice, describeModelError, readyModel } from "./models";
import { openRouterModels } from "./openrouter";
import * as profiles from "./profiles";
import { addSkill, deleteSkill, getSkill, listSkills, setSkillEnabled } from "./skills";
import { getSecrets, getSettings, updateSecrets, updateSettings } from "./store";
import { openAgentSignIn, openTerminal } from "./terminal";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const providerOf = (id: string): ProviderId => {
  if (!providerInfo(id)) throw new HttpError(404, "Unknown provider.");
  return id as ProviderId;
};

const status = () => {
  const s = getSettings();
  return { app: "biomarker-tracker" as const, assistant: currentChoice(), chosen: !!s.assistant, ready: assistantCheck() };
};

export const services: ApiServices = {
  status,

  settings: {
    async get() {
      const s = getSettings();
      const keys = getSecrets().keys;
      return {
        ...status(),
        providers: PROVIDERS,
        configs: s.providers,
        hasKey: Object.fromEntries(PROVIDERS.map((p) => [p.id, !!keys[p.id]])),
        installed: Object.fromEntries(PROVIDERS.filter((p) => p.kind === "agent").map((p) => [p.id, agentInstalled(p.id)])),
        hermesConnected: await hermesConnected(),
        eve: { on: s.eve === true, built: eveBuilt() },
      };
    },

    async setEve(on) {
      if (on && !eveBuilt()) throw new HttpError(400, "The eve runtime isn't built on this computer. Run `bun run eve:build` first.");
      updateSettings((s) => {
        if (on) s.eve = true;
        else delete s.eve;
      });
      if (!on) await stopEve();
      return { ok: true, eve: { on, built: eveBuilt() } };
    },

    async loadedModels(source) {
      if (source === "hermes") return { models: [], profiles: await hermesProfiles() };
      if (source === "openclaw") return { models: [], profiles: await openclawAgents() };
      const info = providerInfo(source)!;
      const base = (getSettings().providers[info.id]?.baseURL?.trim() || info.defaultBaseURL || "").replace(/\/+$/, "");
      try {
        if (!isLocalUrl(new URL(base))) return { models: [], error: `${info.label} must run on this computer.` };
        const r = await fetch(`${base}/models`, { signal: AbortSignal.timeout(4000) });
        const j = (await r.json()) as { data?: { id?: unknown }[] };
        return { models: (j.data ?? []).filter((m) => typeof m.id === "string").map((m) => ({ id: String(m.id), label: String(m.id) })) };
      } catch {
        return { models: [], error: `${info.label} isn't running, or isn't at ${base}. Start it, then reload this page.` };
      }
    },

    async openRouterModels() {
      try {
        return { models: await openRouterModels() };
      } catch (e) {
        return { models: [], error: `Couldn't load OpenRouter's model list: ${e instanceof Error ? e.message : String(e)}` };
      }
    },

    async connectHermes(connect) {
      const r = await setHermesConnection(connect);
      return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Couldn't change Hermes' settings." };
    },

    setProvider(id, change) {
      const p = providerOf(id);
      updateSettings((s) => {
        const c = { ...(s.providers[p] ?? {}) };
        if (change.zdrConfirmed !== undefined) c.zdrConfirmed = change.zdrConfirmed;
        if (change.region) c.region = change.region;
        if (change.baseURL !== undefined) c.baseURL = change.baseURL.trim().slice(0, 300);
        if (change.profile !== undefined) c.profile = change.profile.trim().slice(0, 80);
        s.providers[p] = c;
      });
      if (change.key !== undefined) {
        const key = change.key?.trim() ?? "";
        updateSecrets((s) => {
          if (key) s.keys[p] = key;
          else delete s.keys[p];
        });
      }
      return { ok: true, ready: assistantCheck() };
    },

    setAssistant({ provider: id, model: rawModel, effort }) {
      const provider = providerOf(id);
      const model = rawModel.trim();
      if (!model && !providerInfo(provider)?.modelOptional) throw new HttpError(400, "Choose a model.");
      if (effort !== undefined && !modelEfforts(provider, model).includes(effort)) throw new HttpError(400, "This model doesn't support that effort level.");
      updateSettings((s) => (s.assistant = { provider, model, ...(effort ? { effort } : {}) }));
      return { ok: true, ready: assistantCheck() };
    },

    async test() {
      const s = getSettings();
      const choice = currentChoice();
      if (isAgent(choice.provider)) {
        const check = assistantCheck();
        if (!check.ok) return { ok: false, error: check.reason };
        return testAgent(choice.provider, choice.model, s.providers[choice.provider]?.profile, choice.effort);
      }
      const r = readyModel();
      if (!r.ok) return { ok: false, error: r.reason };
      try {
        const res = await generateText({
          model: r.ready.model,
          prompt: "Reply with the single word OK.",
          maxOutputTokens: 200,
          providerOptions: r.ready.providerOptions,
          abortSignal: AbortSignal.timeout(60_000),
        });
        return { ok: true, reply: res.text.slice(0, 100) };
      } catch (e) {
        return { ok: false, error: describeModelError(e) };
      }
    },
  },

  /** Fixed commands only: the program maker's official installer or sign-in. */
  openAgentTerminal(id, action) {
    const info = providerInfo(id)!;
    if (action === "signin") return openAgentSignIn(info.id);
    const cmd = process.platform === "win32" ? info.install!.windows : info.install!.unix;
    return openTerminal(`Install ${info.label}`, cmd);
  },

  skills: {
    list: listSkills,
    get(id) {
      const s = getSkill(id);
      if (!s) throw new HttpError(404, "No skill with that name.");
      return s;
    },
    setEnabled: setSkillEnabled,
    add: addSkill,
    remove: deleteSkill,
  },

  mcp: {
    list: () => ({ presets: MCP_PRESETS, servers: mcp.listServers(), npx: mcp.hasNpx() }),
    addPreset: mcp.addPreset,
    addCustom: mcp.addCustom,
    update: mcp.updateServer,
    async test(id) {
      try {
        return { ok: true, ...(await mcp.testServer(id)) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    remove: mcp.removeServer,
  },

  profiles: {
    list: () => ({ profiles: profiles.listProfiles(), active: profiles.activeProfile(), root: profiles.PROFILES() }),
    create(input) {
      const created = profiles.createProfile(input);
      profiles.setActiveProfile(created.id);
      return created;
    },
    setActive: profiles.setActiveProfile,
    data: profiles.getProfileData,
    save: profiles.saveProfileData,
    saveParts: profiles.saveProfileParts,
    remove(id) {
      profiles.deleteProfile(id);
      return { active: profiles.activeProfile() };
    },
    reveal: profiles.revealFolder,
    files: profiles.listFiles,
    removeFile: profiles.deleteFile,
  },

  checkClaim: (request, signal) => checkClaimEvidence(request, { signal }),
};
