/**
 * PropagationController — wraps a spatial view with player/movie/event/strip/tiled playback modes.
 *
 * - player: sequential fetch queue (same pattern as WorkspaceMain animation), drives timeCursor
 * - movie:  one-shot fetch of N preloaded frames + smooth RAF playback over the visible window
 * - event:  same RAF playback, but window is centered on the current cursor (which jumps to
 *           event times when the user picks events) with a user-configurable ±Δ half-window
 * - strip:  N evenly-spaced frames as a horizontal thumbnail row
 * - tiled:  NxM grid of frames
 *
 * Color scale lock: in strip/tiled modes, all frames share a single min/max computed
 * over all frames so spatial patterns are comparable across time points.
 */
import { useEffect, useRef, useState } from "react";
import { useSelectionStore } from "../../store/selectionStore";
import { AnimationController } from "../controls/AnimationController";
import { PropagationView } from "./PropagationView";
import { PropagationMoviePlayer } from "./PropagationMoviePlayer";
import { decodeArrowSlice, extractSpatialCells } from "../../api/arrow";
import type { ColormapName } from "./colormaps";
import type { CoordSummary, SelectionDTO, TensorSliceDTO } from "../../api/types";

type PropagationMode = "player" | "movie" | "event" | "strip" | "tiled";

/** Colormap choices for the panel. Default (first) is viridis — perceptually
 *  uniform, honest for reading propagation gradients (ADR-0008). jet is kept
 *  for the prior user preference but is no longer the default. */
const COLORMAP_OPTIONS: ColormapName[] = ["viridis", "inferno", "cividis", "jet"];

type PropagationControllerProps = {
  tensorName: string | null;
  timeCoord: CoordSummary | undefined;
  selectionDraft: SelectionDTO;
  onSelectCell?: (ap: number, ml: number) => void;
  onHoverElectrode?: (id: number | null) => void;
};

function linspace(start: number, end: number, n: number): number[] {
  if (n <= 1) return [start];
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => start + i * step);
}

export function PropagationController({
  tensorName,
  timeCoord,
  selectionDraft,
  onSelectCell,
  onHoverElectrode,
}: PropagationControllerProps) {
  // Movie is the default: preloaded, smooth, cursor-synced playback (ADR-0008).
  const [mode, setMode] = useState<PropagationMode>("movie");
  const [colormap, setColormap] = useState<ColormapName>("viridis");

  const tMin = typeof timeCoord?.min === "number" ? timeCoord.min : parseFloat(String(timeCoord?.min ?? "0"));
  const tMax = typeof timeCoord?.max === "number" ? timeCoord.max : parseFloat(String(timeCoord?.max ?? "10"));
  const safeMin = Number.isFinite(tMin) ? tMin : 0;
  const safeMax = Number.isFinite(tMax) ? tMax : 10;

  const [t0, setT0] = useState(safeMin);
  const [t1, setT1] = useState(safeMax);
  const [frameCount, setFrameCount] = useState(8);
  const [gridCols, setGridCols] = useState(4);
  const [colorScaleLock, setColorScaleLock] = useState(true);
  // Event mode: half-window in seconds around the current cursor.
  const [eventHalfWindowS, setEventHalfWindowS] = useState(0.5);
  const [eventFrameCount, setEventFrameCount] = useState(60);

  // ── Player mode: sequential fetch queue ──────────────────────────────────
  // Same pattern as the original WorkspaceMain propagation logic.
  const timeCursor = useSelectionStore((s) => s.timeCursor);
  // The currently-visible window — movie/event/strip/tiled seed their playback
  // window from it ("play what you're looking at"). Held in a ref so seeding on
  // tensor-change doesn't make the playback window track every live pan
  // (snapshot semantics; the "↺ win" button re-snaps on demand).
  const visibleWindow = useSelectionStore((s) => s.timeWindow);
  const visibleWindowRef = useRef(visibleWindow);
  visibleWindowRef.current = visibleWindow;

  // Seed t0/t1 from the visible window on tensor change (extent change). Falls
  // back to the full extent if the window looks unset.
  useEffect(() => {
    const [w0, w1] = visibleWindowRef.current;
    if (Number.isFinite(w0) && Number.isFinite(w1) && w1 > w0) {
      setT0(w0);
      setT1(w1);
    } else {
      setT0(safeMin);
      setT1(safeMax);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeMin, safeMax]);

  const snapToWindow = () => {
    const [w0, w1] = visibleWindowRef.current;
    if (Number.isFinite(w0) && Number.isFinite(w1) && w1 > w0) {
      setT0(w0);
      setT1(w1);
    }
  };
  const expandToFull = () => {
    setT0(safeMin);
    setT1(safeMax);
  };

  const [propagationFrame, setPropagationFrame] = useState<TensorSliceDTO | null>(null);

  const selectionRef = useRef(selectionDraft);
  selectionRef.current = selectionDraft;
  const propInFlightRef = useRef(false);
  const propPendingRef = useRef<{ tensor: string; time: number } | null>(null);

  const fetchPropFrame = useRef<(tensor: string, time: number) => void>(null!);
  fetchPropFrame.current = (tensor, time) => {
    propInFlightRef.current = true;
    fetch(`/api/v1/tensors/${tensor}/slice`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        view_type: "propagation_frame",
        selection: selectionRef.current,
        frame_time: time,
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<TensorSliceDTO>) : Promise.reject()))
      .then((data) => {
        setPropagationFrame(data);
        propInFlightRef.current = false;
        const pending = propPendingRef.current;
        if (pending) {
          propPendingRef.current = null;
          fetchPropFrame.current(pending.tensor, pending.time);
        }
      })
      .catch(() => {
        propInFlightRef.current = false;
      });
  };

  useEffect(() => {
    if (mode !== "player" || !tensorName) {
      propInFlightRef.current = false;
      propPendingRef.current = null;
      setPropagationFrame(null);
      return;
    }
    if (propInFlightRef.current) {
      propPendingRef.current = { tensor: tensorName, time: timeCursor };
    } else {
      fetchPropFrame.current(tensorName, timeCursor);
    }
  }, [mode, tensorName, timeCursor]);

  // Player color-lock: accumulate a global [min,max] over the frames played so
  // the colormap doesn't rescale per frame (which hides amplitude propagation
  // — ADR-0008 §4). Only widens; resets per (tensor, mode). The decode here is
  // a single small AP×ML frame, so it's cheap relative to the round-trip.
  const [playerRange, setPlayerRange] = useState<[number, number] | null>(null);
  useEffect(() => {
    setPlayerRange(null);
  }, [mode, tensorName]);
  useEffect(() => {
    if (mode !== "player" || !colorScaleLock || !propagationFrame) return;
    const cells = extractSpatialCells(decodeArrowSlice(propagationFrame));
    if (cells.length === 0) return;
    let min = Infinity;
    let max = -Infinity;
    for (const c of cells) {
      if (c.value < min) min = c.value;
      if (c.value > max) max = c.value;
    }
    if (!(min < max)) return;
    setPlayerRange((prev) => {
      if (!prev) return [min, max];
      const lo = Math.min(prev[0], min);
      const hi = Math.max(prev[1], max);
      return lo === prev[0] && hi === prev[1] ? prev : [lo, hi];
    });
  }, [mode, colorScaleLock, propagationFrame]);

  // ── Strip/Tiled mode: parallel batch fetches ──────────────────────────────
  const [multiFrames, setMultiFrames] = useState<(TensorSliceDTO | null)[]>([]);
  const [globalMinMax, setGlobalMinMax] = useState<[number, number] | null>(null);
  const [multiLoading, setMultiLoading] = useState(false);

  useEffect(() => {
    if (mode === "player" || mode === "movie" || mode === "event" || !tensorName) {
      setMultiFrames([]);
      setGlobalMinMax(null);
      return;
    }
    const times = linspace(t0, t1, frameCount);
    const sel = selectionRef.current;

    setMultiFrames(new Array(frameCount).fill(null));
    setGlobalMinMax(null);
    setMultiLoading(true);

    const promises = times.map((t) =>
      fetch(`/api/v1/tensors/${tensorName}/slice`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view_type: "propagation_frame",
          selection: sel,
          frame_time: t,
        }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<TensorSliceDTO>) : Promise.reject()))
        .catch(() => null as TensorSliceDTO | null),
    );

    Promise.all(promises).then((frames) => {
      setMultiFrames(frames);
      setMultiLoading(false);
      if (colorScaleLock) {
        let min = Infinity;
        let max = -Infinity;
        for (const frame of frames) {
          if (!frame) continue;
          const decoded = decodeArrowSlice(frame);
          const cells = extractSpatialCells(decoded);
          for (const c of cells) {
            if (c.value < min) min = c.value;
            if (c.value > max) max = c.value;
          }
        }
        if (min < max) setGlobalMinMax([min, max]);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tensorName, t0, t1, frameCount, colorScaleLock]);

  const frameTimes = mode !== "player" ? linspace(t0, t1, frameCount) : [];

  return (
    <div className="propagation-controller">
      {/* Toolbar */}
      <div className="propagation-toolbar">
        <div className="propagation-mode-toggle">
          {(["player", "movie", "event", "strip", "tiled"] as PropagationMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`ts-tool${mode === m ? " active" : ""}`}
              title={
                m === "player" ? "Player (cursor-driven; fetches each frame)"
                  : m === "movie" ? "Movie (preload window once + smooth playback, cursor-synced)"
                  : m === "event" ? "Event (RAF playback ±Δs around the current cursor)"
                  : m === "strip" ? "Strip"
                  : "Tiled"
              }
              onClick={() => setMode(m)}
            >
              {m === "player" ? "▶" : m === "movie" ? "🎬" : m === "event" ? "⚡" : m === "strip" ? "⊟" : "⊞"}
            </button>
          ))}
        </div>

        {/* Colormap selector — applies to every propagation surface (ADR-0008). */}
        <label className="propagation-setting" title="Colormap (viridis is perceptually uniform — honest for gradients)">
          <span>cmap</span>
          <select
            value={colormap}
            onChange={(e) => setColormap(e.target.value as ColormapName)}
          >
            {COLORMAP_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        {mode === "player" && (
          <div className="propagation-settings">
            <label className="propagation-setting propagation-lock" title="Lock the color scale across played frames so amplitude is comparable frame-to-frame">
              <input
                type="checkbox"
                checked={colorScaleLock}
                onChange={(e) => setColorScaleLock(e.target.checked)}
              />
              <span>lock scale</span>
            </label>
          </div>
        )}

        {mode === "event" && (
          <div className="propagation-settings">
            <label className="propagation-setting" title="Half-window in seconds either side of the current cursor">
              <span>±Δ s</span>
              <input
                type="number"
                value={eventHalfWindowS}
                min={0.01}
                step={0.05}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v > 0) setEventHalfWindowS(v);
                }}
              />
            </label>
            <label className="propagation-setting">
              <span>N</span>
              <input
                type="number"
                value={eventFrameCount}
                min={2}
                max={240}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v > 0) setEventFrameCount(v);
                }}
              />
            </label>
          </div>
        )}

        {mode !== "player" && mode !== "event" && (
          <div className="propagation-settings">
            <label className="propagation-setting">
              <span>t0</span>
              <input
                type="number"
                value={t0}
                step={0.1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) setT0(v);
                }}
              />
            </label>
            <label className="propagation-setting">
              <span>t1</span>
              <input
                type="number"
                value={t1}
                step={0.1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) setT1(v);
                }}
              />
            </label>
            <button
              type="button"
              className="ts-tool"
              title="Snap the playback window to the currently-visible timeseries window"
              onClick={snapToWindow}
            >
              ↺ win
            </button>
            <button
              type="button"
              className="ts-tool"
              title="Expand the playback window to the full recording"
              onClick={expandToFull}
            >
              ⤢ all
            </button>
            <label className="propagation-setting">
              <span>N</span>
              <input
                type="number"
                value={frameCount}
                min={1}
                max={64}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v > 0) setFrameCount(v);
                }}
              />
            </label>
            {mode === "tiled" && (
              <label className="propagation-setting">
                <span>cols</span>
                <input
                  type="number"
                  value={gridCols}
                  min={1}
                  max={16}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (Number.isFinite(v) && v > 0) setGridCols(v);
                  }}
                />
              </label>
            )}
            {/* Movie locks to its cube's global min/max inherently, so the
                checkbox only applies to the strip/tiled batch frames. */}
            {(mode === "strip" || mode === "tiled") && (
              <label className="propagation-setting propagation-lock">
                <input
                  type="checkbox"
                  checked={colorScaleLock}
                  onChange={(e) => setColorScaleLock(e.target.checked)}
                />
                <span>lock scale</span>
              </label>
            )}
            {multiLoading && <span className="propagation-loading">loading…</span>}
          </div>
        )}
      </div>

      {/* Player mode content */}
      {mode === "player" && (
        <div className="propagation-player">
          {timeCoord && (
            <AnimationController timeRange={[safeMin, safeMax]} fps={10} />
          )}
          {propagationFrame ? (
            <PropagationView
              slice={propagationFrame}
              selection={selectionDraft}
              colormap={colormap}
              globalMin={colorScaleLock ? playerRange?.[0] : undefined}
              globalMax={colorScaleLock ? playerRange?.[1] : undefined}
              onSelectCell={onSelectCell}
              onHoverElectrode={onHoverElectrode}
              tensorName={tensorName ?? undefined}
            />
          ) : (
            <div className="placeholder">Loading…</div>
          )}
        </div>
      )}

      {/* Movie mode: preload N frames + RAF playback */}
      {mode === "movie" && tensorName && (
        <PropagationMoviePlayer
          tensorName={tensorName}
          timeWindow={[t0, t1]}
          selection={selectionDraft}
          nFrames={frameCount}
          colormap={colormap}
          onSelectCell={onSelectCell}
          onHoverElectrode={onHoverElectrode}
          onCommitTime={(t) => useSelectionStore.getState().setTimeCursor(t)}
        />
      )}

      {/* Event mode: same RAF playback, but the window auto-centers on the
          current cursor (which jumps to event times when the user picks
          events from the events sidebar). Re-fetches whenever the cursor
          or half-window changes. */}
      {mode === "event" && tensorName && (() => {
        const tMin = Math.max(safeMin, timeCursor - eventHalfWindowS);
        const tMax = Math.min(safeMax, timeCursor + eventHalfWindowS);
        const valid = tMax > tMin;
        return valid ? (
          <PropagationMoviePlayer
            // Force a remount when the centering cursor moves so the player
            // reloads its preloaded buffer; otherwise the existing useEffect
            // dep on [t0, t1] still triggers a refetch but skipping the
            // remount means the playback state and frame index continuity
            // could drift across event hops.
            key={`event-${timeCursor.toFixed(4)}`}
            tensorName={tensorName}
            timeWindow={[tMin, tMax]}
            selection={selectionDraft}
            nFrames={eventFrameCount}
            colormap={colormap}
            onSelectCell={onSelectCell}
            onHoverElectrode={onHoverElectrode}
            onCommitTime={(t) => useSelectionStore.getState().setTimeCursor(t)}
          />
        ) : (
          <div className="placeholder">
            Cursor at {timeCursor.toFixed(2)}s is outside the data range — pick an event or move the cursor.
          </div>
        );
      })()}

      {/* Strip mode: horizontal row of thumbnails */}
      {mode === "strip" && (
        <div className="propagation-strip">
          {frameTimes.map((t, i) => (
            <div key={i} className="propagation-strip-frame">
              <span className="propagation-frame-time">{t.toFixed(2)}s</span>
              {multiFrames[i] ? (
                <PropagationView
                  slice={multiFrames[i]!}
                  selection={selectionDraft}
                  colormap={colormap}
                  onSelectCell={onSelectCell}
                  globalMin={colorScaleLock ? (globalMinMax?.[0] ?? undefined) : undefined}
                  globalMax={colorScaleLock ? (globalMinMax?.[1] ?? undefined) : undefined}
                  tensorName={tensorName ?? undefined}
                />
              ) : (
                <div className="placeholder placeholder--mini">…</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tiled mode: NxM grid of frames */}
      {mode === "tiled" && (
        <div
          className="propagation-tiled"
          style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
        >
          {frameTimes.map((t, i) => (
            <div key={i} className="propagation-tiled-frame">
              <span className="propagation-frame-time">{t.toFixed(2)}s</span>
              {multiFrames[i] ? (
                <PropagationView
                  slice={multiFrames[i]!}
                  selection={selectionDraft}
                  colormap={colormap}
                  onSelectCell={onSelectCell}
                  globalMin={colorScaleLock ? (globalMinMax?.[0] ?? undefined) : undefined}
                  globalMax={colorScaleLock ? (globalMinMax?.[1] ?? undefined) : undefined}
                  tensorName={tensorName ?? undefined}
                />
              ) : (
                <div className="placeholder placeholder--mini">…</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
