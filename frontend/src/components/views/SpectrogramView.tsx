import { useEffect, useMemo, useRef } from "react";
import { decodeArrowSlice, extractSpectrogram, type Spectrogram } from "../../api/arrow";
import { useHeatmapGestures } from "../../hooks/useHeatmapGestures";
import { useAppStore } from "../../store/appStore";
import type { SliceViewProps } from "./viewTypes";
import { XTicks, YTicks } from "./AxisTicks";
import { CrosshairOverlay } from "./CrosshairOverlay";
import { TimeScaleBar } from "./ChartToolbar";
import { getColormapLUT } from "./colormaps";

// ── Colormap ─────────────────────────────────────────────────────────────────
// Use the real `viridis` LUT (matplotlib default for heatmaps; perceptually
// uniform). Kept brighter-than-inferno on purpose: median-subtracted
// spectrogram values cluster near zero, and inferno's lower half is dark
// enough to render those as near-black. Audit S1/S2 — also satisfied,
// because viridis is a real matplotlib LUT, not the 3-line approximation
// the previous code shipped.
const SPEC_LUT = getColormapLUT("viridis");

function valueToColor(v: number, min: number, max: number): [number, number, number] {
  if (!Number.isFinite(v)) return [20, 20, 20];
  const t = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  const idx = Math.round(t * 255) * 4;
  return [SPEC_LUT[idx], SPEC_LUT[idx + 1], SPEC_LUT[idx + 2]];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SpectrogramView({
  slice,
  v2Data,
  selection,
  onSelectTime,
  onSelectFreq,
  onTimeWindowChange,
  timeWindow,
}: Omit<SliceViewProps, "slice"> & {
  /**
   * v1-only precomputed `spectrogram` view passes `slice`; v2 `spectrogram_live`
   * passes `v2Data`. The view keeps both paths.
   */
  slice?: SliceViewProps["slice"];
  /**
   * Contract-v2 pre-extracted spectrogram — when present, replaces the
   * `slice` decode. See `docs/design/contract-v2.md` §5.
   */
  v2Data?: Spectrogram | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const freqLogScale = useAppStore((s) => s.freqLogScale);
  const toggleFreqLogScale = useAppStore((s) => s.toggleFreqLogScale);

  // Stable callback refs
  const onSelectTimeRef = useRef(onSelectTime);
  const onSelectFreqRef = useRef(onSelectFreq);
  const onTimeWindowChangeRef = useRef(onTimeWindowChange);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { onSelectFreqRef.current = onSelectFreq; });
  useEffect(() => { onTimeWindowChangeRef.current = onTimeWindowChange; });

  // Decode data
  const { times, freqs, values } = useMemo(() => {
    if (v2Data) return v2Data;
    if (!slice) return { times: [] as number[], freqs: [] as number[], values: [] as number[][] };
    return extractSpectrogram(decodeArrowSlice(slice));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2Data, slice?.payload]);

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
    // Externally-driven viewport — store's authoritative `timeWindow` (e.g.
    // SSE-driven agent set_selection, navigator brush). Pins the X axis to
    // the store-supplied window instead of letting the data-bounds reset
    // snap us back when a fresh slice arrives.
    // See docs/log/issue/issue-arash-20260508-142724-956601.md.
    externalXRange: timeWindow,
  });

  // Audit S3: compute the in-viewport color range up front so the paint
  // path AND the ColorBar legend agree on what the on-screen colors mean.
  const colorRange = useMemo(() => {
    if (times.length === 0 || freqs.length === 0) return { cMin: 0, cMax: 1 };
    const { xLo: tLo, xHi: tHi, yLo: fLo, yHi: fHi } = viewport;
    let cMin = Infinity;
    let cMax = -Infinity;
    for (let ti = 0; ti < times.length; ti++) {
      if (times[ti] < tLo || times[ti] > tHi) continue;
      for (let fi = 0; fi < freqs.length; fi++) {
        if (freqs[fi] < fLo || freqs[fi] > fHi) continue;
        const v = values[ti][fi];
        if (Number.isFinite(v)) {
          if (v < cMin) cMin = v;
          if (v > cMax) cMax = v;
        }
      }
    }
    if (!Number.isFinite(cMin)) return { cMin: 0, cMax: 1 };
    return { cMin, cMax };
  }, [times, freqs, values, viewport]);

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
    const useLog = freqLogScale && fLo > 0;
    const logFLo = useLog ? Math.log10(fLo) : 0;
    const logFHi = useLog ? Math.log10(fHi) : 0;
    const logFRange = logFHi - logFLo || 1;

    const { cMin, cMax } = colorRange;

    const imgData = ctx.createImageData(canvasW, canvasH);
    for (let px = 0; px < canvasW; px++) {
      // Map pixel x → time
      const t = tLo + (px / canvasW) * tRange;
      // Find nearest time index
      const ti = nearestIdx(times, t);
      for (let py = 0; py < canvasH; py++) {
        // Map pixel y → freq (top = fHi, bottom = fLo)
        const f = useLog
          ? Math.pow(10, logFHi - (py / canvasH) * logFRange)
          : fHi - (py / canvasH) * fRange;
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
  }, [times, freqs, values, viewport, freqLogScale, colorRange]);

  // Rules of Hooks: all hooks above, conditional return below
  if (!selection || times.length === 0 || freqs.length === 0) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Spectrogram</h2><p>No data.</p></div>
      </div>
    );
  }

  const { xLo: tLo, xHi: tHi, yLo: fLo, yHi: fHi } = viewport;
  // Mirror the canvas's log/linear decision (it falls back to linear when the
  // low edge is non-positive, since log10(<=0) is undefined). Axes/overlays
  // must use the SAME predicate or ticks render on a log scale over a linearly
  // painted canvas.
  const useLogAxis = freqLogScale && fLo > 0;

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
        <div className="ts-toolbar-sep" />
        <button
          type="button"
          className={`ts-tool${freqLogScale ? " active" : ""}`}
          title={`Frequency axis: ${freqLogScale ? "log" : "linear"}`}
          onClick={toggleFreqLogScale}
          aria-label="Toggle log frequency"
          aria-pressed={freqLogScale}
        >log</button>
      </div>

      {/* Spectrogram with axes */}
      <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }}>
        <div className="axis-y-label">Freq (Hz)</div>
        <YTicks lo={fLo} hi={fHi} logScale={useLogAxis} />
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
                top: `${useLogAxis
                  ? ((Math.log10(fHi) - Math.log10(selection.freq)) /
                      (Math.log10(fHi) - Math.log10(fLo))) * 100
                  : ((fHi - selection.freq) / (fHi - fLo)) * 100}%`,
                height: "1px",
                background: "rgba(115,210,222,0.7)",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Cross-view hover crosshair (Bokeh-style inspector). */}
          <CrosshairOverlay tLo={tLo} tHi={tHi} fLo={fLo} fHi={fHi} freqLog={useLogAxis} />
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
