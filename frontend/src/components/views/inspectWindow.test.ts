import { describe, it, expect } from "vitest";
import {
  inspectWindowFor,
  makeInspectTimeseriesRequest,
  MAX_INSPECT_WIDTH_S,
  INSPECT_MAX_POINTS,
} from "./inspectWindow";
import type { SelectionDTO } from "../../api/types";

const SEL: SelectionDTO = { time: 0, freq: 0, ap: 0, ml: 0, channel: null };

describe("inspectWindowFor", () => {
  it("pads a point event symmetrically (default 0.5 s ⇒ 1 s window)", () => {
    const [lo, hi] = inspectWindowFor(10);
    expect(lo).toBeCloseTo(9.5);
    expect(hi).toBeCloseTo(10.5);
    expect(hi - lo).toBeCloseTo(1.0);
  });

  it("uses a span when given, extended by the margin", () => {
    const [lo, hi] = inspectWindowFor(10, [10, 10.3]);
    expect(lo).toBeCloseTo(9.75); // 10 - 0.25
    expect(hi).toBeCloseTo(10.55); // 10.3 + 0.25
  });

  it("clamps the window to never start before 0, preserving width", () => {
    const [lo, hi] = inspectWindowFor(0.1);
    expect(lo).toBe(0);
    expect(hi - lo).toBeCloseTo(1.0); // width preserved (shifted forward)
  });

  it("clamps an over-wide span to MAX_INSPECT_WIDTH_S, centered", () => {
    // 20 s span — far wider than the 8 s cap.
    const [lo, hi] = inspectWindowFor(50, [40, 60]);
    expect(hi - lo).toBeCloseTo(MAX_INSPECT_WIDTH_S);
    // Centered on span center (50).
    expect((lo + hi) / 2).toBeCloseTo(50);
  });

  it("never exceeds the width cap for any input", () => {
    for (const span of [[0, 100], [5, 5.01], [200, 260]] as [number, number][]) {
      const [lo, hi] = inspectWindowFor((span[0] + span[1]) / 2, span);
      expect(hi - lo).toBeLessThanOrEqual(MAX_INSPECT_WIDTH_S + 1e-9);
    }
  });

  it("falls back to point padding for an invalid span (t1 < t0)", () => {
    const [lo, hi] = inspectWindowFor(10, [10.5, 10]);
    expect(lo).toBeCloseTo(9.5);
    expect(hi).toBeCloseTo(10.5);
  });
});

describe("makeInspectTimeseriesRequest", () => {
  it("requests full resolution: downsample 'none' + high max_points", () => {
    const req = makeInspectTimeseriesRequest(SEL, [9.5, 10.5]);
    expect(req.view_type).toBe("timeseries");
    expect(req.downsample).toBe("none");
    expect(req.max_points).toBe(INSPECT_MAX_POINTS);
    expect(req.time_range).toEqual([9.5, 10.5]);
  });

  it("pins selection.time to the window start (stable key under cursor moves)", () => {
    const req = makeInspectTimeseriesRequest({ ...SEL, time: 9.9 }, [9.5, 10.5]);
    expect(req.selection.time).toBe(9.5);
  });

  it("the inspect window stays within the un-decimated sample cap at typical fs", () => {
    // 8 s cap × 1250 Hz = 10_000 samples, well under the server's 60_000 cap.
    const [lo, hi] = inspectWindowFor(100, [60, 160]); // clamped to 8 s
    const samples = (hi - lo) * 1250;
    expect(samples).toBeLessThan(60_000);
  });
});
