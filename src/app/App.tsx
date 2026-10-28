import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { forgetBrowserAiKey } from "../db/db";
import { Onboarding } from "./components/Onboarding";
import { cx } from "./components/ui";
import { AddResult } from "./pages/AddResult";
import { SettingsPage } from "./pages/SettingsPage";
import { AssistantPage } from "./pages/AssistantPage";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";
import { PhenoAgePage } from "./pages/PhenoAgePage";
import { ImportPage } from "./pages/ImportPage";
import { LogPage } from "./pages/LogPage";
import { ExperimentPage, ExperimentsPage, NewExperimentPage } from "./pages/ExperimentsPage";
import { href, useRoute, type Route } from "./router";

// The chart library is large; load it only when a marker page is opened.
const MarkerPage = lazy(() => import("./pages/MarkerPage").then((m) => ({ default: m.MarkerPage })));

export function App() {
  const route = useRoute();
  // API keys used to be kept in the browser; they now live only with the local server.
  useEffect(() => {
    void forgetBrowserAiKey();
  }, []);
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
      <Header route={route} />
      <main id="main" tabIndex={-1} className="mx-auto outline-none w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Suspense fallback={<p className="text-ink-2">Loading…</p>}>
          <Page route={route} />
        </Suspense>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-4xl flex-col gap-1 px-4 py-5 text-sm text-ink-2 sm:px-6">
          <p className="font-medium text-ink">Not medical advice. Not a medical device.</p>
          <p>Your data stays in this browser. It's only sent to an AI model when you ask the assistant. Free and open source.</p>
        </div>
      </footer>
      <Onboarding />
    </div>
  );
}

function Page({ route }: { route: Route }) {
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
    case "not-found":
      return <NotFound />;
  }
}

function Header({ route }: { route: Route }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <a href={href({ name: "overview" })} className="flex min-h-11 items-center gap-2 font-serif text-xl text-ink no-underline">
          <img src="./favicon.svg" alt="" width={28} height={28} />
          Biomarker Tracker
        </a>
        <nav aria-label="Main" className="-mx-1.5 flex max-w-full overflow-x-auto sm:-mx-2">
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
    </header>
  );
}

function NavLink({ to, active, children }: { to: Route; active: boolean; children: ReactNode }) {
  return (
    <a
      href={href(to)}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex min-h-11 shrink-0 items-center rounded-lg px-1.5 whitespace-nowrap no-underline transition-colors sm:px-3",
        active ? "font-semibold text-accent" : "text-ink-2 hover:bg-sunken hover:text-ink",
      )}
    >
      {children}
    </a>
  );
}
