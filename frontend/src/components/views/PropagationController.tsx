/**
 * PropagationController — wraps a spatial view with player/strip/tiled playback modes.
 *
 * - player: sequential fetch queue (same pattern as WorkspaceMain animation), drives timeCursor
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
import { decodeArrowSlice, extractSpatialCells } from "../../api/arrow";
import type { CoordSummary, SelectionDTO, TensorSliceDTO } from "../../api/types";

type PropagationMode = "player" | "strip" | "tiled";

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
  const [mode, setMode] = useState<PropagationMode>("player");

  const tMin = typeof timeCoord?.min === "number" ? timeCoord.min : parseFloat(String(timeCoord?.min ?? "0"));
  const tMax = typeof timeCoord?.max === "number" ? timeCoord.max : parseFloat(String(timeCoord?.max ?? "10"));
  const safeMin = Number.isFinite(tMin) ? tMin : 0;
  const safeMax = Number.isFinite(tMax) ? tMax : 10;

  const [t0, setT0] = useState(safeMin);
  const [t1, setT1] = useState(safeMax);
  const [frameCount, setFrameCount] = useState(8);
  const [gridCols, setGridCols] = useState(4);
  const [colorScaleLock, setColorScaleLock] = useState(true);

  // Sync t0/t1 when timeCoord changes (on first tensor load)
  const prevMinRef = useRef<number | null>(null);
  if (prevMinRef.current !== safeMin) {
    prevMinRef.current = safeMin;
    // Only update if they're still at the default (first load)
  }
  useEffect(() => {
    setT0(safeMin);
    setT1(safeMax);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeMin, safeMax]);

  // ── Player mode: sequential fetch queue ──────────────────────────────────
  // Same pattern as the original WorkspaceMain propagation logic.
  const timeCursor = useSelectionStore((s) => s.timeCursor);
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

  // ── Strip/Tiled mode: parallel batch fetches ──────────────────────────────
  const [multiFrames, setMultiFrames] = useState<(TensorSliceDTO | null)[]>([]);
  const [globalMinMax, setGlobalMinMax] = useState<[number, number] | null>(null);
  const [multiLoading, setMultiLoading] = useState(false);

  useEffect(() => {
    if (mode === "player" || !tensorName) {
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
          {(["player", "strip", "tiled"] as PropagationMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`ts-tool${mode === m ? " active" : ""}`}
              title={m === "player" ? "Player" : m === "strip" ? "Strip" : "Tiled"}
              onClick={() => setMode(m)}
            >
              {m === "player" ? "▶" : m === "strip" ? "⊟" : "⊞"}
            </button>
          ))}
        </div>

        {mode !== "player" && (
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
            <label className="propagation-setting propagation-lock">
              <input
                type="checkbox"
                checked={colorScaleLock}
                onChange={(e) => setColorScaleLock(e.target.checked)}
              />
              <span>lock scale</span>
            </label>
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
              onSelectCell={onSelectCell}
              onHoverElectrode={onHoverElectrode}
            />
          ) : (
            <div className="placeholder">Loading…</div>
          )}
        </div>
      )}

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
                  onSelectCell={onSelectCell}
                  globalMin={colorScaleLock ? (globalMinMax?.[0] ?? undefined) : undefined}
                  globalMax={colorScaleLock ? (globalMinMax?.[1] ?? undefined) : undefined}
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
                  onSelectCell={onSelectCell}
                  globalMin={colorScaleLock ? (globalMinMax?.[0] ?? undefined) : undefined}
                  globalMax={colorScaleLock ? (globalMinMax?.[1] ?? undefined) : undefined}
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
