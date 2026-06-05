/**
 * Contract v2 Arrow IPC decoder + per-view extractors.
 *
 * The v2 wire format is a single Arrow record batch with:
 *   - `data` field: FixedSizeList<float32, prod(shape)> in row-major order
 *   - `coords/<dim>` fields: FixedSizeList<float64> (or Utf8) per dim
 *   - schema metadata under the `tensorscope` key carrying a JSON blob
 *     {version, dims, shape, dtype, units, attrs, display_transforms,
 *      processing, slice_provenance}.
 *
 * Decoders read the metadata first to learn the dim ordering, then
 * unpack the `data` typed array and reshape by `shape`. No per-row
 * coord duplication, no base64 — the raw IPC bytes arrive over HTTP.
 *
 * See `src/tensorscope/server/state.py:encode_arrow_v2` for the
 * matching encoder and `docs/design/contract-v2.md` §3.1 for the
 * design rationale.
 */
import { tableFromIPC, type Table } from "apache-arrow";
import type {
  ColumnarTimeseries,
  PSDAvgData,
  PSDHeatmapData,
  SpatialCell,
  SpatialMovie,
  SpatialMovieFrame,
  Spectrogram,
} from "./arrow";
import type { HeatmapEncoding, HeatmapGrid } from "./heatmap";

export const CONTRACT_V2_METADATA_KEY = "tensorscope";

export type LabeledTensorMeta = {
  version: string;
  dims: string[];
  shape: number[];
  dtype: string;
  units: string | null;
  attrs: Record<string, unknown>;
  display_transforms: string[];
  processing?: { requested: boolean; applied: boolean; error: string | null };
  slice_provenance?: Record<string, unknown>;
  selected_time?: number | null;
};

/**
 * A decoded v2 slice. `data` is the raw row-major typed array (length =
 * prod(shape)); callers reshape per `meta.dims` order.
 *
 * `coords` is keyed by dim name. Numeric coords arrive as Float64Array;
 * string-typed coords (rare; e.g. channel labels in a future schema) come
 * back as string[].
 */
export type LabeledTensor = {
  meta: LabeledTensorMeta;
  data: Float32Array;
  coords: Record<string, Float64Array | string[]>;
};

function readSchemaMetadata(table: Table): LabeledTensorMeta {
  // apache-arrow exposes schema metadata as Map<string, string>. The
  // backend writes a single key (`tensorscope`) holding a JSON blob; we
  // unpack it here so callers see typed fields instead of raw JSON.
  const md = table.schema.metadata;
  const raw = md.get(CONTRACT_V2_METADATA_KEY);
  if (!raw) {
    throw new Error(
      `v2 decoder: missing schema metadata key "${CONTRACT_V2_METADATA_KEY}". ` +
        "Is this actually a v2 payload?",
    );
  }
  const parsed = JSON.parse(raw) as LabeledTensorMeta;
  if (!parsed.version || !parsed.dims || !parsed.shape) {
    throw new Error(
      `v2 decoder: malformed metadata blob — missing version/dims/shape (got ${raw.slice(0, 200)})`,
    );
  }
  return parsed;
}

function readFixedSizeListChild(table: Table, name: string): Float32Array | Float64Array | string[] | null {
  // apache-arrow returns the FixedSizeList column as a Vector; the inner
  // values live on `column(...).getChildAt(0)`. For numeric children we get
  // a typed array directly via `toArray()`; for utf8 we materialise to
  // string[].
  const col = table.getChild(name);
  if (!col) return null;
  const child = col.getChildAt(0);
  if (!child) return null;
  // toArray() returns the appropriate typed view for numeric types and a
  // plain array for strings — this matches what `extractPSDHeatmapV2`
  // expects. For string coords we coerce explicitly so consumers always
  // see a normal array.
  const arr = child.toArray();
  if (arr instanceof Float32Array || arr instanceof Float64Array) return arr;
  if (ArrayBuffer.isView(arr)) {
    // int8/16/32/64 fall here — coerce to Float64Array so downstream
    // numeric handling is uniform.
    return Float64Array.from(arr as unknown as ArrayLike<number>);
  }
  return Array.from(arr as ArrayLike<unknown>, (v) => String(v));
}

/**
 * Decode raw v2 Arrow IPC bytes into a `LabeledTensor`.
 *
 * The transferable contract: callers may hand `bytes` to a Web Worker via
 * `postMessage(buf, [buf])`. The decoder copies the values out of the
 * Arrow buffers into freshly-allocated typed arrays, so the resulting
 * `LabeledTensor` is itself transferable back to the main thread without
 * keeping the original buffer alive.
 */
export function decodeLabeledTensor(bytes: ArrayBuffer | Uint8Array): LabeledTensor {
  const table = tableFromIPC(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const meta = readSchemaMetadata(table);

  const dataField = readFixedSizeListChild(table, "data");
  if (!dataField || !(dataField instanceof Float32Array || dataField instanceof Float64Array)) {
    throw new Error("v2 decoder: `data` field missing or non-numeric");
  }
  // Always coerce to Float32Array — the wire is float32 per §3.1.
  const data =
    dataField instanceof Float32Array
      ? new Float32Array(dataField) // copy; detaches from the IPC buffer
      : Float32Array.from(dataField);

  const expected = meta.shape.reduce((a, b) => a * b, 1);
  if (data.length !== expected) {
    throw new Error(
      `v2 decoder: data length ${data.length} ≠ prod(shape)=${expected} ` +
        `for shape=${JSON.stringify(meta.shape)}`,
    );
  }

  const coords: Record<string, Float64Array | string[]> = {};
  for (const dim of meta.dims) {
    const child = readFixedSizeListChild(table, `coords/${dim}`);
    if (child == null) continue;
    if (child instanceof Float32Array) {
      coords[dim] = Float64Array.from(child);
    } else if (child instanceof Float64Array) {
      // Detach from the underlying Arrow buffer so the IPC bytes can be GC'd.
      coords[dim] = new Float64Array(child);
    } else {
      coords[dim] = child as string[];
    }
  }

  return { meta, data, coords };
}

// ── Per-view extractors ───────────────────────────────────────────────────

/**
 * Build a (freq × channel) heatmap matrix from a v2-decoded psd_live cube.
 *
 * This mirrors the v1 `extractPSDHeatmap` output shape exactly so that
 * `PSDHeatmapView` consumes it without modification. Where v1 walked
 * decoded rows and grouped by string-encoded labels, v2 already has the
 * cube reshaped — we just rebuild `channelLabels` and transpose the
 * non-freq dims into the channel column axis.
 *
 * Supported source shapes (per the v1 view registry):
 *   - (freq, AP, ML)       → channels are flattened (AP, ML) pairs
 *   - (freq, channel)      → channels are the channel coord values
 *   - (freq,)              → single "Signal" column
 */
export function extractPSDHeatmapV2(t: LabeledTensor): PSDHeatmapData {
  const { meta, data, coords } = t;
  const freqAxis = meta.dims.indexOf("freq");
  if (freqAxis === -1) {
    return { freqs: [], channelLabels: [], matrix: [] };
  }
  const freqsTyped = coords["freq"];
  if (!freqsTyped || !(freqsTyped instanceof Float64Array)) {
    return { freqs: [], channelLabels: [], matrix: [] };
  }
  const freqs = Array.from(freqsTyped);
  const nF = freqs.length;
  const shape = meta.shape;

  // Build the per-channel label set. Order matches row-major iteration
  // over the non-freq dims so we can read straight from the cube without
  // an explicit transpose.
  const channelDims = meta.dims.map((d, i) => ({ name: d, axis: i, size: shape[i] }))
    .filter((d) => d.axis !== freqAxis);

  // Special-case the (freq, AP, ML) and (freq, channel) layouts — match
  // the v1 label format exactly so downstream code (cursor lookup,
  // click-to-select in PSDHeatmapView) keeps working.
  let channelLabels: string[];
  let channelIndex: number[][]; // for each channel column, the (axis-index per non-freq dim)
  if (channelDims.length === 2 && channelDims[0].name === "AP" && channelDims[1].name === "ML") {
    const apVals = coords["AP"];
    const mlVals = coords["ML"];
    if (!apVals || !mlVals) return { freqs, channelLabels: [], matrix: [] };
    channelLabels = [];
    channelIndex = [];
    for (let a = 0; a < channelDims[0].size; a++) {
      for (let m = 0; m < channelDims[1].size; m++) {
        const ap = (apVals as Float64Array | string[])[a];
        const ml = (mlVals as Float64Array | string[])[m];
        channelLabels.push(`AP${ap}_ML${ml}`);
        channelIndex.push([a, m]);
      }
    }
  } else if (channelDims.length === 1 && channelDims[0].name === "channel") {
    const chVals = coords["channel"];
    channelLabels = [];
    channelIndex = [];
    for (let i = 0; i < channelDims[0].size; i++) {
      const v = chVals ? (chVals as Float64Array | string[])[i] : i;
      channelLabels.push(`Ch${v}`);
      channelIndex.push([i]);
    }
  } else if (channelDims.length === 0) {
    channelLabels = ["Signal"];
    channelIndex = [[]];
  } else {
    // Generic fallback — concatenate dim/value pairs; not pretty but the
    // matrix will still render. Rare in current v1 schemas; revisit when
    // Phase 2 view registry lands.
    const sizes = channelDims.map((d) => d.size);
    const total = sizes.reduce((a, b) => a * b, 1);
    channelLabels = new Array(total);
    channelIndex = new Array(total);
    const indices = new Array(channelDims.length).fill(0);
    for (let c = 0; c < total; c++) {
      const parts = channelDims.map((d, i) => {
        const cv = coords[d.name];
        const raw = cv ? (cv as Float64Array | string[])[indices[i]] : indices[i];
        return `${d.name}${raw}`;
      });
      channelLabels[c] = parts.join("_");
      channelIndex[c] = [...indices];
      // Increment row-major
      for (let i = indices.length - 1; i >= 0; i--) {
        indices[i] += 1;
        if (indices[i] < sizes[i]) break;
        indices[i] = 0;
      }
    }
  }

  // Compute the row-major stride per axis.
  const strides = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i--) strides[i] = strides[i + 1] * shape[i + 1];
  const freqStride = strides[freqAxis];
  const channelStridesPerDim = channelDims.map((d) => strides[d.axis]);

  const matrix: number[][] = new Array(nF);
  for (let fi = 0; fi < nF; fi++) {
    const row = new Array(channelLabels.length);
    for (let ci = 0; ci < channelLabels.length; ci++) {
      let off = fi * freqStride;
      const idx = channelIndex[ci];
      for (let k = 0; k < idx.length; k++) off += idx[k] * channelStridesPerDim[k];
      row[ci] = data[off];
    }
    matrix[fi] = row;
  }

  return { freqs, channelLabels, matrix };
}

/**
 * Build a `ColumnarTimeseries` from a v2 LabeledTensor whose first dim is
 * `time`. Mirrors `extractTimeseriesColumnar` / `extractTimeseriesColumnarFast`
 * from v1 — output shape is identical so callers can swap paths without
 * touching downstream code.
 *
 * Supported source shapes:
 *   - (time,)              → single "Signal" series
 *   - (time, channel)      → one series per channel, labelled `Ch{n}`
 *   - (time, AP, ML)       → one series per (AP, ML), labelled `(ap,ml)` to
 *                            match the v1 `seriesKey` convention used by uPlot
 */
export function extractTimeseriesV2(t: LabeledTensor): ColumnarTimeseries {
  const { meta, data, coords } = t;
  const timeAxis = meta.dims.indexOf("time");
  if (timeAxis === -1) return { times: [], series: [] };
  const timesTyped = coords["time"];
  if (!timesTyped || !(timesTyped instanceof Float64Array)) {
    return { times: [], series: [] };
  }
  const times = Array.from(timesTyped);
  const nT = times.length;
  const shape = meta.shape;

  // Row-major strides per axis. Same calculation as `extractPSDHeatmapV2`.
  const strides = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i--) strides[i] = strides[i + 1] * shape[i + 1];
  const timeStride = strides[timeAxis];

  const seriesDims = meta.dims
    .map((d, i) => ({ name: d, axis: i, size: shape[i] }))
    .filter((d) => d.axis !== timeAxis);

  // Build (key, label, channelIndex per non-time dim) tuples. Label format
  // mirrors v1's `seriesKey()` so uPlot's stable channel ordering and the
  // chip-strip label parsing keep working without a special v2 case.
  let series: { key: string; label: string; values: Float32Array }[];
  let perSeriesIdx: number[][];
  if (seriesDims.length === 0) {
    series = [{ key: "signal", label: "Signal", values: new Float32Array(nT) }];
    perSeriesIdx = [[]];
  } else if (seriesDims.length === 1 && seriesDims[0].name === "channel") {
    const chVals = coords["channel"];
    series = [];
    perSeriesIdx = [];
    for (let i = 0; i < seriesDims[0].size; i++) {
      const v = chVals ? (chVals as Float64Array | string[])[i] : i;
      series.push({ key: `ch-${v}`, label: `Ch ${v}`, values: new Float32Array(nT) });
      perSeriesIdx.push([i]);
    }
  } else if (
    seriesDims.length === 2 &&
    seriesDims[0].name === "AP" &&
    seriesDims[1].name === "ML"
  ) {
    const apVals = coords["AP"];
    const mlVals = coords["ML"];
    if (!apVals || !mlVals) return { times: [], series: [] };
    series = [];
    perSeriesIdx = [];
    for (let a = 0; a < seriesDims[0].size; a++) {
      for (let m = 0; m < seriesDims[1].size; m++) {
        const ap = (apVals as Float64Array | string[])[a];
        const ml = (mlVals as Float64Array | string[])[m];
        series.push({
          key: `ap-${ap}-ml-${ml}`,
          label: `(${ap},${ml})`,
          values: new Float32Array(nT),
        });
        perSeriesIdx.push([a, m]);
      }
    }
  } else {
    // Generic fallback — concatenate dim names + raw coord values, row-major
    // over the non-time dims. Rare in current v1 schemas; revisit when
    // Phase 2 view registry lands.
    const sizes = seriesDims.map((d) => d.size);
    const total = sizes.reduce((a, b) => a * b, 1);
    series = new Array(total);
    perSeriesIdx = new Array(total);
    const indices = new Array(seriesDims.length).fill(0);
    for (let c = 0; c < total; c++) {
      const parts = seriesDims.map((d, i) => {
        const cv = coords[d.name];
        const raw = cv ? (cv as Float64Array | string[])[indices[i]] : indices[i];
        return `${d.name}${raw}`;
      });
      series[c] = { key: parts.join("-"), label: parts.join("·"), values: new Float32Array(nT) };
      perSeriesIdx[c] = [...indices];
      for (let i = indices.length - 1; i >= 0; i--) {
        indices[i] += 1;
        if (indices[i] < sizes[i]) break;
        indices[i] = 0;
      }
    }
  }

  const seriesStridesPerDim = seriesDims.map((d) => strides[d.axis]);
  for (let ti = 0; ti < nT; ti++) {
    const tOff = ti * timeStride;
    for (let si = 0; si < series.length; si++) {
      let off = tOff;
      const idx = perSeriesIdx[si];
      for (let k = 0; k < idx.length; k++) off += idx[k] * seriesStridesPerDim[k];
      series[si].values[ti] = data[off];
    }
  }

  return { times, series, meta };
}

/**
 * Build a `Spectrogram` from a v2 LabeledTensor whose dims include `time`
 * and `freq`. Mirrors v1's `extractSpectrogram`: when extra non-(time,freq)
 * dims exist (e.g. AP, ML, channel), values are averaged across them so the
 * heatmap stays 2-D.
 *
 * Returns the v1 shape: `{ times, freqs, values: number[][] }` where
 * `values[t][f]` is the mean across collapsed dims.
 */
export function extractSpectrogramV2(t: LabeledTensor): Spectrogram {
  const { meta, data, coords } = t;
  const timeAxis = meta.dims.indexOf("time");
  const freqAxis = meta.dims.indexOf("freq");
  if (timeAxis === -1 || freqAxis === -1) return { times: [], freqs: [], values: [] };
  const timesTyped = coords["time"];
  const freqsTyped = coords["freq"];
  if (
    !timesTyped ||
    !(timesTyped instanceof Float64Array) ||
    !freqsTyped ||
    !(freqsTyped instanceof Float64Array)
  ) {
    return { times: [], freqs: [], values: [] };
  }
  const times = Array.from(timesTyped);
  const freqs = Array.from(freqsTyped);
  const nT = times.length;
  const nF = freqs.length;
  const shape = meta.shape;

  const strides = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i--) strides[i] = strides[i + 1] * shape[i + 1];
  const timeStride = strides[timeAxis];
  const freqStride = strides[freqAxis];

  // Enumerate every combination of the remaining (collapsed) dims so we can
  // average across them in a single pass. For the common (time, freq, AP, ML)
  // shape this is nAP*nML iterations per (t, f) cell.
  const otherDims = meta.dims
    .map((d, i) => ({ name: d, axis: i, size: shape[i] }))
    .filter((d) => d.axis !== timeAxis && d.axis !== freqAxis);
  const otherSizes = otherDims.map((d) => d.size);
  const otherStrides = otherDims.map((d) => strides[d.axis]);
  const otherCount = otherSizes.reduce((a, b) => a * b, 1);

  const values: number[][] = new Array(nT);
  for (let ti = 0; ti < nT; ti++) {
    const row = new Array(nF);
    for (let fi = 0; fi < nF; fi++) {
      const base = ti * timeStride + fi * freqStride;
      if (otherCount === 0) {
        row[fi] = data[base];
        continue;
      }
      let sum = 0;
      let count = 0;
      const idx = new Array(otherDims.length).fill(0);
      for (let c = 0; c < otherCount; c++) {
        let off = base;
        for (let k = 0; k < idx.length; k++) off += idx[k] * otherStrides[k];
        const v = data[off];
        if (Number.isFinite(v)) {
          sum += v;
          count += 1;
        }
        for (let i = idx.length - 1; i >= 0; i--) {
          idx[i] += 1;
          if (idx[i] < otherSizes[i]) break;
          idx[i] = 0;
        }
      }
      row[fi] = count > 0 ? sum / count : NaN;
    }
    values[ti] = row;
  }

  // Surface the effective spectral params (spectral-window decoupling). These
  // ride in the metadata blob; numbers come through JSON already typed, but
  // guard with Number.isFinite per the no-`as number` convention.
  const a = (meta.attrs ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const specMeta = {
    npersegS: num(a["spectrogram_live_nperseg_s_effective"]),
    overlapPctEffective: num(a["spectrogram_live_noverlap_pct_effective"]),
    overlapPctRequested: num(a["spectrogram_live_noverlap_pct_requested"]),
    capActive:
      typeof a["spectrogram_live_segment_cap_active"] === "boolean"
        ? (a["spectrogram_live_segment_cap_active"] as boolean)
        : undefined,
  };

  return { times, freqs, values, specMeta };
}

// ── Row-major helpers ───────────────────────────────────────────────────────

/** Row-major strides for a shape: `strides[i] = prod(shape[i+1:])`. */
function rowMajorStrides(shape: number[]): number[] {
  const strides = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i--) strides[i] = strides[i + 1] * shape[i + 1];
  return strides;
}

/**
 * Average PSD curve (mean + population std across spatial cells per freq) from
 * a v2 (freq, *spatial) cube. Mirrors v1 `extractPSDAverage`:
 *   - non-finite cells are skipped (v1's `toNumber` drops NaN/inf rows)
 *   - std is population (÷N), 0 when a freq has a single finite cell
 *   - a freq with no finite cells is omitted entirely (v1 never creates that
 *     group), so the freq axis matches v1 exactly
 */
export function extractPSDAverageV2(t: LabeledTensor): PSDAvgData {
  const { meta, data, coords } = t;
  const freqAxis = meta.dims.indexOf("freq");
  if (freqAxis === -1) return { freqs: [], mean: [], std: [] };
  const freqsTyped = coords["freq"];
  if (!freqsTyped || !(freqsTyped instanceof Float64Array)) {
    return { freqs: [], mean: [], std: [] };
  }
  const shape = meta.shape;
  const strides = rowMajorStrides(shape);
  const freqStride = strides[freqAxis];

  const otherDims = meta.dims
    .map((d, i) => ({ axis: i, size: shape[i] }))
    .filter((d) => d.axis !== freqAxis);
  const otherSizes = otherDims.map((d) => d.size);
  const otherStrides = otherDims.map((d) => strides[d.axis]);
  const otherCount = otherSizes.reduce((a, b) => a * b, 1);

  const freqs: number[] = [];
  const mean: number[] = [];
  const std: number[] = [];
  for (let fi = 0; fi < freqsTyped.length; fi++) {
    const base = fi * freqStride;
    const vals: number[] = [];
    const idx = new Array(otherDims.length).fill(0);
    for (let c = 0; c < otherCount; c++) {
      let off = base;
      for (let k = 0; k < idx.length; k++) off += idx[k] * otherStrides[k];
      const v = data[off];
      if (Number.isFinite(v)) vals.push(v);
      for (let i = idx.length - 1; i >= 0; i--) {
        idx[i] += 1;
        if (idx[i] < otherSizes[i]) break;
        idx[i] = 0;
      }
    }
    if (vals.length === 0) continue; // mirror v1: freq absent when fully non-finite
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    freqs.push(freqsTyped[fi]);
    mean.push(m);
    if (vals.length > 1) {
      const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length;
      std.push(Math.sqrt(variance));
    } else {
      std.push(0);
    }
  }
  return { freqs, mean, std };
}

/**
 * Spatial power at the nearest freq to `targetFreq` from a v2 (freq, AP, ML)
 * cube. Mirrors v1 `extractPSDSpatialAtFreq`:
 *   - nearest-freq tie-break favours the smaller freq (ascending scan, `<`)
 *   - non-finite cells skipped; AP/ML ranks built only from finite cells
 *   - 0-based integer ranks (sorted ascending unique), output sorted (ap, ml)
 */
export function extractPSDSpatialV2(
  t: LabeledTensor,
  targetFreq: number,
): { ap: number; ml: number; value: number }[] {
  const { meta, data, coords } = t;
  const freqAxis = meta.dims.indexOf("freq");
  const apAxis = meta.dims.indexOf("AP");
  const mlAxis = meta.dims.indexOf("ML");
  if (freqAxis === -1 || apAxis === -1 || mlAxis === -1) return [];
  const freqsTyped = coords["freq"];
  const apTyped = coords["AP"];
  const mlTyped = coords["ML"];
  if (
    !(freqsTyped instanceof Float64Array) ||
    !(apTyped instanceof Float64Array) ||
    !(mlTyped instanceof Float64Array)
  ) {
    return [];
  }
  if (freqsTyped.length === 0) return [];

  let nearestIdx = 0;
  let minDist = Math.abs(targetFreq - freqsTyped[0]);
  for (let i = 0; i < freqsTyped.length; i++) {
    const dist = Math.abs(targetFreq - freqsTyped[i]);
    if (dist < minDist) {
      minDist = dist;
      nearestIdx = i;
    }
  }

  const shape = meta.shape;
  const strides = rowMajorStrides(shape);
  const freqStride = strides[freqAxis];
  const apStride = strides[apAxis];
  const mlStride = strides[mlAxis];
  const nAP = shape[apAxis];
  const nML = shape[mlAxis];

  const rawCells: { apRaw: number; mlRaw: number; value: number }[] = [];
  for (let a = 0; a < nAP; a++) {
    for (let m = 0; m < nML; m++) {
      const v = data[nearestIdx * freqStride + a * apStride + m * mlStride];
      if (!Number.isFinite(v)) continue;
      rawCells.push({ apRaw: apTyped[a], mlRaw: mlTyped[m], value: v });
    }
  }

  const apSorted = Array.from(new Set(rawCells.map((c) => c.apRaw))).sort((a, b) => a - b);
  const mlSorted = Array.from(new Set(rawCells.map((c) => c.mlRaw))).sort((a, b) => a - b);
  const apRank = new Map(apSorted.map((v, i) => [v, i]));
  const mlRank = new Map(mlSorted.map((v, i) => [v, i]));

  return rawCells
    .map((c) => ({ ap: apRank.get(c.apRaw)!, ml: mlRank.get(c.mlRaw)!, value: c.value }))
    .sort((a, b) => a.ap - b.ap || a.ml - b.ml);
}

/**
 * Spatial cells (AP × ML heatmap) from a v2 cube whose dims include AP and ML.
 * Mirrors v1 `extractSpatialCells`:
 *   - groups by raw (AP, ML) and averages finite values (collapses any extra
 *     dims, e.g. a residual time singleton)
 *   - 0-based integer ranks from finite cells, output sorted (ap, ml)
 */
export function extractSpatialCellsV2(t: LabeledTensor): SpatialCell[] {
  const { meta, data, coords } = t;
  const apAxis = meta.dims.indexOf("AP");
  const mlAxis = meta.dims.indexOf("ML");
  if (apAxis === -1 || mlAxis === -1) return [];
  const apTyped = coords["AP"];
  const mlTyped = coords["ML"];
  if (!(apTyped instanceof Float64Array) || !(mlTyped instanceof Float64Array)) return [];

  const shape = meta.shape;
  const strides = rowMajorStrides(shape);
  const apStride = strides[apAxis];
  const mlStride = strides[mlAxis];
  const nAP = shape[apAxis];
  const nML = shape[mlAxis];
  const otherDims = meta.dims
    .map((d, i) => ({ axis: i, size: shape[i] }))
    .filter((d) => d.axis !== apAxis && d.axis !== mlAxis);
  const otherSizes = otherDims.map((d) => d.size);
  const otherStrides = otherDims.map((d) => strides[d.axis]);
  const otherCount = otherSizes.reduce((a, b) => a * b, 1);

  const grouped = new Map<string, { apRaw: number; mlRaw: number; sum: number; count: number }>();
  for (let a = 0; a < nAP; a++) {
    for (let m = 0; m < nML; m++) {
      const apRaw = apTyped[a];
      const mlRaw = mlTyped[m];
      const base = a * apStride + m * mlStride;
      const idx = new Array(otherDims.length).fill(0);
      for (let c = 0; c < otherCount; c++) {
        let off = base;
        for (let k = 0; k < idx.length; k++) off += idx[k] * otherStrides[k];
        const v = data[off];
        if (Number.isFinite(v)) {
          const key = `${apRaw}|${mlRaw}`;
          let g = grouped.get(key);
          if (!g) {
            g = { apRaw, mlRaw, sum: 0, count: 0 };
            grouped.set(key, g);
          }
          g.sum += v;
          g.count += 1;
        }
        for (let i = idx.length - 1; i >= 0; i--) {
          idx[i] += 1;
          if (idx[i] < otherSizes[i]) break;
          idx[i] = 0;
        }
      }
    }
  }

  const cells = Array.from(grouped.values());
  const apSorted = Array.from(new Set(cells.map((c) => c.apRaw))).sort((a, b) => a - b);
  const mlSorted = Array.from(new Set(cells.map((c) => c.mlRaw))).sort((a, b) => a - b);
  const apRank = new Map(apSorted.map((v, i) => [v, i]));
  const mlRank = new Map(mlSorted.map((v, i) => [v, i]));
  return cells
    .map((c) => ({ ap: apRank.get(c.apRaw)!, ml: mlRank.get(c.mlRaw)!, value: c.sum / c.count }))
    .sort((a, b) => a.ap - b.ap || a.ml - b.ml);
}

/**
 * Per-frame spatial cells + global min/max from a v2 (time, AP, ML)
 * propagation_movie cube. Mirrors v1 `extractSpatialFrames`:
 *   - AP/ML ranks computed globally across all frames (stable cell positions)
 *   - non-finite cells skipped; a fully non-finite frame is omitted
 *   - global min/max over finite values; per-frame cells sorted (ap, ml)
 */
export function extractSpatialFramesV2(t: LabeledTensor): SpatialMovie {
  const empty: SpatialMovie = { frames: [], nAP: 0, nML: 0, min: 0, max: 1 };
  const { meta, data, coords } = t;
  const timeAxis = meta.dims.indexOf("time");
  const apAxis = meta.dims.indexOf("AP");
  const mlAxis = meta.dims.indexOf("ML");
  if (timeAxis === -1 || apAxis === -1 || mlAxis === -1) return empty;
  const timeTyped = coords["time"];
  const apTyped = coords["AP"];
  const mlTyped = coords["ML"];
  if (
    !(timeTyped instanceof Float64Array) ||
    !(apTyped instanceof Float64Array) ||
    !(mlTyped instanceof Float64Array)
  ) {
    return empty;
  }

  const shape = meta.shape;
  const strides = rowMajorStrides(shape);
  const timeStride = strides[timeAxis];
  const apStride = strides[apAxis];
  const mlStride = strides[mlAxis];
  const nT = shape[timeAxis];
  const nAP = shape[apAxis];
  const nML = shape[mlAxis];

  const apRaws = new Set<number>();
  const mlRaws = new Set<number>();
  let min = Infinity;
  let max = -Infinity;
  for (let ti = 0; ti < nT; ti++) {
    for (let a = 0; a < nAP; a++) {
      for (let m = 0; m < nML; m++) {
        const v = data[ti * timeStride + a * apStride + m * mlStride];
        if (!Number.isFinite(v)) continue;
        apRaws.add(apTyped[a]);
        mlRaws.add(mlTyped[m]);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }

  const apSorted = Array.from(apRaws).sort((a, b) => a - b);
  const mlSorted = Array.from(mlRaws).sort((a, b) => a - b);
  if (apSorted.length === 0) return empty; // no finite cells anywhere
  const apRank = new Map(apSorted.map((v, i) => [v, i]));
  const mlRank = new Map(mlSorted.map((v, i) => [v, i]));

  const frames: SpatialMovieFrame[] = [];
  for (let ti = 0; ti < nT; ti++) {
    const cells: SpatialCell[] = [];
    for (let a = 0; a < nAP; a++) {
      for (let m = 0; m < nML; m++) {
        const v = data[ti * timeStride + a * apStride + m * mlStride];
        if (!Number.isFinite(v)) continue;
        cells.push({ ap: apRank.get(apTyped[a])!, ml: mlRank.get(mlTyped[m])!, value: v });
      }
    }
    if (cells.length === 0) continue; // mirror v1: frame absent when fully non-finite
    cells.sort((a, b) => a.ap - b.ap || a.ml - b.ml);
    frames.push({ time: timeTyped[ti], cells });
  }
  if (frames.length === 0) return empty;

  return {
    frames,
    nAP: apSorted.length,
    nML: mlSorted.length,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 1,
  };
}

const EMPTY_HEATMAP: HeatmapGrid = {
  xDim: "", yDim: "", xVals: [], yVals: [], values: new Float64Array(0),
  nx: 0, ny: 0, availableDims: [], reducedDims: [],
};

/**
 * Generic N-D → 2-D heatmap pivot from a v2 LabeledTensor. Mirrors v1
 * `extractHeatmapND` (heatmap.ts) exactly so an encoding-driven `HeatmapView`
 * renders identically off either path:
 *   - `availableDims` = `meta.dims` (the data value carries no dim column in v2)
 *   - unique x/y values are the finite coord values, sorted ascending
 *   - every other dim is reduced (mean/max) into the colour; empty cell → NaN
 *
 * Re-pivots on the main thread (not the worker) because the axis `encoding` is
 * a live UI choice — the worker decodes the cube once, this reshapes it.
 */
export function extractHeatmapNDV2(
  t: LabeledTensor,
  encoding: HeatmapEncoding,
): HeatmapGrid {
  const { x: xDim, y: yDim, reduce = "mean" } = encoding;
  const { meta, data, coords } = t;
  const dims = meta.dims;
  const xAxis = dims.indexOf(xDim);
  const yAxis = dims.indexOf(yDim);
  if (xAxis === -1 || yAxis === -1 || xDim === yDim) return EMPTY_HEATMAP;
  const xCoord = coords[xDim];
  const yCoord = coords[yDim];
  if (!(xCoord instanceof Float64Array) || !(yCoord instanceof Float64Array)) {
    return EMPTY_HEATMAP;
  }

  const availableDims = [...dims];
  const reducedDims = dims.filter((d) => d !== xDim && d !== yDim);

  // Unique finite coord values per axis → sorted band cells (mirror v1 pass 1).
  const xSet = new Set<number>();
  const ySet = new Set<number>();
  for (let i = 0; i < xCoord.length; i++) if (Number.isFinite(xCoord[i])) xSet.add(xCoord[i]);
  for (let i = 0; i < yCoord.length; i++) if (Number.isFinite(yCoord[i])) ySet.add(yCoord[i]);
  if (xSet.size === 0 || ySet.size === 0) return EMPTY_HEATMAP;

  const xVals = Array.from(xSet).sort((a, b) => a - b);
  const yVals = Array.from(ySet).sort((a, b) => a - b);
  const xIdx = new Map(xVals.map((v, i) => [v, i]));
  const yIdx = new Map(yVals.map((v, i) => [v, i]));
  const nx = xVals.length;
  const ny = yVals.length;

  const shape = meta.shape;
  const strides = rowMajorStrides(shape);
  const total = shape.reduce((a, b) => a * b, 1);

  // Pass 2: walk every cube cell (== one v1 long-format row), bucket by the
  // (x,y) coord at that cell's axis indices, reduce over the rest.
  const sums = new Float64Array(nx * ny);
  const counts = new Int32Array(nx * ny);
  const maxs = new Float64Array(nx * ny).fill(-Infinity);
  const idx = new Array(shape.length).fill(0);
  for (let off = 0; off < total; off++) {
    const xv = xCoord[idx[xAxis]];
    const yv = yCoord[idx[yAxis]];
    const v = data[off];
    if (Number.isFinite(xv) && Number.isFinite(yv) && Number.isFinite(v)) {
      const cell = yIdx.get(yv)! * nx + xIdx.get(xv)!;
      counts[cell]++;
      sums[cell] += v;
      if (v > maxs[cell]) maxs[cell] = v;
    }
    for (let i = idx.length - 1; i >= 0; i--) {
      idx[i] += 1;
      if (idx[i] < shape[i]) break;
      idx[i] = 0;
    }
  }

  const values = new Float64Array(nx * ny);
  for (let i = 0; i < values.length; i++) {
    if (counts[i] === 0) values[i] = NaN;
    else if (reduce === "max") values[i] = maxs[i];
    else values[i] = sums[i] / counts[i];
  }

  return { xDim, yDim, xVals, yVals, values, nx, ny, availableDims, reducedDims };
}

/**
 * Worker-friendly entry: dispatch to the right extractor by view type.
 * Centralised here so the worker thread doesn't import view-specific code
 * (keeping the worker bundle small).
 */
/**
 * Worker-decoded psd_live result. The cube (`tensor`) still feeds the
 * encoding-driven heatmap and the freq-selected spatial map — both reshape on
 * the main thread because their inputs (axis encoding / selected freq) change
 * live without a refetch. The param-free mean±std curve (`average`) is reduced
 * in the worker so the always-on full-cube walk never blocks the render thread
 * (perf-navigation-plan P8). One round-trip still feeds all three subviews.
 */
export type PSDLiveDecoded = { tensor: LabeledTensor; average: PSDAvgData };

export type ExtractedV2 =
  | PSDHeatmapData
  | PSDAvgData
  | PSDLiveDecoded
  | ColumnarTimeseries
  | Spectrogram
  | SpatialCell[]
  | SpatialMovie
  | LabeledTensor;

export function extractV2(viewType: string, t: LabeledTensor): ExtractedV2 {
  switch (viewType) {
    case "psd_heatmap":
      return extractPSDHeatmapV2(t);
    case "psd_average":
      // Param-free freq curve — reduced in the worker so the standalone
      // psd_average view consumes it directly (no main-thread cube walk).
      return extractPSDAverageV2(t);
    case "psd_live":
      // Cube + worker-reduced mean±std curve. The heatmap/spatial reshapes
      // stay on the main thread (live encoding / selected freq), but the
      // curve walk — which previously re-ran on every render — moves here.
      return { tensor: t, average: extractPSDAverageV2(t) };
    case "timeseries":
    case "navigator":
      return extractTimeseriesV2(t);
    case "spectrogram":
    case "spectrogram_live":
      return extractSpectrogramV2(t);
    case "spatial_map":
    case "propagation_frame":
      return extractSpatialCellsV2(t);
    case "propagation_movie":
      return extractSpatialFramesV2(t);
    default:
      // Unknown viewType — return the labeled tensor untouched so callers
      // can do their own decode. Keeps the worker forwards-compatible as
      // we add more v2 extractors.
      return t;
  }
}

/**
 * Buffers (data + coord typed arrays) inside `value` that should be passed
 * via the `transfer` list to keep `postMessage` zero-copy. Used by the
 * worker pool when shipping a decoded result back to the main thread.
 */
export function transferablesFor(value: ExtractedV2): Transferable[] {
  // PSDLiveDecoded bundle: the cube's typed arrays are nested under `tensor`;
  // the `average` curve is plain number[] (cheap structured-clone, no transfer).
  if ("tensor" in value && "average" in value) {
    const td = value.tensor;
    const out: Transferable[] = td.data instanceof Float32Array ? [td.data.buffer] : [];
    for (const v of Object.values(td.coords)) {
      if (v instanceof Float64Array) out.push(v.buffer);
    }
    return out;
  }
  if ("data" in value && value.data instanceof Float32Array) {
    const out: Transferable[] = [value.data.buffer];
    for (const v of Object.values(value.coords)) {
      if (v instanceof Float64Array) out.push(v.buffer);
    }
    return out;
  }
  // ColumnarTimeseries: each series owns a Float32Array values buffer. Ship
  // them in the transfer list so postMessage hands them to the main thread
  // zero-copy instead of structured-cloning every channel's samples.
  if ("series" in value && Array.isArray(value.series)) {
    const out: Transferable[] = [];
    for (const s of value.series) {
      if (s.values instanceof Float32Array) out.push(s.values.buffer);
    }
    return out;
  }
  return [];
}
