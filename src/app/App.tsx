import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { db, forgetBrowserAiKey, getProfile, isOnboarded } from "../db/db";
import { api, type ServerStatus } from "./api";
import { AppShell, PlainShell } from "./components/AppShell";
import { Notice } from "./components/ui";
import { AddResult } from "./pages/AddResult";
import { DashboardPage } from "./pages/DashboardPage";
import { SoonPage } from "./pages/SoonPage";
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
import { ProfilesContext, createProfile, listProfiles, loadIntoBrowser, loadedProfileId, startSaving, type ProfilesState, type ProfileSummary } from "./profiles";
import { useRoute, type Route } from "./router";

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

  if (b.state === "loading") return <PlainShell>{<p className="animate-fade text-ink-2">Opening…</p>}</PlainShell>;
  if (b.state === "error")
    return (
      <PlainShell>
        <Notice tone="danger" title="The app couldn't start">
          {b.message}
        </Notice>
      </PlainShell>
    );
  if (b.state === "setup")
    return (
      <PlainShell>
        <SetupPage mode={b.mode} first existingResults={b.existing} folderRoot={b.root} />
      </PlainShell>
    );
  if (b.state === "choose")
    return (
      <PlainShell>
        <ProfilesPage choosing={{ profiles: b.profiles }} onNew={() => setB({ state: "setup", mode: "folders", existing: 0, root: b.root })} />
      </PlainShell>
    );

  const ctx: ProfilesState = { mode: b.mode, profiles: b.profiles, active: b.profiles.find((p) => p.id === b.activeId) ?? null, refresh };
  return (
    <ProfilesContext.Provider value={ctx}>
      <AppShell route={route} wide={route.name === "dashboard"}>
        <Suspense fallback={<p className="text-ink-2">Loading…</p>}>
          {/* Keyed by page, so each page fades in when you go to it. */}
          <div key={pageKey(route)} className="animate-enter">
            <Page route={route} root={b.root} mode={b.mode} />
          </div>
        </Suspense>
      </AppShell>
    </ProfilesContext.Provider>
  );
}

function Page({ route, root, mode }: { route: Route; root?: string; mode: "folders" | "browser" }) {
  switch (route.name) {
    case "dashboard":
      return <DashboardPage />;
    case "soon":
      return <SoonPage key={route.section} section={route.section} />;
    case "overview":
      return <Overview show={route.show} />;
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
  if (route.name === "soon") return `soon/${route.section}`;
  return route.name === "marker" || route.name === "experiment" ? `${route.name}/${route.id}` : route.name;
}
