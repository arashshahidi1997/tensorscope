import { describe, expect, it } from "vitest";
import { channelStats, zscoredCrossChannelMean } from "./navigatorMean";

describe("channelStats (refactor-plan N3)", () => {
  it("computes mean, population std, and finite count", () => {
    const s = channelStats([1, 2, 3, 4]);
    expect(s.mean).toBeCloseTo(2.5, 10);
    expect(s.std).toBeCloseTo(Math.sqrt(1.25), 10); // sqrt(((1.5^2)*2 + (0.5^2)*2)/4)
    expect(s.count).toBe(4);
  });

  it("skips NaN and ±Infinity", () => {
    const s = channelStats([1, NaN, 3, Infinity, 5, -Infinity]);
    expect(s.mean).toBeCloseTo(3, 10); // (1+3+5)/3
    expect(s.std).toBeCloseTo(Math.sqrt(8 / 3), 10);
    expect(s.count).toBe(3);
  });

  it("reports std 0 for a single finite sample (no usable variance)", () => {
    const s = channelStats([7, NaN]);
    expect(s.mean).toBeCloseTo(7, 10);
    expect(s.std).toBe(0);
    expect(s.count).toBe(1);
  });

  it("reports zeros for an empty / fully-masked channel", () => {
    expect(channelStats([])).toEqual({ mean: 0, std: 0, count: 0 });
    expect(channelStats([NaN, Infinity])).toEqual({ mean: 0, std: 0, count: 0 });
  });

  it("handles a Float32Array (the production input type)", () => {
    const s = channelStats(new Float32Array([0, 2]));
    expect(s.mean).toBeCloseTo(1, 6);
    expect(s.std).toBeCloseTo(1, 6);
  });
});

describe("zscoredCrossChannelMean (refactor-plan N3)", () => {
  it("equalizes a loud and a quiet channel (the whole point of the z-score)", () => {
    // ch0 swings 0..2, ch1 swings 0..100 — a raw mean would be dominated by
    // ch1, but z-scoring first gives each channel the same -1..+1 swing.
    const out = zscoredCrossChannelMean(
      [{ values: [0, 2] }, { values: [0, 100] }],
      2,
    );
    expect(Array.from(out)).toEqual([-1, 1]);
  });

  it("drops flat channels (std 0) instead of dividing by zero", () => {
    const out = zscoredCrossChannelMean(
      [{ values: [1, 1, 1] }, { values: [0, 3, 6] }],
      3,
    );
    const k = Math.sqrt(6); // std of [0,3,6]
    expect(out[0]).toBeCloseTo(-3 / k, 10);
    expect(out[1]).toBeCloseTo(0, 10);
    expect(out[2]).toBeCloseTo(3 / k, 10);
  });

  it("yields NaN where no channel has usable variance (uPlot gaps it)", () => {
    const out = zscoredCrossChannelMean(
      [{ values: [5, 5] }, { values: [2, 2] }],
      2,
    );
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  it("averages only the channels finite at each time index", () => {
    // ch0 has a NaN at t1, so t1 is ch1-only.
    const out = zscoredCrossChannelMean(
      [{ values: [0, NaN, 2] }, { values: [0, 50, 100] }],
      3,
    );
    const k1 = Math.sqrt(5000 / 3); // std of [0,50,100]
    expect(out[0]).toBeCloseTo((-1 + -50 / k1) / 2, 10);
    expect(out[1]).toBeCloseTo(0, 10); // ch0 NaN -> ch1 z at its mean = 0
    expect(out[2]).toBeCloseTo((1 + 50 / k1) / 2, 10);
  });
});
