import { useEffect, useState } from "react";

// Hash routing: works without server rewrites.

export type SettingsTab = "data" | "models" | "skills" | "mcp" | "appearance" | "about";
const TABS: readonly SettingsTab[] = ["data", "models", "skills", "mcp", "appearance", "about"];

export type SoonSection = "devices";

/** Which blood test markers the list shows: all, only out of range, or only in range. */
export type ResultsFilter = "out" | "in";

export type Route =
  | { name: "dashboard" }
  /** The blood tests dashboard. */
  | { name: "blood" }
  /** Body measurements; `add` opens the entry form. */
  | { name: "body" }
  /** Reading export files from watches, rings and phone apps. */
  | { name: "device-import" }
  | { name: "overview"; show?: ResultsFilter }
  | { name: "soon"; section: SoonSection }
  | { name: "add"; marker?: string; kind?: "body" }
  | { name: "marker"; id: string; section?: string }
  | { name: "data"; tab?: SettingsTab }
  | { name: "assistant"; ask?: string }
  | { name: "phenoage" }
  | { name: "import" }
  /** Supplements, food, medicines and routines. `add` opens the form (with this name); `marker` is pre-ticked to watch. */
  | { name: "habits"; add?: string; marker?: string; meal?: string }
  | { name: "experiment"; id: string }
  | { name: "supplements"; kind?: "vitamin" | "mineral" }
  | { name: "nutrient"; id: string }
  | { name: "plans" }
  | { name: "plan"; id: string }
  | { name: "meals"; section?: string }
  | { name: "intake" }
  | { name: "meal"; id: string }
  | { name: "example-meal"; id: string }
  | { name: "setup" }
  | { name: "profiles" }
  | { name: "not-found" };

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  if (parts.length === 0) return { name: "dashboard" };
  if (parts[0] === "results" && parts.length === 1) {
    const show = params.get("show");
    return show === "out" || show === "in" ? { name: "overview", show } : { name: "overview" };
  }
  if (parts[0] === "soon" && parts[1] === "devices" && parts.length === 2) return { name: "soon", section: "devices" };
  if (parts[0] === "blood" && parts.length === 1) return { name: "blood" };
  if (parts[0] === "body" && parts[1] === "import" && parts.length === 2) return { name: "device-import" };
  if ((parts[0] === "body" && parts.length === 1) || (parts[0] === "soon" && parts[1] === "body" && parts.length === 2)) return params.has("add") ? { name: "add", kind: "body" } : { name: "body" };
  if (parts[0] === "add" && parts.length === 1) {
    const marker = params.get("marker");
    if (params.get("type") === "body") return { name: "add", kind: "body" };
    return marker ? { name: "add", marker } : { name: "add" };
  }
  if (parts[0] === "marker" && parts[1] && parts.length === 2) {
    const section = params.get("section");
    return section && /^[a-z-]{1,40}$/.test(section) ? { name: "marker", id: parts[1], section } : { name: "marker", id: parts[1] };
  }
  if ((parts[0] === "data" || parts[0] === "settings") && parts.length === 1) {
    const tab = params.get("tab");
    return tab && (TABS as readonly string[]).includes(tab) ? { name: "data", tab: tab as SettingsTab } : { name: "data" };
  }
  if (parts[0] === "assistant" && parts.length === 1) {
    const ask = params.get("ask");
    return ask ? { name: "assistant", ask } : { name: "assistant" };
  }
  if (parts[0] === "biological-age" && parts.length === 1) return { name: "phenoage" };
  if (parts[0] === "setup" && parts.length === 1) return { name: "setup" };
  if (parts[0] === "profiles" && parts.length === 1) return { name: "profiles" };
  if (parts[0] === "import" && parts.length === 1) return { name: "import" };
  if ((parts[0] === "habits" || parts[0] === "experiments" || parts[0] === "log") && parts.length === 1) {
    // Old addresses: the log (?add=) and the experiments list both became Habits.
    const add = params.get("add");
    const marker = params.get("marker");
    const meal = params.get("meal");
    return { name: "habits", ...(add !== null ? { add } : {}), ...(marker ? { marker } : {}), ...(meal ? { meal } : {}) };
  }
  if (parts[0] === "experiments" && parts[1] === "new" && parts.length === 2) {
    const marker = params.get("marker");
    return { name: "habits", add: params.get("change") ?? "", ...(marker ? { marker } : {}) };
  }
  if (parts[0] === "experiment" && parts[1] && parts.length === 2) return { name: "experiment", id: parts[1] };
  if (parts[0] === "supplements" && parts.length === 1) {
    const kind = params.get("kind");
    return kind === "vitamin" || kind === "mineral" ? { name: "supplements", kind } : { name: "supplements" };
  }
  if (parts[0] === "supplements" && parts[1] && parts.length === 2) return { name: "nutrient", id: parts[1] };
  if (parts[0] === "protocols" && parts.length === 1) return { name: "plans" };
  if (parts[0] === "protocols" && parts[1] && parts.length === 2) return { name: "plan", id: parts[1] };
  if (parts[0] === "intake" && parts.length === 1) return { name: "intake" };
  if (parts[0] === "meals" && parts.length === 1) {
    const section = params.get("section");
    return section && /^[a-z-]{1,40}$/.test(section) ? { name: "meals", section } : { name: "meals" };
  }
  if (parts[0] === "meals" && parts[1] === "example" && parts[2] && parts.length === 3) return { name: "example-meal", id: parts[2] };
  if (parts[0] === "meals" && parts[1] && parts.length === 2) return { name: "meal", id: parts[1] };
  return { name: "not-found" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "setup":
      return "#/setup";
    case "profiles":
      return "#/profiles";
    case "dashboard":
      return "#/";
    case "overview":
      return route.show ? `#/results?show=${route.show}` : "#/results";
    case "soon":
      return `#/soon/${route.section}`;
    case "blood":
      return "#/blood";
    case "body":
      return "#/body";
    case "device-import":
      return "#/body/import";
    case "add":
      return route.kind === "body" ? "#/add?type=body" : route.marker ? `#/add?marker=${encodeURIComponent(route.marker)}` : "#/add";
    case "marker":
      return `#/marker/${encodeURIComponent(route.id)}${route.section ? `?section=${route.section}` : ""}`;
    case "data":
      return route.tab ? `#/settings?tab=${route.tab}` : "#/settings";
    case "assistant":
      return route.ask ? `#/assistant?ask=${encodeURIComponent(route.ask)}` : "#/assistant";
    case "phenoage":
      return "#/biological-age";
    case "import":
      return "#/import";
    case "habits": {
      const q = new URLSearchParams();
      if (route.add !== undefined) q.set("add", route.add);
      if (route.marker) q.set("marker", route.marker);
      if (route.meal) q.set("meal", route.meal);
      const qs = q.toString();
      return qs ? `#/habits?${qs}` : "#/habits";
    }
    case "experiment":
      return `#/experiment/${encodeURIComponent(route.id)}`;
    case "supplements":
      return route.kind ? `#/supplements?kind=${route.kind}` : "#/supplements";
    case "nutrient":
      return `#/supplements/${encodeURIComponent(route.id)}`;
    case "plans":
      return "#/protocols";
    case "plan":
      return `#/protocols/${encodeURIComponent(route.id)}`;
    case "meals":
      return route.section ? `#/meals?section=${route.section}` : "#/meals";
    case "intake":
      return "#/intake";
    case "meal":
      return `#/meals/${encodeURIComponent(route.id)}`;
    case "example-meal":
      return `#/meals/example/${encodeURIComponent(route.id)}`;
    case "not-found":
      return "#/";
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
