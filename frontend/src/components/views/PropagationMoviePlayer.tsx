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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  decodeArrowSlice,
  extractSpatialFrames,
  type SpatialMovie,
} from "../../api/arrow";
import type { SelectionDTO, TensorSliceDTO } from "../../api/types";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import { ColorBar } from "./ColorBar";
import type { SpatialCellWithId } from "./SpatialRenderer";

type PropagationMoviePlayerProps = {
  tensorName: string;
  timeWindow: [number, number];
  selection: SelectionDTO;
  /** Optional override for n_frames; defaults to server-side window_s × 30. */
  nFrames?: number;
  onSelectCell?: (ap: number, ml: number) => void;
  onHoverElectrode?: (id: number | null) => void;
  /** Optional commit callback when scrubbing — pins the global cursor to the frame's timestamp. */
  onCommitTime?: (time: number) => void;
};

export function PropagationMoviePlayer({
  tensorName,
  timeWindow,
  selection,
  nFrames,
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

  // Latest selection captured in a ref so the fetch effect doesn't re-run
  // when only the cursor moves — the movie window is bound to (tensor,
  // timeWindow, nFrames), not selection.time.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());
  const cellsCache = useRef<SpatialCellWithId[][]>([]);

  // Single fetch on (tensor, timeWindow, nFrames) change.
  useEffect(() => {
    if (!tensorName) return;
    const [t0, t1] = timeWindow;
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/v1/tensors/${tensorName}/slice`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view_type: "propagation_movie",
        selection: selectionRef.current,
        time_range: [t0, t1],
        n_frames: nFrames,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TensorSliceDTO>;
      })
      .then((slice) => {
        if (cancelled) return;
        const decoded = decodeArrowSlice(slice);
        const m = extractSpatialFrames(decoded);
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
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tensorName, timeWindow[0], timeWindow[1], nFrames]); // eslint-disable-line react-hooks/exhaustive-deps

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
      colormap: "jet",
      smoothing: false,
    });
    // Time overlay so the user can read the frame's timestamp during playback.
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const t = m.frames[idx]?.time;
        if (typeof t === "number" && Number.isFinite(t)) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(4, 4, 96, 20);
          ctx.fillStyle = "#eee";
          ctx.font = "11px monospace";
          ctx.fillText(`t = ${t.toFixed(3)}s`, 8, 18);
        }
      }
    }
  }, [movie, frameIdx]);

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
          <ColorBar colormap="jet" min={movie.min} max={movie.max} label="value" />
        )}
      </div>
    </div>
  );
}
