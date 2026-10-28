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
  assistant: { provider: ProviderId; model: string } | null;
  ready: { ok: boolean; reason?: string };
}

const REGION_TEXT: Record<ProviderInfo["region"], string> = { EU: "EU", US: "US", local: "This computer", choose: "You choose (EU or US)" };

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
      <Notice title="Only zero-data-retention providers in the EU or US, or models on this computer">
        Your questions, results and log go to the model you choose here, so the app only allows providers that keep nothing, in the EU or US. Cloud
        providers need zero data retention switched on for your account; you confirm that below. Local models (Ollama, LM Studio) never send
        anything anywhere.
      </Notice>

      <Card className="flex flex-col gap-5">
        <h2 className="font-serif text-2xl font-normal">The assistant's model</h2>
        <SimpleSelect label="Provider" options={data.providers.map((p) => ({ value: p.id, label: p.label }))} value={provider} onChange={(v) => pickProvider(v as ProviderId)} />

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-sunken p-3 text-sm">
          <dt className="font-medium">Where it runs</dt>
          <dd className="text-ink-2">{REGION_TEXT[info.region]}</dd>
          <dt className="font-medium">Data kept</dt>
          <dd className="text-ink-2">{info.zdrNote}</dd>
        </dl>

        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Model</Field.Label>
          <Field.Control value={model} onValueChange={setModel} list={`models-${provider}`} placeholder="Model name" autoComplete="off" className={`${inputStyles} sm:max-w-md`} />
          <datalist id={`models-${provider}`}>
            {info.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
          {info.models.length > 0 && <Field.Description className={helpStyles}>Suggestions: {info.models.map((m) => m.label).join(" · ")}</Field.Description>}
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
          <Button onClick={() => void save()} disabled={saving || !model.trim()}>
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
