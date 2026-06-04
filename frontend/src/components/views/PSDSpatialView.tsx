import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { extractPSDSpatialV2, type LabeledTensor } from "../../api/v2-arrow";
import { useAppStore } from "../../store/appStore";
import { useMaskStore } from "../../store/maskStore";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import { ColorBar } from "./ColorBar";
import type { SpatialCellWithId } from "./SpatialRenderer";

type PSDSpatialProps = {
  v2: LabeledTensor;
  selectedFreq: number;
  onSelectFreq: (freq: number) => void;
  onSelectCell?: (ap: number, ml: number) => void;
};

export function PSDSpatialView({ v2, selectedFreq, onSelectFreq, onSelectCell }: PSDSpatialProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());

  // Channel mask for the active tensor — masked cells render with the
  // hatch overlay, consistent with the spatial-map view. Subscribed via
  // the mask store so a sidebar toggle repaints in place.
  const selectedTensor = useAppStore((s) => s.selectedTensor);
  const maskedArray = useMaskStore((s) => (selectedTensor ? s.masks[selectedTensor] : undefined));
  const maskedSet = useMemo(
    () => (maskedArray ? new Set(maskedArray) : undefined),
    [maskedArray],
  );

  const cellsRef = useRef<SpatialCellWithId[]>([]);
  const nAPRef = useRef(0);
  const nMLRef = useRef(0);
  const minValueRef = useRef(0);
  const maxValueRef = useRef(1);

  // Extract spatial data at selected frequency (client-side filtering)
  const rawCells = useMemo(() => {
    return extractPSDSpatialV2(v2, selectedFreq);
  }, [v2, selectedFreq]);

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

  const renderGrid = useCallback(() => {
    rendererRef.current.render(cellsRef.current, {
      nAP: nAPRef.current,
      nML: nMLRef.current,
      colorScale: "sequential",
      hoveredId: null,
      selectedIds: [],
      minValue: minValueRef.current,
      maxValue: maxValueRef.current,
      // Match PSD heatmap so power maps look consistent across panels.
      colormap: "inferno",
      smoothing: false,
      maskedIds: maskedSet,
    });
  }, [maskedSet]);

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
      renderGrid();
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render when cells change (freq or data change) or the mask toggles.
  useEffect(() => {
    renderGrid();
  }, [rawCells, renderGrid]);

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

  if (rawCells.length === 0) return null;

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", gap: 4 }}>
    <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }} title="PSD spatial power at selected frequency">
      <div className="axis-y-label">AP</div>
      <div className="axis-y-ticks" />
      <div ref={containerRef} className="axis-canvas-area">
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
          onClick={handleClick}
        />
      </div>
      <div className="axis-x-ticks" />
      <div className="axis-x-label">ML</div>
    </div>
      <ColorBar
        colormap="inferno"
        min={minValueRef.current}
        max={maxValueRef.current}
        label="power"
      />
    </div>
  );
}
