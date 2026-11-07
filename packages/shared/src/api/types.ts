// What the page and the local server exchange over tRPC (router.ts). The server implements ApiServices;
// the page only ever imports types from here, never server code.

import type { Effort, ModelChoice, ProviderConfig, ProviderId, ProviderInfo, Region, UseCheck } from "../core/aiProviders";
import type { ClaimCheck } from "../core/claimEvidence";
import type { McpPreset } from "../core/mcpPresets";
import type { Meal } from "../core/meals";
import type { Plan } from "../core/plans";
import type { Skill } from "../core/skills";
import type { Experiment, Measurement, Profile, ProtocolEntry } from "../core/types";

export type Done = { ok: true };
export type Outcome = { ok: true } | { ok: false; error: string };

// Status and settings

export interface ServerStatus {
  app: "biomarker-tracker";
  assistant: ModelChoice;
  /** False while the default (Claude Code, Opus) is in use because nothing was saved yet. */
  chosen: boolean;
  ready: UseCheck;
}

export interface EveState {
  on: boolean;
  built: boolean;
}

export interface SettingsInfo extends ServerStatus {
  providers: readonly ProviderInfo[];
  configs: Partial<Record<ProviderId, ProviderConfig>>;
  hasKey: Record<string, boolean>;
  installed: Record<string, boolean>;
  hermesConnected: boolean;
  /** eve as the engine for API-key and local models (preview). */
  eve: EveState;
}

export interface Listed {
  id: string;
  label: string;
}

/** Models (or Hermes profiles / OpenClaw agents) loaded live rather than listed in the app. */
export interface ModelList {
  models: Listed[];
  profiles?: Listed[];
  error?: string;
}

export type LoadedModelSource = "ollama" | "lmstudio" | "hermes" | "openclaw";
export type AgentProgram = "claude-code" | "codex" | "hermes" | "openclaw";

export interface ProviderChange {
  zdrConfirmed?: boolean;
  region?: Region;
  baseURL?: string;
  profile?: string;
  /** A new key, or null to forget the saved one. */
  key?: string | null;
}

export interface ModelTest {
  ok: boolean;
  reply?: string;
  error?: string;
}

// Skills

export interface SkillListing extends Omit<Skill, "body"> {
  enabled: boolean;
}

// MCP servers

export interface McpServerConfig {
  id: string;
  name: string;
  /** Set for ready-made servers. */
  presetId?: string;
  command: string;
  args: string[];
  /** Non-secret environment values. Secret ones are in secrets.mcpEnv. */
  env: Record<string, string>;
  enabled: boolean;
}

export interface McpServerListing {
  id: string;
  name: string;
  presetId?: string;
  command: string;
  args: string[];
  enabled: boolean;
  running: boolean;
  error?: string;
  /** Which secret values are set (never the values). */
  secretsSet: string[];
  env: Record<string, string>;
}

export interface McpTest {
  ok: boolean;
  tools?: { name: string; description: string }[];
  error?: string;
}

// Profiles: one folder per person

export interface StoredFile {
  name: string;
  originalName: string;
  size: number;
  type: string;
  addedAt: string;
  /** e.g. "Lab report, 12 results imported". */
  note?: string;
}

export interface ProfileData {
  person: Profile;
  measurements: Measurement[];
  protocols: ProtocolEntry[];
  experiments: Experiment[];
  /** The Protocols page (protocols.json). */
  plans: Plan[];
  /** Meals (meals.json). */
  meals: Meal[];
  settings: Record<string, unknown>;
}

export interface ProfileSummary {
  id: string;
  person: Profile;
  createdAt: string;
  updatedAt: string;
  results: number;
  lastResult: string | null;
  files: number;
  folder: string;
}

export const PROFILE_PART_NAMES = ["person", "measurements", "protocols", "experiments", "plans", "meals", "settings"] as const;
export type ProfilePart = (typeof PROFILE_PART_NAMES)[number];

/** Data sent to create or save a profile; the server validates every part. */
export type ProfileInput = Partial<Record<ProfilePart, unknown>>;

/**
 * Everything the router needs from the server. Errors may carry an HTTP `status` (400, 404, 413…),
 * which the router passes on; any other error is a 400 with its message.
 */
export interface ApiServices {
  status(): ServerStatus;
  settings: {
    get(): Promise<SettingsInfo>;
    setEve(on: boolean): Promise<{ ok: true; eve: EveState }>;
    loadedModels(source: LoadedModelSource): Promise<ModelList>;
    openRouterModels(): Promise<ModelList>;
    connectHermes(connect: boolean): Promise<Outcome>;
    setProvider(id: string, change: ProviderChange): { ok: true; ready: UseCheck };
    setAssistant(choice: { provider: string; model: string; effort?: Effort }): { ok: true; ready: UseCheck };
    test(): Promise<ModelTest>;
  };
  /** Opens a terminal with the program maker's official install or sign-in command. */
  openAgentTerminal(id: AgentProgram, action: "install" | "signin"): Outcome;
  skills: {
    list(): SkillListing[];
    get(id: string): Skill;
    setEnabled(id: string, enabled: boolean): void;
    add(markdown: string): Skill;
    remove(id: string): void;
  };
  mcp: {
    list(): { presets: readonly McpPreset[]; servers: McpServerListing[]; npx: boolean };
    addPreset(presetId: string): McpServerConfig;
    addCustom(server: { name: string; command: string; args: string[] }): McpServerConfig;
    update(id: string, patch: { enabled?: boolean; env?: Record<string, string | null> }): Promise<void>;
    test(id: string): Promise<McpTest>;
    remove(id: string): Promise<void>;
  };
  profiles: {
    list(): { profiles: ProfileSummary[]; active: string | null; root: string };
    create(input: ProfileInput): ProfileSummary;
    setActive(id: string): void;
    data(id: string): ProfileData;
    save(id: string, input: ProfileInput): void;
    saveParts(id: string, parts: Record<string, unknown>): { written: ProfilePart[] };
    remove(id: string): { active: string | null };
    reveal(id: string): Promise<void>;
    files(id: string): StoredFile[];
    removeFile(id: string, name: string): void;
  };
  /** Checks one public claim with the configured model (long; stops when the page disconnects). */
  checkClaim(request: unknown, signal: AbortSignal): Promise<ClaimCheck>;
}
