/**
 * EventAverageView — event-locked summary trace (G4).
 *
 * Stacks `(n_events, ..., lag)` epochs from the server's event_average view
 * and renders the chosen aggregator across the event axis. When the user
 * picks `mean`, a parallel `std` fetch fills in the ±1σ band around the
 * mean trace — the "is this average actually a spindle?" sanity check that
 * the spindle-review critique called out.
 *
 * The view owns its controls (event stream, lag window, aggregator,
 * pool-channels) and fires its own queries against `useSliceQuery`. It
 * registers as `event_average` in the slot layout and is rendered directly
 * from WorkspaceMain (the registry entry is a placeholder).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  decodeArrowSlice,
  extractEventAverage,
  type EventAverageData,
} from "../../api/arrow";
import { makeEventAverageRequest, useSliceQuery } from "../../api/queries";
import type { EventAverageAggregate, EventStreamMetaDTO } from "../../api/types";

type EventAverageViewProps = {
  tensorName: string | null;
  /** Streams already known to the session (StateDTO.events). */
  eventStreams: EventStreamMetaDTO[];
};

const AGGREGATES: EventAverageAggregate[] = ["mean", "median", "snr", "std"];

const N_VISIBLE = 32;

/** Max channels we draw without pooling — guards against 256-channel grids. */
function selectVisibleSeries<T>(series: T[]): T[] {
  if (series.length <= N_VISIBLE) return series;
  const step = series.length / N_VISIBLE;
  return Array.from({ length: N_VISIBLE }, (_, i) => series[Math.floor(i * step)]);
}

export function EventAverageView({ tensorName, eventStreams }: EventAverageViewProps) {
  const defaultStream = eventStreams[0]?.name ?? null;
  const [streamName, setStreamName] = useState<string | null>(defaultStream);
  const [pre, setPre] = useState(1.0);
  const [post, setPost] = useState(1.0);
  const [aggregate, setAggregate] = useState<EventAverageAggregate>("mean");
  const [poolChannels, setPoolChannels] = useState(false);
  const [maxEvents, setMaxEvents] = useState(200);

  // Auto-pick the first stream once it shows up
  useEffect(() => {
    if (!streamName && defaultStream) setStreamName(defaultStream);
  }, [streamName, defaultStream]);

  const validLag = pre > 0 && post > 0;
  const ready = tensorName && streamName && validLag;

  const traceRequest = useMemo(
    () =>
      ready
        ? makeEventAverageRequest({
            event_stream_name: streamName!,
            lag_window: [-pre, post],
            max_events: maxEvents,
            aggregate,
            pool_channels: poolChannels,
          })
        : null,
    [ready, streamName, pre, post, aggregate, poolChannels, maxEvents],
  );
  const bandRequest = useMemo(
    () =>
      ready && aggregate === "mean"
        ? makeEventAverageRequest({
            event_stream_name: streamName!,
            lag_window: [-pre, post],
            max_events: maxEvents,
            aggregate: "std",
            pool_channels: poolChannels,
          })
        : null,
    [ready, streamName, pre, post, aggregate, poolChannels, maxEvents],
  );

  const traceQuery = useSliceQuery(tensorName, traceRequest);
  const bandQuery = useSliceQuery(tensorName, bandRequest);

  const traceData: EventAverageData | null = useMemo(() => {
    if (!traceQuery.data) return null;
    return extractEventAverage(decodeArrowSlice(traceQuery.data));
  }, [traceQuery.data]);
  const bandData: EventAverageData | null = useMemo(() => {
    if (!bandQuery.data) return null;
    return extractEventAverage(decodeArrowSlice(bandQuery.data));
  }, [bandQuery.data]);

  // Extra fields surfaced by the event_average view (server/state.py:tensor_slice).
  // The base `meta` type doesn't list them — read via a defensive unknown cast.
  const eventMeta = (traceQuery.data?.meta as unknown as
    { event_average?: { n_events_used?: number; n_events_total?: number; capped?: boolean } }
    | undefined
  )?.event_average;
  const nEventsUsed = eventMeta?.n_events_used ?? null;
  const nEventsTotal = eventMeta?.n_events_total ?? null;
  const capped = eventMeta?.capped ?? false;

  // ── Canvas plot ────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef(traceData);
  traceRef.current = traceData;
  const bandRef = useRef(bandData);
  bandRef.current = bandData;

  const MARGIN = { top: 14, right: 14, bottom: 28, left: 60 };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const trace = traceRef.current;
    if (!trace || trace.lags.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const plotW = w - MARGIN.left - MARGIN.right;
    const plotH = h - MARGIN.top - MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const lags = trace.lags;
    const lagLo = lags[0];
    const lagHi = lags[lags.length - 1];
    const lagRange = lagHi - lagLo || 1;
    const visible = selectVisibleSeries(trace.series);

    // y range across all visible series (and band if present)
    let yMin = Infinity;
    let yMax = -Infinity;
    const visibleKeys = new Set(visible.map((s) => s.key));
    const bandByKey = new Map(
      (bandRef.current?.series ?? []).map((s) => [s.key, s.values] as const),
    );

    for (const s of visible) {
      for (let i = 0; i < s.values.length; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) continue;
        const std = bandByKey.get(s.key)?.[i];
        const lo = Number.isFinite(std) ? v - (std as number) : v;
        const hi = Number.isFinite(std) ? v + (std as number) : v;
        if (lo < yMin) yMin = lo;
        if (hi > yMax) yMax = hi;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = -1;
      yMax = 1;
    }
    const yPad = (yMax - yMin) * 0.05 || 0.05;
    yMin -= yPad;
    yMax += yPad;
    const yRange = yMax - yMin || 1;

    const lagToX = (l: number) =>
      MARGIN.left + ((l - lagLo) / lagRange) * plotW;
    const valToY = (v: number) =>
      MARGIN.top + ((yMax - v) / yRange) * plotH;

    // Axes
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + plotH);
    ctx.lineTo(MARGIN.left + plotW, MARGIN.top + plotH);
    ctx.stroke();

    // Lag=0 marker
    if (lagLo <= 0 && lagHi >= 0) {
      const x0 = lagToX(0);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x0, MARGIN.top);
      ctx.lineTo(x0, MARGIN.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // y=0 marker
    if (yMin <= 0 && yMax >= 0) {
      const y0 = valToY(0);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y0);
      ctx.lineTo(MARGIN.left + plotW, y0);
      ctx.stroke();
    }

    // x-axis ticks: 5 across the lag range
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i < 5; i++) {
      const frac = i / 4;
      const lag = lagLo + frac * lagRange;
      const x = lagToX(lag);
      ctx.fillText(lag.toFixed(2), x, MARGIN.top + plotH + 14);
    }
    ctx.textAlign = "right";
    for (let i = 0; i < 3; i++) {
      const frac = i / 2;
      const v = yMax - frac * yRange;
      const y = valToY(v);
      ctx.fillText(v.toExponential(1), MARGIN.left - 4, y + 3);
    }
    ctx.textAlign = "center";
    ctx.fillText("lag (s)", MARGIN.left + plotW / 2, h - 4);

    // Std band (only when bandData present and matches per-series key).
    if (bandByKey.size > 0) {
      ctx.fillStyle = "rgba(115, 210, 222, 0.18)";
      for (const s of visible) {
        const stds = bandByKey.get(s.key);
        if (!stds) continue;
        ctx.beginPath();
        for (let i = 0; i < lags.length; i++) {
          const v = s.values[i];
          const sd = stds[i];
          if (!Number.isFinite(v) || !Number.isFinite(sd)) continue;
          const x = lagToX(lags[i]);
          const y = valToY(v + (sd as number));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = lags.length - 1; i >= 0; i--) {
          const v = s.values[i];
          const sd = stds[i];
          if (!Number.isFinite(v) || !Number.isFinite(sd)) continue;
          const x = lagToX(lags[i]);
          const y = valToY(v - (sd as number));
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    // Mean / aggregate lines
    const palette = [
      "#73d2de",
      "#ffd166",
      "#ef476f",
      "#06d6a0",
      "#c77dff",
      "#f8961e",
    ];
    ctx.lineWidth = visibleKeys.size === 1 ? 2 : 1.2;
    visible.forEach((s, idx) => {
      ctx.strokeStyle = palette[idx % palette.length];
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < lags.length; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) {
          started = false;
          continue;
        }
        const x = lagToX(lags[i]);
        const y = valToY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const sync = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width));
      canvas.height = Math.max(1, Math.floor(height));
      draw();
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceData, bandData]);

  if (eventStreams.length === 0) {
    return (
      <div className="placeholder">
        No event streams in this session — run a detector first.
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="ts-toolbar" style={{ flexWrap: "wrap" }}>
        <label className="ts-tool" style={{ padding: "2px 6px" }}>
          stream
          <select
            value={streamName ?? ""}
            onChange={(e) => setStreamName(e.target.value)}
            style={{ marginLeft: 4 }}
          >
            {eventStreams.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.n_events})
              </option>
            ))}
          </select>
        </label>
        <label className="ts-tool" style={{ padding: "2px 6px" }}>
          pre (s)
          <input
            type="number"
            min={0.01}
            step={0.1}
            value={pre}
            onChange={(e) => setPre(Math.max(0.01, parseFloat(e.target.value) || 0))}
            style={{ width: 56, marginLeft: 4 }}
          />
        </label>
        <label className="ts-tool" style={{ padding: "2px 6px" }}>
          post (s)
          <input
            type="number"
            min={0.01}
            step={0.1}
            value={post}
            onChange={(e) => setPost(Math.max(0.01, parseFloat(e.target.value) || 0))}
            style={{ width: 56, marginLeft: 4 }}
          />
        </label>
        <label className="ts-tool" style={{ padding: "2px 6px" }}>
          agg
          <select
            value={aggregate}
            onChange={(e) => setAggregate(e.target.value as EventAverageAggregate)}
            style={{ marginLeft: 4 }}
          >
            {AGGREGATES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="ts-tool" style={{ padding: "2px 6px" }}>
          max ev
          <input
            type="number"
            min={1}
            step={50}
            value={maxEvents}
            onChange={(e) => setMaxEvents(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ width: 64, marginLeft: 4 }}
          />
        </label>
        <button
          type="button"
          className={`ts-tool${poolChannels ? " active" : ""}`}
          onClick={() => setPoolChannels((v) => !v)}
          title="Average across channels for a single pooled trace"
        >
          pool
        </button>
        {traceQuery.isFetching && <span style={{ opacity: 0.6, marginLeft: 6 }}>computing…</span>}
        {traceQuery.isError && (
          <span style={{ color: "#ef476f", marginLeft: 6 }}>
            {String((traceQuery.error as Error)?.message ?? "error")}
          </span>
        )}
        {nEventsUsed != null && (
          <span style={{ opacity: 0.7, marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>
            n = {nEventsUsed}{capped ? ` / ${nEventsTotal} (capped)` : ""}
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
        />
        {!traceData && (
          <div
            className="placeholder placeholder--computing"
            style={{ position: "absolute", inset: 0 }}
          >
            <span className="spinner" aria-hidden="true" /> Computing event average…
          </div>
        )}
      </div>
    </div>
  );
}
