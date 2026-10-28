import { describe, expect, it } from "vitest";
import { href, parseHash, type Route } from "../../src/app/router";

describe("router", () => {
  it("parses known routes", () => {
    expect(parseHash("")).toEqual({ name: "dashboard" });
    expect(parseHash("#/")).toEqual({ name: "dashboard" });
    expect(parseHash("#/results")).toEqual({ name: "overview" });
    expect(parseHash("#/results?show=out")).toEqual({ name: "overview", show: "out" });
    expect(parseHash("#/results?show=nope")).toEqual({ name: "overview" });
    expect(parseHash("#/add")).toEqual({ name: "add" });
    expect(parseHash("#/add?marker=ferritin")).toEqual({ name: "add", marker: "ferritin" });
    expect(parseHash("#/marker/crp_hs")).toEqual({ name: "marker", id: "crp_hs" });
    expect(parseHash("#/data")).toEqual({ name: "data" });
    expect(parseHash("#/settings?tab=mcp")).toEqual({ name: "data", tab: "mcp" });
    expect(parseHash("#/settings?tab=nope")).toEqual({ name: "data" });
    expect(parseHash("#/assistant?ask=Is%20my%20ferritin%20ok%3F")).toEqual({ name: "assistant", ask: "Is my ferritin ok?" });
  });
  it("sends the old log and experiment addresses to Habits", () => {
    expect(parseHash("#/log")).toEqual({ name: "habits" });
    expect(parseHash("#/log?add=Iron")).toEqual({ name: "habits", add: "Iron" });
    expect(parseHash("#/experiments")).toEqual({ name: "habits" });
    expect(parseHash("#/experiments/new?marker=ldl&change=Oats")).toEqual({ name: "habits", add: "Oats", marker: "ldl" });
    expect(parseHash("#/experiments/new")).toEqual({ name: "habits", add: "" });
  });
  it("opens Body from its old Soon address", () => {
    expect(parseHash("#/soon/body")).toEqual({ name: "body" });
    expect(parseHash("#/body?add=1")).toEqual({ name: "body", add: true });
  });
  it("treats anything else as not found", () => {
    expect(parseHash("#main")).toEqual({ name: "not-found" });
    expect(parseHash("#/marker")).toEqual({ name: "not-found" });
    expect(parseHash("#/marker/a/b")).toEqual({ name: "not-found" });
  });
  it("round-trips href and parseHash", () => {
    const routes: Route[] = [{ name: "overview" }, { name: "overview", show: "out" }, { name: "overview", show: "in" }, { name: "add" }, { name: "add", marker: "b12" }, { name: "marker", id: "vitamin_d" }, { name: "data" }, { name: "phenoage" }, { name: "import" }, { name: "habits" }, { name: "habits", add: "Oats for breakfast" }, { name: "habits", add: "" },
      { name: "habits", add: "Kiwis & oats", marker: "ferritin" },
      { name: "experiment", id: "abc-123" },
      { name: "data", tab: "models" },
      { name: "dashboard" },
      { name: "soon", section: "devices" },
      { name: "blood" },
      { name: "body" },
      { name: "body", add: true },
      { name: "data", tab: "about" },
      { name: "setup" },
      { name: "profiles" },
      { name: "assistant" },
      { name: "assistant", ask: "What affects LDL?" },
    ];
    for (const r of routes) expect(parseHash(href(r))).toEqual(r);
  });
});

import { lowerFirst } from "../../src/app/format";

describe("lowerFirst", () => {
  it("lowercases ordinary words but keeps acronyms and letter names", () => {
    expect(lowerFirst("Vitamin C")).toBe("vitamin C");
    expect(lowerFirst("Ferritin")).toBe("ferritin");
    expect(lowerFirst("LDL cholesterol")).toBe("LDL cholesterol");
    expect(lowerFirst("C-reactive protein")).toBe("C-reactive protein");
    expect(lowerFirst("Omega-3 EPA + DHA")).toBe("omega-3 EPA + DHA");
  });
});
