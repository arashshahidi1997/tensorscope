// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DecodedSlice } from "./arrow";
import { extractHeatmapND, heatmapDims } from "./heatmap";

function decoded(rows: Array<Record<string, unknown>>, columns: string[]): DecodedSlice {
  return { columns, rows };
}

// A tiny (freq × channel) PSD-style cube: value = freq*10 + channel.
function psdLike(): DecodedSlice {
  const rows: Array<Record<string, unknown>> = [];
  for (const freq of [1, 2]) {
    for (const channel of [0, 1, 2]) {
      rows.push({ freq, channel, value: freq * 10 + channel });
    }
  }
  return decoded(rows, ["freq", "channel", "value"]);
}

describe("extractHeatmapND", () => {
  it("pivots freq→Y, channel→X and lays out row-major", () => {
    const g = extractHeatmapND(psdLike(), { x: "channel", y: "freq" });
    expect(g.xDim).toBe("channel");
    expect(g.yDim).toBe("freq");
    expect(g.xVals).toEqual([0, 1, 2]);
    expect(g.yVals).toEqual([1, 2]);
    expect(g.nx).toBe(3);
    expect(g.ny).toBe(2);
    // values[yIdx*nx + xIdx]; freq=1 row first. value = freq*10 + channel.
    expect(Array.from(g.values)).toEqual([10, 11, 12, 20, 21, 22]);
  });

  it("swapping x/y transposes the grid", () => {
    const g = extractHeatmapND(psdLike(), { x: "freq", y: "channel" });
    expect(g.xVals).toEqual([1, 2]);
    expect(g.yVals).toEqual([0, 1, 2]);
    expect(g.nx).toBe(2);
    expect(g.ny).toBe(3);
    // channel=0 row first: [freq1, freq2] = [10, 20]
    expect(Array.from(g.values)).toEqual([10, 20, 11, 21, 12, 22]);
  });

  it("reduces extra dims by mean (default)", () => {
    // (freq, AP, ML): two ML per (freq,AP); mean over ML when ML not on an axis.
    const rows: Array<Record<string, unknown>> = [];
    for (const freq of [1]) {
      for (const AP of [0, 1]) {
        rows.push({ freq, AP, ML: 0, value: 10 });
        rows.push({ freq, AP, ML: 1, value: 20 }); // mean → 15
      }
    }
    const g = extractHeatmapND(decoded(rows, ["freq", "AP", "ML", "value"]), { x: "AP", y: "freq" });
    expect(g.reducedDims).toEqual(["ML"]);
    expect(Array.from(g.values)).toEqual([15, 15]);
  });

  it("reduce='max' takes the max over extra dims", () => {
    const rows = [
      { freq: 1, AP: 0, ML: 0, value: 10 },
      { freq: 1, AP: 0, ML: 1, value: 99 },
    ];
    const g = extractHeatmapND(decoded(rows, ["freq", "AP", "ML", "value"]), {
      x: "AP", y: "freq", reduce: "max",
    });
    expect(Array.from(g.values)).toEqual([99]);
  });

  it("NaN for empty cells", () => {
    const rows = [
      { freq: 1, channel: 0, value: 5 },
      { freq: 2, channel: 1, value: 9 },
    ];
    const g = extractHeatmapND(decoded(rows, ["freq", "channel", "value"]), { x: "channel", y: "freq" });
    // grid is 2×2; only (0,f1) and (1,f2) filled.
    const v = Array.from(g.values);
    expect(v[0]).toBe(5);          // (f1, ch0)
    expect(Number.isNaN(v[1])).toBe(true); // (f1, ch1)
    expect(Number.isNaN(v[2])).toBe(true); // (f2, ch0)
    expect(v[3]).toBe(9);          // (f2, ch1)
  });

  it("heatmapDims lists assignable dims (excludes value)", () => {
    expect(heatmapDims(psdLike())).toEqual(["freq", "channel"]);
  });

  it("returns empty when x===y or columns missing", () => {
    expect(extractHeatmapND(psdLike(), { x: "freq", y: "freq" }).nx).toBe(0);
    expect(extractHeatmapND(psdLike(), { x: "nope", y: "freq" }).nx).toBe(0);
    expect(extractHeatmapND(decoded([], ["freq", "channel"]), { x: "channel", y: "freq" }).nx).toBe(0);
  });
});
