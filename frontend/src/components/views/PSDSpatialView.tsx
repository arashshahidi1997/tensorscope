import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { extractPSDSpatialV2, type LabeledTensor } from "../../api/v2-arrow";
import { useAppStore } from "../../store/appStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useMaskStore } from "../../store/maskStore";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import { ColorBar } from "./ColorBar";
import { CoordReadout, joinCoords } from "./CoordReadout";
import { unmaskedCellRange } from "./colorRange";
import type { SpatialCellWithId } from "./SpatialRenderer";

type PSDSpatialProps = {
  v2: LabeledTensor;
  selectedFreq: number;
  onSelectFreq: (freq: number) => void;
  onSelectCell?: (ap: number, ml: number) => void;
  /** Panel's resolved tensor for the channel-mask lookup (Track C4). */
  tensorName?: string;
};

export function PSDSpatialView({ v2, selectedFreq, onSelectFreq, onSelectCell, tensorName }: PSDSpatialProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());

  // Channel mask for the panel's resolved tensor (Track C4) — masked cells
  // render with the hatch overlay, consistent with the spatial-map view.
  // Subscribed via the mask store so a sidebar toggle repaints in place.
  const globalTensor = useAppStore((s) => s.selectedTensor);
  const maskTensor = tensorName ?? globalTensor;
  const maskedArray = useMaskStore((s) => (maskTensor ? s.masks[maskTensor] : undefined));
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
    // Color range excludes masked channels (a bad channel must not skew it).
    [minValueRef.current, maxValueRef.current] = unmaskedCellRange(rawCells, nML, maskedSet);
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

  // Shared hovered electrode — highlight the cell under the cursor, linked with
  // the signal-row spatial_map (hovering either highlights the same cell).
  const storeHovered = useSelectionStore((s) => s.spatial.hoveredId);
  const setHoveredElectrode = useSelectionStore((s) => s.setHoveredElectrode);

  const renderGrid = useCallback(() => {
    rendererRef.current.render(cellsRef.current, {
      nAP: nAPRef.current,
      nML: nMLRef.current,
      colorScale: "sequential",
      hoveredId: storeHovered ?? null,
      selectedIds: [],
      minValue: minValueRef.current,
      maxValue: maxValueRef.current,
      // Match PSD heatmap so power maps look consistent across panels.
      colormap: "inferno",
      smoothing: false,
      // Equal-aspect: AP and ML share a physical unit → square cells, matching
      // the signal-row spatial_map so the two spatial panels read consistently.
      squareCells: true,
      maskedIds: maskedSet,
    });
  }, [maskedSet, storeHovered]);

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

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setHoveredElectrode(rendererRef.current.hitTest(e.clientX - rect.left, e.clientY - rect.top));
  }, [setHoveredElectrode]);
  const handleMouseLeave = useCallback(() => setHoveredElectrode(null), [setHoveredElectrode]);

  if (rawCells.length === 0) return null;

  // Constrain the canvas to the AP×ML aspect ratio and center it — identical to
  // the signal-row spatial_map — so the two spatial panels render at the same
  // size/shape (not stretched to fill the taller spectral row).
  const aspectRatio = (nMLRef.current || 1) / (nAPRef.current || 1);

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", gap: 4 }}>
    <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }} title="PSD spatial power at selected frequency">
      <div className="axis-y-label">AP</div>
      <div className="axis-y-ticks" />
      <div className="axis-canvas-area" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {(() => {
          const nML = nMLRef.current || 1;
          const hovering = storeHovered != null;
          const ap = hovering ? Math.floor(storeHovered! / nML) : null;
          const ml = hovering ? storeHovered! % nML : null;
          return (
            <CoordReadout
              muted={!hovering}
              text={joinCoords([
                ap != null ? `AP ${ap}` : null,
                ml != null ? `ML ${ml}` : null,
                Number.isFinite(selectedFreq) && selectedFreq > 0 ? `${selectedFreq.toFixed(1)} Hz` : null,
              ])}
            />
          );
        })()}
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
      <ColorBar
        colormap="inferno"
        min={minValueRef.current}
        max={maxValueRef.current}
        label="power"
      />
    </div>
  );
}
