import { useEffect, useState } from "react";

// Hash routing: works without server rewrites.

export type SettingsTab = "data" | "models" | "skills" | "mcp" | "appearance" | "about";
const TABS: readonly SettingsTab[] = ["data", "models", "skills", "mcp", "appearance", "about"];

export type SoonSection = "body" | "devices";

export type Route =
  | { name: "dashboard" }
  | { name: "overview" }
  | { name: "soon"; section: SoonSection }
  | { name: "add"; marker?: string }
  | { name: "marker"; id: string }
  | { name: "data"; tab?: SettingsTab }
  | { name: "assistant"; ask?: string }
  | { name: "phenoage" }
  | { name: "import" }
  | { name: "log"; add?: string }
  | { name: "experiments" }
  | { name: "experiment-new"; marker?: string; change?: string }
  | { name: "experiment"; id: string }
  | { name: "setup" }
  | { name: "profiles" }
  | { name: "not-found" };

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  if (parts.length === 0) return { name: "dashboard" };
  if (parts[0] === "results" && parts.length === 1) return { name: "overview" };
  if (parts[0] === "soon" && (parts[1] === "body" || parts[1] === "devices") && parts.length === 2) return { name: "soon", section: parts[1] };
  if (parts[0] === "add" && parts.length === 1) {
    const marker = params.get("marker");
    return marker ? { name: "add", marker } : { name: "add" };
  }
  if (parts[0] === "marker" && parts[1] && parts.length === 2) return { name: "marker", id: parts[1] };
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
  if (parts[0] === "experiments" && parts.length === 1) return { name: "experiments" };
  if (parts[0] === "experiments" && parts[1] === "new" && parts.length === 2) {
    const r: Route = { name: "experiment-new" };
    const marker = params.get("marker");
    const change = params.get("change");
    return { ...r, ...(marker ? { marker } : {}), ...(change ? { change } : {}) };
  }
  if (parts[0] === "experiment" && parts[1] && parts.length === 2) return { name: "experiment", id: parts[1] };
  if (parts[0] === "log" && parts.length === 1) {
    const add = params.get("add");
    return add ? { name: "log", add } : { name: "log" };
  }
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
      return "#/results";
    case "soon":
      return `#/soon/${route.section}`;
    case "add":
      return route.marker ? `#/add?marker=${encodeURIComponent(route.marker)}` : "#/add";
    case "marker":
      return `#/marker/${encodeURIComponent(route.id)}`;
    case "data":
      return route.tab ? `#/settings?tab=${route.tab}` : "#/settings";
    case "assistant":
      return route.ask ? `#/assistant?ask=${encodeURIComponent(route.ask)}` : "#/assistant";
    case "phenoage":
      return "#/biological-age";
    case "import":
      return "#/import";
    case "experiments":
      return "#/experiments";
    case "experiment-new": {
      const q = new URLSearchParams();
      if (route.marker) q.set("marker", route.marker);
      if (route.change) q.set("change", route.change);
      const qs = q.toString();
      return qs ? `#/experiments/new?${qs}` : "#/experiments/new";
    }
    case "experiment":
      return `#/experiment/${encodeURIComponent(route.id)}`;
    case "log":
      return route.add ? `#/log?add=${encodeURIComponent(route.add)}` : "#/log";
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
