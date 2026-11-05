/**
 * Which AI providers the assistant may use (CLAUDE.md: EU/US zero-data-retention
 * providers, local models, or agent CLIs the user runs with their own login, which
 * are clearly labelled because the app can't check what they keep). Pure and tested; the server enforces it before
 * every request, the settings page uses it to explain why something is off.
 *
 * Order matters: agent programs first, then API-key providers, then models on this computer.
 * Model names checked 2026-10-28 (Claude Code aliases from `claude --help`; API names from the providers' lists).
 */

export type ProviderId = "anthropic" | "openai" | "mistral" | "openrouter" | "custom" | "ollama" | "lmstudio" | "claude-code" | "codex" | "hermes" | "openclaw";
export type Region = "EU" | "US";

/** How hard the model thinks before answering. More effort: slower, more thorough, costs more. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

/** The group a provider is listed under. */
export type ProviderGroup = "agent" | "api" | "local";
export const GROUP_LABEL: Record<ProviderGroup, string> = {
  agent: "Programs on this computer (your own login)",
  api: "With an API key",
  local: "Models running on this computer",
};

/** Official install and sign-in for an agent program, from its maker's documentation. */
export interface InstallInfo {
  /** Windows PowerShell. */
  windows: string;
  /** macOS and Linux. */
  unix: string;
  /** What to run once afterwards to sign in or choose a model. */
  signIn: string;
  /** What signing in means, in plain words. */
  signInNote: string;
  docs: string;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** "api": the app calls the model. "agent": the app runs an agent program installed on this computer. */
  kind: "api" | "agent";
  group: ProviderGroup;
  /** Where requests are processed. "choose": the user says (custom endpoints). "depends": the agent's own setup. */
  region: Region | "local" | "choose" | "depends";
  /**
   * "local": nothing leaves the computer. "agreement": ZDR must be enabled on the user's account.
   * "enforced": the app asks for zero-retention routing on every request (OpenRouter).
   * "depends": an agent with its own login; the app can't check, so it says so.
   */
  retention: "local" | "agreement" | "enforced" | "depends";
  /** What the user has to have arranged with the provider, in plain words. */
  zdrNote: string;
  needsKey: boolean;
  /** Agents: the command that runs them. */
  command?: string;
  install?: InstallInfo;
  /** Whether the model may stay empty (the program's own default). */
  modelOptional?: boolean;
  /** Agents: what the "profile" field means (Hermes profile, OpenClaw agent), if used. */
  profileLabel?: string;
  /** OpenAI-compatible base URL, when the provider uses one. */
  defaultBaseURL?: string;
  /** Models to choose from; any model name can also be typed. Empty: the list is loaded (OpenRouter, local) or free text. */
  models: { id: string; label: string }[];
  /** "loaded": the server fetches the list (OpenRouter, Ollama, LM Studio, Hermes profiles). */
  modelList?: "loaded";
  /** Effort levels this provider accepts; none: no effort setting. */
  efforts: Effort[];
}

const AGENT_NOTE = "This is an agent program on your computer that uses its own login. The app can't check what that service keeps.";

const CLAUDE_MODELS = [
  { id: "opus", label: "Claude Opus 5.5" },
  { id: "sonnet", label: "Claude Sonnet 5.5" },
  { id: "haiku", label: "Claude Haiku 5.5 (fastest)" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
];
const OPENAI_MODELS = [
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
  { id: "gpt-6.1-terra-pro", label: "GPT-6.1 Terra Pro" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { id: "gpt-6.1-sol-pro", label: "GPT-6.1 Sol Pro" },
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
  { id: "gpt-6-astra", label: "GPT-6 Astra" },
];

export const PROVIDERS: readonly ProviderInfo[] = [
  // ---- Agent programs (your own login) ----
  {
    id: "claude-code",
    label: "Claude Code",
    kind: "agent",
    group: "agent",
    region: "depends",
    retention: "depends",
    zdrNote: `${AGENT_NOTE} With a Claude Pro or Max login, Anthropic keeps chats for 30 days, or longer if you allow training. With an API key on a zero-data-retention organization, nothing is kept.`,
    needsKey: false,
    command: "claude",
    install: {
      windows: "irm https://claude.ai/install.ps1 | iex",
      unix: "curl -fsSL https://claude.ai/install.sh | bash",
      signIn: "claude",
      signInNote: "Start it once and sign in with your Claude account in the browser (Pro, Max, Team or Console). Then close it.",
      docs: "https://code.claude.com/docs/en/setup",
    },
    modelOptional: true,
    models: CLAUDE_MODELS,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "codex",
    label: "Codex",
    kind: "agent",
    group: "agent",
    region: "depends",
    retention: "depends",
    zdrNote: `${AGENT_NOTE} With a ChatGPT login, OpenAI's consumer terms apply and chats are kept. With an API key on a zero-data-retention organization, nothing is kept.`,
    needsKey: false,
    command: "codex",
    install: {
      windows: "irm https://chatgpt.com/codex/install.ps1 | iex",
      unix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      signIn: "codex",
      signInNote: 'Start it once and choose "Sign in with ChatGPT" (Plus, Pro, Business, Edu or Enterprise). Then close it.',
      docs: "https://github.com/openai/codex",
    },
    modelOptional: true,
    models: OPENAI_MODELS,
    efforts: ["low", "medium", "high"],
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    kind: "agent",
    group: "agent",
    region: "depends",
    retention: "depends",
    zdrNote: `${AGENT_NOTE} Hermes uses the model and provider of the profile you pick; what is kept depends on that provider.`,
    needsKey: false,
    command: "hermes",
    install: {
      windows: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
      unix: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
      signIn: "hermes setup",
      signInNote: "The setup asks which provider and model Hermes should use, and how to sign in to it.",
      docs: "https://hermes-agent.nousresearch.com/docs/",
    },
    modelOptional: true,
    profileLabel: "Hermes profile",
    models: [],
    modelList: "loaded",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    kind: "agent",
    group: "agent",
    region: "depends",
    retention: "depends",
    zdrNote: `${AGENT_NOTE} OpenClaw uses the model and provider of the agent you pick; what is kept depends on that provider.`,
    needsKey: false,
    command: "openclaw",
    install: {
      windows: "iwr -useb https://openclaw.ai/install.ps1 | iex",
      unix: "curl -fsSL https://openclaw.ai/install.sh | bash",
      signIn: "openclaw onboard",
      signInNote: "The installer starts the setup by itself; it checks that OpenClaw can reach a model. Run this only if you skipped it.",
      docs: "https://github.com/openclaw/openclaw",
    },
    modelOptional: true,
    profileLabel: "OpenClaw agent",
    models: [],
    efforts: ["low", "medium", "high"],
  },

  // ---- API key ----
  {
    id: "anthropic",
    label: "Anthropic (Claude API)",
    kind: "api",
    group: "api",
    region: "US",
    retention: "agreement",
    zdrNote: "Your Anthropic organization needs a zero-data-retention agreement. Without one, Anthropic keeps requests for a limited time.",
    needsKey: true,
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest)" },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
    ],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "api",
    group: "api",
    region: "US",
    retention: "agreement",
    zdrNote: "Zero data retention must be approved for your OpenAI organization. The app also asks OpenAI not to store responses.",
    needsKey: true,
    models: OPENAI_MODELS,
    efforts: ["low", "medium", "high"],
  },
  {
    id: "mistral",
    label: "Mistral (EU)",
    kind: "api",
    group: "api",
    region: "EU",
    retention: "agreement",
    zdrNote: "Zero data retention must be enabled for your Mistral organization.",
    needsKey: true,
    models: [
      { id: "mistral-large-latest", label: "Mistral Large 4" },
      { id: "mistral-medium-latest", label: "Mistral Medium 3.5" },
      { id: "mistral-small-latest", label: "Mistral Small 4 (fastest)" },
    ],
    efforts: ["low", "high"],
  },
  {
    id: "openrouter",
    label: "OpenRouter (many models)",
    kind: "api",
    group: "api",
    region: "US",
    retention: "enforced",
    zdrNote:
      "Every request asks OpenRouter to use only providers with zero data retention and no data collection. OpenRouter is in the US; the provider it picks may be elsewhere.",
    needsKey: true,
    defaultBaseURL: "https://openrouter.ai/api/v1",
    // The full list comes from OpenRouter (models with zero-retention endpoints and tool use).
    models: [],
    modelList: "loaded",
    efforts: ["low", "medium", "high"],
  },
  {
    id: "custom",
    label: "Other (OpenAI-compatible endpoint)",
    kind: "api",
    group: "api",
    region: "choose",
    retention: "agreement",
    zdrNote: "Only use an endpoint in the EU or US that keeps no data, for example your organization's own deployment.",
    needsKey: true,
    models: [],
    efforts: [],
  },

  // ---- On this computer ----
  {
    id: "ollama",
    label: "Ollama",
    kind: "api",
    group: "local",
    region: "local",
    retention: "local",
    zdrNote: "Runs on this computer. Nothing is sent anywhere.",
    needsKey: false,
    defaultBaseURL: "http://localhost:11434/v1",
    models: [],
    modelList: "loaded",
    efforts: [],
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    kind: "api",
    group: "local",
    region: "local",
    retention: "local",
    zdrNote: "Runs on this computer. Nothing is sent anywhere.",
    needsKey: false,
    defaultBaseURL: "http://localhost:1234/v1",
    models: [],
    modelList: "loaded",
    efforts: [],
  },
];

/** What the assistant uses until the person chooses something else. */
export const DEFAULT_CHOICE: ModelChoice = { provider: "claude-code", model: "opus" };

export const providerInfo = (id: string): ProviderInfo | undefined => PROVIDERS.find((p) => p.id === id);

/** What the user set for one provider. The key is stored separately and never sent to the page. */
export interface ProviderConfig {
  /** The user confirms their account has zero data retention (cloud providers). */
  zdrConfirmed?: boolean;
  /** For "custom": where the endpoint processes requests. */
  region?: Region;
  baseURL?: string;
  /** Agents: Hermes profile or OpenClaw agent id. Empty = the agent's default. */
  profile?: string;
}

export interface ModelChoice {
  provider: ProviderId;
  model: string;
  /** Unset: the provider's own default. */
  effort?: Effort;
}

export type UseCheck = { ok: true } | { ok: false; reason: string };

/** The same loopback policy is used for eligibility and local model discovery. */
export const isLocalUrl = (u: URL): boolean => u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";

// Matches the installed Mistral SDK's modelsWithoutReasoningEffort capability gate.
const MISTRAL_WITHOUT_EFFORT: Readonly<Record<string, true | undefined>> = {
  "codestral-2508": true, "codestral-latest": true, "ministral-14b-2512": true, "ministral-14b-latest": true,
  "ministral-3b-2512": true, "ministral-3b-latest": true, "ministral-8b-2512": true, "ministral-8b-latest": true,
  "mistral-code-fim-latest": true, "mistral-code-latest": true, "mistral-large-latest": true, "mistral-large-2512": true,
  "voxtral-small-2507": true, "voxtral-small-latest": true,
};

/** Only offer effort when the selected model's transport supports it. */
export function modelEfforts(provider: string, model: string): readonly Effort[] {
  if (provider === "mistral" && Object.hasOwn(MISTRAL_WITHOUT_EFFORT, model)) return [];
  return providerInfo(provider)?.efforts ?? [];
}

/** Can the assistant send a request with this provider and settings? */
export function canUse(choice: ModelChoice | undefined, config: ProviderConfig | undefined, hasKey: boolean): UseCheck {
  if (!choice) return { ok: false, reason: "Choose a model for the assistant first." };
  const info = providerInfo(choice.provider);
  if (!info) return { ok: false, reason: "Unknown provider." };
  if (!choice.model.trim() && !info.modelOptional) return { ok: false, reason: "Choose a model." };
  if (choice.effort && !modelEfforts(choice.provider, choice.model).includes(choice.effort)) return { ok: false, reason: `${info.label} doesn't support the effort level "${choice.effort}" for this model.` };
  const c = config ?? {};

  // Agents: installed-or-not is checked by the server; their profile name goes on a command line.
  if (info.kind === "agent") {
    if (c.profile && !/^[\w.:-]{1,80}$/.test(c.profile)) return { ok: false, reason: `The ${info.profileLabel ?? "profile"} name can only use letters, numbers, dots, dashes and colons.` };
    if (choice.model && !/^[\w./:@-]{1,120}$/.test(choice.model)) return { ok: false, reason: "The model name has characters that aren't allowed." };
    return { ok: true };
  }

  const base = c.baseURL?.trim() || info.defaultBaseURL;
  if (info.retention === "local") {
    // A "local" provider pointed at another machine is not local any more.
    try {
      if (base && !isLocalUrl(new URL(base))) return { ok: false, reason: `${info.label} must run on this computer (localhost).` };
    } catch {
      return { ok: false, reason: "The address isn't a valid URL." };
    }
    return { ok: true };
  }

  if (info.needsKey && !hasKey) return { ok: false, reason: `Add your ${info.label} API key.` };
  if (info.retention === "enforced") return { ok: true };
  const region = info.region === "choose" ? c.region : info.region;
  if (region !== "EU" && region !== "US") return { ok: false, reason: "Only providers in the EU or US can be used. Choose the endpoint's region." };
  if (!c.zdrConfirmed) return { ok: false, reason: `Confirm that zero data retention is enabled for your ${info.label} account.` };

  if (info.id === "custom") {
    if (!base) return { ok: false, reason: "Enter the endpoint's address." };
    try {
      const u = new URL(base);
      if (u.protocol !== "https:" && !isLocalUrl(u)) return { ok: false, reason: "The endpoint must use https." };
    } catch {
      return { ok: false, reason: "The address isn't a valid URL." };
    }
  }
  return { ok: true };
}
