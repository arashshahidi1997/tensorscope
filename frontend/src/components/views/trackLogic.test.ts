import { describe, expect, it } from "vitest";
import type { TrackMetaDTO } from "../../api/types";
import { isTrackVisible, scalarValueRange, trackTimeRange, visibleTracks } from "./trackLogic";

function meta(name: string, range: [number | null, number | null], kind: "categorical" | "scalar" = "scalar"): TrackMetaDTO {
  return { name, kind, time_range: range, n_steps: 2, units: null, state_names: [] };
}

describe("isTrackVisible", () => {
  it("treats a missing key as visible", () => {
    expect(isTrackVisible({}, "speed")).toBe(true);
  });
  it("respects an explicit false", () => {
    expect(isTrackVisible({ speed: false }, "speed")).toBe(false);
    expect(isTrackVisible({ speed: true }, "speed")).toBe(true);
  });
});

describe("visibleTracks", () => {
  it("keeps default-visible tracks and drops explicitly-hidden ones", () => {
    const tracks = [meta("brainstate", [0, 10], "categorical"), meta("speed", [0, 10])];
    expect(visibleTracks(tracks, {}).map((t) => t.name)).toEqual(["brainstate", "speed"]);
    expect(visibleTracks(tracks, { speed: false }).map((t) => t.name)).toEqual(["brainstate"]);
  });
});

describe("trackTimeRange", () => {
  it("returns a finite range", () => {
    expect(trackTimeRange(meta("speed", [0, 20]))).toEqual([0, 20]);
  });
  it("rejects null or degenerate ranges", () => {
    expect(trackTimeRange(meta("speed", [null, 20]))).toBeNull();
    expect(trackTimeRange(meta("speed", [5, 5]))).toBeNull();
    expect(trackTimeRange(meta("speed", [9, 1]))).toBeNull();
  });
});

describe("scalarValueRange", () => {
  it("returns min/max of the data", () => {
    expect(scalarValueRange([3, -1, 7, 2])).toEqual([-1, 7]);
  });
  it("pads a flat series so the range is non-zero", () => {
    expect(scalarValueRange([5, 5, 5])).toEqual([4, 6]);
  });
  it("falls back for empty input", () => {
    expect(scalarValueRange([])).toEqual([0, 1]);
  });
});
