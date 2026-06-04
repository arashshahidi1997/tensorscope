/**
 * GridLayoutPicker — the real view-arrangement picker (panel-layout redesign).
 *
 * Lists the functional grid layouts (Overview / Signal+Space / Spectral /
 * Events / Probe lanes) and drives `appStore.gridLayout` via setGridLayout.
 * Supersedes the old LAYOUT_PRESETS view-grid presets, whose `viewGridLayout`
 * was dead (ViewGrid never read it). "Probe lanes" is offered only when the
 * session has ≥2 tensors (multi-probe is meaningless on one probe).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStateQuery } from "../../api/queries";
import { useAppStore, type GridLayoutId } from "../../store/appStore";
import { GRID_LAYOUT_OPTIONS } from "../views/viewGridLayout";

export function GridLayoutPicker() {
  const stateQuery = useStateQuery();
  const gridLayout = useAppStore((s) => s.gridLayout);
  const setGridLayout = useAppStore((s) => s.setGridLayout);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const multiProbe = (stateQuery.data?.tensors?.length ?? 0) >= 2;
  const options = GRID_LAYOUT_OPTIONS.filter((o) => !o.multiProbe || multiProbe);
  const activeLabel = options.find((o) => o.id === gridLayout)?.label ?? "Overview";

  const handleSelect = useCallback(
    (id: string) => {
      setGridLayout(id as GridLayoutId);
      setOpen(false);
    },
    [setGridLayout],
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="topbar-chip"
        onClick={() => setOpen((o) => !o)}
        title="View layout"
        style={{ cursor: "pointer", border: "none", background: "transparent", font: "inherit" }}
      >
        ⊞ {activeLabel}
      </button>
      {open && (
        <div className="preset-dropdown">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`preset-option${o.id === gridLayout ? " active" : ""}`}
              onClick={() => handleSelect(o.id)}
              title={o.description}
            >
              <span className="preset-option-label">{o.label}</span>
              <span className="preset-option-desc">{o.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
