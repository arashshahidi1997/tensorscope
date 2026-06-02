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

// ── refactor-plan N3 — golden values ───────────────────────────────────────
// Lock down a handful of byte-exact LUT samples so future tweaks to the
// anchor interpolation can't drift the rendered ramps unnoticed (canvas
// views can't be visually verified under jsdom).
describe("colormaps — golden LUT samples (N3)", () => {
  it("viridis endpoints are the matplotlib-anchor values rounded to bytes", () => {
    // anchors[0] = (0.267004, 0.004874, 0.329415) → (68, 1, 84)
    // anchors[4] = (0.993248, 0.906157, 0.143936) → (253, 231, 37)
    expect(colormapAt("viridis", 0)).toEqual([68, 1, 84, 255]);
    expect(colormapAt("viridis", 1)).toEqual([253, 231, 37, 255]);
  });

  it("inferno endpoints are the matplotlib-anchor values rounded to bytes", () => {
    // (0.001462, 0.000466, 0.013866) → (0, 0, 4)
    // (0.988362, 0.998364, 0.644924) → (252, 255, 164)
    expect(colormapAt("inferno", 0)).toEqual([0, 0, 4, 255]);
    expect(colormapAt("inferno", 1)).toEqual([252, 255, 164, 255]);
  });

  it("jet anchor at t=0 is the dark-blue point (0, 0, 0.5)", () => {
    expect(colormapAt("jet", 0)).toEqual([0, 0, 128, 255]);
  });

  it("cividis endpoints stay byte-stable", () => {
    expect(colormapAt("cividis", 0)).toEqual([0, 34, 78, 255]);
    expect(colormapAt("cividis", 1)).toEqual([255, 237, 86, 255]);
  });

  it("colormapAt(0) and lut[0..3] agree (LUT is the underlying table)", () => {
    const lut = getColormapLUT("viridis");
    const [r, g, b, a] = colormapAt("viridis", 0);
    expect([lut[0], lut[1], lut[2], lut[3]]).toEqual([r, g, b, a]);
  });
});
