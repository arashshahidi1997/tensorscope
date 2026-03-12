import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { DecodedSlice } from "../../api/arrow";
import { extractPSDSpatialAtFreq } from "../../api/arrow";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import type { SpatialCellWithId } from "./SpatialRenderer";

type PSDSpatialProps = {
  decoded: DecodedSlice;
  selectedFreq: number;
  onSelectFreq: (freq: number) => void;
  onSelectCell?: (ap: number, ml: number) => void;
};

export function PSDSpatialView({ decoded, selectedFreq, onSelectFreq, onSelectCell }: PSDSpatialProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());

  const cellsRef = useRef<SpatialCellWithId[]>([]);
  const nAPRef = useRef(0);
  const nMLRef = useRef(0);
  const minValueRef = useRef(0);
  const maxValueRef = useRef(1);

  // Extract spatial data at selected frequency (client-side filtering)
  const rawCells = useMemo(() => {
    return extractPSDSpatialAtFreq(decoded, selectedFreq);
  }, [decoded, selectedFreq]);

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
    });
  }, []);

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

  // Re-render when cells change (freq or data change)
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
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      title="PSD spatial power at selected frequency"
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
        onClick={handleClick}
      />
    </div>
  );
}
