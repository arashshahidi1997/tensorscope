import { describe, it, expect } from "vitest";
import {
  clampWindow,
  makeDefaultSliceRequest,
  makeNavigatorRequest,
  makeOrthoSpatialRequest,
  makePSDLiveRequest,
  makeSpectrogramLiveRequest,
} from "./queries";
import type { CoordSummary, SelectionDTO } from "./types";

const SEL: SelectionDTO = { time: 10, freq: 0, ap: 0, ml: 0, channel: null };
const TIME_COORD: CoordSummary = { name: "time", dtype: "float64", length: 100, min: 0, max: 50 };

describe("clampWindow", () => {
  it("clamps to the provided bounds", () => {
    expect(clampWindow([-5, 30], TIME_COORD)).toEqual([0, 30]);
    expect(clampWindow([10, 200], TIME_COORD)).toEqual([10, 50]);
  });

  it("passes through windows already inside bounds", () => {
    expect(clampWindow([5, 25], TIME_COORD)).toEqual([5, 25]);
  });

  it("falls back to data bounds when window is entirely outside", () => {
    expect(clampWindow([100, 200], TIME_COORD)).toEqual([0, 50]);
  });

  it("leaves the window unchanged when coord bounds are unavailable", () => {
    expect(clampWindow([-5, 30], undefined)).toEqual([-5, 30]);
    expect(clampWindow([-5, 30], { ...TIME_COORD, min: null, max: null })).toEqual([-5, 30]);
  });
});

describe("makeDefaultSliceRequest", () => {
  it("defaults the time window to ±1s around the cursor", () => {
    const req = makeDefaultSliceRequest("timeseries", SEL);
    expect(req.time_range).toEqual([9, 11]);
    expect(req.max_points).toBe(2000);
    expect(req.downsample).toBe("minmax");
  });

  it("clamps the default window to time>=0 for early cursors", () => {
    const req = makeDefaultSliceRequest("timeseries", { ...SEL, time: 0.3 });
    expect(req.time_range![0]).toBe(0);
    expect(req.time_range![1]).toBeCloseTo(1.3);
  });

  it("uses a narrow window and no downsampling for spatial_map / psd_spatial", () => {
    for (const v of ["spatial_map", "psd_spatial"]) {
      const req = makeDefaultSliceRequest(v, SEL);
      expect(req.time_range).toEqual([9.75, 10.25]);
      expect(req.max_points).toBe(400);
      expect(req.downsample).toBe("none");
    }
  });

  it("omits time_range entirely for psd_average", () => {
    const req = makeDefaultSliceRequest("psd_average", SEL);
    expect(req.time_range).toBeUndefined();
    expect(req.max_points).toBeUndefined();
  });

  it("navigator uses the passed-in full-range window", () => {
    const req = makeDefaultSliceRequest("navigator", SEL, [0, 50]);
    expect(req.time_range).toEqual([0, 50]);
    expect(req.max_points).toBe(800);
  });

  it("spectrogram uses max_points=200", () => {
    const req = makeDefaultSliceRequest("spectrogram", SEL);
    expect(req.max_points).toBe(200);
    expect(req.downsample).toBe("minmax");
  });
});

describe("makeOrthoSpatialRequest", () => {
  it("produces a narrow ±0.25s spatial_map request", () => {
    const req = makeOrthoSpatialRequest(SEL);
    expect(req.view_type).toBe("spatial_map");
    expect(req.time_range).toEqual([9.75, 10.25]);
    expect(req.downsample).toBe("none");
  });
});

describe("makeNavigatorRequest", () => {
  it("uses tensor bounds when available", () => {
    const req = makeNavigatorRequest(SEL, TIME_COORD);
    expect(req.time_range).toEqual([0, 50]);
    expect(req.view_type).toBe("navigator");
  });

  it("falls back when min/max are unavailable", () => {
    const req = makeNavigatorRequest(SEL, undefined);
    expect(req.time_range![0]).toBe(0);
    expect(req.time_range![1]).toBe(SEL.time + 10);
  });
});

describe("makePSDLiveRequest", () => {
  it("centers the window on the selected time", () => {
    const req = makePSDLiveRequest(SEL, 2, TIME_COORD);
    expect(req.view_type).toBe("psd_live");
    expect(req.time_range).toEqual([9, 11]);
  });

  it("clamps the window against the tensor bounds", () => {
    const req = makePSDLiveRequest({ ...SEL, time: 49 }, 10, TIME_COORD);
    expect(req.time_range).toEqual([44, 50]);
  });

  it("falls back to a 1s window for non-finite/zero inputs", () => {
    const req = makePSDLiveRequest(SEL, 0, TIME_COORD);
    expect(req.time_range).toEqual([9.5, 10.5]);
  });

  it("forwards psd_params to the request", () => {
    const req = makePSDLiveRequest(SEL, 1, TIME_COORD, { NW: 6, fmax: 80 });
    expect(req.psd_params).toEqual({ NW: 6, fmax: 80 });
  });
});

describe("makeSpectrogramLiveRequest", () => {
  it("uses the visible timeWindow directly (no cursor-centring)", () => {
    const req = makeSpectrogramLiveRequest(SEL, [5, 25], TIME_COORD);
    expect(req.view_type).toBe("spectrogram_live");
    expect(req.time_range).toEqual([5, 25]);
    expect(req.selection).toEqual(SEL);
  });

  it("clamps the window against the tensor bounds", () => {
    const req = makeSpectrogramLiveRequest(SEL, [-5, 200], TIME_COORD);
    expect(req.time_range).toEqual([0, 50]);
  });

  it("forwards spectrogram_live_params to the request", () => {
    const req = makeSpectrogramLiveRequest(SEL, [0, 10], TIME_COORD, {
      bandwidth_hz: 4,
      fmin_hz: 5,
      fmax_hz: 30,
      normalize_per_freq_median: false,
    });
    expect(req.spectrogram_live_params).toEqual({
      bandwidth_hz: 4,
      fmin_hz: 5,
      fmax_hz: 30,
      normalize_per_freq_median: false,
    });
  });

  it("does not set max_points (server caps segment count via nperseg/noverlap)", () => {
    const req = makeSpectrogramLiveRequest(SEL, [0, 10], TIME_COORD);
    expect(req.max_points).toBeUndefined();
    expect(req.downsample).toBeUndefined();
  });

  it("omits spectrogram_live_params when none supplied (server defaults apply)", () => {
    const req = makeSpectrogramLiveRequest(SEL, [0, 10], TIME_COORD);
    expect(req.spectrogram_live_params).toBeUndefined();
  });
});
