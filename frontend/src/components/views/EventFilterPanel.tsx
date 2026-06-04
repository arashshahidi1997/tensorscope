/**
 * EventFilterPanel — data-driven per-stream property filtering (E2).
 *
 * For the active stream, renders one histogram-backed range control per numeric
 * property that actually exists in the loaded records (enumerated +
 * canonicalized by `eventFilterLogic`). The histogram shows the population so
 * the reviewer can see where to threshold; the min/max sliders write
 * `eventFilterStore`, and the predicate (`applyEventFilters`) hides
 * non-matching events everywhere at once. Reads the RAW (unfiltered) records so
 * the distribution doesn't collapse as filters tighten. See
 * event-filtering-plan.md E2.
 */
import { useMemo } from "react";
import type { EventRecordDTO } from "../../api/types";
import { useEventFilterStore } from "../../store/eventFilterStore";
import {
  computeHistogram,
  enumerateFilterableProperties,
  propertyValues,
  type FilterableProperty,
} from "./eventFilterLogic";

const HISTO_BINS = 20;

type Props = {
  streamName: string;
  /** Unfiltered active-stream records (the distribution to threshold against). */
  records: EventRecordDTO[];
  /** Count after filters (N of M shown). */
  filteredCount: number;
  /** The stream's advertised columns (from EventStreamMetaDTO). */
  columns: string[];
  /** Columns to exclude from filtering (typically time_col + id_col). */
  excludeColumns?: string[];
};

export function EventFilterPanel({
  streamName,
  records,
  filteredCount,
  columns,
  excludeColumns,
}: Props) {
  const streamFilters = useEventFilterStore((s) => s.filters[streamName]);
  const setFilter = useEventFilterStore((s) => s.setFilter);
  const clearFilter = useEventFilterStore((s) => s.clearFilter);
  const clearStreamFilters = useEventFilterStore((s) => s.clearStreamFilters);

  const props = useMemo(
    () => enumerateFilterableProperties(records, columns, excludeColumns ?? []),
    [records, columns, excludeColumns],
  );

  const activeCount = streamFilters ? Object.keys(streamFilters).length : 0;

  if (props.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
        No numeric properties to filter on this stream.
      </p>
    );
  }

  return (
    <div className="event-filter-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
        <span className="muted" data-testid="event-filter-count">
          {filteredCount} of {records.length} shown
        </span>
        {activeCount > 0 && (
          <button
            type="button"
            className="nav-btn"
            style={{ fontSize: 11, padding: "1px 6px" }}
            onClick={() => clearStreamFilters(streamName)}
          >
            Clear filters
          </button>
        )}
      </div>
      {props.map((p) => (
        <PropertyFilterRow
          key={p.key}
          prop={p}
          values={propertyValues(records, p.key)}
          range={streamFilters?.[p.key] ?? null}
          onChange={(lo, hi) => setFilter(streamName, p.key, [lo, hi])}
          onClear={() => clearFilter(streamName, p.key)}
        />
      ))}
    </div>
  );
}

function PropertyFilterRow({
  prop,
  values,
  range,
  onChange,
  onClear,
}: {
  prop: FilterableProperty;
  values: number[];
  range: [number, number] | null;
  onChange: (lo: number, hi: number) => void;
  onClear: () => void;
}) {
  const lo = range ? range[0] : prop.min;
  const hi = range ? range[1] : prop.max;
  const step = (prop.max - prop.min) / 100 || 0.001;
  const histo = useMemo(() => computeHistogram(values, HISTO_BINS), [values]);
  const maxCount = Math.max(1, ...histo.counts);

  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

  return (
    <div className="event-filter-prop" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
        <span>{prop.label}</span>
        <span className="muted" style={{ fontSize: 11 }}>
          [{fmt(lo)}, {fmt(hi)}]
          {range && (
            <button
              type="button"
              title="Clear this property's filter"
              onClick={onClear}
              style={{ marginLeft: 6, cursor: "pointer", background: "none", border: "none", color: "#8b949e" }}
            >
              ×
            </button>
          )}
        </span>
      </div>
      {/* Distribution histogram — bins within [lo,hi] are highlighted. */}
      <svg
        viewBox={`0 0 ${HISTO_BINS} 100`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 28, display: "block" }}
        aria-hidden="true"
      >
        {histo.counts.map((c, i) => {
          const binLo = histo.min + i * histo.binWidth;
          const binHi = binLo + histo.binWidth;
          const inRange = binHi >= lo && binLo <= hi;
          const h = (c / maxCount) * 100;
          return (
            <rect
              key={i}
              x={i}
              y={100 - h}
              width={0.92}
              height={h}
              fill={inRange ? "#58a6ff" : "#30363d"}
            />
          );
        })}
      </svg>
      <input
        type="range"
        aria-label={`${prop.label} minimum`}
        min={prop.min}
        max={prop.max}
        step={step}
        value={lo}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(v, hi), hi);
        }}
        style={{ width: "100%" }}
      />
      <input
        type="range"
        aria-label={`${prop.label} maximum`}
        min={prop.min}
        max={prop.max}
        step={step}
        value={hi}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(lo, Math.max(v, lo));
        }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
