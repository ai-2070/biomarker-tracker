import { useState } from "react";
import { Field } from "@base-ui/react/field";
import { ANTHROPIC_MODELS, DEFAULTS, configProblem, isCloud, type AiConfig, type ProviderId } from "../../ai/providers";
import { setAiConfig } from "../../db/db";
import { ChoiceGroup } from "./ChoiceGroup";
import { SimpleSelect } from "./UnitSelect";
import { Button, Card, Notice, errorStyles, helpStyles, inputStyles, labelStyles } from "./ui";

const PROVIDERS: { value: ProviderId; label: string }[] = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI" },
  { value: "ollama", label: "Ollama (on this computer)" },
];

/** Optional AI assistant settings. Everything else in the app works without this. */
export function AiSettings({ config }: { config: AiConfig | undefined }) {
  const [provider, setProvider] = useState<ProviderId>(config?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState(config?.apiKey ?? "");
  const [model, setModel] = useState(config?.model ?? DEFAULTS.anthropic.model);
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? DEFAULTS.ollama.baseUrl!);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function changeProvider(p: ProviderId) {
    setProvider(p);
    setModel(DEFAULTS[p].model);
    setApiKey(config?.provider === p ? (config.apiKey ?? "") : "");
    setSaved(false);
  }

  async function save() {
    const next: AiConfig = isCloud(provider) ? { provider, apiKey: apiKey.trim(), model: model.trim() } : { provider, model: model.trim(), baseUrl: baseUrl.trim() };
    const problem = configProblem(next);
    setError(problem ?? null);
    if (problem) return;
    await setAiConfig(next);
    setSaved(true);
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-2xl font-normal">AI assistant (optional)</h2>
        <p className="mt-1 text-ink-2">
          Ask questions about research papers in plain language. Everything else in this app works without it. You use your own
          account; the app never has a server in between.
        </p>
      </div>

      <ChoiceGroup<ProviderId> label="Provider" value={provider} onChange={changeProvider} options={PROVIDERS} />

      {provider === "anthropic" ? (
        <SimpleSelect label="Model" options={ANTHROPIC_MODELS.map((m) => ({ value: m.id, label: m.label }))} value={model} onChange={setModel} />
      ) : (
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Model name</Field.Label>
          <Field.Control value={model} onValueChange={setModel} autoComplete="off" className={`${inputStyles} sm:max-w-sm`} />
        </Field.Root>
      )}

      {isCloud(provider) ? (
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>API key</Field.Label>
          <Field.Control
            type="password"
            value={apiKey}
            onValueChange={setApiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
            className={inputStyles}
          />
          <Field.Description className={helpStyles}>
            Stored only in this browser, not in backup files. Anyone with access to this browser profile could read it. Use a key with a
            spending limit, and remove it when you're done.
          </Field.Description>
        </Field.Root>
      ) : (
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={labelStyles}>Ollama address</Field.Label>
          <Field.Control value={baseUrl} onValueChange={setBaseUrl} autoComplete="off" className={`${inputStyles} sm:max-w-sm`} />
          <Field.Description className={helpStyles}>
            Nothing leaves your computer. Start Ollama with OLLAMA_ORIGINS set to this page's address so the browser is allowed to
            reach it.
          </Field.Description>
        </Field.Root>
      )}

      {error && <p className={errorStyles}>{error}</p>}
      {saved && (
        <Notice role="status" title="Saved">
          You can now ask questions from the research section of any marker.
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()}>Save AI settings</Button>
        {config && (
          <Button
            variant="secondary"
            onClick={() => {
              void setAiConfig(undefined);
              setApiKey("");
              setSaved(false);
            }}
          >
            Remove key and turn off
          </Button>
        )}
      </div>
    </Card>
  );
}
