import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { PSDHeatmapData } from "../../api/arrow";

type PSDHeatmapProps = {
  data: PSDHeatmapData;
  selectedFreq: number;
  onSelectFreq: (freq: number) => void;
};

/** Inferno-like colormap: black -> purple -> orange -> yellow */
function infernoColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * Math.min(1, clamped * 2));
  const g = Math.round(255 * Math.max(0, clamped * 2 - 0.6));
  const b = Math.round(255 * Math.max(0, 0.5 - Math.abs(clamped - 0.25)));
  return [r, g, b];
}

export function PSDHeatmapView({ data, selectedFreq, onSelectFreq }: PSDHeatmapProps) {
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
    const cellW = w / nC;
    const cellH = h / nF;

    const imgData = ctx.createImageData(nC, nF);
    for (let fi = 0; fi < nF; fi++) {
      // freq increases upward: freqs[0] is bottom, freqs[nF-1] is top
      const pixelRow = nF - 1 - fi;
      for (let ci = 0; ci < nC; ci++) {
        const v = matrix[fi][ci];
        const idx = (pixelRow * nC + ci) * 4;
        if (!Number.isFinite(v) || v <= 0) {
          imgData.data[idx] = 20;
          imgData.data[idx + 1] = 20;
          imgData.data[idx + 2] = 20;
          imgData.data[idx + 3] = 255;
        } else {
          const t = (Math.log10(v) - logMin) / (logMax - logMin || 1);
          const [r, g, b] = infernoColor(t);
          imgData.data[idx] = r;
          imgData.data[idx + 1] = g;
          imgData.data[idx + 2] = b;
          imgData.data[idx + 3] = 255;
        }
      }
    }

    // Draw image data scaled to canvas
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = nC;
    tmpCanvas.height = nF;
    tmpCanvas.getContext("2d")!.putImageData(imgData, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmpCanvas, 0, 0, w, h);

    // Frequency cursor line
    if (Number.isFinite(selectedFreq) && freqs.length >= 2) {
      const fMin = freqs[0];
      const fMax = freqs[freqs.length - 1];
      if (fMax > fMin) {
        const yFrac = (fMax - selectedFreq) / (fMax - fMin);
        const y = yFrac * h;
        ctx.strokeStyle = "rgba(115, 210, 222, 0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
  }, [selectedFreq]);

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
      const freq = fMax - yFrac * (fMax - fMin);
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
