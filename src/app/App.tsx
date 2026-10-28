import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { db, forgetBrowserAiKey, getProfile, isOnboarded } from "../db/db";
import { api, type ServerStatus } from "./api";
import { ProfileMenu } from "./components/ProfileMenu";
import { Notice, cx } from "./components/ui";
import { AddResult } from "./pages/AddResult";
import { SettingsPage } from "./pages/SettingsPage";
import { AssistantPage } from "./pages/AssistantPage";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";
import { PhenoAgePage } from "./pages/PhenoAgePage";
import { ImportPage } from "./pages/ImportPage";
import { LogPage } from "./pages/LogPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { SetupPage } from "./pages/SetupPage";
import { ExperimentPage, ExperimentsPage, NewExperimentPage } from "./pages/ExperimentsPage";
import { ProfilesContext, createProfile, listProfiles, loadIntoBrowser, loadedProfileId, startSaving, useSaveStatus, type ProfilesState, type ProfileSummary } from "./profiles";
import { href, useRoute, type Route } from "./router";

// The chart library is large; load it only when a marker page is opened.
const MarkerPage = lazy(() => import("./pages/MarkerPage").then((m) => ({ default: m.MarkerPage })));

type Boot =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "setup"; mode: "folders" | "browser"; existing: number; root?: string }
  | { state: "choose"; profiles: ProfileSummary[]; root?: string }
  | { state: "ready"; mode: "folders" | "browser"; profiles: ProfileSummary[]; activeId: string | null; root?: string };

/** Works out what to show first: setup, a profile chooser, or the open profile (loaded into this browser). */
async function boot(): Promise<Boot> {
  const server = await api<ServerStatus>("GET", "/api/status").then(
    (s) => (s.app === "biomarker-tracker" ? s : null),
    () => null,
  );
  const existing = await db.measurements.count();
  if (!server) return (await isOnboarded()) ? { state: "ready", mode: "browser", profiles: [], activeId: null } : { state: "setup", mode: "browser", existing };

  const { profiles, active, root } = await listProfiles();
  if (profiles.length === 0) return { state: "setup", mode: "folders", existing, root };
  const loaded = await loadedProfileId();
  // Results in this browser that belong to no folder yet (e.g. entered before profiles existed): keep them as their own profile.
  if (!loaded && (existing > 0 || (await db.protocols.count()) > 0)) {
    const person = await getProfile();
    await createProfile({ ...person, name: person.name || "Saved from this browser" }, { fromBrowser: true });
    return boot();
  }
  if (!active) return { state: "choose", profiles, root };
  if (loaded !== active) await loadIntoBrowser(active);
  startSaving(active);
  return { state: "ready", mode: "folders", profiles, activeId: active, root };
}

export function App() {
  const route = useRoute();
  const [b, setB] = useState<Boot>({ state: "loading" });

  useEffect(() => {
    // API keys used to be kept in the browser; they now live only with the local server.
    void forgetBrowserAiKey();
    boot().then(setB, (e: unknown) => setB({ state: "error", message: e instanceof Error ? e.message : "The app couldn't start." }));
  }, []);

  const refresh = useCallback(async () => {
    if (b.state !== "ready" || b.mode !== "folders") return;
    const { profiles } = await listProfiles();
    setB({ ...b, profiles });
  }, [b]);

  if (b.state === "loading") return <Shell>{<p className="animate-fade text-ink-2">Opening…</p>}</Shell>;
  if (b.state === "error")
    return (
      <Shell>
        <Notice tone="danger" title="The app couldn't start">
          {b.message}
        </Notice>
      </Shell>
    );
  if (b.state === "setup")
    return (
      <Shell mode={b.mode}>
        <SetupPage mode={b.mode} first existingResults={b.existing} folderRoot={b.root} />
      </Shell>
    );
  if (b.state === "choose")
    return (
      <Shell mode="folders">
        <ProfilesPage choosing={{ profiles: b.profiles }} onNew={() => setB({ state: "setup", mode: "folders", existing: 0, root: b.root })} />
      </Shell>
    );

  const ctx: ProfilesState = { mode: b.mode, profiles: b.profiles, active: b.profiles.find((p) => p.id === b.activeId) ?? null, refresh };
  return (
    <ProfilesContext.Provider value={ctx}>
      <Shell header={<Header route={route} />} mode={b.mode}>
        <Suspense fallback={<p className="text-ink-2">Loading…</p>}>
          {/* Keyed by page, so each page fades in when you go to it. */}
          <div key={pageKey(route)} className="animate-enter">
            <Page route={route} root={b.root} mode={b.mode} />
          </div>
        </Suspense>
      </Shell>
    </ProfilesContext.Provider>
  );
}

function Shell({ header, children, mode = "browser" }: { header?: ReactNode; children: ReactNode; mode?: "folders" | "browser" }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* A button, not href="#main": the hash is used for routing. */}
      <button
        type="button"
        onClick={() => document.getElementById("main")?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3"
      >
        Skip to content
      </button>
      {header ?? (
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-4xl items-center px-4 py-2 sm:px-6">
            <Logo />
          </div>
        </header>
      )}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-4xl flex-col gap-1 px-4 py-5 text-sm text-ink-2 sm:px-6">
          <p className="font-medium text-ink">Not medical advice. Not a medical device.</p>
          <p>
            {mode === "folders" ? "Each profile is kept in a folder on this computer." : "Your data stays in this browser."} It's only sent to an AI model when you
            ask the assistant. Free and open source.
          </p>
        </div>
      </footer>
    </div>
  );
}

function Page({ route, root, mode }: { route: Route; root?: string; mode: "folders" | "browser" }) {
  switch (route.name) {
    case "overview":
      return <Overview />;
    case "add":
      // Key resets the form when arriving from a different marker page.
      return <AddResult key={route.marker ?? ""} initialMarker={route.marker} />;
    case "marker":
      // Keyed so switching markers never shows the previous marker's results while loading.
      return <MarkerPage key={route.id} id={route.id} />;
    case "data":
      return <SettingsPage tab={route.tab} />;
    case "assistant":
      return <AssistantPage key={route.ask ?? ""} ask={route.ask} />;
    case "phenoage":
      return <PhenoAgePage />;
    case "import":
      return <ImportPage />;
    case "log":
      return <LogPage key={route.add ?? ""} prefill={route.add} />;
    case "experiments":
      return <ExperimentsPage />;
    case "experiment-new":
      return <NewExperimentPage key={`${route.marker}|${route.change}`} marker={route.marker} change={route.change} />;
    case "experiment":
      return <ExperimentPage key={route.id} id={route.id} />;
    case "setup":
      return <SetupPage mode={mode} first={false} existingResults={0} folderRoot={root} />;
    case "profiles":
      return <ProfilesPage />;
    case "not-found":
      return <NotFound />;
  }
}

/** Same page (e.g. another settings tab) keeps its key, so only real page changes animate. */
function pageKey(route: Route): string {
  return route.name === "marker" || route.name === "experiment" ? `${route.name}/${route.id}` : route.name;
}

function Logo() {
  return (
    <a href={href({ name: "overview" })} className="flex min-h-11 items-center gap-2 font-serif text-xl text-ink no-underline">
      <img src="./favicon.svg" alt="" width={28} height={28} />
      Biomarker Tracker
    </a>
  );
}

function Header({ route }: { route: Route }) {
  const save = useSaveStatus();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2 lg:order-last">
          <ProfileMenu />
        </div>
        <nav aria-label="Main" className="-mx-1.5 flex w-full max-w-full overflow-x-auto sm:-mx-2 lg:w-auto">
          <NavLink to={{ name: "overview" }} active={route.name === "overview" || route.name === "marker"}>
            Results
          </NavLink>
          <NavLink to={{ name: "add" }} active={route.name === "add" || route.name === "import"}>
            Add
          </NavLink>
          <NavLink to={{ name: "log" }} active={route.name === "log" || route.name.startsWith("experiment")}>
            Log
          </NavLink>
          <NavLink to={{ name: "phenoage" }} active={route.name === "phenoage"}>
            Bio age
          </NavLink>
          <NavLink to={{ name: "assistant" }} active={route.name === "assistant"}>
            Ask
          </NavLink>
          <NavLink to={{ name: "data" }} active={route.name === "data"}>
            Settings
          </NavLink>
        </nav>
      </div>
      {save === "error" && (
        <p role="alert" className="bg-danger-soft px-4 py-2 text-center text-sm text-danger">
          Couldn't save to the profile folder. Is the app's server still running? Your changes are kept here and saved when it's back.
        </p>
      )}
    </header>
  );
}

function NavLink({ to, active, children }: { to: Route; active: boolean; children: ReactNode }) {
  return (
    <a
      href={href(to)}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex min-h-11 shrink-0 items-center rounded-lg px-1.5 whitespace-nowrap no-underline transition-colors duration-200 sm:px-3",
        active ? "font-semibold text-accent" : "text-ink-2 hover:bg-sunken hover:text-ink",
      )}
    >
      {children}
    </a>
  );
}
