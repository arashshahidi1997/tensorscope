import { useEffect, useRef } from "react";
import { decodeArrowSlice, extractSpectrogram } from "../../api/arrow";
import type { SliceViewProps } from "./viewTypes";

function valueToColor(v: number, min: number, max: number): [number, number, number] {
  if (!Number.isFinite(v)) return [20, 20, 20];
  const t = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  // Inferno-like: black → purple → orange → yellow
  const r = Math.round(255 * Math.min(1, t * 2));
  const g = Math.round(255 * Math.max(0, t * 2 - 0.6));
  const b = Math.round(255 * Math.max(0, 0.5 - Math.abs(t - 0.25)));
  return [r, g, b];
}

export function SpectrogramView({ slice, selection }: SliceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const decoded = decodeArrowSlice(slice);
  const { times, freqs, values } = extractSpectrogram(decoded);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || times.length === 0 || freqs.length === 0) return;

    const nT = times.length;
    const nF = freqs.length;
    canvas.width = nT;
    canvas.height = nF;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Find global min/max for colour mapping
    let min = Infinity;
    let max = -Infinity;
    for (const row of values) {
      for (const v of row) {
        if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
      }
    }

    const imgData = ctx.createImageData(nT, nF);
    for (let ti = 0; ti < nT; ti++) {
      for (let fi = 0; fi < nF; fi++) {
        // Canvas origin top-left; freqs increase upward so flip fi
        const pixelRow = nF - 1 - fi;
        const idx = (pixelRow * nT + ti) * 4;
        const [r, g, b] = valueToColor(values[ti][fi], min, max);
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [times, freqs, values]);

  if (!selection || times.length === 0 || freqs.length === 0) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Spectrogram</h2><p>No data.</p></div>
      </div>
    );
  }

  const tMin = times[0];
  const tMax = times[times.length - 1];
  const fMin = freqs[0];
  const fMax = freqs[freqs.length - 1];

  return (
    <div className="control-stack">
      <div className="panel-heading">
        <h2>Spectrogram</h2>
        <p>
          {times.length} × {freqs.length} · t={tMin.toFixed(2)}–{tMax.toFixed(2)}s · f={fMin.toFixed(0)}–{fMax.toFixed(0)}Hz
        </p>
      </div>
      <div className="plot-frame" style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "200px", imageRendering: "pixelated", display: "block" }}
        />
        {/* Selected-time cursor */}
        {tMax > tMin && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${((selection.time - tMin) / (tMax - tMin)) * 100}%`, // selection is non-null here
              width: "1px",
              background: "rgba(255,220,50,0.8)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}
