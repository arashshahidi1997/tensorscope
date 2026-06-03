import { describe, expect, it } from "vitest";
import type { Trajectory } from "../../api/arrow";
import {
  availableAxisPairs,
  axisExtent,
  nearestSampleInPlane,
  nearestTimeIndex,
} from "./trajectoryLogic";

describe("availableAxisPairs", () => {
  it("enumerates the 3 planes for x/y/z", () => {
    expect(availableAxisPairs(["x", "y", "z"]).map((p) => p.label)).toEqual(["x–y", "x–z", "y–z"]);
  });
  it("is empty for a single axis", () => {
    expect(availableAxisPairs(["x"])).toEqual([]);
  });
});

describe("nearestTimeIndex", () => {
  const times = [0, 1, 2, 3, 4];
  it("clamps below and above", () => {
    expect(nearestTimeIndex(times, -5)).toBe(0);
    expect(nearestTimeIndex(times, 99)).toBe(4);
  });
  it("rounds to the closest sample", () => {
    expect(nearestTimeIndex(times, 2.4)).toBe(2);
    expect(nearestTimeIndex(times, 2.6)).toBe(3);
  });
  it("handles empty", () => {
    expect(nearestTimeIndex([], 1)).toBe(-1);
  });
});

describe("axisExtent", () => {
  it("returns min/max ignoring non-finite", () => {
    expect(axisExtent([3, NaN, -1, 7])).toEqual([-1, 7]);
  });
  it("pads a flat series and falls back when empty", () => {
    expect(axisExtent([5, 5])).toEqual([4, 6]);
    expect(axisExtent([])).toEqual([0, 1]);
  });
});

describe("nearestSampleInPlane", () => {
  const traj: Trajectory = {
    times: [0, 1, 2],
    byAxis: { x: [0, 10, 20], y: [0, 0, 0] },
    axes: ["x", "y"],
  };
  it("finds the closest sample in the a/b plane", () => {
    expect(nearestSampleInPlane(traj, "x", "y", 9, 0)).toBe(1);
    expect(nearestSampleInPlane(traj, "x", "y", 21, 0)).toBe(2);
  });
  it("returns -1 for an unknown axis", () => {
    expect(nearestSampleInPlane(traj, "x", "z", 0, 0)).toBe(-1);
  });
});
