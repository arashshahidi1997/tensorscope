import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeArrowSlice, extractSpectrogram } from "../../api/arrow";
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

// ── Gesture types ─────────────────────────────────────────────────────────────

type GestureTool = "zoom" | "pan";
type Viewport = { tLo: number; tHi: number; fLo: number; fHi: number };

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

  // Tool state
  const [activeTool, setActiveTool] = useState<GestureTool>("zoom");
  const [wheelZoom, setWheelZoom] = useState(true);
  const toolRef = useRef<GestureTool>("zoom");
  const wheelZoomRef = useRef(true);
  useEffect(() => { toolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { wheelZoomRef.current = wheelZoom; }, [wheelZoom]);

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

  // Viewport — visible range within data extent (client-side zoom/pan)
  const [viewport, setViewport] = useState<Viewport>({
    tLo: dataTMin, tHi: dataTMax, fLo: dataFMin, fHi: dataFMax,
  });

  // Reset viewport when data changes
  useEffect(() => {
    setViewport({ tLo: dataTMin, tHi: dataTMax, fLo: dataFMin, fHi: dataFMax });
  }, [dataTMin, dataTMax, dataFMin, dataFMax]);

  // Ref for gesture handlers
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

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

    const { tLo, tHi, fLo, fHi } = viewport;
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

  // ── Gesture layer ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || times.length === 0 || freqs.length === 0) return;

    // Selection box overlay
    const selBox = document.createElement("div");
    selBox.style.cssText =
      "position:absolute;background:rgba(115,210,222,0.15);border:1px solid rgba(115,210,222,0.5);pointer-events:none;display:none;z-index:5;";
    canvas.parentElement?.appendChild(selBox);

    type DragState = {
      active: boolean;
      startX: number;
      startY: number;
      moved: boolean;
      rect: DOMRect;
      startVP: Viewport;
    };
    const drag: DragState = {
      active: false, startX: 0, startY: 0, moved: false,
      rect: new DOMRect(), startVP: viewportRef.current,
    };

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const pxToCoords = (clientX: number, clientY: number, vp: Viewport) => {
      const r = drag.rect;
      const xFrac = clamp((clientX - r.left) / r.width, 0, 1);
      const yFrac = clamp((clientY - r.top) / r.height, 0, 1);
      return {
        t: vp.tLo + xFrac * (vp.tHi - vp.tLo),
        f: vp.fHi - yFrac * (vp.fHi - vp.fLo),
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag.active = true;
      drag.moved = false;
      drag.rect = canvas.getBoundingClientRect();
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startVP = { ...viewportRef.current };
      if (toolRef.current === "pan") {
        canvas.style.cursor = "grabbing";
      } else {
        selBox.style.display = "block";
        selBox.style.left = `${e.clientX - drag.rect.left}px`;
        selBox.style.top = `${e.clientY - drag.rect.top}px`;
        selBox.style.width = "0px";
        selBox.style.height = "0px";
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!drag.active) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;

      if (toolRef.current === "pan") {
        const vp = drag.startVP;
        const r = drag.rect;
        const dtFrac = -dx / r.width;
        const dfFrac = dy / r.height; // inverted: drag up = higher freq
        const tShift = dtFrac * (vp.tHi - vp.tLo);
        const fShift = dfFrac * (vp.fHi - vp.fLo);
        setViewport({
          tLo: vp.tLo + tShift,
          tHi: vp.tHi + tShift,
          fLo: vp.fLo + fShift,
          fHi: vp.fHi + fShift,
        });
      } else {
        // Draw selection box
        const r = drag.rect;
        const x0 = Math.min(drag.startX, e.clientX) - r.left;
        const y0 = Math.min(drag.startY, e.clientY) - r.top;
        const w = Math.abs(dx);
        const h = Math.abs(dy);
        selBox.style.left = `${x0}px`;
        selBox.style.top = `${y0}px`;
        selBox.style.width = `${w}px`;
        selBox.style.height = `${h}px`;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!drag.active || e.button !== 0) return;
      drag.active = false;
      canvas.style.cursor = toolRef.current === "pan" ? "grab" : "crosshair";
      selBox.style.display = "none";

      if (!drag.moved) {
        // Click — select time + freq
        const c = pxToCoords(e.clientX, e.clientY, viewportRef.current);
        if (Number.isFinite(c.t)) onSelectTimeRef.current?.(c.t);
        if (Number.isFinite(c.f)) onSelectFreqRef.current?.(c.f);
        return;
      }

      if (toolRef.current === "zoom") {
        const vp = drag.startVP;
        const r = drag.rect;
        const dx = Math.abs(e.clientX - drag.startX);
        const dy = Math.abs(e.clientY - drag.startY);

        // Determine dominant drag direction
        const isHorizontal = dx > dy * 1.5;
        const isVertical = dy > dx * 1.5;

        const c0 = pxToCoords(drag.startX, drag.startY, vp);
        const c1 = pxToCoords(e.clientX, e.clientY, vp);

        if (isHorizontal && dx > 4) {
          // Horizontal zoom — zoom time axis only
          const newTLo = Math.min(c0.t, c1.t);
          const newTHi = Math.max(c0.t, c1.t);
          setViewport((prev) => ({ ...prev, tLo: newTLo, tHi: newTHi }));
          onTimeWindowChangeRef.current?.([newTLo, newTHi]);
        } else if (isVertical && dy > 4) {
          // Vertical zoom — zoom freq axis only
          const newFLo = Math.min(c0.f, c1.f);
          const newFHi = Math.max(c0.f, c1.f);
          setViewport((prev) => ({ ...prev, fLo: newFLo, fHi: newFHi }));
        } else if (dx > 4 || dy > 4) {
          // Box zoom — zoom both axes
          setViewport({
            tLo: Math.min(c0.t, c1.t),
            tHi: Math.max(c0.t, c1.t),
            fLo: Math.min(c0.f, c1.f),
            fHi: Math.max(c0.f, c1.f),
          });
          onTimeWindowChangeRef.current?.([Math.min(c0.t, c1.t), Math.max(c0.t, c1.t)]);
        }
      }
      // Pan already applied in onMouseMove
    };

    // ── Wheel zoom ────────────────────────────────────────────────────────
    const onWheel = (e: WheelEvent) => {
      if (!wheelZoomRef.current) return;
      e.preventDefault();
      const vp = viewportRef.current;
      const r = canvas.getBoundingClientRect();
      const xFrac = clamp((e.clientX - r.left) / r.width, 0, 1);
      const yFrac = clamp((e.clientY - r.top) / r.height, 0, 1);
      const factor = e.deltaY > 0 ? 1.25 : 0.8;

      // Zoom time around cursor X
      const tCenter = vp.tLo + xFrac * (vp.tHi - vp.tLo);
      const newTLo = tCenter + (vp.tLo - tCenter) * factor;
      const newTHi = tCenter + (vp.tHi - tCenter) * factor;

      // Zoom freq around cursor Y (top=fHi, bottom=fLo)
      const fCenter = vp.fHi - yFrac * (vp.fHi - vp.fLo);
      const newFLo = fCenter + (vp.fLo - fCenter) * factor;
      const newFHi = fCenter + (vp.fHi - fCenter) * factor;

      setViewport({ tLo: newTLo, tHi: newTHi, fLo: newFLo, fHi: newFHi });
      onTimeWindowChangeRef.current?.([newTLo, newTHi]);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.style.cursor = toolRef.current === "pan" ? "grab" : "crosshair";

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      selBox.remove();
    };
  }, [times, freqs]);

  // Update cursor style when tool changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = activeTool === "pan" ? "grab" : "crosshair";
  }, [activeTool]);

  const handleReset = useCallback(() => {
    const vp = { tLo: dataTMin, tHi: dataTMax, fLo: dataFMin, fHi: dataFMax };
    setViewport(vp);
    onTimeWindowChangeRef.current?.([dataTMin, dataTMax]);
  }, [dataTMin, dataTMax, dataFMin, dataFMax]);

  // Rules of Hooks: all hooks above, conditional return below
  if (!selection || times.length === 0 || freqs.length === 0) {
    return (
      <div className="control-stack">
        <div className="panel-heading"><h2>Spectrogram</h2><p>No data.</p></div>
      </div>
    );
  }

  const { tLo, tHi, fLo, fHi } = viewport;

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
          onClick={() => setWheelZoom((v) => !v)}
        >&#x2299;</button>
        <div className="ts-toolbar-sep" />
        <button type="button" className="ts-tool" title="Reset view" onClick={handleReset}>&#x21BA;</button>
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
