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
  const t0 = toFiniteNumber(record.t0) ?? toFiniteNumber(record.event_start);
  const t1 = toFiniteNumber(record.t1) ?? toFiniteNumber(record.event_end);
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
