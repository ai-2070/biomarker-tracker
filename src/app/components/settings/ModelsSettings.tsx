import { useEffect, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { canUse, type ProviderConfig, type ProviderId, type ProviderInfo, type Region } from "../../../core/aiProviders";
import { api } from "../../api";
import { ChoiceGroup } from "../ChoiceGroup";
import { SimpleSelect } from "../UnitSelect";
import { Button, Card, CheckIcon, Notice, cx, errorStyles, helpStyles, inputStyles, labelStyles } from "../ui";

interface SettingsResponse {
  providers: ProviderInfo[];
  configs: Partial<Record<ProviderId, ProviderConfig>>;
  hasKey: Record<string, boolean>;
  installed: Record<string, boolean>;
  hermesConnected: boolean;
  assistant: { provider: ProviderId; model: string } | null;
  ready: { ok: boolean; reason?: string };
}

const REGION_TEXT: Record<ProviderInfo["region"], string> = {
  EU: "EU",
  US: "US",
  local: "This computer",
  choose: "You choose (EU or US)",
  depends: "Wherever the agent's own model runs",
};

/** OpenRouter's models with zero-retention endpoints and tool use, loaded from OpenRouter. */
function useOpenRouterModels(active: boolean) {
  const [state, setState] = useState<{ models: { id: string; label: string }[]; error?: string } | null>(null);
  useEffect(() => {
    if (!active || state) return;
    void api<{ models: { id: string; label: string }[]; error?: string }>("GET", "/api/settings/models/openrouter").then(setState, (e: unknown) =>
      setState({ models: [], error: e instanceof Error ? e.message : "Couldn't load the list." }),
    );
  }, [active, state]);
  return state;
}

/** Which model the assistant uses. Only EU/US zero-data-retention providers, or local models. */
export function ModelsSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [cfg, setCfg] = useState<ProviderConfig>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const orModels = useOpenRouterModels(provider === "openrouter");

  async function load(keepSelection = false) {
    try {
      const d = await api<SettingsResponse>("GET", "/api/settings");
      setData(d);
      if (!keepSelection) {
        const p = d.assistant?.provider ?? "anthropic";
        setProvider(p);
        setModel(d.assistant?.model ?? d.providers.find((x) => x.id === p)?.models[0]?.id ?? "");
        setCfg(d.configs[p] ?? {});
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load the settings.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  if (loadError) return <Notice tone="danger">{loadError}</Notice>;
  if (!data) return <p className="text-ink-2">Loading…</p>;
  const info = data.providers.find((p) => p.id === provider)!;
  const isAgent = info.kind === "agent";
  const installed = !isAgent || data.installed[provider];
  const suggestions = provider === "openrouter" ? (orModels?.models ?? []) : info.models;
  const hasKey = data.hasKey[provider] || key.trim() !== "";
  const check = canUse({ provider, model }, cfg, hasKey);

  function pickProvider(id: ProviderId) {
    setProvider(id);
    setCfg(data!.configs[id] ?? {});
    setModel(data!.assistant?.provider === id ? data!.assistant.model : data!.providers.find((x) => x.id === id)?.models[0]?.id ?? "");
    setKey("");
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await api("PUT", `/api/settings/provider/${provider}`, { ...cfg, ...(key.trim() ? { key: key.trim() } : {}) });
      await api("PUT", "/api/settings/assistant", { provider, model });
      setKey("");
      await load(true);
      setMessage({ tone: "info", text: "Saved." });
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    await api("PUT", `/api/settings/provider/${provider}`, { key: null });
    await load(true);
    setMessage({ tone: "info", text: "Key removed." });
  }

  async function connectHermes(connect: boolean) {
    setConnecting(true);
    setMessage(null);
    try {
      const r = await api<{ ok: boolean; error?: string }>("POST", "/api/settings/hermes", { connect });
      setMessage(r.ok ? { tone: "info", text: connect ? "Hermes now has the app's tools." : "Removed the app's tools from Hermes." } : { tone: "danger", text: r.error ?? "It didn't work." });
      await load(true);
    } finally {
      setConnecting(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage(null);
    try {
      const r = await api<{ ok: boolean; reply?: string; error?: string }>("POST", "/api/settings/test");
      setMessage(r.ok ? { tone: "info", text: `It works. The model answered: "${r.reply}"` } : { tone: "danger", text: r.error ?? "It didn't work." });
    } finally {
      setTesting(false);
    }
  }

  const saved = data.assistant?.provider === provider && data.assistant.model === model;

  return (
    <div className="flex flex-col gap-5">
      <Notice title="Where your questions and data go">
        Your questions, results and log go to the model you choose here. Cloud providers must keep nothing and be in the EU or US: you confirm zero
        data retention for your account, and OpenRouter is asked for it on every request. Local models (Ollama, LM Studio) never send anything
        anywhere. Agent programs (Claude Code, Codex, Hermes, OpenClaw) use their own login, so what they keep depends on that login.
      </Notice>

      <Card className="flex flex-col gap-5">
        <h2 className="font-serif text-2xl font-normal">The assistant's model</h2>
        <SimpleSelect label="Provider" options={data.providers.map((p) => ({ value: p.id, label: p.label }))} value={provider} onChange={(v) => pickProvider(v as ProviderId)} />

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-sunken p-3 text-sm">
          <dt className="font-medium">Where it runs</dt>
          <dd className="text-ink-2">{REGION_TEXT[info.region]}</dd>
          <dt className="font-medium">Data kept</dt>
          <dd className={info.retention === "depends" ? "font-medium text-warn" : "text-ink-2"}>
            {info.retention === "depends" ? "Depends on your login (not checked)" : info.zdrNote}
          </dd>
        </dl>

        {info.retention === "depends" && (
          <Notice tone="warn" title="The app can't check what this keeps">
            {info.zdrNote}
          </Notice>
        )}

        {isAgent && (
          <p className={cx("rounded-lg p-3 text-sm", installed ? "bg-sunken text-ink-2" : "bg-warn-soft text-warn")}>
            {installed ? (
              <>
                Found the <span className="font-mono">{info.command}</span> command on this computer. It starts once per question, in an empty folder.{" "}
                {provider === "claude-code"
                  ? "Its own file, shell and web tools are switched off; it only gets the app's tools."
                  : provider === "codex"
                    ? "It runs read-only and gets the app's tools."
                    : "It keeps its own tools and settings; it is asked to use only the app's tools for your data."}
              </>
            ) : (
              <>
                The <span className="font-mono">{info.command}</span> command wasn't found. Install it and sign in first, then reload this page.
              </>
            )}
          </p>
        )}

        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Model</Field.Label>
          <Field.Control
            value={model}
            onValueChange={setModel}
            list={`models-${provider}`}
            placeholder={info.modelOptional ? "Leave empty for its default model" : "Model name"}
            autoComplete="off"
            spellCheck={false}
            className={`${inputStyles} sm:max-w-md`}
          />
          <datalist id={`models-${provider}`}>
            {suggestions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
          {provider === "openrouter" ? (
            <Field.Description className={helpStyles}>
              {orModels === null
                ? "Loading OpenRouter's models…"
                : orModels.error
                  ? orModels.error
                  : `${orModels.models.length} models have zero-retention endpoints and can use tools. Start typing, e.g. anthropic/ or mistralai/.`}
            </Field.Description>
          ) : (
            info.models.length > 0 && <Field.Description className={helpStyles}>Suggestions: {info.models.map((m) => m.label).join(" · ")}</Field.Description>
          )}
        </Field.Root>

        {info.id === "custom" && (
          <ChoiceGroup<Region>
            label="Where does this endpoint process requests?"
            value={cfg.region ?? ("" as Region)}
            onChange={(region) => setCfg({ ...cfg, region })}
            options={[
              { value: "EU", label: "EU" },
              { value: "US", label: "US" },
            ]}
          />
        )}

        {info.profileLabel && (
          <Field.Root className="flex flex-col gap-1.5">
            <Field.Label className={labelStyles}>{info.profileLabel}</Field.Label>
            <Field.Control
              value={cfg.profile ?? ""}
              onValueChange={(profile) => setCfg({ ...cfg, profile })}
              placeholder="Leave empty for the default"
              autoComplete="off"
              spellCheck={false}
              className={`${inputStyles} sm:max-w-sm`}
            />
          </Field.Root>
        )}

        {info.id === "hermes" && installed && (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <p className="font-medium">{data.hermesConnected ? "Hermes has the app's tools" : "Give Hermes the app's tools"}</p>
            <p className="text-sm text-ink-2">
              {data.hermesConnected
                ? "Hermes can read your results and search research through the app while it answers, so its citations are checked."
                : "Adds Biomarker Tracker to Hermes' MCP settings, so Hermes can read your results and search research while it answers. Without it, Hermes gets a summary of your data and its citations can't be checked."}
            </p>
            <div>
              <Button variant="secondary" disabled={connecting} onClick={() => void connectHermes(!data.hermesConnected)}>
                {connecting ? "Working…" : data.hermesConnected ? "Disconnect" : "Connect"}
              </Button>
            </div>
          </div>
        )}

        {(info.id === "custom" || info.retention === "local") && (
          <Field.Root className="flex flex-col gap-1.5">
            <Field.Label className={labelStyles}>Address</Field.Label>
            <Field.Control
              value={cfg.baseURL ?? ""}
              onValueChange={(baseURL) => setCfg({ ...cfg, baseURL })}
              placeholder={info.defaultBaseURL ?? "https://…/v1"}
              autoComplete="off"
              className={`${inputStyles} sm:max-w-md`}
            />
            <Field.Description className={helpStyles}>
              {info.retention === "local" ? `Leave empty for the usual ${info.defaultBaseURL}.` : "An OpenAI-compatible endpoint, e.g. https://llm.example.eu/v1."}
            </Field.Description>
          </Field.Root>
        )}

        {info.needsKey && (
          <Field.Root className="flex flex-col gap-1.5">
            <Field.Label className={labelStyles}>API key</Field.Label>
            <div className="flex flex-wrap items-center gap-2">
              <Field.Control
                type="password"
                value={key}
                onValueChange={setKey}
                placeholder={data.hasKey[provider] ? "A key is saved. Type to replace it." : "Paste your key"}
                autoComplete="off"
                spellCheck={false}
                className={`${inputStyles} sm:max-w-md`}
              />
              {data.hasKey[provider] && (
                <Button variant="quiet" className="text-sm" onClick={() => void removeKey()}>
                  Remove key
                </Button>
              )}
            </div>
            <Field.Description className={helpStyles}>Kept by the app's local server on this computer. It's never shown again or put in backups.</Field.Description>
          </Field.Root>
        )}

        {info.retention === "agreement" && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
            <Checkbox.Root
              checked={!!cfg.zdrConfirmed}
              onCheckedChange={(zdrConfirmed) => setCfg({ ...cfg, zdrConfirmed })}
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-line-strong bg-surface text-accent-ink data-checked:border-accent data-checked:bg-accent"
            >
              <Checkbox.Indicator className="flex data-unchecked:hidden">
                <CheckIcon />
              </Checkbox.Indicator>
            </Checkbox.Root>
            <span>
              <span className="font-medium">Zero data retention is switched on for my {info.label} account.</span>
              <span className="block text-sm text-ink-2">{info.zdrNote}</span>
            </span>
          </label>
        )}

        <p role="status" className={cx("rounded-lg p-3 text-sm", check.ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
          {check.ok ? (saved ? "Ready: the assistant uses this model." : "Ready to save.") : check.reason}
        </p>
        {message && (
          <Notice tone={message.tone} role="status">
            {message.text}
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={saving || (!model.trim() && !info.modelOptional)}>
            Save
          </Button>
          <Button variant="secondary" onClick={() => void test()} disabled={testing || !data.ready.ok || !saved}>
            {testing ? "Testing…" : "Test"}
          </Button>
        </div>
        {!data.ready.ok && data.assistant && <p className={errorStyles}>The saved model can't be used yet: {data.ready.reason}</p>}
      </Card>
    </div>
  );
}
