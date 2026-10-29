import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { db, forgetBrowserAiKey, getProfile, isOnboarded } from "../db/db";
import { api, type ServerStatus } from "./api";
import { AppShell, PlainShell } from "./components/AppShell";
import { Notice } from "./components/ui";
import { AddResult } from "./pages/AddResult";
import { IntakePage } from "./pages/IntakePage";
import { BloodDashboardPage } from "./pages/DashboardPage";
import { BodyPage } from "./pages/BodyPage";
import { DeviceImportPage } from "./pages/DeviceImportPage";
import { HomePage } from "./pages/HomePage";
import { SoonPage } from "./pages/SoonPage";
import { SettingsPage } from "./pages/SettingsPage";
import { openBrain } from "./brain/store";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";
import { PhenoAgePage } from "./pages/PhenoAgePage";
import { ImportPage } from "./pages/ImportPage";
import { HabitsPage } from "./pages/HabitsPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { SetupPage } from "./pages/SetupPage";
import { ExperimentPage } from "./pages/ExperimentsPage";
import { ProfilesContext, createProfile, listProfiles, loadIntoBrowser, loadedProfileId, startSaving, type ProfilesState, type ProfileSummary } from "./profiles";
import { href, useRoute, type Route } from "./router";

// The chart library is large; load it only when a marker page is opened.
const MarkerPage = lazy(() => import("./pages/MarkerPage").then((m) => ({ default: m.MarkerPage })));
const SupplementsPage = lazy(() => import("./pages/SupplementsPage").then((m) => ({ default: m.SupplementsPage })));
const NutrientPage = lazy(() => import("./pages/NutrientPage").then((m) => ({ default: m.NutrientPage })));
const PlansPage = lazy(() => import("./pages/PlansPage").then((m) => ({ default: m.PlansPage })));
const PlanPage = lazy(() => import("./pages/PlanPage").then((m) => ({ default: m.PlanPage })));
const MealsPage = lazy(() => import("./pages/MealsPage").then((m) => ({ default: m.MealsPage })));
const MealPage = lazy(() => import("./pages/MealPage").then((m) => ({ default: m.MealPage })));

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
      {/* Every page uses the dashboard width; pages keep text at a readable measure and use the room for side columns. */}
      <AppShell route={route} wide>
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
      return <HomePage />;
    case "blood":
      return <BloodDashboardPage />;
    case "body":
      return <BodyPage />;
    case "device-import":
      return <DeviceImportPage />;
    case "soon":
      return <SoonPage key={route.section} section={route.section} />;
    case "overview":
      return <Overview show={route.show} />;
    case "add":
      // Key resets the form when arriving from a different marker page.
      return <AddResult key={`${route.kind ?? ""}|${route.marker ?? ""}`} initialMarker={route.marker} initialKind={route.kind} />;
    case "marker":
      // Keyed so switching markers never shows the previous marker's results while loading.
      return <MarkerPage key={route.id} id={route.id} section={route.section} />;
    case "data":
      return <SettingsPage tab={route.tab} />;
    case "assistant":
      return <OpenBrain ask={route.ask} />;
    case "phenoage":
      return <PhenoAgePage />;
    case "import":
      return <ImportPage />;
    case "habits":
      // Keyed so a new "add" link opens a fresh form.
      return <HabitsPage key={`${route.add ?? ""}|${route.marker ?? ""}`} add={route.add} marker={route.marker} />;
    case "experiment":
      return <ExperimentPage key={route.id} id={route.id} />;
    case "supplements":
      return <SupplementsPage kind={route.kind} />;
    case "nutrient":
      return <NutrientPage key={route.id} id={route.id} />;
    case "plans":
      return <PlansPage />;
    case "plan":
      return <PlanPage key={route.id} id={route.id} />;
    case "meals":
      return <MealsPage key={route.section ?? ""} section={route.section} />;
    case "intake":
      return <IntakePage />;
    case "meal":
      return <MealPage key={route.id} id={route.id} />;
    case "example-meal":
      return <MealPage key={`example-${route.id}`} id={route.id} example />;
    case "setup":
      return <SetupPage mode={mode} first={false} existingResults={0} folderRoot={root} />;
    case "profiles":
      return <ProfilesPage />;
    case "not-found":
      return <NotFound />;
  }
}

/** Same page (e.g. another settings tab) keeps its key, so only real page changes animate. */
/** Old "Ask" links (#/assistant?ask=…): open Brain over the dashboard. */
function OpenBrain({ ask }: { ask?: string }) {
  useEffect(() => {
    openBrain(ask ? { draft: ask } : {});
    location.replace(href({ name: "dashboard" }));
  }, [ask]);
  return null;
}

function pageKey(route: Route): string {
  if (route.name === "soon") return `soon/${route.section}`;
  return route.name === "marker" || route.name === "experiment" || route.name === "nutrient" || route.name === "plan" || route.name === "meal" || route.name === "example-meal" ? `${route.name}/${route.id}` : route.name;
}
