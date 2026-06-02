import { describe, expect, it } from "vitest";
import {
  addOffset,
  meanFinite,
  restackBandpassToRawMean,
} from "./timeseriesBandpass";

describe("meanFinite (refactor-plan N3)", () => {
  it("averages finite values", () => {
    expect(meanFinite([1, 2, 3, 4])).toBe(2.5);
  });

  it("skips NaN and ±Infinity", () => {
    expect(meanFinite([1, NaN, 3, Infinity, 5, -Infinity])).toBe(3); // (1+3+5)/3
  });

  it("returns 0 for an empty input", () => {
    expect(meanFinite([])).toBe(0);
  });

  it("returns 0 when every value is NaN/Infinity", () => {
    // Channel-mask invariant: a fully-masked channel must produce no offset
    // so the filtered trace lands at its native baseline (zero).
    expect(meanFinite([NaN, NaN])).toBe(0);
    expect(meanFinite([Infinity, -Infinity])).toBe(0);
  });

  it("handles a Float32Array (the production input type)", () => {
    const f = new Float32Array([10, 20, 30]);
    expect(meanFinite(f)).toBeCloseTo(20, 6);
  });
});

describe("addOffset (refactor-plan N3)", () => {
  it("adds the offset to every entry and preserves length", () => {
    const out = addOffset([0, 1, 2, 3], 5);
    expect(Array.from(out)).toEqual([5, 6, 7, 8]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(4);
  });

  it("zero offset is a typed-array copy", () => {
    const out = addOffset([1, 2, 3], 0);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});

describe("restackBandpassToRawMean (refactor-plan N3)", () => {
  it("centres the filtered trace on the raw trace's mean", () => {
    // Raw mean = (10 + 20 + 30) / 3 = 20.
    // Filtered (zero-centred bandpass output) gets +20 added.
    const out = restackBandpassToRawMean([10, 20, 30], [-1, 0, 1]);
    expect(Array.from(out)).toEqual([19, 20, 21]);
  });

  it("ignores NaN in the raw mean (masked-channel safety)", () => {
    const out = restackBandpassToRawMean([10, NaN, 30], [-2, 0, 2]);
    // Raw mean over finite = (10 + 30) / 2 = 20 → offsets the filtered series.
    expect(Array.from(out)).toEqual([18, 20, 22]);
  });

  it("falls back to zero offset when raw is fully NaN", () => {
    const out = restackBandpassToRawMean([NaN, NaN, NaN], [1, 2, 3]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("returns a Float32Array of the same length as the filtered input", () => {
    const out = restackBandpassToRawMean(new Float32Array([0, 0]), [1, 2, 3, 4]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(4);
  });

  it("does not mutate the inputs", () => {
    const raw = [1, 2, 3];
    const filtered = [0, 0, 0];
    restackBandpassToRawMean(raw, filtered);
    expect(raw).toEqual([1, 2, 3]);
    expect(filtered).toEqual([0, 0, 0]);
  });
});
