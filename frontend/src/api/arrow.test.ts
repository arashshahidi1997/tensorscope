import { describe, it, expect } from "vitest";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import {
  decodeArrowSlice,
  extractEventAverage,
  extractTimeseriesColumnar,
  extractTimeseriesColumnarFast,
  extractSpatialCells,
  extractSpatialFrames,
  extractFreqCurve,
  extractPSDHeatmap,
  extractPSDAverage,
  extractPSDSpatialAtFreq,
  extractSpectrogram,
  extractTrajectory,
  toNumber,
} from "./arrow";
import type { TensorSliceDTO } from "./types";

function buildSlice(columns: Record<string, number[]>): TensorSliceDTO {
  const table = tableFromArrays(columns as Record<string, Float64Array | number[]>);
  const payload = Buffer.from(tableToIPC(table)).toString("base64");
  return {
    name: "test",
    view_type: "timeseries",
    dims: Object.keys(columns),
    shape: [Object.values(columns)[0]?.length ?? 0],
    encoding: "arrow_ipc",
    payload,
    meta: {},
  };
}

describe("decodeArrowSlice", () => {
  it("round-trips columns and rows from Arrow IPC payload", () => {
    const slice = buildSlice({ time: [0, 1, 2], value: [10, 20, 30] });
    const decoded = decodeArrowSlice(slice);
    expect(decoded.columns.sort()).toEqual(["time", "value"]);
    expect(decoded.rows).toHaveLength(3);
    expect(Number(decoded.rows[1].time)).toBe(1);
    expect(Number(decoded.rows[1].value)).toBe(20);
  });
});

describe("extractTimeseriesColumnar", () => {
  it("groups rows by channel onto a shared time axis", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        time: [0, 1, 2, 0, 1, 2],
        channel: [0, 0, 0, 1, 1, 1],
        value: [10, 11, 12, 20, 21, 22],
      }),
    );
    const result = extractTimeseriesColumnar(decoded);
    expect(result.times).toEqual([0, 1, 2]);
    expect(result.series).toHaveLength(2);
    const ch0 = result.series.find((s) => s.key === "ch-0")!;
    const ch1 = result.series.find((s) => s.key === "ch-1")!;
    expect(ch0.label).toBe("Ch 0");
    expect(Array.from(ch0.values)).toEqual([10, 11, 12]);
    expect(Array.from(ch1.values)).toEqual([20, 21, 22]);
  });

  it("groups by (AP, ML) when channel column is absent", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        time: [0, 1, 0, 1],
        AP: [0, 0, 1, 1],
        ML: [0, 0, 2, 2],
        value: [1, 2, 3, 4],
      }),
    );
    const result = extractTimeseriesColumnar(decoded);
    expect(result.times).toEqual([0, 1]);
    const keys = result.series.map((s) => s.key).sort();
    expect(keys).toEqual(["ap-0-ml-0", "ap-1-ml-2"]);
  });

  it("fills NaN for missing (time, series) cells", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        time: [0, 1, 2, 0, 2], // ch=1 missing at t=1
        channel: [0, 0, 0, 1, 1],
        value: [10, 11, 12, 20, 22],
      }),
    );
    const ch1 = extractTimeseriesColumnar(decoded).series.find((s) => s.key === "ch-1")!;
    expect(ch1.values[0]).toBe(20);
    expect(Number.isNaN(ch1.values[1])).toBe(true);
    expect(ch1.values[2]).toBe(22);
  });

  it("returns empty when required columns are missing", () => {
    const decoded = decodeArrowSlice(buildSlice({ foo: [1, 2] }));
    expect(extractTimeseriesColumnar(decoded)).toEqual({ times: [], series: [] });
  });
});

describe("extractTimeseriesColumnarFast", () => {
  it("matches the row-based extractor on channel-keyed data", () => {
    const slice = buildSlice({
      time: [0, 1, 0, 1],
      channel: [0, 0, 1, 1],
      value: [10, 11, 20, 21],
    });
    const slow = extractTimeseriesColumnar(decodeArrowSlice(slice));
    const fast = extractTimeseriesColumnarFast(slice);
    expect(fast.times).toEqual(slow.times);
    expect(fast.series.map((s) => s.key).sort()).toEqual(slow.series.map((s) => s.key).sort());
    // Verify values line up for ch-0
    const fastCh0 = fast.series.find((s) => s.key === "ch-0")!;
    const slowCh0 = slow.series.find((s) => s.key === "ch-0")!;
    expect(fastCh0.values).toEqual(slowCh0.values);
  });
});

describe("extractSpatialCells", () => {
  it("ranks AP and ML and averages duplicates", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        AP: [0.5, 0.5, 1.5, 1.5],
        ML: [0, 0, 2, 2], // duplicate (0.5, 0) pair
        value: [10, 20, 100, 100], // averages to (15, 100)
      }),
    );
    const cells = extractSpatialCells(decoded);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toEqual({ ap: 0, ml: 0, value: 15 });
    expect(cells[1]).toEqual({ ap: 1, ml: 1, value: 100 });
  });

  it("returns empty when columns missing", () => {
    const decoded = decodeArrowSlice(buildSlice({ AP: [0], value: [1] })); // no ML
    expect(extractSpatialCells(decoded)).toEqual([]);
  });
});

describe("extractSpatialFrames", () => {
  it("groups (time, AP, ML) rows into per-frame cell arrays with global min/max", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        time: [0, 0, 0, 0, 1, 1, 1, 1],
        AP: [0, 0, 1, 1, 0, 0, 1, 1],
        ML: [0, 1, 0, 1, 0, 1, 0, 1],
        value: [1, 2, 3, 4, 10, 20, 30, 40],
      }),
    );
    const movie = extractSpatialFrames(decoded);
    expect(movie.frames).toHaveLength(2);
    expect(movie.nAP).toBe(2);
    expect(movie.nML).toBe(2);
    expect(movie.min).toBe(1);
    expect(movie.max).toBe(40);
    expect(movie.frames[0].time).toBe(0);
    expect(movie.frames[1].time).toBe(1);
    // Frame 0 cells sorted by (ap, ml)
    expect(movie.frames[0].cells).toEqual([
      { ap: 0, ml: 0, value: 1 },
      { ap: 0, ml: 1, value: 2 },
      { ap: 1, ml: 0, value: 3 },
      { ap: 1, ml: 1, value: 4 },
    ]);
  });

  it("normalizes float AP/ML coords to 0-based ranks with stable order across frames", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        time: [0, 0, 1, 1],
        AP: [0.5, 1.5, 0.5, 1.5],
        ML: [10, 20, 10, 20],
        value: [1, 2, 3, 4],
      }),
    );
    const movie = extractSpatialFrames(decoded);
    expect(movie.frames[0].cells[0].ap).toBe(0);
    expect(movie.frames[0].cells[1].ap).toBe(1);
    expect(movie.frames[1].cells[0].ap).toBe(0);
    expect(movie.frames[1].cells[1].ap).toBe(1);
  });

  it("returns empty movie when required columns are missing", () => {
    const decoded = decodeArrowSlice(buildSlice({ AP: [0], value: [1] }));
    const movie = extractSpatialFrames(decoded);
    expect(movie.frames).toEqual([]);
    expect(movie.nAP).toBe(0);
  });

  it("sorts frames by ascending time", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        time: [2, 2, 0, 0, 1, 1],
        AP: [0, 0, 0, 0, 0, 0],
        ML: [0, 1, 0, 1, 0, 1],
        value: [9, 9, 1, 1, 5, 5],
      }),
    );
    const movie = extractSpatialFrames(decoded);
    expect(movie.frames.map((f) => f.time)).toEqual([0, 1, 2]);
  });
});

describe("extractFreqCurve", () => {
  it("averages values across spatial dims at each freq", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        freq: [10, 10, 20, 20],
        AP: [0, 1, 0, 1],
        ML: [0, 0, 0, 0],
        value: [4, 8, 10, 20], // mean at 10 = 6, at 20 = 15
      }),
    );
    const curve = extractFreqCurve(decoded);
    expect(curve.freqs).toEqual([10, 20]);
    expect(curve.values).toEqual([6, 15]);
  });
});

describe("extractPSDHeatmap", () => {
  it("builds (freq × channel) matrix with AP-then-ML ordering", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        freq: [10, 10, 20, 20],
        AP: [0, 1, 0, 1],
        ML: [0, 0, 0, 0],
        value: [1, 2, 3, 4],
      }),
    );
    const hm = extractPSDHeatmap(decoded);
    expect(hm.freqs).toEqual([10, 20]);
    expect(hm.channelLabels).toEqual(["AP0_ML0", "AP1_ML0"]);
    expect(hm.matrix).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("fills NaN for missing (freq, channel) cells", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        freq: [10, 10, 20], // AP1 missing at freq=20
        AP: [0, 1, 0],
        ML: [0, 0, 0],
        value: [1, 2, 3],
      }),
    );
    const hm = extractPSDHeatmap(decoded);
    expect(hm.matrix[0]).toEqual([1, 2]);
    expect(hm.matrix[1][0]).toBe(3);
    expect(Number.isNaN(hm.matrix[1][1])).toBe(true);
  });

  it("supports channel-keyed tensors without AP/ML", () => {
    const decoded = decodeArrowSlice(
      buildSlice({ freq: [10, 10], channel: [0, 1], value: [5, 7] }),
    );
    const hm = extractPSDHeatmap(decoded);
    expect(hm.channelLabels).toEqual(["Ch0", "Ch1"]);
    expect(hm.matrix).toEqual([[5, 7]]);
  });
});

describe("extractPSDAverage", () => {
  it("returns per-freq mean and std across channels", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        freq: [10, 10, 10, 20, 20, 20],
        channel: [0, 1, 2, 0, 1, 2],
        value: [2, 4, 6, 10, 10, 10], // mean 4/σ≈1.633, mean 10/σ=0
      }),
    );
    const avg = extractPSDAverage(decoded);
    expect(avg.freqs).toEqual([10, 20]);
    expect(avg.mean).toEqual([4, 10]);
    expect(avg.std[0]).toBeCloseTo(Math.sqrt(8 / 3), 5);
    expect(avg.std[1]).toBe(0);
  });

  it("reports std=0 when only one sample per freq", () => {
    const decoded = decodeArrowSlice(buildSlice({ freq: [10, 20], value: [1, 2] }));
    expect(extractPSDAverage(decoded).std).toEqual([0, 0]);
  });
});

describe("extractPSDSpatialAtFreq", () => {
  it("snaps to the nearest freq", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        freq: [10, 10, 50, 50],
        AP: [0, 1, 0, 1],
        ML: [0, 0, 0, 0],
        value: [1, 2, 3, 4],
      }),
    );
    // target=48 → nearest is 50
    const cells = extractPSDSpatialAtFreq(decoded, 48);
    expect(cells).toEqual([
      { ap: 0, ml: 0, value: 3 },
      { ap: 1, ml: 0, value: 4 },
    ]);
  });

  it("returns empty when spatial columns are missing", () => {
    const decoded = decodeArrowSlice(buildSlice({ freq: [10], value: [1] }));
    expect(extractPSDSpatialAtFreq(decoded, 10)).toEqual([]);
  });
});

describe("extractSpectrogram", () => {
  it("produces a (time × freq) matrix", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        time: [0, 0, 1, 1],
        freq: [10, 20, 10, 20],
        value: [1, 2, 3, 4],
      }),
    );
    const spec = extractSpectrogram(decoded);
    expect(spec.times).toEqual([0, 1]);
    expect(spec.freqs).toEqual([10, 20]);
    expect(spec.values).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("averages over a trailing spatial dim", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        time: [0, 0, 0, 0],
        freq: [10, 10, 20, 20],
        channel: [0, 1, 0, 1],
        value: [2, 4, 10, 20], // (t=0, f=10) → 3, (t=0, f=20) → 15
      }),
    );
    expect(extractSpectrogram(decoded).values).toEqual([[3, 15]]);
  });
});

describe("extractEventAverage", () => {
  it("groups per-channel traces onto a shared lag axis", () => {
    const decoded = decodeArrowSlice(
      buildSlice({
        lag: [-0.1, 0.0, 0.1, -0.1, 0.0, 0.1],
        channel: [0, 0, 0, 1, 1, 1],
        value: [1, 2, 3, 4, 5, 6],
      }),
    );
    const result = extractEventAverage(decoded);
    expect(result.lags).toEqual([-0.1, 0, 0.1]);
    expect(result.series).toHaveLength(2);
    const ch0 = result.series.find((s) => s.key === "ch-0")!;
    const ch1 = result.series.find((s) => s.key === "ch-1")!;
    expect(ch0.values).toEqual([1, 2, 3]);
    expect(ch1.values).toEqual([4, 5, 6]);
  });

  it("collapses a pooled (lag,) payload to a single signal series", () => {
    const decoded = decodeArrowSlice(
      buildSlice({ lag: [-0.2, 0.0, 0.2], value: [10, 20, 30] }),
    );
    const result = extractEventAverage(decoded);
    expect(result.lags).toEqual([-0.2, 0, 0.2]);
    expect(result.series).toHaveLength(1);
    expect(result.series[0].key).toBe("signal");
    expect(result.series[0].values).toEqual([10, 20, 30]);
  });

  it("returns empty when required columns are missing", () => {
    const decoded = decodeArrowSlice(buildSlice({ foo: [1, 2] }));
    expect(extractEventAverage(decoded)).toEqual({ lags: [], series: [] });
  });
});

describe("toNumber", () => {
  it("returns finite numbers as-is", () => {
    expect(toNumber(3.14)).toBe(3.14);
  });
  it("rejects NaN/Infinity", () => {
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });
  it("coerces bigint and numeric strings", () => {
    expect(toNumber(BigInt(42))).toBe(42);
    expect(toNumber(" 2.5 ")).toBe(2.5);
  });
  it("returns null for non-numeric input", () => {
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("")).toBeNull();
  });
});

// ── refactor-plan N3 — extractor edge cases ────────────────────────────────
// jsdom can't render the canvas these extractors feed, so correctness has to
// land in tests. The asserts below cover edge cases that the happy-path
// tests above leave open (empty payloads, NaN time keys, missing column
// combinations, single-channel fallback).

describe("extractTimeseriesColumnarFast — edge cases (N3)", () => {
  it("returns empty arrays on an empty payload", () => {
    const result = extractTimeseriesColumnarFast(
      buildSlice({ time: [], value: [] }),
    );
    expect(result.times).toEqual([]);
    expect(result.series).toEqual([]);
  });

  it("returns empty when required columns are missing", () => {
    // Same contract as the slow path: no time/value columns → empty.
    const result = extractTimeseriesColumnarFast(buildSlice({ freq: [1, 2] }));
    expect(result.times).toEqual([]);
    expect(result.series).toEqual([]);
  });

  it("falls back to a single 'signal' series when neither channel nor AP/ML is present", () => {
    const result = extractTimeseriesColumnarFast(
      buildSlice({ time: [0, 1, 2], value: [10, 20, 30] }),
    );
    expect(result.series).toHaveLength(1);
    expect(result.series[0].key).toBe("signal");
    expect(result.series[0].label).toBe("Signal");
    expect(Array.from(result.series[0].values)).toEqual([10, 20, 30]);
  });

  it("emits Float32Array values (zero-copy contract for the worker pool)", () => {
    const result = extractTimeseriesColumnarFast(
      buildSlice({
        time: [0, 1, 0, 1],
        channel: [0, 0, 1, 1],
        value: [1, 2, 3, 4],
      }),
    );
    for (const s of result.series) {
      expect(s.values).toBeInstanceOf(Float32Array);
    }
  });
});

describe("extractPSDAverage — edge cases (N3)", () => {
  it("returns empty curves on an empty payload", () => {
    const decoded = decodeArrowSlice(buildSlice({ freq: [], value: [] }));
    const avg = extractPSDAverage(decoded);
    expect(avg.freqs).toEqual([]);
    expect(avg.mean).toEqual([]);
    expect(avg.std).toEqual([]);
  });
});

describe("extractSpatialCells — edge cases (N3)", () => {
  it("returns empty cells on an empty payload (no AP/ML rows)", () => {
    const decoded = decodeArrowSlice(buildSlice({ AP: [], ML: [], value: [] }));
    expect(extractSpatialCells(decoded)).toEqual([]);
  });
});

describe("extractTrajectory", () => {
  // Long-format (time, axis, value) with a string axis column — pivot to per-axis.
  function buildTrajectorySlice(): TensorSliceDTO {
    const table = tableFromArrays({
      time: [0, 0, 1, 1],
      axis: ["x", "y", "x", "y"],
      value: [10, 100, 20, 200],
    } as Record<string, number[] | string[]>);
    const payload = Buffer.from(tableToIPC(table)).toString("base64");
    return {
      name: "position",
      view_type: "trajectory",
      dims: ["time", "axis"],
      shape: [2, 2],
      encoding: "arrow_ipc",
      payload,
      meta: {},
    };
  }

  it("pivots long-format rows into per-axis arrays aligned to time", () => {
    const traj = extractTrajectory(decodeArrowSlice(buildTrajectorySlice()));
    expect(traj.times).toEqual([0, 1]);
    expect(traj.axes.sort()).toEqual(["x", "y"]);
    expect(traj.byAxis.x).toEqual([10, 20]);
    expect(traj.byAxis.y).toEqual([100, 200]);
  });

  it("returns empty for a payload missing the axis column", () => {
    const traj = extractTrajectory(decodeArrowSlice(buildSlice({ time: [0, 1], value: [1, 2] })));
    expect(traj).toEqual({ times: [], byAxis: {}, axes: [] });
  });
});
