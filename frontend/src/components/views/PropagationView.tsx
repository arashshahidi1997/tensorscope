import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { decodeArrowSlice, extractSpatialCells } from "../../api/arrow";
import { useAppStore } from "../../store/appStore";
import { useMaskStore } from "../../store/maskStore";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import { ColorBar } from "./ColorBar";
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

  // Channel mask for the active tensor — masked cells get the hatch
  // overlay, consistent with the spatial-map + PSD-spatial views. Held
  // in a ref too so the ResizeObserver closure (created once) reads the
  // current mask without re-subscribing.
  const selectedTensor = useAppStore((s) => s.selectedTensor);
  const maskedArray = useMaskStore((s) => (selectedTensor ? s.masks[selectedTensor] : undefined));
  const maskedSet = useMemo(
    () => (maskedArray ? new Set(maskedArray) : undefined),
    [maskedArray],
  );
  const maskedSetRef = useRef<Set<number> | undefined>(maskedSet);
  maskedSetRef.current = maskedSet;

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
        colormap: "jet",
        smoothing: true,
        maskedIds: maskedSetRef.current,
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
      colormap: "jet",
      smoothing: false,
      maskedIds: maskedSetRef.current,
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
  }, [slice, hoveredId, selectedIds, globalMin, globalMax, maskedArray]);

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

  // Aspect-preserving wrap: mirror SpatialMapSliceView so the propagation
  // frame stays a true (nML/nAP) box in a wider-than-tall view panel —
  // never compressed in Y by the surrounding controller chrome.
  const nAP = nAPRef.current || 1;
  const nML = nMLRef.current || 1;
  const aspectRatio = nML / nAP;

  const cMin = globalMin ?? minValueRef.current;
  const cMax = globalMax ?? maxValueRef.current;

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", gap: 4 }}>
    <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }} title="Spatial propagation frame — click a cell to select AP/ML">
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
      <ColorBar colormap="jet" min={cMin} max={cMax} label="value" />
    </div>
  );
}
