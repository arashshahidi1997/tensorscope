import { describe, it, expect } from "vitest";
import { makeTicks, makeLogTicks } from "./AxisTicks";

describe("makeTicks (linear)", () => {
  it("produces evenly spaced nice ticks", () => {
    const ticks = makeTicks(0, 100, 4);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.every((t) => t.value >= 0 && t.value <= 100)).toBe(true);
  });

  it("returns [] for invalid bounds", () => {
    expect(makeTicks(10, 5)).toEqual([]);
    expect(makeTicks(NaN, 10)).toEqual([]);
  });
});

describe("makeLogTicks", () => {
  it("emits decade-aligned ticks across multiple decades", () => {
    const ticks = makeLogTicks(1, 1000);
    const values = ticks.map((t) => t.value);
    expect(values).toContain(1);
    expect(values).toContain(10);
    expect(values).toContain(100);
    expect(values).toContain(1000);
  });

  it("positions ticks linearly along log10 axis", () => {
    const ticks = makeLogTicks(1, 100);
    // 1 sits at 0%, 100 at 100%, 10 at 50%
    const t1 = ticks.find((t) => t.value === 1);
    const t10 = ticks.find((t) => t.value === 10);
    const t100 = ticks.find((t) => t.value === 100);
    expect(t1!.pct).toBeCloseTo(0, 5);
    expect(t10!.pct).toBeCloseTo(50, 5);
    expect(t100!.pct).toBeCloseTo(100, 5);
  });

  it("adds 2× / 5× sub-decade ticks for narrow spans (< 2 decades)", () => {
    const ticks = makeLogTicks(1, 50);
    const values = ticks.map((t) => t.value);
    // span is ~1.7 decades, should include 2 and 5 within decade 0 and 10
    expect(values).toContain(2);
    expect(values).toContain(5);
    expect(values).toContain(20);
    expect(values).toContain(50);
  });

  it("uses decade-only ticks for wide spans (>= 2 decades)", () => {
    const ticks = makeLogTicks(1, 1000);
    const values = ticks.map((t) => t.value);
    // 2 and 5 should not appear when sub-decade ticks are suppressed
    expect(values).not.toContain(2);
    expect(values).not.toContain(5);
  });

  it("returns [] when lo <= 0 (log undefined)", () => {
    expect(makeLogTicks(0, 100)).toEqual([]);
    expect(makeLogTicks(-1, 10)).toEqual([]);
  });

  it("clips ticks to the visible window", () => {
    const ticks = makeLogTicks(3, 30);
    expect(ticks.every((t) => t.value >= 3 && t.value <= 30)).toBe(true);
  });
});
