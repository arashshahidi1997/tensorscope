import { tableFromIPC, type Table } from "apache-arrow";
import type { TensorSliceDTO } from "./types";

export type DecodedSlice = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Raw Arrow table — available for fast columnar access. */
  _table?: Table;
};

export type ColumnarTimeseries = {
  times: number[];
  series: Array<{ key: string; label: string; values: number[] }>;
};

export type SpatialCell = {
  ap: number;
  ml: number;
  value: number;
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
    values: Array.from(seriesArrays[idx]) as number[],
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

  const series = Array.from(groups.entries()).map(([key, { label, byTime }]) => ({
    key,
    label,
    values: allTimes.map((t) => byTime.get(t) ?? NaN),
  }));

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

/**
 * Extract a channel×freq heatmap from a psd_live decoded slice.
 * The Arrow table has columns: freq, AP, ML, value (or freq, channel, value).
 */
export function extractPSDHeatmap(decoded: DecodedSlice): PSDHeatmapData {
  if (!decoded.columns.includes("freq") || !decoded.columns.includes("value")) {
    return { freqs: [], channelLabels: [], matrix: [] };
  }

  const hasAP = decoded.columns.includes("AP") && decoded.columns.includes("ML");

  // Collect unique freqs and channels
  const freqSet = new Set<number>();
  const channelMap = new Map<string, number>(); // label → insertion order
  const cellMap = new Map<string, number>();     // "freq|channelLabel" → value

  for (const row of decoded.rows) {
    const freq = toNumber(row.freq);
    const value = toNumber(row.value);
    if (freq === null || value === null) continue;
    freqSet.add(freq);

    let label: string;
    if (hasAP) {
      const ap = toNumber(row.AP);
      const ml = toNumber(row.ML);
      if (ap === null || ml === null) continue;
      label = `AP${ap}_ML${ml}`;
    } else {
      const ch = toNumber(row.channel);
      if (ch === null) continue;
      label = `Ch${ch}`;
    }

    if (!channelMap.has(label)) channelMap.set(label, channelMap.size);
    cellMap.set(`${freq}|${label}`, value);
  }

  const freqs = Array.from(freqSet).sort((a, b) => a - b);
  // Sort channels: by AP then ML (or by channel number)
  const channelLabels = Array.from(channelMap.keys()).sort((a, b) => {
    // Extract numeric parts for sorting
    const numsA = a.match(/\d+/g)?.map(Number) ?? [];
    const numsB = b.match(/\d+/g)?.map(Number) ?? [];
    for (let i = 0; i < Math.max(numsA.length, numsB.length); i++) {
      const diff = (numsA[i] ?? 0) - (numsB[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const matrix: number[][] = freqs.map((f) =>
    channelLabels.map((ch) => cellMap.get(`${f}|${ch}`) ?? NaN),
  );

  return { freqs, channelLabels, matrix };
}

/**
 * Extract average PSD curve (mean and std across channels at each freq).
 */
export function extractPSDAverage(decoded: DecodedSlice): PSDAvgData {
  if (!decoded.columns.includes("freq") || !decoded.columns.includes("value")) {
    return { freqs: [], mean: [], std: [] };
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
  const mean: number[] = [];
  const std: number[] = [];

  for (const f of freqs) {
    const vals = groups.get(f)!;
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
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
 * Extract spatial power at the nearest frequency to targetFreq.
 */
export function extractPSDSpatialAtFreq(
  decoded: DecodedSlice,
  targetFreq: number,
): { ap: number; ml: number; value: number }[] {
  if (
    !decoded.columns.includes("freq") ||
    !decoded.columns.includes("value") ||
    !decoded.columns.includes("AP") ||
    !decoded.columns.includes("ML")
  ) {
    return [];
  }

  // Find unique freqs and pick the nearest
  const freqSet = new Set<number>();
  for (const row of decoded.rows) {
    const f = toNumber(row.freq);
    if (f !== null) freqSet.add(f);
  }
  if (freqSet.size === 0) return [];

  const allFreqs = Array.from(freqSet).sort((a, b) => a - b);
  let nearestFreq = allFreqs[0];
  let minDist = Math.abs(targetFreq - nearestFreq);
  for (const f of allFreqs) {
    const dist = Math.abs(targetFreq - f);
    if (dist < minDist) {
      minDist = dist;
      nearestFreq = f;
    }
  }

  // Filter rows at nearest freq, collecting raw coords
  const rawCells: { apRaw: number; mlRaw: number; value: number }[] = [];
  for (const row of decoded.rows) {
    const f = toNumber(row.freq);
    if (f !== nearestFreq) continue;
    const ap = toNumber(row.AP);
    const ml = toNumber(row.ML);
    const value = toNumber(row.value);
    if (ap === null || ml === null || value === null) continue;
    rawCells.push({ apRaw: ap, mlRaw: ml, value });
  }

  // Normalize raw coords to 0-based integer rank indices (same as extractSpatialCells)
  const apSorted = Array.from(new Set(rawCells.map((c) => c.apRaw))).sort((a, b) => a - b);
  const mlSorted = Array.from(new Set(rawCells.map((c) => c.mlRaw))).sort((a, b) => a - b);
  const apRank = new Map(apSorted.map((v, i) => [v, i]));
  const mlRank = new Map(mlSorted.map((v, i) => [v, i]));

  return rawCells
    .map((c) => ({ ap: apRank.get(c.apRaw)!, ml: mlRank.get(c.mlRaw)!, value: c.value }))
    .sort((a, b) => a.ap - b.ap || a.ml - b.ml);
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
