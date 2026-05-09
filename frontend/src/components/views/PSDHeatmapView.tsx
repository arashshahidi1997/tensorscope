import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { PSDHeatmapData } from "../../api/arrow";
import { useHeatmapGestures } from "../../hooks/useHeatmapGestures";
import { useAppStore } from "../../store/appStore";
import { YTicks } from "./AxisTicks";

type PSDHeatmapProps = {
  data: PSDHeatmapData;
  selectedFreq: number;
  onSelectFreq: (freq: number) => void;
  freqLogScale?: boolean;
  /**
   * Selected AP/ML *coord values* (not indices) — used to draw a vertical
   * cursor at the corresponding channel column. Pass undefined to suppress
   * the cursor (e.g. for non-spatial source tensors).
   */
  selectedAPVal?: number;
  selectedMLVal?: number;
  /**
   * Click-to-select on a column commits the (ap_val, ml_val) of that
   * channel back upstream. Channel labels parsed from data.channelLabels
   * (`AP{ap}_ML{ml}`) — values are the original tensor coords.
   */
  onSelectChannel?: (apVal: number, mlVal: number) => void;
};

const CHANNEL_LABEL_RE = /^AP(-?\d+(?:\.\d+)?)_ML(-?\d+(?:\.\d+)?)$/;

function parseChannelLabel(label: string): { ap: number; ml: number } | null {
  const m = CHANNEL_LABEL_RE.exec(label);
  if (!m) return null;
  return { ap: Number.parseFloat(m[1]), ml: Number.parseFloat(m[2]) };
}

/** Inferno-like colormap: black -> purple -> orange -> yellow */
function infernoColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * Math.min(1, clamped * 2));
  const g = Math.round(255 * Math.max(0, clamped * 2 - 0.6));
  const b = Math.round(255 * Math.max(0, 0.5 - Math.abs(clamped - 0.25)));
  return [r, g, b];
}

export function PSDHeatmapView({
  data,
  selectedFreq,
  onSelectFreq,
  freqLogScale = false,
  selectedAPVal,
  selectedMLVal,
  onSelectChannel,
}: PSDHeatmapProps) {
  const toggleFreqLogScale = useAppStore((s) => s.toggleFreqLogScale);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const dataRef = useRef(data);
  dataRef.current = data;
  const onSelectFreqRef = useRef(onSelectFreq);
  const onSelectChannelRef = useRef(onSelectChannel);
  useEffect(() => { onSelectFreqRef.current = onSelectFreq; });
  useEffect(() => { onSelectChannelRef.current = onSelectChannel; });

  // Data bounds
  const nChannels = data.channelLabels.length;
  const fMin = data.freqs.length > 0 ? data.freqs[0] : 0;
  const fMax = data.freqs.length > 0 ? data.freqs[data.freqs.length - 1] : 1;

  // Pre-parse channel labels into (ap, ml) coord values for cursor lookup
  // and click-to-select. Cached on data identity since this is called on
  // every render in the gesture handler if not memoised.
  const parsedCoords = useMemo(
    () => data.channelLabels.map(parseChannelLabel),
    [data.channelLabels],
  );

  // Index of the column corresponding to the current AP/ML selection. -1
  // when no spatial selection or no match.
  const selectedColumn = useMemo(() => {
    if (selectedAPVal == null || selectedMLVal == null) return -1;
    return parsedCoords.findIndex(
      (p) => p != null && p.ap === selectedAPVal && p.ml === selectedMLVal,
    );
  }, [parsedCoords, selectedAPVal, selectedMLVal]);

  // Gesture hook — X = channels (discrete), Y = freq
  const { viewport, activeTool, wheelZoom, setActiveTool, setWheelZoom, resetViewport } = useHeatmapGestures({
    canvasRef,
    xRange: [0, Math.max(0, nChannels - 1)],
    yRange: [fMin, fMax],
    onSelectX: (xRaw) => {
      // Snap to the nearest column index, then forward the (ap, ml) coords
      // upstream so the rest of the workspace's selection updates.
      const ci = Math.max(0, Math.min(nChannels - 1, Math.round(xRaw)));
      const coord = parsedCoords[ci];
      if (coord && Number.isFinite(coord.ap) && Number.isFinite(coord.ml)) {
        onSelectChannelRef.current?.(coord.ap, coord.ml);
      }
    },
    onSelectY: (f) => {
      // The hook operates in linear data-space; for log scale we need to
      // convert back from linear viewport coords. But since the hook gives us
      // the data-space freq directly (linear), we just pass it through.
      if (Number.isFinite(f)) onSelectFreqRef.current(f);
    },
  });

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

    // Viewport bounds
    const vpXLo = viewport.xLo;
    const vpXHi = viewport.xHi;
    const vpFLo = viewport.yLo;
    const vpFHi = viewport.yHi;

    // Compute log10 bounds (only within viewport freq range)
    let logMin = Infinity;
    let logMax = -Infinity;
    for (let fi = 0; fi < freqs.length; fi++) {
      if (freqs[fi] < vpFLo || freqs[fi] > vpFHi) continue;
      for (let ci = 0; ci < channelLabels.length; ci++) {
        if (ci < vpXLo || ci > vpXHi) continue;
        const v = matrix[fi][ci];
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

    const useLog = freqLogScale && vpFLo > 0;
    const logFLo = useLog ? Math.log10(vpFLo) : 0;
    const logFHi = useLog ? Math.log10(vpFHi) : 0;
    const logFRange = logFHi - logFLo || 1;
    const fRange = vpFHi - vpFLo || 1;

    // Map frequency to fractional Y (0=top=fHi, 1=bottom=fLo) within viewport
    const freqToYFrac = (f: number) => {
      if (useLog && f > 0) {
        return (logFHi - Math.log10(f)) / logFRange;
      }
      return (vpFHi - f) / fRange;
    };

    // Visible channel range
    const cLo = Math.max(0, Math.floor(vpXLo));
    const cHi = Math.min(nC - 1, Math.ceil(vpXHi));
    const vpCRange = vpXHi - vpXLo || 1;

    for (let fi = 0; fi < nF; fi++) {
      if (freqs[fi] < vpFLo || freqs[fi] > vpFHi) continue;
      const fLoBound = fi === 0 ? freqs[0] : (freqs[fi - 1] + freqs[fi]) / 2;
      const fHiBound = fi === nF - 1 ? freqs[nF - 1] : (freqs[fi] + freqs[fi + 1]) / 2;
      // Clamp to viewport
      const fLoClamped = Math.max(vpFLo, fLoBound);
      const fHiClamped = Math.min(vpFHi, fHiBound);
      const yTop = freqToYFrac(fHiClamped) * h;
      const yBot = freqToYFrac(fLoClamped) * h;
      const cellH = Math.max(1, yBot - yTop);

      for (let ci = cLo; ci <= cHi; ci++) {
        const v = matrix[fi][ci];
        if (!Number.isFinite(v) || v <= 0) {
          ctx.fillStyle = "rgb(20,20,20)";
        } else {
          const t = (Math.log10(v) - logMin) / (logMax - logMin || 1);
          const [r, g, b] = infernoColor(t);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        }
        const px = ((ci - vpXLo) / vpCRange) * w;
        const cellW = w / vpCRange;
        ctx.fillRect(Math.floor(px), Math.floor(yTop), Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Frequency cursor line (horizontal)
    if (Number.isFinite(selectedFreq) && nF >= 2 && selectedFreq >= vpFLo && selectedFreq <= vpFHi) {
      const y = freqToYFrac(selectedFreq) * h;
      ctx.strokeStyle = "rgba(115, 210, 222, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Selected-channel cursor line (vertical) — locates the AP/ML cursor
    // on the heatmap so AP/ML changes have a visible effect here too.
    if (selectedColumn >= 0 && selectedColumn >= vpXLo && selectedColumn <= vpXHi) {
      const x = ((selectedColumn - vpXLo) / vpCRange) * w + (w / vpCRange) * 0.5;
      ctx.strokeStyle = "rgba(255, 220, 100, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }, [selectedFreq, freqLogScale, viewport, selectedColumn]);

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

  // Redraw on data, freq cursor, channel cursor, or viewport change
  useEffect(() => {
    draw();
  }, [data, selectedFreq, selectedColumn, draw]);

  // Rules of Hooks: all hooks above, conditional return below
  if (data.freqs.length === 0) return null;

  const vpFLo = viewport.yLo;
  const vpFHi = viewport.yHi;

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
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

      {/* Heatmap with axes */}
      <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }}>
        <div className="axis-y-label">Freq (Hz)</div>
        <YTicks lo={vpFLo} hi={vpFHi} logScale={freqLogScale && vpFLo > 0} />
        <div ref={containerRef} className="axis-canvas-area">
          <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", cursor: "crosshair" }} />
        </div>
        <div className="axis-x-ticks" />
        <div className="axis-x-label">Channel</div>
      </div>
    </div>
  );
}
