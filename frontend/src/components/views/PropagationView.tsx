import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { decodeArrowSlice, extractSpatialCells } from "../../api/arrow";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import type { SpatialCellWithId } from "./SpatialRenderer";
import type { SliceViewProps } from "./viewTypes";

type PropagationViewProps = SliceViewProps & {
  onHoverElectrode?: (id: number | null) => void;
  hoveredId?: number | null;
  selectedIds?: number[];
  /** Override color scale min/max (for color-locked multi-frame views). */
  globalMin?: number;
  globalMax?: number;
};

export function PropagationView({
  slice,
  selection,
  onSelectCell,
  onHoverElectrode,
  hoveredId = null,
  selectedIds = [],
  globalMin,
  globalMax,
}: PropagationViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());

  // Decoded slice data cached in refs to avoid stale closure issues.
  const cellsRef = useRef<SpatialCellWithId[]>([]);
  const nAPRef = useRef(0);
  const nMLRef = useRef(0);
  const minValueRef = useRef(0);
  const maxValueRef = useRef(1);

  // Decode and transform SpatialCell[] → SpatialCellWithId[] outside of JSX.
  const decoded = slice ? decodeArrowSlice(slice) : null;
  const rawCells = decoded ? extractSpatialCells(decoded) : [];

  if (rawCells.length > 0) {
    const nML = Math.max(...rawCells.map((c) => c.ml)) + 1;
    nMLRef.current = nML;
    nAPRef.current = Math.max(...rawCells.map((c) => c.ap)) + 1;
    minValueRef.current = Math.min(...rawCells.map((c) => c.value));
    maxValueRef.current = Math.max(...rawCells.map((c) => c.value));
    cellsRef.current = rawCells.map((c) => ({
      id: c.ap * nML + c.ml,
      apIdx: c.ap,
      mlIdx: c.ml,
      value: c.value,
    }));
  } else {
    cellsRef.current = [];
    nAPRef.current = 0;
    nMLRef.current = 0;
  }

  // Initialize renderer when canvas mounts; handle resize via ResizeObserver.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = rendererRef.current;

    function syncSize() {
      if (!canvas || !container) return;
      const { width, height } = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      canvas.width = w;
      canvas.height = h;
      renderer.init(canvas, w, h);
    }

    syncSize();

    const ro = new ResizeObserver(() => {
      syncSize();
      renderer.render(cellsRef.current, {
        nAP: nAPRef.current,
        nML: nMLRef.current,
        colorScale: "sequential",
        hoveredId,
        selectedIds,
        minValue: globalMin ?? minValueRef.current,
        maxValue: globalMax ?? maxValueRef.current,
      });
    });

    ro.observe(container);

    return () => {
      ro.disconnect();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render whenever data or interaction state changes; draw time overlay after render.
  useEffect(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;

    renderer.render(cellsRef.current, {
      nAP: nAPRef.current,
      nML: nMLRef.current,
      colorScale: "sequential",
      hoveredId: hoveredId ?? null,
      selectedIds,
      minValue: globalMin ?? minValueRef.current,
      maxValue: globalMax ?? maxValueRef.current,
    });

    // Draw the time label overlay on top of the rendered cells.
    if (canvas && cellsRef.current.length > 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const rawTime = slice.meta?.selected_time;
        const selectedTime = typeof rawTime === "number" ? rawTime : parseFloat(String(rawTime));
        if (Number.isFinite(selectedTime)) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(4, 4, 90, 20);
          ctx.fillStyle = "#eee";
          ctx.font = "11px monospace";
          ctx.fillText(`t = ${selectedTime.toFixed(3)}s`, 8, 18);
        }
      }
    }
  }, [slice, hoveredId, selectedIds, globalMin, globalMax]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = rendererRef.current.hitTest(x, y);
      if (id === null) return;
      const nML = nMLRef.current;
      const apIdx = Math.floor(id / nML);
      const mlIdx = id % nML;
      onSelectCell?.(apIdx, mlIdx);
    },
    [onSelectCell],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = rendererRef.current.hitTest(x, y);
      onHoverElectrode?.(id);
    },
    [onHoverElectrode],
  );

  const handleMouseLeave = useCallback(() => {
    onHoverElectrode?.(null);
  }, [onHoverElectrode]);

  // Guard: must come AFTER all hooks.
  if (!selection) return null;

  return (
    <div className="axis-canvas-wrap" title="Spatial propagation frame — click a cell to select AP/ML">
      <div className="axis-y-label">AP</div>
      <div className="axis-y-ticks" />
      <div ref={containerRef} className="axis-canvas-area">
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </div>
      <div className="axis-x-ticks" />
      <div className="axis-x-label">ML</div>
    </div>
  );
}
