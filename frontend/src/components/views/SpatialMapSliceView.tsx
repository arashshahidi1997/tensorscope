import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { decodeArrowSlice, extractSpatialCells } from "../../api/arrow";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import type { SpatialCellWithId } from "./SpatialRenderer";
import type { SliceViewProps } from "./viewTypes";

type SpatialMapProps = SliceViewProps & {
  onHoverElectrode?: (id: number | null) => void;
  colorScale?: "sequential" | "cyclical";
  hoveredId?: number | null;
  selectedIds?: number[];
};

export function SpatialMapSliceView({
  slice,
  selection,
  onSelectCell,
  onHoverElectrode,
  colorScale = "sequential",
  hoveredId = null,
  selectedIds = [],
}: SpatialMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());

  // Decode slice data once per slice prop change.
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

  // Initialize renderer when canvas mounts, and handle resize via ResizeObserver.
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
      // Re-render after resize with current data.
      renderer.render(cellsRef.current, {
        nAP: nAPRef.current,
        nML: nMLRef.current,
        colorScale,
        hoveredId,
        selectedIds,
        minValue: minValueRef.current,
        maxValue: maxValueRef.current,
      });
    });

    ro.observe(container);

    return () => {
      ro.disconnect();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render whenever data or interaction state changes.
  useEffect(() => {
    const renderer = rendererRef.current;
    renderer.render(cellsRef.current, {
      nAP: nAPRef.current,
      nML: nMLRef.current,
      colorScale,
      hoveredId: hoveredId ?? null,
      selectedIds,
      minValue: minValueRef.current,
      maxValue: maxValueRef.current,
    });
  }, [slice, colorScale, hoveredId, selectedIds]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = rendererRef.current.hitTest(x, y);
      if (id === null) return;
      // Recover (apIdx, mlIdx) from id.
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

  // Maintain aspect ratio: nML columns / nAP rows
  const nAP = nAPRef.current || 1;
  const nML = nMLRef.current || 1;
  const aspectRatio = nML / nAP;

  return (
    <div className="axis-canvas-wrap" title="Click a cell to select AP/ML">
      <div className="axis-y-label">AP</div>
      <div className="axis-y-ticks" />
      <div className="axis-canvas-area" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          ref={containerRef}
          style={{
            position: "relative",
            aspectRatio: `${aspectRatio}`,
            maxWidth: "100%",
            maxHeight: "100%",
            width: aspectRatio >= 1 ? "100%" : "auto",
            height: aspectRatio < 1 ? "100%" : "auto",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ display: "block", width: "100%", height: "100%" }}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </div>
      </div>
      <div className="axis-x-ticks" />
      <div className="axis-x-label">ML</div>
    </div>
  );
}
