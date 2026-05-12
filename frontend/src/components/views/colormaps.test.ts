import { describe, it, expect } from "vitest";
import { colormapAt, getColormapLUT, colormapCss } from "./colormaps";

describe("colormaps", () => {
  it("jet endpoints match the canonical dark-blue → dark-red ramp", () => {
    const [r0, g0, b0] = colormapAt("jet", 0);
    const [r1, g1, b1] = colormapAt("jet", 1);
    // jet starts at dark blue (~0,0,127) and ends at dark red (~127,0,0)
    expect(b0).toBeGreaterThan(100);
    expect(r0).toBeLessThan(20);
    expect(r1).toBeGreaterThan(100);
    expect(b1).toBeLessThan(20);
    // Mid-jet should be green-ish
    const [, gMid] = colormapAt("jet", 0.5);
    expect(gMid).toBeGreaterThan(150);
  });

  it("viridis endpoints match matplotlib's purple → yellow ramp", () => {
    const [r0, g0, b0] = colormapAt("viridis", 0);
    const [r1, g1, b1] = colormapAt("viridis", 1);
    // viridis(0) ≈ (68, 1, 84) — dark purple
    expect(r0).toBeLessThan(100);
    expect(b0).toBeGreaterThan(70);
    expect(g0).toBeLessThan(20);
    // viridis(1) ≈ (253, 231, 37) — yellow
    expect(r1).toBeGreaterThan(240);
    expect(g1).toBeGreaterThan(220);
    expect(b1).toBeLessThan(60);
  });

  it("inferno is monotonically brighter (sum of channels grows with t)", () => {
    const sum0 = colormapAt("inferno", 0).slice(0, 3).reduce((a, b) => a + b, 0);
    const sumMid = colormapAt("inferno", 0.5).slice(0, 3).reduce((a, b) => a + b, 0);
    const sum1 = colormapAt("inferno", 1).slice(0, 3).reduce((a, b) => a + b, 0);
    expect(sumMid).toBeGreaterThan(sum0);
    expect(sum1).toBeGreaterThan(sumMid);
  });

  it("cividis is monotonically brighter and red→yellow at the top", () => {
    const sum0 = colormapAt("cividis", 0).slice(0, 3).reduce((a, b) => a + b, 0);
    const sum1 = colormapAt("cividis", 1).slice(0, 3).reduce((a, b) => a + b, 0);
    expect(sum1).toBeGreaterThan(sum0);
    const [r1, g1] = colormapAt("cividis", 1);
    expect(r1).toBeGreaterThan(220);
    expect(g1).toBeGreaterThan(180);
  });

  it("clamps t outside [0, 1]", () => {
    expect(colormapAt("jet", -5)).toEqual(colormapAt("jet", 0));
    expect(colormapAt("jet", 5)).toEqual(colormapAt("jet", 1));
  });

  it("getColormapLUT returns 256×4 RGBA bytes", () => {
    const lut = getColormapLUT("viridis");
    expect(lut.length).toBe(256 * 4);
    // Alpha is 255 across the table
    for (let i = 3; i < lut.length; i += 4) {
      expect(lut[i]).toBe(255);
    }
  });

  it("colormapCss returns a valid rgb() string", () => {
    expect(colormapCss("jet", 0)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it("falls back to sequential for unknown names", () => {
    const fallback = colormapAt("unknown" as never, 0.5);
    const seq = colormapAt("sequential", 0.5);
    expect(fallback).toEqual(seq);
  });
});
