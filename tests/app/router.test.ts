import { describe, expect, it } from "vitest";
import { href, parseHash, type Route } from "../../apps/web/src/app/router";

describe("router", () => {
  it("parses known routes", () => {
    expect(parseHash("")).toEqual({ name: "dashboard" });
    expect(parseHash("#/")).toEqual({ name: "dashboard" });
    expect(parseHash("#/results")).toEqual({ name: "overview" });
    expect(parseHash("#/results?show=out")).toEqual({ name: "overview", show: "out" });
    expect(parseHash("#/results?show=empty")).toEqual({ name: "overview", show: "empty" });
    expect(parseHash("#/results?show=nope")).toEqual({ name: "overview" });
    expect(parseHash("#/add")).toEqual({ name: "add" });
    expect(parseHash("#/add?marker=ferritin")).toEqual({ name: "add", marker: "ferritin" });
    expect(parseHash("#/marker/crp_hs")).toEqual({ name: "marker", id: "crp_hs" });
    expect(parseHash("#/marker/waist?section=waist-to-height")).toEqual({ name: "marker", id: "waist", section: "waist-to-height" });
    expect(parseHash("#/marker/waist?section=<x>")).toEqual({ name: "marker", id: "waist" });
    expect(parseHash("#/data")).toEqual({ name: "data" });
    expect(parseHash("#/settings?tab=mcp")).toEqual({ name: "data", tab: "mcp" });
    expect(parseHash("#/settings?tab=nope")).toEqual({ name: "data" });
    expect(parseHash("#/assistant?ask=Is%20my%20ferritin%20ok%3F")).toEqual({ name: "assistant", ask: "Is my ferritin ok?" });
  });
  it("sends the old log and experiment addresses to Habits", () => {
    expect(parseHash("#/log")).toEqual({ name: "habits" });
    expect(parseHash("#/log?add=Iron")).toEqual({ name: "habits", add: "Iron" });
    expect(parseHash("#/habits?meal=m1")).toEqual({ name: "habits", meal: "m1" });
    expect(parseHash("#/experiments")).toEqual({ name: "habits" });
    expect(parseHash("#/experiments/new?marker=ldl&change=Oats")).toEqual({ name: "habits", add: "Oats", marker: "ldl" });
    expect(parseHash("#/experiments/new")).toEqual({ name: "habits", add: "" });
  });
  it("opens Body from its old Soon address", () => {
    expect(parseHash("#/soon/body")).toEqual({ name: "body" });
    expect(parseHash("#/body?add=1")).toEqual({ name: "add", kind: "body" });
    expect(parseHash("#/add?type=body")).toEqual({ name: "add", kind: "body" });
  });
  it("opens Supplementation and a nutrient", () => {
    expect(parseHash("#/supplements")).toEqual({ name: "supplements" });
    expect(parseHash("#/supplements?kind=mineral")).toEqual({ name: "supplements", kind: "mineral" });
    expect(parseHash("#/supplements?kind=nope")).toEqual({ name: "supplements" });
    expect(parseHash("#/supplements/vitamin_d")).toEqual({ name: "nutrient", id: "vitamin_d" });
    expect(href({ name: "nutrient", id: "iron" })).toBe("#/supplements/iron");
  });
  it("opens Protocols and one protocol", () => {
    expect(parseHash("#/protocols")).toEqual({ name: "plans" });
    expect(parseHash("#/protocols/abc")).toEqual({ name: "plan", id: "abc" });
    expect(href({ name: "plan", id: "abc" })).toBe("#/protocols/abc");
  });
  it("opens Meals, a meal and an example meal", () => {
    expect(parseHash("#/meals")).toEqual({ name: "meals" });
    expect(parseHash("#/meals?section=dark-matter")).toEqual({ name: "meals", section: "dark-matter" });
    expect(parseHash("#/intake")).toEqual({ name: "intake" });

    expect(parseHash("#/meals/abc")).toEqual({ name: "meal", id: "abc" });
    expect(parseHash("#/meals/example/porridge")).toEqual({ name: "example-meal", id: "porridge" });
    expect(href({ name: "example-meal", id: "porridge" })).toBe("#/meals/example/porridge");
  });
  it("treats anything else as not found", () => {
    expect(parseHash("#main")).toEqual({ name: "not-found" });
    expect(parseHash("#/marker")).toEqual({ name: "not-found" });
    expect(parseHash("#/marker/a/b")).toEqual({ name: "not-found" });
  });
  it("round-trips href and parseHash", () => {
    const routes: Route[] = [
      { name: "overview" },
      { name: "overview", show: "out" },
      { name: "overview", show: "in" },
      { name: "add" },
      { name: "add", marker: "b12" },
      { name: "marker", id: "vitamin_d" },
      { name: "intake" },
      { name: "marker", id: "waist", section: "waist-to-height" },
      { name: "data" },
      { name: "phenoage" },
      { name: "import" },
      { name: "habits" },
      { name: "habits", add: "Oats for breakfast" },
      { name: "habits", add: "" },
      { name: "habits", add: "Kiwis & oats", marker: "ferritin" },
      { name: "experiment", id: "abc-123" },
      { name: "data", tab: "models" },
      { name: "dashboard" },
      { name: "soon", section: "devices" },
      { name: "blood" },
      { name: "body" },
      { name: "add", kind: "body" },
      { name: "device-import" },
      { name: "data", tab: "about" },
      { name: "setup" },
      { name: "profiles" },
      { name: "assistant" },
      { name: "assistant", ask: "What affects LDL?" },
    ];
    for (const r of routes) expect(parseHash(href(r))).toEqual(r);
  });
});

import { lowerFirst } from "../../apps/web/src/app/format";

describe("lowerFirst", () => {
  it("lowercases ordinary words but keeps acronyms and letter names", () => {
    expect(lowerFirst("Vitamin C")).toBe("vitamin C");
    expect(lowerFirst("Ferritin")).toBe("ferritin");
    expect(lowerFirst("LDL cholesterol")).toBe("LDL cholesterol");
    expect(lowerFirst("C-reactive protein")).toBe("C-reactive protein");
    expect(lowerFirst("Omega-3 EPA + DHA")).toBe("omega-3 EPA + DHA");
  });
});
