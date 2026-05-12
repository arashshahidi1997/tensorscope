import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PSDAvgData } from "../../api/arrow";
import { useAppStore } from "../../store/appStore";
import { YTicks } from "./AxisTicks";

type PSDCurveProps = {
  data: PSDAvgData;
  selectedFreq: number;
  onSelectFreq: (freq: number) => void;
  freqLogScale?: boolean;
};

/** Clamp a viewport to the data range so it never inverts or escapes. */
function clampViewport(
  vp: [number, number],
  dataLo: number,
  dataHi: number,
): [number, number] {
  const minSpan = (dataHi - dataLo) * 0.001;
  let [lo, hi] = vp;
  if (hi - lo < minSpan) hi = lo + minSpan;
  lo = Math.max(dataLo, Math.min(dataHi - minSpan, lo));
  hi = Math.max(lo + minSpan, Math.min(dataHi, hi));
  return [lo, hi];
}

/**
 * PSD Curve — Canvas 2D with rotated axes: Y=frequency, X=power.
 * Draws mean line and +/-1 std band.
 */
export function PSDCurveView({ data, selectedFreq, onSelectFreq, freqLogScale = false }: PSDCurveProps) {
  const toggleFreqLogScale = useAppStore((s) => s.toggleFreqLogScale);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const onSelectFreqRef = useRef(onSelectFreq);
  useEffect(() => { onSelectFreqRef.current = onSelectFreq; });

  const MARGIN = { top: 10, right: 10, bottom: 10, left: 10 };

  // Local freq-axis viewport for zoom/pan. null = autofit to data range.
  // Wheel zoom anchors around the cursor freq; pan drags scroll the
  // viewport vertically while zoomed in. Reset clears the viewport.
  const [freqViewport, setFreqViewport] = useState<[number, number] | null>(null);
  const freqViewportRef = useRef(freqViewport);
  useEffect(() => { freqViewportRef.current = freqViewport; });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { freqs, mean, std } = dataRef.current;
    if (freqs.length === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const plotW = w - MARGIN.left - MARGIN.right;
    const plotH = h - MARGIN.top - MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const dataFMin = freqs[0];
    const dataFMax = freqs[freqs.length - 1];
    const vp = freqViewportRef.current;
    const fMin = vp ? vp[0] : dataFMin;
    const fMax = vp ? vp[1] : dataFMax;
    const fRange = fMax - fMin || 1;
    const useLog = freqLogScale && fMin > 0;
    const logFMin = useLog ? Math.log10(fMin) : 0;
    const logFMax = useLog ? Math.log10(fMax) : 0;
    const logFRange = logFMax - logFMin || 1;

    // Log10 scale for power (X-axis)
    const logMean = mean.map((v) => (v > 0 ? Math.log10(v) : -10));
    const logLo = mean.map((v, i) => {
      const lo = v - std[i];
      return lo > 0 ? Math.log10(lo) : -10;
    });
    const logHi = mean.map((v, i) => {
      const hi = v + std[i];
      return hi > 0 ? Math.log10(hi) : -10;
    });

    let xMin = Infinity;
    let xMax = -Infinity;
    for (const v of logLo) { if (Number.isFinite(v) && v > -10) { if (v < xMin) xMin = v; } }
    for (const v of logHi) { if (Number.isFinite(v)) { if (v > xMax) xMax = v; } }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) { xMin = 0; xMax = 1; }
    const xRange = xMax - xMin || 1;
    // Add padding
    xMin -= xRange * 0.05;
    xMax += xRange * 0.05;
    const xRangePadded = xMax - xMin || 1;

    // Map freq to Y (top=fMax, bottom=fMin)
    const freqToY = (f: number) => {
      if (useLog && f > 0) {
        return MARGIN.top + ((logFMax - Math.log10(f)) / logFRange) * plotH;
      }
      return MARGIN.top + ((fMax - f) / fRange) * plotH;
    };
    // Map log power to X
    const logToX = (lp: number) => MARGIN.left + ((lp - xMin) / xRangePadded) * plotW;

    // Draw std band
    ctx.fillStyle = "rgba(115, 210, 222, 0.15)";
    ctx.beginPath();
    // Forward path: lo boundary
    for (let i = 0; i < freqs.length; i++) {
      const x = logToX(logLo[i]);
      const y = freqToY(freqs[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // Reverse path: hi boundary
    for (let i = freqs.length - 1; i >= 0; i--) {
      const x = logToX(logHi[i]);
      const y = freqToY(freqs[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // Draw mean line
    ctx.strokeStyle = "#73d2de";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = logToX(logMean[i]);
      const y = freqToY(freqs[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Frequency cursor line
    if (Number.isFinite(selectedFreq) && fRange > 0) {
      const y = freqToY(selectedFreq);
      ctx.strokeStyle = "rgba(115, 210, 222, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }, [selectedFreq, freqLogScale, freqViewport]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    function syncSize() {
      if (!container || !canvas) return;
      const { width, height } = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width));
      canvas.height = Math.max(1, Math.floor(height));
    }

    syncSize();

    const ro = new ResizeObserver(() => {
      syncSize();
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    draw();
  }, [data, selectedFreq, draw]);

  const freqLogScaleRef = useRef(freqLogScale);
  useEffect(() => { freqLogScaleRef.current = freqLogScale; });

  // Click handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e: MouseEvent) => {
      const { freqs } = dataRef.current;
      if (freqs.length < 2) return;
      const vp = freqViewportRef.current;
      const dataFMin = freqs[0];
      const dataFMax = freqs[freqs.length - 1];
      const fMin = vp ? vp[0] : dataFMin;
      const fMax = vp ? vp[1] : dataFMax;
      const rect = canvas.getBoundingClientRect();
      const plotH = rect.height - MARGIN.top - MARGIN.bottom;
      const yInPlot = e.clientY - rect.top - MARGIN.top;
      const yFrac = yInPlot / plotH;
      let freq: number;
      if (freqLogScaleRef.current && fMin > 0) {
        const logFMin = Math.log10(fMin);
        const logFMax = Math.log10(fMax);
        freq = Math.pow(10, logFMax - yFrac * (logFMax - logFMin));
      } else {
        freq = fMax - yFrac * (fMax - fMin);
      }
      if (Number.isFinite(freq)) onSelectFreqRef.current(freq);
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, []);

  // Wheel zoom: zoom around the cursor freq. Drag pan: scroll viewport
  // up/down vertically while zoomed in. Both are hooked at the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const yToFreq = (yInPlot: number, plotH: number, fLo: number, fHi: number): number => {
      const yFrac = Math.max(0, Math.min(1, yInPlot / plotH));
      if (freqLogScaleRef.current && fLo > 0) {
        const logLo = Math.log10(fLo);
        const logHi = Math.log10(fHi);
        return Math.pow(10, logHi - yFrac * (logHi - logLo));
      }
      return fHi - yFrac * (fHi - fLo);
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { freqs } = dataRef.current;
      if (freqs.length < 2) return;
      const dataFMin = freqs[0];
      const dataFMax = freqs[freqs.length - 1];
      const cur = freqViewportRef.current ?? [dataFMin, dataFMax];
      const rect = canvas.getBoundingClientRect();
      const plotH = rect.height - MARGIN.top - MARGIN.bottom;
      const yInPlot = e.clientY - rect.top - MARGIN.top;
      const anchorFreq = yToFreq(yInPlot, plotH, cur[0], cur[1]);
      const factor = Math.exp(e.deltaY * 0.001); // wheel-up zooms in
      const lo = anchorFreq - (anchorFreq - cur[0]) * factor;
      const hi = anchorFreq + (cur[1] - anchorFreq) * factor;
      const next = clampViewport([lo, hi], dataFMin, dataFMax);
      // Snap to "no viewport" when essentially at full range so subsequent
      // axis-tick generation reads the data range directly.
      if (Math.abs(next[0] - dataFMin) < 1e-6 && Math.abs(next[1] - dataFMax) < 1e-6) {
        setFreqViewport(null);
      } else {
        setFreqViewport(next);
      }
    };

    let panStart: { y: number; vp: [number, number] } | null = null;
    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { freqs } = dataRef.current;
      if (freqs.length < 2) return;
      const cur = freqViewportRef.current ?? [freqs[0], freqs[freqs.length - 1]];
      panStart = { y: e.clientY, vp: cur };
      // Don't preventDefault — preserves the click handler for cursor select.
    };
    const handlePointerMove = (e: PointerEvent) => {
      if (!panStart) return;
      // Only pan after a noticeable drag so single clicks still pick freq.
      if (Math.abs(e.clientY - panStart.y) < 4) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const { freqs } = dataRef.current;
      const dataFMin = freqs[0];
      const dataFMax = freqs[freqs.length - 1];
      const rect = canvas.getBoundingClientRect();
      const plotH = rect.height - MARGIN.top - MARGIN.bottom;
      const [lo, hi] = panStart.vp;
      const dy = e.clientY - panStart.y;
      const dyFreq =
        freqLogScaleRef.current && lo > 0
          ? // In log scale, pan in log10 space then exponentiate.
            (() => {
              const dyFrac = dy / plotH;
              const logLo = Math.log10(lo);
              const logHi = Math.log10(hi);
              const dLog = dyFrac * (logHi - logLo);
              const newLogLo = logLo + dLog;
              const newLogHi = logHi + dLog;
              const next = clampViewport(
                [Math.pow(10, newLogLo), Math.pow(10, newLogHi)],
                dataFMin,
                dataFMax,
              );
              setFreqViewport(next);
              return null;
            })()
          : null;
      void dyFreq;
      if (!(freqLogScaleRef.current && lo > 0)) {
        const dyFrac = dy / plotH;
        const dFreq = dyFrac * (hi - lo);
        const next = clampViewport([lo + dFreq, hi + dFreq], dataFMin, dataFMax);
        setFreqViewport(next);
      }
    };
    const handlePointerUp = () => {
      panStart = null;
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  if (data.freqs.length === 0) return null;

  const dataFMin = data.freqs[0];
  const dataFMax = data.freqs[data.freqs.length - 1];
  const fMin = freqViewport ? freqViewport[0] : dataFMin;
  const fMax = freqViewport ? freqViewport[1] : dataFMax;

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="ts-toolbar">
        <button
          type="button"
          className={`ts-tool${freqLogScale ? " active" : ""}`}
          title={`Frequency axis: ${freqLogScale ? "log" : "linear"}`}
          onClick={toggleFreqLogScale}
          aria-label="Toggle log frequency"
          aria-pressed={freqLogScale}
        >log</button>
        <button
          type="button"
          className="ts-tool"
          title="Reset freq zoom"
          onClick={() => setFreqViewport(null)}
          disabled={!freqViewport}
          aria-label="Reset frequency zoom"
        >↺</button>
      </div>
      <div className="axis-canvas-wrap" title="Wheel: zoom · drag: pan · click: pick freq" style={{ flex: 1, minHeight: 0 }}>
        <div className="axis-y-label">Freq (Hz)</div>
        <YTicks lo={fMin} hi={fMax} logScale={freqLogScale} />
        <div ref={containerRef} className="axis-canvas-area">
          <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }} />
        </div>
        <div className="axis-x-ticks" />
        <div className="axis-x-label">Power (log₁₀)</div>
      </div>
    </div>
  );
}
