import { tableFromIPC, type Table } from "apache-arrow";
import type { TensorSliceDTO } from "./types";
import type { LabeledTensorMeta } from "./v2-arrow";

export type DecodedSlice = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Raw Arrow table — available for fast columnar access. */
  _table?: Table;
};

export type ColumnarTimeseries = {
  times: number[];
  // Float32Array (not number[]) so the worker can transfer each series'
  // buffer zero-copy to the main thread, and so the timeseries view can hold
  // the decoded values directly instead of re-copying into a typed array.
  series: Array<{ key: string; label: string; values: Float32Array }>;
  // v2-native: carries the slice's display_transforms/processing so the
  // timeseries view can render fidelity badges without a v1 `slice.meta`.
  // Absent on v1-decoded timeseries (`extractTimeseriesColumnar*`).
  meta?: LabeledTensorMeta;
};

export type SpatialCell = {
  ap: number;
  ml: number;
  value: number;
};

export type SpatialMovieFrame = {
  /** Frame timestamp in seconds (from the source time coord). */
  time: number;
  /** Cells for this frame, sorted by (ap, ml) — same convention as extractSpatialCells. */
  cells: SpatialCell[];
};

export type SpatialMovie = {
  frames: SpatialMovieFrame[];
  nAP: number;
  nML: number;
  /** Global min/max across all frames — used for color-locked playback. */
  min: number;
  max: number;
};

export type FreqCurve = {
  freqs: number[];
  values: number[];
};

export type Spectrogram = {
  times: number[];
  freqs: number[];
  /** Row-major: values[timeIndex][freqIndex] */
  values: number[][];
  /**
   * Effective spectral params surfaced from the server (spectrogram_live only).
   * `overlapPctEffective` may be below `overlapPctRequested` when the
   * `max_time_segments` cap widens the hop (`capActive`). Undefined for the
   * v1 precomputed `spectrogram` path. See spectral-window decoupling.
   */
  specMeta?: {
    npersegS?: number;
    overlapPctEffective?: number;
    overlapPctRequested?: number;
    capActive?: boolean;
  };
};

export type Raster = {
  /** Channel ids (rows), sorted by depth when a depth coord is present. */
  channels: number[];
  times: number[];
  /** Per-channel depth (µm) aligned to `channels`, or null if absent. */
  depths: number[] | null;
  /** Flat row-major [channelRow * nTime + timeCol] amplitude. */
  values: Float64Array;
  nChannels: number;
  nTime: number;
};

function base64ToUint8Array(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function decodeArrowSlice(slice: TensorSliceDTO): DecodedSlice {
  const table = tableFromIPC(base64ToUint8Array(slice.payload));
  const columns = table.schema.fields.map((field) => field.name);
  // Lazy row access — only materialized when .rows is accessed by legacy extractors.
  // Fast-path extractors use _table directly for columnar access.
  const rows = Array.from(table).map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of columns) {
      record[column] = row[column as keyof typeof row];
    }
    return record;
  });
  return { columns, rows, _table: table };
}

/**
 * Fast columnar extraction for timeseries — reads typed arrays directly from
 * Arrow columns, avoiding per-row object allocation.
 *
 * Falls back to the legacy row-based path if the table structure is unexpected.
 */
export function extractTimeseriesColumnarFast(slice: TensorSliceDTO): ColumnarTimeseries {
  const table = tableFromIPC(base64ToUint8Array(slice.payload));
  const colNames = table.schema.fields.map((f) => f.name);

  if (!colNames.includes("time") || !colNames.includes("value")) {
    return { times: [], series: [] };
  }

  const numRows = table.numRows;
  if (numRows === 0) return { times: [], series: [] };

  // Read flat typed arrays from Arrow columns
  const timeCol = table.getChild("time")!;
  const valueCol = table.getChild("value")!;
  const hasChannel = colNames.includes("channel");
  const hasAP = colNames.includes("AP") && colNames.includes("ML");
  const channelCol = hasChannel ? table.getChild("channel") : null;
  const apCol = hasAP ? table.getChild("AP") : null;
  const mlCol = hasAP ? table.getChild("ML") : null;

  // Build a series-key for each row and collect unique keys
  // For the common case of (time, channel, value) or (time, AP, ML, value)
  const keyMap = new Map<string, number>(); // key → series index
  const keyLabels: string[] = [];
  const rowKeys = new Int32Array(numRows); // series index per row

  for (let i = 0; i < numRows; i++) {
    let key: string;
    let label: string;
    if (channelCol) {
      const ch = Number(channelCol.get(i));
      key = `ch-${ch}`;
      label = `Ch ${ch}`;
    } else if (apCol && mlCol) {
      const ap = Number(apCol.get(i));
      const ml = Number(mlCol.get(i));
      key = `ap-${ap}-ml-${ml}`;
      label = `(${ap},${ml})`;
    } else {
      key = "signal";
      label = "Signal";
    }

    let idx = keyMap.get(key);
    if (idx === undefined) {
      idx = keyMap.size;
      keyMap.set(key, idx);
      keyLabels.push(label);
    }
    rowKeys[i] = idx;
  }

  const nSeries = keyMap.size;

  // Collect unique times
  const timeSet = new Set<number>();
  for (let i = 0; i < numRows; i++) {
    const t = Number(timeCol.get(i));
    if (Number.isFinite(t)) timeSet.add(t);
  }
  const allTimes = Array.from(timeSet).sort((a, b) => a - b);
  const nTimes = allTimes.length;
  if (nTimes === 0) return { times: [], series: [] };

  // Build time → index lookup
  const timeIndex = new Map<number, number>();
  for (let i = 0; i < nTimes; i++) timeIndex.set(allTimes[i], i);

  // Allocate series arrays and fill
  const seriesArrays: Float32Array[] = [];
  for (let s = 0; s < nSeries; s++) {
    seriesArrays.push(new Float32Array(nTimes).fill(NaN));
  }

  for (let i = 0; i < numRows; i++) {
    const t = Number(timeCol.get(i));
    const ti = timeIndex.get(t);
    if (ti === undefined) continue;
    const v = Number(valueCol.get(i));
    seriesArrays[rowKeys[i]][ti] = v;
  }

  const keys = Array.from(keyMap.keys());
  const series = keys.map((key, idx) => ({
    key,
    label: keyLabels[idx],
    values: seriesArrays[idx],
  }));

  return { times: allTimes, series };
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function seriesKey(row: Record<string, unknown>): { key: string; label: string } {
  const channel = toNumber(row.channel);
  if (channel !== null) return { key: `ch-${channel}`, label: `Ch ${channel}` };
  const ap = toNumber(row.AP);
  const ml = toNumber(row.ML);
  if (ap !== null && ml !== null) return { key: `ap-${ap}-ml-${ml}`, label: `(${ap},${ml})` };
  return { key: "signal", label: "Signal" };
}

/** Columnar format for uPlot: all series share the same time axis. */
export function extractTimeseriesColumnar(decoded: DecodedSlice): ColumnarTimeseries {
  if (!decoded.columns.includes("time") || !decoded.columns.includes("value")) {
    return { times: [], series: [] };
  }

  const groups = new Map<string, { label: string; byTime: Map<number, number> }>();
  for (const row of decoded.rows) {
    const time = toNumber(row.time);
    const value = toNumber(row.value);
    if (time === null || value === null) continue;
    const { key, label } = seriesKey(row);
    if (!groups.has(key)) groups.set(key, { label, byTime: new Map() });
    groups.get(key)!.byTime.set(time, value);
  }

  if (groups.size === 0) return { times: [], series: [] };

  const allTimes = Array.from(
    new Set(Array.from(groups.values()).flatMap((g) => Array.from(g.byTime.keys()))),
  ).sort((a, b) => a - b);

  const series = Array.from(groups.entries()).map(([key, { label, byTime }]) => {
    const values = new Float32Array(allTimes.length);
    for (let i = 0; i < allTimes.length; i++) values[i] = byTime.get(allTimes[i]) ?? NaN;
    return { key, label, values };
  });

  return { times: allTimes, series };
}

export function extractSpatialCells(decoded: DecodedSlice): SpatialCell[] {
  if (
    !decoded.columns.includes("value") ||
    !decoded.columns.includes("AP") ||
    !decoded.columns.includes("ML")
  ) {
    return [];
  }

  const grouped = new Map<string, { apRaw: number; mlRaw: number; values: number[] }>();
  for (const row of decoded.rows) {
    const ap = toNumber(row.AP);
    const ml = toNumber(row.ML);
    const value = toNumber(row.value);
    if (ap === null || ml === null || value === null) continue;
    const key = `${ap}|${ml}`;
    if (!grouped.has(key)) grouped.set(key, { apRaw: ap, mlRaw: ml, values: [] });
    grouped.get(key)!.values.push(value);
  }

  // Normalize raw coords (which may be floats) to 0-based integer rank indices.
  const apSorted = Array.from(new Set(Array.from(grouped.values()).map((c) => c.apRaw))).sort(
    (a, b) => a - b,
  );
  const mlSorted = Array.from(new Set(Array.from(grouped.values()).map((c) => c.mlRaw))).sort(
    (a, b) => a - b,
  );
  const apRank = new Map(apSorted.map((v, i) => [v, i]));
  const mlRank = new Map(mlSorted.map((v, i) => [v, i]));

  return Array.from(grouped.values())
    .map((cell) => ({
      ap: apRank.get(cell.apRaw)!,
      ml: mlRank.get(cell.mlRaw)!,
      value: cell.values.reduce((sum, v) => sum + v, 0) / cell.values.length,
    }))
    .sort((a, b) => a.ap - b.ap || a.ml - b.ml);
}

/**
 * Decodes a `(time, AP, ML)` propagation_movie payload into per-frame
 * SpatialCell arrays + global min/max for color-locked playback.
 *
 * The Arrow table has columns: time, AP, ML, value.  Cells are grouped by
 * unique time, then within each frame normalized to 0-based AP/ML rank
 * indices (consistent with extractSpatialCells).
 */
/**
 * Depth profile for a linear probe (e.g. Neuropixels DV approximation).
 *
 * The `depth_map` slice is a `(channel,)` frame carrying a per-channel `depth`
 * coord (see docs/design/neuropixels-multiprobe.md). We lay it out as a
 * single-column grid (`ml = 0`) ordered dorsal→ventral by `depth`, reusing the
 * spatial `SpatialCell` shape so the existing `ChannelGridRenderer` can paint
 * it as an N×1 strip. Falls back to channel order when no `depth` column is
 * present. `ap` is the 0-based depth rank.
 */
export function extractDepthProfile(decoded: DecodedSlice): SpatialCell[] {
  if (!decoded.columns.includes("value") || !decoded.columns.includes("channel")) {
    return [];
  }
  const hasDepth = decoded.columns.includes("depth");
  const grouped = new Map<number, { sort: number; values: number[] }>();
  for (const row of decoded.rows) {
    const channel = toNumber(row.channel);
    const value = toNumber(row.value);
    if (channel === null || value === null) continue;
    const sortKey = hasDepth ? toNumber(row.depth) ?? channel : channel;
    if (!grouped.has(channel)) grouped.set(channel, { sort: sortKey, values: [] });
    grouped.get(channel)!.values.push(value);
  }
  return Array.from(grouped.values())
    .sort((a, b) => a.sort - b.sort)
    .map((cell, i) => ({
      ap: i,
      ml: 0,
      value: cell.values.reduce((sum, v) => sum + v, 0) / cell.values.length,
    }));
}

/**
 * Average PSD curve: groups by freq, averages value over all spatial dims.
 * Input: (freq, AP, ML) or (freq, channel) — no time dim after psd_average collapse.
 */
export function extractFreqCurve(decoded: DecodedSlice): FreqCurve {
  if (!decoded.columns.includes("freq") || !decoded.columns.includes("value")) {
    return { freqs: [], values: [] };
  }

  const groups = new Map<number, number[]>();
  for (const row of decoded.rows) {
    const freq = toNumber(row.freq);
    const value = toNumber(row.value);
    if (freq === null || value === null) continue;
    if (!groups.has(freq)) groups.set(freq, []);
    groups.get(freq)!.push(value);
  }

  const freqs = Array.from(groups.keys()).sort((a, b) => a - b);
  const values = freqs.map((f) => {
    const vals = groups.get(f)!;
    return vals.reduce((sum, v) => sum + v, 0) / vals.length;
  });

  return { freqs, values };
}

// ── PSD Live extraction types and functions ─────────────────────────────

export type PSDHeatmapData = {
  freqs: number[];           // unique sorted freq values (Y axis)
  channelLabels: string[];   // "AP0_ML0", "AP0_ML1", ... (X axis)
  matrix: number[][];        // matrix[freqIdx][channelIdx] = power
};

export type PSDAvgData = {
  freqs: number[];      // shared Y axis
  mean: number[];       // mean power at each freq
  std: number[];        // std at each freq
};

export type EventAverageSeries = {
  key: string;
  label: string;
  values: number[];
};

export type EventAverageData = {
  /** Lag values in seconds (sorted). */
  lags: number[];
  /** One entry per channel (or one pooled entry). Length == lags.length. */
  series: EventAverageSeries[];
};

/**
 * Extract a (lag, [channel|AP×ML]) event-average payload.
 *
 * Mirrors `extractTimeseriesColumnar` but on a lag axis. Long-format Arrow
 * with columns `(lag, value)`, optionally plus `channel` or `(AP, ML)` —
 * matches the server's v1 `encode_arrow_payload` envelope (server/state.py).
 */
export function extractEventAverage(decoded: DecodedSlice): EventAverageData {
  if (!decoded.columns.includes("lag") || !decoded.columns.includes("value")) {
    return { lags: [], series: [] };
  }

  const groups = new Map<string, { label: string; byLag: Map<number, number> }>();
  for (const row of decoded.rows) {
    const lag = toNumber(row.lag);
    const value = toNumber(row.value);
    if (lag === null || value === null) continue;
    const { key, label } = seriesKey(row);
    if (!groups.has(key)) groups.set(key, { label, byLag: new Map() });
    groups.get(key)!.byLag.set(lag, value);
  }

  if (groups.size === 0) return { lags: [], series: [] };

  const lags = Array.from(
    new Set(Array.from(groups.values()).flatMap((g) => Array.from(g.byLag.keys()))),
  ).sort((a, b) => a - b);

  const series = Array.from(groups.entries()).map(([key, { label, byLag }]) => ({
    key,
    label,
    values: lags.map((l) => byLag.get(l) ?? NaN),
  }));

  return { lags, series };
}

/**
 * 2-D spectrogram: groups by (time, freq), averages over any spatial dims.
 * Input: (time, freq) or (time, freq, AP, ML) or (time, freq, channel).
 */
export function extractSpectrogram(decoded: DecodedSlice): Spectrogram {
  if (
    !decoded.columns.includes("time") ||
    !decoded.columns.includes("freq") ||
    !decoded.columns.includes("value")
  ) {
    return { times: [], freqs: [], values: [] };
  }

  // Fast columnar path — reads Arrow typed-array columns directly,
  // avoiding the per-row object materialisation in `decoded.rows` which
  // allocates ~1.4M objects on a 4-D spectrogram_live payload (10 s
  // window) and froze the tab for ~10 s before rendering. This path
  // collapses the same workload to ~100 ms and aggregates in a single
  // pass.
  const table = decoded._table;
  if (table) {
    const timeCol = table.getChild("time");
    const freqCol = table.getChild("freq");
    const valCol = table.getChild("value");
    if (timeCol && freqCol && valCol) {
      const numRows = table.numRows;

      const timeIdxMap = new Map<number, number>();
      const freqIdxMap = new Map<number, number>();
      const rowTimeIdx = new Int32Array(numRows);
      const rowFreqIdx = new Int32Array(numRows);

      // Pass 1: assign per-row time/freq indices, collecting uniques.
      for (let i = 0; i < numRows; i++) {
        const t = Number(timeCol.get(i));
        const f = Number(freqCol.get(i));
        let ti = timeIdxMap.get(t);
        if (ti === undefined) { ti = timeIdxMap.size; timeIdxMap.set(t, ti); }
        let fi = freqIdxMap.get(f);
        if (fi === undefined) { fi = freqIdxMap.size; freqIdxMap.set(f, fi); }
        rowTimeIdx[i] = ti;
        rowFreqIdx[i] = fi;
      }

      // Sort uniques for canonical axis order, build a remap so cell
      // access lands at sorted positions.
      const timesUnsorted = Array.from(timeIdxMap.keys());
      const freqsUnsorted = Array.from(freqIdxMap.keys());
      const times = [...timesUnsorted].sort((a, b) => a - b);
      const freqs = [...freqsUnsorted].sort((a, b) => a - b);
      const timeRemap = new Int32Array(times.length);
      const freqRemap = new Int32Array(freqs.length);
      for (let i = 0; i < timesUnsorted.length; i++) {
        timeRemap[timeIdxMap.get(timesUnsorted[i])!] = times.indexOf(timesUnsorted[i]);
      }
      for (let i = 0; i < freqsUnsorted.length; i++) {
        freqRemap[freqIdxMap.get(freqsUnsorted[i])!] = freqs.indexOf(freqsUnsorted[i]);
      }

      const nT = times.length;
      const nF = freqs.length;
      const sums = new Float64Array(nT * nF);
      const counts = new Int32Array(nT * nF);

      // Pass 2: aggregate sum + count per (t, f) cell.
      for (let i = 0; i < numRows; i++) {
        const v = Number(valCol.get(i));
        if (!Number.isFinite(v)) continue;
        const cell = timeRemap[rowTimeIdx[i]] * nF + freqRemap[rowFreqIdx[i]];
        sums[cell] += v;
        counts[cell] += 1;
      }

      const values: number[][] = new Array(nT);
      for (let t = 0; t < nT; t++) {
        const row = new Array(nF);
        for (let f = 0; f < nF; f++) {
          const c = counts[t * nF + f];
          row[f] = c > 0 ? sums[t * nF + f] / c : NaN;
        }
        values[t] = row;
      }
      return { times, freqs, values };
    }
  }

  // Legacy fallback — row-based, kept for non-canonical payloads where
  // the columnar typed-array access isn't available.
  const cells = new Map<string, { t: number; f: number; vals: number[] }>();
  for (const row of decoded.rows) {
    const t = toNumber(row.time);
    const f = toNumber(row.freq);
    const v = toNumber(row.value);
    if (t === null || f === null || v === null) continue;
    const key = `${t}|${f}`;
    if (!cells.has(key)) cells.set(key, { t, f, vals: [] });
    cells.get(key)!.vals.push(v);
  }

  const timeSet = new Set<number>();
  const freqSet = new Set<number>();
  for (const { t, f } of cells.values()) {
    timeSet.add(t);
    freqSet.add(f);
  }

  const times = Array.from(timeSet).sort((a, b) => a - b);
  const freqs = Array.from(freqSet).sort((a, b) => a - b);
  const tIndex = new Map(times.map((t, i) => [t, i]));
  const fIndex = new Map(freqs.map((f, i) => [f, i]));

  const values: number[][] = Array.from({ length: times.length }, () =>
    new Array(freqs.length).fill(NaN),
  );

  for (const { t, f, vals } of cells.values()) {
    values[tIndex.get(t)!][fIndex.get(f)!] =
      vals.reduce((sum, v) => sum + v, 0) / vals.length;
  }

  return { times, freqs, values };
}

/**
 * Decode a `raster` payload — channel × time amplitude (long-format columns
 * `channel`, `time`, `value`, optional per-channel `depth`). Returns a flat
 * row-major Float64Array [channelRow * nTime + timeCol]. Rows are ordered by
 * `depth` when present (dorsal→ventral), else by channel id. See
 * docs/design/neuropixels-multiprobe.md.
 */
export function extractRaster(decoded: DecodedSlice): Raster {
  const empty: Raster = {
    channels: [], times: [], depths: null, values: new Float64Array(0), nChannels: 0, nTime: 0,
  };
  if (
    !decoded.columns.includes("channel") ||
    !decoded.columns.includes("time") ||
    !decoded.columns.includes("value")
  ) {
    return empty;
  }
  const hasDepth = decoded.columns.includes("depth");

  // Collect unique channels (with depth) and times.
  const depthByChannel = new Map<number, number>();
  const timeSet = new Set<number>();
  for (const row of decoded.rows) {
    const ch = toNumber(row.channel);
    const t = toNumber(row.time);
    if (ch === null || t === null) continue;
    timeSet.add(t);
    if (!depthByChannel.has(ch)) {
      depthByChannel.set(ch, hasDepth ? toNumber(row.depth) ?? ch : ch);
    }
  }
  if (depthByChannel.size === 0 || timeSet.size === 0) return empty;

  // Channel rows ordered by depth (then id); time columns ascending.
  const channels = Array.from(depthByChannel.keys()).sort(
    (a, b) => depthByChannel.get(a)! - depthByChannel.get(b)! || a - b,
  );
  const times = Array.from(timeSet).sort((a, b) => a - b);
  const chRow = new Map(channels.map((c, i) => [c, i]));
  const tCol = new Map(times.map((t, i) => [t, i]));

  const nChannels = channels.length;
  const nTime = times.length;
  const values = new Float64Array(nChannels * nTime).fill(NaN);
  for (const row of decoded.rows) {
    const ch = toNumber(row.channel);
    const t = toNumber(row.time);
    const v = toNumber(row.value);
    if (ch === null || t === null || v === null) continue;
    const r = chRow.get(ch);
    const c = tCol.get(t);
    if (r === undefined || c === undefined) continue;
    values[r * nTime + c] = v;
  }

  const depths = hasDepth ? channels.map((c) => depthByChannel.get(c)!) : null;
  return { channels, times, depths, values, nChannels, nTime };
}

export type Trajectory = {
  /** Time samples, ascending. */
  times: number[];
  /** Per-axis value arrays aligned to `times` (keys are axis labels: x, y, z). */
  byAxis: Record<string, number[]>;
  /** Axis labels present, in first-seen order. */
  axes: string[];
};

/**
 * Pivot a long-format (time, axis) position slice into per-axis arrays. The
 * server emits one row per (time, axis) cell with an `axis` string column
 * (x/y/z) and a numeric `value`; the trajectory view plots any two axes.
 */
export function extractTrajectory(decoded: DecodedSlice): Trajectory {
  const empty: Trajectory = { times: [], byAxis: {}, axes: [] };
  if (
    !decoded.columns.includes("time") ||
    !decoded.columns.includes("axis") ||
    !decoded.columns.includes("value")
  ) {
    return empty;
  }

  const axes: string[] = [];
  const byTime = new Map<number, Record<string, number>>();
  for (const row of decoded.rows) {
    const t = toNumber(row.time);
    const axis = row.axis == null ? null : String(row.axis);
    const v = toNumber(row.value);
    if (t === null || axis === null || v === null) continue;
    if (!axes.includes(axis)) axes.push(axis);
    let rec = byTime.get(t);
    if (!rec) {
      rec = {};
      byTime.set(t, rec);
    }
    rec[axis] = v;
  }

  const times = Array.from(byTime.keys()).sort((a, b) => a - b);
  const byAxis: Record<string, number[]> = {};
  for (const axis of axes) byAxis[axis] = times.map((t) => byTime.get(t)![axis] ?? NaN);
  return { times, byAxis, axes };
}
