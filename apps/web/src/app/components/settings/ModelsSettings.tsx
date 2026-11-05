import { useEffect, useState } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { EFFORT_LABEL, GROUP_LABEL, canUse, modelEfforts, type Effort, type ProviderConfig, type ProviderId, type ProviderInfo, type Region } from "@bt/shared/core/aiProviders";
import { localServer } from "../../api";
import type { AgentProgram, LoadedModelSource, ModelList, SettingsInfo } from "@bt/shared/api/types";
import { ChoiceGroup } from "../ChoiceGroup";
import { SimpleSelect } from "../UnitSelect";
import { Button, Card, CheckIcon, Notice, cx, errorStyles, helpStyles, inputStyles, labelStyles } from "../ui";
import { OnOff } from "./SkillsSettings";

type SettingsResponse = SettingsInfo;
type LoadedList = ModelList;

const REGION_TEXT: Record<ProviderInfo["region"], string> = {
  EU: "EU",
  US: "US",
  local: "This computer",
  choose: "You choose (EU or US)",
  depends: "Wherever the program's own model runs",
};

const OTHER = "__other";
const DEFAULT = "__default";
const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent);

/** Models or profiles the server loads (OpenRouter, Ollama, LM Studio, Hermes, OpenClaw). */
function useLoadedList(info: ProviderInfo, installed: boolean, revision: number) {
  const [lists, setLists] = useState<Partial<Record<ProviderId, { revision: number; list: LoadedList }>>>({});
  const wanted = info.modelList === "loaded" || (info.profileLabel && installed);
  const cached = lists[info.id];
  useEffect(() => {
    if (!wanted || cached?.revision === revision) return;
    let alive = true;
    void (info.id === "openrouter" ? localServer.settings.openRouterModels.query() : localServer.settings.loadedModels.query({ source: info.id as LoadedModelSource })).then(
      (list) => alive && setLists((x) => ({ ...x, [info.id]: { revision, list } })),
      (e: unknown) => alive && setLists((x) => ({ ...x, [info.id]: { revision, list: { models: [], error: e instanceof Error ? e.message : "Couldn't load the list." } } })),
    );
    return () => { alive = false; };
  }, [info.id, wanted, cached, revision]);
  return wanted ? (cached?.revision === revision ? cached.list : null) : { models: [] };
}

/** Which model the assistant uses: agent programs first, then API-key providers, then local models. */
export function ModelsSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>("claude-code");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<Effort | undefined>(undefined);
  const [key, setKey] = useState("");
  const [cfg, setCfg] = useState<ProviderConfig>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [discoveryRevision, setDiscoveryRevision] = useState(0);

  async function load(keepSelection = false) {
    try {
      const d = await localServer.settings.get.query();
      setData(d);
      if (!keepSelection) {
        setProvider(d.assistant.provider);
        setModel(d.assistant.model);
        setEffort(d.assistant.effort);
        setCfg(d.configs[d.assistant.provider] ?? {});
      }
      return d;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load the settings.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const info = data?.providers.find((p) => p.id === provider);
  const installed = !info || info.kind !== "agent" || !!data?.installed[provider];
  const loaded = useLoadedList(info ?? ({ id: "custom", models: [], efforts: [] } as unknown as ProviderInfo), installed, discoveryRevision);

  if (loadError) return <Notice tone="danger">{loadError}</Notice>;
  if (!data || !info) return <p className="text-ink-2">Loading…</p>;
  const isAgent = info.kind === "agent";
  const hasKey = data.hasKey[provider] || key.trim() !== "";
  const check = canUse({ provider, model, ...(effort ? { effort } : {}) }, cfg, hasKey);
  const efforts = modelEfforts(provider, model);

  function pickProvider(id: ProviderId) {
    const next = data!.providers.find((x) => x.id === id)!;
    const current = data!.assistant.provider === id ? data!.assistant : undefined;
    setProvider(id);
    setCfg(data!.configs[id] ?? {});
    setModel(current?.model ?? (next.modelOptional ? "" : (next.models[0]?.id ?? "")));
    setEffort(current?.effort);
    setKey("");
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await localServer.settings.setProvider.mutate({ id: provider, ...cfg, ...(key.trim() ? { key: key.trim() } : {}) });
      setDiscoveryRevision((r) => r + 1);
      await localServer.settings.setAssistant.mutate({ provider, model, ...(effort ? { effort } : {}) });
      setKey("");
      const savedSettings = await load(true);
      if (savedSettings) {
        // Reflect server normalization only if the person has not edited or switched the draft meanwhile.
        setCfg((current) => current === cfg ? savedSettings.configs[provider] ?? {} : current);
      }
      setMessage({ tone: "info", text: "Saved." });
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    await localServer.settings.setProvider.mutate({ id: provider, key: null });
    setDiscoveryRevision((r) => r + 1);
    await load(true);
    setMessage({ tone: "info", text: "Key removed." });
  }

  async function connectHermes(connect: boolean) {
    setConnecting(true);
    setMessage(null);
    try {
      const r = await localServer.settings.connectHermes.mutate({ connect });
      setMessage(r.ok ? { tone: "info", text: connect ? "Hermes now has the app's tools." : "Removed the app's tools from Hermes." } : { tone: "danger", text: r.error });
      await load(true);
    } finally {
      setConnecting(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage(null);
    try {
      const r = await localServer.settings.test.mutate();
      setMessage(r.ok ? { tone: "info", text: `It works. The model answered: "${r.reply}"` } : { tone: "danger", text: r.error ?? "It didn't work." });
    } finally {
      setTesting(false);
    }
  }

  const savedCfg = data.configs[provider] ?? {};
  const configFields = new Set([...Object.keys(savedCfg), ...Object.keys(cfg)] as (keyof ProviderConfig)[]);
  const saved = data.assistant.provider === provider && data.assistant.model === model && data.assistant.effort === effort
    && !key.trim() && [...configFields].every((field) => cfg[field] === savedCfg[field]);

  return (
    <div className="flex flex-col gap-5">
      <Notice title="Where your questions and data go">
        Your questions, results and log go to the model you choose here. Programs on this computer (Claude Code, Codex, Hermes, OpenClaw) use your own
        login, so what they keep depends on that login. Cloud providers with an API key must keep nothing and be in the EU or US. Local models (Ollama,
        LM Studio) never send anything anywhere.
      </Notice>

      <Card className="flex flex-col gap-5">
        <h2 className="font-serif text-2xl font-normal">The assistant's model</h2>
        <SimpleSelect
          label="Provider"
          options={data.providers.map((p) => ({
            value: p.id,
            label: p.kind === "agent" && !data.installed[p.id] ? `${p.label} (not installed)` : p.label,
            group: GROUP_LABEL[p.group],
          }))}
          value={provider}
          onChange={(v) => pickProvider(v as ProviderId)}
        />

        {isAgent && <AgentSetup info={info} installed={installed} onCheck={async () => { await load(true); }} />}

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

        <ModelPicker info={info} value={model} onChange={setModel} loaded={loaded} />
        <p className="text-sm text-ink-2">Deep checks use the same model with a larger search budget. Weaker models may miss more, so pick a stronger one for important claims.</p>

        {info.profileLabel && (
          <ProfilePicker label={info.profileLabel} value={cfg.profile ?? ""} onChange={(profile) => setCfg({ ...cfg, profile })} loaded={loaded} installed={installed} />
        )}

        {efforts.length > 0 && (
          <ChoiceGroup<Effort | "default">
            label="Effort"
            help="How hard the model thinks before answering. More effort: slower, more thorough answers, and more cost or usage."
            value={effort ?? "default"}
            onChange={(v) => setEffort(v === "default" ? undefined : v)}
            options={[{ value: "default" as const, label: "Default" }, ...efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))]}
          />
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

        {!isAgent && <EveSetting eve={data.eve ?? { on: false, built: false }} onChange={(eve) => setData({ ...data, eve })} />}

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

        <p role="status" className={cx("rounded-lg p-3 text-sm", check.ok && installed ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
          {!installed
            ? `Install ${info.label} first (above).`
            : check.ok
              ? saved
                ? data.chosen
                  ? "Ready: the assistant uses this model."
                  : "Ready: the assistant uses this model (the default)."
                : "Ready to save."
              : check.reason}
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
        {!data.ready.ok && saved && installed && <p className={errorStyles}>This model can't be used yet: {data.ready.reason}</p>}
      </Card>
    </div>
  );
}

/** A list to choose from where one exists, with "Other model…" for anything else. */
function ModelPicker({ info, value, onChange, loaded }: { info: ProviderInfo; value: string; onChange: (m: string) => void; loaded: LoadedList | null }) {
  const list = info.id === "openrouter" || info.profileLabel ? [] : info.modelList === "loaded" ? (loaded?.models ?? []) : info.models;
  const inList = value === "" ? info.modelOptional : list.some((m) => m.id === value);
  const [other, setOther] = useState(!inList);
  // A new provider starts on its list again.
  useEffect(() => setOther(!inList), [info.id]);

  // OpenRouter: hundreds of models, so type with suggestions.
  if (info.id === "openrouter") {
    return (
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Model</Field.Label>
        <Field.Control value={value} onValueChange={onChange} list="models-openrouter" placeholder="e.g. anthropic/claude-opus-5.5" autoComplete="off" spellCheck={false} className={`${inputStyles} sm:max-w-md`} />
        <datalist id="models-openrouter">
          {(loaded?.models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </datalist>
        <Field.Description className={helpStyles}>
          {loaded === null
            ? "Loading OpenRouter's models…"
            : loaded.error
              ? loaded.error
              : `${loaded.models.length} models have zero-retention endpoints and can use tools. Start typing, e.g. anthropic/ or mistralai/.`}
        </Field.Description>
      </Field.Root>
    );
  }

  const options = [
    ...(info.modelOptional ? [{ value: DEFAULT, label: info.profileLabel ? `The ${info.profileLabel.toLowerCase()}'s model` : "The program's default" }] : []),
    ...list.map((m) => ({ value: m.id, label: m.label === m.id ? m.id : `${m.label}` })),
    { value: OTHER, label: "Other model…" },
  ];
  const selectValue = other ? OTHER : value === "" ? DEFAULT : value;

  return (
    <div className="flex flex-col gap-3">
      {options.length > 1 && (
        <SimpleSelect
          label="Model"
          options={options}
          value={selectValue}
          onChange={(v) => {
            if (v === OTHER) {
              setOther(true);
              return;
            }
            setOther(false);
            onChange(v === DEFAULT ? "" : v);
          }}
          className="sm:max-w-md"
        />
      )}
      {(other || options.length === 1) && (
        <Field.Root className="flex flex-col gap-1.5">
          <Field.Label className={options.length > 1 ? "text-sm text-ink-2" : labelStyles}>{options.length > 1 ? "Model name" : "Model"}</Field.Label>
          <Field.Control
            value={value}
            onValueChange={onChange}
            placeholder={info.modelOptional ? "Leave empty for the default" : "Model name"}
            autoComplete="off"
            spellCheck={false}
            className={`${inputStyles} sm:max-w-md`}
          />
        </Field.Root>
      )}
      {info.modelList === "loaded" && !info.profileLabel && loaded?.error && <p className="text-sm text-warn">{loaded.error}</p>}
      {info.id === "claude-code" && <p className={helpStyles}>"opus", "sonnet" and "haiku" always mean the newest of each.</p>}
    </div>
  );
}

/** Hermes profile or OpenClaw agent: from the program's own list when it can be read. */
function ProfilePicker({ label, value, onChange, loaded, installed }: { label: string; value: string; onChange: (v: string) => void; loaded: LoadedList | null; installed: boolean }) {
  const profiles = loaded?.profiles ?? [];
  if (installed && profiles.length > 0) {
    const options = [{ value: DEFAULT, label: "Default" }, ...profiles.map((p) => ({ value: p.id, label: p.label }))];
    return <SimpleSelect label={label} options={options} value={value || DEFAULT} onChange={(v) => onChange(v === DEFAULT ? "" : v)} className="sm:max-w-md" />;
  }
  return (
    <Field.Root className="flex flex-col gap-1.5">
      <Field.Label className={labelStyles}>{label}</Field.Label>
      <Field.Control value={value} onValueChange={onChange} placeholder="Leave empty for the default" autoComplete="off" spellCheck={false} className={`${inputStyles} sm:max-w-sm`} />
      {installed && loaded === null && <Field.Description className={helpStyles}>Loading the list…</Field.Description>}
    </Field.Root>
  );
}

/** Install and sign-in steps for an agent program, with the maker's official commands. */
function AgentSetup({ info, installed, onCheck }: { info: ProviderInfo; installed: boolean; onCheck: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const ins = info.install!;
  const installCmd = isWindows ? ins.windows : ins.unix;

  async function open(action: "install" | "signin") {
    setBusy(action);
    setNote(null);
    try {
      const r = await localServer.agents.openTerminal.mutate({ id: info.id as AgentProgram, action });
      setNote(
        r.ok
          ? { tone: "info", text: action === "install" ? "A terminal window opened with the installer. When it has finished, sign in (step 2), then press Check again." : "A terminal window opened. Sign in there, then close it." }
          : { tone: "danger", text: r.error ?? "The terminal couldn't be opened. Run the command yourself." },
      );
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the command is visible to copy by hand */
    }
  }

  const Command = ({ text }: { text: string }) => (
    <div className="flex items-center gap-2 rounded-lg bg-sunken p-2 pl-3">
      <code className="min-w-0 flex-1 font-mono text-xs break-all">{text}</code>
      <Button variant="quiet" className="min-h-9 shrink-0 px-2 text-sm" onClick={() => void copy(text)}>
        {copied === text ? "Copied" : "Copy"}
      </Button>
    </div>
  );

  if (installed) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-ok">
          <CheckIcon /> {info.label} is installed
        </p>
        <p className="text-ink-2">
          It starts once per question, in an empty folder.{" "}
          {info.id === "claude-code"
            ? "Its own file, shell and web tools are switched off; it only gets the app's tools."
            : info.id === "codex"
              ? "It runs read-only and gets the app's tools."
              : "It keeps its own tools and settings; it is asked to use only the app's tools for your data."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="text-sm" disabled={!!busy} onClick={() => void open("signin")}>
            {busy === "signin" ? "Opening…" : "Sign in or switch account"}
          </Button>
        </div>
        {note && <p className={note.tone === "danger" ? "text-danger" : "text-ink-2"}>{note.text}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-warn/40 bg-warn-soft/40 p-4">
      <div>
        <p className="font-medium">Install {info.label}</p>
        <p className="text-sm text-ink-2">
          {info.label} isn't on this computer yet. Two steps, once. The buttons open a terminal window that runs {info.label}'s official commands, so you
          can see what happens and answer its questions.
        </p>
      </div>
      <ol className="flex flex-col gap-4">
        <li className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="font-medium">1. Install.</span> <span className="text-ink-2">{isWindows ? "In PowerShell:" : "In a terminal:"}</span>
          </p>
          <Command text={installCmd} />
          <div>
            <Button disabled={!!busy} onClick={() => void open("install")}>
              {busy === "install" ? "Opening…" : `Install ${info.label}`}
            </Button>
          </div>
        </li>
        <li className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="font-medium">2. Sign in.</span> <span className="text-ink-2">{ins.signInNote}</span>
          </p>
          <Command text={ins.signIn} />
          <div>
            <Button variant="secondary" disabled={!!busy} onClick={() => void open("signin")}>
              {busy === "signin" ? "Opening…" : "Open sign-in"}
            </Button>
          </div>
        </li>
        <li className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() => {
              setBusy("check");
              void onCheck().finally(() => setBusy(null));
            }}
          >
            {busy === "check" ? "Checking…" : "3. Check again"}
          </Button>
          <a href={ins.docs} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline underline-offset-2">
            {info.label} install guide
          </a>
        </li>
      </ol>
      {note && (
        <p role="status" className={cx("text-sm", note.tone === "danger" ? "text-danger" : "text-ink-2")}>
          {note.text}
        </p>
      )}
    </div>
  );
}

/**
 * eve (preview): API-key and local models answer inside eve, Vercel's framework for durable agents, run as a
 * private process on this computer. Same rules, tools, model and checks; questions with photos and evidence
 * checks keep the built-in loop.
 */
function EveSetting({ eve, onChange }: { eve: SettingsResponse["eve"]; onChange: (eve: SettingsResponse["eve"]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await localServer.settings.setEve.mutate({ on });
      onChange(r.eve);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change this setting.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Run in eve (preview)</p>
          <p className="text-sm text-ink-2">
            Brain answers inside eve, a framework for long-running agents, as a private process on this computer. Same model, rules, tools and citation checks. In-progress answers are kept in the app's data folder and deleted when each answer ends. Questions with photos and evidence checks use the usual way.
          </p>
          {!eve.built && <p className="mt-1 text-sm text-warn">Not available in this copy: the eve runtime isn't built (bun run eve:build).</p>}
        </div>
        <OnOff checked={eve.on} onChange={(on) => void (busy ? undefined : toggle(on))} label="Run in eve (preview)" />
      </div>
      {error && <p role="alert" className={errorStyles}>{error}</p>}
    </div>
  );
}
