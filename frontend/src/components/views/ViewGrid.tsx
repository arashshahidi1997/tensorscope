/**
 * ViewGrid — renders active views in a stable slot-based layout.
 *
 * Each view has a permanent "home slot" in a row. Toggling views shows/hides
 * them in-place without reflowing siblings. Rows collapse when all their
 * slots are hidden.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useLayoutStore } from "../../store/layoutStore";
import { useAppStore } from "../../store/appStore";
import { VIEW_DESCRIPTORS } from "../../registry/viewRegistry";
import { DEFAULT_SLOT_LAYOUT, isRowActive, getOverflowViews } from "./viewGridLayout";
import { ViewPanel } from "./ViewPanel";

type ViewGridProps = {
  viewElements: Record<string, ReactNode>;
  activeViewIds: string[];
  availableViews: string[];
  /** Global tensor name (used when no per-panel override is set). */
  globalTensor: string;
  /** All available tensor names for the per-panel dropdown. */
  tensorNames: string[];
};

function getViewLabel(viewId: string): string {
  const desc = VIEW_DESCRIPTORS.find((d) => d.id === viewId);
  return desc?.label ?? viewId;
}

export function ViewGrid({
  viewElements,
  activeViewIds,
  availableViews,
  globalTensor,
  tensorNames,
}: ViewGridProps) {
  const { maximizedView, toggleMaximizeView } = useLayoutStore();
  const { toggleView, panelTensorOverrides, setPanelTensor, clearPanelTensor } = useAppStore();

  const layout = DEFAULT_SLOT_LAYOUT;

  const overflow = useMemo(
    () => getOverflowViews(activeViewIds, layout),
    [activeViewIds, layout],
  );

  const handleClose = useCallback(
    (viewId: string) => toggleView(viewId, availableViews),
    [toggleView, availableViews],
  );

  const activeSet = useMemo(() => new Set(activeViewIds), [activeViewIds]);

  /** Resolve the tensor name for a given view slot. */
  const resolveTensor = useCallback(
    (viewId: string): string => panelTensorOverrides[viewId] ?? globalTensor,
    [panelTensorOverrides, globalTensor],
  );

  return (
    <>
      <div className="view-rows">
        {layout.rows.map((row) => {
          const rowActive = isRowActive(row, activeViewIds);

          // When maximized, hide rows that don't contain the maximized view
          const rowHasMaximized = maximizedView
            ? row.slots.some((s) => s.viewId === maximizedView)
            : false;
          if (maximizedView && !rowHasMaximized) {
            return <div key={row.id} style={{ display: "none" }} />;
          }

          const rowClassName = `view-row${!rowActive ? " view-row--collapsed" : ""}`;

          return (
            <div
              key={row.id}
              className={rowClassName}
              style={rowActive ? { minHeight: `${row.minHeight}px`, flex: `1 1 ${row.minHeight}px` } : undefined}
            >
              {row.slots.map((slot) => {
                const isActive = activeSet.has(slot.viewId);
                const isMaximized = maximizedView === slot.viewId;

                // When maximized, hide other slots in the same row
                if (maximizedView && !isMaximized) {
                  return <div key={slot.viewId} style={{ display: "none" }} />;
                }

                const slotStyle: React.CSSProperties = isMaximized
                  ? { flex: "1 1 100%" }
                  : isActive
                    ? { flex: `0 0 ${slot.widthFraction * 100}%` }
                    : {};

                const slotClassName = `view-slot${!isActive && !maximizedView ? " view-slot--hidden" : ""}`;

                const el = viewElements[slot.viewId];
                const resolvedTensor = resolveTensor(slot.viewId);
                const isPinned = slot.viewId in panelTensorOverrides;

                return (
                  <div key={slot.viewId} className={slotClassName} style={slotStyle}>
                    {el ? (
                      <ViewPanel
                        viewId={slot.viewId}
                        label={getViewLabel(slot.viewId)}
                        isMaximized={isMaximized}
                        onToggleMaximize={() => toggleMaximizeView(slot.viewId)}
                        onClose={() => handleClose(slot.viewId)}
                        tensorName={resolvedTensor}
                        isPinned={isPinned}
                        tensorNames={tensorNames}
                        onSetTensor={(name) => setPanelTensor(slot.viewId, name)}
                        onClearTensor={() => clearPanelTensor(slot.viewId)}
                      >
                        {el}
                      </ViewPanel>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Overflow: views not assigned to any slot */}
      {overflow.length > 0 && (
        <div className="view-overflow">
          {overflow.map((viewId) => {
            const el = viewElements[viewId];
            if (!el) return null;
            const isHidden = maximizedView != null;
            const resolvedTensor = resolveTensor(viewId);
            const isPinned = viewId in panelTensorOverrides;
            return (
              <div
                key={viewId}
                style={isHidden ? { display: "none" } : undefined}
              >
                <ViewPanel
                  viewId={viewId}
                  label={getViewLabel(viewId)}
                  isMaximized={false}
                  onToggleMaximize={() => toggleMaximizeView(viewId)}
                  onClose={() => handleClose(viewId)}
                  tensorName={resolvedTensor}
                  isPinned={isPinned}
                  tensorNames={tensorNames}
                  onSetTensor={(name) => setPanelTensor(viewId, name)}
                  onClearTensor={() => clearPanelTensor(viewId)}
                >
                  {el}
                </ViewPanel>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
