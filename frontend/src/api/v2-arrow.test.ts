// @vitest-environment jsdom
/**
 * Frontend parity tests for the contract-v2 decoder + extractor.
 *
 * Two layers:
 *
 *  1. Pure-TS unit tests construct a `LabeledTensor` directly (no IPC) and
 *     assert `extractPSDHeatmapV2` produces the same shape / labels / values
 *     as v1's `extractPSDHeatmap` on the equivalent long-format payload.
 *  2. A round-trip parity test invokes the live python encoder
 *     (`.pixi/envs/default/bin/python -c "encode_arrow_v2(...)"`) on a
 *     synthetic (freq, AP, ML) cube and decodes those real wire bytes
 *     through `decodeLabeledTensor`. This is the parity gate matching the
 *     backend test in `tests/test_slice_v2.py`.
 *
 * If python is unavailable in CI, the unit tests still run; the round-trip
 * test guards itself with `it.skipIf`.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import {
  decodeLabeledTensor,
  extractPSDHeatmapV2,
  extractSpectrogramV2,
  extractTimeseriesV2,
  type LabeledTensor,
} from "./v2-arrow";
import {
  decodeArrowSlice,
  extractPSDHeatmap,
  extractSpectrogram,
  extractTimeseriesColumnar,
} from "./arrow";
import type { TensorSliceDTO } from "./types";

const PY_PATH = resolve(__dirname, "../../../.pixi/envs/default/bin/python");
const PY_AVAILABLE = existsSync(PY_PATH);

function buildLongFormatSlice(
  freqs: number[],
  apVals: number[],
  mlVals: number[],
  values: Float32Array,
): TensorSliceDTO {
  // Equivalent v1 long-format payload for the same (freq, AP, ML) cube —
  // needed so we can drive `extractPSDHeatmap` and compare against v2.
  const nF = freqs.length;
  const nAP = apVals.length;
  const nML = mlVals.length;
  const total = nF * nAP * nML;
  const cFreq = new Float64Array(total);
  const cAP = new Float64Array(total);
  const cML = new Float64Array(total);
  const cVal = new Float64Array(total);
  let idx = 0;
  for (let fi = 0; fi < nF; fi++) {
    for (let a = 0; a < nAP; a++) {
      for (let m = 0; m < nML; m++) {
        cFreq[idx] = freqs[fi];
        cAP[idx] = apVals[a];
        cML[idx] = mlVals[m];
        cVal[idx] = values[fi * nAP * nML + a * nML + m];
        idx++;
      }
    }
  }
  const table = tableFromArrays({ freq: cFreq, AP: cAP, ML: cML, value: cVal });
  const payload = Buffer.from(tableToIPC(table)).toString("base64");
  return {
    name: "test",
    view_type: "psd_live",
    dims: ["freq", "AP", "ML"],
    shape: [nF, nAP, nML],
    encoding: "arrow_ipc",
    payload,
    meta: {},
  };
}

function syntheticCube(): {
  freqs: number[];
  ap: number[];
  ml: number[];
  values: Float32Array;
} {
  // 4 freqs × 3 AP × 2 ML — small enough to enumerate by hand if a parity
  // assertion fails. Distinct integer coords on every dim so a transposed
  // reshape would surface as a label mismatch instead of silently
  // re-arranging cells.
  const freqs = [10, 20, 30, 40];
  const ap = [0, 1, 2];
  const ml = [100, 200];
  const values = new Float32Array(4 * 3 * 2);
  for (let fi = 0; fi < 4; fi++) {
    for (let a = 0; a < 3; a++) {
      for (let m = 0; m < 2; m++) {
        // Use a value that encodes (fi, a, m) so a misshaped result is
        // immediately diagnosable.
        values[fi * 6 + a * 2 + m] = fi * 100 + a * 10 + m;
      }
    }
  }
  return { freqs, ap, ml, values };
}

describe("decodeLabeledTensor + extractPSDHeatmapV2 (no IPC)", () => {
  it("matches v1 extractPSDHeatmap on the same (freq, AP, ML) cube", () => {
    const { freqs, ap, ml, values } = syntheticCube();

    // v2 path: build LabeledTensor directly (no IPC round-trip).
    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["freq", "AP", "ML"],
        shape: [freqs.length, ap.length, ml.length],
        dtype: "float32",
        units: "uV",
        attrs: {},
        display_transforms: [],
      },
      data: values,
      coords: {
        freq: Float64Array.from(freqs),
        AP: Float64Array.from(ap),
        ML: Float64Array.from(ml),
      },
    };
    const v2 = extractPSDHeatmapV2(labeled);

    // v1 path: build a long-format Arrow slice with identical values.
    const v1Slice = buildLongFormatSlice(freqs, ap, ml, values);
    const v1 = extractPSDHeatmap(decodeArrowSlice(v1Slice));

    expect(v2.freqs).toEqual(v1.freqs);
    expect(v2.channelLabels).toEqual(v1.channelLabels);
    expect(v2.matrix.length).toBe(v1.matrix.length);
    for (let fi = 0; fi < v2.matrix.length; fi++) {
      for (let ci = 0; ci < v2.matrix[fi].length; ci++) {
        // Both paths carry the same underlying float values; equality is
        // exact within float32 representability.
        expect(v2.matrix[fi][ci]).toBeCloseTo(v1.matrix[fi][ci], 5);
      }
    }
  });

  it("supports (freq, channel) layout with `Ch{n}` labels", () => {
    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["freq", "channel"],
        shape: [2, 3],
        dtype: "float32",
        units: "uV",
        attrs: {},
        display_transforms: [],
      },
      data: new Float32Array([1, 2, 3, 4, 5, 6]),
      coords: {
        freq: Float64Array.from([10, 20]),
        channel: Float64Array.from([0, 1, 2]),
      },
    };
    const v2 = extractPSDHeatmapV2(labeled);
    expect(v2.channelLabels).toEqual(["Ch0", "Ch1", "Ch2"]);
    expect(v2.matrix).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("rejects when freq dim is missing", () => {
    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["AP", "ML"],
        shape: [2, 2],
        dtype: "float32",
        units: null,
        attrs: {},
        display_transforms: [],
      },
      data: new Float32Array([1, 2, 3, 4]),
      coords: { AP: Float64Array.from([0, 1]), ML: Float64Array.from([0, 1]) },
    };
    expect(extractPSDHeatmapV2(labeled)).toEqual({ freqs: [], channelLabels: [], matrix: [] });
  });
});

describe("extractTimeseriesV2", () => {
  it("matches extractTimeseriesColumnar on a (time, AP, ML) cube", () => {
    const times = [0.0, 0.1, 0.2, 0.3];
    const ap = [0, 1];
    const ml = [0, 1, 2];
    const nT = times.length, nAP = ap.length, nML = ml.length;
    const total = nT * nAP * nML;
    const data = new Float32Array(total);
    for (let ti = 0; ti < nT; ti++) {
      for (let a = 0; a < nAP; a++) {
        for (let m = 0; m < nML; m++) {
          data[ti * nAP * nML + a * nML + m] = ti * 100 + a * 10 + m;
        }
      }
    }

    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["time", "AP", "ML"],
        shape: [nT, nAP, nML],
        dtype: "float32",
        units: "uV",
        attrs: {},
        display_transforms: [],
      },
      data,
      coords: {
        time: Float64Array.from(times),
        AP: Float64Array.from(ap),
        ML: Float64Array.from(ml),
      },
    };
    const v2 = extractTimeseriesV2(labeled);

    // Build v1 long-format equivalent for parity check.
    const cT = new Float64Array(total);
    const cAP = new Float64Array(total);
    const cML = new Float64Array(total);
    const cV = new Float64Array(total);
    let idx = 0;
    for (let ti = 0; ti < nT; ti++) {
      for (let a = 0; a < nAP; a++) {
        for (let m = 0; m < nML; m++) {
          cT[idx] = times[ti];
          cAP[idx] = ap[a];
          cML[idx] = ml[m];
          cV[idx] = data[ti * nAP * nML + a * nML + m];
          idx++;
        }
      }
    }
    const table = tableFromArrays({ time: cT, AP: cAP, ML: cML, value: cV });
    const payload = Buffer.from(tableToIPC(table)).toString("base64");
    const v1Slice: TensorSliceDTO = {
      name: "test",
      view_type: "timeseries",
      dims: ["time", "AP", "ML"],
      shape: [nT, nAP, nML],
      encoding: "arrow_ipc",
      payload,
      meta: {},
    };
    const v1 = extractTimeseriesColumnar(decodeArrowSlice(v1Slice));

    expect(v2.times).toEqual(v1.times);
    expect(v2.series.map((s) => s.key).sort()).toEqual(v1.series.map((s) => s.key).sort());
    // Compare per-series values by key — v1 may order series differently.
    const v2ByKey = new Map(v2.series.map((s) => [s.key, s]));
    for (const s1 of v1.series) {
      const s2 = v2ByKey.get(s1.key);
      expect(s2).toBeDefined();
      for (let i = 0; i < s1.values.length; i++) {
        expect(s2!.values[i]).toBeCloseTo(s1.values[i], 5);
      }
    }
  });

  it("supports (time, channel) layout with `Ch{n}` labels", () => {
    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["time", "channel"],
        shape: [2, 3],
        dtype: "float32",
        units: "uV",
        attrs: {},
        display_transforms: [],
      },
      data: new Float32Array([1, 2, 3, 4, 5, 6]),
      coords: {
        time: Float64Array.from([0.0, 0.1]),
        channel: Float64Array.from([0, 1, 2]),
      },
    };
    const v2 = extractTimeseriesV2(labeled);
    expect(v2.times).toEqual([0.0, 0.1]);
    expect(v2.series.map((s) => s.label)).toEqual(["Ch 0", "Ch 1", "Ch 2"]);
    expect(Array.from(v2.series[0].values)).toEqual([1, 4]);
    expect(Array.from(v2.series[1].values)).toEqual([2, 5]);
    expect(Array.from(v2.series[2].values)).toEqual([3, 6]);
  });

  it("collapses to single Signal series on (time,) only", () => {
    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["time"],
        shape: [3],
        dtype: "float32",
        units: null,
        attrs: {},
        display_transforms: [],
      },
      data: new Float32Array([10, 20, 30]),
      coords: { time: Float64Array.from([0, 1, 2]) },
    };
    const v2 = extractTimeseriesV2(labeled);
    expect(v2.series).toHaveLength(1);
    expect(v2.series[0].label).toBe("Signal");
    expect(Array.from(v2.series[0].values)).toEqual([10, 20, 30]);
  });
});

describe("extractSpectrogramV2", () => {
  it("matches extractSpectrogram on a (time, freq) cube", () => {
    const times = [0.0, 0.5, 1.0];
    const freqs = [10, 20];
    const nT = times.length, nF = freqs.length;
    const data = new Float32Array(nT * nF);
    for (let ti = 0; ti < nT; ti++) {
      for (let fi = 0; fi < nF; fi++) {
        data[ti * nF + fi] = ti * 100 + fi;
      }
    }
    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["time", "freq"],
        shape: [nT, nF],
        dtype: "float32",
        units: "uV^2/Hz",
        attrs: {},
        display_transforms: [],
      },
      data,
      coords: { time: Float64Array.from(times), freq: Float64Array.from(freqs) },
    };
    const v2 = extractSpectrogramV2(labeled);
    expect(v2.times).toEqual(times);
    expect(v2.freqs).toEqual(freqs);
    expect(v2.values).toEqual([
      [0, 1],
      [100, 101],
      [200, 201],
    ]);
  });

  it("averages over collapsed dims on (time, freq, AP, ML)", () => {
    // Build a cube where every spatial cell is the mean of its (a*10 + m)
    // contribution + a (t, f)-only base. Average across AP*ML should
    // recover base + (sum over a,m of (a*10 + m)) / (nAP*nML).
    const times = [0.0, 0.1];
    const freqs = [5, 10];
    const ap = [0, 1];
    const ml = [0, 1];
    const nT = 2, nF = 2, nAP = 2, nML = 2;
    const data = new Float32Array(nT * nF * nAP * nML);
    for (let ti = 0; ti < nT; ti++) {
      for (let fi = 0; fi < nF; fi++) {
        for (let a = 0; a < nAP; a++) {
          for (let m = 0; m < nML; m++) {
            const base = ti * 1000 + fi * 100;
            const spatial = a * 10 + m;
            data[ti * nF * nAP * nML + fi * nAP * nML + a * nML + m] = base + spatial;
          }
        }
      }
    }
    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["time", "freq", "AP", "ML"],
        shape: [nT, nF, nAP, nML],
        dtype: "float32",
        units: "uV^2/Hz",
        attrs: {},
        display_transforms: [],
      },
      data,
      coords: {
        time: Float64Array.from(times),
        freq: Float64Array.from(freqs),
        AP: Float64Array.from(ap),
        ML: Float64Array.from(ml),
      },
    };
    const v2 = extractSpectrogramV2(labeled);

    // Mean over (a, m) of (a*10 + m) for nAP=nML=2 = (0+1+10+11)/4 = 5.5
    const spatialMean = 5.5;
    for (let ti = 0; ti < nT; ti++) {
      for (let fi = 0; fi < nF; fi++) {
        expect(v2.values[ti][fi]).toBeCloseTo(ti * 1000 + fi * 100 + spatialMean, 5);
      }
    }
  });

  it("returns empty on missing time or freq dim", () => {
    const labeled: LabeledTensor = {
      meta: {
        version: "2.0",
        dims: ["freq", "AP"],
        shape: [2, 2],
        dtype: "float32",
        units: null,
        attrs: {},
        display_transforms: [],
      },
      data: new Float32Array([1, 2, 3, 4]),
      coords: { freq: Float64Array.from([10, 20]), AP: Float64Array.from([0, 1]) },
    };
    expect(extractSpectrogramV2(labeled)).toEqual({ times: [], freqs: [], values: [] });
  });
});

describe("decodeLabeledTensor — round-trip via the live python encoder", () => {
  // Drives the parity gate against actual wire bytes. Skipped when the pixi
  // python env isn't available (e.g. portable CI without the project env).
  const itIfPy = PY_AVAILABLE ? it : it.skip;

  itIfPy("decodes a real v2 IPC payload and matches the v1 extractor", { timeout: 60_000 }, () => {
    const { freqs, ap, ml, values } = syntheticCube();

    // Have python emit base64-encoded v2 IPC bytes for this exact cube.
    const valuesJson = JSON.stringify(Array.from(values));
    const script = `
import json, base64, sys, numpy as np, xarray as xr
sys.path.insert(0, "src")
from tensorscope.server.state import encode_arrow_v2
vals = np.array(${valuesJson}, dtype=np.float32).reshape(${freqs.length}, ${ap.length}, ${ml.length})
da = xr.DataArray(
    vals,
    dims=("freq", "AP", "ML"),
    coords={"freq": ${JSON.stringify(freqs)}, "AP": ${JSON.stringify(ap)}, "ML": ${JSON.stringify(ml)}},
)
sys.stdout.write(base64.b64encode(encode_arrow_v2(da)).decode("ascii"))
`;
    const cwd = resolve(__dirname, "../../..");
    const stdout = execFileSync(PY_PATH, ["-c", script], { cwd, encoding: "utf-8" });
    const buf = Buffer.from(stdout.trim(), "base64");

    // Decode + extract via the v2 pipeline.
    const labeled = decodeLabeledTensor(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(labeled.meta.dims).toEqual(["freq", "AP", "ML"]);
    expect(labeled.meta.shape).toEqual([freqs.length, ap.length, ml.length]);
    const v2 = extractPSDHeatmapV2(labeled);

    // v1 extractor on the equivalent long-format payload.
    const v1Slice = buildLongFormatSlice(freqs, ap, ml, values);
    const v1 = extractPSDHeatmap(decodeArrowSlice(v1Slice));

    expect(v2.freqs).toEqual(v1.freqs);
    expect(v2.channelLabels).toEqual(v1.channelLabels);
    for (let fi = 0; fi < v2.matrix.length; fi++) {
      for (let ci = 0; ci < v2.matrix[fi].length; ci++) {
        expect(v2.matrix[fi][ci]).toBeCloseTo(v1.matrix[fi][ci], 5);
      }
    }
  });
});
