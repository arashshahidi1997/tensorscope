import { useEffect, useMemo, useRef } from "react";
import { decodeArrowSlice, extractSpectrogram } from "../../api/arrow";
import { useHeatmapGestures } from "../../hooks/useHeatmapGestures";
import type { SliceViewProps } from "./viewTypes";
import { XTicks, YTicks } from "./AxisTicks";
import { TimeScaleBar } from "./ChartToolbar";

// ── Colormap ──────────────────────────────────────────────────────────────────

function valueToColor(v: number, min: number, max: number): [number, number, number] {
  if (!Number.isFinite(v)) return [20, 20, 20];
  const t = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  const r = Math.round(255 * Math.min(1, t * 2));
  const g = Math.round(255 * Math.max(0, t * 2 - 0.6));
  const b = Math.round(255 * Math.max(0, 0.5 - Math.abs(t - 0.25)));
  return [r, g, b];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SpectrogramView({
  slice,
  selection,
  onSelectTime,
  onSelectFreq,
  onTimeWindowChange,
}: SliceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Stable callback refs
  const onSelectTimeRef = useRef(onSelectTime);
  const onSelectFreqRef = useRef(onSelectFreq);
  const onTimeWindowChangeRef = useRef(onTimeWindowChange);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { onSelectFreqRef.current = onSelectFreq; });
  useEffect(() => { onTimeWindowChangeRef.current = onTimeWindowChange; });

  // Decode data
  const { times, freqs, values } = useMemo(() => {
    const decoded = decodeArrowSlice(slice);
    return extractSpectrogram(decoded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.payload]);

  // Data bounds
  const dataTMin = times.length > 0 ? times[0] : 0;
  const dataTMax = times.length > 0 ? times[times.length - 1] : 1;
  const dataFMin = freqs.length > 0 ? freqs[0] : 0;
  const dataFMax = freqs.length > 0 ? freqs[freqs.length - 1] : 1;

  // Gesture hook
  const { viewport, activeTool, wheelZoom, setActiveTool, setWheelZoom, resetViewport } = useHeatmapGestures({
    canvasRef,
    xRange: [dataTMin, dataTMax],
    yRange: [dataFMin, dataFMax],
    onSelectX: (t) => onSelectTimeRef.current?.(t),
    onSelectY: (f) => onSelectFreqRef.current?.(f),
    onXRangeChange: (range) => onTimeWindowChangeRef.current?.(range),
  });

  // ── Canvas rendering — re-renders on viewport or data change ────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || times.length === 0 || freqs.length === 0) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    const canvasW = Math.max(1, Math.round(rect?.width ?? 300));
    const canvasH = Math.max(1, Math.round(rect?.height ?? 200));
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { xLo: tLo, xHi: tHi, yLo: fLo, yHi: fHi } = viewport;
    const tRange = tHi - tLo || 1;
    const fRange = fHi - fLo || 1;

    // Find min/max within viewport for color scaling
    let cMin = Infinity;
    let cMax = -Infinity;
    for (let ti = 0; ti < times.length; ti++) {
      if (times[ti] < tLo || times[ti] > tHi) continue;
      for (let fi = 0; fi < freqs.length; fi++) {
        if (freqs[fi] < fLo || freqs[fi] > fHi) continue;
        const v = values[ti][fi];
        if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; }
      }
    }
    if (!Number.isFinite(cMin)) { cMin = 0; cMax = 1; }

    const imgData = ctx.createImageData(canvasW, canvasH);
    for (let px = 0; px < canvasW; px++) {
      // Map pixel x → time
      const t = tLo + (px / canvasW) * tRange;
      // Find nearest time index
      const ti = nearestIdx(times, t);
      for (let py = 0; py < canvasH; py++) {
        // Map pixel y → freq (top = fHi, bottom = fLo)
        const f = fHi - (py / canvasH) * fRange;
        const fi = nearestIdx(freqs, f);
        const idx = (py * canvasW + px) * 4;
        const [r, g, b] = valueToColor(values[ti][fi], cMin, cMax);
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [times, freqs, values, viewport]);

  // Rules of Hooks: all hooks above, conditional return below
  if (!selection || times.length === 0 || freqs.length === 0) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Spectrogram</h2><p>No data.</p></div>
      </div>
    );
  }

  const { xLo: tLo, xHi: tHi, yLo: fLo, yHi: fHi } = viewport;

  return (
    <div ref={wrapRef} style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div className="ts-toolbar">
        <button
          type="button"
          className={`ts-tool${activeTool === "zoom" ? " active" : ""}`}
          title="Box Zoom — drag to zoom a region"
          onClick={() => setActiveTool("zoom")}
        >&#x229E;</button>
        <button
          type="button"
          className={`ts-tool${activeTool === "pan" ? " active" : ""}`}
          title="Pan — drag to scroll"
          onClick={() => setActiveTool("pan")}
        >&#x27FA;</button>
        <button
          type="button"
          className={`ts-tool${wheelZoom ? " active" : ""}`}
          title={`Wheel Zoom ${wheelZoom ? "(ON)" : "(OFF)"}`}
          onClick={() => setWheelZoom(!wheelZoom)}
        >&#x2299;</button>
        <div className="ts-toolbar-sep" />
        <button type="button" className="ts-tool" title="Reset view" onClick={resetViewport}>&#x21BA;</button>
      </div>

      {/* Spectrogram with axes */}
      <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }}>
        <div className="axis-y-label">Freq (Hz)</div>
        <YTicks lo={fLo} hi={fHi} />
        <div className="axis-canvas-area">
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
          {/* Time cursor */}
          {tHi > tLo && selection.time >= tLo && selection.time <= tHi && (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${((selection.time - tLo) / (tHi - tLo)) * 100}%`,
                width: "1px",
                background: "rgba(255,220,50,0.8)",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Freq cursor */}
          {fHi > fLo && selection.freq != null && selection.freq >= fLo && selection.freq <= fHi && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${((fHi - selection.freq) / (fHi - fLo)) * 100}%`,
                height: "1px",
                background: "rgba(115,210,222,0.7)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
        <XTicks lo={tLo} hi={tHi} />
        <div className="axis-x-label">Time (s)</div>
      </div>

      {/* Time scale bar */}
      {onTimeWindowChange && (
        <TimeScaleBar timeCursor={selection.time} onTimeWindowChange={onTimeWindowChange} />
      )}
    </div>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Binary search for nearest index in a sorted array. */
function nearestIdx(arr: Float64Array | number[], target: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  // Check if lo-1 is closer
  if (lo > 0 && Math.abs(arr[lo - 1] - target) < Math.abs(arr[lo] - target)) {
    return lo - 1;
  }
  return lo;
}
