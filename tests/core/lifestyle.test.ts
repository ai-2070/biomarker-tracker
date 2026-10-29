import { describe, expect, it } from "vitest";
import { barsDomain, intervalRows, labelAnchor, labelRows, scalePosition, wavelengthRgb } from "../../src/core/lifestyle";

describe("lifestyle drawing helpers", () => {
  it("gives visible light a colour and nothing outside it", () => {
    expect(wavelengthRgb(379)).toBeUndefined();
    expect(wavelengthRgb(850)).toBeUndefined();
    const red = wavelengthRgb(660)!;
    expect(red[0]).toBeGreaterThan(200);
    expect(red[1]).toBe(0);
    const green = wavelengthRgb(530)!;
    expect(green[1]).toBeGreaterThan(green[0]);
    // Dimmer towards the ends of what the eye sees.
    expect(wavelengthRgb(740)![0]).toBeLessThan(red[0]);
  });

  it("puts ratios on a log scale, so halving and doubling are equally far from 1", () => {
    expect(scalePosition(1, 0.5, 2, true)).toBeCloseTo(0.5);
    expect(scalePosition(0.5, 0.5, 2, true)).toBe(0);
    expect(scalePosition(5, 0, 10, false)).toBe(0.5);
    expect(scalePosition(20, 0, 10, false)).toBe(1);
  });

  it("makes a scale that holds every interval and the reference line", () => {
    const d = barsDomain({ scale: "ratio", reference: { value: 1, label: "ref" }, items: [{ label: "a", value: 0.8, low: 0.7, high: 0.9 }, { label: "b", value: 0.6, low: 0.5, high: 0.72 }] });
    expect(d.min).toBeLessThan(0.5);
    expect(d.max).toBeGreaterThan(1);
    const l = barsDomain({ scale: "linear", items: [{ label: "a", value: 4 }, { label: "b", value: 10, high: 12 }] });
    expect(l.min).toBe(0);
    expect(l.max).toBeGreaterThan(12);
  });

  it("stacks labels that would overlap into rows", () => {
    expect(labelRows([0.1, 0.12, 0.5, 0.13], 0.05)).toEqual([0, 1, 0, 2]);
    expect(labelRows([0.9, 0.1], 0.05)).toEqual([0, 0]);
  });

  it("puts overlapping ranges on separate rows, and touching ones on the same row", () => {
    expect(intervalRows([{ from: 0, to: 0.3 }, { from: 0.3, to: 0.5 }, { from: 0.2, to: 0.9 }, { from: 0.6, to: 1 }])).toEqual([0, 0, 1, 0]);
  });

  it("anchors labels at the edges so they stay inside", () => {
    expect(labelAnchor(0.01)).toBe("start");
    expect(labelAnchor(0.5)).toBe("middle");
    expect(labelAnchor(0.99)).toBe("end");
  });
});
