import { useEffect, useMemo, useRef } from "react";
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

export function SpectrogramView({ slice, selection, onSelectTime, onSelectFreq }: SliceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stable callback refs — updated every render, never cause effect re-runs.
  // Same stable-ref pattern as TimeseriesSliceView's gesture layer.
  const onSelectTimeRef = useRef(onSelectTime);
  const onSelectFreqRef = useRef(onSelectFreq);
  useEffect(() => { onSelectTimeRef.current = onSelectTime; });
  useEffect(() => { onSelectFreqRef.current = onSelectFreq; });

  // Gap 1 fix: decode once per payload — Perspective draw/update split.
  // Previously inline at the top of the component, causing extractSpectrogram
  // to run and new arrays to be created on every React render (including cursor moves).
  // Now keyed to slice.payload; the ImageData effect only fires on actual data changes.
  const { times, freqs, values } = useMemo(() => {
    const decoded = decodeArrowSlice(slice);
    return extractSpectrogram(decoded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.payload]);

  // ImageData draw — fires only on data changes, not on cursor position updates.
  // CSS div overlays handle cursor rendering without touching the canvas (uPlot
  // u-cursor-x / u-cursor-y pattern applied to a custom Canvas view).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || times.length === 0 || freqs.length === 0) return;

    const nT = times.length;
    const nF = freqs.length;
    canvas.width = nT;
    canvas.height = nF;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
        // Canvas origin is top-left; freqs increase upward so flip fi
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

  // Gap 3 fix: click handler — separate from ImageData effect.
  // Re-attaches only when data bounds change (times/freqs), not on cursor updates.
  // Reads stable onSelectTimeRef / onSelectFreqRef so no re-attachment on selection changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || times.length === 0 || freqs.length === 0) return;

    const tMin = times[0];
    const tMax = times[times.length - 1];
    const fMin = freqs[0];
    const fMax = freqs[freqs.length - 1];

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const xFrac = (e.clientX - rect.left) / rect.width;
      const yFrac = (e.clientY - rect.top) / rect.height;
      // x → time: left=tMin, right=tMax
      const t = tMin + xFrac * (tMax - tMin);
      // y → freq: canvas origin top-left, so top=fMax, bottom=fMin
      const f = fMax - yFrac * (fMax - fMin);
      if (Number.isFinite(t)) onSelectTimeRef.current?.(t);
      if (Number.isFinite(f)) onSelectFreqRef.current?.(f);
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [times, freqs]);

  // Rules of Hooks: all hooks above, conditional return below
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
          style={{ width: "100%", height: "200px", imageRendering: "pixelated", display: "block", cursor: "crosshair" }}
        />
        {/* Gap 4: Time cursor — vertical line (uPlot u-cursor-x pattern, CSS only, no canvas repaint) */}
        {tMax > tMin && (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${((selection.time - tMin) / (tMax - tMin)) * 100}%`,
              width: "1px",
              background: "rgba(255,220,50,0.8)",
              pointerEvents: "none",
            }}
          />
        )}
        {/* Gap 4: Freq cursor — horizontal line (uPlot u-cursor-y pattern, CSS only, no canvas repaint) */}
        {fMax > fMin && selection.freq != null && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              // freq=fMax → top=0%; freq=fMin → top=100%
              top: `${((fMax - selection.freq) / (fMax - fMin)) * 100}%`,
              height: "1px",
              background: "rgba(115,210,222,0.7)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}
