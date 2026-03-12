/**
 * ViewGrid — renders active views in a CSS grid based on ViewGridLayout.
 *
 * Receives pre-rendered view elements (with their data already bound) from
 * WorkspaceMain. Wraps each in ViewPanel chrome and arranges them according
 * to the grid layout. Views not in the grid appear in an overflow area.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useLayoutStore } from "../../store/layoutStore";
import { useAppStore } from "../../store/appStore";
import { VIEW_DESCRIPTORS } from "../../registry/viewRegistry";
import { computeDefaultGrid, getOverflowViews } from "./viewGridLayout";
import { ViewPanel } from "./ViewPanel";

type ViewGridProps = {
  viewElements: Record<string, ReactNode>;
  activeViewIds: string[];
  availableViews: string[];
};

function getViewLabel(viewId: string): string {
  const desc = VIEW_DESCRIPTORS.find((d) => d.id === viewId);
  return desc?.label ?? viewId;
}

export function ViewGrid({ viewElements, activeViewIds, availableViews }: ViewGridProps) {
  const { viewGridLayout, maximizedView, toggleMaximizeView } = useLayoutStore();
  const { toggleView } = useAppStore();

  const grid = useMemo(
    () => viewGridLayout ?? computeDefaultGrid(activeViewIds),
    [viewGridLayout, activeViewIds],
  );

  const overflow = useMemo(
    () => getOverflowViews(activeViewIds, grid),
    [activeViewIds, grid],
  );

  const handleClose = useCallback(
    (viewId: string) => toggleView(viewId, availableViews),
    [toggleView, availableViews],
  );

  // When a view is maximized, only render that view (others hidden via CSS)
  const gridStyle = useMemo(() => {
    if (maximizedView) {
      return {
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr",
      };
    }
    const cols = grid.colWidths.map((w) => `${w}fr`).join(" ");
    const rows = grid.rowHeights.map((h) => `minmax(150px, ${h}fr)`).join(" ");
    return {
      gridTemplateColumns: cols,
      gridTemplateRows: rows,
    };
  }, [grid.colWidths, grid.rowHeights, maximizedView]);

  return (
    <>
      <div className="view-grid" style={gridStyle}>
        {grid.cells.map((cell) => {
          const el = viewElements[cell.viewId];
          if (!el) return null;

          const isMaximized = maximizedView === cell.viewId;
          const isHidden = maximizedView != null && !isMaximized;

          const cellStyle: React.CSSProperties = {};
          if (isHidden) {
            cellStyle.display = "none";
          } else if (!maximizedView) {
            if (cell.colSpan && cell.colSpan > 1) {
              cellStyle.gridColumn = `span ${cell.colSpan}`;
            }
            if (cell.rowSpan && cell.rowSpan > 1) {
              cellStyle.gridRow = `span ${cell.rowSpan}`;
            }
          }

          return (
            <div key={cell.viewId} style={cellStyle}>
              <ViewPanel
                viewId={cell.viewId}
                label={getViewLabel(cell.viewId)}
                isMaximized={isMaximized}
                onToggleMaximize={() => toggleMaximizeView(cell.viewId)}
                onClose={() => handleClose(cell.viewId)}
              >
                {el}
              </ViewPanel>
            </div>
          );
        })}
      </div>

      {/* Overflow: views not assigned to grid cells */}
      {overflow.length > 0 && (
        <div className="view-overflow">
          {overflow.map((viewId) => {
            const el = viewElements[viewId];
            if (!el) return null;
            const isHidden = maximizedView != null;
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
