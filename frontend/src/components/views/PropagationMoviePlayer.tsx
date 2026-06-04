/**
 * PropagationMoviePlayer — preloads N (AP × ML) frames over a time window via
 * the `propagation_movie` view, then plays them back smoothly via RAF.  Avoids
 * the per-frame round-trip stutter that the player-mode pattern hits when the
 * server response time + decode + React commit pipeline can't keep up at
 * playback rates.
 *
 * Render path uses ChannelGridRenderer directly (not PropagationView) so we
 * don't re-decode on every frame advance.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SpatialMovie } from "../../api/arrow";
import { api } from "../../api/client";
import { makePropagationMovieRequest } from "../../api/queries";
import type { SelectionDTO } from "../../api/types";
import { decodeLabeledTensor, extractSpatialFramesV2 } from "../../api/v2-arrow";
import { useMaskStore } from "../../store/maskStore";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import { ColorBar } from "./ColorBar";
import type { ColormapName } from "./colormaps";
import type { SpatialCellWithId } from "./SpatialRenderer";

/**
 * Max rate at which playback drives the global cursor (Hz). Decoupled from the
 * playback fps so a high-fps movie doesn't refetch cursor-windowed views
 * (spatial_map, …) every frame. Window-bound views (timeseries/spectrogram) are
 * key-decoupled from the cursor entirely — see ADR-0008 §5.
 */
const CURSOR_SYNC_HZ = 15;

type PropagationMoviePlayerProps = {
  tensorName: string;
  timeWindow: [number, number];
  selection: SelectionDTO;
  /** Optional override for n_frames; defaults to server-side window_s × 30. */
  nFrames?: number;
  /** Colormap for the value tiles + ColorBar. Defaults to viridis (ADR-0008). */
  colormap?: ColormapName;
  onSelectCell?: (ap: number, ml: number) => void;
  onHoverElectrode?: (id: number | null) => void;
  /**
   * Commit the frame's timestamp to the global cursor. Called on scrub release
   * and, when cursor-sync is on, on every played frame (throttled) so the
   * timeseries/spectrogram playheads glide along with playback.
   */
  onCommitTime?: (time: number) => void;
};

export function PropagationMoviePlayer({
  tensorName,
  timeWindow,
  selection,
  nFrames,
  colormap = "viridis",
  onSelectCell,
  onHoverElectrode,
  onCommitTime,
}: PropagationMoviePlayerProps) {
  const [movie, setMovie] = useState<SpatialMovie | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(24);
  // Drive the global cursor during playback so all views' playheads follow.
  const [syncCursor, setSyncCursor] = useState(true);

  // Refs so the frame-render effect can commit the cursor without listing the
  // (often freshly-allocated) onCommitTime callback in its deps.
  const onCommitTimeRef = useRef(onCommitTime);
  onCommitTimeRef.current = onCommitTime;
  const syncCursorRef = useRef(syncCursor);
  syncCursorRef.current = syncCursor;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const lastCursorCommitRef = useRef(0);

  // Latest selection captured in a ref so the fetch effect doesn't re-run
  // when only the cursor moves — the movie window is bound to (tensor,
  // timeWindow, nFrames), not selection.time.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());
  const cellsCache = useRef<SpatialCellWithId[][]>([]);

  // Channel mask for this tensor — masked cells get the hatch overlay so
  // the movie matches the static spatial views.
  const maskedArray = useMaskStore((s) => (tensorName ? s.masks[tensorName] : undefined));
  const maskedSet = useMemo(
    () => (maskedArray ? new Set(maskedArray) : undefined),
    [maskedArray],
  );

  // Single fetch on (tensor, timeWindow, nFrames) change.
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
        const m = extractSpatialFramesV2(decodeLabeledTensor(buf));
        // Pre-build the (id, apIdx, mlIdx, value) cell arrays once so the
        // RAF loop only does an O(n_cells) draw per tick — no decode.
        cellsCache.current = m.frames.map((frame) =>
          frame.cells.map((c) => ({
            id: c.ap * m.nML + c.ml,
            apIdx: c.ap,
            mlIdx: c.ml,
            value: c.value,
          })),
        );
        setMovie(m);
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

  // Bumped on every canvas resize so the frame-render effect repaints the
  // CURRENT frame at the new size. Without this, the first frame (idx 0, the
  // paused default after preload) stays blank when the panel gets its real
  // size *after* frame 0 was first drawn at the initial tiny size — the canvas
  // is re-init'd here but nothing repaints until frameIdx changes (i.e. only on
  // play). Mirrors PropagationView's ResizeObserver, which re-renders on resize.
  const [sizeTick, setSizeTick] = useState(0);

  // Init canvas + ResizeObserver.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const renderer = rendererRef.current;
    function syncSize() {
      if (!canvas || !container) return;
      const { width, height } = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      canvas.width = w;
      canvas.height = h;
      renderer.init(canvas, w, h);
      setSizeTick((t) => t + 1);
    }
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(container);
    return () => {
      ro.disconnect();
      renderer.dispose();
    };
  }, []);

  // Render the current frame whenever frameIdx changes.
  useEffect(() => {
    const m = movie;
    const cellsArr = cellsCache.current;
    if (!m || cellsArr.length === 0) return;
    const idx = Math.max(0, Math.min(frameIdx, cellsArr.length - 1));
    const cells = cellsArr[idx];
    rendererRef.current.render(cells, {
      nAP: m.nAP,
      nML: m.nML,
      colorScale: "sequential",
      hoveredId: null,
      selectedIds: [],
      minValue: m.min,
      maxValue: m.max,
      colormap,
      smoothing: false,
      maskedIds: maskedSet,
    });
    const t = m.frames[idx]?.time;
    // Time overlay so the user can read the frame's timestamp during playback.
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (typeof t === "number" && Number.isFinite(t)) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(4, 4, 96, 20);
          ctx.fillStyle = "#eee";
          ctx.font = "11px monospace";
          ctx.fillText(`t = ${t.toFixed(3)}s`, 8, 18);
        }
      }
    }
    // Cursor-sync: glide the global cursor with playback so the timeseries /
    // spectrogram playheads follow. Throttled to CURSOR_SYNC_HZ so the
    // cursor-windowed spatial views don't refetch every frame (ADR-0008 §2).
    if (isPlayingRef.current && syncCursorRef.current && typeof t === "number" && Number.isFinite(t)) {
      const now = performance.now();
      if (now - lastCursorCommitRef.current >= 1000 / CURSOR_SYNC_HZ) {
        lastCursorCommitRef.current = now;
        onCommitTimeRef.current?.(t);
      }
    }
  }, [movie, frameIdx, maskedSet, colormap, sizeTick]);

  // RAF playback loop. fps determines the per-frame target dt; we advance
  // when wall-clock time has crossed that threshold so playback stays
  // smooth even if the browser drops frames.
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

  const handleClickCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !movie) return;
    const rect = canvas.getBoundingClientRect();
    const id = rendererRef.current.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (id === null) return;
    const apIdx = Math.floor(id / movie.nML);
    const mlIdx = id % movie.nML;
    onSelectCell?.(apIdx, mlIdx);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const id = rendererRef.current.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    onHoverElectrode?.(id);
  };

  const handleMouseLeave = () => onHoverElectrode?.(null);

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v)) setFrameIdx(v);
  };

  const handleScrubCommit = () => {
    const t = movie?.frames[frameIdx]?.time;
    if (typeof t === "number" && Number.isFinite(t)) onCommitTime?.(t);
  };

  const frameCount = movie?.frames.length ?? 0;
  const currentTime = movie?.frames[frameIdx]?.time;
  // Mirror SpatialMapSliceView's aspect-preserving box so the player widget
  // doesn't squash the canvas in Y.
  const nAP = movie?.nAP ?? 0;
  const nML = movie?.nML ?? 0;
  const aspectRatio = nAP > 0 && nML > 0 ? nML / nAP : 1;

  return (
    <div
      className="propagation-movie"
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
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
            type="number"
            value={fps}
            min={1}
            max={60}
            step={1}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v > 0) setFps(v);
            }}
          />
        </label>
        <label
          className="propagation-setting"
          title="Glide the global cursor (timeseries / spectrogram playheads) with playback"
        >
          <input
            type="checkbox"
            checked={syncCursor}
            onChange={(e) => setSyncCursor(e.target.checked)}
          />
          <span>⌖ sync</span>
        </label>
        <input
          type="range"
          className="propagation-movie-scrubber"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={frameIdx}
          onChange={handleScrub}
          onMouseUp={handleScrubCommit}
          onTouchEnd={handleScrubCommit}
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
      <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }}>
        <div className="axis-y-label">AP</div>
        <div className="axis-y-ticks" />
        <div
          className="axis-canvas-area"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            ref={containerRef}
            style={{
              position: "relative",
              aspectRatio: `${aspectRatio}`,
              maxWidth: "100%",
              maxHeight: "100%",
              width: aspectRatio >= 1 ? "100%" : "auto",
              height: aspectRatio < 1 ? "100%" : "auto",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{ display: "block", width: "100%", height: "100%" }}
              onClick={handleClickCanvas}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />
          </div>
        </div>
        <div className="axis-x-ticks" />
        <div className="axis-x-label">ML</div>
      </div>
        {movie && (
          <ColorBar colormap={colormap} min={movie.min} max={movie.max} label="value" />
        )}
      </div>
    </div>
  );
}
