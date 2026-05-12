/**
 * MaskPanel — sidebar control for the per-tensor channel mask.
 *
 * Click a cell in the grid editor to toggle its mask state.  Buttons run the
 * common bulk operations: All, None, Invert, Interior (drop the outer
 * `ringDepth` rows). Live count chrome surfaces "masked / total".
 *
 * The store is local (zustand + localStorage); on every mutation we PUT the
 * mask to the server so views compute against the new mask, and the React
 * Query slice cache is invalidated so all panels refresh.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMaskQuery, useSetMask } from "../../api/queries";
import { useMaskStore } from "../../store/maskStore";
import { ChannelGridRenderer } from "../views/ChannelGridRenderer";

type MaskPanelProps = {
  tensorName: string | null;
  /** Grid dimensions for the active tensor (n_ap, n_ml). Optional — panel hides if missing. */
  nAP: number | null;
  nML: number | null;
};

export function MaskPanel({ tensorName, nAP, nML }: MaskPanelProps) {
  const total = nAP && nML ? nAP * nML : 0;

  // Server is the source of truth on first load (so a paired Python agent
  // can pre-seed the mask). After that the local store drives, and we PUT
  // changes back to the server.
  const setMaskMutation = useSetMask();
  const maskQuery = useMaskQuery(tensorName);

  const localMask = useMaskStore((s) => (tensorName ? s.masks[tensorName] : undefined));
  const setLocalMask = useMaskStore((s) => s.setMask);
  const toggleId = useMaskStore((s) => s.toggleId);
  const toggleRow = useMaskStore((s) => s.toggleRow);
  const toggleCol = useMaskStore((s) => s.toggleCol);
  const clearMask = useMaskStore((s) => s.clearMask);
  const invertMask = useMaskStore((s) => s.invertMask);
  const setInteriorOnly = useMaskStore((s) => s.setInteriorOnly);
  const selectAll = useMaskStore((s) => s.selectAll);

  // Selection mode: cell (toggle one), row (toggle whole AP row), col (toggle
  // whole ML column). Mirrors cogpy.legacy plot.tensorscope's ChannelGrid.
  type Mode = "cell" | "row" | "col";
  const [mode, setMode] = useState<Mode>("cell");

  // One-time hydration: if local store has nothing for this tensor and the
  // server returns something, mirror it locally without firing a PUT.
  const hydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tensorName || !maskQuery.data) return;
    if (hydratedRef.current === tensorName) return;
    if (localMask === undefined && maskQuery.data.masked_ids.length > 0) {
      setLocalMask(tensorName, maskQuery.data.masked_ids);
    }
    hydratedRef.current = tensorName;
  }, [tensorName, maskQuery.data, localMask, setLocalMask]);

  // Push local changes to the server. Debounced through the mutation so
  // rapid drag-toggles don't fire one PUT per cell.
  const lastPushedRef = useRef<string>("");
  useEffect(() => {
    if (!tensorName) return;
    const ids = localMask ?? [];
    const key = ids.join(",");
    if (key === lastPushedRef.current) return;
    lastPushedRef.current = key;
    setMaskMutation.mutate({ tensor: tensorName, masked_ids: ids });
  }, [tensorName, localMask]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ringDepth, setRingDepth] = useState(1);

  // Render the grid editor.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ChannelGridRenderer>(new ChannelGridRenderer());

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !nAP || !nML) return;
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
    const ro = new ResizeObserver(syncSize);
    ro.observe(container);
    return () => {
      ro.disconnect();
      renderer.dispose();
    };
  }, [nAP, nML]);

  useEffect(() => {
    if (!nAP || !nML) return;
    const renderer = rendererRef.current;
    // Editor mode draws an empty grid (no data values), masked cells in the
    // hatched style. Pass a single "neutral" cell value for unmasked slots
    // so the unmasked grid renders as a uniform dim color.
    const cells = [];
    for (let ap = 0; ap < nAP; ap++) {
      for (let ml = 0; ml < nML; ml++) {
        cells.push({ id: ap * nML + ml, apIdx: ap, mlIdx: ml, value: 0 });
      }
    }
    renderer.render(cells, {
      nAP,
      nML,
      colorScale: "sequential",
      hoveredId: null,
      selectedIds: [],
      // Pin every cell to t=0 → bottom of the LUT, which is dark navy.
      // Combined with `showCellBorders: true` below, the editor renders as a
      // dark grid with visible cell boundaries the user can target by eye.
      minValue: 0,
      maxValue: 1,
      maskedIds: new Set(localMask ?? []),
      smoothing: false,
      colormap: "sequential",
      showCellBorders: true,
    });
  }, [nAP, nML, localMask]);

  if (!tensorName || !nAP || !nML) {
    return (
      <div style={{ fontSize: 12, color: "#8b949e", padding: "4px 0" }}>
        Channel mask available only for grid (AP × ML) tensors. Select one to edit.
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !nML || !nAP) return;
    const rect = canvas.getBoundingClientRect();
    const id = rendererRef.current.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (id === null) return;
    const apIdx = Math.floor(id / nML);
    const mlIdx = id % nML;
    if (mode === "row") toggleRow(tensorName, apIdx, nML);
    else if (mode === "col") toggleCol(tensorName, mlIdx, nAP, nML);
    else toggleId(tensorName, id);
  };

  const maskedCount = localMask?.length ?? 0;
  const aspectRatio = nML / nAP;

  const modeTitle =
    mode === "row"
      ? "Click a row to toggle the whole AP row"
      : mode === "col"
        ? "Click a column to toggle the whole ML column"
        : "Click a cell to toggle its mask";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
      <div
        style={{
          display: "flex",
          gap: 4,
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: 11,
        }}
      >
        <span style={{ color: "#8b949e", marginRight: 2 }}>mode:</span>
        {(["cell", "row", "col"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`mask-bulk-btn${mode === m ? " active" : ""}`}
            onClick={() => setMode(m)}
            title={
              m === "cell"
                ? "Toggle individual cells"
                : m === "row"
                  ? "Toggle entire AP rows"
                  : "Toggle entire ML columns"
            }
          >
            {m}
          </button>
        ))}
      </div>
      <div
        ref={containerRef}
        style={{
          aspectRatio: `${aspectRatio}`,
          maxWidth: "100%",
          maxHeight: 200,
          width: aspectRatio >= 1 ? "100%" : "auto",
          height: aspectRatio < 1 ? "200px" : "auto",
          alignSelf: "center",
          cursor:
            mode === "row" ? "ns-resize" : mode === "col" ? "ew-resize" : "pointer",
        }}
        title={modeTitle}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%", cursor: "inherit" }}
          onClick={handleClick}
        />
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className="mask-bulk-btn"
          onClick={() => clearMask(tensorName)}
          title="Clear mask (mask none)"
        >
          None
        </button>
        <button
          type="button"
          className="mask-bulk-btn"
          onClick={() => selectAll(tensorName, total)}
          title="Mask all channels"
        >
          All
        </button>
        <button
          type="button"
          className="mask-bulk-btn"
          onClick={() => invertMask(tensorName, total)}
          title="Invert the current mask"
        >
          Invert
        </button>
        <button
          type="button"
          className="mask-bulk-btn"
          onClick={() => setInteriorOnly(tensorName, nAP, nML, ringDepth)}
          title={`Mask the outer ${ringDepth}-ring(s); keep only the interior visible`}
        >
          Interior
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          ring
          <input
            type="number"
            min={1}
            max={Math.max(1, Math.min(nAP, nML) >> 1)}
            value={ringDepth}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v) && v > 0) setRingDepth(v);
            }}
            style={{ width: 40, fontSize: 11 }}
          />
        </label>
      </div>

      <div style={{ fontSize: 11, color: "#8b949e" }}>
        Masked: {maskedCount} / {total} channels
        {setMaskMutation.isPending && <span style={{ marginLeft: 6 }}>(syncing…)</span>}
      </div>
    </div>
  );
}
