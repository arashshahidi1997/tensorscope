import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { PSDAvgData } from "../../api/arrow";

type PSDCurveProps = {
  data: PSDAvgData;
  selectedFreq: number;
  onSelectFreq: (freq: number) => void;
};

/**
 * PSD Curve — Canvas 2D with rotated axes: Y=frequency, X=power.
 * Draws mean line and +/-1 std band.
 */
export function PSDCurveView({ data, selectedFreq, onSelectFreq }: PSDCurveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const onSelectFreqRef = useRef(onSelectFreq);
  useEffect(() => { onSelectFreqRef.current = onSelectFreq; });

  const MARGIN = { top: 10, right: 10, bottom: 10, left: 10 };

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

    const fMin = freqs[0];
    const fMax = freqs[freqs.length - 1];
    const fRange = fMax - fMin || 1;

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
    const freqToY = (f: number) => MARGIN.top + ((fMax - f) / fRange) * plotH;
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
  }, [selectedFreq]);

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

  // Click handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e: MouseEvent) => {
      const { freqs } = dataRef.current;
      if (freqs.length < 2) return;
      const rect = canvas.getBoundingClientRect();
      const yFrac = (e.clientY - rect.top) / rect.height;
      const fMin = freqs[0];
      const fMax = freqs[freqs.length - 1];
      // Account for margins
      const plotH = rect.height - MARGIN.top - MARGIN.bottom;
      const yInPlot = e.clientY - rect.top - MARGIN.top;
      const freq = fMax - (yInPlot / plotH) * (fMax - fMin);
      if (Number.isFinite(freq)) onSelectFreqRef.current(freq);
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, []);

  if (data.freqs.length === 0) return null;

  return (
    <div ref={containerRef} className="psd-canvas-wrap" title="Click to select frequency">
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }} />
    </div>
  );
}
