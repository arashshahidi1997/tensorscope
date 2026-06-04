import { describe, it, expect } from "vitest";
import {
  clampWindow,
  eventTimeRange,
  lodTileSeconds,
  makeDefaultSliceRequest,
  makeNavigatorRequest,
  makeOrthoSpatialRequest,
  makePropagationMovieRequest,
  makePSDLiveRequest,
  makeSpectrogramLiveRequest,
  snapWindowToLodTiles,
  timeseriesPointBudget,
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
  it("LOD-snaps the default ±1s window and sizes max_points to the viewport (P6)", () => {
    const req = makeDefaultSliceRequest("timeseries", SEL);
    // Default window [9, 11] (duration 2) → tile 0.5; start floor(9/0.5)*0.5 = 9;
    // 5 tiles of slack-coverage → end 11.5.
    expect(req.time_range).toEqual([9, 11.5]);
    // No width passed → fallback budget (DEFAULT_TIMESERIES_PX bucket × 2).
    expect(req.max_points).toBe(timeseriesPointBudget(undefined));
    expect(req.downsample).toBe("minmax");
  });

  it("snaps the early-cursor window to the tile grid, still starting at 0 (P6)", () => {
    const req = makeDefaultSliceRequest("timeseries", { ...SEL, time: 0.3 });
    // Window [0, 1.3] (duration 1.3) → tile 0.25; start 0; 7 tiles → end 1.75.
    expect(req.time_range![0]).toBe(0);
    expect(req.time_range![1]).toBeCloseTo(1.75);
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

  it("pins selection to a constant for psd_average (cursor-key invariance)", () => {
    // The server collapses time → mean and reads no `selection` field for
    // psd_average, so a pure cursor move (time OR freq) must not re-key the
    // query. Two different cursor positions produce identical requests.
    const a = makeDefaultSliceRequest("psd_average", { ...SEL, time: 9.2, freq: 12 });
    const b = makeDefaultSliceRequest("psd_average", { ...SEL, time: 30.7, freq: 80 });
    expect(a.selection).toEqual({ time: 0, freq: 0, ap: 0, ml: 0, channel: null });
    expect(a).toEqual(b);
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

  it("pins selection.time to the window start for window-bound views (key invariance)", () => {
    // ADR-0008 §5: a pure cursor move within a fixed window must NOT re-key
    // timeseries/spectrogram (they slice by time_range, not the cursor). Two
    // cursor positions inside the same window produce identical requests.
    const win: [number, number] = [9, 11];
    for (const v of ["timeseries", "spectrogram"]) {
      const a = makeDefaultSliceRequest(v, { ...SEL, time: 9.2 }, win);
      const b = makeDefaultSliceRequest(v, { ...SEL, time: 10.8 }, win);
      expect(a.selection.time).toBe(9); // pinned to time_range[0]
      expect(a).toEqual(b); // same key for any cursor in the window
    }
  });

  it("keeps the live cursor for cursor-windowed views (spatial_map)", () => {
    // The instantaneous spatial views MUST still track the cursor.
    const a = makeDefaultSliceRequest("spatial_map", { ...SEL, time: 9.2 });
    const b = makeDefaultSliceRequest("spatial_map", { ...SEL, time: 10.8 });
    expect(a.selection.time).toBe(9.2);
    expect(a).not.toEqual(b);
  });
});

describe("P6 — LOD point budget + tile snapping", () => {
  describe("timeseriesPointBudget", () => {
    it("scales with pixel width (2 samples/px for the min/max envelope)", () => {
      // Width is bucketed to a 256px quantum, then × SAMPLES_PER_PX (2).
      expect(timeseriesPointBudget(1024)).toBe(1024 * 2); // exact bucket
      expect(timeseriesPointBudget(2048)).toBe(2048 * 2);
      // A wider viewport always yields a strictly larger budget.
      expect(timeseriesPointBudget(2560)).toBeGreaterThan(timeseriesPointBudget(1024));
    });

    it("buckets sub-quantum width changes to the same budget (no key churn)", () => {
      // 1024 and 1100 both bucket up to 1280 → identical budget, so a few-px
      // drag-resize doesn't change max_points (and therefore the request key).
      expect(timeseriesPointBudget(1100)).toBe(timeseriesPointBudget(1090));
      expect(timeseriesPointBudget(1100)).toBe(1280 * 2);
    });

    it("clamps to [512, 16384] and falls back to a constant when unmeasured", () => {
      expect(timeseriesPointBudget(10)).toBe(512); // tiny panel → MIN
      expect(timeseriesPointBudget(100000)).toBe(16384); // huge panel → MAX
      expect(timeseriesPointBudget(undefined)).toBe(1280 * 2); // fallback width
      expect(timeseriesPointBudget(0)).toBe(1280 * 2); // non-positive → fallback
    });
  });

  describe("lodTileSeconds / snapWindowToLodTiles", () => {
    it("picks a power-of-two-seconds tile from the window duration", () => {
      expect(lodTileSeconds(2)).toBe(0.5); // ~4 tiles across a 2s window
      expect(lodTileSeconds(10)).toBe(2);
      expect(lodTileSeconds(4)).toBe(1);
    });

    it("snaps the window to a tile-aligned range that contains the visible window", () => {
      const [s0, s1] = snapWindowToLodTiles([10.1, 11.1]); // duration 1 → tile 0.25
      expect(s0).toBeLessThanOrEqual(10.1);
      expect(s1).toBeGreaterThanOrEqual(11.1);
      // start floored to the 0.25 grid: floor(10.1/0.25)*0.25 = 10.0
      expect(s0).toBe(10);
    });

    it("clamps the snapped start to ≥ 0 (overscan near the recording start)", () => {
      // The overscan buffer widens below the visible start; near t=0 the floor
      // can land negative, which would pin selection.time < 0 → a 422. Clamp it.
      expect(snapWindowToLodTiles([-1, 3])[0]).toBe(0);
      expect(snapWindowToLodTiles([-0.4, 1.6])[0]).toBe(0);
    });
  });

  it("a timeseries request near t=0 never pins selection.time < 0 (422 regression)", () => {
    // Overscan can push the fetch window's start below 0; selection.time is
    // pinned to the snapped start and must satisfy the SelectionDTO time ≥ 0.
    const req = makeDefaultSliceRequest("timeseries", SEL, [-0.5, 2.5], 1280);
    expect(req.selection.time).toBeGreaterThanOrEqual(0);
    expect(req.time_range![0]).toBeGreaterThanOrEqual(0);
  });

  it("a sub-tile pan yields a byte-identical request key (cache hit)", () => {
    // Both windows (duration 1 → tile 0.25) start in the same tile cell
    // [10.0, 10.25), so the snapped fetch window is identical.
    const a = makeDefaultSliceRequest("timeseries", SEL, [10.1, 11.1], 1280);
    const b = makeDefaultSliceRequest("timeseries", SEL, [10.2, 11.2], 1280);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // byte-identical
  });

  it("a pan past the tile boundary changes the request key (new fetch)", () => {
    // Panning to [10.4, 11.4] crosses into the next 0.25 tile cell, so the
    // snapped start steps from 10.0 → 10.25 and the key differs.
    const a = makeDefaultSliceRequest("timeseries", SEL, [10.1, 11.1], 1280);
    const c = makeDefaultSliceRequest("timeseries", SEL, [10.4, 11.4], 1280);
    expect(c).not.toEqual(a);
    expect(c.time_range![0]).toBe(10.25);
  });

  it("a width change re-keys the request (refetches at the new resolution)", () => {
    const narrow = makeDefaultSliceRequest("timeseries", SEL, [10, 12], 1024);
    const wide = makeDefaultSliceRequest("timeseries", SEL, [10, 12], 2560);
    expect(wide.max_points).toBeGreaterThan(narrow.max_points!);
    expect(wide.time_range).toEqual(narrow.time_range); // same window, only budget differs
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

  it("pins selection to a constant — same key for any cursor position", () => {
    // Critical perf invariant: navigator never reads selection.time on the
    // server side, so its query key must be invariant under cursor moves.
    // Otherwise every "next event" click re-down-samples 8M samples × 256 ch
    // (~5 s on a long iEEG session) for nothing.
    const reqA = makeNavigatorRequest({ time: 10, freq: 0, ap: 0, ml: 0, channel: null }, TIME_COORD);
    const reqB = makeNavigatorRequest({ time: 1500, freq: 60, ap: 7, ml: 12, channel: 42 }, TIME_COORD);
    expect(reqA.selection).toEqual(reqB.selection);
    expect(reqA.selection).toEqual({ time: 0, freq: 0, ap: 0, ml: 0, channel: null });
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

  it("uses lockedTimeRange (G8) instead of the cursor-centred window when provided", () => {
    // 0.5 s event at t=10, ±0.25 s margin → caller passes [9.75, 10.75].
    const req = makePSDLiveRequest(SEL, 1, TIME_COORD, undefined, [9.75, 10.75]);
    expect(req.time_range).toEqual([9.75, 10.75]);
  });

  it("clamps lockedTimeRange against the tensor bounds (G8)", () => {
    // Event whose locked window pokes past the recording end.
    const req = makePSDLiveRequest(SEL, 1, TIME_COORD, undefined, [48, 55]);
    expect(req.time_range).toEqual([48, 50]);
  });

  it("falls back to cursor-centred window when lockedTimeRange is null (G8 toggle off)", () => {
    const req = makePSDLiveRequest(SEL, 2, TIME_COORD, undefined, null);
    expect(req.time_range).toEqual([9, 11]);
  });
});

describe("eventTimeRange (G8)", () => {
  it("uses t_end when present", () => {
    const r = eventTimeRange({ t: 10, t_end: 10.5 }, "t");
    expect(r).toEqual([10, 10.5]);
  });

  it("derives t_end from duration_s when t_end is absent", () => {
    const r = eventTimeRange({ t: 10, duration_s: 0.5 }, "t");
    expect(r).toEqual([10, 10.5]);
  });

  it("falls back to bare duration when duration_s is absent", () => {
    const r = eventTimeRange({ t: 10, duration: 0.25 }, "t");
    expect(r).toEqual([10, 10.25]);
  });

  it("returns a zero-width span for point events (no duration info)", () => {
    const r = eventTimeRange({ t: 10 }, "t");
    expect(r).toEqual([10, 10]);
  });

  it("falls back to record.t when the stream's time_col is missing", () => {
    // Mirrors `coincidence.ts` extractEventTimes — `record.t` is the
    // canonical fallback when the explicit time_col isn't populated.
    const r = eventTimeRange({ t: 10 }, "onset_s");
    expect(r).toEqual([10, 10]);
  });

  it("returns null when no finite time is available", () => {
    expect(eventTimeRange({ t: "nope" }, "t")).toBeNull();
    expect(eventTimeRange({}, "t")).toBeNull();
    expect(eventTimeRange(null, "t")).toBeNull();
    expect(eventTimeRange(undefined, "t")).toBeNull();
  });

  it("ignores nonsensical t_end (< t)", () => {
    // Bad record where t_end precedes t — treat as point event rather than
    // emit an inverted window the server would reject.
    const r = eventTimeRange({ t: 10, t_end: 9 }, "t");
    expect(r).toEqual([10, 10]);
  });

  it("parses string-valued times like the rest of the event pipeline", () => {
    const r = eventTimeRange({ t: "10.0", duration_s: "0.5" }, "t");
    expect(r).toEqual([10, 10.5]);
  });
});

describe("makeSpectrogramLiveRequest", () => {
  it("uses the passed-in timeWindow directly (no cursor-centring)", () => {
    // Critical contract: the spectrogram heatmap's x-axis must track the
    // visible viewport, not collapse to a 1s window around the cursor.
    // Centred-on-cursor (psd_live's shape) gives 1 time bin and renders
    // blank. Regression guard for the live test that surfaced this:
    // set_viewport(t_lo=200, t_hi=240) → time_range MUST be [200, 240].
    const req = makeSpectrogramLiveRequest({ ...SEL, time: 215 }, [200, 240]);
    expect(req.view_type).toBe("spectrogram_live");
    expect(req.time_range).toEqual([200, 240]);
    // Window-bound: time is pinned to the window start so a pure cursor move
    // doesn't re-key the query (ADR-0008 §5). The server slices by time_range.
    expect(req.selection.time).toBe(200);
  });

  it("pins selection.time to the window start for key invariance", () => {
    // Two cursor positions in the same window → identical request.
    const a = makeSpectrogramLiveRequest({ ...SEL, time: 205 }, [200, 240]);
    const b = makeSpectrogramLiveRequest({ ...SEL, time: 235 }, [200, 240]);
    expect(a).toEqual(b);
  });

  it("passes the timeWindow through verbatim — caller is responsible for clamping", () => {
    // Mirrors makeDefaultSliceRequest('timeseries', …) — the helper does not
    // clamp internally because WorkspaceMain already produces `safeWindow`
    // via clampWindow() at the call site. Keeps the helper trivially pure.
    const req = makeSpectrogramLiveRequest(SEL, [-5, 200]);
    expect(req.time_range).toEqual([-5, 200]);
  });

  it("forwards spectrogram_live_params to the request", () => {
    const req = makeSpectrogramLiveRequest(SEL, [0, 10], {
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
    const req = makeSpectrogramLiveRequest(SEL, [0, 10]);
    expect(req.max_points).toBeUndefined();
    expect(req.downsample).toBeUndefined();
  });

  it("omits spectrogram_live_params when none supplied (server defaults apply)", () => {
    const req = makeSpectrogramLiveRequest(SEL, [0, 10]);
    expect(req.spectrogram_live_params).toBeUndefined();
  });

  it("carries the A1 ripple band (fmax_hz 250) + window through the params slot", () => {
    // A1: useWorkspaceData threads the appStore spec fields here. Raising
    // fmax_hz to 250 is what makes ripples viewable (server default caps at 30).
    const req = makeSpectrogramLiveRequest(SEL, [0, 10], {
      fmin_hz: 80,
      fmax_hz: 250,
      nperseg_s: 0.25,
    });
    expect(req.spectrogram_live_params).toEqual({
      fmin_hz: 80,
      fmax_hz: 250,
      nperseg_s: 0.25,
    });
  });
});

describe("makePropagationMovieRequest", () => {
  it("builds a propagation_movie request with the visible window", () => {
    const req = makePropagationMovieRequest(SEL, [10, 20], 60);
    expect(req.view_type).toBe("propagation_movie");
    expect(req.time_range).toEqual([10, 20]);
    expect(req.n_frames).toBe(60);
  });

  it("omits n_frames when not supplied (server defaults to ~window_s × 30)", () => {
    const req = makePropagationMovieRequest(SEL, [0, 5]);
    expect(req.n_frames).toBeUndefined();
  });

  it("does not set max_points or downsample (movie carries its own time axis)", () => {
    const req = makePropagationMovieRequest(SEL, [0, 5], 30);
    expect(req.max_points).toBeUndefined();
    expect(req.downsample).toBeUndefined();
  });
});
