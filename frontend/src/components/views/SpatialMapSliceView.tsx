import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { decodeArrowSlice, extractSpatialCells, type SpatialCell } from "../../api/arrow";
import { buildRegionResolver } from "../../api/probeLayout";
import { deriveSpatialGrid } from "./spatialGrid";
import { useProbeLayoutQuery } from "../../api/queries";
import { useAppStore } from "../../store/appStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useMaskStore } from "../../store/maskStore";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import { ColorBar } from "./ColorBar";
import { CoordReadout, joinCoords } from "./CoordReadout";
import type { SpatialCellWithId } from "./SpatialRenderer";
import type { SliceViewProps } from "./viewTypes";

type SpatialMapProps = Omit<SliceViewProps, "slice"> & {
  slice?: SliceViewProps["slice"];
  /** Contract-v2 source. When set, `slice` is ignored and these cells (already
   * rank-indexed + sorted by (ap, ml), same shape as `extractSpatialCells`)
   * drive the grid. */
  v2Cells?: SpatialCell[] | null;
  onHoverElectrode?: (id: number | null) => void;
  colorScale?: "sequential" | "cyclical";
  hoveredId?: number | null;
  selectedIds?: number[];
};

export function SpatialMapSliceView({
  slice,
  v2Cells = null,
  selection,
  onSelectCell,
  onHoverElectrode,
  colorScale = "sequential",
  hoveredId = null,
  selectedIds = [],
  tensorName,
}: SpatialMapProps & { tensorName?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());

  // Pull mask for the panel's resolved tensor (Track C4 — own probe's mask in
  // multi-probe). Subscribe via the masks slice so a sidebar toggle repaints
  // in place without a fresh slice fetch.
  const globalTensor = useAppStore((s) => s.selectedTensor);
  const maskTensor = tensorName ?? globalTensor;
  const maskedArray = useMaskStore((s) => (maskTensor ? s.masks[maskTensor] : undefined));
  const maskedSet = maskedArray ? new Set(maskedArray) : undefined;

  // Shared hovered electrode (set on hover via onHoverElectrode → store). Read
  // it back so the cell under the cursor is highlighted — and so hovering one
  // spatial panel highlights the same cell on the other (spatial_map ↔ psd_spatial).
  const storeHovered = useSelectionStore((s) => s.spatial.hoveredId);

  // G7: per-electrode region annotations. Returns null when no sidecar is
  // loaded — the renderer treats `undefined` as "no overlay" so the
  // unannotated view is unchanged.
  const { data: probeLayout } = useProbeLayoutQuery();

  // Hover state owned by the view itself so we can show a region tooltip
  // without forcing parents to track hover coordinates. The cell-hover
  // callback to the parent is preserved for the existing electrode-hover
  // wiring (e.g. cross-view highlighting).
  const [tooltip, setTooltip] = useState<
    { x: number; y: number; region: string; label: string | null } | null
  >(null);

  // Decode + derive render inputs once per data/mask change (pure logic in
  // spatialGrid.ts). Hover-only renders no longer re-run the Arrow decode or
  // write refs mid-render — the loop-prone pattern class behind the
  // "Maximum update depth exceeded" cascade (see WorkspaceMain's navigator
  // render-prop note).
  const derived = useMemo(() => {
    const decoded = !v2Cells && slice ? decodeArrowSlice(slice) : null;
    const rawCells = v2Cells ?? (decoded ? extractSpatialCells(decoded) : []);
    return deriveSpatialGrid(rawCells, maskedArray ? new Set(maskedArray) : undefined);
  }, [slice, v2Cells, maskedArray]);

  // Refs mirror the memoised value so the ResizeObserver closure (mounted
  // once) always repaints with current data.
  const cellsRef = useRef<SpatialCellWithId[]>([]);
  const nAPRef = useRef(0);
  const nMLRef = useRef(0);
  const minValueRef = useRef(0);
  const maxValueRef = useRef(1);
  cellsRef.current = derived.cells;
  nAPRef.current = derived.nAP;
  nMLRef.current = derived.nML;
  minValueRef.current = derived.minValue;
  maxValueRef.current = derived.maxValue;

  // Resolve the probe layout against the current grid width. Memoising
  // here avoids rebuilding the Map on hover-only renders (keyed on the
  // derived width, not a ref — a ref in a dep array never retriggers).
  const regionResolver = useMemo(
    () => buildRegionResolver(probeLayout, derived.nML),
    [probeLayout, derived.nML],
  );

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
        maskedIds: maskedSet,
        colormap: "jet",
        smoothing: true,
        squareCells: true,
        regionByFlatId: regionResolver.regionByFlatId,
        regionPalette: regionResolver.palette,
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
      hoveredId: hoveredId ?? storeHovered ?? null,
      selectedIds,
      minValue: minValueRef.current,
      maxValue: maxValueRef.current,
      maskedIds: maskedSet,
      colormap: "jet",
      smoothing: false,
      squareCells: true,
      regionByFlatId: regionResolver.regionByFlatId,
      regionPalette: regionResolver.palette,
    });
  }, [slice, v2Cells, colorScale, hoveredId, storeHovered, selectedIds, maskedArray, regionResolver]);

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
      if (id !== null && regionResolver.regionByFlatId.size > 0) {
        const region = regionResolver.regionByFlatId.get(id);
        if (region) {
          setTooltip({ x, y, region, label: null });
          return;
        }
      }
      setTooltip(null);
    },
    [onHoverElectrode, regionResolver],
  );

  const handleMouseLeave = useCallback(() => {
    onHoverElectrode?.(null);
    setTooltip(null);
  }, [onHoverElectrode]);

  // Guard: must come AFTER all hooks.
  if (!selection) return null;

  // Maintain aspect ratio: nML columns / nAP rows
  const nAP = nAPRef.current || 1;
  const nML = nMLRef.current || 1;
  const aspectRatio = nML / nAP;

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", gap: 4 }}>
    <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }} title="Click a cell to select AP/ML">
      <div className="axis-y-label">AP</div>
      <div className="axis-y-ticks" />
      <div className="axis-canvas-area" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {(() => {
          const hovAp = storeHovered != null ? Math.floor(storeHovered / nML) : null;
          const hovMl = storeHovered != null ? storeHovered % nML : null;
          const hovering = storeHovered != null;
          const ap = hovering ? hovAp : selection.ap;
          const ml = hovering ? hovMl : selection.ml;
          return (
            <CoordReadout
              muted={!hovering}
              text={joinCoords([ap != null ? `AP ${ap}` : null, ml != null ? `ML ${ml}` : null])}
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
          {tooltip && (
            <div
              className="spatial-region-tooltip"
              data-testid="spatial-region-tooltip"
              style={{
                position: "absolute",
                left: tooltip.x + 12,
                top: tooltip.y + 12,
                pointerEvents: "none",
                background: "rgba(13,17,23,0.92)",
                color: "#e6edf3",
                padding: "3px 8px",
                borderRadius: 4,
                fontSize: 12,
                border: "1px solid rgba(148,163,184,0.35)",
                whiteSpace: "nowrap",
                zIndex: 10,
              }}
            >
              {tooltip.region}
            </div>
          )}
        </div>
      </div>
      <div className="axis-x-ticks" />
      <div className="axis-x-label">ML</div>
    </div>
      <ColorBar
        colormap="jet"
        min={minValueRef.current}
        max={maxValueRef.current}
        label="value"
      />
    </div>
  );
}
