import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { PSDHeatmapData } from "../../api/arrow";
import { YTicks } from "./AxisTicks";

type PSDHeatmapProps = {
  data: PSDHeatmapData;
  selectedFreq: number;
  onSelectFreq: (freq: number) => void;
  freqLogScale?: boolean;
};

/** Inferno-like colormap: black -> purple -> orange -> yellow */
function infernoColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * Math.min(1, clamped * 2));
  const g = Math.round(255 * Math.max(0, clamped * 2 - 0.6));
  const b = Math.round(255 * Math.max(0, 0.5 - Math.abs(clamped - 0.25)));
  return [r, g, b];
}

export function PSDHeatmapView({ data, selectedFreq, onSelectFreq, freqLogScale = false }: PSDHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const dataRef = useRef(data);
  dataRef.current = data;
  const onSelectFreqRef = useRef(onSelectFreq);
  useEffect(() => { onSelectFreqRef.current = onSelectFreq; });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { freqs, channelLabels, matrix } = dataRef.current;
    if (freqs.length === 0 || channelLabels.length === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Compute log10 bounds
    let logMin = Infinity;
    let logMax = -Infinity;
    for (const row of matrix) {
      for (const v of row) {
        if (Number.isFinite(v) && v > 0) {
          const lv = Math.log10(v);
          if (lv < logMin) logMin = lv;
          if (lv > logMax) logMax = lv;
        }
      }
    }
    if (!Number.isFinite(logMin)) { logMin = 0; logMax = 1; }

    const nF = freqs.length;
    const nC = channelLabels.length;

    const fMin = freqs[0];
    const fMax = freqs[nF - 1];
    const useLog = freqLogScale && fMin > 0;
    const logFMin = useLog ? Math.log10(fMin) : 0;
    const logFMax = useLog ? Math.log10(fMax) : 0;
    const logFRange = logFMax - logFMin || 1;
    const fRange = fMax - fMin || 1;

    // Map frequency to fractional Y (0=top=fMax, 1=bottom=fMin)
    const freqToYFrac = (f: number) => {
      if (useLog && f > 0) {
        return (logFMax - Math.log10(f)) / logFRange;
      }
      return (fMax - f) / fRange;
    };

    // For log scale we need to draw individual rectangles instead of a uniform grid
    for (let fi = 0; fi < nF; fi++) {
      const fLo = fi === 0 ? fMin : (freqs[fi - 1] + freqs[fi]) / 2;
      const fHi = fi === nF - 1 ? fMax : (freqs[fi] + freqs[fi + 1]) / 2;
      const yTop = freqToYFrac(fHi) * h;
      const yBot = freqToYFrac(fLo) * h;
      const cellH = Math.max(1, yBot - yTop);
      const cellW = w / nC;

      for (let ci = 0; ci < nC; ci++) {
        const v = matrix[fi][ci];
        if (!Number.isFinite(v) || v <= 0) {
          ctx.fillStyle = "rgb(20,20,20)";
        } else {
          const t = (Math.log10(v) - logMin) / (logMax - logMin || 1);
          const [r, g, b] = infernoColor(t);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        }
        ctx.fillRect(Math.floor(ci * cellW), Math.floor(yTop), Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Frequency cursor line
    if (Number.isFinite(selectedFreq) && nF >= 2 && fMax > fMin) {
      const y = freqToYFrac(selectedFreq) * h;
      ctx.strokeStyle = "rgba(115, 210, 222, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }, [selectedFreq, freqLogScale]);

  // Resize handling
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    function syncSize() {
      if (!container || !canvas) return;
      const { width, height } = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      canvas.width = w;
      canvas.height = h;
      sizeRef.current = { w, h };
    }

    syncSize();

    const ro = new ResizeObserver(() => {
      syncSize();
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Redraw on data or freq change
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
      let freq: number;
      if (freqLogScale && fMin > 0) {
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

  if (data.freqs.length === 0) return null;

  const fMin = data.freqs[0];
  const fMax = data.freqs[data.freqs.length - 1];

  return (
    <div className="axis-canvas-wrap" title="Click to select frequency">
      <div className="axis-y-label">Freq (Hz)</div>
      <YTicks lo={fMin} hi={fMax} />
      <div ref={containerRef} className="axis-canvas-area">
        <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }} />
      </div>
      <div className="axis-x-ticks" />
      <div className="axis-x-label">Channel</div>
    </div>
  );
}
