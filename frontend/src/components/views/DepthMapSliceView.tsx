import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { decodeArrowSlice, extractDepthProfile } from "../../api/arrow";
import { useAppStore } from "../../store/appStore";
import { useMaskStore } from "../../store/maskStore";
import { ChannelGridRenderer } from "./ChannelGridRenderer";
import { ColorBar } from "./ColorBar";
import type { SpatialCellWithId } from "./SpatialRenderer";
import type { SliceViewProps } from "./viewTypes";

/**
 * Depth map — the linear-probe (Neuropixels DV approximation) analogue of
 * SpatialMapSliceView. The `depth_map` slice is a (channel,) profile at the
 * selected instant carrying a per-channel `depth` coord; we lay it out as an
 * N×1 column ordered dorsal→ventral and paint it with the shared
 * ChannelGridRenderer. See docs/design/neuropixels-multiprobe.md.
 *
 * Clicking a cell selects that channel (ap rank → channel via onSelectCell,
 * with ml fixed at 0) so the rest of the workspace can follow the depth cursor.
 */
export function DepthMapSliceView({ slice, selection, onSelectCell }: SliceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());

  const selectedTensor = useAppStore((s) => s.selectedTensor);
  const maskedArray = useMaskStore((s) => (selectedTensor ? s.masks[selectedTensor] : undefined));
  const maskedSet = maskedArray ? new Set(maskedArray) : undefined;

  const cellsRef = useRef<SpatialCellWithId[]>([]);
  const nAPRef = useRef(0);
  const minValueRef = useRef(0);
  const maxValueRef = useRef(1);

  const decoded = slice ? decodeArrowSlice(slice) : null;
  const rawCells = decoded ? extractDepthProfile(decoded) : [];

  if (rawCells.length > 0) {
    nAPRef.current = rawCells.length;
    minValueRef.current = Math.min(...rawCells.map((c) => c.value));
    maxValueRef.current = Math.max(...rawCells.map((c) => c.value));
    // Single column → flat id == ap rank (nML = 1).
    cellsRef.current = rawCells.map((c) => ({
      id: c.ap,
      apIdx: c.ap,
      mlIdx: 0,
      value: c.value,
    }));
  } else {
    cellsRef.current = [];
    nAPRef.current = 0;
  }

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
        nML: 1,
        colorScale: "sequential",
        hoveredId: null,
        selectedIds: [],
        minValue: minValueRef.current,
        maxValue: maxValueRef.current,
        maskedIds: maskedSet,
        colormap: "jet",
        smoothing: false,
      });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    renderer.render(cellsRef.current, {
      nAP: nAPRef.current,
      nML: 1,
      colorScale: "sequential",
      hoveredId: null,
      selectedIds: [],
      minValue: minValueRef.current,
      maxValue: maxValueRef.current,
      maskedIds: maskedSet,
      colormap: "jet",
      smoothing: false,
    });
  }, [slice, maskedArray]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const id = rendererRef.current.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (id === null) return;
      // Single column: id == ap rank. ml fixed at 0.
      onSelectCell?.(id, 0);
    },
    [onSelectCell],
  );

  // Guard: after all hooks.
  if (!selection) return null;

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", gap: 4 }}>
      <div className="axis-canvas-wrap" style={{ flex: 1, minHeight: 0 }} title="Click a channel to select depth">
        <div className="axis-y-label">Depth</div>
        <div className="axis-y-ticks" />
        <div
          className="axis-canvas-area"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            ref={containerRef}
            style={{
              position: "relative",
              width: "auto",
              height: "100%",
              aspectRatio: `${1 / Math.max(1, nAPRef.current)}`,
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{ display: "block", width: "100%", height: "100%" }}
              onClick={handleClick}
            />
          </div>
        </div>
        <div className="axis-x-ticks" />
      </div>
      <ColorBar colormap="jet" min={minValueRef.current} max={maxValueRef.current} label="value" />
    </div>
  );
}
