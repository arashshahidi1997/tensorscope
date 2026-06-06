/**
 * ScatterMoviePlayer — the planar (non-grid) analogue of PropagationMoviePlayer
 * (ADR-0010 Phase 3). Preloads N `(time, channel)` frames over a window via the
 * `propagation_movie` view, then RAF-plays them as a position scatter (one dot
 * per channel at its true (x, y), coloured by value). Drives the global cursor
 * during playback so the timeseries/spectrogram playheads glide along, exactly
 * like the grid movie player. Positions come from the electrodes endpoint.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { makePropagationMovieRequest, useElectrodesQuery } from "../../api/queries";
import type { SelectionDTO } from "../../api/types";
import { type ChannelMovie, decodeLabeledTensor, extractChannelFramesV2 } from "../../api/v2-arrow";
import { useMaskStore } from "../../store/maskStore";
import { ColorBar } from "./ColorBar";
import { getColormapLUT, type ColormapName } from "./colormaps";
import { computeNearestMap, computeScatterLayout, paintScatter, type ScatterLayout } from "./scatterPaint";

const CURSOR_SYNC_HZ = 15;

type Props = {
  tensorName: string;
  timeWindow: [number, number];
  selection: SelectionDTO;
  nFrames?: number;
  colormap?: ColormapName;
  onCommitTime?: (time: number) => void;
};

export function ScatterMoviePlayer({
  tensorName,
  timeWindow,
  selection,
  nFrames,
  colormap = "viridis",
  onCommitTime,
}: Props) {
  const [movie, setMovie] = useState<ChannelMovie | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(24);
  const [syncCursor, setSyncCursor] = useState(true);
  const [sizeTick, setSizeTick] = useState(0);
  const [hover, setHover] = useState<{ ch: number; sx: number; sy: number } | null>(null);

  const onCommitTimeRef = useRef(onCommitTime);
  onCommitTimeRef.current = onCommitTime;
  const syncCursorRef = useRef(syncCursor);
  syncCursorRef.current = syncCursor;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const lastCursorCommitRef = useRef(0);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const [fill, setFill] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const geomRef = useRef<ScatterLayout>({ cx: [], cy: [], r: 4 });
  const nearestCacheRef = useRef<{ key: string; map: Int32Array } | null>(null);

  const electrodes = useElectrodesQuery(tensorName);
  const positions = useMemo(() => {
    const e = electrodes.data;
    return e?.x_coords && e?.y_coords ? { x: e.x_coords, y: e.y_coords } : null;
  }, [electrodes.data]);

  const maskedArray = useMaskStore((s) => (tensorName ? s.masks[tensorName] : undefined));
  const maskedSet = useMemo(() => (maskedArray ? new Set(maskedArray) : undefined), [maskedArray]);
  const lut = useMemo(() => getColormapLUT(colormap), [colormap]);

  // Single fetch on (tensor, window, nFrames).
  useEffect(() => {
    if (!tensorName) return;
    const [t0, t1] = timeWindow;
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return;
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request = makePropagationMovieRequest(selectionRef.current, [t0, t1], nFrames);
    api
      .getTensorSliceV2(tensorName, request, controller.signal)
      .then((buf) => {
        if (cancelled) return;
        setMovie(extractChannelFramesV2(decodeLabeledTensor(buf)));
        setFrameIdx(0);
      })
      .catch((e) => {
        if (!cancelled && e?.name !== "AbortError") setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tensorName, timeWindow[0], timeWindow[1], nFrames]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size canvas to its wrap; repaint current frame on resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setSizeTick((t) => t + 1));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Paint the current frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !movie || !positions || movie.frames.length === 0) return;
    const W = Math.max(1, Math.round(wrap.clientWidth));
    const H = Math.max(1, Math.round(wrap.clientHeight));
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const idx = Math.max(0, Math.min(frameIdx, movie.frames.length - 1));
    const frame = movie.frames[idx];
    let nearestMap: Int32Array | null = null;
    if (fill) {
      // Precompute the Voronoi assignment once per (size, probe); recolour
      // per frame is then O(W·H), keeping playback smooth.
      const np = positions.x.length;
      const key = `${W}x${H}:${np}`;
      if (nearestCacheRef.current?.key !== key) {
        nearestCacheRef.current = { key, map: computeNearestMap(computeScatterLayout(positions, W, H), W, H) };
      }
      nearestMap = nearestCacheRef.current.map;
    }
    geomRef.current = paintScatter(ctx, W, H, positions, frame.values, {
      lut, lo: movie.min, hi: movie.max, maskedSet, nearestMap,
    });

    // Time overlay.
    const t = frame.time;
    if (typeof t === "number" && Number.isFinite(t)) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(4, 4, 96, 20);
      ctx.fillStyle = "#eee";
      ctx.font = "11px monospace";
      ctx.fillText(`t = ${t.toFixed(3)}s`, 8, 18);
      // Cursor-sync (throttled), parity with the grid movie player.
      if (isPlayingRef.current && syncCursorRef.current) {
        const now = performance.now();
        if (now - lastCursorCommitRef.current >= 1000 / CURSOR_SYNC_HZ) {
          lastCursorCommitRef.current = now;
          onCommitTimeRef.current?.(t);
        }
      }
    }
  }, [movie, frameIdx, positions, lut, maskedSet, sizeTick, fill]);

  // RAF playback.
  useEffect(() => {
    if (!isPlaying || !movie || movie.frames.length <= 1) return;
    const targetDt = 1000 / Math.max(1, fps);
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (now - last >= targetDt) {
        last = now;
        setFrameIdx((i) => (i + 1) % movie.frames.length);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, fps, movie]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const { cx, cy, r } = geomRef.current;
    let best = -1;
    let bestD = (r * 1.6) ** 2;
    for (let i = 0; i < cx.length; i++) {
      const d = (cx[i] - mx) ** 2 + (cy[i] - my) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best >= 0 ? { ch: best, sx: e.clientX - rect.left, sy: e.clientY - rect.top } : null);
  };
  const onLeave = () => setHover(null);

  const frameCount = movie?.frames.length ?? 0;
  const currentTime = movie?.frames[frameIdx]?.time;
  const hoverVal = hover && movie ? movie.frames[Math.min(frameIdx, frameCount - 1)]?.values[hover.ch] : undefined;

  return (
    <div className="propagation-movie" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="propagation-movie-controls" style={{ flexShrink: 0 }}>
        <button
          type="button"
          className={`ts-tool${isPlaying ? " active" : ""}`}
          onClick={() => setIsPlaying((p) => !p)}
          disabled={!movie || frameCount <= 1}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <label className="propagation-setting">
          <span>fps</span>
          <input
            type="number" value={fps} min={1} max={60} step={1}
            onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v) && v > 0) setFps(v); }}
          />
        </label>
        <label className="propagation-setting" title="Glide the global cursor with playback">
          <input type="checkbox" checked={syncCursor} onChange={(e) => setSyncCursor(e.target.checked)} />
          <span>⌖ sync</span>
        </label>
        <button
          type="button"
          className={`ts-tool${fill ? " active" : ""}`}
          title={fill ? "Interpolated surface — click for dots" : "Dots — click for an interpolated surface"}
          onClick={() => setFill((f) => !f)}
          style={{ fontSize: 11 }}
        >
          {fill ? "▦" : "•"}
        </button>
        <input
          type="range"
          className="propagation-movie-scrubber"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={frameIdx}
          onChange={(e) => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) setFrameIdx(v); }}
          onMouseUp={() => { const t = movie?.frames[frameIdx]?.time; if (typeof t === "number") onCommitTime?.(t); }}
          disabled={!movie || frameCount <= 1}
        />
        <span className="propagation-movie-time">
          {currentTime !== undefined ? `${currentTime.toFixed(3)}s` : "—"}
          {frameCount > 0 && ` (${frameIdx + 1}/${frameCount})`}
        </span>
        {loading && <span className="propagation-loading">loading…</span>}
        {error && <span className="propagation-error">{error}</span>}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 4 }}>
        <div ref={wrapRef} style={{ position: "relative", flex: 1, minHeight: 0 }} data-testid="scatter-movie">
          <canvas
            ref={canvasRef}
            style={{ display: "block", width: "100%", height: "100%" }}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          />
          {hover && Number.isFinite(hoverVal) && (
            <div
              style={{
                position: "absolute",
                left: Math.min(hover.sx + 10, (wrapRef.current?.clientWidth ?? 9999) - 90),
                top: Math.max(0, hover.sy - 28),
                pointerEvents: "none",
                background: "rgba(13,17,23,0.92)",
                border: "1px solid #30363d",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 11,
                color: "#e6edf3",
                whiteSpace: "nowrap",
              }}
            >
              ch {hover.ch} · {(hoverVal as number).toPrecision(3)}
            </div>
          )}
        </div>
        {movie && <ColorBar colormap={colormap} min={movie.min} max={movie.max} label="value" />}
      </div>
    </div>
  );
}
