/**
 * Which AI providers the assistant may use (CLAUDE.md: EU/US zero-data-retention
 * providers, or local models). Pure and tested; the server enforces it before
 * every request, the settings page uses it to explain why something is off.
 */

export type ProviderId = "anthropic" | "openai" | "mistral" | "custom" | "ollama" | "lmstudio";
export type Region = "EU" | "US";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Where requests are processed. "choose": the user says (custom endpoints). */
  region: Region | "local" | "choose";
  /** "local": nothing leaves the computer. "agreement": ZDR must be enabled on the user's account. */
  retention: "local" | "agreement";
  /** What the user has to have arranged with the provider, in plain words. */
  zdrNote: string;
  needsKey: boolean;
  /** OpenAI-compatible base URL, when the provider uses one. */
  defaultBaseURL?: string;
  /** Suggested models; any model name can be typed. */
  models: { id: string; label: string }[];
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
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
    region: "US",
    retention: "agreement",
    zdrNote: "Zero data retention must be approved for your OpenAI organization. The app also asks OpenAI not to store responses.",
    needsKey: true,
    models: [{ id: "gpt-5", label: "GPT-5" }],
  },
  {
    id: "mistral",
    label: "Mistral (EU)",
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
    id: "custom",
    label: "Other (OpenAI-compatible endpoint)",
    region: "choose",
    retention: "agreement",
    zdrNote: "Only use an endpoint in the EU or US that keeps no data, for example your organization's own deployment.",
    needsKey: true,
    models: [],
  },
  {
    id: "ollama",
    label: "Ollama (on this computer)",
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
    region: "local",
    retention: "local",
    zdrNote: "Runs on this computer. Nothing is sent anywhere.",
    needsKey: false,
    defaultBaseURL: "http://localhost:1234/v1",
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
  if (!choice.model.trim()) return { ok: false, reason: "Choose a model." };
  const c = config ?? {};

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
