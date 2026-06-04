/**
 * Pure event-filtering logic (event-filtering-plan.md E1) — the single
 * predicate between the event-window query and its consumers (timeseries
 * overlay, EventTable, coincidence, counts). Kept dependency-free and
 * jsdom-independent so it carries real unit coverage.
 *
 * The decisive constraint is **property heterogeneity**: event properties are
 * detector-defined and inconsistent. The same physical quantity surfaces under
 * different column names (cogpy interval detectors call the z-scored peak
 * `value`; the NWB manifest calls it `peak_z`; frequency is `frequency` /
 * `freq` / `freq_peak`). So filters key off a *canonical* property name and we
 * resolve it against each record's actual columns via alias normalization.
 */
import type { EventRecordDTO } from "../../api/types";
import type { EventFilters } from "../../store/eventFilterStore";

/**
 * Canonical filterable property → fallback column names (tried after the
 * direct key). `duration` is handled specially (see {@link resolveEventSpan}).
 */
export const PROPERTY_ALIASES: Record<string, string[]> = {
  // z-scored peak amplitude — cogpy interval detectors emit it as `value`.
  peak_z: ["value"],
  // per-event peak frequency — NWB manifest uses `freq_peak`; some streams `freq`.
  frequency: ["freq", "freq_peak"],
};

/** Coerce an unknown record field to a finite number, or undefined. */
export function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Resolve an event's [t0, t1] span (+ duration) from a record, normalizing the
 * alias columns interval detectors use (`t0/t1` vs `event_start/event_end`),
 * falling back to a `duration` column centred on `t`. Returns undefined when no
 * usable span is present (a point event). Shared with the timeseries span
 * shading (E3).
 */
export function resolveEventSpan(
  record: Record<string, unknown>,
): { t0: number; t1: number; duration: number } | undefined {
  const t0 =
    toFiniteNumber(record.t0) ??
    toFiniteNumber(record.event_start) ??
    toFiniteNumber(record.t_start) ??
    toFiniteNumber(record.start_time) ??
    toFiniteNumber(record.onset);
  const t1 =
    toFiniteNumber(record.t1) ??
    toFiniteNumber(record.event_end) ??
    toFiniteNumber(record.t_end) ??
    toFiniteNumber(record.end_time) ??
    toFiniteNumber(record.offset);
  if (t0 !== undefined && t1 !== undefined && t1 >= t0) {
    return { t0, t1, duration: t1 - t0 };
  }
  const dur = toFiniteNumber(record.duration);
  const t = toFiniteNumber(record.t);
  if (dur !== undefined && dur > 0 && t !== undefined) {
    return { t0: t - dur / 2, t1: t + dur / 2, duration: dur };
  }
  return undefined;
}

/**
 * Resolve a canonical property to a finite number for one record, applying
 * alias normalization. `duration` additionally falls back to the computed span
 * (`t1 − t0`). Returns undefined when the property is absent / non-numeric.
 */
export function resolveEventProperty(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const direct = toFiniteNumber(record[key]);
  if (direct !== undefined) return direct;

  const aliases = PROPERTY_ALIASES[key];
  if (aliases) {
    for (const a of aliases) {
      const v = toFiniteNumber(record[a]);
      if (v !== undefined) return v;
    }
  }

  if (key === "duration") {
    return resolveEventSpan(record)?.duration;
  }
  return undefined;
}

// ── Property enumeration + histogram (E2: data-driven filter UI) ───────────

/** A numeric property the user can threshold, with its loaded-data range. */
export type FilterableProperty = { key: string; label: string; min: number; max: number };

/**
 * Structural / coordinate / categorical columns that are never thresholdable
 * properties (identity, the time stamp + interval bounds, spatial coords, and
 * the categorical labels). Compared case-insensitively.
 */
const BLOCKED_COLUMNS = new Set<string>([
  "event_id", "id", "name", "label", "state", "brainstate", "motor_state",
  // The time stamp + every interval-bound alias (these are the span, not a
  // thresholdable property — `duration` is offered instead, derived from them).
  "t", "t0", "t1", "event_start", "event_end", "t_start", "t_end",
  "start_time", "end_time", "onset", "offset",
  "peak_time", "trough_time", "midcrossing_time",
  "ap", "ml", "channel", "x", "y", "z",
  // String/identity columns common in NWB-manifest event tables.
  "subject", "session", "detection_name", "channel_label", "region", "device",
]);

/** Raw column name → canonical property key (collapses detector aliases). */
const COLUMN_TO_CANONICAL: Record<string, string> = {
  value: "peak_z",
  peak_z: "peak_z",
  freq: "frequency",
  freq_peak: "frequency",
  frequency: "frequency",
};

/** Human labels for the canonical keys; falls back to the key itself. */
export const PROPERTY_LABELS: Record<string, string> = {
  peak_z: "peak z-score",
  frequency: "frequency (Hz)",
  duration: "duration (s)",
  duration_neg: "neg. duration (s)",
  amplitude: "amplitude",
  rel_power: "rel. power",
  symmetry: "symmetry",
};

/** Map a raw column to its canonical filter key. */
export function canonicalProperty(column: string): string {
  return COLUMN_TO_CANONICAL[column.toLowerCase()] ?? column;
}

/**
 * Enumerate the numeric, thresholdable properties present in a stream's loaded
 * records — the data-driven basis for the filter UI (event-filtering-plan.md
 * E2). Columns are canonicalized (aliases collapsed) and screened against a
 * blocklist of structural/coordinate/categorical columns plus the caller's
 * `exclude` (typically the stream's time_col + id_col). `duration` is offered
 * whenever a span is resolvable even without an explicit column. Only
 * properties with an actual range (min < max over the loaded events) are
 * returned — a zero-width slider has nothing to threshold.
 */
export function enumerateFilterableProperties(
  records: EventRecordDTO[],
  columns: string[],
  exclude: string[] = [],
): FilterableProperty[] {
  const excludeSet = new Set(exclude.map((c) => c.toLowerCase()));
  const candidates = new Set<string>();
  for (const col of columns) {
    const lc = col.toLowerCase();
    if (BLOCKED_COLUMNS.has(lc) || excludeSet.has(lc)) continue;
    candidates.add(canonicalProperty(col));
  }
  // Duration is synthetic — resolvable from t0/t1 even when no column exists.
  candidates.add("duration");

  const out: FilterableProperty[] = [];
  for (const key of candidates) {
    let min = Infinity;
    let max = -Infinity;
    let n = 0;
    for (const rec of records) {
      const v = resolveEventProperty(rec.record, key);
      if (v === undefined) continue;
      n += 1;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (n === 0 || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) continue;
    out.push({ key, label: PROPERTY_LABELS[key] ?? key, min, max });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Histogram bin counts over [min,max] of the finite values. */
export type Histogram = { counts: number[]; min: number; max: number; binWidth: number };

/**
 * Bin finite values into `nBins` equal-width buckets over their [min,max].
 * The maximum value falls in the last bin (right-inclusive top edge). Returns
 * a single full bin when all values are equal. Pure; golden-tested.
 */
export function computeHistogram(values: number[], nBins: number): Histogram {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0 || nBins < 1) return { counts: [], min: 0, max: 0, binWidth: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return { counts: [finite.length], min, max, binWidth: 0 };
  const binWidth = (max - min) / nBins;
  const counts = new Array<number>(nBins).fill(0);
  for (const v of finite) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= nBins) idx = nBins - 1;
    if (idx < 0) idx = 0;
    counts[idx] += 1;
  }
  return { counts, min, max, binWidth };
}

/** Resolve every finite value of a canonical property across records (for the histogram). */
export function propertyValues(records: EventRecordDTO[], key: string): number[] {
  const out: number[] = [];
  for (const rec of records) {
    const v = resolveEventProperty(rec.record, key);
    if (v !== undefined) out.push(v);
  }
  return out;
}

/** True when at least one stream carries an active property filter. */
function hasAnyFilter(filters: EventFilters): boolean {
  for (const stream in filters) {
    if (Object.keys(filters[stream]).length > 0) return true;
  }
  return false;
}

/**
 * Apply per-stream numeric property filters to the loaded event records.
 *
 * A record survives iff, for EVERY active [min,max] on its stream, the record's
 * resolved value for that property is finite and within the inclusive range.
 * Records missing a filtered property are excluded — you cannot confirm an
 * event belongs to a thresholded population without the measurement.
 *
 * Returns the SAME map reference when no filters are active (referential
 * identity → no downstream re-render churn); streams with no filter of their
 * own pass through by reference too. Filter once here so overlay, table,
 * coincidence, and counts stay consistent. See event-filtering-plan.md E1.
 */
export function applyEventFilters(
  eventsByStream: Map<string, EventRecordDTO[]>,
  filters: EventFilters,
): Map<string, EventRecordDTO[]> {
  if (!hasAnyFilter(filters)) return eventsByStream;

  const out = new Map<string, EventRecordDTO[]>();
  for (const [stream, records] of eventsByStream) {
    const streamFilters = filters[stream];
    const entries = streamFilters ? Object.entries(streamFilters) : [];
    if (entries.length === 0) {
      out.set(stream, records);
      continue;
    }
    out.set(
      stream,
      records.filter((rec) => {
        const r = rec.record;
        for (const [key, range] of entries) {
          const v = resolveEventProperty(r, key);
          if (v === undefined || v < range[0] || v > range[1]) return false;
        }
        return true;
      }),
    );
  }
  return out;
}
