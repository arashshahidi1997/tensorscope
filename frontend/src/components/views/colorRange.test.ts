import { describe, expect, it } from "vitest";
import { unmaskedCellRange, unmaskedRasterRange } from "./colorRange";

const cell = (ap: number, ml: number, value: number) => ({ ap, ml, value });

describe("unmaskedCellRange", () => {
  const nML = 2; // flat id = ap*2 + ml

  it("returns the full range when nothing is masked", () => {
    const cells = [cell(0, 0, 1), cell(0, 1, 5), cell(1, 0, 3)];
    expect(unmaskedCellRange(cells, nML)).toEqual([1, 5]);
  });

  it("excludes masked cells so a bad channel doesn't drive the range", () => {
    // id 1 (ap0,ml1) carries an outlier 999; mask it → range from the rest.
    const cells = [cell(0, 0, 1), cell(0, 1, 999), cell(1, 0, 3), cell(1, 1, 4)];
    const masked = new Set([0 * nML + 1]); // id 1
    expect(unmaskedCellRange(cells, nML, masked)).toEqual([1, 4]);
  });

  it("ignores NaN values", () => {
    const cells = [cell(0, 0, NaN), cell(0, 1, 2), cell(1, 0, 8)];
    expect(unmaskedCellRange(cells, nML)).toEqual([2, 8]);
  });

  it("falls back to all cells when every cell is masked", () => {
    const cells = [cell(0, 0, 1), cell(0, 1, 5)];
    const masked = new Set([0, 1]);
    expect(unmaskedCellRange(cells, nML, masked)).toEqual([1, 5]);
  });

  it("returns [0,1] for empty input", () => {
    expect(unmaskedCellRange([], nML)).toEqual([0, 1]);
  });
});

describe("unmaskedRasterRange", () => {
  // 3 channels × 4 time cols, row-major. channels[r] = channel id of row r.
  const channels = [10, 11, 12];
  const nTime = 4;
  // row 0: 1..4, row 1 (channel 11): a 9999 outlier, row 2: 5..8
  const values = [1, 2, 3, 4, 9999, 9999, 9999, 9999, 5, 6, 7, 8];

  it("computes percentiles over all rows when unmasked", () => {
    const [lo, hi] = unmaskedRasterRange(values, channels, nTime, undefined, 0, 1);
    expect(lo).toBe(1);
    expect(hi).toBe(9999); // the outlier row is included
  });

  it("excludes masked rows from the percentile range", () => {
    const masked = new Set([11]); // mask the outlier channel
    const [lo, hi] = unmaskedRasterRange(values, channels, nTime, masked, 0, 1);
    expect(lo).toBe(1);
    expect(hi).toBe(8); // 9999 gone → range from the good rows
  });

  it("falls back to all rows when every channel is masked", () => {
    const masked = new Set([10, 11, 12]);
    const [lo, hi] = unmaskedRasterRange(values, channels, nTime, masked, 0, 1);
    expect(lo).toBe(1);
    expect(hi).toBe(9999);
  });
});
