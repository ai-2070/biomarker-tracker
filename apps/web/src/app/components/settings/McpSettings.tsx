import { useEffect, useState } from "react";
import { Field } from "@base-ui/react/field";
import type { McpPreset } from "@bt/shared/core/mcpPresets";
import { localServer } from "../../api";
import type { McpServerListing, McpTest } from "@bt/shared/api/types";
import { ConfirmDialog } from "../ConfirmDialog";
import { Button, Card, Notice, cx, errorStyles, helpStyles, inputStyles, labelStyles } from "../ui";
import { OnOff } from "./SkillsSettings";

type ServerRow = McpServerListing;

const smallLabel = "font-mono text-xs font-medium tracking-[0.14em] text-ink-2 uppercase";

/** Settings fields for one server's environment values (API keys and similar). */
function EnvFields({ server, preset, onSaved }: { server: ServerRow; preset: McpPreset; onSaved: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  if (preset.env.length === 0) return null;
  const changed = Object.values(values).some((v) => v.trim() !== "");

  async function save(patch: Record<string, string | null>) {
    await localServer.mcp.update.mutate({ id: server.id, env: patch });
    setValues({});
    setSaved(true);
    await onSaved();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      {preset.env.map((v) => {
        const isSet = v.secret ? server.secretsSet.includes(v.name) : !!server.env[v.name];
        return (
          <Field.Root key={v.name} className="flex flex-col gap-1">
            <Field.Label className="text-sm font-medium">
              {v.label} {!v.required && !/optional/i.test(v.label) && <span className="font-normal text-ink-2">(optional)</span>}
            </Field.Label>
            <div className="flex flex-wrap items-center gap-2">
              <Field.Control
                type={v.secret ? "password" : "text"}
                value={values[v.name] ?? ""}
                onValueChange={(x) => {
                  setValues({ ...values, [v.name]: x });
                  setSaved(false);
                }}
                placeholder={isSet ? (v.secret ? "Saved. Type to replace it." : server.env[v.name]) : ""}
                autoComplete="off"
                spellCheck={false}
                className={`${inputStyles} sm:max-w-sm`}
              />
              {isSet && (
                <Button variant="quiet" className="text-sm" onClick={() => void save({ [v.name]: null })}>
                  Clear
                </Button>
              )}
            </div>
            <Field.Description className={helpStyles}>{v.help}</Field.Description>
          </Field.Root>
        );
      })}
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={!changed} onClick={() => void save(Object.fromEntries(Object.entries(values).filter(([, x]) => x.trim()).map(([k, x]) => [k, x.trim()])))}>
          Save settings
        </Button>
        {saved && (
          <span role="status" className="text-sm text-ok">
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}

function ServerCard({ server, preset, reload }: { server: ServerRow; preset?: McpPreset; reload: () => Promise<void> }) {
  const [test, setTest] = useState<McpTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [on, setOn] = useState(server.enabled);
  useEffect(() => setOn(server.enabled), [server.enabled]);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await localServer.mcp.test.mutate({ id: server.id }));
    } finally {
      setTesting(false);
      await reload();
    }
  }

  const missing = preset?.env.filter((v) => v.required && !(v.secret ? server.secretsSet.includes(v.name) : server.env[v.name])) ?? [];

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{server.name}</p>
          <p className="font-mono text-xs break-all text-ink-2">
            {server.command} {server.args.join(" ")}
          </p>
        </div>
        <OnOff
          checked={on}
          onChange={(enabled) => {
            setOn(enabled);
            void localServer.mcp.update.mutate({ id: server.id, enabled }).finally(reload);
          }}
          label={`Let the assistant use ${server.name}`}
        />
      </div>
      <p className={cx("text-sm", server.error ? "text-danger" : server.running ? "text-ok" : "text-ink-2")}>
        {server.error ? `Last start failed: ${server.error}` : server.running ? "Running." : server.enabled ? "Starts when the assistant needs it." : "Off."}
      </p>
      {missing.length > 0 && <p className={errorStyles}>Needs: {missing.map((v) => v.label).join(", ")}.</p>}
      {preset && <EnvFields server={server} preset={preset} onSaved={reload} />}
      {test && (
        <Notice tone={test.ok ? "info" : "danger"} role="status">
          {test.ok ? (
            <>
              It works: {test.tools?.length ?? 0} tools.{" "}
              <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => setShowTools(!showTools)}>
                {showTools ? "Hide them" : "Show them"}
              </button>
              {showTools && (
                <ul className="mt-2 flex flex-col gap-1">
                  {test.tools?.map((t) => (
                    <li key={t.name}>
                      <span className="font-mono text-xs">{t.name}</span> <span className="text-ink-2">{t.description.slice(0, 160)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            test.error
          )}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void runTest()} disabled={testing}>
          {testing ? "Starting… (the first time can take a minute)" : "Test"}
        </Button>
        <ConfirmDialog
          trigger="Remove"
          triggerVariant="quiet"
          title={`Remove ${server.name}?`}
          description="The assistant stops using it. Its saved settings and keys are deleted too."
          confirmLabel="Remove"
          onConfirm={async () => {
            await localServer.mcp.remove.mutate({ id: server.id });
            await reload();
          }}
        />
      </div>
    </li>
  );
}

function AddCustom({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("npx");
  const [args, setArgs] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    try {
      await localServer.mcp.addCustom.mutate({ name, command, args: args.trim() ? args.trim().split(/\s+/) : [] });
      setName("");
      setArgs("");
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the server.");
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-normal">Add another server</h2>
      <p className={helpStyles}>For a medical or nutrition MCP server that isn't listed. It runs on this computer with the command you give. Only add servers you trust.</p>
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Name</Field.Label>
        <Field.Control value={name} onValueChange={setName} placeholder="e.g. My food database" className={`${inputStyles} sm:max-w-sm`} />
      </Field.Root>
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Command</Field.Label>
        <Field.Control value={command} onValueChange={setCommand} spellCheck={false} className={`${inputStyles} font-mono sm:max-w-sm`} />
      </Field.Root>
      <Field.Root className="flex flex-col gap-1.5">
        <Field.Label className={labelStyles}>Arguments</Field.Label>
        <Field.Control value={args} onValueChange={setArgs} placeholder="-y some-mcp-server@1.0.0" spellCheck={false} className={`${inputStyles} font-mono`} />
        <Field.Description className={helpStyles}>Separated by spaces. Pin a version (name@1.2.3) so updates don't change what runs.</Field.Description>
      </Field.Root>
      {error && <Notice tone="danger">{error}</Notice>}
      <div>
        <Button onClick={() => void add()} disabled={!name.trim() || !command.trim()}>
          Add server
        </Button>
      </div>
    </Card>
  );
}

/** MCP servers: extra research tools (literature, trials, medicines, nutrition) the assistant can call. */
export function McpSettings() {
  const [data, setData] = useState<{ presets: readonly McpPreset[]; servers: ServerRow[]; npx: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => localServer.mcp.list.query().then(setData);
  useEffect(() => {
    void load().catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the servers."));
  }, []);

  if (!data) return error ? <Notice tone="danger">{error}</Notice> : <p className="text-ink-2">Loading…</p>;
  const added = new Set(data.servers.map((s) => s.presetId).filter(Boolean));
  const available = data.presets.filter((p) => !added.has(p.id));

  async function addPreset(id: string) {
    setError(null);
    try {
      await localServer.mcp.addPreset.mutate({ presetId: id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add it.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Notice>
        MCP servers give the assistant extra research tools: literature, clinical trials, medicine labels, genes, medical terms, food data. The
        ready-made ones are added and switched on from the start. They run on this computer; the first start downloads them, which can take a
        minute. When Brain calls a source, it receives the tool inputs Brain provides and can contact external services. Source descriptions are not a verified or enforced list of the websites they can contact.
        These switches control the extra MCP tools. Built-in study search and newer-record checks are separate.
      </Notice>
      {!data.npx && (
        <Notice tone="warn" title="Node.js isn't installed">
          The servers need Node.js (the <span className="font-mono text-sm">npx</span> command), so they are switched off. Install Node.js from nodejs.org,
          restart the app, then switch them on here.
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl font-normal">Your servers</h2>
        {data.servers.length === 0 ? (
          <p className="text-ink-2">None yet. Add one from the list below.</p>
        ) : (
          <ul className="stagger flex flex-col gap-3">
            {data.servers.map((s) => (
              <ServerCard key={s.id} server={s} preset={data.presets.find((p) => p.id === s.presetId)} reload={load} />
            ))}
          </ul>
        )}
      </section>

      {available.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-normal">Ready to add</h2>
          <ul className="stagger grid gap-3 md:grid-cols-2">
            {available.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <p className={smallLabel}>{p.category}</p>
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-ink-2">{p.description}</p>
                <p className="text-sm">
                  <span className="font-medium">Sends: </span>
                  <span className="text-ink-2">{p.sends}</span>
                </p>
                <p className="text-xs text-ink-2">
                  <a href={p.repo} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {p.package}@{p.version}
                  </a>{" "}
                  · {p.license}
                  {p.env.some((v) => v.required) && " · needs a free key"}
                </p>
                <div className="mt-auto pt-1">
                  <Button variant="secondary" onClick={() => void addPreset(p.id)}>
                    Add
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AddCustom onAdded={load} />
    </div>
  );
}
