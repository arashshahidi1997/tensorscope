import { useCallback, useEffect, useRef, useState } from "react";

// ── Public types ─────────────────────────────────────────────────────────────

export type HeatmapGestureOptions = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Current data bounds — the full extent the viewport can show */
  xRange: [number, number]; // [min, max]
  yRange: [number, number]; // [min, max]
  /** Called on single click (not drag) */
  onSelectX?: (x: number) => void;
  onSelectY?: (y: number) => void;
  /** Called when X range changes (e.g. for syncing navigator) */
  onXRangeChange?: (range: [number, number]) => void;
};

export type HeatmapViewport = {
  xLo: number;
  xHi: number;
  yLo: number;
  yHi: number;
};

export type HeatmapGestureResult = {
  viewport: HeatmapViewport;
  activeTool: "zoom" | "pan";
  wheelZoom: boolean;
  setActiveTool: (tool: "zoom" | "pan") => void;
  setWheelZoom: (v: boolean) => void;
  resetViewport: () => void;
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useHeatmapGestures(opts: HeatmapGestureOptions): HeatmapGestureResult {
  const { canvasRef, xRange, yRange, onSelectX, onSelectY, onXRangeChange } = opts;

  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;

  // Tool state
  const [activeTool, setActiveTool] = useState<"zoom" | "pan">("zoom");
  const [wheelZoom, setWheelZoom] = useState(true);
  const toolRef = useRef<"zoom" | "pan">("zoom");
  const wheelZoomRef = useRef(true);
  useEffect(() => { toolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { wheelZoomRef.current = wheelZoom; }, [wheelZoom]);

  // Viewport state
  const [viewport, setViewport] = useState<HeatmapViewport>({
    xLo: xMin, xHi: xMax, yLo: yMin, yHi: yMax,
  });

  // Reset viewport when data bounds change
  useEffect(() => {
    setViewport({ xLo: xMin, xHi: xMax, yLo: yMin, yHi: yMax });
  }, [xMin, xMax, yMin, yMax]);

  // Ref for gesture handlers (avoids stale closures)
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  // Stable callback refs
  const onSelectXRef = useRef(onSelectX);
  const onSelectYRef = useRef(onSelectY);
  const onXRangeChangeRef = useRef(onXRangeChange);
  useEffect(() => { onSelectXRef.current = onSelectX; });
  useEffect(() => { onSelectYRef.current = onSelectY; });
  useEffect(() => { onXRangeChangeRef.current = onXRangeChange; });

  // ── Gesture layer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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
      startVP: HeatmapViewport;
    };
    const drag: DragState = {
      active: false, startX: 0, startY: 0, moved: false,
      rect: new DOMRect(), startVP: viewportRef.current,
    };

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const pxToCoords = (clientX: number, clientY: number, vp: HeatmapViewport) => {
      const r = drag.rect;
      const xFrac = clamp((clientX - r.left) / r.width, 0, 1);
      const yFrac = clamp((clientY - r.top) / r.height, 0, 1);
      return {
        x: vp.xLo + xFrac * (vp.xHi - vp.xLo),
        y: vp.yHi - yFrac * (vp.yHi - vp.yLo), // top = yHi, bottom = yLo
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
        const dxFrac = -dx / r.width;
        const dyFrac = dy / r.height; // inverted: drag up = higher value
        const xShift = dxFrac * (vp.xHi - vp.xLo);
        const yShift = dyFrac * (vp.yHi - vp.yLo);
        setViewport({
          xLo: vp.xLo + xShift,
          xHi: vp.xHi + xShift,
          yLo: vp.yLo + yShift,
          yHi: vp.yHi + yShift,
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
        // Click — select coordinates
        const c = pxToCoords(e.clientX, e.clientY, viewportRef.current);
        if (Number.isFinite(c.x)) onSelectXRef.current?.(c.x);
        if (Number.isFinite(c.y)) onSelectYRef.current?.(c.y);
        return;
      }

      if (toolRef.current === "zoom") {
        const vp = drag.startVP;
        const dx = Math.abs(e.clientX - drag.startX);
        const dy = Math.abs(e.clientY - drag.startY);

        // Determine dominant drag direction
        const isHorizontal = dx > dy * 1.5;
        const isVertical = dy > dx * 1.5;

        const c0 = pxToCoords(drag.startX, drag.startY, vp);
        const c1 = pxToCoords(e.clientX, e.clientY, vp);

        if (isHorizontal && dx > 4) {
          // Horizontal zoom — X axis only
          const newXLo = Math.min(c0.x, c1.x);
          const newXHi = Math.max(c0.x, c1.x);
          setViewport((prev) => ({ ...prev, xLo: newXLo, xHi: newXHi }));
          onXRangeChangeRef.current?.([newXLo, newXHi]);
        } else if (isVertical && dy > 4) {
          // Vertical zoom — Y axis only
          const newYLo = Math.min(c0.y, c1.y);
          const newYHi = Math.max(c0.y, c1.y);
          setViewport((prev) => ({ ...prev, yLo: newYLo, yHi: newYHi }));
        } else if (dx > 4 || dy > 4) {
          // Box zoom — both axes
          setViewport({
            xLo: Math.min(c0.x, c1.x),
            xHi: Math.max(c0.x, c1.x),
            yLo: Math.min(c0.y, c1.y),
            yHi: Math.max(c0.y, c1.y),
          });
          onXRangeChangeRef.current?.([Math.min(c0.x, c1.x), Math.max(c0.x, c1.x)]);
        }
      }
      // Pan already applied in onMouseMove
    };

    // ── Wheel zoom ───────────────────────────────────────────────────────────
    const onWheel = (e: WheelEvent) => {
      if (!wheelZoomRef.current) return;
      e.preventDefault();
      const vp = viewportRef.current;
      const r = canvas.getBoundingClientRect();
      const xFrac = clamp((e.clientX - r.left) / r.width, 0, 1);
      const yFrac = clamp((e.clientY - r.top) / r.height, 0, 1);
      const factor = e.deltaY > 0 ? 1.25 : 0.8;

      // Zoom X around cursor
      const xCenter = vp.xLo + xFrac * (vp.xHi - vp.xLo);
      const newXLo = xCenter + (vp.xLo - xCenter) * factor;
      const newXHi = xCenter + (vp.xHi - xCenter) * factor;

      // Zoom Y around cursor (top=yHi, bottom=yLo)
      const yCenter = vp.yHi - yFrac * (vp.yHi - vp.yLo);
      const newYLo = yCenter + (vp.yLo - yCenter) * factor;
      const newYHi = yCenter + (vp.yHi - yCenter) * factor;

      setViewport({ xLo: newXLo, xHi: newXHi, yLo: newYLo, yHi: newYHi });
      onXRangeChangeRef.current?.([newXLo, newXHi]);
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
  }, [canvasRef, xMin, xMax, yMin, yMax]);

  // Update cursor style when tool changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = activeTool === "pan" ? "grab" : "crosshair";
  }, [activeTool, canvasRef]);

  const resetViewport = useCallback(() => {
    const vp = { xLo: xMin, xHi: xMax, yLo: yMin, yHi: yMax };
    setViewport(vp);
    onXRangeChangeRef.current?.([xMin, xMax]);
  }, [xMin, xMax, yMin, yMax]);

  return { viewport, activeTool, wheelZoom, setActiveTool, setWheelZoom, resetViewport };
}
