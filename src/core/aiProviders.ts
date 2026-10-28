/**
 * Which AI providers the assistant may use (CLAUDE.md: EU/US zero-data-retention
 * providers, local models, or agent CLIs the user runs with their own login, which
 * are clearly labelled because the app can't check what they keep). Pure and tested; the server enforces it before
 * every request, the settings page uses it to explain why something is off.
 */

export type ProviderId = "anthropic" | "openai" | "mistral" | "openrouter" | "custom" | "ollama" | "lmstudio" | "claude-code" | "codex" | "hermes" | "openclaw";
export type Region = "EU" | "US";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** "api": the app calls the model. "agent": the app runs an agent program installed on this computer. */
  kind: "api" | "agent";
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
  /** Agents: whether the model field may stay empty (the agent's own default). */
  modelOptional?: boolean;
  /** Agents: what the "profile" field means (Hermes profile, OpenClaw agent), if used. */
  profileLabel?: string;
  /** OpenAI-compatible base URL, when the provider uses one. */
  defaultBaseURL?: string;
  /** Suggested models; any model name can be typed. */
  models: { id: string; label: string }[];
}

const AGENT_NOTE = "This is an agent program on your computer that uses its own login. The app can't check what that service keeps.";

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "api",
    region: "US",
    retention: "agreement",
    zdrNote: "Your Anthropic organization needs a zero-data-retention agreement. Without one, Anthropic keeps requests for a limited time.",
    needsKey: true,
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable)" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, cheaper)" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "api",
    region: "US",
    retention: "agreement",
    zdrNote: "Zero data retention must be approved for your OpenAI organization. The app also asks OpenAI not to store responses.",
    needsKey: true,
    models: [{ id: "gpt-5", label: "GPT-5" }],
  },
  {
    id: "mistral",
    label: "Mistral (EU)",
    kind: "api",
    region: "EU",
    retention: "agreement",
    zdrNote: "Zero data retention must be enabled for your Mistral organization.",
    needsKey: true,
    models: [
      { id: "mistral-large-latest", label: "Mistral Large" },
      { id: "mistral-medium-latest", label: "Mistral Medium" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter (many models)",
    kind: "api",
    region: "US",
    retention: "enforced",
    zdrNote:
      "Every request asks OpenRouter to use only providers with zero data retention and no data collection. OpenRouter is in the US; the provider it picks may be elsewhere.",
    needsKey: true,
    defaultBaseURL: "https://openrouter.ai/api/v1",
    // The full list comes from OpenRouter (models with zero-retention endpoints and tool use).
    models: [],
  },
  {
    id: "custom",
    label: "Other (OpenAI-compatible endpoint)",
    kind: "api",
    region: "choose",
    retention: "agreement",
    zdrNote: "Only use an endpoint in the EU or US that keeps no data, for example your organization's own deployment.",
    needsKey: true,
    models: [],
  },
  {
    id: "ollama",
    label: "Ollama (on this computer)",
    kind: "api",
    region: "local",
    retention: "local",
    zdrNote: "Runs on this computer. Nothing is sent anywhere.",
    needsKey: false,
    defaultBaseURL: "http://localhost:11434/v1",
    models: [{ id: "llama3.1", label: "llama3.1" }],
  },
  {
    id: "lmstudio",
    label: "LM Studio (on this computer)",
    kind: "api",
    region: "local",
    retention: "local",
    zdrNote: "Runs on this computer. Nothing is sent anywhere.",
    needsKey: false,
    defaultBaseURL: "http://localhost:1234/v1",
    models: [],
  },
  {
    id: "claude-code",
    label: "Claude Code (your Claude login)",
    kind: "agent",
    region: "depends",
    retention: "depends",
    zdrNote: `${AGENT_NOTE} With a Claude Pro or Max login, Anthropic keeps chats for 30 days, or longer if you allow training. With an API key on a zero-data-retention organization, nothing is kept.`,
    needsKey: false,
    command: "claude",
    modelOptional: true,
    models: [
      { id: "opus", label: "opus (most capable)" },
      { id: "sonnet", label: "sonnet (faster)" },
      { id: "haiku", label: "haiku (fastest)" },
    ],
  },
  {
    id: "codex",
    label: "Codex (your ChatGPT login)",
    kind: "agent",
    region: "depends",
    retention: "depends",
    zdrNote: `${AGENT_NOTE} With a ChatGPT login, OpenAI's consumer terms apply and chats are kept. With an API key on a zero-data-retention organization, nothing is kept.`,
    needsKey: false,
    command: "codex",
    modelOptional: true,
    models: [],
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    kind: "agent",
    region: "depends",
    retention: "depends",
    zdrNote: `${AGENT_NOTE} Hermes uses the model and provider of the profile you pick; what is kept depends on that provider.`,
    needsKey: false,
    command: "hermes",
    modelOptional: true,
    profileLabel: "Hermes profile",
    models: [],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    kind: "agent",
    region: "depends",
    retention: "depends",
    zdrNote: `${AGENT_NOTE} OpenClaw uses the model and provider of the agent you pick; what is kept depends on that provider.`,
    needsKey: false,
    command: "openclaw",
    modelOptional: true,
    profileLabel: "OpenClaw agent",
    models: [],
  },
];

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
}

export type UseCheck = { ok: true } | { ok: false; reason: string };

const isLocalUrl = (u: URL) => u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";

/** Can the assistant send a request with this provider and settings? */
export function canUse(choice: ModelChoice | undefined, config: ProviderConfig | undefined, hasKey: boolean): UseCheck {
  if (!choice) return { ok: false, reason: "Choose a model for the assistant first." };
  const info = providerInfo(choice.provider);
  if (!info) return { ok: false, reason: "Unknown provider." };
  if (!choice.model.trim() && !info.modelOptional) return { ok: false, reason: "Choose a model." };
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
